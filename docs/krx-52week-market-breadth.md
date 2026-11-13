# KRX 52-week market breadth — 252 trading-session data contract

## Purpose and boundaries

This pipeline computes the **number of individual KOSPI and KOSDAQ stocks making a strictly new 52-week intraday high or low** from 252 complete, validated KRX stock-daily OHLC sessions. This is not the same as:
- a price/52-week range for an index, VIX, or seven selected assets;
- a one-day KRX advance/decline (A/D) count;
- an official exchange-published market-wide high/low count.

`scripts/krx-52week-market.mjs` requires an *exact* 252-session window in both markets, uniquely dated and without hidden holidays or duplicates. Today's high must **exceed** the maximum high from the previous 251 market sessions to count as a new high; today's low must be **below** the previous 251-session minimum to count as a new low. Ties are not counted. Only stocks with all 251 historical daily OHLC observations are eligible: recent listings, suspensions and changed identifiers are excluded from counts. The output identifies the eligible and excluded universe. Values are **raw KRX OHLC, not corporate-action-adjusted**; do not present them as split-adjusted or a KRX-certified market statistic.

## Incremental source-only collector

Workflow: [`.github/workflows/krx-52week-history.yml`](../.github/workflows/krx-52week-history.yml).

- Main-only, protected existing `KRX_AUTH_KEY`; accepts only KRX official KOSPI stock and KOSDAQ stock daily routes. No GAS URL/token, user positions, account data or Telegram token.
- Each completed **date-pair** is validated together; no partial market/date mixing.
- Fetches at most **60 still-missing sessions** per main push or scheduled execution, or 12/30/60 on manual dispatch. Rate-limit/auth responses stop the batch. On a fully populated 252-day window the normal run fetches **zero** historical date pairs; next KRX open-day publication rolls the window by one.
- The GitHub repository is **public** and the KRX OPEN API terms prohibit redistribution of data received from KRX. Starting with the reviewed sealed-source migration, `krx-52week-archive` stores **only authenticated AES-256-GCM-encrypted, gzip-compressed raw OHLC** (`history.k52e`) plus a derived audit summary (60-day retention). Runner-local plaintext history is NEVER uploaded. The existing protected `KRX_AUTH_KEY` derives the archive key via HKDF without adding another external service or secret; **rotate the KRX key only after the latest archive is re-sealed or backed up**, otherwise old ciphertext becomes unreadable. A compromised source key also compromises historic ciphertext.
- The migration permits precisely one known prior validated plaintext artifact run **#43433853869**, then all future runs must authenticate and decrypt the sealed archive. Earlier public plaintext artifacts are **not automatically deleted** by this update; they require an independently verified retention/cleanup decision and should not be described as already removed. No commits or workbook writes.
- **One scheduled source-only run at 23:30 KST Monday–Friday.** The previous 18:40 daily poll was redundant because daily KRX Open API is T+1: 11/13 21:28 KST live proof returned HTTP 200 and zero rows for all five 11/13 stock/index routes, but verified 11/12 source. Removing 18:40 also avoids waking the existing NAV workflow around the 19:00 portfolio-close critical section. GitHub schedule is best-effort; its failure remains a **shared scheduling failure domain**, not an independently guaranteed backup.
- The release-eligible count is **the prior completed KRX open session, after 08:15 KST on its next KRX open day**. Friday data first becomes eligible Monday morning (unless KRX holiday); source responses still must match exact published dates. No same-day 17:00 KRX VKOSPI or turnover is inferred.
- Existing archive validation failure stops the run; it does **not** silently reset history and publish false counts.
- Before the full 252-day source archive exists, the result is explicitly `HISTORY_INCOMPLETE`, with `markets=null`; zero or last-known values must never replace missing history.
- Calendar: production GAS-confirmed KRX holiday map for 2026/2027; the narrow 2025 October–December overlap uses reviewed dates including the 2025-12-31 KRX year-end closure. Dates outside the reviewed calendar fail closed.

## Raw-OHLC quality audit (diagnostic, not adjusted values)

A complete source window is **necessary but insufficient** for an adjusted
market-wide 52-week high/low statistic. The source-only collector now emits
`quality.status=RAW_DISCONTINUITY_REVIEW_REQUIRED` only after 252/252 source
dates pass. For each market it reports:

- `observedToday`, `eligible`, `eligiblePct` and `shortHistory`:
  short-history/suspended/new codes are excluded from a *continuous 251-session*
  historical high/low test, and this denominator is disclosed.
