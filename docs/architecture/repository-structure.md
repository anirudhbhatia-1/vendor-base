# Repository Structure and Import Boundaries

**Status:** Executable through Step 2.3 for company-local development

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
├── contracts/          Versioned HTTP and event contracts
├── i18n/               Shared translation keys and catalogues
├── ui-tokens/          Basic cross-platform design tokens
└── test-data/          Deterministic synthetic builders for tests only

database/               Reviewed migrations, PostGIS and synthetic seed lifecycle
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
| `pnpm lint` | Run ESLint plus import-boundary and dependency-policy checks |
| `pnpm typecheck` | Apply the strict root TypeScript configuration |
| `pnpm test:unit` | Run every package unit-test script |
| `pnpm test:integration` | Run every package integration-test script |
| `pnpm format:check` | Check repository source/configuration formatting with Prettier |
| `pnpm test:controls` | Prove repository controls accept safe cases and reject unsafe cases |
| `pnpm security:secrets` | Scan tracked and unignored files for high-confidence secret shapes |
| `pnpm security:dependencies` | Query the pnpm advisory service for high-severity dependency issues |
| `pnpm dev` | Start application development scripts in parallel |

The commands are stable orchestration entry points. Step 2.2 makes formatting, linting, strict TypeScript defaults, repository-control tests and security checks operational. Step 2.3 adds static PWA builds, Android bundle exports, API/worker compilation, API health smoke tests, worker lifecycle smoke tests, secret-log sentinels and explicit rejection of production mode. Product-level unit tests remain empty until domain modules arrive.

## Toolchain pins

- Node.js `24.19.0` in `.node-version`, `.nvmrc` and the root package engine.
- pnpm `11.19.0` in `packageManager` and the root package engine.
- One root `pnpm-lock.yaml` for every workspace package.

The developer's active shell must use the pinned Node version before framework installation or application verification. A newer Node version on a workstation does not change the repository pin.
