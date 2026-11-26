#!/usr/bin/env python3
"""Public, read-only KOFIA DIS daily NAV feasibility probe.

Protocol reference: https://github.com/LEEYOUNGJIN-GIT/kofia (src/dis_client.py,
src/dis_std_price.py). Independent implementation; no private API, credentials,
GAS, financial writes, or authorization to import. The DIS web interface is not
a documented supported OpenAPI contract.
"""
import argparse
import datetime as dt
from decimal import Decimal, InvalidOperation
import json
import re
import sys
import time
import urllib.error
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

URL = "https://dis.kofia.or.kr/proframeWeb/XMLSERVICES/"
FUNDS = (
    ("F00002", "KR5223AQ0185", "밸류포커스", Decimal("2025.10")),
    ("F00001", "K55213C50702", "TDF2045", Decimal("1917.23")),
)
ANCHOR = dt.date(2026, 11, 16)
MAX_BYTES = 5_000_000

def request_body(keyword, day):
    root = ET.Element("message")
    header = ET.SubElement(root, "proframeHeader")
    for tag, value in (("pfmAppName", "FS-DIS2"),
                       ("pfmSvcName", "DISFundStdPriceSO"),
                       ("pfmFnName", "select")):
        ET.SubElement(header, tag).text = value
    ET.SubElement(root, "systemHeader")
    dto = ET.SubElement(root, "DISCondFuncDTO")
    for key, value in (("tmpV30", day.strftime("%Y%m%d")), ("tmpV12", keyword),
                       *((tag, "") for tag in ("tmpV3", "tmpV4", "tmpV5",
                                               "tmpV7", "tmpV11", "tmpV50", "tmpV51"))):
        ET.SubElement(dto, key).text = value
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)

def tag_name(tag):
    return tag.rsplit("}", 1)[-1]

def extract_nav(body, isin, day):
    if len(body) > MAX_BYTES or b"<!doctype" in body.lower() or b"<!entity" in body.lower():
        raise ValueError("XML_UNSAFE_OR_TOO_LARGE")
    try:
        root = ET.fromstring(body)
    except ET.ParseError as exc:
        raise ValueError("XML_INVALID") from exc
    # The transport may wrap the DIS grid differently across versions.
    # Require the actual grid structure; log only a bounded root tag on
    # unexpected responses, not the raw response or other funds' data.
    nodes = [elem for elem in root.iter() if tag_name(elem.tag) == "selectMeta"]
    if not nodes:
        root_name = tag_name(root.tag)
        if root_name.lower() in ("html", "error", "fault"):
            raise ValueError("RESPONSE_NOT_MESSAGE")
        safe_name = root_name if re.fullmatch(r"[A-Za-z0-9_:-]{1,64}", root_name) else "UNKNOWN"
        raise ValueError("RESPONSE_NO_GRID_" + safe_name)
    values = []
    for elem in nodes:
        row = {}
        for child in elem:
            name = tag_name(child.tag)
            if name in row:
                raise ValueError("DUPLICATE_FIELD")
            row[name] = (child.text or "").strip()
        if row.get("tmpV12") != isin:
            continue
        # tmpV4 is the inception date, never a substitute for quotation date.
        actual_date = row.get("tmpV14", "")
        if actual_date != day.strftime("%Y%m%d"):
            raise ValueError("EXACT_DATE_MISMATCH")
        raw = row.get("tmpV6", "").replace(",", "")
        if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", raw):
            raise ValueError("PRICE_INVALID")
        try:
            nav = Decimal(raw)
        except InvalidOperation as exc:
            raise ValueError("PRICE_INVALID") from exc
        if not nav.is_finite() or nav <= 0:
            raise ValueError("PRICE_INVALID")
        values.append(nav)
    if not values:
        raise ValueError("EXACT_CLASS_NOT_FOUND")
    if len(values) != 1:
        raise ValueError("EXACT_CLASS_NOT_UNIQUE")
    return values[0]

