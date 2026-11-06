#!/usr/bin/env python3
"""DTCC SEC credit transaction observations (NOT a 5Y dealer-par CDS close).

Strict, no-account-write public-tape probe. Uses a fixed DTCC S3 object, bounded
ZIP decompression, issuer RED + underlier + UPI FISN + action and date guards.
Does NOT calculate model-equivalent spread from cash/upfront payments. Does NOT
treat a reported contract leg spread as a daily dealer mid quote.
"""
import csv
import datetime as dt
import io
import json
import re
import statistics
import sys
import urllib.request
import zipfile
from decimal import Decimal, InvalidOperation

SOURCE_HOST = "https://kgc0418-tdw-data-0.s3.amazonaws.com/sec/eod/"
MAX_DOWNLOAD = 8_000_000
MAX_UNPACKED = 20_000_000
MAX_ROWS = 100_000
ISSUERS = {
    "GOOGL": ("0C27GT", "ALPHABET"),
    "META": ("UZEAAG", "META PLATFORMS"),
    "NVDA": ("6D76CM", "NVIDIA"),
    "ORCL": ("6EC42L", "ORACLE"),
}
ALL = ("MSFT", "AAPL", "GOOGL", "AMZN", "META", "NVDA", "MU",
       "ORCL", "SNDK", "005930", "000660")
LINK_ACTIONS = {"CORR", "EROR", "MODI", "TERM", "NOVA", "AMND"}
TRUTHY = {"TRUE", "Y", "YES", "1"}
MAX_BP = Decimal("5000")


def parse_utc(value):
    try:
        if not value:
            return None
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    except (ValueError, TypeError):
        return None


def present(row, name):
    return str(row.get(name) or "").strip()


def strictly_false(row, name):
    return present(row, name).upper() in ("FALSE", "N", "NO", "0")


def to_bp(row):
    raw = present(row, "Spread-Leg 1")
    notation = present(row, "Spread notation-Leg 1")
    if notation not in {"3", "4"}:
        return None
    try:
        value = Decimal(raw)
    except (InvalidOperation, ValueError):
        return None
    if not value.is_finite():
        return None
    bp = value * Decimal(10000) if notation == "3" else value
    if not Decimal("0") < bp <= MAX_BP:
        return None
    return bp


def read_archive(source):
    if len(source) >= MAX_DOWNLOAD:
        raise ValueError("DTCC_ARCHIVE_TOO_LARGE")
    with zipfile.ZipFile(io.BytesIO(source)) as archive:
        names = archive.namelist()
        if len(names) != 1 or not re.fullmatch(
            r"SEC_CUMULATIVE_CREDITS_\d{4}_\d{2}_\d{2}\.csv", names[0]
        ):
            raise ValueError("DTCC_ARCHIVE_MEMBER_UNVERIFIED")
        info = archive.getinfo(names[0])
        if info.file_size > MAX_UNPACKED:
            raise ValueError("DTCC_UNPACKED_TOO_LARGE")
        with archive.open(info) as fd:
            reader = csv.DictReader(
                io.TextIOWrapper(fd, encoding="utf-8-sig", newline="")
            )
            required = {
                "Dissemination Identifier", "Original Dissemination Identifier",
                "Action type", "Event type", "Execution Timestamp",
                "Effective Date", "Expiration Date", "Spread-Leg 1",
                "Spread notation-Leg 1", "Underlier ID source-Leg 1",
                "Underlier ID-Leg 1", "Underlying Asset Name", "UPI FISN",
                "Notional currency-Leg 1", "Package indicator",
                "Non-standardized term indicator", "Custom basket indicator"
            }
            if not required.issubset(set(reader.fieldnames or [])):
                raise ValueError("DTCC_REQUIRED_COLUMNS_MISSING")
            rows = []
            for index, row in enumerate(reader):
                if index >= MAX_ROWS:
                    raise ValueError("DTCC_TOO_MANY_ROWS")
                rows.append(row)
    return rows


def root_id(row_id, by_id):
    current = row_id
    for _ in range(24):
        row = by_id.get(current)
        if row is None:
            return current
        parent = present(row, "Original Dissemination Identifier")
        if not parent:
            return current
        if parent == current:
            return None
        current = parent
    return None


def get_candidates(rows, trade_date):
    if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", trade_date):
        raise ValueError("INVALID_TRADE_DATE")
    by_id = {}
    for row in rows:
        current = present(row, "Dissemination Identifier")
        if not current or not current.isdecimal() or current in by_id:
            raise ValueError("DTCC_DUPLICATE_OR_MISSING_ID")
        by_id[current] = row
    affected = set()
    for row in rows:
        if present(row, "Action type") in LINK_ACTIONS:
            parent = present(row, "Original Dissemination Identifier")
            if parent:
                affected.add(root_id(parent, by_id))
    output = {}
    for ticker, (red, name) in ISSUERS.items():
        accepted = []
        for row in rows:
            if present(row, "Underlier ID source-Leg 1") != "REDID":
                continue
            if present(row, "Underlier ID-Leg 1") != red:
                continue
            if name not in present(row, "Underlying Asset Name").upper():
                continue
            if present(row, "UPI FISN") != "NA/CDS Corp SN Sr":
                continue
            if present(row, "Action type") != "NEWT":
                continue
            if present(row, "Event type") != "TRAD":
                continue
            id_ = present(row, "Dissemination Identifier")
            if id_ in affected:
                continue
            if present(row, "Original Dissemination Identifier"):
                continue
            if present(row, "Notional currency-Leg 1") != "USD":
                continue
            if not all(
                strictly_false(row, field) for field in (
                    "Package indicator", "Non-standardized term indicator",
                    "Custom basket indicator")
            ):
                continue
            execution = parse_utc(present(row, "Execution Timestamp"))
            maturity = parse_utc(present(row, "Expiration Date"))
            if execution is None or maturity is None:
                continue
            if execution.date().isoformat() != trade_date:
                continue
            remain = (maturity - execution).total_seconds() / 86400 / 365.25
            if not 4.4 <= remain <= 5.6:
                continue
            bp = to_bp(row)
            if bp is None:
                continue
            accepted.append({
                "tradeId": id_, "reportedContractSpreadBp": bp,
                "hasOtherPaymentAmount": bool(present(row, "Other payment amount")),
                "referenceId": red, "sourceNotation": present(row, "Spread notation-Leg 1"),
                "remainingYears": round(remain, 3)
            })
        output[ticker] = accepted
    return output


