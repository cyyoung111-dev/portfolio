"""Read-only KIND public data probe. Never changes portfolio or tax eligibility."""
import argparse
import hashlib
import json
from datetime import datetime
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
                return u.hostname == "kind.krx.co.kr" and u.path.endswith(".do") and value in request_parameters(req).get(year_field, [])
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
            (out / "candidate-source.json").write_text(json.dumps({"businessYear":year,"columns":header,"rows":entries,"classification":"CANDIDATE_ONLY"},ensure_ascii=False,indent=2),encoding="utf-8")
            print("KIND spreadsheet schema:",json.dumps(header,ensure_ascii=False),flush=True)
            metadata = {
                "source": URL, "businessYear": year, "rowCount":len(entries),
                "retrievedAt": datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
                "fileName": filename, "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "classification": "CANDIDATE_ONLY",
                "eligibilityVerified": False,
                "note": "KIND business year can differ from eligibility year. Latest disclosure can be corrected. No automatic tax exclusion.",
            }
            (out / "source-metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps(metadata, ensure_ascii=False), flush=True)
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
