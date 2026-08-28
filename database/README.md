# Database migration and synthetic-fixture workflow

**Scope:** Phase 2.4 database lifecycle, Phase 3 shared persistence controls, Phase 4 synthetic identity/access controls, Phase 5.1–5.7 vendor/catalogue/delivery/money domain, and Phase 6.1–6.7 customer address/discovery/cart domain, company-local and isolated test databases only

**Production authority:** None

This directory owns reviewed PostgreSQL/PostGIS migrations, Drizzle schema metadata, deterministic synthetic fixtures, and lifecycle verification. PostgreSQL remains authoritative. Automatic schema synchronization and `drizzle-kit push` are prohibited.

## Local services

The root `compose.yaml` defines:

| Service | Address | Database | Storage | Intended use |
|---|---|---|---|---|
| `database` | `127.0.0.1:5432` | `neighbourhood_store_local` | Named local volume | Normal developer work |
| `database-test` | `127.0.0.1:5433` | `neighbourhood_store_test` | Container tmpfs | Destructive migration/seed verification |

Both use the immutable digest recorded for `postgis/postgis:18-3.6`, which currently contains PostgreSQL 18 and PostGIS 3.6.4. The PostgreSQL 18 data path is `/var/lib/postgresql`, not the pre-18 `/var/lib/postgresql/data` path.

Health requires both `pg_isready` and PostgreSQL to be the container's PID 1 process. This prevents Compose from accepting the temporary server used by the PostGIS initialization scripts before the final database process starts.

Podman Desktop is preferred; Docker Compose remains compatible. The wrapper detects either runtime:

```sh
pnpm db:config
pnpm db:up
pnpm db:down
pnpm db:test:up
pnpm db:test:down
```

Stopping the local service preserves its named volume. The test service uses tmpfs and its container is removed after full verification. No root command deletes the named local volume.

The official PostgreSQL 18/PostGIS 3.6 image currently targets `linux/amd64`, so Compose declares that platform explicitly. On Apple silicon, Podman runs it under local emulation; this development compatibility choice is not a production architecture decision.

## Migration commands

```sh
pnpm db:migrate
pnpm db:status
pnpm db:rollback
```

Each migration is a reviewed pair:

```text
database/migrations/NNNN_name.up.sql
database/migrations/NNNN_name.down.sql
```

The runner:

- accepts only the exact loopback local/test database names;
- obtains a PostgreSQL advisory lock so two migration processes cannot interleave;
- wraps each migration and ledger update in one transaction;
- records a SHA-256 checksum and rejects an applied migration changed afterward;
- requires both up and down files;
- rolls back in reverse applied order; and
- emits bounded JSON events without connection strings or credentials.

Migration SQL must not contain `BEGIN`, `COMMIT`, or `ROLLBACK`; transaction ownership belongs to the runner. Use additive expand-and-contract migrations. A destructive or irreversible change needs a separately approved recovery plan and must not be disguised as an empty down file.

The reviewed migration ladder is authoritative and currently runs from `0000_baseline` through
`0037_local_notifications`. It covers the shared reliability/identity foundations, vendor and
catalogue lifecycle, customer shopping and checkout, fulfilment/custody, complete synthetic money,
partner/admin operations, search/localization, partner availability and wait policy, controlled
admin provisioning, and local notification delivery. `pnpm db:status` prints the exact ordered
files; later migrations must always roll back before the baseline.

Drizzle configuration lives in `drizzle.config.ts`, and typed schema declarations start in `schema.ts`. Drizzle-generated SQL must be converted into a paired reviewed migration before execution. Never apply automatic schema synchronization.

## Deterministic synthetic fixtures

```sh
pnpm db:seed
pnpm db:reset
```

Fixtures live only in `marketplace_test.fixture_records`, separate from the future authoritative domain schema. Every display name starts with `SYNTH`, every JSON payload carries `synthetic: true`, and database checks reject missing markers. Seed execution deletes and recreates the same seven ordered records and verifies a canonical SHA-256 hash. It never loads customer identity, phone, address, payment, document, or real store data.

`db:reset` drops only the `marketplace_test` fixture schema. It does not touch domain state, migrations, or the local database volume.

