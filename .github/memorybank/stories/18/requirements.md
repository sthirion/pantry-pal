# Requirements: 18 — Production Deployment

## Scope and Verification Boundary

This is infrastructure, deployment configuration, and operational runbook work. The deploy manifest belongs in the companion `hetzner-deploy` repository; `docs/runbook.md` belongs in pantry-pal. Application source, tracker content, and the story plan are unchanged by this requirements refinement.

Local verification must not connect to or change the production host. It covers manifest parsing/validation with the deploy tool's `Read-DeployManifest` and Pester checks, a review of runbook commands against the checked-in tool and project design, and existing automated checks that can run with isolated test data. These checks do not prove that the live host is configured correctly.

The following are explicit human-checkpoint operations and are not to be run as local tests or without the operator's approval: first `deploy.ps1 -Site pantry-pal -Setup`, creating the two real accounts and signing in on their phones, and the provider-backup restore test. Operators enter secret values and account passwords directly on the server or at the prompted CLI input; no artifact, command argument, log, chat, or PR may contain those values.

## Source AC Comparison

The issue snapshot has six AC covering manifest/health, transport security, server environment configuration, two-user onboarding, backup restore, and the runbook. All six remain in scope. Refinement adds local-versus-production evidence, a pantry-pal exact install-command allowlist enforced by manifest validation before remote execution, a fail-closed health recovery path when the expected database backup is missing, a verifiable `.env` owner/mode contract, concrete SQLite integrity and backup/live-copy equivalence checks, failure outcomes, explicit operator checkpoints, and data-preservation requirements not observable in the snapshot wording.

**Tracker verdict: Needed.** The issue AC do not define the local validation boundary, operational approval gates, an automated assertion rejecting `--ignore-scripts`, expected `.env` ownership and permissions, objective integrity/equivalence checks for both restored and preserved databases, or specific observable checks for security headers, onboarding, and runbook safety. This is a comparison only; the tracker has not been changed.

## Requirements

### REQ-INFRA-018-001: Validate the deployment manifest and first setup

- Tracker source: AC-1.
- Precondition: The companion deploy-tool checkout contains `sites/pantry-pal.json`; the local validation environment has the tool's supported PowerShell and Pester dependencies.
- Actor: Implementer validates locally; authorized operator performs first setup after approval.
- Priority: Must.
- Contract: The manifest parses and passes `Read-DeployManifest`/Pester validation as a `node-systemd` site with the approved pantry-pal layout: port `3100`, `database` `pantry.db`, health path `/api/health`, approved build/artifact/install/start/environment configuration, and `npm ci` without `--ignore-scripts`. The required exact `installAllowlist` is enforced by `Read-DeployManifest`; Pester exercises rejection through `bin/deploy.ps1` and confirms validation fails before any remote connection. Local validation makes no SSH, DNS, Nginx, certificate, or server changes. Only after the live-operation checkpoint may the operator run `deploy.ps1 -Site pantry-pal -Setup`; successful completion is followed by an unauthenticated HTTPS `GET /api/health` returning HTTP `200` and `{ "status": "ok" }`.
- Negative: A malformed or contract-incomplete manifest, or an install command that differs from the exact allowlist (including shell quoting, escaping, variable expansion, and line continuations that could enable `--ignore-scripts`), fails in the production manifest-loading path before remote execution. If DNS/server access or the required server `.env` is not ready, the operator does not start `-Setup`; a failed validation or setup is reported as a failure, not as a successful deployment.

### REQ-INFRA-018-002: Verify HTTPS redirect and response security headers

- Tracker source: AC-2.
- Precondition: The approved first setup/deploy is complete and the public hostname resolves to the intended server.
- Actor: Authorized operator performs the production smoke check after the deployment checkpoint.
- Priority: Must.
- Contract: A request to `http://pantry.thirion.org` receives a redirect whose `Location` uses HTTPS. HTTPS responses from the app include HSTS, Content-Security-Policy containing `default-src 'self'`, `X-Content-Type-Options: nosniff`, and a non-empty `Referrer-Policy`. Verify at least the health endpoint and the served app document; do not infer these properties from a local app test alone.
- Negative: A non-redirecting HTTP response, redirect to a non-HTTPS location, missing required header, or unexpected empty health response fails the smoke check and blocks acceptance until corrected and rechecked.

