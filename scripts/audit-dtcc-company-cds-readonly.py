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
# Error and correction events can invalidate a previously disseminated price.
# A later contractual termination or routine lifecycle modification does NOT
# erase the historical fact that the original trade took place.
INVALIDATING_ACTIONS = {"CORR", "EROR"}
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
        if present(row, "Action type") in INVALIDATING_ACTIONS:
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
            "status": "ISSUER_REFERENCE_UNMAPPED" if symbol not in ISSUERS
                      else ("PROVISIONAL_TRANSACTION_SPREAD_NOT_PAR_QUOTE"
                      if matches else "NO_QUALIFYING_REPORTED_TRANSACTION"),
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


def select_archive_history(index, as_of, max_files=15):
    if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", as_of):
        raise ValueError("INVALID_DATE")
    if not isinstance(max_files, int) or not 1 <= max_files <= 120:
        raise ValueError("INVALID_HISTORY_LIMIT")
    entries = index.get("SEC_CR") if isinstance(index, dict) else None
    if not isinstance(entries, list):
        raise ValueError("DTCC_INDEX_SCHEMA_UNVERIFIED")
    dated = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        name = entry.get("fileName")
        full = entry.get("fullFilePath")
        if not isinstance(name, str) or not re.fullmatch(
            r"SEC_CUMULATIVE_CREDITS_20\d{2}_\d{2}_\d{2}\.zip", name
        ):
            continue
        if full != SOURCE_HOST + name:
            continue
        day = name[-14:-4].replace("_", "-")
        try:
            dt.date.fromisoformat(day)
        except ValueError:
            continue
        if day > as_of:
            continue
        if day in dated and dated[day] != full:
            raise ValueError("DTCC_INDEX_DUPLICATE_DATE")
        dated[day] = full
    dates = sorted(dated, reverse=True)[:max_files]
    if not dates or dates[0] != as_of:
        raise ValueError("DTCC_ASOF_ARCHIVE_NOT_PUBLISHED")
    return [(day, dated[day]) for day in reversed(dates)]


def assemble_history_archives(named_archives):
    # Identical report re-dissemination may appear across days. But the same
    # dissemination ID with conflicting data is a hard failure.
    seen = {}
    for _day, archive in named_archives:
        for row in read_archive(archive):
            ident = present(row, "Dissemination Identifier")
            if not ident or not ident.isdecimal():
                raise ValueError("DTCC_ID_UNVERIFIED")
            if ident in seen:
                if row != seen[ident]:
                    raise ValueError("DTCC_CONFLICTING_REPORT_REDISSEMINATION")
            else:
                seen[ident] = row
        if len(seen) > 350_000:
            raise ValueError("DTCC_TOO_MANY_COMBINED_RECORDS")
    return list(seen.values())


def trade_median_comparison(observations, target_days=30):
    # Comparison of actual reported contract-spread medians, never a dealer
    # market close or fully standardized CDS par spread. Sparse days are null.
    if not observations:
        return None
    current = observations[-1]
    latest = dt.date.fromisoformat(current["date"])
    target = latest - dt.timedelta(days=target_days)
    alternatives = []
    for obs in observations[:-1]:
        day = dt.date.fromisoformat(obs["date"])
        distance = abs((day - target).days)
        if distance <= 3:
            alternatives.append((distance, day, obs))
    if not alternatives:
        return None
    # Exact target first, closest date next, earlier date on ties.
    alternatives.sort(key=lambda x: (x[0], x[1]))
    prior = alternatives[0][2]
    return {
        "basis": "REPORTED_CONTRACT_TRADE_MEDIAN_NOT_PAR_EOD",
        "targetDays": target_days,
        "sourceDate": prior["date"],
        "targetDate": target.isoformat(),
        "asOfDate": current["date"],
        "changeBp": round(
            current["medianReportedContractBp"] - prior["medianReportedContractBp"], 2
        )
    }


def summarize_history(named_archives, as_of):
    if not named_archives:
        raise ValueError("NO_ARCHIVES")
    rows = assemble_history_archives(named_archives)
    days = [x[0] for x in named_archives]
    observed = {ticker: [] for ticker in ALL}
    for day in days:
        daily = get_candidates(rows, day)
        for ticker in ALL:
            accepted = daily.get(ticker, [])
            if not accepted:
                continue
            median = statistics.median(
                sorted(x["reportedContractSpreadBp"] for x in accepted)
            )
            observed[ticker].append({
                "date": day, "count": len(accepted),
                "medianReportedContractBp": float(median)
            })
    return {
        "mode": "DTCC_SEC_CDS_ROLLING_TRADE_HISTORY_READ_ONLY",
        "sourceArchiveDays": len(days), "firstArchiveDate": days[0],
        "lastArchiveDate": days[-1], "recordsDedupedById": len(rows),
        "reportedObservationDays": [
            {"symbol": ticker, "days": len(observed[ticker]),
             "lastObserved": observed[ticker][-1] if observed[ticker] else None,
             "month1TradeMedianComparison": trade_median_comparison(observed[ticker]),
             "quarter3TradeMedianComparison": trade_median_comparison(observed[ticker],91),
             "year1TradeMedianComparison": trade_median_comparison(observed[ticker],365)}
            for ticker in ALL
        ],
        "history": observed,
        "dealerParQuotesVerified": 0,
        "futureCorrectionsNotYetKnown": True,
        "portfolioWrites": 0, "telegramSends": 0, "gasDeployments": 0
    }


