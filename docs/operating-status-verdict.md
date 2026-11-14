# #734 — Single daily operating verdict (manual, read-only)

Last reviewed: 2026-11-15 KST. Applies to the \`main\` workflow
[Portfolio daily operating verdict (READ ONLY)](../.github/workflows/portfolio-daily-ops-readonly.yml).

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
