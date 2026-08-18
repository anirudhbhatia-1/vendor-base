# Internal environment topology

**Status:** Local topology executable; online company-test providers selected but not deployed

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
| `online_test` | Future private company online testing using the D-11 provider set | Synthetic data by default; controlled real cases require separate approval |

`online_test` is a selected target, not an implemented runtime mode. `development`, `staging`, and `production` remain undefined as deployable environments. Naming a configuration or provider does not create an environment.

## Selected online company-test target

Per [ADR-003](ADR-003-free-online-company-test-stack.md), the future private `online_test` topology uses Cloudflare for the four PWAs/CDN/R2, Supabase Free for PostgreSQL/PostGIS, OCI Always Free for the API/worker/Valkey/ClamAV, FCM/Web Push for notifications, Grafana Cloud and PostHog for telemetry, and GitHub Free for source hosting and future CI.

Step 2.5 now supplies a locally proven GitHub Actions definition; its first external run and branch enforcement still need authorized GitHub activation. The local topology remains the default until Step 2.6 separately provisions and verifies the online skeleton. No cloud credential or live adapter belongs in local configuration.

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

Before any shared company server or external deployment, D-11 and ADR-003 require company-owned accounts, identity, secrets, encryption, network isolation, observability, backup, restore, rollback, quota, regional, and capacity evidence. D-10 separately governs recovery objectives. Production provider selection remains blocked.
