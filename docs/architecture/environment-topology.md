# Internal environment topology

**Status:** Local topology executable; Supabase database-only development active under D-13;
broader online company-test work paused by D-12

**External exposure:** Prohibited by default

## Developer workstation

```text
Host processes
├── Next.js PWA development server
├── Expo/React Native development server and Android tooling
├── NestJS/Fastify API
├── NestJS BullMQ worker
└── Jest, Playwright, and Maestro test commands

compose.yaml
├── PostgreSQL 18 + PostGIS 3.6
├── Valkey 9.1.x
└── Redis 7.2.x (explicit compatibility profile only)

Repository-local runtime data
├── synthetic seed data
├── fake provider outboxes and fixtures
└── filesystem-adapter objects
```

Host-run applications provide fast reload and direct debugging. Compose provides repeatable stateful infrastructure. Podman Desktop is the preferred free runtime, while the file must remain compatible with Docker Compose.

The Step 2.3 API and worker still report `production_ready: false`; Step 2.4 does not connect them to the database. PostgreSQL/PostGIS now has separately isolated local and disposable-test definitions plus migration tooling. Valkey/Redis, BullMQ queue registration, storage, identity and provider adapters remain unconnected. Their presence in the intended topology is not a claim that they are running.

## Environment names

| Name | Purpose | Allowed data and integrations |
|---|---|---|
| `local` | Normal developer work | Synthetic data; local filesystem; fake providers only |
| `test` | Automated isolated verification | Ephemeral synthetic fixtures; fake providers only |
| `queue-compat` | BullMQ compatibility verification | Synthetic jobs; Valkey and Redis profiles tested separately |
| `supabase-dev` | Locally run API/worker using a Supabase-hosted database | Synthetic data; local filesystem; fake providers only |
| `online_test` | Paused future private company online testing using the D-11 provider set | No active execution; synthetic data only if D-12 is later superseded |

`supabase-dev` is database-only: clients never connect directly to Supabase, while API and worker
continue running on the developer workstation. `online_test` is still paused. `staging` and
`production` remain undefined as deployable environments. Naming a configuration, provider, or
external snapshot does not activate an environment.

## Selected online company-test target

Per [ADR-003](ADR-003-free-online-company-test-stack.md), the paused future `online_test` topology researched Cloudflare for the four PWAs/CDN/R2, Supabase Free for PostgreSQL/PostGIS, OCI Always Free for the API/worker/Valkey/ClamAV, FCM/Web Push for notifications, Grafana Cloud and PostHog for telemetry, and GitHub Free for source hosting and future CI.

Four synthetic Cloudflare Pages snapshots and a Supabase/PostGIS baseline were created before the
pause. D-13 now permits the selected Supabase project to act as a synthetic development database
for locally run API and worker processes. R2, OCI and the remaining online adapters are not active.
The ignored Supabase environment file is separate from normal local configuration.

## Network and credential rules

- Bind local infrastructure to loopback unless a separately reviewed device-testing need requires LAN access.
- Use non-secret local defaults and committed example environment files.
- Never commit real credentials, personal data, business documents, phone numbers, payment details, or exact customer locations.
- Android device testing may connect to the host API through an explicitly documented local address; that exception must not expose the service to the public internet.
- Fake adapters must reject accidental live endpoints and make synthetic mode visible in logs and UI test fixtures.

## Data lifecycle

- Seed data is fictional and repeatable.
- Local database volumes and filesystem objects are disposable development state, not backups.
- Tests create isolated records and clean them without depending on a developer's normal local dataset.
- No local retention behaviour is presented as the future production privacy or backup policy.

## Future gate

[D-13](../decisions/D-13.md) narrowly resumes Supabase database use and requires rotation of the
previously exposed credential. D-12 continues to block every broader online-test component. D-11
and ADR-003 still require company-owned accounts, identity, secrets, encryption, network isolation,
observability, backup, restore, rollback, quota, regional and capacity evidence. D-10 separately
governs recovery objectives. Production provider selection remains blocked.
