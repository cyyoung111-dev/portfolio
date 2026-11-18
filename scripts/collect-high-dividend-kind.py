"""Read-only KIND public data probe. Never changes portfolio or tax eligibility."""
import argparse
import hashlib
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright, TimeoutError as BrowserTimeout

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
            def control(label):
                matches = page.get_by_text(label, exact=True).or_(
                    page.get_by_role("button", name=label, exact=True)
                ).or_(page.get_by_role("link", name=label, exact=True)).or_(
                    page.locator(f'input[value="{label}"], a[title="{label}"], button[title="{label}"], img[alt="{label}"]')
                )
                # Accessibility name may come from a nested icon. Prefer clickable ancestors.
                clickable = matches.locator("xpath=ancestor-or-self::*[self::a or self::button or self::input][1]")
                try:
                    return unique_visible(clickable, label)
                except RuntimeError:
                    print("Public controls:", page.locator("a:visible,button:visible,input:visible").evaluate_all(
                        "(els)=>els.map(e=>({text:(e.innerText||'').trim().slice(0,80),title:e.title,alt:e.getAttribute('alt'),value:e.value,images:[...e.querySelectorAll('img')].map(i=>i.alt)})).filter(e=>e.text||e.title||e.alt||e.value||e.images.length).slice(-100)"), flush=True)
                    raise
            search = control("검색")
            excel = control("EXCEL")
            search.click()
            try:
                page.wait_for_load_state("networkidle", timeout=20000)
            except BrowserTimeout:
                raise RuntimeError("Search completion not established")
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
            metadata = {
                "source": URL, "businessYear": year,
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
