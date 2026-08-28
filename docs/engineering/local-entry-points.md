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
configured company-test dependencies are reachable. `APP_ENV` accepts `local`, `test` or
`queue-compat`; `API_PORT` must be an integer from 1 through 65535. Invalid values fail startup
with a structured error and a non-zero exit.

## Worker

Start the worker process with:

```sh
pnpm --filter @neighbourhood-store/worker dev
```

The worker starts a NestJS application context, logs a structured `worker.ready` event, installs
SIGINT/SIGTERM shutdown hooks, and logs `worker.stopped` after cleanup. PostgreSQL-backed durable
jobs own inventory/quote/offer/document/decision expiry, partner wait thresholds, configuration
activation, local notification delivery and outbox dispatch. Valkey/BullMQ remains an optional
scale adapter; it is not required for correctness in the approved local environment.

## Database and PostGIS

Podman Desktop is the preferred free runtime. `pnpm db:up` starts the persistent local PostgreSQL/PostGIS service on `127.0.0.1:5432`; `pnpm db:down` stops it without deleting its named volume. Apply the reviewed blank baseline with `pnpm db:migrate`, inspect it with `pnpm db:status`, and load deterministic synthetic fixtures with `pnpm db:seed`.

`pnpm db:verify` uses a separate tmpfs-backed database on `127.0.0.1:5433`. It verifies PostgreSQL 18, PostGIS 3.6, forward migration, safe baseline rollback, forward migration again, repeated deterministic seed, fixture reset, and rebuild from zero. See `database/README.md` before using the guarded local rebuild command.

The API and worker use PostgreSQL for the implemented marketplace workflows. They still report
`production_ready: false` because this repository is authorized only for company-local synthetic
development.

## Structured logs and sensitive values

API and worker logs are one JSON object per line. Startup events include service, environment, version and bounded non-secret status fields. Logger calls do not enumerate environment variables or serialize arbitrary configuration objects. Integration smoke tests place a synthetic sentinel in the environment and fail if it appears in output.

## Verification

- `pnpm typecheck` refreshes each PWA's generated production route declarations and checks every executable workspace under the strict TypeScript baseline. This avoids mixing stale development and production route globals after alternating `next dev` and `next build`.
- `pnpm lint` checks source, imports and exact dependency policy.
- `pnpm build` proves all four PWAs, all four Android shells, the API and the worker compile/export.
- `pnpm build:verify` additionally starts each built PWA on its loopback port, requests its role-specific page, verifies each Android Hermes export, and cleans up every process it starts.
- `pnpm test:integration` probes API liveness/readiness, verifies API and worker graceful shutdown, checks that the log sentinel is absent, and proves `APP_ENV=production` fails closed.
- `pnpm db:verify` runs the destructive database lifecycle only against the exact disposable test database.
- `pnpm check` combines formatting, lint, types, repository controls, available tests and secret scanning.

Real external providers, production infrastructure, production credentials and public launch
authority remain outside this local entry-point contract.
