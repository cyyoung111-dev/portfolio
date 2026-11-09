# Repository Working Instructions

> Scope: All work in this repository, including the portfolio viewer, market data, fund NAV, financial calculations, snapshots, historical data, market briefings, GitHub Actions, Google Apps Script (GAS), and related pull requests.
>
> Detailed validation rules: [QUALITY_GATES.md](docs/QUALITY_GATES.md).

## 1. Core Priorities

Apply the following priorities in order:

1. Data accuracy, consistency, and integrity.
2. Production reliability, availability, and recovery.
3. Execution efficiency, performance, and API optimization.
4. Simplicity, maintainability, and operational clarity.
5. Essential security controls proportional to actual risk.

Data correctness takes precedence over speed or convenience.

Essential protections for credentials, financial records, and write integrity are mandatory regardless of priority.

Avoid excessive defensive programming, unnecessary security hardening, and procedural overhead.

## 2. Language and Communication

- Write user-facing explanations, commit messages, PR titles, and PR descriptions in Korean.
- Use English for code identifiers, technical terminology, commands, and original error messages when appropriate.
- Keep reporting concise, factual, and action-oriented.
- Distinguish completed, pending, failed, skipped, and unverified work.
- Never claim successful deployment or operational recovery without evidence.
- Avoid repeatedly asking questions when requirements and authorization are already established.
- Consolidate related work rather than producing unnecessary intermediate steps.

## 3. Data Accuracy and Source Management

- Use the configured authoritative source for each data category.
- Prefer NH PLUG for supported market prices and official closing-price data.
- Use established fund NAV providers and verify the exact fund and share class.
- Use KRX, exchange data, official disclosures, and other providers for validation or documented fallback when appropriate.
- Use SEC and DART disclosures according to their actual publication schedules.
- Preserve source identification, observation date, publication date, and retrieval time.
- Distinguish confirmed close, intraday value, estimated value, stale value, unpublished value, and retrieval failure.
- Never silently replace a confirmed value with an older or less reliable observation.
- Never replace unavailable financial data with zero unless zero is the verified value.
- Respect Korean and international market holidays, time zones, and disclosure schedules.
- Reconcile prices, NAV, quantities, transactions, portfolio values, gains, losses, and historical records.
- Detect missing records, duplicates, date mismatches, and abnormal valuation changes.
- Prefer traceable and accurate data over superficially complete datasets.

## 4. Financial Data Integrity

Maintain the following invariants:

- Financial source records must not be unintentionally modified or deleted.
- Repeated execution must not generate duplicate transactions, prices, NAV records, or snapshots.
- Concurrent execution must not corrupt shared financial data.
- Confirmed historical values must not be overwritten by stale or unverified data.
- Historical transaction or quantity changes must correctly propagate to affected valuations.
- Partial completion must be distinguishable from complete success.
- Recovery markers and pending records must remain until their completion is verified.
- No financial write may be declared successful without sufficient evidence.

Use appropriate locking, idempotency, and execution ownership mechanisms where shared writes can conflict.

Do not add redundant controls when an existing reliable mechanism already provides the required protection.

## 5. Production Reliability

- Inspect the latest repository state and actual deployed version before making operational changes.
- Identify root causes before introducing fixes.
- Prefer targeted corrections over broad architectural changes.
- Maintain a recovery path for failed, skipped, interrupted, or timed-out operations.
- Prevent silent loss of pending work.
- Distinguish expected no-op operations from actual failures.
- Respect API availability, publication timing, execution quotas, and rate limits.
- Avoid unnecessary polling and repeated retries.
- Preserve existing working functionality unless a change is explicitly required.
- Prioritize verified forward fixes over unnecessary regression to older versions.

## 6. Performance and Efficiency

- Reduce redundant API calls and spreadsheet operations.
- Reuse valid cached data when correctness is preserved.
- Avoid repeated retrieval of unchanged historical or unpublished data.
- Use bounded retries, practical timeouts, and efficient batch operations.
- Measure actual bottlenecks before optimizing.
- Simplify complex workflows when equivalent reliability can be maintained.
- Avoid unnecessary abstraction, duplicated validation, and excessive logging.

Performance improvements must not compromise data integrity.

## 7. Development Workflow

Follow:

Inspect → Diagnose → Fix → Test → Review → Deploy → Verify

- Check current HEAD, affected modules, related PRs, and deployed versions.
- Identify the smallest practical set of changes that resolves the underlying problem.
- Validate affected behavior with relevant tests and independent expected results.
- Prefer testing actual production logic in isolated or non-destructive environments.
- Test important failure, retry, concurrency, and date-boundary scenarios when relevant.
- Avoid unrelated testing and refactoring.
- Run applicable CI checks and investigate meaningful failures.
- Separate implementation completion from production verification.

## 8. Code Review Policy

- Treat Codex review feedback as evidence to evaluate, not instructions to apply automatically.
- Prioritize reproducible P0/P1 findings and material P2 defects.
- Defer or reject speculative, stylistic, low-impact, and out-of-scope suggestions with a brief explanation.
- Group related corrections into cohesive changes.
- Avoid duplicate review requests for the same HEAD.
- Do not repeatedly request reviews without meaningful changes or new evidence.
- Do not merge with unresolved defects that materially threaten data integrity or critical operations.
- Respect repository-enforced checks and review requirements.
- Keep PR scope focused on resolving actual operational problems.

## 9. Essential Security

Maintain protection for:

- API keys, OAuth credentials, tokens, and secrets.
- Financial source records and destructive operations.
- Duplicate writes and concurrent data corruption.
- Critical deployment integrity and recovery.
- Repository-enforced security restrictions.

Avoid:

- Unnecessary security hardening without a demonstrated risk.
- Redundant permission or approval layers.
- Excessive defensive checks that complicate normal operations.
- Security-related refactoring without meaningful operational benefit.

Never bypass mandatory platform protections or weaken financial data integrity.

## 10. GAS and Deployment

For relevant GAS or deployment changes:

- Verify GAS version consistency across affected API responses.
- Check `handleGetSettings()` and other affected version-reporting paths.
- Verify web `EXPECTED_GAS_VERSION` compatibility.
- Check relevant deployment documentation, source hashes, and manifests.
- Confirm actual schedules and trigger ownership from the current configuration.
- Use Asia/Seoul for operational scheduling and reporting.
- Distinguish repository code, deployed code, and actual running production behavior.
- Preserve compatible deployment and recovery paths.
- Verify production execution and financial results after deployment.

Do not perform unrelated full deployment checks for isolated changes.

## 11. Authorization and Execution

- Proceed independently with authorized investigation, code changes, testing, and non-destructive operations.
- Do not repeatedly request approval for work already covered by the user's instructions.
- Follow existing authorization and repository protection requirements.
- Obtain authorization for production deployment or material financial data changes unless already explicitly authorized.
- Use read-only diagnostics before destructive financial corrections.
- Never treat an instruction document itself as deployment or financial-write authorization.

## 12. Completion Criteria

Report:

- Root cause and completed changes.
- Data validation and reconciliation results.
- Relevant tests and CI outcomes.
- Significant unresolved issues.
- PR, merge, and deployment status.
- Actual production verification, when available.
- Necessary user actions, if any.

Never equate passing CI with successful production deployment.

The final objective is accurate financial data, reliable automation, efficient execution, and maintainable operations with minimal unnecessary complexity.
