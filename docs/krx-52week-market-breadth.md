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
- Fetches at most 12 sessions at kickoff, 24 per scheduled execution, or 12/30/60 for supervised manual dispatch. Rate-limit/auth responses stop the batch.
- Uses an existing GitHub Actions public-source artifact `krx-52week-archive` as the carry-forward state and uploads a new validated artifact (60-day retention). No commits or workbook writes.
- Two source-only schedules at **18:40 and 23:30 KST**. GitHub schedule is best-effort. Historical backfill is incremental, not a 504-call spike in a 17:00 Telegram delivery.
- Existing archive validation failure stops the run; it does **not** silently reset history and publish false counts.
- Before the full 252-day source archive exists, the result is explicitly `HISTORY_INCOMPLETE`, with `markets=null`; zero or last-known values must never replace missing history.
- Calendar: production GAS-confirmed KRX holiday map for 2026/2027; the narrow 2025 October–December overlap uses reviewed dates including the 2025-12-31 KRX year-end closure. Dates outside the reviewed calendar fail closed.

## Operational proof required before briefing integration

1. Source-only workflow run and archive pass for both markets; inspect the **actual API response** schemas (especially KRX daily high/low) and API failure codes.
2. Accumulate 252 complete dates, verify unique securities, date coverage and number of excluded suspended/new issues; compare results independently with a reputable historical high/low reference where possible.
3. Validate impact of splits, consolidations and ticker changes before describing this as a market-wide fully adjusted statistic.
4. Only then optionally connect the dated summary to the 07:40/17:00 Telegram formatter with source/quality badges, without slowing primary delivery or reopening the current close/NAV writer.

The workflow itself **does not** deploy GAS, change the portfolio/financial ledger, send Telegram, or authorize a synthetic 52-week count.
