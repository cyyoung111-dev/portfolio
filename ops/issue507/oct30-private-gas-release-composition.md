# Issue #507 — 2026-10-30 KRX private GAS release package source-only rehearsal

## Scope

PR #801 was squash-merged to `main` as `559e8247885ba651a20a1d3175a07e5dd6a2e036`. PR #802 was then restacked onto that main as a single follow-up commit, preserving only its four intended source/test/documentation changes. The new HEAD requires fresh CI and Codex review before merge.

- Frozen production GAS Git blob: `9c1a5f31d1abc4b44f7da9af7a50fe3f15967134`.
- Source-only candidate functions: `_issue507Oct30PrivateQuoteProof_`, `_issue507Oct30PrivateLiveReadOnlyProof_`, `_issue507Oct30GuardedPrivateReadOnlyRun_`.
- The composer verifies that frozen source exactly matches the pinned blob; the three functions are not already in production; no doGet/doPost handler includes them; the candidate contains no sheet writes, token mutation, network fetch direct calls or script deployment instructions; and the combined source parses under V8.
- `scripts/check-issue507-oct30-gas-release-composition.mjs` executes a complete **synthetic** private flow with real frozen GAS trade reducers, real `getCodeItems`, real `_getDailyHeldCodeItems`, **real `fetchPricesKrx`**, and the three candidate functions. Only external KRX market packs / credentials / spreadsheets are simulated and never fetched. The test checks 37 held codes, fund NAV 2, actual-day KRX price presence, source labels and 10/30 carry state. It rejects missing/late codes, wrong trade sides, missing credentials, bad NAV, stale KRX packs, and returns counts only.
- This test is a rehearsal of source composition and business logic, **not proof that a live KRX request, GAS grant or spreadsheet backup would succeed**.
- Source candidate is kept in memory. It is not written to `src/gas/apps_script.gs`, Apps Script deployments, web/API handlers, environment secrets, Google Sheets or a release artifact. CI output contains no individual holdings, prices, credentials or generated candidate source.

## Critical actual release constraints

1. **The current `gas-deploy.yml` has automatic release eligibility on trusted main Quality success** when `GAS_AUTO_DEPLOY_ENABLED=true`, and the deployment environment is `portfolio-production-gas`. Merging a future commit that changes `src/gas/apps_script.gs` could trigger a real GAS release depending on the environment settings. Do not infer opt-in state from the workflow code, and do not merge any production GAS change before verifying the live variable and a separately approved manual-only deployment policy.
2. The current production access-token helper `_isAuthorizedRequest` still allows requests when its common token is empty. **Never attach the private function to doGet/doPost**, regardless of any private token checks. The source-only guard validates an independently configured 10-minute reusable key and checks nonempty legacy access_token, but it does not establish an operator identity, one-time authorization, or external writer exclusivity.
3. Real GAS script properties `issue507_oct30_private_probe_enabled`, `issue507_oct30_private_probe_secret`, `issue507_oct30_private_probe_expires_at_ms` must not be created, rotated or logged without explicit deployment approval. No private key should appear in GitHub Actions arguments, logs, issues or web responses.
4. The production `_issue507GateEnter_` blocks ordinary calls when gate mode is `DRAINING`. A read-only proof running through existing GAS admission under `OPEN` is not a protected financial writer. This source rehearsal provides no 555-writer fence, ScriptLock, backup, rollback or authorization for later recovery writes.
5. `fetchPricesKrx(held,date)` is one *top-level function call*, but can issue several KRX market and OTP HTTP requests. The present integration test replaces those calls with synthetic KRX packs. Actual 37 individual close values have **not been fetched**, published or stored.
6. A future authorized deployment must pin a single reviewed GAS source, use an explicitly approved read-only manual operator route, verify log redaction and expiration, run one protected real official KRX exact-date proof, then disable that path. A second, separately approved financial write proposal is required for the 37 price histories and 37 Snapshot valuations.

## Completion markers

- Source-only build: test can pass; `authorizedToRunInProduction=false`.
- Live private proof: **not executed**.
- GAS production deploy: **not executed**.
- Financial source writes: **0**.
- Issue #507: remains unresolved until real protected read, selective repair, full two-sheet readback, and fund/other-date invariants have been verified.