class AccessDenied(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def fetch_nav(isin, keyword, day):
    request = urllib.request.Request(
        URL, data=request_body(keyword, day),
        headers={"Content-Type": "text/xml; charset=UTF-8",
                 "Accept": "application/xml, text/xml",
                 "User-Agent": "portfolio-public-nav-readonly-probe/1.0"},
        method="POST",
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as resp:
            if resp.status != 200:
                raise ValueError("HTTP_" + str(resp.status))
            body = resp.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403, 429):
            raise AccessDenied("HTTP_" + str(exc.code)) from exc
        raise ValueError("HTTP_" + str(exc.code)) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ValueError("TRANSPORT_UNVERIFIED") from exc
    # Stop on access-denial pages, including when returned with HTTP 200.
    lower = body[:8192].lower()
    if b"firewall" in lower or b"access denied" in lower or b"request blocked" in lower:
        raise AccessDenied("ACCESS_DENIED_BODY")
    return extract_nav(body, isin, day)

def previous_weekday(today):
    result = today - dt.timedelta(days=1)
    while result.weekday() >= 5:
        result -= dt.timedelta(days=1)
    return result

def run_probe():
    today = dt.datetime.now(ZoneInfo("Asia/Seoul")).date()
    latest = previous_weekday(today)
    report = {"kind": "KOFIA_DIS_NAV_SOURCE_PROBE", "asOfKst": today.isoformat(),
              "source": URL, "anchorDate": ANCHOR.isoformat(),
              "requestedRecentWeekday": latest.isoformat(), "results": [],
              "financialWrites": 0, "gasCalls": 0, "importAuthorized": False}
    blocked = False
    for fund, isin, keyword, anchor_nav in FUNDS:
        for label, day in (("anchor", ANCHOR), ("recent", latest)):
            record = {"fund": fund, "standardCode": isin, "date": day.isoformat(), "check": label}
            if blocked:
                record["status"] = "SKIPPED_AFTER_ACCESS_DENIAL"
            else:
                try:
                    nav = fetch_nav(isin, keyword, day)
                    record["status"] = ("ANCHOR_MATCH" if nav == anchor_nav else "ANCHOR_MISMATCH") if label == "anchor" else "EXACT_DATE_CLASS_FOUND"
                    record["nav"] = str(nav)
                except AccessDenied as exc:
                    record["status"] = str(exc)
                    blocked = True
                except ValueError as exc:
                    record["status"] = str(exc)
                time.sleep(1)
            report["results"].append(record)
    report["feasibilityEvidence"] = all(
        item["status"] == ("ANCHOR_MATCH" if item["check"] == "anchor" else "EXACT_DATE_CLASS_FOUND")
        for item in report["results"]
    )
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report["feasibilityEvidence"] else 1

# Independent candidate: documented observations from
# https://github.com/dd3ok/naverstock-api-skill/blob/main/references/api-home-market-fund.md
# The field meanings and identity still need real-response verification.
NAVER_ORIGIN = "https://stock.naver.com"
CANDIDATE_FIELDS = ("basePrice", "standardPrice", "stdPrice", "nav", "price", "closePrice")

def naver_price_evidence(body, isin, day):
    if len(body) > MAX_BYTES:
        raise ValueError("JSON_TOO_LARGE")
    try:
        data = json.loads(body, parse_float=Decimal)
    except (ValueError, UnicodeError) as exc:
        raise ValueError("JSON_INVALID") from exc
    if not isinstance(data, dict):
        raise ValueError("JSON_NOT_OBJECT")
    if "fundCode" in data and data["fundCode"] != isin:
        raise ValueError("RESPONSE_CLASS_MISMATCH")
    rows = data.get("prices")
    if not isinstance(rows, list):
        return {"status": "PRICES_STRUCTURE_UNVERIFIED",
                "responseKeys": sorted(str(k)[:40] for k in data)[:25]}
    matches = [row for row in rows if isinstance(row, dict) and
               row.get("tradeDate") == day.isoformat()]
    if len(matches) != 1:
        return {"status": "EXACT_DATE_NOT_UNIQUE_OR_MISSING", "rowCount": len(rows)}
    row = matches[0]
    if "fundCode" in row and row["fundCode"] != isin:
        raise ValueError("RESPONSE_CLASS_MISMATCH")
    candidate = {}
    for key in CANDIDATE_FIELDS:
        value = row.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, Decimal, str)):
            continue
        raw = str(value).replace(",", "")
        if re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", raw):
            number = Decimal(raw)
            if number.is_finite() and number > 0:
                candidate[key] = str(number)
    return {"status": "EXACT_DATE_CANDIDATE" if candidate else "PRICE_FIELD_UNVERIFIED",
            "identityEvidence": "RESPONSE_CODE_MATCH" if
                (data.get("fundCode") == isin or row.get("fundCode") == isin)
                else "REQUEST_CODE_ONLY",
            "candidateValues": candidate,
            "rowKeys": sorted(str(k)[:40] for k in row)[:35]}