### REQ-INFRA-018-003: Keep authentication configuration on the server

- Tracker source: AC-3.
- Precondition: The service is configured to read `/opt/pantry-pal/shared/.env` through the deploy tool's service unit.
- Actor: Authorized operator enters values directly on the server; implementer verifies repository and deployment artifacts without reading or copying secret values.
- Priority: Must.
- Contract: `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are supplied in `/opt/pantry-pal/shared/.env` for runtime use. The value of `BETTER_AUTH_SECRET` exists only on the server; the `.env` file and either value are absent from Git, manifest contents, build artifacts, logs, chat, and PRs. `BETTER_AUTH_URL` is configuration rather than a secret, but its runtime value is kept in the server `.env` per the approved design. The file is owned by `root`, has group `pantry-pal`, and has mode `0640`; the `pantry-pal` service user can read it, users outside that group cannot, and authorized operators access it through privileged server access. Before readiness is accepted, the operator verifies ownership and mode (for example, `stat` reports `root:pantry-pal` and `640`) and confirms the service user can read the file without displaying its contents. Operators enter values directly on the server and never pass them as command-line arguments.
- Negative: If the server file is absent or unusable, has different ownership or permissions, or cannot be read by the service user, deployment/service readiness is not reported as complete. If a secret value is found in a repository or artifact, stop publication/deployment and remove the exposure through the project's approved secret-incident process; do not reproduce the value in a report.

### REQ-INFRA-018-004: Create and verify the household's two accounts

- Tracker source: AC-4.
- Precondition: The deployed service is healthy, and the authorized household admin has approved real-account setup.
- Actor: Household admin operates the admin CLI; each account holder signs in and installs the PWA on their phone.
- Priority: Must.
- Contract: The operator creates one household and two users assigned to that household with the documented admin CLI. The user-creation command prompts for each password; the operator enters passwords directly at the prompt, never as arguments or in a saved file. Each account holder successfully signs in on their own phone, reaches the household app, and installs and launches the PWA. Record pass/fail and the account-to-household verification without recording passwords, session values, or unnecessary personal data.
- Negative: If either CLI operation fails, either user is not associated with the intended household, or either sign-in/install check fails, onboarding is incomplete; do not claim both accounts are ready. Retry or correct the setup without putting credentials in a report.

### REQ-INFRA-018-005: Test provider-backup restore without losing live data

- Tracker source: AC-5.
- Precondition: A daily provider backup containing `pantry.db` has been selected; the operator has explicitly approved the restore test and its maintenance window; a consistent, independently verified copy of the current live database is available before any replacement.
- Actor: Authorized operator follows the restore runbook.
- Priority: Must.
- Contract: The operator records the provider backup timestamp, stops the service before manipulating the live database, and preserves a recoverable copy of the current live database, including applicable SQLite sidecar state. On the stopped source and each restored copy, `PRAGMA integrity_check` must return exactly `ok` and `PRAGMA foreign_key_check` must return zero rows. The operator computes SHA-256 checksums of `pantry.db` and `pantry.db-wal` when present, without outputting database contents; each restored artifact's checksum and sidecar presence must match the corresponding selected-backup artifact during the backup test, and match the preserved pre-test artifact after live-data recovery. For each comparison, read-only checks of row counts for every SQLite table and `change_counter.value` must also match; record only the counts, counter, checksums, and pass/fail, never row values or personal data. After testing, the operator restores the preserved pre-test live database and applicable sidecars before restarting the service, then repeats the integrity, foreign-key, checksum, table-count, and counter checks and verifies service health. The provider backup must never remain as the live database after the test.
- Negative: If the source backup is missing, the preserved live copy cannot pass its integrity and summary checks, any required checksum/sidecar/table-count/counter comparison differs, an integrity check is not exactly `ok`, a foreign-key check returns rows, or any step is interrupted, do not proceed as though the test passed. Keep the service stopped while recovering the verified pre-test live database; restart only after the live copy and its integrity and equivalence checks are confirmed. Escalate if recovery cannot be confirmed.

### REQ-INFRA-018-006: Provide a safe, executable operational runbook

- Tracker source: AC-6.
- Precondition: `docs/runbook.md` is reviewed against the current deploy-tool README, approved deployment design, and admin CLI contract.
- Actor: Implementer writes/reviews the runbook; authorized operator executes its live steps.
- Priority: Must.
- Contract: The runbook documents prerequisites and checkpoints; first setup and routine deploy; the admin CLI household/user/password-reset/maintenance commands; HTTPS health, redirect, and header verification; rollback behavior including the database-restore consequence and code-only `-SkipDbRestore`; and the provider-backup restore procedure with stop, preserve, verify, restore-live-copy, restart, and recovery steps. It distinguishes local checks from production actions, uses no real secrets or passwords, and tells the operator to enter those values directly on the server or at the CLI prompt.
- Negative: A missing required procedure, stale or unsafe command, command-line password/secret example, instruction to manipulate the live SQLite database while the service is running, or omission of the pre-test live-copy recovery path makes the runbook incomplete and blocks acceptance.

## Acceptance Criteria

### AC-001: Manifest validation and approved first setup

Given the `pantry-pal` manifest and deploy-tool validation dependencies are available locally, when the implementer runs `Read-DeployManifest` and the relevant Pester validation, then the manifest is accepted with the approved `node-systemd`/SQLite configuration and install scripts enabled, and no production host is contacted or changed. The deployment CLI enforces the manifest's exact `installAllowlist` before remote execution, and Pester rejects unapproved strings through that CLI. Given the manifest is malformed, missing a required contract field, or differs from its install allowlist, when local validation runs, then validation fails and no live setup is attempted.

Given local validation has passed, DNS/server access and server-side environment configuration have been confirmed, and the operator explicitly approves the live setup checkpoint, when the operator runs `deploy.ps1 -Site pantry-pal -Setup`, then setup/deploy completes and unauthenticated `GET https://pantry.thirion.org/api/health` returns `200` with `{ "status": "ok" }`. If prerequisites are absent or setup/health fails, the deployment is not accepted and the failure is recorded without claiming production readiness.

