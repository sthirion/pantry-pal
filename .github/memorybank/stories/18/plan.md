# Story Plan: 18 — Production deployment

## Branches

- Pantry app: `feature/18-production-deployment`, based on current `main` (includes merged issues 17 and 37).
- Shared deploy tool: `feature/18-pantry-pal-site` in `C:\Users\xbox\dev\hetzner-deploy`.

## Role

`--dev` — inferred because this story has no saved plan and no `--full` flag was requested.

## Set-aside changes

None; both repositories were clean before branch creation.

## Context

- `.github/memorybank/stories/18/context.md` — tracker snapshot, issue 18.
- `.github/memorybank/features/shopping-lists-mvp/design.md` — approved deployment design and example manifest.
- Shared deploy tool: `C:\Users\xbox\dev\hetzner-deploy`.

## Scope

Chore / Config plus operational runbook. Add `sites/pantry-pal.json` to the deploy-tool repository and `docs/runbook.md` to pantry-pal. Require an exact install-command allowlist for pantry-pal and fail-closed database recovery when a failed health check has no verified backup, with local Pester coverage. No pantry-pal application source changes are planned. Production setup/deploy, account creation using real credentials, and backup restoration are live operational actions; no secrets will be committed or sent in chat, and no production operation will run until its human checkpoint is approved.

## Summary

Prepare the existing Hetzner deploy tool to serve pantry-pal at `https://pantry.thirion.org`, and document first setup, admin account creation, deploy/rollback, and a tested backup restore that preserves the live database afterward.

## Acceptance Criteria

1. The shared deploy-tool manifest uses the existing `node-systemd` and `database` layout; `deploy.ps1 -Site pantry-pal -Setup` succeeds without `--ignore-scripts`, and the HTTPS health endpoint returns 200.
2. HTTP redirects to HTTPS and responses include the required security headers.
3. `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` exist only in `/opt/pantry-pal/shared/.env` on the server; neither secret is committed or exposed in logs/PRs.
4. The admin CLI creates the household and two users, and both accounts can sign in and install/use the PWA on phones.
5. A daily provider backup of `pantry.db` is restored according to the runbook, data is verified against the backup, and the original live database is restored afterward.
6. `docs/runbook.md` covers admin commands, initial setup/deploy, rollback, backup restore, and validation.

## Assumptions

- The deploy tool's `node-systemd`/SQLite support is sufficient; adapt the existing `axon` manifest rather than changing deploy-tool behavior unless manifest validation disproves this.
- `pantry.thirion.org` DNS and the existing Hetzner host are available as recorded in the feature design; verify before any `-Setup` operation.
- The deployment user can run the documented deploy commands from the correct checkout; do not request SSH keys, passwords, or secret values through chat.
- The restore test must preserve a copy of the live DB before testing the provider backup and put the original live DB back before restart.
- The runtime `.env` is owned by `root:pantry-pal` with mode `0640`, so systemd can read it and unrelated users cannot.
- The backup comparison uses integrity/foreign-key checks, file and sidecar checksums, and non-PII table counts; no database row values are recorded.
- Exact HSTS duration and Referrer-Policy value are not prescribed by the design; verify HSTS has a positive `max-age` and Referrer-Policy is present and non-empty.

## Implementation Notes

### Deploy-tool repository

- Add `sites/pantry-pal.json` based on the approved design and existing `node-systemd` manifests.
- Validate with `Read-DeployManifest`/Pester without contacting the live host. The pantry-pal allowlist must reject unapproved install strings through the deployment CLI before remote execution; failed-health recovery must not restart without a verified database backup.

### Pantry-pal repository

- Add `docs/runbook.md` with placeholders for operator-supplied values and no secrets.
- Document post-deploy health, redirect, and security-header checks; document stopping/restarting the service and restoring the live DB safely.

## Human Checkpoints

