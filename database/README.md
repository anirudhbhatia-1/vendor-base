# Database migration and synthetic-fixture workflow

**Scope:** Phase 2 Step 2.4 company-local and isolated test databases only

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

The `0000_baseline` migration activates PostGIS and creates an otherwise empty `marketplace` domain schema. Its down migration is safe only while that baseline contains no domain tables. Later migrations must roll back before the baseline.

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
