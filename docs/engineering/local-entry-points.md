# Local application entry points

**Scope:** Phase 2 Steps 2.3–2.4 company-local entry points

**Production authority:** None

## Prerequisites

Use Node.js `24.19.0` and pnpm `11.19.0`, then run `pnpm install`. The repository rejects unknown runtime modes and does not define a production mode. No real credential, phone number, address, payment instrument, vendor record or partner record is required.

## Client matrix

| Role | PWA command and loopback URL | Android command and Metro port | Current visible result |
|---|---|---|---|
| Customer | `pnpm --filter @neighbourhood-store/customer-pwa dev` · `http://127.0.0.1:3100` | `pnpm --filter @neighbourhood-store/customer-app android` · `8081` | API-backed sign-in, address, discovery, catalogue, grouped cart/checkout, orders, ratings and support |
| Vendor | `pnpm --filter @neighbourhood-store/vendor-pwa dev` · `http://127.0.0.1:3101` | `pnpm --filter @neighbourhood-store/vendor-app android` · `8082` | API-backed catalogue, imports, inventory and order fulfilment |
| Delivery partner | `pnpm --filter @neighbourhood-store/partner-pwa dev` · `http://127.0.0.1:3102` | `pnpm --filter @neighbourhood-store/partner-app android` · `8083` | API-backed assignment, custody, exception, offline proof and earnings workflow |
| Admin/support | `pnpm --filter @neighbourhood-store/admin-pwa dev` · `http://127.0.0.1:3103` | `pnpm --filter @neighbourhood-store/admin-app android` · `8084` | API-backed publication, moderation, controlled access, risk queue, reporting, audit and local notification control plane |

Every client makes synthetic/internal status unmistakable. The role workflows call the local API
and show persisted server state; synthetic provider controls are labelled explicitly. Android
commands use Expo's local tooling; an emulator or explicitly approved local device is needed to
inspect them interactively.

`pnpm build` creates optimized static PWA output, Android Hermes bundles under each app's ignored `dist/`, and compiled API/worker output under ignored `dist/` directories.

## API

Start the development process with:

```sh
pnpm --filter @neighbourhood-store/api dev
```

The default address is `http://127.0.0.1:3001`.

| Route | Meaning | Step 2.3 response |
|---|---|---|
| `GET /health/live` | The HTTP process is alive | `status: ok`, runtime mode and version |
| `GET /health/ready` | The process completed bootstrap and dependency checks | Current local database/queue readiness, always with `production_ready: false` |

Readiness does not mean production readiness. It means the local process can serve and its
configured company-test dependencies are reachable: `checks.database` (a live connection, 503 when
unreachable), `checks.job_schema` (the job tables exist), `async_processing.broker` (a real Valkey
`PING`), `async_processing.workers` (a durable heartbeat within 90 s) and the oldest pending job
age. `APP_ENV` accepts `local`, `test`, `queue-compat`, `supabase-dev`, `supabase-production` or
`online-test`; only the first three may run the fake adapters without
`ALLOW_SYNTHETIC_PROVIDERS=synthetic-testing-only` or fall back to committed key material.
`API_PORT` must be an integer from 1 through 65535. Invalid values fail startup with a structured
error and a non-zero exit.

## Worker

Start the worker process with:

```sh
pnpm --filter @neighbourhood-store/worker dev
```

The worker starts a NestJS application context, logs a structured `worker.ready` event, writes a
durable heartbeat the API's readiness reads, installs SIGINT/SIGTERM shutdown hooks with a
configurable drain grace (`WORKER_SHUTDOWN_GRACE_MS`), and logs `worker.stopped` after cleanup.
PostgreSQL-backed durable jobs and the transactional outbox are the authority for
inventory/quote/offer/document/decision expiry, partner wait thresholds, configuration activation,
local notification delivery and dispatch; BullMQ over Valkey (`VALKEY_URL`, required) is the
wake-up and distribution layer, so `pnpm db:up` provides Valkey alongside PostgreSQL. The domain
event routing lives in `apps/worker/src/domain-event-handler.ts` and is unit-tested per branch.

## Database and PostGIS

Podman Desktop is the preferred free runtime. `pnpm db:up` starts the persistent local PostgreSQL/PostGIS service on `127.0.0.1:5432`; `pnpm db:down` stops it without deleting its named volume.

