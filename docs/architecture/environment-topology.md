# Internal environment topology

**Status:** Local topology executable; Supabase database-only development active under D-13; the
synthetic company-test environment runs on Azure Container Apps under D-16 (17 September 2026)

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
| `supabase-production` | The profile the marketplace is developed and company-tested against: separate migration and least-privilege runtime identities through the pooler with `sslmode=verify-full`. Despite the name it holds only synthetic data and runs the fake adapters, and it is the profile the Azure company-test environment runs with `DATA_MODE=synthetic` and `ALLOW_SYNTHETIC_PROVIDERS` | Synthetic data; fake providers acknowledged at startup; filesystem object storage |
| `online-test` | The future staging profile: requires the approved integration/sandbox adapters and fails startup on a fake one | Not activated; D-15's adapters are unimplemented |

`supabase-dev` and `supabase-production` are database targets: clients never connect directly to
Supabase, while API and worker run on the developer workstation or, under D-16, as Azure Container
Apps. The name `supabase-production` predates D-16 and is a hazard the repair plan (R0.2) records:
it is the shared synthetic test database, not a production system, and D-14 requires production to
be a separate paid project. `staging` and `production` remain undefined as deployable environments.
Naming a configuration, provider, or external snapshot does not activate an environment.

## Company-test environment (D-16)

Per [D-16](../decisions/D-16.md), the synthetic company-test environment runs on Azure Container
Apps in Central India — one app each for the API, the worker, the customer PWA with its BFF, and
Valkey with internal TCP ingress — with the vendor, partner and admin static exports on Azure
Storage static websites, images built by GitHub Actions and deployed by digest, and the existing
synthetic Supabase development project as its database. `infrastructure/online-test/provider-targets.json`
records the current state; object storage, malware scanning, push, observability and analytics
remain `notYetConnected`. The OCI and Cloudflare targets researched under D-11/ADR-003 are recorded
there as superseded. Nothing measured on this environment is a capacity result for D-15's targets.

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

[D-13](../decisions/D-13.md) narrowly resumed Supabase database use and required rotation of the
previously exposed credential; [D-16](../decisions/D-16.md) provisioned the Azure company-test
environment. The runbook's gate for making it the daily shared environment (company-owned accounts
with MFA and two administrators, the CI gate enforced on `main`, two versioned deployments and a
rollback rehearsal, an isolated backup restore, budget alerts) is still open. D-15's approved
adapters remain unimplemented, D-10 separately governs recovery objectives, and production provider
selection remains blocked.
