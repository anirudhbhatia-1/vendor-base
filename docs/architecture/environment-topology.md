# Internal local environment topology

**Status:** Host application processes executable; stateful services remain Step 2.4 work

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

The Step 2.3 API and worker deliberately report `production_ready: false`. Database, PostGIS, Valkey/Redis, BullMQ queue registration, storage, identity and provider adapters are not connected by this step. Their presence in the intended topology is not a claim that they are running.

## Environment names

| Name | Purpose | Allowed data and integrations |
|---|---|---|
| `local` | Normal developer work | Synthetic data; local filesystem; fake providers only |
| `test` | Automated isolated verification | Ephemeral synthetic fixtures; fake providers only |
| `queue-compat` | BullMQ compatibility verification | Synthetic jobs; Valkey and Redis profiles tested separately |

`development`, `staging`, and `production` are intentionally undefined as deployable environments. Naming a configuration file does not create or approve an environment.

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

Before any shared company server or external deployment, D-03 must be extended or superseded with hosting, identity, secrets, encryption, network isolation, observability, backup, restore, rollback, cost, regional, and capacity evidence. D-10 must separately approve recovery objectives.