The full local sequence is four commands, not two:

```sh
pnpm db:migrate           # reviewed migrations onto the blank baseline
pnpm db:seed              # fixture-determinism records in marketplace_test only
pnpm db:seed:marketplace  # a browsable synthetic marketplace in the marketplace schema
pnpm db:seed:admin        # a first admin; needs ADMIN_PHONE, optionally ADMIN_PASSWORD
```

`pnpm db:seed` is a determinism harness, not an application seed: it writes seven records to
`marketplace_test.fixture_records` and touches the `marketplace` schema not at all. Stopping
after it leaves a correctly migrated database with **no vendor, no catalogue, no customer and
no admin**, so all eight clients render correct and entirely empty screens with nothing to
explain why. `db:seed:marketplace` and `db:seed:admin` are what make the apps usable.
Re-running `db:seed:marketplace` is safe — verified: a second run left the vendor, product and
user counts unchanged. `db:seed:admin` is idempotent by phone identity per its own contract.
Inspect migration state at any point with `pnpm db:status`.

`pnpm db:verify` uses a separate tmpfs-backed database on `127.0.0.1:5433`. It verifies PostgreSQL 18, PostGIS 3.6, forward migration, safe baseline rollback, forward migration again, repeated deterministic seed, fixture reset, and rebuild from zero. See `database/README.md` before using the guarded local rebuild command.

The API and worker use PostgreSQL for the implemented marketplace workflows. They still report
`production_ready: false` because this repository is authorized only for synthetic development.

### Supabase database-only mode

Follow `runbooks/supabase-dev/README.md`, then use:

```sh
pnpm db:status:supabase
pnpm db:migrate:supabase
pnpm dev:supabase
```

This starts the API and worker locally with `APP_ENV=supabase-dev` and reads the ignored
`infrastructure/supabase-dev/.env` file. Supabase hosts PostgreSQL/PostGIS only. PWAs and Android
apps still call the local API, and fake providers/local object storage remain active. Never place
the Supabase connection string in a client environment variable.

### Supabase Auth sign-in for the PWAs

