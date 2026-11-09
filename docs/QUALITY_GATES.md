# Quality Gates — Data Accuracy and Production Reliability

> Scope: All repository changes.
>
> Primary policy: [AGENTS.md](../AGENTS.md).
>
> Apply validation proportional to the actual operational risk and affected functionality.
>
> Documented quality gates and GitHub-enforced checks are different. Never treat a documentation change as permission to bypass an enforced CI check, branch protection rule, or deployment restriction.

## 1. Quality Objectives

Evaluate changes using these priorities:

1. Data accuracy and integrity.
2. Production stability and recoverability.
3. Performance and execution efficiency.
4. Simplicity and maintainability.
5. Essential security protections.

A successful change must solve the intended problem without introducing material data errors or operational regressions.

Avoid unnecessary validation, excessive approval procedures, and repeated review cycles.

## 2. Risk-Based Validation

Select tests based on the affected functionality.

| Change Type | Required Validation |
| --- | --- |
| Documentation only | Content, links, consistency, applicable CI |
| UI or presentation | Rendering, affected calculations, relevant regression |
| Market data retrieval | Source, date, value, freshness, missing-data handling |
| NAV or fund processing | Fund identity, share class, publication date, value, storage |
| Financial calculations | Independent expected results, totals, reconciliation |
| Historical data or snapshots | Dates, quantities, duplicates, recalculation |
| Shared financial writes | Idempotency, ownership, concurrent execution, recovery |
| Scheduling or automation | Trigger configuration, execution ownership, retries |
| Market briefings | Data accuracy, coverage, delivery state, duplication |
| GAS or deployment | Relevant version contracts, release verification, operational readback |
| Credentials or access | Secret protection and affected permission boundaries |

Do not automatically require every test category for every change.

Mandatory repository-enforced checks must still pass.

## 3. Source Accuracy and Freshness

For affected financial data, verify:

- Correct instrument, symbol, fund, and share class.
- Correct provider and source priority.
- Correct market or disclosure date.
- Correct publication and retrieval timestamps.
- Correct values, units, currencies, and precision.
- Consistency between source data and stored records.

Use the configured authoritative source.

Prefer NH PLUG for supported prices and established official sources for NAV, disclosures, and other financial data.

Use secondary providers only according to documented validation or fallback rules.

Never manufacture values to improve reported coverage.

### Data status classification

Distinguish:

- CONFIRMED: Validated authoritative observation.
- PROVISIONAL: Available but not final.
- STALE: Previously valid observation that is no longer current.
- NOT_PUBLISHED: Data not yet expected to exist.
- UNAVAILABLE: Expected data could not be retrieved.
- INVALID: Data failed validation.

Do not treat expected non-publication as a technical failure.

Do not report stale data as a current observation.

## 4. Financial Reconciliation

For affected portfolio calculations, validate:

- Transactions and historical quantities.
- Purchase cost and acquisition basis.
- Current valuation.
- Realized and unrealized profit or loss.
- Dividends and distributions.
- Fund NAV and unit balances.
- Currency conversion, where applicable.
- Account totals and portfolio totals.
- Historical snapshots and recalculated periods.

Verify totals using independent calculations where practical.

When source inputs are missing, report incomplete valuation rather than silently treating missing values as zero.

Investigate material discrepancies before declaring completion.

Do not rely on hard-coded historical row counts as permanent requirements.

## 5. Financial Write Integrity

These protections are mandatory when relevant:

- Single effective writer for conflicting operations.
- Idempotent writes and retries.
- Protection against duplicate records.
- Correct execution ownership and lease handling.
- Recovery after partial writes or interrupted execution.
- Preservation of authoritative historical records.
- No premature deletion of pending recovery information.

Check that a timed-out or outdated execution cannot overwrite newer valid results.

Avoid redundant locks or additional writer gates when existing controls already protect the same operation correctly.

For read-only operations, do not require financial-write validation unless the change affects a shared dependency.

## 6. Automation and Recovery

Validate affected automated operations using current production configuration.

Check:

- Expected schedule and time zone.
- Trading calendar and relevant date boundaries.
- Trigger identity and ownership.
- Retry and timeout behavior.
- Duplicate execution prevention.
- Partial success and failure recovery.
- Completion and pending-work markers.
- Provider availability and rate limits.

Use the current configured schedule instead of hard-coded historical times.

An expected no-op is not automatically a failure.

A skipped or failed operation must not silently disappear when recovery is still required.

Reduce unnecessary polling, repeated requests, and duplicate recovery attempts.

## 7. Fund NAV and Publication Timing

- Confirm the exact fund, share class, and NAV source.
- Distinguish the NAV valuation date from its publication date.
- Respect actual publication schedules, holidays, and weekends.
- Do not assume every fund publishes a new NAV every calendar day.
- Avoid unnecessary retries before the next expected publication.
- Do not generate artificial NAV values for missing publication dates.
- Preserve the last verified NAV with its correct reference date where the product requires carry-forward display.
- Clearly identify pending, unavailable, and confirmed updates.
- Validate stored NAV values separately from displayed portfolio valuations.

Do not write unchanged records merely to demonstrate that an automation executed.

## 8. Market Briefing Quality

For affected morning or closing briefings, verify:

- Correct target trading date and publication timing.
- Accurate source values and freshness labels.
- Correct market indicators and available coverage.
- Consistency between current values and historical comparisons.
- Appropriate handling of missing or delayed data.
- Correct valuation inputs and financial metrics.
- No fabricated market observations or unsupported analysis.
- Correct delivery status and duplicate-delivery prevention.