## Rebuild and lifecycle proof

Rebuilding is deliberately guarded:

```sh
DB_REBUILD_CONFIRM=rebuild-neighbourhood-store-local pnpm db:rebuild
```

The guard and exact database-name/loopback checks must all pass. Rebuild removes only the approved local database's marketplace schemas, migration ledger, and PostGIS extension, then runs migration-up and deterministic seed from zero.

Use the disposable test database for the complete proof:

```sh
pnpm db:verify
```

It starts `database-test`, proves PostgreSQL 18 and PostGIS 3.6, runs up, repeated seed, fixture reset, down, up, and rebuild-from-zero, then removes the disposable test container. `pnpm db:verify:connected` runs the same lifecycle against an already-started test service.

## Adding a migration

1. Add or change typed definitions in `schema.ts`.
2. Generate or draft SQL locally, but do not use push/synchronization.
3. Review exact PostgreSQL SQL and create matching `up` and `down` files.
4. Ensure the SQL contains no transaction-control statements.
5. Run the static checks and `pnpm db:verify` from a clean test database.
6. Record data backfill, lock duration, rollback limits, query/index impact, and operational ownership in the change.

Database migrations never select hosting, production credentials, backup policy, recovery objectives, or permission to process real data.

## Vendor and location domain

The compiled database package exports `VendorNetworkService`. It keeps business profiles, weekly hours, calendar exceptions, temporary closures, service zones, approved fulfilment modes, integer INR minimums, and preparation durations in one location-version transaction boundary. Operational status applies timezone and closure precedence and optionally proves PostGIS zone containment. See [Vendor and Location Domain](../docs/engineering/vendor-and-location-domain.md).

## Vendor onboarding and verification

The database package exports `VendorOnboardingService` and the `ProtectedObjectStorage` contract. The company-local adapter accepts only marked synthetic documents, applies deterministic scan scenarios, verifies checksums, contains filesystem paths, and issues read grants lasting no more than five minutes. Onboarding supports leads, invitations, applications, separate operator/reviewer decisions, appeals, and expiry/grace/reverification while preserving append-only evidence. See [Vendor Onboarding and Verification](../docs/engineering/vendor-onboarding-and-verification.md).

## Vendor publication

The database package exports `VendorPublicationService`. It computes a six-check launch strip from authoritative onboarding, profile, schedule, PostGIS zone, fulfilment, and document state; applies maker-checker submission/approval; and atomically publishes, pauses, restores, or unpublishes the vendor network with append-only evidence. See [Vendor Publication Workflow](../docs/engineering/vendor-publication-workflow.md).

## Inventory reservations

The database package exports `InventoryReservationService`. Counted inventory uses row locking to prevent over-reservation and restores exact units once on release or expiry. Vendor-confirms inventory records intent without an exact quantity. Vendor APIs are location-contained; checkout/order transitions remain internal until their owning aggregates exist. See [Inventory Reservation Lifecycle](../docs/engineering/inventory-reservation-lifecycle.md).

## Assignment and custody

The database package exports `AssignmentCustodyService`. It enforces one active synthetic attempt per source order, eligibility before offer acceptance, exact active-assignment membership after acceptance, optimistic transitions, verified package count at pickup, uninterrupted custody, terminal membership closure, and admin-authorized returns after failed delivery. See [Assignment and Custody Lifecycle](../docs/engineering/assignment-and-custody-lifecycle.md).

## Synthetic money lifecycle

The database package exports `MoneyLifecycleService`, the deterministic `LocalFakeMoneyProvider`, and integer-paise policy functions. Payment, refund, settlement, and payout mutations preserve synthetic-reference boundaries; every posted ledger transaction balances before commit; and unknown payouts resolve only through a matching statement under the same provider operation. See [Synthetic Money Lifecycle](../docs/engineering/synthetic-money-lifecycle.md).

## Idempotent command boundary

The compiled database package exports canonical request hashing, `executeIdempotentCommand`, and `reconcileUncertainCommand`. Claims are unique by actor, command scope, and opaque retry key. Exact status/body results are replayed for the same canonical request; a changed request is rejected. Expired leases and ambiguous provider calls become `UNCERTAIN` and are retained for reconciliation instead of being executed again.

