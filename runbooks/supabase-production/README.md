# Supabase production database runbook

This runbook prepares the database layer only. It does not declare the complete marketplace
production-ready; API hosting, Valkey/BullMQ, object storage, real providers, observability,
privacy, and app-store releases have separate gates.

## 1. Create isolated projects

Use three projects: development, staging, and production. Never reuse the current development
project for production. Choose the production region closest to the API/worker hosting region.

For production, use a paid plan that provides downloadable daily backups and avoids free-project
inactivity pauses. Define RPO/RTO before selecting PITR and retention.

## 2. Secure the Supabase organization and project

In the Dashboard:

1. Require MFA for organization members and configure a second owner.
2. Database Settings -> SSL Configuration: enable **Enforce SSL on incoming connections**.
3. Download the Supabase CA certificate and store it as a read-only deployment secret/file.
4. Database Settings -> Network Restrictions: allow only staging/production migration runners and
   API/worker egress addresses. Do not restrict before those stable addresses are known.
5. Review Security Advisor and Performance Advisor until no unexplained findings remain.
6. Confirm `marketplace` is not in the Data API exposed-schema list.
7. Database -> Backups: verify retention/PITR and name the restore operator.

Enabling SSL enforcement briefly reboots the database; schedule it before launch.

## 3. Configure the operator environment

```sh
cp infrastructure/supabase-production/env.example infrastructure/supabase-production/.env
```

Fill the ignored file without pasting it into chat or committing it:

- production project reference;
- production `postgres` migration URL;
- absolute `sslrootcert` path;
- exact project-bound migration and role confirmations;
- a distinct password-manager-generated `marketplace_app` password of at least 32 characters.

For local provisioning, save the downloaded certificate at:

```text
/Users/anirudhbhatia/vendor/infrastructure/supabase-production/secrets/prod-ca-2021.crt
```

The directory is Git-ignored. Use that absolute path as `sslrootcert` in both URLs. A URL-safe
runtime password can be generated with `openssl rand -hex 32`; use that new value for
`SUPABASE_PRODUCTION_RUNTIME_PASSWORD` and as the `marketplace_app` URL password. It must be
different from the production `postgres` password.

Use Direct port 5432 for CI/migrations when IPv6 is available. Otherwise use Session pooler port
5432. Never use transaction-pooler port 6543 for migrations.

## 4. Rehearse on staging

Restore a recent production-shaped backup into staging, then run the same commands with staging
credentials. Record migration duration, locks, application smoke tests, and rollback decision
points. Do not use down migrations on live production; prefer a reviewed forward fix.

## 5. Deploy the production schema

Take/verify a restorable backup, announce the maintenance window, and then run:

```sh
pnpm db:status:production
pnpm db:migrate:production
pnpm db:production:provision-runtime
pnpm db:production:verify
```

The runtime login created is `marketplace_app`. For a Supavisor Session-pooler URL its username is
`marketplace_app.<project-ref>`. Put `SUPABASE_PRODUCTION_DATABASE_URL` only in the API/worker
secret manager. Never deploy the migration URL or `postgres` password to application containers.

## 6. Capacity and monitoring

- Set a total connection budget below Supabase's database limit. Divide it across API replicas,
  workers, migrations, Supabase services, and emergency operator headroom.
- Keep each Node pool bounded; scale replicas and pool sizes together.
- Monitor database and Supavisor connections, CPU, memory, disk, IOPS, slow queries, lock waits,
  deadlocks, failed jobs, migration failures, and storage growth.
- Enable `pg_stat_statements`; add indexes only from measured query plans.
- Load-test staging at expected peak plus safety margin before launch.

Initial rollback triggers must be set from staging baselines. At minimum, stop rollout on failed
checkout/order writes, migration errors, sustained connection exhaustion, elevated database error
rate, or lock waits that threaten the order path.

## 7. Backup and recovery drill

Before launch and quarterly thereafter:

1. Restore a backup/PITR point into an isolated project.
2. Recreate custom-role passwords because Supabase backups do not preserve them.
3. Run migrations/status and `pnpm db:production:verify` against the restored project.
4. Run read/write smoke tests and reconcile critical row/ledger counts.
5. Record actual recovery time and data-loss window against RTO/RPO.

Free-plan development projects require scheduled logical off-site dumps; they are not acceptable
evidence for the production recovery gate.

## Launch gate

- [ ] Separate staging and production projects
- [ ] Paid backups verified; PITR decision recorded
- [ ] Restore drill passed within RTO/RPO
- [ ] SSL enforcement enabled and CA verification working
- [ ] Network restrictions enabled
- [ ] MFA and two-owner recovery configured
- [ ] Security and Performance Advisors reviewed
- [ ] All migrations rehearsed and applied
- [ ] `marketplace_app` is non-superuser and production verification passes
- [ ] Runtime contains no `postgres` credential
- [ ] Connection/load tests pass with headroom
- [ ] Alerts, on-call owner, rollback triggers, and incident runbook approved