When company valuation metrics are included, verify the reporting period, source, units, and relevant calculation assumptions.

Distinguish generated content from actual successful Telegram delivery.

A successful workflow run does not by itself prove that the final briefing was delivered.

Do not perform duplicate production sends solely to demonstrate success.

## 9. Testing Standards

Use production logic where practical, but isolate or dry-run operations that could modify real financial records.

For relevant defects:

1. Reproduce the original failure when practical.
2. Identify the root cause.
3. Apply a targeted fix.
4. Verify the corrected behavior.
5. Run relevant regression checks.
6. Confirm the operational result where accessible.

Use independent expected values for critical financial calculations.

Test concurrency, retries, timeouts, partial completion, and date boundaries when they are relevant to the change.

Do not require exhaustive mutation testing for unrelated or low-risk changes.

Do not introduce test code that duplicates the production algorithm as its only validation oracle.

Never use real credentials in test fixtures.

## 10. CI and Repository Checks

- Run all checks actually required by the repository or GitHub configuration.
- The existing `quality-check.yml` executes `npm run check:ci` for pull requests.
- Do not bypass enforced checks through documentation or instruction changes.
- Run additional targeted checks when appropriate to the change.
- Investigate relevant failures before merging.
- Distinguish passed, failed, skipped, not run, and unverified checks.
- A skipped check is not evidence of a successful test.
- Do not launch unnecessary duplicate CI workflows.

For changes to test scripts or CI configuration, verify that the required validation scripts remain reachable and effective.

## 11. Codex Review Policy

Review findings according to actual impact.

### Mandatory resolution

- Reproducible P0 and P1 defects.
- Material P2 defects affecting financial correctness, data integrity, critical production reliability, or required operational behavior.

### Optional or deferrable

- P3 findings.
- Stylistic improvements.
- Speculative issues without supporting evidence.
- Out-of-scope refactoring.
- Redundant defensive checks.
- Improvements unrelated to the current failure.

Review severity labels are not sufficient by themselves. Assess the actual affected behavior and risk.

Do not blindly implement all reviewer suggestions.

### Review workflow

1. Check whether automatic review already exists for the current HEAD.
2. Avoid duplicate review requests.
3. Classify each material finding by reproducibility and impact.
4. Resolve related issues in a consolidated change.
5. Re-run relevant tests.
6. Request additional review only when required or materially justified.
7. Record the reason when declining an unsupported suggestion.

If repeated reviews reveal the same structural issue, reconsider the design instead of endlessly patching symptoms.

Do not merge with unresolved material defects.

Respect required reviews enforced by GitHub.

## 12. GAS Release and Deployment Validation

When GAS or deployment behavior changes, verify the relevant contracts:

- Actual GAS source version.
- Affected `gasVersion` API responses.
- `handleGetSettings()` where applicable.
- Web `EXPECTED_GAS_VERSION`.
- Supported compatibility versions.
- Deployment source identity, hashes, and manifests.
- Relevant triggers and execution ownership.
- Deployment status and operational readback.

Use actual current configuration rather than outdated schedules or historical release assumptions.

Preserve enforced source verification and deployment authorization.

Do not require full GAS deployment testing for unrelated documentation or isolated UI changes.

Where appropriate, use dry-run validation before production deployment.

A passed release check does not prove that a new version is running in production.

## 13. Merge and Production Authorization

Before merging:

- Confirm relevant changes are complete.
- Confirm mandatory CI success.
- Confirm material review findings are resolved or adequately addressed.
- Check for conflicts with other active changes.

Proceed with merge only when authorized and permitted by repository rules.

Before material production changes:

- Confirm the intended target and scope.
- Check for conflicting active operations.
- Preserve a practical recovery path.
- Obtain authorization unless it has already been explicitly granted.
- Avoid unnecessary additional approval requests for already authorized work.

Treat financial source-data writes and destructive corrections as high-risk operations.

Never interpret an instruction file as authorization to bypass required deployment controls.

## 14. Production Verification

Separate the following states:

1. Code updated.
2. Tests passed.
3. PR merged.
4. Deployment completed.
5. Production execution verified.
6. Financial data and outputs verified.

Do not combine these states into a single completion claim.

When applicable, verify:

- Actual deployed version.
- API responses and timestamps.
- Trigger execution and ownership.
- Source-data coverage.
- Financial reconciliation.
- Snapshot and NAV updates.
- Market briefing delivery.
- Remaining recovery queues and errors.

If direct production verification is unavailable, report that limitation.

## 15. Completion Criteria

A task may be reported as completed when:

- The requested scope is implemented.
- Relevant required checks pass.
- Material regressions are addressed.
- Financial data correctness is preserved.
- Authorized operational changes are verified to the extent accessible.
- Remaining uncertainty is clearly disclosed.

Do not block unrelated completed work because of optional style changes or speculative review suggestions.

## 16. Continuous Improvement

When operational problems recur:

- Identify the common root cause.
- Improve the actual validation or recovery mechanism.
- Remove redundant checks where equivalent protection already exists.
- Reduce repeated API calls, unnecessary retries, and manual intervention.
- Preserve reliable controls for data integrity and recovery.

The goal is effective validation, not maximum validation volume.

**Success means accurate data, reliable operation, efficient execution, and verified results.**