def summarize(rows, date):
    by_company = get_candidates(rows, date)
    result = []
    for symbol in ALL:
        matches = by_company.get(symbol, [])
        amounts = sorted(x["reportedContractSpreadBp"] for x in matches)
        midpoint = statistics.median(amounts) if amounts else None
        result.append({
            "symbol": symbol, "candidateCount": len(matches),
            "preliminaryReportedContractMedianBp": float(midpoint) if midpoint is not None else None,
            "containsOtherPaymentAmount": any(x["hasOtherPaymentAmount"] for x in matches),
            "status": "PROVISIONAL_TRANSACTION_SPREAD_NOT_PAR_QUOTE"
                      if matches else "NO_CONFIRMED_REPORTED_TRANSACTION",
            "parCdsCloseVerified": False,
            "correctionWindow": "SINGLE_DAILY_ARCHIVE_ONLY"
        })
    return {
        "mode": "DTCC_SEC_5Y_TRADE_PROVISIONAL_READ_ONLY",
        "tradeDate": date, "rowsInspected": len(rows), "issuerCount": len(ALL),
        "matchedIssuers": sum(x["candidateCount"] > 0 for x in result),
        "dealerParQuotesVerified": 0,
        "correctionLookbackVerified": False,
        "issuers": result, "portfolioWrites": 0,
        "telegramSends": 0, "gasDeployments": 0
    }


def run_live(date):
    if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", date):
        raise ValueError("INVALID_TRADE_DATE")
    url = SOURCE_HOST + "SEC_CUMULATIVE_CREDITS_" + date.replace("-", "_") + ".zip"
    with urllib.request.urlopen(url, timeout=30) as response:
        source = response.read(MAX_DOWNLOAD)
    return summarize(read_archive(source), date)


def selftest():
    # Do not use real Yahoo/Bloomberg quotes or user account information.
    date = "2026-11-05"
    def row(identifier, action="NEWT", original="", spread="0.0087",
            notation="3", red="0C27GT", flags="FALSE"):
        return {
            "Dissemination Identifier": identifier,
            "Original Dissemination Identifier": original,
            "Action type": action, "Event type": "TRAD",
            "Execution Timestamp": "2026-11-05T12:22:48Z",
            "Effective Date": "2026-11-06", "Expiration Date": "2031-12-20",
            "Spread-Leg 1": spread, "Spread notation-Leg 1": notation,
            "Notional currency-Leg 1": "USD",
            "Underlier ID source-Leg 1": "REDID", "Underlier ID-Leg 1": red,
            "Underlying Asset Name": "Alphabet Inc.", "UPI FISN": "NA/CDS Corp SN Sr",
            "Package indicator": flags, "Non-standardized term indicator": "FALSE",
            "Custom basket indicator": "false", "Other payment amount": "35.00"
        }
    first = row("1001")
    assert len(get_candidates([first], date)["GOOGL"]) == 1
    assert str(get_candidates([first], date)["GOOGL"][0]["reportedContractSpreadBp"]) == "87.0000"
    assert not get_candidates([row("1002", spread="0.0087", notation="1")], date)["GOOGL"]
    assert get_candidates([row("1003", spread="NaN")], date)["GOOGL"] == []
    assert get_candidates([row("1004", flags="TRUE")], date)["GOOGL"] == []
    assert get_candidates([row("1005", action="MODI")], date)["GOOGL"] == []
    assert get_candidates([first, row("1006", action="CORR", original="1001")], date)["GOOGL"] == []
    assert get_candidates([first, row("1007", action="EROR", original="1001")], date)["GOOGL"] == []
    assert get_candidates([first, row("1008", action="MODI", original="1001")], date)["GOOGL"] == []
    assert get_candidates([row("1009", red="WRONG1")], date)["GOOGL"] == []
    assert get_candidates([row("1010", notation="4", spread="87")], date)["GOOGL"][0]["reportedContractSpreadBp"] == 87
    assert get_candidates([row("1011", notation="4", spread="-87")], date)["GOOGL"] == []
    assert summarize([first], date)["dealerParQuotesVerified"] == 0
    print("DTCC_SEC_TRADE_PARSER_SELFTEST_PASS")


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--selftest"]:
            selftest()
        elif len(sys.argv) == 2:
            print(json.dumps(run_live(sys.argv[1]), ensure_ascii=False, separators=(",", ":")))
        else:
            raise ValueError("USAGE: audit-dtcc-company-cds-readonly.py YYYY-MM-DD|--selftest")
    except Exception as exc:
        # Do not log URLs with secret tokens (this fixed-source module has none).
        print("DTCC_SEC_TRADE_AUDIT_UNVERIFIED:" + type(exc).__name__)
        sys.exit(1)