### AC-002: HTTP to HTTPS and security headers

Given the production hostname is deployed and reachable, when the operator requests `http://pantry.thirion.org`, then the response redirects to an HTTPS location. When the operator checks the HTTPS health endpoint and app document, then responses contain HSTS, CSP including `default-src 'self'`, `X-Content-Type-Options: nosniff`, and a non-empty `Referrer-Policy`. A missing header, non-HTTPS redirect target, or HTTP response without redirect fails this criterion.

### AC-003: Server-only authentication settings

Given the service uses `/opt/pantry-pal/shared/.env`, when the operator configures runtime auth settings directly on the server and verifies access without displaying file contents, then the file is owned by `root`, has group `pantry-pal` and mode `0640`, the `pantry-pal` service user can read it, and users outside that group cannot. When the implementer inspects checked-in and published artifacts, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are available to the service from that file, the secret value is present only on the server, and neither value/file is copied into repository or deployment artifacts. No credential value is printed, logged, passed as a command argument, or included in chat or PR content. Missing/unreadable server configuration, incorrect ownership or mode, or any discovered secret exposure fails this criterion and blocks readiness.

### AC-004: Household and two-user onboarding

Given the live service is healthy and the admin has approved account setup, when the admin creates one household and two users through the documented CLI, then both users belong to that household and each receives a password through the CLI prompt. When each account holder signs in on their phone and installs and launches the PWA, then both onboarding checks pass. Passwords are entered directly at the prompt and are never recorded. A failed CLI operation, wrong household association, failed sign-in, or failed installation leaves onboarding incomplete.

