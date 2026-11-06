#!/usr/bin/env python3
"""Annual public SEC CDS trade coverage, filtered to vetted tape candidates.

An experimental read-only research auditor, not a dealer CDS quote/price
feed. Streams public DTCC archive files, keeping only corporate-name + RED
matches and later corrections linked by dissemination ID, so 365 files fit
within bounded memory. Does not promote the names/REDs to legally verified
reference entities without licensed independent RED reference evidence.
"""
import concurrent.futures
import datetime as dt
import importlib.util
import json
import pathlib
import re
import sys
import urllib.request

here=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location(
    "dtcc_trade_audit",here/"audit-dtcc-company-cds-readonly.py")
audit=importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

MAX_ARCHIVES=370
MAX_IDENTIFIED_ROWS=60000
MAX_POOL=4

def relevant_anchor(row):
    red=audit.present(row,"Underlier ID-Leg 1")
    name=audit.present(row,"Underlying Asset Name").upper()
    return any(red==code and company in name
               for code,company in audit.ISSUERS.values())

def select_relevant_events(today_rows, prior_ids):
    # Closure over future corrections that omit original entity identity.
    captured={}
    for row in today_rows:
        if not relevant_anchor(row): continue
        ident=audit.present(row,"Dissemination Identifier")
        if not ident:continue
        if ident in captured and captured[ident]!=row:
            raise ValueError("DTCC_SAME_ID_CONFLICT_ON_DAY")
        captured[ident]=row
    all_known=set(prior_ids)|set(captured)
    for _ in range(24):
        found=0
        for row in today_rows:
            ident=audit.present(row,"Dissemination Identifier")
            orig=audit.present(row,"Original Dissemination Identifier")
            if ident and orig in all_known and ident not in captured:
                captured[ident]=row
                all_known.add(ident)
                found+=1
        if not found:break
    else:raise ValueError("DTCC_CORRECTION_CHAIN_TOO_DEEP")
    return captured

def combine_relevant_archives(named_row_sets):
    held={}
    raw_rows=0
    days=[]
    for day,rows in named_row_sets:
        if days and day<=days[-1]:
            raise ValueError("DTCC_DATES_NOT_ASCENDING")
        days.append(day)
        raw_rows+=len(rows)
        found=select_relevant_events(rows,held)
        for ident,row in found.items():
            if ident in held and held[ident]!=row:
                raise ValueError("DTCC_IDENTIFIED_REPORT_CONFLICT")
            held[ident]=row
        if len(held)>MAX_IDENTIFIED_ROWS:
            raise ValueError("DTCC_RELEVANT_ROWS_TOO_LARGE")
    return list(held.values()),raw_rows,days

def process_history(named_row_sets):
    # Consume a bounded chronological iterator, not 359 CSV files at once.
    rows,raw_rows,all_dates=combine_relevant_archives(named_row_sets)
    if not all_dates:
        raise ValueError("DTCC_ARCHIVES_EMPTY")
    observations={sym:[] for sym in audit.ALL}
    for day in all_dates:
        pairs=audit.get_candidates(rows,day)
        for symbol in audit.ALL:
            trades=pairs.get(symbol,[])
            if not trades:continue
            levels=sorted(t["reportedContractSpreadBp"] for t in trades)
            import statistics
            observations[symbol].append({
                "date":day,"count":len(levels),
                "medianReportedContractBp":float(statistics.median(levels))
            })
    summaries=[]
    for symbol in audit.ALL:
        points=observations[symbol]
        summaries.append({
            "symbol":symbol,"observedDays":len(points),
            "latest":points[-1] if points else None,
            "month1":audit.trade_median_comparison(points,30),
            "quarter3":audit.trade_median_comparison(points,91),
            "year1":audit.trade_median_comparison(points,365)
        })
    return {
        "mode":"DTCC_CDS_1Y_FILTERED_TRADE_HISTORY_READ_ONLY",
        "firstFileDate":all_dates[0],"lastFileDate":all_dates[-1],
        "archiveDays":len(all_dates),"allRowsScanned":raw_rows,
        "relevantEventRows":len(rows),
        "summaries":summaries,
        "licensedRedReferenceMappingsVerified":0,
        "dealerParQuotesVerified":0,
        "afterWindowCorrectionsUnknown":True,
        "financialSourceWrites":0,"telegramSends":0,"gasDeployments":0
    }