def run_history(as_of, max_files=15):
    url = "https://kgc0418-tdw-data-0.s3.amazonaws.com/dashboard/Cumulative.json"
    with urllib.request.urlopen(url, timeout=20) as response:
        index_text = response.read(4_000_001)
    if len(index_text) >= 4_000_001:
        raise ValueError("DTCC_INDEX_TOO_LARGE")
    index = json.loads(index_text)
    selected = select_archive_history(index, as_of, max_files)
    archives = []
    for date, path in selected:
        with urllib.request.urlopen(path, timeout=25) as response:
            contents = response.read(MAX_DOWNLOAD)
        archives.append((date, contents))
    return summarize_history(archives, as_of)


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
    assert len(get_candidates([first, row("1008", action="MODI", original="1001")], date)["GOOGL"]) == 1
    assert len(get_candidates([first, row("1012", action="TERM", original="1001")], date)["GOOGL"]) == 1
    assert len(get_candidates([first, row("1013", action="CORR", original="1001")], date)["GOOGL"]) == 0
    assert get_candidates([row("1009", red="WRONG1")], date)["GOOGL"] == []
    assert get_candidates([row("1010", notation="4", spread="87")], date)["GOOGL"][0]["reportedContractSpreadBp"] == 87
    assert get_candidates([row("1011", notation="4", spread="-87")], date)["GOOGL"] == []
    assert summarize([first], date)["dealerParQuotesVerified"] == 0
    assert summarize([first], date)["issuers"][0]["status"] == "ISSUER_REFERENCE_UNMAPPED"
    assert summarize([first], date)["issuers"][2]["status"] == "PROVISIONAL_TRANSACTION_SPREAD_NOT_PAR_QUOTE"
    # Public index selection rejects foreign hosts, duplicate dates and
    # refuses to imply a report exists before it is actually available.
    prefix = "SEC_CUMULATIVE_CREDITS_"
    index = {"SEC_CR": [
        {"fileName": prefix+"2026_11_04.zip",
         "fullFilePath": SOURCE_HOST+prefix+"2026_11_04.zip"},
        {"fileName": prefix+"2026_11_05.zip",
         "fullFilePath": SOURCE_HOST+prefix+"2026_11_05.zip"},
        {"fileName": prefix+"2026_11_06.zip",
         "fullFilePath": "https://untrusted.example/"+prefix+"2026_11_06.zip"}
    ]}
    selected = select_archive_history(index, date, 5)
    assert [day for day, _ in selected] == ["2026-11-04", "2026-11-05"]
    try:
        select_archive_history(index, "2026-11-06", 5)
        raise AssertionError("unpublished date was accepted")
    except ValueError:
        pass

    def zipped(day, rows):
        csv_buffer = io.StringIO()
        fieldnames = list(row("1981"))
        writer = csv.DictWriter(csv_buffer, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("SEC_CUMULATIVE_CREDITS_"+day.replace("-", "_")+".csv",
                       csv_buffer.getvalue())
        return payload.getvalue()
    prior = row("2001")
    prior["Execution Timestamp"] = "2026-11-04T12:22:48Z"
    prior["Spread-Leg 1"] = "0.0075"
    current = row("2002")
    correction = row("2003", action="CORR", original="2001")
    archives = [("2026-11-04", zipped("2026-11-04", [prior])),
                ("2026-11-05", zipped("2026-11-05", [current, correction]))]
    hist = summarize_history(archives, date)
    alphabet = hist["history"]["GOOGL"]
    assert len(alphabet) == 1 and alphabet[0]["date"] == date
    assert alphabet[0]["medianReportedContractBp"] == 87
    assert hist["futureCorrectionsNotYetKnown"] is True
    assert hist["dealerParQuotesVerified"] == 0
    assert hist["reportedObservationDays"][2]["month1TradeMedianComparison"] is None
    dense = [{"date": "2026-10-05", "medianReportedContractBp": 94},
             {"date": "2026-10-06", "medianReportedContractBp": 100},
             {"date": "2026-10-07", "medianReportedContractBp": 95},
             {"date": "2026-11-05", "medianReportedContractBp": 87}]
    comparison = trade_median_comparison(dense)
    assert comparison["sourceDate"] == "2026-10-06"
    assert comparison["changeBp"] == -13
    assert comparison["basis"] == "REPORTED_CONTRACT_TRADE_MEDIAN_NOT_PAR_EOD"
    assert trade_median_comparison(dense,91) is None
    assert trade_median_comparison(dense,365) is None
    a_year_ago = [{"date":"2025-11-05","medianReportedContractBp":81},
                  {"date":"2026-11-05","medianReportedContractBp":87}]
    assert trade_median_comparison(a_year_ago,365)["changeBp"] == 6


    print("DTCC_SEC_TRADE_PARSER_SELFTEST_PASS")


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--selftest"]:
            selftest()
        elif len(sys.argv) == 2:
            print(json.dumps(run_live(sys.argv[1]), ensure_ascii=False, separators=(",", ":")))
        elif len(sys.argv) == 4 and sys.argv[1] == "--history":
            print(json.dumps(run_history(sys.argv[2], int(sys.argv[3])),
                             ensure_ascii=False, separators=(",", ":")))
        else:
            raise ValueError("USAGE: YYYY-MM-DD|--selftest|--history YYYY-MM-DD LIMIT")
    except Exception as exc:
        # Do not log URLs with secret tokens (this fixed-source module has none).
        print("DTCC_SEC_TRADE_AUDIT_UNVERIFIED:" + type(exc).__name__)
        sys.exit(1)
