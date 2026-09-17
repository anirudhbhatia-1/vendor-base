# Supabase Development Database Runbook

This runbook connects the locally running API and worker to a Supabase-hosted synthetic database.
It does not configure production or expose the API publicly.

## 1. Rotate the old password

The database password previously pasted into development conversation must be considered exposed.
In Supabase Dashboard, rotate/reset the database password before continuing. Do not reuse the old
value.

## 2. Confirm project safeguards

1. Open the intended Supabase project.
2. Confirm the project reference from Project Settings.
3. Enable SSL enforcement under Database Settings.
4. Confirm PostGIS is available. Migration `0000_baseline` runs
   `CREATE EXTENSION IF NOT EXISTS postgis`; if the project blocks this, enable PostGIS from
   Database -> Extensions before migrating.
5. Use only synthetic data in this project.

Supabase recommends direct connections for migrations and persistent backends when IPv6 is
available. From an IPv4-only network, use the shared **Session pooler** on port 5432. Do not use the
transaction pooler on port 6543 for repository migrations.

## 3. Create the ignored environment file

```bash
cp infrastructure/supabase-dev/env.example infrastructure/supabase-dev/.env
```

Edit `.env` locally:

- replace `SUPABASE_PROJECT_REF` with the 20-character project reference;
- copy the Direct or Session pooler connection string from Dashboard -> Connect;
- URL-encode special characters in the rotated password;
- leave a newly copied URL without query parameters; the application normalizes it to encrypted,
  libpq-compatible `sslmode=require`;
- set `SUPABASE_MIGRATION_CONFIRM=apply-<project-ref>-supabase-dev`;
- replace all three local cryptographic placeholder values with different random values of at least
  32 characters.

Never commit `.env` or paste its contents into chat, issues, logs or screenshots.

## 4. Check connection and migration state

```bash
pnpm db:status:supabase
```

This read-only command verifies the selected host, project, database name, user, port and TLS mode
before connecting.

## 5. Apply reviewed migrations

First rehearse migrations locally:

```bash
pnpm db:test:up
pnpm db:verify:connected
pnpm db:test:down
```

Then apply them to Supabase:

```bash
pnpm db:migrate:supabase
pnpm db:status:supabase
```

The migration command is additive and checksum guarded. It does not seed synthetic fixtures.

## 6. Run API and worker against Supabase

```bash
pnpm dev:supabase
```

Health endpoints:

```text
http://127.0.0.1:3001/health/live
http://127.0.0.1:3001/health/ready
```

Expected identity:

```text
environment: supabase-dev
data_mode: synthetic
production_ready: false
```

PWAs continue using `http://127.0.0.1:3001`. Start them through their normal local commands.

## 7. Troubleshooting

### `ENOTFOUND db.<project-ref>.supabase.co`

The Direct endpoint commonly requires IPv6. Use Dashboard -> Connect -> Session pooler on port
5432 instead.

### Authentication failed

Confirm the password is URL encoded. Session-pooler usernames use `postgres.<project-ref>`; direct
connections use `postgres`.

### TLS configuration rejected

The development target accepts encrypted `sslmode=require` only together with
`uselibpqcompat=true`. Before production, download the Supabase CA certificate, configure it for
the Node/Postgres client, and move to `sslmode=verify-full`. Never use `disable`, `allow`, or
`prefer`.

### Readiness is degraded

Run `pnpm db:status:supabase`. If migrations are pending, rehearse locally and then run
`pnpm db:migrate:supabase`.

### Project paused or quota exceeded

Stop the local API/worker and return to the normal local database commands. Supabase development is
convenience infrastructure, not the only recoverable copy or production authority.

## 8. Provider references

- [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase PostGIS extension](https://supabase.com/docs/guides/database/extensions/postgis)
- [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement)
- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
