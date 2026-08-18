# Continuous Integration

**Status:** Step 2.5 repository configuration complete; external GitHub execution not yet evidenced
**Provider:** GitHub Actions on GitHub Free
**Data mode:** Synthetic only
**Production authority:** None

## Workflow

The mandatory repository workflow is `.github/workflows/ci.yml`. It runs for pull requests, pushes to `main` and `start`, and explicit manual dispatches. One `ubuntu-24.04` job is used to conserve GitHub Free minutes and avoid moving untrusted build artifacts between jobs.

The job has:

- a 30-minute timeout and concurrency cancellation for superseded runs;
- only `contents: read` token permission;
- checkout credentials disabled after checkout;
- no secrets, cloud credentials, real providers, deployments, or real data;
- exact Node.js `24.19.0` and pnpm `11.19.0`;
- immutable full-commit pins for every external action;
- only the pnpm content-addressed store cached, keyed by `pnpm-lock.yaml`; and
- a seven-day artifact containing outcomes only, never logs or application artifacts.

## Mandatory gates

The final gate fails unless every item reports success:

1. frozen-lockfile installation;
2. formatting;
3. ESLint, import boundaries, exact-dependency policy, and CI workflow controls;
4. workspace type checking;
5. repository-control self-tests;
6. unit tests;
7. API/worker integration smoke tests;
8. all PWA, Android, API, and worker builds plus entry-point verification;
9. disposable PostgreSQL/PostGIS up/down/up migration, fixture and isolation verification;
10. high-or-critical production dependency audit under the reviewed exception policy;
11. committed-secret scanning; and
12. disposable database cleanup.

Individual check steps use `continue-on-error` only so all evidence is collected in one run. `tooling/scripts/ci-evidence.mjs gate` then converts any failed, cancelled, skipped, or unreported result into a failing job. This does not weaken merge blocking.

## Evidence

`tooling/scripts/ci-evidence.mjs write` creates:

- `.ci-artifacts/summary.json`; and
- `.ci-artifacts/summary.md`, also appended to the GitHub job summary.

The report contains only the repository/commit/run identifiers and named step outcomes. It excludes command logs, credentials, environment values, test payloads, personal data, provider payloads, database dumps, coverage source, and compiled applications. GitHub retains the uploaded report for seven days.

## Dependency updates

`.github/dependabot.yml` requests bounded weekly updates for GitHub Actions and the pnpm lockfile. Dependency updates must pass the same mandatory workflow. Dependabot configuration does not approve automatic merges.

## Required GitHub activation

Repository files cannot prove an external runner or branch rule. After an authorized push to the selected company-owned GitHub repository:

1. run the workflow manually once on `start`;
2. verify the runner resolves each immutable action and exact toolchain version;
3. verify the database lifecycle and cleanup on the hosted runner;
4. download and inspect the safe evidence artifact;
5. require the **Mandatory quality gate** check in branch protection/rulesets for protected branches;
6. prohibit direct bypass except through a named emergency process;
7. configure Actions minute/storage budget alerts and retention; and
8. record the run URL, commit, branch-rule evidence, owner and review date without copying credentials into Git.

Until this evidence exists, the workflow is repository-complete but external enforcement remains unproven. No push, repository-setting change, account creation, billing change, or workflow run is authorized by this document.

## Local equivalent

Use:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build:verify
pnpm db:verify
pnpm security:dependencies
pnpm ci:verify
```

These commands prove the repository behavior. They do not prove GitHub availability, branch protection, hosted-runner container behavior, or the GitHub Free quota.