def naver_request(isin, day):
    query = urllib.parse.urlencode({"date": day.isoformat(), "size": 10})
    url = NAVER_ORIGIN + "/api/fund/funds/" + isin + "/prices/daily?" + query
    request = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "portfolio-public-nav-readonly-probe/1.0"})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
            body = response.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403, 429):
            raise AccessDenied("HTTP_" + str(exc.code)) from exc
        raise ValueError("HTTP_" + str(exc.code)) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ValueError("TRANSPORT_UNVERIFIED") from exc
    if b"access denied" in body[:8192].lower() or b"request blocked" in body[:8192].lower():
        raise AccessDenied("ACCESS_DENIED_BODY")
    return naver_price_evidence(body, isin, day)

def run_naver_probe():
    today = dt.datetime.now(ZoneInfo("Asia/Seoul")).date()
    recent = previous_weekday(today)
    report = {"kind": "NAVER_FUND_NAV_SOURCE_PROBE", "asOfKst": today.isoformat(),
              "results": [], "financialWrites": 0, "gasCalls": 0,
              "importAuthorized": False}
    denied = False
    for fund, isin, _, anchor_nav in FUNDS:
        for label, day in (("anchor", ANCHOR), ("recent", recent)):
            record = {"fund": fund, "standardCode": isin, "date": day.isoformat(), "check": label}
            if denied:
                record["status"] = "SKIPPED_AFTER_ACCESS_DENIAL"
            else:
                try:
                    record.update(naver_request(isin, day))
                    if label == "anchor":
                        record["anchorMatchingFields"] = [
                            key for key, value in record.get("candidateValues", {}).items()
                            if Decimal(value) == anchor_nav]
                except AccessDenied as exc:
                    record["status"] = str(exc)
                    denied = True
                except ValueError as exc:
                    record["status"] = str(exc)
                time.sleep(1)
            report["results"].append(record)
    # A candidate field and response-code evidence must agree for both dates.
    pairs = [report["results"][i:i+2] for i in range(0, len(report["results"]), 2)]
    report["feasibilityEvidence"] = all(
        all(x.get("identityEvidence") == "RESPONSE_CODE_MATCH" for x in pair)
        and bool(set(pair[0].get("anchorMatchingFields", [])) &
                 set(pair[1].get("candidateValues", {})))
        for pair in pairs)
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report["feasibilityEvidence"] else 1


def completed_weekdays(today, count=5):
    days = []
    day = today
    for _ in range(count):
        day = previous_weekday(day)
        days.append(day)
    return sorted(days)

def naver_history(body, isin, requested_dates):
    if len(body) > MAX_BYTES:
        raise ValueError("JSON_TOO_LARGE")
    try:
        data = json.loads(body, parse_float=Decimal)
    except (ValueError, UnicodeError) as exc:
        raise ValueError("JSON_INVALID") from exc
    if not isinstance(data, dict) or data.get("fundCode") != isin:
        raise ValueError("RESPONSE_CLASS_MISMATCH")
    if not isinstance(data.get("prices"), list):
        raise ValueError("PRICES_STRUCTURE_UNVERIFIED")
    dates = {d.isoformat() for d in requested_dates}
    out = {}
    for row in data["prices"]:
        if not isinstance(row, dict):
            raise ValueError("ROW_INVALID")
        day = row.get("tradeDate")
        if day not in dates:
            continue
        if "fundCode" in row and row["fundCode"] != isin:
            raise ValueError("RESPONSE_CLASS_MISMATCH")
        if day in out:
            raise ValueError("DUPLICATE_DATE")
        raw = str(row.get("basePrice", "")).replace(",", "")
        if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", raw):
            raise ValueError("PRICE_INVALID")
        val = Decimal(raw)
        if not val.is_finite() or val <= 0:
            raise ValueError("PRICE_INVALID")
        out[day] = val
    return out