See `docs/engineering/idempotent-command-handling.md` for the command contract, retention rules, and test coverage. Domain endpoints will adopt this boundary as they are introduced; no business command endpoint exists in Phase 3.3.

## Aggregate versioning and transition history

The database package exports policy definition, versioned aggregate creation and expected-version transitions. Accepted changes advance the aggregate head and append fully attributable history in one transaction. A domain mutation callback can participate in that transaction; callback failure rolls back the mutation, version and history together. Stale concurrent edits return stable `VERSION_CONFLICT` details instead of overwriting newer state.

See `docs/engineering/aggregate-versioning-and-transitions.md` for policy rules, attribution fields and disposable-database concurrency coverage. Domain-specific aggregate policies begin in later phases.

## Transactional outbox and inbox

Domain code can enqueue an event through the aggregate transaction callback, so business state, version history and outbox state commit or roll back together. Workers claim committed events in bounded `SKIP LOCKED` batches and dispatch with expiring ownership, capped retry and safe dead-letter state. Consumers use a per-scope inbox receipt to commit their handler effect once despite at-least-once delivery.

Dead letters have bounded list and attributable recovery operations. Event content and durable messaging history reject direct mutation/deletion. See `docs/engineering/transactional-outbox-and-inbox.md` for delivery semantics and verification.

## Durable scheduler and jobs

The database package exports replay-safe job scheduling, concurrent bounded claiming, expiring ownership, capped retry execution, dead-letter listing/recovery and queue metrics. Every claim creates a lifetime-numbered attempt; abandoned leases and classified failures remain visible instead of being overwritten.

Execution is at least once, so handlers must use the shared idempotency, inbox or equivalent domain deduplication boundary. See `docs/engineering/durable-scheduler-and-jobs.md` for the handler contract, metrics and disposable-database verification.

## Versioned configuration and feature flags

The database package exports immutable configuration drafts, validation, different-actor approval, scheduling, activation/supersession, rollback-as-new-version, deterministic scoped resolution and business-record version snapshots. Database constraints allow only one scheduled and one active version for each key/scope.

Feature flags are boolean, server-authoritative and default to disabled when no version matches. See `docs/engineering/versioned-configuration-and-feature-flags.md` for lifecycle, scope precedence, snapshot semantics and verification.

## Phase 3 reference module

The synthetic `reference_submission` module proves the shared foundations as one correlated vertical slice: idempotent request, atomic aggregate/configuration/outbox creation, inbox worker consumption, durable job transition, stable concurrent conflict, metrics and audit evidence. It adds no product API or real-data authority.

See `docs/engineering/phase-3-reference-module.md` for the exact flow, failure proof and boundary before Phase 4.

## OTP identity boundary

The database package exports the local synthetic OTP request/verify service. It enforces phone, device, resend, attempt, expiry, replay and callback-deduplication controls transactionally. It accepts fictional `SYNTH-PHONE-*` identifiers only, stores keyed hashes in the general identity table, and destroys protected test-outbox content on verification, expiry, or lockout.

See `docs/engineering/otp-request-and-verification.md` for the API, privacy, simulator and Phase 4.2 boundaries.

See `docs/engineering/roles-capabilities-and-memberships.md` for the Phase 4.3 catalog, default-deny evaluator, scoped membership rules, and Phase 4.4 enforcement boundary.

See `docs/engineering/customer-profile-consent-and-preferences.md` for Phase 4.5 optional profiles, versioned consent, language/channel preferences, and retention classification.

See `docs/engineering/identity-isolation-proof.md` for the Phase 4.6 cross-role, cross-tenant, opaque-reference, and log-redaction abuse matrix.

## Sessions and devices

The compiled database package exports transactional OTP-to-session issuance, access authentication, refresh rotation with replay-family revocation, access/refresh expiry, same-user session listing/revocation, current sign-out, and hashed notification-token lifecycle. Raw credentials are returned only to the immediate caller and are never stored.

See `docs/engineering/sessions-and-devices.md` for token lifetimes, API contracts, transaction guarantees, threat tests, and the boundary before roles.