The four PWA sign-in screens use Supabase Auth. `next dev` and `next build` read environment
files from the app directory only, so a plain `pnpm dev` starts them without
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` and every login page reports
"Supabase env not detected". Fill `infrastructure/supabase-dev/.env` from
`infrastructure/supabase-dev/env.example`, then use:

```sh
pnpm dev:supabase-development
```

That runs the API, worker and all four PWAs with `APP_ENV=supabase-dev`, against the separate
Supabase development project. The `supabase-production` counterpart runs the same local processes
with the same synthetic providers against the second Supabase project — provisioned to D-14's
least-privilege design (separate migration and `marketplace_app` runtime identities,
`sslmode=verify-full`) but holding only synthetic data, and the project the Azure company-test
environment shares under D-16. Despite the profile's name it is not a production system; the name
is a recorded hazard (repair plan R0.2), which is why the preflight banner names the database it is
about to write to:

```sh
pnpm dev:supabase-production
```

Each PWA is started through `tooling/scripts/run-with-public-env.mjs`, which forwards only the
`NEXT_PUBLIC_*` keys of that file; `SUPABASE_SERVICE_ROLE_KEY` and the database URLs never enter
the Next.js process and therefore cannot be inlined into a client bundle. Single apps use their own
scripts, for example:

```sh
pnpm --filter @neighbourhood-store/admin-pwa dev:supabase-production
pnpm --filter @neighbourhood-store/admin-pwa build:supabase-production
```

Restart an already running dev server after filling the file; Next.js reads these values at process
start.

The aggregate command checks ports 3001 and 3100–3103 before it starts. If a previous stack is
still running, stop that terminal with Ctrl+C before starting another one. API and worker watch
mode is intentionally limited to each service's `src/` directory: unrestricted Node watch mode
follows the full pnpm dependency graph and can exhaust macOS file descriptors. The environment
and public-environment launchers forward shutdown signals to their children so a normal Ctrl+C or
an aggregate startup failure does not leave watcher processes behind. After upgrading from a
version that predates this protection, existing orphaned processes must be stopped once (or the
machine restarted); a new launcher cannot safely terminate processes it did not create.

## Structured logs and sensitive values

API and worker logs are one JSON object per line. Startup events include service, environment, version and bounded non-secret status fields. Logger calls do not enumerate environment variables or serialize arbitrary configuration objects. Integration smoke tests place a synthetic sentinel in the environment and fail if it appears in output.

## Repository controls

Alongside the language and test gates, `pnpm lint` runs a set of controls that
assert things type checking cannot see. Each is self-tested by `pnpm test:controls`.

| Control | What it prevents |
|---|---|
| `tooling/scripts/check-boundaries.mjs` | Cross-module imports that break the layering |
| `tooling/scripts/check-dependency-policy.mjs` | Inexact external dependency versions |
| `tooling/scripts/verify-api-contracts.mjs` | The typed client declaring a path the API does not serve |
| `tooling/scripts/verify-feature-matrix.mjs` | `docs/feature-matrix.json` drifting from `FEATURES.md` |
| `tooling/scripts/verify-ci-workflow.mjs` | CI losing a required gate |
| `tooling/scripts/verify-online-test-deployment.mjs` | The online-test deployment losing its synthetic guarantees |
| `tooling/scripts/ensure-packages-built.mjs` | A stale `dist/` silently breaking consumers at runtime |
| `tooling/scripts/run-node-watch.mjs` | API/worker watch mode exhausting file descriptors or orphaning its child |
| `tooling/scripts/assert-dev-ports-available.mjs` | A second aggregate stack starting over an existing one |
| `tooling/scripts/scan-secrets.mjs` | Committed credentials |

`ensure-packages-built.mjs` also runs ahead of every `dev`, `start` and `android`
script, once at the root of `pnpm test:unit`, and in the `test:unit` script of
every workspace that imports another package's runtime. Shared packages resolve
types from `src/` but runtime from `dist/`, so TypeScript validates code Node
never loads: a stale build fails only at runtime, with a missing-export error
that looks nothing like its cause. On a fresh clone there is no `dist/` at all,
which is how CI failed on every push from 18 August to 17 September 2026 — the
root guard builds the packages one at a time before the recursive run, so
sibling packages do not race to emit the same `dist/`.

## Gated capabilities

`FEATURES.md` section 15 lists capabilities that may exist only after a named
legal, financial or privacy approval. `marketplace.gated_capabilities` is the
register that enforces it: every capability starts `UNAVAILABLE`, and
`GatedCapabilityService.assertAvailable` refuses any code path that reaches for
one without an approval recorded against a named approver, a durable reference
and evidence. Approvals are append-only. Operators read the register and record
decisions through `GET`/`POST /admin/gated-capabilities`, which requires
`admin.gated.review`.

## Verification

- `pnpm typecheck` refreshes each PWA's generated production route declarations and checks every executable workspace under the strict TypeScript baseline. This avoids mixing stale development and production route globals after alternating `next dev` and `next build`.
- `pnpm lint` checks source, imports and exact dependency policy.
- `pnpm build` proves all four PWAs, all four Android shells, the API and the worker compile/export.
- `pnpm build:verify` additionally starts each built PWA on its loopback port, requests its role-specific page, verifies each Android Hermes export, and cleans up every process it starts.
- `pnpm test:integration` probes API liveness/readiness, verifies API and worker graceful shutdown, checks that the log sentinel is absent, and proves `APP_ENV=production` fails closed.
- `pnpm db:verify` runs the destructive database lifecycle only against the exact disposable test database.
- `pnpm test:e2e` drives the four PWAs in a real browser. `pnpm test:e2e:install` fetches the browser once. Specs that need a live Supabase stack skip unless `LIVE_SUPABASE_ACCEPTANCE=true` and the per-role acceptance credentials are set, rather than asserting something weaker.
- `pnpm db:test:up` starts the disposable PostgreSQL/PostGIS and Valkey services and applies the migrations, which the integration smokes need.
- `pnpm check` combines formatting, lint, types, repository controls, available tests, browser end-to-end tests, secret scanning, and — since it was possible for `check` to pass while these were failing — `build:verify` and `build:online-test:pwas`.
- `pnpm db:production:verify` is deliberately **not** part of `pnpm check`: it needs live Supabase credentials, network access and the CA certificate, so including it would make `check` unrunnable offline and on a fresh clone. Run it at release time, after `pnpm db:status:production` shows no pending migrations — it asserts exactly that, among other production preconditions.

Real external providers, production infrastructure, production credentials and public launch
authority remain outside this local entry-point contract.