### AC-005: Provider restore with live database preservation

Given the operator has approved a maintenance window, selected a daily provider backup, and verified a separate consistent copy of the current live database, when the service is stopped and the runbook is used to restore `pantry.db` from that backup, then `PRAGMA integrity_check` returns exactly `ok`, `PRAGMA foreign_key_check` returns zero rows, SHA-256 checksums and presence of `pantry.db` and any `pantry.db-wal` match the selected backup, and read-only row counts for every SQLite table plus `change_counter.value` match the selected backup. No row values or personal data are emitted or recorded. When restore verification is complete, the pre-test live database and applicable sidecars are restored before the service restarts; integrity, foreign-key, checksum, table-count, counter, and service-health checks confirm equivalence to the pre-test live copy afterward. If any check fails or is interrupted, the service stays stopped until the pre-test live database is restored and verified; the provider backup is never left serving as the live database.

### AC-006: Runbook coverage and operational safety

Given `docs/runbook.md` is reviewed against the approved design and current tool/CLI documentation, when the reviewer checks the runbook checklist, then it covers initial setup, routine deploy, admin commands, health/transport/security checks, rollback and its database implications, provider backup restore/recovery, and explicit production checkpoints. Given a command or instruction is unsafe, stale, omits a required procedure, exposes credentials, or permits an unverified database replacement, when review identifies it, then the runbook is rejected until corrected.

## BDD Acceptance Scenarios