def read_naver_history(isin, today, requested_dates):
    query = urllib.parse.urlencode({"date": today.isoformat(), "size": 10})
    url = NAVER_ORIGIN + "/api/fund/funds/" + isin + "/prices/daily?" + query
    req = urllib.request.Request(url, headers={"Accept": "application/json",
        "User-Agent": "portfolio-public-nav-readonly-probe/1.0"})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=15) as resp:
            raw = resp.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403, 429):
            raise AccessDenied("HTTP_" + str(exc.code)) from exc
        raise ValueError("HTTP_" + str(exc.code)) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ValueError("TRANSPORT_UNVERIFIED") from exc
    if b"access denied" in raw[:8192].lower() or b"request blocked" in raw[:8192].lower():
        raise AccessDenied("ACCESS_DENIED_BODY")
    return naver_history(raw, isin, requested_dates)

def reconcile_candidate(primary, secondary, latest_day):
    overlap = sorted(set(primary) & set(secondary))
    conflicts = [d for d in overlap if primary[d] != secondary[d]]
    state = ("CONFLICT" if conflicts else "INSUFFICIENT_OVERLAP" if len(overlap) < 3
             else "CROSSCHECK_MATCHED")
    return {"state": state, "matchedDates": [d for d in overlap if d not in conflicts],
            "conflictDates": conflicts,
            "secondaryMissingDates": sorted(set(primary) - set(secondary)),
            "latestRequestedWeekdayPresent": latest_day in primary}

def run_archive():
    # Candidate evidence only. No GAS, no private data, no authorization
    # to import, and no inferred holidays or carried-forward prices.
    today = dt.datetime.now(ZoneInfo("Asia/Seoul")).date()
    days = completed_weekdays(today)
    report = {"kind": "PUBLIC_NAV_CANDIDATE_ARCHIVE", "asOfKst": today.isoformat(),
              "requestedDates": [d.isoformat() for d in days], "funds": [],
              "financialWrites": 0, "gasCalls": 0, "importAuthorized": False}
    primary_denied = secondary_denied = False
    for fund, isin, keyword, anchor_nav in FUNDS:
        result = {"fund": fund, "standardCode": isin, "anchorDate": ANCHOR.isoformat(),
                  "source": URL, "rows": [], "missing": [], "anchorState": "UNVERIFIED"}
        primary = {}
        for day in sorted(set([ANCHOR] + days)):
            iso = day.isoformat()
            if primary_denied:
                result["missing"].append({"date": iso, "reason": "SKIPPED_AFTER_ACCESS_DENIAL"})
                continue
            try:
                nav = fetch_nav(isin, keyword, day)
                if day == ANCHOR:
                    result["anchorState"] = "MATCH" if nav == anchor_nav else "MISMATCH"
                if day in days:
                    primary[iso] = nav
            except AccessDenied as exc:
                primary_denied = True
                result["missing"].append({"date": iso, "reason": str(exc)})
            except ValueError as exc:
                result["missing"].append({"date": iso, "reason": str(exc)})
            time.sleep(1)
        secondary = {}
        if not secondary_denied:
            try:
                secondary = read_naver_history(isin, today, days)
                result["secondaryState"] = "RETRIEVED"
            except AccessDenied as exc:
                secondary_denied = True
                result["secondaryState"] = str(exc)
            except ValueError as exc:
                result["secondaryState"] = str(exc)
        else:
            result["secondaryState"] = "SKIPPED_AFTER_ACCESS_DENIAL"
        result["rows"] = [{"date": d, "nav": str(v)} for d, v in sorted(primary.items())]
        result["crosscheck"] = reconcile_candidate(primary, secondary, days[-1].isoformat())
        report["funds"].append(result)
    # Even a successful archive is NOT an authorization to use its rows in
    # a Writer. A missing recent weekday can be a holiday or publication lag;
    # the report records it without declaring the portfolio complete.
    report["archiveComplete"] = all(
        f["anchorState"] == "MATCH"
        and f["crosscheck"]["state"] == "CROSSCHECK_MATCHED"
        and f["crosscheck"]["latestRequestedWeekdayPresent"]
        for f in report["funds"])
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report["archiveComplete"] else 1