def retrieve_index(as_of):
    with urllib.request.urlopen(
        "https://kgc0418-tdw-data-0.s3.amazonaws.com/dashboard/Cumulative.json",
        timeout=20) as response:
        body=response.read(4_000_001)
    if len(body)>=4_000_001:raise ValueError("INDEX_TOO_LARGE")
    index=json.loads(body)
    entries=index.get("SEC_CR") if isinstance(index,dict) else None
    if not isinstance(entries,list):raise ValueError("INDEX_SCHEMA_INVALID")
    dated={}
    for item in entries:
        if not isinstance(item,dict):continue
        name=item.get("fileName")
        if not isinstance(name,str) or not re.fullmatch(
            r"SEC_CUMULATIVE_CREDITS_20\d{2}_\d{2}_\d{2}\.zip",name):
            continue
        if item.get("fullFilePath")!=audit.SOURCE_HOST+name:continue
        day=name.removeprefix("SEC_CUMULATIVE_CREDITS_").removesuffix(".zip").replace("_","-")
        try:
            parsed=dt.date.fromisoformat(day)
        except ValueError:continue
        if parsed>dt.date.fromisoformat(as_of):continue
        if day in dated and dated[day]!=item["fullFilePath"]:
            raise ValueError("DUPLICATE_INDEX_DATE")
        dated[day]=item["fullFilePath"]
    dates=sorted(dated)
    earliest=(dt.date.fromisoformat(as_of)-dt.timedelta(days=365)).isoformat()
    selected=[(day,dated[day]) for day in dates if day>=earliest]
    if not selected or selected[-1][0]!=as_of:
        raise ValueError("ASOF_INDEX_NOT_PUBLISHED")
    if len(selected)>MAX_ARCHIVES:
        raise ValueError("YEAR_ARCHIVE_COUNT_EXCEEDS_LIMIT")
    return selected

def fetch_one(item):
    day,url=item
    with urllib.request.urlopen(url,timeout=27) as response:
        buf=response.read(audit.MAX_DOWNLOAD)
    rows=audit.read_archive(buf)
    return day,rows

def iter_downloads(selected):
    # Limit pending future results to four archives. Executor.map can otherwise
    # retain hundreds of expanded CSVs until the earliest slow job completes.
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_POOL) as executor:
        pending={}
        pos=0
        for index,item in enumerate(selected):
            pending[index]=executor.submit(fetch_one,item)
            if len(pending)>=MAX_POOL:
                yield pending.pop(pos).result()
                pos+=1
        while pos<len(selected):
            yield pending.pop(pos).result()
            pos+=1

def run_live(as_of):
    selected=retrieve_index(as_of)
    return process_history(iter_downloads(selected))

def mock_row(ident,day="2025-11-05",action="NEWT",original=""):
    return {
        "Dissemination Identifier":ident,
        "Original Dissemination Identifier":original,"Action type":action,
        "Event type":"TRAD",
        "Execution Timestamp":day+"T12:00:00Z",
        "Effective Date":day,
        "Expiration Date":("2030-12-20" if day.startswith("2025") else "2031-12-20"),
        "Spread-Leg 1":"0.0087","Spread notation-Leg 1":"3",
        "Notional currency-Leg 1":"USD","Underlier ID source-Leg 1":"REDID",
        "Underlier ID-Leg 1":"0C27GT","Underlying Asset Name":"Alphabet Inc.",
        "UPI FISN":"NA/CDS Corp SN Sr","Package indicator":"FALSE",
        "Non-standardized term indicator":"FALSE","Custom basket indicator":"false"
    }

def selftest():
    old=mock_row("1234")
    late=mock_row("2345",day="2026-11-05",action="CORR",original="1234")
    # Later correction omits RED/name; linked original remains invalidated.
    late["Underlying Asset Name"]=""
    late["Underlier ID-Leg 1"]=""
    rows,ct,days=combine_relevant_archives([
        ("2025-11-05",[old]),("2026-11-05",[late])])
    assert ct==2 and len(rows)==2 and days==["2025-11-05","2026-11-05"]
    assert audit.get_candidates(rows,"2025-11-05")["GOOGL"]==[]
    year=process_history([
        ("2025-11-05",[old]),("2026-11-05",[late])])
    assert year["summaries"][2]["observedDays"]==0
    newer=mock_row("3456",day="2026-11-05")
    uncancelled=process_history([
        ("2025-11-05",[old]),("2026-11-05",[newer])])
    assert uncancelled["summaries"][2]["observedDays"]==2
    assert uncancelled["summaries"][2]["year1"]["changeBp"]==0
    terminated=mock_row("3457",day="2026-11-05",
                         action="TERM",original="1234")
    terminated["Underlying Asset Name"]=""
    terminated["Underlier ID-Leg 1"]=""
    still_history=process_history([
        ("2025-11-05",[old]),
        ("2026-11-05",[newer,terminated])])
    assert still_history["summaries"][2]["observedDays"]==2
    assert still_history["summaries"][2]["year1"]["changeBp"]==0
    assert uncancelled["dealerParQuotesVerified"]==0
    assert uncancelled["licensedRedReferenceMappingsVerified"]==0
    print("DTCC_CDS_YEAR_FILTERED_SELFTEST_PASS")

if __name__=="__main__":
    try:
        if sys.argv[1:]==["--selftest"]: selftest()
        elif len(sys.argv)==2:
            dt.date.fromisoformat(sys.argv[1])
            print(json.dumps(run_live(sys.argv[1]),ensure_ascii=False,separators=(",",":")))
        else:raise ValueError("USAGE: YYYY-MM-DD|--selftest")
    except Exception as e:
        print("DTCC_CDS_YEAR_AUDIT_UNVERIFIED:"+type(e).__name__)
        sys.exit(1)
