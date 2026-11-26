# #734 — Single daily operating verdict (manual, read-only)

Last reviewed: 2026-11-15 KST. Applies to the \`main\` workflow
[Portfolio daily operating verdict (READ ONLY)](../.github/workflows/portfolio-daily-ops-readonly.yml).

## 2026-11-15 — Viewer live GAS version warning correction

- Live protected GAS nightly read [#43643936591](https://github.com/cyyoung111-dev/portfolio/actions/runs/43643936591) returned `gasVersion=9.294`, `overallStatus=NORMAL`, while the browser `settings_fetch.js` bounded compatibility array stopped at `9.287`. The successful `bootstrapGsheetSettings()` check in `settings.js` would therefore show a **spurious version-mismatch/redeploy toast**.
- Keep the checked-in GAS baseline `EXPECTED_GAS_VERSION='9.285'` exactly as required by staged release integrity and historical audit; add only independently observed `9.294` to `COMPATIBLE_GAS_VERSIONS`. No assertion that 9.288–9.293 or unapproved future versions are safe. Unknown versions retain existing warning. The fix is UI-only and does not alter GAS source or deployed GAS, Sheet data, price, NAV, Snapshot, writer gates or workflow schedules.
- Required CI regression protects the staged baseline, live allowlist, unknown-version warning path, no duplicates and historical 9.286 source preview. Mobile/PC PWA update requires versioned JS URL + service-worker cache revision when source changes.

## External authorization and writer-ownership exceptions (2026-11-15)

- Google Apps Script process OAuth scope and KRX listing metadata approval need independent permissions. Both live diagnostics are manual-only; offline CI remains active. The OAuth workflow is now itself **manual-only** (removed redundant PR/push source-check jobs): its test already runs in required `quality-check` on every PR/main push, with manual source-check before the protected OAuth stage. Code changes do NOT grant provider permissions.
- Browser trade-ledger CAS and GAS ScriptLock do NOT establish atomic cross-client Snapshot updates for identical `(date,code)` against out-of-band owner-authorized Sheets writes. Owner-only sharing cannot prove other owner sessions are idle. Keep Snapshot full reconciliation and independent writer-ownership verification `NOT_FULLY_AUDITED`; no financial mutations.

## Purpose / scope

One manual audit of the last KRX trading session, with **NO new recurring
schedule**, no private financial writes, no GAS deployment and no Telegram sends.
Do not confuse success of \`quality-check\`, \`pages\`, a public-only source job,
a skipped job or \`gas-deploy validate\` with delivery of financial results.

| Output | Independent evidence | Not certified by this output |
| --- | --- | --- |
| Morning Telegram | Same-run CLAIM+SENT, main workflow succeeded, time 07:40–08:10 KST | Telegram app UI/read receipt |
| Close Telegram | Same-run CLAIM+SENT, main workflow succeeded, time 17:00–18:00 KST | User actually opened message |
| KB NAV | Exact published KB class NAV, stored exact NAV, derived row & official preview, for target date | Hanwha/Fidelity NAV and brokerage account balance |
| Persisted CLOSE | GAS \`COMPLETE\`, \`priceOk\`, \`fundOk\`, persisted checkpoint date/staleness validation | Independent 39/39 per-row Snapshot and trade-ledger/broker reconciliation |
| Snapshot | \`NOT_FULLY_AUDITED\` until dedicated current 39-row readback | Never silently promoted from \`close.state\` |

\`PASS\` applies only to the stated scope. The overall status is
\`CORE_CHECKPOINTS_VERIFIED_SNAPSHOT_UNAUDITED\` **not** a claim that the entire
portfolio is reconciled. A manual audit exits nonzero if required evidence is
not yet present; missing API permission stays evidence-missing rather than
being classified as a data corruption.

\`PUBLICATION_PENDING\` is different from confirmed stored NAV and from
GitHub job success. A green runner means execution only, and a source-public
push run with private jobs skipped cannot satisfy NAV. Any use of the NAV
workflow run list is for *execution diagnostics only*.

## Operating cadence

- Morning 07:40–08:10 KST: prefer actual Telegram CLAIM+SENT.
- Close 17:00–18:00 KST: prefer actual Telegram CLAIM+SENT.
- NAV regular schedules 09:30, 18:10, 19:17 weekdays; two independent
  fallback checks at 10:20 and 20:30 weekdays only.
- GAS close after 19:00 KST, with date-scoped readback; no blind Writer retries.
- The manual daily verdict can be invoked AFTER source deadlines. Run it only
  for targeted validation; do not add another cron until source & alert semantics
  are evaluated on at least one fully observed trading day.
- Weekends and official KRX holidays never mean new domestic NAV, new
  daily KRX source price or a Saturday/Sunday official exchange session.
  Previous valid trading day is used for retrospective reporting, and the
  output always shows that date explicitly.

## Backlog / planned simplification (no deletion yet)

1. **Already installed now:** manual read-only operational verdict plus tests.
2. Next: use one *date-scoped* receipt model across all providers without
   treating job success as provider-published financial data.
3. After an actual Monday trading-day run: review the 5 morning and 6 close
   backup slots, retain independent arming, remove redundant slots only with
   verified no-regression delivery evidence.
4. **Done:** remove the KRX 52-week T+1 source `workflow_run` from
   NAV admission. Actual 2026-11-14 05:58 KST KRX-triggered NAV completed
   with 0 KB imports and 0 Hanwha imports while official 11/13 KB NAV was
   not yet published. Independent 09:30/18:10/19:17 weekday NAV cron slots,
   protected 10:20/20:30 independent fallback and manual dispatch remain.
   The next actual business-day stored NAV readback still requires verification.
5. **Cleanup phase 2:** reviewed issue-only workflow dependencies and the last
   800 main Actions runs. Removed two more duplicate **synthetic-only** wrappers
   for Snapshot date-scoped and ledger fingerprint safety. Seven total retired:
   93 workflow files remain with 38 Issue-derived names. Both safety checks
   remain directly mandatory in `check:ci` and deletion is enforced by CI;
   plus one Oct 31–anchored audit with an expired 14-day window was retired.
   Its original run evidence remains in `ops/issue507/postmerge-actions-evidence.md`
   and the offline rerun-attempt test remains mandatory in `check:ci`.
   No financial writer, public-source collector, recovery, or OAuth scope
   diagnostics were removed. Never bulk-delete manual financial recovery or
   date-scoped forensic source investigation scripts.
6. External heartbeat/dead-man switch is optional, not a prerequisite for
   reliable financial close. It should monitor on-time evidence, not
   merely receipt of any GitHub green status.

## Quick operation

Open [Actions](https://github.com/cyyoung111-dev/portfolio/actions)
and run **Portfolio daily operating verdict (READ ONLY)** from \`main\`.
Output is an allowlisted JSON status and a GitHub Step Summary.
It does not print NAV amounts, portfolio positions, Telegram token,
chat identifiers or GAS response bodies.

A missing due-date proof deliberately fails the read-only audit workflow,
but **does not trigger a trade, NAV import, GAS deploy or Telegram retry**.
Restore trusted source/permission evidence before considering any
production code change.


## 2026-11-16 — Read-only Daily Snapshot full-date reconciliation

- Existing `portfolio-daily-ops-readonly` manual verdict now optionally checks one exact KRX date via GAS `diagnoseSnapshotIntegrityRange(strictReadonly=1)` and `getHistoryDetail`. It compares the whole stored vs expected code sets, expected/stored/retrieved row counts, duplicates, quantity/cost/evaluation/unit/source mismatches and source-data errors. **No fixed 39-row assumption:** current holdings determine cardinality.
- Only call when same-date GAS close is fully confirmed and daily NAV has reached the evidence window; do not race the 19:00 Writer, schedule a new cron or modify the original record. On missing/error responses preserve `NOT_FULLY_AUDITED`; never call a Writer, retry finance persist or claim an error-free transaction from a green workflow.
- Only an independent external Writer exclusion and an independently validated price/NAV source can attest transaction isolation. A new result `CORE_AND_SNAPSHOT_INTERNAL_VERIFIED_WRITER_UNAUDITED` means *internal stored-vs-recomputed reconciliation only*, not production writer-owner audit.
- Fully sanitized output: no holdings, account strings, codes, monetary values, tokens, GAS errors or private source digests in CI/workflow logs. Required CI contract exercises live request wiring with synthetic fixtures and fail-closed incomplete/duplicate/changed-date/mismatched group cases.

## 2026-11-27 — 양 자동수집 펀드 독립 운영감사

- 기존 일일 판정은 KB F00002 단독 증빙으로 CORE 정상 판정이 가능했습니다. 한화 F00001의 정확한 공개 클래스/일자, 저장 NAV 및 파생평가 일치 증빙을 별도 `hanwhaNav`로 확인하며, 두 펀드 모두 검증돼야 CORE 정상입니다. F00003은 수동 NAV 대상이며 자동수집 성공 분모에 추가하지 않습니다. 동일 GAS 마감 상태 읽기는 공유하며 두 펀드별 원천/저장/파생 증빙은 독립입니다. 원천 실패나 공표 대기는 PASS가 아닙니다.
- KOFIA 공개 기준가의 개인 비상업적 출처 명시 사용에 관한 근거: [2026-09-10 개정 규정 제8-8조·제8-9조](https://law.kofia.or.kr/service/law/lawFullScreenContent.do?historySeq=1811&seq=136). 상업적 사용에는 사전 승인 등 조건이 있으며 공개 DIS 웹 인터페이스의 자동조회 지원/허용 계약은 별도 확인 필요. 기존 후보의 실제 GAS preview는 읽기 전용 검증에 한정합니다. KOFIA/Naver 동일 날짜 교차대사 누락 행을 저장하거나 기존 Writer 보호를 우회하지 않습니다.
- 기존 수동 운영감사 실행 계약, 예약, 금융 Writer 및 GAS 배포 불변. 실제 운영 검증은 CI와 별도입니다.