def self_test():
    day = ANCHOR
    isin = FUNDS[0][1]
    def row(code=isin, stamp="20261116", price="2,025.10"):
        return f"<selectMeta><tmpV12>{code}</tmpV12><tmpV14>{stamp}</tmpV14><tmpV4>20140101</tmpV4><tmpV6>{price}</tmpV6></selectMeta>"
    def xml(*rows):
        return ("<message><DISCondFuncListDTO>" + "".join(rows) + "</DISCondFuncListDTO></message>").encode()
    assert extract_nav(xml(row("WRONG"), row()), isin, day) == Decimal("2025.10")
    assert extract_nav(("<DISCondFuncListDTO>" + row() + "</DISCondFuncListDTO>").encode(), isin, day) == Decimal("2025.10")
    for body, error in (
        (xml(row("WRONG")), "EXACT_CLASS_NOT_FOUND"),
        (xml(row(stamp="20261113")), "EXACT_DATE_MISMATCH"),
        (xml(row(stamp="")), "EXACT_DATE_MISMATCH"),
        (xml(row(), row()), "EXACT_CLASS_NOT_UNIQUE"),
        (xml(row(price="0")), "PRICE_INVALID"),
        (xml(row(price="NaN")), "PRICE_INVALID"),
        (b"<html/>", "RESPONSE_NOT_MESSAGE"),
        (b"<response/>", "RESPONSE_NO_GRID_response"),
        (b"<!DOCTYPE message><message/>", "XML_UNSAFE_OR_TOO_LARGE"),
    ):
        try:
            extract_nav(body, isin, day)
        except ValueError as exc:
            assert str(exc) == error, str(exc)
        else:
            raise AssertionError(error)
    req = ET.fromstring(request_body("A&B", day))
    assert req.findtext("DISCondFuncDTO/tmpV12") == "A&B"
    assert req.findtext("DISCondFuncDTO/tmpV30") == "20261116"
    assert previous_weekday(dt.date(2026, 11, 23)) == dt.date(2026, 11, 20)
    naver = lambda code, price: json.dumps({"fundCode": code, "prices": [
        {"tradeDate": "2026-11-16", "basePrice": price, "taxPrice": 2000}]}).encode()
    evidence = naver_price_evidence(naver(isin, "2,025.10"), isin, day)
    assert evidence["candidateValues"] == {"basePrice": "2025.10"}
    assert evidence["identityEvidence"] == "RESPONSE_CODE_MATCH"
    try:
        naver_price_evidence(naver("WRONG", "2025.10"), isin, day)
    except ValueError as exc:
        assert str(exc) == "RESPONSE_CLASS_MISMATCH"
    else:
        raise AssertionError("RESPONSE_CLASS_MISMATCH")
    assert naver_price_evidence(b'{"prices":[]}', isin, day)["status"] == "EXACT_DATE_NOT_UNIQUE_OR_MISSING"
    assert completed_weekdays(dt.date(2026, 11, 23)) == [dt.date(2026, 11, d) for d in range(16, 21)]
    history = naver_history(naver(isin, "2,025.10"), isin, [day])
    assert history == {day.isoformat(): Decimal("2025.10")}
    a = {"2026-11-16": Decimal("1"), "2026-11-17": Decimal("2"), "2026-11-18": Decimal("3")}
    assert reconcile_candidate(a, a, "2026-11-18")["state"] == "CROSSCHECK_MATCHED"
    assert reconcile_candidate(a, {"2026-11-16": Decimal("1")}, "2026-11-18")["state"] == "INSUFFICIENT_OVERLAP"
    assert reconcile_candidate(a, {**a, "2026-11-17": Decimal("9")}, "2026-11-18")["state"] == "CONFLICT"
    assert not reconcile_candidate(a, a, "2026-11-19")["latestRequestedWeekdayPresent"]
    print("KOFIA_AND_NAVER_NAV_PROBE_SELF_TEST_PASS")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--naver", action="store_true")
    parser.add_argument("--archive", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    elif args.archive:
        sys.exit(run_archive())
    elif args.naver:
        sys.exit(run_naver_probe())
    else:
        sys.exit(run_probe())
