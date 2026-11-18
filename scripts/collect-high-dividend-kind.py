"""Read-only KIND public data probe. Never changes portfolio or tax eligibility."""
import argparse
import hashlib
import json
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright
from urllib.parse import urlparse, parse_qs
from io import BytesIO
from html.parser import HTMLParser
import re
import openpyxl
import xlrd

def read_rows(data):
    """Read the downloaded spreadsheet, not an error page or arbitrary table."""
    if data.startswith(b"PK"):
        book = openpyxl.load_workbook(BytesIO(data), read_only=True, data_only=True)
        try:
            return [[str(c if c is not None else "").strip() for c in row] for row in book.worksheets[0].values]
        finally:
            book.close()
    if data.startswith(bytes.fromhex("D0CF11E0A1B11AE1")):
        book = xlrd.open_workbook(file_contents=data)
        sheet = book.sheet_by_index(0)
        return [[str(c).strip() for c in sheet.row_values(i)] for i in range(sheet.nrows)]
    class TableParser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.rows, self.row, self.cell = [], None, None
        def handle_starttag(self, tag, attrs):
            if tag == "tr":
                self.row = []
            elif tag in ("td","th") and self.row is not None:
                self.cell = []
        def handle_data(self, data):
            if self.cell is not None:
                self.cell.append(data)
        def handle_endtag(self, tag):
            if tag in ("td","th") and self.cell is not None:
                self.row.append("".join(self.cell).strip())
                self.cell = None
            elif tag == "tr" and self.row is not None:
                self.rows.append(self.row)
                self.row = None
    for encoding in ("utf-8-sig","cp949"):
        try:
            parser = TableParser()
            parser.feed(data.decode(encoding))
            return parser.rows
        except UnicodeError:
            continue
    raise RuntimeError("Spreadsheet encoding not recognized")

# Exact workbook schema observed in the official 2025-business-year export.
EXPECTED_COLUMNS = ["번호", "시장구분", "회사명", "공시제목", "사업연도", "결산월", "배당성향(%)", "이익배당금증가율(%)"]

def validate_candidate_rows(header, entries, year, displayed_count):
    compact = lambda s: re.sub(r"\s+", "", str(s))
    if [compact(c) for c in header] != EXPECTED_COLUMNS:
        raise RuntimeError("KIND source schema changed")
    if len(entries) != displayed_count or displayed_count <= 0:
        raise RuntimeError("KIND screen/export source counts disagree or are empty")
    names = set()
    for i, row in enumerate(entries, 1):
        if len(row) != len(header) or not re.fullmatch(str(i)+r"(?:\.0)?",compact(row[0])):
            raise RuntimeError("KIND export row order/schema mismatch")
        market, name, title = row[1:4]
        if market not in ("유가", "코스닥") or not name or "기업가치" not in compact(title):
            raise RuntimeError("KIND issuer/market/disclosure missing")
        if name in names:
            raise RuntimeError("KIND duplicate issuer name; identity review required")
        names.add(name)
        if compact(row[4]) not in (str(year), str(year)+".0", str(year)+"년"):
            raise RuntimeError("KIND business year mismatch")
    return len(names)

# These rows only serve as a change detector for the manually reviewed
# candidate/reference layer. They do not establish security-level eligibility.
WATCH_2025 = {
    "삼성전자": ["유가", "기업가치 제고 계획(자율공시)", "12", "25.1", "13.2"],
    "SK": ["유가", "기업가치 제고 계획(자율공시)(고배당기업 표시를 위한 재공시)", "12", "27.6", "14.3"],
}

def review_candidates(entries, year):
    if year != 2025:
        return {"state": "CANDIDATE_ONLY", "comparison": "NO_REVIEW_BASELINE", "changes": []}
    by_name = {row[2]:row for row in entries}
    changes = []
    for name, expected in WATCH_2025.items():
        row = by_name.get(name)
        if row is None:
            changes.append({"name":name,"state":"MISSING_FROM_CURRENT_LIST"})
            continue
        actual = [row[1],row[3],row[5],row[6],row[7]]
        try:
            same = actual[:2] == expected[:2] and all(Decimal(a) == Decimal(b) for a,b in zip(actual[2:],expected[2:]))
        except InvalidOperation:
            same = False
        if not same:
            changes.append({"name":name,"state":"DISCLOSURE_ROW_CHANGED"})
    return {"state":"REVIEW_REQUIRED" if changes else "CANDIDATE_ONLY",
            "comparison":"ROW_CHANGE_DETECTOR_ONLY", "changes":changes}

