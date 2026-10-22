# Issue #507 — GAS production credentials Protected Environment migration (PREPARATION ONLY)

## Current safety status

This document is a deployment runbook, **not proof of an enabled security policy**.
The `#629` draft PR stages `environment: portfolio-production-gas` on all **34** GitHub Actions workflow files containing `secrets.GAS_ACCESS_TOKEN` or `secrets.CLASPRC_JSON`, covering **35 secret-consuming jobs**. The additional path is the Apps Script execution audit, which uses the `CLASPRC_JSON` OAuth credential without a `GAS_ACCESS_TOKEN` reference. The GAS deployment job uses both credentials. The branch retains its original schedule, explicit manual checks, and finance write guards. No GitHub Environment or secret has been created/moved/deleted by this PR.

**Do not merge this code alone to declare the P1 resolved.** Jobs referencing an unconfigured environment will not receive properly scoped `GAS_ACCESS_TOKEN` or `CLASPRC_JSON`. Leaving either credential accessible at repository or organization scope still permits older or modified ref workflows to request it.

## Required settings operations (GitHub repository administrator; coordinated maintenance window)

1. Inventory every `GAS_ACCESS_TOKEN` **and** `CLASPRC_JSON` consumer; confirm the `34 workflows / 35 jobs` offline CI gate and all main scheduled/manual workflows. Include GAS deployment, backfill, targeted recovery, market briefing, and READ ONLY jobs. Source path: `.github/workflows/`; regression: `scripts/check-issue507-operational-gates.mjs`.
2. In **Settings → Environments**, create **`portfolio-production-gas`**. Under Deployment branches and tags, select **Selected branches and tags → main only**. Do not use `Protected branches only` as a substitute where main branch protection has not been verified. Do not add a wildcard branch/tag pattern. Verify branch/tag rules via actual repository settings, not YAML inference.
3. Configure **GitHub Environment secrets** named `GAS_ACCESS_TOKEN` and `CLASPRC_JSON`, with approved credential provenance. The latter grants Apps Script OAuth capabilities and must not remain broadly available. Do not print or commit either value. Confirm least privilege, expiration, token rotation process, and the operational GAS endpoint `GAS_WEB_APP_URL`.
4. Merge the staged code only after the P1 has been reviewed and a controlled cutover is scheduled. Ensure **all 35** secret-using jobs target the protected environment and no additional/legacy workflow or org/repository secret path remains unaccounted for.
5. **Remove both Repository-level `GAS_ACCESS_TOKEN` and `CLASPRC_JSON` secrets** as part of the same controlled cutover, checking separately for alternate organization-level secret exposure. This is essential: while a repo-level secret remains present, an old feature-branch workflow can bypass the new job-level `if` and access it. Keep both Environment secrets and any alternate credential scope separately verified.
6. Run a benign main-branch authenticated **READ ONLY** diagnostic. Verify the independent GAS-token and Apps Script-OAuth read-only jobs can each access their protected Environment secret. Separately verify a branch or tag **not permitted by the Environment** cannot acquire the token, without executing a destructive operation. Avoid logging secret values.
7. Review deployment/trigger histories, exact schedule anchors, and failure codes. Validate normal 07:30/16:30 market briefing, 08:45 KRX source, and 02:30 nightly diagnostic availability only with real runs; offline CI does **not** prove on-time scheduling or GAS data completeness.

## Fail-closed acceptance and rollback

- CI: YAML syntax valid; 34 workflow files and 35 credentialed jobs all require `portfolio-production-gas`; deleting/changing the job environment must fail tests; existing finance safety and schedule tests pass.
- GitHub settings: **Selected branches and tags permits main only**; both secrets exist at Environment scope, and **Repository-/Organization-level `GAS_ACCESS_TOKEN` and `CLASPRC_JSON` are not accessible from untrusted refs**. An old ref must not receive credentials.
- Until every requirement is verifiable, **keep #629 Draft and Codex P1 unresolved**. Do not treat `job.if` or a successful CI as a security boundary.
- If main authenticated jobs fail after cutover, do **not** restore a broad Repository Secret. Fix the environment branch policy, job wiring, or credential configuration while maintaining branch-level isolation; follow operational incident procedures.
- This migration does not authorize GAS publication, Snapshot repair/deletion, backup restore, market price substitution, scheduled backfill dispatch, or 2025-12-31→2026-01-01 carry logic changes. `restoreAllowed=false`, `deleteAllowed=false`.
