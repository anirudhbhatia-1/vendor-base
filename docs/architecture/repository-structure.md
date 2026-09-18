# Repository Structure and Import Boundaries

**Status:** Phases 2–11 built within the local synthetic scope; the workspace map below is enforced by `tooling/scripts/check-directory-ownership.mjs` and the import rules by `check-boundaries.mjs`

**Production authority:** None

## Workspace shape

```text
apps/
├── customer-pwa/       Next.js customer web application
├── customer-app/       Expo/React Native customer Android app
├── vendor-pwa/         Next.js vendor web application
├── vendor-app/         Expo/React Native vendor Android app
├── partner-pwa/        Next.js delivery-partner web application
├── partner-app/        Expo/React Native delivery-partner Android app
├── admin-pwa/          Next.js operations/admin web application
├── admin-app/          Expo/React Native operations/admin Android app
├── api/                NestJS/Fastify stateless HTTP process
└── worker/             NestJS/BullMQ independently runnable worker process

packages/
├── domain-types/       Framework-free shared names and value shapes
├── contracts/          Versioned HTTP and event contracts and the typed client
├── i18n/               Shared translation keys and catalogues
├── ui/                 Shared accessible web components (imports ui-tokens only)
├── ui-tokens/          Basic cross-platform design tokens
├── pwa-auth/           Browser session helpers shared by the four PWAs
├── app-auth/           Native session helpers shared by the four Expo shells
└── test-data/          Deterministic synthetic builders for tests only

database/               Reviewed migrations, PostGIS, Drizzle metadata and synthetic seed lifecycle
infrastructure/         Local Compose and future separately approved environment definitions
tests/                  Cross-application integration, E2E, conformance and performance tests
runbooks/               Containment, recovery, reconciliation and rollback procedures
tooling/                Executable repository policy and safety checks
.github/                Pull-request and issue intake templates
docs/                   Product, architecture, governance and evidence records
```

## Import rules

```text
applications ───────────────> approved shared packages
API / worker ───────────────> compiled database runtime
contracts ──────────────────> domain-types
test-data (tests only) ─────> contracts + domain-types

application ───X──> another application
package ───────X──> an application
client ────────X──> database, worker or provider implementation
production ────X──> test-data, fake adapters or scenario selectors
```

The client matrix is fixed at eight role clients:

| Role | PWA | Android app |
|---|---|---|
| Customer | `apps/customer-pwa/` | `apps/customer-app/` |
| Vendor | `apps/vendor-pwa/` | `apps/vendor-app/` |
| Delivery partner | `apps/partner-pwa/` | `apps/partner-app/` |
| Admin/support | `apps/admin-pwa/` | `apps/admin-app/` |

All local workspace dependencies use explicit `workspace:` versions. No application may reach into another package's source path; consumers use its declared package surface. Step 2.2 enforces these rules with TypeScript, lint and boundary checks.

## Top-level ownership

| Path | Accountable technical owner | Change boundary |
|---|---|---|
| `apps/` | Engineering Lead plus surface owner | Runtime applications; no cross-application source imports |
| `packages/` | Engineering Lead | Stable shared meaning only; no platform screens or server authority in clients |
| `database/` | Backend/Data owner | Reviewed migrations and synthetic seeds; no automatic schema sync |
| `infrastructure/` | Platform owner | Local definitions now; external/shared/production work needs a new approval |
| `tests/` | Engineering/QA owner | Cross-boundary verification with synthetic data |
| `runbooks/` | Operations plus capability owner | Safe containment, recovery, reconciliation and rollback |
| `tooling/` | Engineering/Security owner | Executable dependency, import-boundary and secret controls |
| `.github/` | Engineering/Operations owner | Safe structured review and issue intake; no external automation yet |
| `docs/` | Named document owner | Product contracts, decisions and evidence; no secrets or real personal data |

## Stable root commands

| Command | Responsibility |
|---|---|
| `pnpm build` | Build every package that defines a build script |
| `pnpm build:verify` | Build every executable workspace, start and request every PWA shell, and verify every Android export |
| `pnpm lint` | Run ESLint plus import-boundary and dependency-policy checks |
| `pnpm typecheck` | Apply the strict root TypeScript configuration |
| `pnpm test:unit` | Run every package unit-test script |
| `pnpm test:integration` | Run every package integration-test script |
| `pnpm format:check` | Check repository source/configuration formatting with Prettier |
| `pnpm test:controls` | Prove repository controls accept safe cases and reject unsafe cases |
| `pnpm security:secrets` | Scan tracked and unignored files for high-confidence secret shapes |
| `pnpm security:dependencies` | Query the pnpm advisory service for high-severity dependency issues |
| `pnpm dev` | Start application development scripts in parallel |
| `pnpm db:up` / `pnpm db:down` | Start or stop the persistent loopback-only local PostgreSQL/PostGIS service |
| `pnpm db:migrate` / `pnpm db:rollback` | Apply or safely revert paired reviewed migrations |
| `pnpm db:seed` / `pnpm db:reset` | Load or clear only deterministic synthetic fixture state |
| `pnpm db:verify` | Prove up/down/up, deterministic reset and rebuild from zero in the disposable test database |
| `pnpm verify:entrypoints` | Verify previously built PWA and Android entry-point artifacts without external services |

The commands are stable orchestration entry points. Step 2.2 makes formatting, linting, strict TypeScript defaults, repository-control tests and security checks operational. Step 2.3 adds static PWA builds, Android bundle exports, API/worker compilation, API health smoke tests, worker lifecycle smoke tests, secret-log sentinels and explicit rejection of production mode. Step 2.4 adds isolated database lifecycle commands and static safety controls. At Phase 2 completion, product-level unit tests remain empty until domain modules arrive.