- Review and approve both repository changes before their PRs are merged.
- Before `deploy.ps1 -Site pantry-pal -Setup`, confirm DNS, server access, and that `/opt/pantry-pal/shared/.env` has been created directly on the server by the operator. Do not read, print, or store its secret values.
- Before testing restore, confirm a separate copy of the current live database exists and agree to the brief maintenance window. Never leave the provider backup as the live DB after the test.
- Account creation requires operator-supplied credentials directly at the admin CLI; do not collect passwords in chat or commit them.

## Test Strategy

- Manifest and deploy recovery: Pester validation through the actual deployment CLI for rejected install strings, plus generated remote-script assertions for missing-backup health recovery; do not invoke `-Setup` against the real host in tests.
- Runbook: manually verify every command against the deploy tool, admin CLI and server paths.
- Production AC: perform only after explicit human checkpoint; record health/redirect/header, sign-in and restore results without recording secrets.

## Requirements (from phase 1)

- Acceptance criteria: AC-001 locally validate the `node-systemd`/SQLite manifest and reject `--ignore-scripts`, then gate first setup/health on approval; AC-002 verify HTTPS redirect and security headers; AC-003 keep auth settings server-only in root-owned mode-0640 `.env`; AC-004 create one household/two users and verify sign-in/install; AC-005 verify provider-backup integrity/equivalence and restore the preserved live DB; AC-006 provide a safe setup/deploy/admin/rollback/restore runbook.
- Test Awareness Matrix: Pester manifest validation is Required; Production operational smoke checks and Security/Runbook manual review are Recommended and occur only at the human checkpoints.
- Tracker update: Needed — Applied with user approval. The issue now includes local manifest validation, the `--ignore-scripts` guard, `.env` ownership/mode, objective restore equivalence checks, and explicit production checkpoints.

## Agent Sequence

1. `@requirements` refine issue 18 requirements and operational checkpoints.
2. `@requirements-review` gate the refined contract.
3. `@assistant` create the deploy manifest and runbook in their respective repositories; validate manifest without a live deploy.
4. `@test-review` review test/validation adequacy; manual code review for the runbook and manifest.
5. Create a pantry-pal draft PR and a separate deploy-tool PR; do not merge or deploy before human review.
6. Continue live operations only after the explicit deployment/restore checkpoint.

## Status

[x] Branch created in pantry-pal
[x] Deploy-tool branch created
[x] Requirements clear
[x] Tracker story updated (or confirmed not needed)
[x] Manifest and runbook complete
[x] Local validation complete
[x] Code reviewed
[ ] Draft PRs created in both repositories
[ ] Production setup/deploy approved and completed
[ ] Account sign-in/install verified
[ ] Backup restore tested and live DB restored
[ ] PR(s) ready for merge

## Review Gate Status

| Phase | Attempt | Rating | Verdict | Reviewer | Notes |
| --- | --- | --- | --- | --- | --- |
| requirements | 1 | 5 | APPROVE | `@requirements-review` | All six AC are testable; live secret/deploy/restore operations are explicit human checkpoints. |
| implementation | 1 | 3 | REFINE | `@code-review` | Initial review found missing-backup health rollback could restart; fixed with fail-closed recovery. |
| implementation | 2 | 5 | APPROVE | `@code-review` | Exact pantry-pal allowlist and fail-closed recovery approved. |
| implementation | 3 | 4 | APPROVE | `@code-review` | Behavioral test harness reviewed; portability suggestion for temp paths was applied and the focused Pester suite passed. |
| tests | 1 | 3 | REFINE | `@test-review` | Initial tests used a test-local install helper and did not verify production-path enforcement. |
| tests | 2 | 3 | REFINE | `@test-review` | Install checks moved to the production CLI; health recovery tests upgraded to execute generated Bash and assert DB state at restart. |
| tests | 3 | 5 | APPROVE | `@test-review` | Both recovery branches and allowlist cases approved; final Pester suite passed 78/78. |
