# Local application entry points

**Scope:** Phase 2 Steps 2.3–2.4 company-local entry points

**Production authority:** None

## Prerequisites

Use Node.js `24.19.0` and pnpm `11.19.0`, then run `pnpm install`. The repository rejects unknown runtime modes and does not define a production mode. No real credential, phone number, address, payment instrument, vendor record or partner record is required.

## Client matrix

| Role | PWA command and loopback URL | Android command and Metro port | Current visible result |
|---|---|---|---|
| Customer | `pnpm --filter @neighbourhood-store/customer-pwa dev` · `http://127.0.0.1:3100` | `pnpm --filter @neighbourhood-store/customer-app android` · `8081` | Internal discovery-lane shell; catalogue and ordering are disabled |
| Vendor | `pnpm --filter @neighbourhood-store/vendor-pwa dev` · `http://127.0.0.1:3101` | `pnpm --filter @neighbourhood-store/vendor-app android` · `8082` | Internal store-operations shell; onboarding and order actions are disabled |
| Delivery partner | `pnpm --filter @neighbourhood-store/partner-pwa dev` · `http://127.0.0.1:3102` | `pnpm --filter @neighbourhood-store/partner-app android` · `8083` | Internal delivery-lane shell; availability and assignments are disabled |
| Admin/support | `pnpm --filter @neighbourhood-store/admin-pwa dev` · `http://127.0.0.1:3103` | `pnpm --filter @neighbourhood-store/admin-app android` · `8084` | Internal control-room shell; queues and protected actions are disabled |

Every client makes synthetic/internal status unmistakable. There are no forms, fake success buttons or calls to the API. The PWA shells are server-rendered static pages. Android commands use Expo's local tooling; an emulator or explicitly approved local device is needed to inspect them interactively.

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
| `GET /health/ready` | The Step 2.3 process completed bootstrap | `status: ready`, with database and queue marked `not_configured` and `production_ready: false` |

Readiness does not mean production readiness. It only means the deliberately dependency-free skeleton can serve local requests. `APP_ENV` accepts `local`, `test` or `queue-compat`; `API_PORT` must be an integer from 1 through 65535. Invalid values fail startup with a structured error and a non-zero exit.

## Worker

Start the worker process with:

```sh
pnpm --filter @neighbourhood-store/worker dev
```

The worker starts a NestJS application context, logs a structured `worker.ready` event, installs SIGINT/SIGTERM shutdown hooks, and logs `worker.stopped` after cleanup. BullMQ is pinned but no queue is registered; queue configuration remains later work. The readiness event therefore declares `queue: not_configured` and `production_ready: false`.

## Database and PostGIS

Podman Desktop is the preferred free runtime. `pnpm db:up` starts the persistent local PostgreSQL/PostGIS service on `127.0.0.1:5432`; `pnpm db:down` stops it without deleting its named volume. Apply the reviewed blank baseline with `pnpm db:migrate`, inspect it with `pnpm db:status`, and load deterministic synthetic fixtures with `pnpm db:seed`.

`pnpm db:verify` uses a separate tmpfs-backed database on `127.0.0.1:5433`. It verifies PostgreSQL 18, PostGIS 3.6, forward migration, safe baseline rollback, forward migration again, repeated deterministic seed, fixture reset, and rebuild from zero. See `database/README.md` before using the guarded local rebuild command.

The API remains deliberately disconnected from PostgreSQL at Step 2.4, so its readiness response continues to report `database: not_configured` and `production_ready: false`.

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

Queue connectivity, API database wiring, provider adapters, authentication, authorization, real OTP delivery and every product workflow belong to later numbered steps.