- `discontinuityCodes`: eligible securities with a raw close-to-close move
  exceeding **31% in absolute value** anywhere in the 252-day window. This
  flags a **potential price-basis discontinuity**, not a verified share split,
  rights adjustment or corporate event. A 30% limit-day move does not trigger
  it. The 31% threshold is a conservative *screen*, not a reconstruction.
- `flaggedHighs`, `flaggedLows`, and `flaggedExtremes`: which counted raw
  extrema require further action/source investigation. Public stock codes and
  the date/direction of the last suspicious change are recorded; no price
  adjustments or source-derived share counts are invented.

**Verified 2026-11-12 raw baseline:** 252 complete sessions, KOSPI eligible
793/911 (87.0%), KOSDAQ 1366/1753 (77.9%). Eligible names with a raw >31%
session: KOSPI 6, KOSDAQ 29. Suspect raw newly-low counts: KOSPI 1,
KOSDAQ 2. These are *candidates to investigate*, not three certified corporate
actions or an authorization to subtract three and call the remaining 47
fully adjusted. The primary raw 52-week counts remain unchanged; **Telegram
integration stays disabled** until separate official corporate-action/adjusted
price comparison and universe methodology are verified.

## 2026-11-13 #4 methodology decision — raw source complete, official adjusted breadth NOT certified

- **Completed:** KRX Open API source-only 252/252 observed sessions and
  reproducible 31%-jump/eligible-universe quality audit. Real raw highs/lows:
  KOSPI 4/25, KOSDAQ 6/25 on 2026-11-12. Never promote this to an
  *adjusted market-wide 52-week* high/low value or 17:00 Telegram.
- **Verified caution examples:** 009140 2026-10-20 bonus-issue ex-rights,
  290650 2026-10-26 bonus-issue ex-rights, and 475460 2026-09-16
  bonus-issue ex-rights correspond to three flagged raw new lows.
  See https://alphasquare.co.kr/home/stock-issue?code=009140&type=disclosure ,
  https://www.bosoop.com/disclosures/20261023900853/ ,
  https://dartbrief.com/disclosures/20260915900714 .
  **Do not compute an adjusted result by simply subtracting three.**
  Not all 35 suspicious returns are confirmed corporate actions; smaller
  rights impacts can occur without exceeding the 31% screen.
- **Official source limitation:** daily raw-OHLC KRX OPEN API does not expose
  split-adjusted historical prices. KRX Data Marketplace historical
  period-range screens offer an adjusted-price option, but their output
  must be separately licensed/approved; do not scrape or silently substitute
  a source/asset without a verified permission, identifier, as-of, history
  adjustment factor and value/market reconciliation.
- **Universe choice:** continuous 251 preceding sessions excludes 118/911
  KOSPI and 387/1753 KOSDAQ current-session codes. The 22.1% KOSDAQ
  exclusion makes it unfit as a market-wide breadth label. Distinguish
  new listings, trading halts, code changes, delistings and corporate actions
  using confirmed listing/event references before redefining the denominator.
- **Done means:** approved adjusted high+low histories for each eligible
  security or official equivalent provider counts; certified time basis
  through the latest T+1 release; verified 52-week rule/universe including
  IPOs; exact source/date comparison and permitted redistribution.
  Without that full evidence the existing source-only gate and diagnostic
  are the final responsible state. This is a **blocked data-source
  dependency**, not a daily portfolio/GAS reconciliation failure.

## Operational proof required before briefing integration

1. Source-only workflow run and archive pass for both markets; inspect the **actual API response** schemas (especially KRX daily high/low) and API failure codes.
2. **Completed 2026-11-13**: source-only run #43427452090 restored 248 and fetched the last four pairs, proving 252/252 official raw OHLC market sessions (2025-11-03–2026-11-12). Preserve the real historical range and distinct eligible/excluded universe. Continue to independently compare an adjusted 52-week high/low benchmark where possible; full dates alone do not certify market-wide adjusted breadth.
3. Validate impact of splits, consolidations and ticker changes before describing this as a market-wide fully adjusted statistic.
4. Only then optionally connect the dated summary to the 07:40/17:00 Telegram formatter with source/quality badges, without slowing primary delivery or reopening the current close/NAV writer.

The workflow itself **does not** deploy GAS, change the portfolio/financial ledger, send Telegram, or authorize a synthetic 52-week count.
