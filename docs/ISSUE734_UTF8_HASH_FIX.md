# Issue #734 — GAS 9.296 UTF-8 trade hashes

Production evidence from main read-only run 43833775189 (GAS 9.295): all 338 API trade records matched the native sheet by stable ID and field, with zero differences. Both the server ledger revision and physical preview source digest exactly matched SHA-256 after non-ASCII characters were replaced with question marks; neither matched UTF-8. Published immutable version 352 matched approved source blob a360a32a2d459d1f28dee94365a28d8c3ca24367. No financial source writes were performed. Private records and comparison digests are intentionally excluded.

The two-argument Utilities.computeDigest overload was the cause. The browser uses UTF-8 through TextEncoder. Earlier test doubles assumed UTF-8 for the unspecified server charset and concealed the mismatch.

9.296 explicitly selects Utilities.Charset.UTF_8 only for trade row CAS hashes and ledger revisions. The legacy global digest remains unchanged to preserve existing receipts and migration-derived IDs. The composer asserts exactly those two existing functions changed and one digest helper was added; other business functions are unchanged apart from release version markers. Candidate source blob: e7dfcc8a1ad194e4a0ef586b83b7df66a83dd2c6.

Release requires the existing manual workflow, exact source approval, deployment inventory and idle writer preflight. Post-deploy read-only checks require 338 unique IDs, browser/server revision agreement and physical preview agreement, in addition to existing financial state checks. Bounded retries perform reads only. No save retry or hash bypass is introduced.

Pending: merged CI, protected dry-run, production deployment, live UTF-8 readback and actual PC valuation query. Code tests alone do not establish production success.
