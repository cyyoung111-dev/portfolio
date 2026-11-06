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

MAX_ARCHIVES=410
MAX_IDENTIFIED_ROWS=60000
MAX_POOL=4

def relevant_anchor(row):
    red=audit.present(row,"Underlier ID-Leg 1")
    name=audit.present(row,"Underlying Asset Name").upper()
    return any(red==code and company in name
               for code,company in audit.ISSUERS.values())

def select_relevant_events(today_rows, prior_ids):
    # Check *all* source IDs, including correction rows whose corporate name
    # and RED fields are omitted; input order must never decide which correction
    # survives. An exact redisclosure within a file is harmless.
    unique={}
    for row in today_rows:
        ident=audit.present(row,"Dissemination Identifier")
        if not ident or not ident.isdecimal():
            raise ValueError("DTCC_MISSING_OR_NONNUMERIC_ID")
        if ident in unique and unique[ident]!=row:
            raise ValueError("DTCC_SAME_ID_CONFLICT_ON_DAY")
        unique[ident]=row

    captured={ident:row for ident,row in unique.items()
              if relevant_anchor(row)}
    all_known=set(prior_ids)|set(captured)
    for _ in range(24):
        found=0
        for ident,row in unique.items():
            orig=audit.present(row,"Original Dissemination Identifier")
            if orig not in all_known:continue
            if ident in captured:
                if captured[ident]!=row:
                    raise ValueError("DTCC_CORRECTION_ID_CONFLICT")
                continue
            captured[ident]=row
            all_known.add(ident)
            found+=1
        if not found:break
    else:raise ValueError("DTCC_CORRECTION_CHAIN_TOO_DEEP")
    return captured

def combine_relevant_archives(named_row_sets):
    held={}
    global_fingerprints={}
    raw_rows=0
    days=[]
    for day,rows in named_row_sets:
        if days and day<=days[-1]:
            raise ValueError("DTCC_DATES_NOT_ASCENDING")
        days.append(day)
        raw_rows+=len(rows)
        # Verify every public record ID across EVERY archive before applying
        # the issuer/RED relevance filter. Identical redisclosures are fine.
        audit.register_source_ids(rows,global_fingerprints)
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
    # The very same tested oracle powers rolling (15-120 archive) history.
    observations=audit.execution_observations(rows,all_dates[-1])
    first_archive=dt.date.fromisoformat(all_dates[0])
    summaries=[]
    for symbol in audit.ALL:
        points=observations[symbol]
        year=audit.trade_median_comparison(points,365)
        needed=(dt.date.fromisoformat(points[-1]["date"])
                -dt.timedelta(days=368)) if points else None
        coverage=bool(needed and first_archive<=needed)
        summaries.append({
            "symbol":symbol,"observedDays":len(points),
            "latest":points[-1] if points else None,
            "month1":audit.trade_median_comparison(points,30),
            "quarter3":audit.trade_median_comparison(points,91),
            "year1":year,
            "year1CoverageStart":needed.isoformat() if needed else None,
            "year1ArchiveWindowComplete":coverage,
            "year1Status":("OBSERVED" if year is not None
                           else "NO_OBSERVED_TRADE_SERIES" if not points
                           else "ARCHIVE_WINDOW_INCOMPLETE" if not coverage
                           else "NO_TRADE_NEAR_1Y_COMPARISON")
        })
    return {
        "mode":"DTCC_CDS_1Y_FILTERED_TRADE_HISTORY_READ_ONLY",
        "firstFileDate":all_dates[0],"lastFileDate":all_dates[-1],
        "archiveDays":len(all_dates),"allRowsScanned":raw_rows,
        "observationDateBasis":"EXECUTION_TIMESTAMP_UTC",
        "relevantEventRows":len(rows),
        "summaries":summaries,
        "licensedRedReferenceMappingsVerified":0,
        "dealerParQuotesVerified":0,
        "afterWindowCorrectionsUnknown":True,
        "financialSourceWrites":0,"telegramSends":0,"gasDeployments":0
    }