```gherkin
Feature: Production deployment readiness for pantry-pal

  Scenario: Validate the manifest locally without contacting production
    Given the pantry-pal manifest and local deploy-tool validation dependencies are available
    When the implementer runs Read-DeployManifest and the relevant Pester checks
    Then the manifest passes the approved node-systemd and SQLite contract
    And the production manifest validator accepts the approved exact installAllowlist
    And Pester verifies the CLI rejects shell-rewritten --ignore-scripts variants before remote execution
    And the install command does not disable install scripts
    And no production host is contacted or changed

  Scenario: Reject an invalid manifest before setup
    Given the manifest is malformed or its install command differs from the approved allowlist
    When local manifest validation runs
    Then validation reports failure
    And the operator does not run the live setup command

  Scenario: Production CLI rejects an unapproved install command
    Given the manifest install command contains --ignore-scripts or another unapproved shell form
    When the production deployment CLI loads the manifest
    Then manifest validation fails
    And no remote connection is attempted
    And no live setup is attempted

  Scenario: Complete first setup after an explicit checkpoint
    Given local validation passed and DNS, server access, and server environment configuration are confirmed
    And the operator explicitly approved the live setup checkpoint
    When the operator runs deploy.ps1 -Site pantry-pal -Setup
    Then setup and deployment complete
    And unauthenticated HTTPS GET /api/health returns 200 with status ok

  Scenario: Keep setup blocked when production prerequisites are not ready
    Given local validation passed but a production prerequisite or human approval is missing
    When the operator reviews the readiness checklist
    Then the live setup command is not run
    And the environment is not reported as deployed

  Scenario: Verify redirect and headers on the live service
    Given the approved deployment is reachable at pantry.thirion.org
    When the operator requests the HTTP hostname and checks the HTTPS health endpoint and app document
    Then HTTP redirects to an HTTPS location
    And HTTPS responses include HSTS, the required CSP, nosniff, and a non-empty Referrer-Policy

  Scenario: Fail the transport check when a security contract is missing
    Given an HTTP request does not redirect to HTTPS or an HTTPS response omits a required header
    When the operator performs the production smoke check
    Then the security check fails
    And deployment acceptance remains blocked until a successful recheck

  Scenario: Keep authentication settings out of repository artifacts
    Given the service configuration is stored in /opt/pantry-pal/shared/.env
    When the implementer inspects source control and published deployment artifacts without reading secret values
    Then the service obtains BETTER_AUTH_SECRET and BETTER_AUTH_URL from the server file
    And no secret value or .env file is present in source control, build artifacts, logs, chat, or PRs

  Scenario: Block readiness when server authentication configuration is unavailable
    Given the required server environment file is missing, unreadable by the service user, has ownership other than root:pantry-pal, has mode other than 640, or a secret is found in a repository artifact
    When readiness is checked
    Then deployment is not reported as complete
    And the secret value is not repeated in diagnostic output

  Scenario: Verify environment-file access without exposing its contents
    Given /opt/pantry-pal/shared/.env is configured on the server
    When the operator checks file metadata and service-user readability without displaying contents
    Then the owner and group are root:pantry-pal and the mode is 640
    And the pantry-pal service user can read the file
    And users outside the pantry-pal group cannot read the file

  Scenario: Create and verify both household users
    Given the live service is healthy and the admin approved real-account setup
    When the admin creates one household and two users using the prompted CLI
    And each account holder signs in on their phone and installs and launches the PWA
    Then both accounts are verified as members of the intended household
    And both sign-in and install checks pass
    And passwords are absent from command arguments and recorded evidence

  Scenario: Leave onboarding incomplete after an account failure
    Given one user creation, household membership, sign-in, or phone installation check fails
    When the admin records onboarding status
    Then onboarding is marked incomplete
    And no password or session value is included in the record

  Scenario: Restore a provider backup and put the live database back
    Given a provider backup is selected and its timestamp recorded
    And the operator approved the maintenance window
    And a consistent independent copy of the current live database was verified
    When the operator stops the service and restores pantry.db from the provider backup
    And verifies PRAGMA integrity_check returns exactly ok and PRAGMA foreign_key_check returns zero rows
    And verifies SHA-256 checksums and sidecar presence match the selected backup
    And verifies read-only row counts for every SQLite table and change_counter.value match the selected backup
    Then the operator restores the pre-test live database before restarting the service
    And verifies integrity, foreign-key results, checksums, table counts, change_counter.value, and service health against the pre-test live copy
    And records no row values or personal data

  Scenario: Recover safely from a failed restore check
    Given an integrity, foreign-key, checksum, sidecar, table-count, or change-counter check fails or the restore is interrupted
    When the operator follows the recovery section of the runbook
    Then the service remains stopped until the verified pre-test database is restored
    And the provider backup is not left as the live database

  Scenario: Confirm runbook completeness and safety
    Given the runbook is reviewed against the approved design and current tool/CLI documentation
    When the reviewer checks setup, admin, deploy, rollback, security-check, and restore procedures
    Then each required procedure and production checkpoint is present
    And no command or example exposes a secret or password

  Scenario: Reject unsafe or incomplete runbook instructions
    Given the runbook omits a required procedure or includes a stale or unsafe instruction
    When the reviewer performs the runbook checklist
    Then the runbook is rejected until corrected
    And no unverified live database replacement is performed
```

## Test Awareness Matrix

