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
    if tag_name(root.tag) != "message":
        raise ValueError("RESPONSE_NOT_MESSAGE")
    values = []
    for elem in root.iter():
        if tag_name(elem.tag) != "selectMeta":
            continue
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

def self_test():
    day = ANCHOR
    isin = FUNDS[0][1]
    def row(code=isin, stamp="20261116", price="2,025.10"):
        return f"<selectMeta><tmpV12>{code}</tmpV12><tmpV14>{stamp}</tmpV14><tmpV4>20140101</tmpV4><tmpV6>{price}</tmpV6></selectMeta>"
    def xml(*rows):
        return ("<message><DISCondFuncListDTO>" + "".join(rows) + "</DISCondFuncListDTO></message>").encode()
    assert extract_nav(xml(row("WRONG"), row()), isin, day) == Decimal("2025.10")
    for body, error in (
        (xml(row("WRONG")), "EXACT_CLASS_NOT_FOUND"),
        (xml(row(stamp="20261113")), "EXACT_DATE_MISMATCH"),
        (xml(row(stamp="")), "EXACT_DATE_MISMATCH"),
        (xml(row(), row()), "EXACT_CLASS_NOT_UNIQUE"),
        (xml(row(price="0")), "PRICE_INVALID"),
        (xml(row(price="NaN")), "PRICE_INVALID"),
        (b"<html/>", "RESPONSE_NOT_MESSAGE"),
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
    print("KOFIA_DIS_NAV_PROBE_SELF_TEST_PASS")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        sys.exit(run_probe())