Phase 3.1 makes `domain-types` a compiled runtime package for shared identifiers, money, time, quantities, deadlines and errors. Phase 3.2 adds request/trace/actor context, message and provider propagation envelopes, and protected-field redaction; the API and worker consume it through explicit `workspace:*` dependencies. Phase 3.3 makes `database` a compiled runtime package and adds the PostgreSQL-backed idempotent command boundary used by later domain modules. Phase 3.4 adds optimistic aggregate heads and append-only attributable transition history. Phase 3.5 adds transactional outbox delivery, per-consumer inbox deduplication and attributable dead-letter recovery. Phase 3.6 adds durable scheduled work, leased concurrent ownership, attempt history, retry/dead-letter recovery and queue health metrics. Phase 3.7 adds scoped immutable configuration, maker-checker activation, safe feature-flag evaluation, rollback provenance and business-record version snapshots. The Phase 3 exit-gate `reference_submission` module proves these foundations together under one request/correlation identity. See [Request Context and Correlation](../engineering/request-context-and-correlation.md), [Idempotent Command Handling](../engineering/idempotent-command-handling.md), [Aggregate Versioning and Transition Records](../engineering/aggregate-versioning-and-transitions.md), [Transactional Outbox and Inbox](../engineering/transactional-outbox-and-inbox.md), [Durable Scheduler and Jobs](../engineering/durable-scheduler-and-jobs.md), [Versioned Configuration and Feature Flags](../engineering/versioned-configuration-and-feature-flags.md), and [Phase 3 Reference Module](../engineering/phase-3-reference-module.md).

Phase 4.1 adds the server-only database package edge used by the API's synthetic OTP routes. Clients remain unable to import database code. Hashed challenges, protected test-only delivery, request/device/attempt/expiry controls, provider fault fixtures, safe replay, and the accessible customer PWA sign-in states are documented in [OTP Request and Verification](../engineering/otp-request-and-verification.md).

Phase 4.2 adds minimal users and hashed phone identities, safe per-user devices, opaque access/refresh credentials, refresh replay containment, session management APIs, and in-memory customer PWA sign-out. See [Sessions and Devices](../engineering/sessions-and-devices.md).

Phase 4.3 adds explicit roles, fine-grained capabilities, vendor-location staff memberships, partner eligibility/current-assignment evidence, scoped admin memberships, maker-checker exclusions, append-only membership events, and a default-deny evaluator. See [Roles, Capabilities, and Memberships](../engineering/roles-capabilities-and-memberships.md).

Phase 4.4 adds the opt-in NestJS authorization decorator, global session/capability guard, reusable domain enforcement service, safe concealed denials, and authenticated actor propagation. See [Authorization Enforcement](../engineering/authorization-enforcement.md).

Phase 4.5 adds explicit customer enrolment, optional customer profiles, English/Hindi preference, append-only versioned consent, consent-aware notification controls, and retention classification on sensitive identity rows. See [Customer Profile, Consent, and Preferences](../engineering/customer-profile-consent-and-preferences.md).

Phase 4.6 consolidates cross-customer, cross-vendor, wrong-location, inactive-assignment, wrong-role, self-approval, opaque-reference, and log-redaction abuse proofs. See [Identity and Access Isolation Proof](../engineering/identity-isolation-proof.md).

Phase 5.1 adds versioned vendor and vendor-location aggregates, synthetic business profiles, timezone-aware schedules and closures, PostGIS service zones, approved fulfilment modes, integer INR minimums, preparation durations, and enforceable staff-to-location references. See [Vendor and Location Domain](../engineering/vendor-and-location-domain.md).

Phase 5.2 adds lead, invitation, and direct-application onboarding; opaque business and payout references; protected synthetic document storage; maker-checker review; appeal and expiry/reverification evidence; guarded applicant/admin APIs; and matching vendor PWA/Android onboarding journeys. See [Vendor Onboarding and Verification](../engineering/vendor-onboarding-and-verification.md).

Phase 5.3 adds the server-computed publication launch strip, separate operator/reviewer approval, atomic vendor/location activation, pause/restore/unpublish containment, filtered admin APIs, immutable evidence, and matching admin PWA/Android pipeline workbenches. See [Vendor Publication Workflow](../engineering/vendor-publication-workflow.md).

Phase 5.4 adds counted and vendor-confirms inventory records, atomic expiring reservations, exact retry replay, server-time expiry, release restoration, location-contained vendor APIs, immutable evidence, and matching vendor PWA/Android stock ledgers. See [Inventory Reservation Lifecycle](../engineering/inventory-reservation-lifecycle.md).

Phase 5.5 adds one-active-attempt delivery assignment, expiring offers, exact partner authorization, package-count pickup verification, append-only assignment/custody evidence, controlled failed-delivery returns, and matching partner PWA/Android custody workbenches. See [Assignment and Custody Lifecycle](../engineering/assignment-and-custody-lifecycle.md).

Phase 5.6 adds integer-paise synthetic payment allocation, fake authorization/capture/refund/payout outcomes, maker-checker refunds, append-only balanced ledger posting, policy-derived vendor/partner settlement, unknown-result containment, statement reconciliation, and finance-authorized mutation APIs. See [Synthetic Money Lifecycle](../engineering/synthetic-money-lifecycle.md).

## Toolchain pins

- Node.js `24.19.0` in `.node-version`, `.nvmrc` and the root package engine.
- pnpm `11.19.0` in `packageManager` and the root package engine.
- One root `pnpm-lock.yaml` for every workspace package.

The developer's active shell must use the pinned Node version before framework installation or application verification. A newer Node version on a workstation does not change the repository pin.