| Category | Applicability | What to test and why | Watch out for |
| --- | --- | --- | --- |
| Manifest validation (Pester) | Required | Automated deploy-tool Pester tests validate AC-001's JSON shape, `node-systemd`/database configuration, and health path. Add a story-specific automated assertion that fails when the install command contains `--ignore-scripts` as a command-line token; the generic parser and existing suite do not prove this. | Do not invoke `-Setup`; the assertion must exercise a manifest with the prohibited token and fail it, while accepting the approved `npm ci` command. |
| Unit Tests (Backend) | Recommended | Run impacted admin CLI tests for the household/user commands and password prompt contract (AC-004). | Use isolated test data; never pass or persist a real password. This story does not authorize application-code changes. |
| Unit Tests (Frontend) | Not Applicable | No frontend code or behavior is changed by this infrastructure/runbook story. | Do not interpret production phone installation as a frontend unit-test requirement. |
| API Integration Tests | Recommended | Verify the existing unauthenticated health contract and auth/session behavior with isolated test users (AC-001, AC-004). | These tests do not establish that production DNS, TLS, Nginx, or server environment configuration is correct. |
| E2E / Playwright Tests | Required | Run the existing local/CI sign-in and PWA installability journey with non-production test users as automated coverage for AC-004. | Keep real account creation and sign-in on phones as a separate human checkpoint; do not use production credentials in test fixtures. |
| Accessibility (WCAG 2.1 AA) | Not Applicable | No UI changes are in scope. | Existing app accessibility coverage remains a separate release quality gate. |
| Translations / i18n | Not Applicable | No user-facing strings are introduced or changed. | Keep runbook operator instructions in the repository's existing documentation language. |
| Role-Based / Authorization | Required | Use automated integration coverage to verify both created test users map to the intended household and remain subject to existing household authorization rules (AC-004). | Do not infer membership from successful sign-in alone; verify the household association without exposing private account data. |
| Security (OWASP) | Recommended | Manual review of repository/build artifacts and the server-file handling contract for AC-003 and AC-006; verify `root:pantry-pal`, mode `0640`, service-user readability, and no access for users outside the service group. | This story defines no automated security test for secrets or live file permissions; manual checks do not qualify this row as Required. Never print `BETTER_AUTH_SECRET` or disclose file contents. |
| Production operational smoke checks | Recommended | After explicit human approval, record pass/fail for setup/health, HTTPS redirect/headers, two real-account phone checks, and provider restore/live-database recovery (AC-001 through AC-005). | These are live changes, not automated tests; obtain the required checkpoint and maintenance window first, and record no credentials or personal row data. |
| Runbook review | Recommended | Manual checklist review of commands and recovery branches against the current deploy-tool README, approved design, CLI contract, and SQLite safety requirements (AC-006). | This is a manual-only review, so it is Recommended rather than Required. Verify rollback database semantics and that the service is stopped before copying/swapping database files. |

## Assumptions

- ASSUMPTION-1: The approved `node-systemd`/SQLite deploy-tool implementation is sufficient; only a failing local manifest validation justifies revisiting that layout.
- ASSUMPTION-2: DNS for `pantry.thirion.org`, the existing Hetzner host, and required operator access are available, but are reconfirmed before any live setup.
- ASSUMPTION-3: The authorized operator can enter environment values directly on the server and passwords directly at the admin CLI prompt; neither is requested through chat or stored in an artifact.
- ASSUMPTION-4: The restore test is an approved maintenance operation; a consistent, independently verified pre-test copy of the live database is retained and restored before the service resumes.
- ASSUMPTION-5: Accepted security-header contract for AC-002: verify HSTS is present with a positive `max-age`; CSP contains `default-src 'self'`; `X-Content-Type-Options` is exactly `nosniff`; and `Referrer-Policy` is present and non-empty. The design does not prescribe an exact HSTS duration or `Referrer-Policy` value, so no more specific value is required.
- ASSUMPTION-6: Both created users are assigned to the single household; the story does not specify individual account names, email addresses, or passwords.
- ASSUMPTION-7: Accepted file-access contract for AC-003: `/opt/pantry-pal/shared/.env` is owned by `root:pantry-pal`, mode `0640`, readable by the `pantry-pal` service user, and inaccessible to users outside that group; authorized operator access is privileged. These are verified without displaying file contents.
- ASSUMPTION-8: Accepted restore-equivalence contract for AC-005: compare SHA-256 checksums of `pantry.db` and any `pantry.db-wal`, plus sidecar presence, SQLite integrity/foreign-key results, non-PII table row counts, and `change_counter.value`; record no database row values.

## Open Questions

- QUESTION-2: Which provider-backup timestamp and maintenance window will the operator select for the restore test? This is decided at the human checkpoint, not embedded in this artifact.
- QUESTION-3: Does the household admin want both production accounts created in the same onboarding session, or should the second account holder enter their password at a separate supervised CLI prompt? In either case, credentials remain directly entered and unrecorded.