def select_archive_index(index,as_of):
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
    # 365-day comparison allows ±3 days and publication may be delayed.
    # Fetch 14 additional calendar days of reported files to retain the
    # full boundary and nearby late-reported executions when published.
    earliest=(dt.date.fromisoformat(as_of)-dt.timedelta(days=382)).isoformat()
    selected=[(day,dated[day]) for day in dates if day>=earliest]
    if not selected or selected[-1][0]!=as_of:
        raise ValueError("ASOF_INDEX_NOT_PUBLISHED")
    if len(selected)>MAX_ARCHIVES:
        raise ValueError("YEAR_ARCHIVE_COUNT_EXCEEDS_LIMIT")
    return selected

def retrieve_index(as_of):
    with urllib.request.urlopen(
        "https://kgc0418-tdw-data-0.s3.amazonaws.com/dashboard/Cumulative.json",
        timeout=20) as response:
        body=response.read(4_000_001)
    if len(body)>=4_000_001:raise ValueError("INDEX_TOO_LARGE")
    return select_archive_index(json.loads(body),as_of)

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

    # A correction without issuer fields must not silently reuse a duplicate
    # dissemination ID whose different parents produce order-dependent price.
    a=mock_row("1001")
    b=mock_row("1002")
    c1=mock_row("2000",day="2025-11-06",action="CORR",original="1001")
    c2=mock_row("2000",day="2025-11-06",action="CORR",original="1002")
    for corrected in (c1,c2):
        corrected["Underlying Asset Name"]=""
        corrected["Underlier ID-Leg 1"]=""
    for order in ([a,b,c1,c2],[b,a,c2,c1]):
        try:
            select_relevant_events(order,set())
            raise AssertionError("contradictory same-ID corrections were accepted")
        except ValueError as e:
            assert str(e)=="DTCC_SAME_ID_CONFLICT_ON_DAY"
    # Cross-file duplicate correction ID referencing two different roots:
    # one related and one not on the CDS watchlist. The global registry must
    # reject both orderings before the issuer relevance filter is reached.
    unrelated=mock_row("3002")
    unrelated["Underlier ID-Leg 1"]="NOT_A_WATCHED_RED"
    unrelated["Underlying Asset Name"]="Other Issuer Inc."
    cr1=mock_row("4000",day="2025-11-06",
                 action="CORR",original="1001")
    cr2=mock_row("4000",day="2025-11-07",
                 action="CORR",original="3002")
    for item in (cr1,cr2):
        item["Underlier ID-Leg 1"]=""
        item["Underlying Asset Name"]=""
    for d1,d2 in ((cr1,cr2),(cr2,cr1)):
        try:
            process_history([
                ("2025-11-05",[a,unrelated]),
                ("2025-11-06",[d1]),
                ("2025-11-07",[d2])])
            raise AssertionError("conflicting cross-file report ID accepted")
        except ValueError as exc:
            assert str(exc)=="DTCC_GLOBAL_ID_PAYLOAD_CONFLICT"


    # Trade executed 11/06 but first disseminated in 11/07 archive; there is
    # no 11/06 archive, yet 11/06 must still have a trade observation.
    delayed=mock_row("7001",day="2025-11-06")
    late_history=process_history([("2025-11-07",[delayed])])
    assert late_history["summaries"][2]["observedDays"]==1
    assert late_history["summaries"][2]["latest"]["date"]=="2025-11-06"
    assert late_history["observationDateBasis"]=="EXECUTION_TIMESTAMP_UTC"

    # The 1Y comparison ±3-day allowance requires archives *before*
    # as_of-365. Preserve a synthetic eligible early archive and report
    # incomplete window explicitly when its earlier side is not covered.
    def item(day):
        name="SEC_CUMULATIVE_CREDITS_"+day.replace("-","_")+".zip"
        return {"fileName":name,"fullFilePath":audit.SOURCE_HOST+name}
    indexed=select_archive_index({"SEC_CR":[
        item("2025-11-02"),item("2025-11-03"),
        item("2026-11-05")]}, "2026-11-05")
    assert [d for d,_ in indexed]==[
        "2025-11-02","2025-11-03","2026-11-05"]
    incomplete=process_history([
        ("2025-11-05",[old]),("2026-11-05",[newer])])
    assert incomplete["summaries"][2]["year1Status"]=="OBSERVED"
    early=process_history([
        ("2025-11-05",[]),("2026-11-05",[newer])])
    assert early["summaries"][2]["year1"] is None
    assert early["summaries"][2]["year1Status"]=="ARCHIVE_WINDOW_INCOMPLETE"

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
