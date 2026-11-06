#!/usr/bin/env python3
"""DTCC public SEC credit index coverage; no private data, no trade values.

An archive index establishes only file-date availability, not a verified
single-name RED mapping or executable / par 5-year CDS quote.
"""
import datetime as dt
import json
import re
import sys
import urllib.request

INDEX_URL="https://kgc0418-tdw-data-0.s3.amazonaws.com/dashboard/Cumulative.json"
SOURCE_PREFIX="https://kgc0418-tdw-data-0.s3.amazonaws.com/sec/eod/"
NAME=re.compile(r"SEC_CUMULATIVE_CREDITS_(20\d{2})_(\d{2})_(\d{2})\.zip\Z")


def audit_calendar(source, as_of):
    today=dt.date.fromisoformat(as_of)
    if not isinstance(source,dict) or not isinstance(source.get("SEC_CR"),list):
        raise ValueError("DTCC_SEC_CREDIT_INDEX_INVALID")
    entries=source["SEC_CR"]
    if len(entries)>12000:
        raise ValueError("DTCC_INDEX_TOO_LARGE")
    days=set()
    duplicates=0
    for item in entries:
        if not isinstance(item,dict):continue
        name=item.get("fileName")
        url=item.get("fullFilePath")
        if not isinstance(name,str) or not NAME.fullmatch(name):
            continue
        if url!=SOURCE_PREFIX+name:
            continue
        m=NAME.fullmatch(name)
        try: date=dt.date(int(m[1]),int(m[2]),int(m[3]))
        except ValueError: continue
        if date>today:continue
        if date in days: duplicates+=1
        days.add(date)
    calendar=sorted(days)
    if not calendar:
        return {"status":"NO_VERIFIED_SEC_CREDIT_ARCHIVES",
                "verified5yParQuotes":0,"totalDates":0}
    windows={}
    for label,width in (("30d",30),("90d",90),("365d",365)):
        start=today-dt.timedelta(days=width-1)
        found=[d for d in calendar if start<=d<=today]
        iso=lambda d: d.isoformat() if d else None
        windows[label]={"windowStart":iso(start),"windowEnd":iso(today),
            "archiveDays":len(found),
            "firstObservedArchive":iso(found[0]) if found else None,
            "lastObservedArchive":iso(found[-1]) if found else None,
            "oldestComparisonCoverage":len(found)>0 and found[0]<=start+dt.timedelta(days=3)}
    return {"status":"DTCC_INDEX_CALENDAR_AVAILABLE",
            "asOf":as_of,"totalDates":len(calendar),
            "oldestArchive":calendar[0].isoformat(),
            "newestArchive":calendar[-1].isoformat(),
            "duplicatedIndexDates":duplicates,
            "windows":windows,"verified5yParQuotes":0,
            "verifiedReferenceEntityMappings":0,
            "financialPortfolioWrites":0,"telegramSends":0,"gasDeployments":0}


def selftest():
    def entry(s):
        name="SEC_CUMULATIVE_CREDITS_"+s.replace("-","_")+".zip"
        return {"fileName":name,"fullFilePath":SOURCE_PREFIX+name}
    rows=[entry(x) for x in ("2025-11-07","2026-08-09","2026-10-08","2026-11-05")]
    rows.append({**rows[0],"fullFilePath":"https://malicious.example/archive.zip"})
    fixture={"SEC_CR":rows}
    v=audit_calendar(fixture,"2026-11-05")
    assert v["totalDates"]==4
    assert v["windows"]["30d"]["archiveDays"]==2
    assert v["windows"]["90d"]["archiveDays"]==3
    assert v["windows"]["365d"]["archiveDays"]==4
    assert v["verified5yParQuotes"]==0
    fixture["SEC_CR"].append(rows[0])
    assert audit_calendar(fixture,"2026-11-05")["duplicatedIndexDates"]==1
    assert audit_calendar(fixture,"2025-01-01")["status"]=="NO_VERIFIED_SEC_CREDIT_ARCHIVES"
    print("DTCC_CREDIT_INDEX_CALENDAR_SELFTEST_PASS")


def main():
    if sys.argv[1:]==["--selftest"]:
        selftest()
        return
    if len(sys.argv)!=2: raise ValueError("USAGE: YYYY-MM-DD|--selftest")
    as_of=sys.argv[1]
    dt.date.fromisoformat(as_of)
    with urllib.request.urlopen(INDEX_URL,timeout=20) as response:
        payload=response.read(4_000_001)
    if len(payload)>=4_000_001: raise ValueError("DTCC_INDEX_EXCEEDS_MAX_BYTES")
    result=audit_calendar(json.loads(payload),as_of)
    print(json.dumps(result,ensure_ascii=False,separators=(",",":")))


if __name__=="__main__":
    try: main()
    except Exception as e:
        print("DTCC_CREDIT_INDEX_CALENDAR_UNVERIFIED:"+type(e).__name__)
        sys.exit(1)
