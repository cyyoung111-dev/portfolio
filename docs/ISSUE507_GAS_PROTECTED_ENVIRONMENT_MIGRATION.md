# Issue #507 — GAS production token Protected Environment migration (PREPARATION ONLY)

## Current safety status

This document is a deployment runbook, **not proof of an enabled security policy**.
The `#629` draft PR stages `environment: portfolio-production-gas` on all **33** GitHub Actions workflow files containing `secrets.GAS_ACCESS_TOKEN`, covering **34 secret-consuming jobs**. The branch retains its original schedule, explicit manual checks, and finance write guards. No GitHub Environment or secret has been created/moved/deleted by this PR.

**Do not merge this code alone to declare the P1 resolved.** Jobs referencing an unconfigured environment will not receive its `GAS_ACCESS_TOKEN`. Leaving an accessible repository-level `GAS_ACCESS_TOKEN` still permits older or modified ref workflows to read it.

## Required settings operations (GitHub repository administrator; coordinated maintenance window)

1. Inventory every `GAS_ACCESS_TOKEN` consumer; confirm the `33 workflows / 34 jobs` offline CI gate and all main scheduled/manual workflows. Include GAS deployment, backfill, targeted recovery, market briefing, and READ ONLY jobs. Source path: `.github/workflows/`; regression: `scripts/check-issue507-operational-gates.mjs`.
2. In **Settings → Environments**, create **`portfolio-production-gas`**. Under Deployment branches and tags, select **Selected branches and tags → main only**. Do not use `Protected branches only` as a substitute where main branch protection has not been verified. Do not add a wildcard branch/tag pattern. Verify branch/tag rules via actual repository settings, not YAML inference.
3. Configure a **GitHub Environment secret** named `GAS_ACCESS_TOKEN`, with approved credential provenance. Do not print or commit the value. Confirm least privilege, expiration, token rotation process, and the operational GAS endpoint `GAS_WEB_APP_URL`.
4. Merge the staged code only after the P1 has been reviewed and a controlled cutover is scheduled. Ensure **all 34** secret-using jobs target the protected environment and no additional/legacy workflow or org/repository secret path remains unaccounted for.
5. **Remove the existing Repository-level `GAS_ACCESS_TOKEN` secret** as part of the same controlled cutover. This is essential: while a repo-level secret remains present, an old feature-branch workflow can bypass the new job-level `if` and access it. Keep the Environment secret and any alternate credential scope separately verified.
6. Run a benign main-branch authenticated **READ ONLY** diagnostic. Verify a normal workflow can read its Environment secret. Separately verify a branch or tag **not permitted by the Environment** cannot acquire the token, without executing a destructive operation. Avoid logging secret values.
7. Review deployment/trigger histories, exact schedule anchors, and failure codes. Validate normal 07:30/16:30 market briefing, 08:45 KRX source, and 02:30 nightly diagnostic availability only with real runs; offline CI does **not** prove on-time scheduling or GAS data completeness.

## Fail-closed acceptance and rollback

- CI: YAML syntax valid; 33 workflow files and 34 credentialed jobs all require `portfolio-production-gas`; deleting/changing the job environment must fail tests; existing finance safety and schedule tests pass.
- GitHub settings: **Selected branches and tags permits main only**; the secret exists at Environment scope, and **Repository-level `GAS_ACCESS_TOKEN` is absent**. An old ref must not receive credentials.
- Until every requirement is verifiable, **keep #629 Draft and Codex P1 unresolved**. Do not treat `job.if` or a successful CI as a security boundary.
- If main authenticated jobs fail after cutover, do **not** restore a broad Repository Secret. Fix the environment branch policy, job wiring, or credential configuration while maintaining branch-level isolation; follow operational incident procedures.
- This migration does not authorize GAS publication, Snapshot repair/deletion, backup restore, market price substitution, scheduled backfill dispatch, or 2025-12-31→2026-01-01 carry logic changes. `restoreAllowed=false`, `deleteAllowed=false`.