def request_parameters(req):
    params = parse_qs(urlparse(req.url).query)
    params.update(parse_qs(req.post_data or ""))
    return params


URL = "https://kind.krx.co.kr/valueup/dividend.do?method=valueupHighDividendMain"

def unique_visible(locator, description):
    visible = [item for item in locator.all() if item.is_visible()]
    if len(visible) != 1:
        raise RuntimeError(f"{description}: expected one visible control, found {len(visible)}")
    return visible[0]

CORP_URL = "https://kind.krx.co.kr/corpgeneral/corpList.do?method=loadInitPage"

def normalize_market(raw):
    return {"유가":"KOSPI","유가증권":"KOSPI","유가증권시장":"KOSPI",
            "코스닥":"KOSDAQ","코스닥시장":"KOSDAQ","코넥스":"KONEX","코넥스시장":"KONEX"}.get(re.sub(r"\s+","",str(raw)))

def normalize_code(raw):
    value=str(raw).strip()
    if re.fullmatch(r"\d{1,6}(?:\.0)?",value):
        return value.split(".")[0].zfill(6)
    if re.fullmatch(r"\d{5}[A-Z]",value):
        return value
    return None

def join_listed_issuers(entries, corp_rows):
    # Exact issuer name and market only. Name similarity, preferred-share
    # suffixes, and missing market information cannot establish identity.
    aliases = {"name": {"회사명"}, "market": {"시장구분","시장"}, "code": {"종목코드"}}
    headers = []
    for i,row in enumerate(corp_rows[:20]):
        compact=[re.sub(r"\s+","",c) for c in row]
        indexes = {k:[j for j,c in enumerate(compact) if c in v] for k,v in aliases.items()}
        if all(len(v)==1 for v in indexes.values()):
            headers.append((i,{k:v[0] for k,v in indexes.items()}))
    if len(headers)!=1:
        print("Listed corporations header preview:",json.dumps(corp_rows[:4],ensure_ascii=False),flush=True)
        raise RuntimeError("KIND listed corporation columns not identified")
    index,cols=headers[0]
    by_name, by_code = {}, {}
    valid=0
    for row in corp_rows[index+1:]:
        if not any(row):
            continue
        if len(row)<=max(cols.values()):
            raise RuntimeError("KIND listed corporation row truncated")
        name=row[cols["name"]].strip()
        market=normalize_market(row[cols["market"]])
        code=normalize_code(row[cols["code"]])
        if not name or not market or not code:
            raise RuntimeError("KIND listed corporation identity format invalid")
        valid+=1
        key=(market,name)
        by_name.setdefault(key,set()).add(code)
        by_code.setdefault(code,set()).add(key)
    if valid<1000:
        raise RuntimeError("Listed corporation master appears incomplete")
    matched,unresolved=[],[]
    for row in entries:
        name=row[2].strip()
        market=normalize_market(row[1])
        codes=by_name.get((market,name),set())
        if len(codes)==1:
            code=next(iter(codes))
            if len(by_code[code])==1:
                matched.append({"issuerName":name,"market":market,"listedCode":code,
                                "businessYear":int(float(row[4].removesuffix("년"))),
                                "disclosureTitle":row[3],"identityState":"EXACT_LISTED_ISSUER",
                                "taxEligibility":"UNVERIFIED"})
                continue
        unresolved.append({"issuerName":name,"market":market,
                           "reason":"AMBIGUOUS" if codes else "NOT_IN_CURRENT_MASTER"})
    if len(matched)+len(unresolved)!=len(entries):
        raise RuntimeError("Candidate coverage mismatch")
    return {"classification":"CANDIDATE_ONLY","source":CORP_URL,
            "listedMasterRows":valid,"matched":matched,"unresolved":unresolved}

def collect_corp_index(browser, entries, out):
    page=browser.new_page(locale="ko-KR",accept_downloads=True)
    try:
        response=page.goto(CORP_URL,wait_until="domcontentloaded",timeout=60000)
        if response is None or not response.ok:
            raise RuntimeError("KIND listed corporations unavailable")
        page.get_by_text("상장법인목록",exact=True).last.wait_for(state="visible")
        excel=unique_visible(page.locator('a[title="EXCEL"],button[title="EXCEL"]'),"Listed corporation Excel")
        with page.expect_download(timeout=60000) as info:
            excel.click()
        dl=info.value
        filename="listed-corporations-"+Path(dl.suggested_filename).name
        raw=out/filename
        dl.save_as(raw)
        data=raw.read_bytes()
        result=join_listed_issuers(entries,read_rows(data))
        result["retrievedAt"]=datetime.now(ZoneInfo("Asia/Seoul")).isoformat()
        result["masterSha256"]=hashlib.sha256(data).hexdigest()
        (out/"candidate-index.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
        print("KIND identity reconciliation:",json.dumps({"masterRows":result["listedMasterRows"],
               "matched":len(result["matched"]),"unresolved":len(result["unresolved"]),
               "classification":result["classification"]},ensure_ascii=False),flush=True)
        return result
    finally:
        page.screenshot(path=str(out/"kind-listed-screen.png"),full_page=True)
        page.close()

def collect(year, out):
    out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(locale="ko-KR", accept_downloads=True)
        try:
            response = page.goto(URL, wait_until="domcontentloaded", timeout=60000)
            if response is None or response.status >= 400:
                raise RuntimeError(f"KIND landing response: {response.status if response else 'none'}")
            page.get_by_text("고배당기업 현황", exact=True).last.wait_for(state="visible")
            candidates = []
            for select in page.locator("select:visible").all():
                for option in select.locator("option").all():
                    if option.inner_text().strip().rstrip("년").strip() == str(year):
                        candidates.append((select, option.get_attribute("value")))
            if len(candidates) != 1 or not candidates[0][1]:
                raise RuntimeError(f"Business-year selection ambiguous: {len(candidates)} matches")
            select, value = candidates[0]
            select.select_option(value=value)
            # Use the actual publicly served UI; no guessed download endpoint.
            # The live page exposes the query controls by title, not button text.
            # The global header search uses an input alt and is not our query.
            search = unique_visible(page.locator('a[title="검색"], button[title="검색"]'), "KIND list Search")
            excel = unique_visible(page.locator('a[title="EXCEL"], button[title="EXCEL"]'), "KIND list Excel")
            # Only wait for the search response, not unrelated live traffic.
            year_field = select.get_attribute("name")
            if not year_field:
                raise RuntimeError("Business-year parameter not identified")
            def is_year_response(res):
                req = res.request
                u = urlparse(res.url)
                return (u.hostname == "kind.krx.co.kr" and u.path == "/valueup/dividend.do"
                        and "valueupHighDividendSub" in request_parameters(req).get("method", [])
                        and value in request_parameters(req).get(year_field, []))
            seen = []
            def observe(res):
                u = urlparse(res.url)
                if u.hostname == "kind.krx.co.kr" and u.path.endswith(".do"):
                    seen.append({"path":u.path, "method":request_parameters(res.request).get("method", []), "status":res.status, "parameterNames":sorted(request_parameters(res.request))})
            page.on("response", observe)
            try:
                with page.expect_response(is_year_response, timeout=45000) as search_info:
                    search.click()
                search_res = search_info.value
                if not search_res.ok:
                    raise RuntimeError(f"Search HTTP {search_res.status}")
                search_res.finished()
            finally:
                print("KIND requests:",json.dumps(seen,ensure_ascii=False),flush=True)
            if select.input_value() != value:
                raise RuntimeError("Business-year selection changed")
            # Archive the original public file; no company-name-only tax joins.
            with page.expect_download(timeout=60000) as download_info:
                excel.click()
            download = download_info.value
            filename = Path(download.suggested_filename).name
            raw = out / filename
            download.save_as(raw)
            data = raw.read_bytes()
            if len(data) < 128:
                raise RuntimeError("Download too small")
            if not (data.startswith(b"PK") or data.startswith(bytes.fromhex("D0CF11E0A1B11AE1")) or
                    b"<table" in data[:10000].lower()):
                raise RuntimeError("Download is not a recognized spreadsheet")
            rows = read_rows(data)
            # Keep the exact source columns rather than guessing codes or years.
            # The header must identify both the issuer and the business year.
            def compact(x):
                return re.sub(r"\s+", "", x)
            headers = [(i,row) for i,row in enumerate(rows[:20]) if
                       any("회사명" in compact(c) or "기업명" in compact(c) or "법인명" in compact(c) or "종목명" in compact(c) for c in row)
                       and any("사업연도" in compact(c) for c in row)]
            if len(headers) != 1:
                print("Spreadsheet header preview:",json.dumps(rows[:4],ensure_ascii=False),flush=True)
                raise RuntimeError("Official spreadsheet header schema not identified")
            index, header = headers[0]
            year_cols = [i for i,c in enumerate(header) if "사업연도" in compact(c)]
            if len(year_cols) != 1:
                raise RuntimeError("Business-year column ambiguous")
            year_col = year_cols[0]
            entries = [row for row in rows[index+1:] if any(row)]
            if not entries:
                raise RuntimeError("No source rows; cannot establish current coverage")
            if any(len(row)<=year_col or not re.fullmatch(str(year)+r"(?:\.0|년)?",compact(row[year_col])) for row in entries):
                print("Business-year values:",json.dumps(sorted({row[year_col] if len(row)>year_col else "" for row in entries}),ensure_ascii=False),flush=True)
                raise RuntimeError("Downloaded business-year rows do not match selected year")
            # Independently validate the rendered total and the complete export.
            # The source screen currently labels the count "전체 631건 : 1/43".
            page.wait_for_function(r"""n => [...document.body.innerText.matchAll(/전체\s*([\d,]+)\s*건\s*:/g)].some(m => Number(m[1].replace(/,/g,'')) === n)""",
                                   arg=len(entries), timeout=20000)
            displayed_totals = re.findall(r"전체\s*([\d,]+)\s*건\s*:",page.locator("body").inner_text())
            if len(displayed_totals)!=1:
                raise RuntimeError("KIND rendered total ambiguous")
            displayed_count = int(displayed_totals[0].replace(",",""))
            unique_count = validate_candidate_rows(header, entries, year, displayed_count)
            candidate_review = review_candidates(entries, year)
            (out / "candidate-review.json").write_text(json.dumps(candidate_review,ensure_ascii=False,indent=2),encoding="utf-8")
            (out / "candidate-source.json").write_text(json.dumps({"businessYear":year,"columns":header,"rows":entries,"classification":"CANDIDATE_ONLY"},ensure_ascii=False,indent=2),encoding="utf-8")
            print("KIND spreadsheet schema:",json.dumps(header,ensure_ascii=False),flush=True)
            metadata = {
                "source": URL, "businessYear": year, "rowCount":len(entries), "screenCount":displayed_count,
                "uniqueIssuerNames":unique_count, "reviewState":candidate_review["state"],
                "retrievedAt": datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
                "fileName": filename, "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "classification": "CANDIDATE_ONLY",
                "eligibilityVerified": False,
                "note": "KIND business year can differ from eligibility year. Latest disclosure can be corrected. No automatic tax exclusion.",
            }
            (out / "source-metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps(metadata, ensure_ascii=False), flush=True)
            print("KIND candidate review:",json.dumps(candidate_review,ensure_ascii=False),flush=True)
            if candidate_review["state"] == "REVIEW_REQUIRED":
                raise RuntimeError("Official candidate row changed; reviewed payment evidence must be checked")
            collect_corp_index(browser,entries,out)
        finally:
            page.screenshot(path=str(out / "kind-screen.png"), full_page=True)
            browser.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, default=2025)
    parser.add_argument("--out", type=Path, default=Path("kind-source"))
    args = parser.parse_args()
    if not 2024 <= args.year <= 2029:
        parser.error("business year outside supported source range")
    collect(args.year, args.out)
