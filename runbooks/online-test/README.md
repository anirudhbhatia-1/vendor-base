# Online-Test Account Setup, Deployment, and Rollback

> **NOT AUTHORIZED TO EXECUTE.** D-15 supersedes D-12's local-only restriction and records the
> approved staging direction, so the "explicit superseding decision" this runbook previously
> waited on now exists. **Approval is not activation.** D-15 states plainly that credentials,
> accounts, operational approvals and deployed availability are not assumed, and that spending
> stays a separate gate. Nothing here may be executed until the account owner has approved
> provisioning and any payment-card verification, because no compute is provisioned and OCI
> Free Tier can still require a card.
>
> Current state: the Cloudflare snapshots and the empty Supabase baseline are non-authoritative
> paused resources; object storage and OCI compute are not activated.

This runbook establishes the selected free online company-test stack. It does not establish production. Use company-owned accounts, enable MFA, keep recovery codes in the company's approved password manager, and never paste passwords, OTPs, private keys, database URLs, or tokens into chat or Git.

## Stop conditions

Stop before continuing if a provider asks for an unexpected payment, the requested free resource is unavailable, the account is personal instead of company-owned, a region is wrong, or a secret would need to be copied into a PWA/Android bundle. OCI may require payment-card verification even for a Free Tier account; the account owner must inspect and accept that directly.

## 1. GitHub source and CI

1. Sign in to the company GitHub account and enable MFA.
2. Confirm `anirudhbhatia-1/vendor-base` is the intended private repository and review its collaborators.
3. Push the reviewed branch. Confirm `.github/workflows/ci.yml` runs successfully.
4. Protect the default branch and require the workflow's `quality-gate` job before merge.
5. Record the repository URL, first successful run URL, protected branch, account owner, and date in the evidence record.

Do not add deployment credentials until each target account exists. Prefer GitHub OpenID Connect or provider-scoped short-lived credentials over long-lived keys when the provider supports it.

## 2. Cloudflare Pages, Supabase Storage, and ingress

1. Create or select the company Cloudflare account, enable MFA, and invite a second company administrator.
2. Create four Direct Upload Pages projects using the names in `release.env.example`.
3. Run `pnpm build:online-test:pwas`. Upload each matching `apps/<role>-pwa/out` directory to its project.
4. Set no secrets in Pages. Only explicitly public `NEXT_PUBLIC_*` build values may enter client bundles.
5. Object storage is **not** Cloudflare R2. D-15 approves Supabase Storage, and
   `SupabaseProtectedObjectStorage` implements it. Create two private Supabase buckets — one for
   approved catalogue assets, one for quarantined evidence — and never the same bucket for both;
   both `loadSharedRuntimeConfig` and the adapter refuse a shared-bucket configuration. Set
   `OBJECT_STORAGE_DRIVER=supabase` with `OBJECT_STORAGE_CATALOGUE_BUCKET` and
   `OBJECT_STORAGE_EVIDENCE_BUCKET`. Nothing has been uploaded to a live project, so the adapter
   is verified against contract tests only.
6. Reserve a Cloudflare Tunnel for the OCI API. Do not publish the API port directly; the Compose file binds it to `127.0.0.1`.
7. Enable spending/usage notifications where the account offers them and record all four HTTPS URLs and deployment IDs.

Cloudflare's documented static Next.js flow uses `output: 'export'` and an `out` build directory. This repository enables that only when `DEPLOYMENT_TARGET=cloudflare-pages`.

## 3. Supabase PostgreSQL/PostGIS

1. Create a dedicated project named `neighbourhood-online-test` in the closest company-approved region. Use a generated database password and save it only in the company password manager.
2. Record the 20-character project reference, region, and project owner. Do not record the database URL in evidence.
3. Enable PostGIS using the reviewed migration path, not ad hoc dashboard edits.
4. Store the direct TLS connection string in a protected local shell only for the migration session. The repository requires `sslmode=verify-full` and verifies the project reference.
5. Inspect status first. Then apply only reviewed migrations with the explicit confirmation:

```bash
export ONLINE_TEST_SUPABASE_PROJECT_REF='replace-with-project-ref'
export ONLINE_TEST_DATABASE_URL='retrieve-from-approved-secret-store'
pnpm db:status:online-test
export ONLINE_TEST_MIGRATION_CONFIRM="apply-${ONLINE_TEST_SUPABASE_PROJECT_REF}-online-test"
pnpm db:migrate:online-test
```

6. Remove the exported values from the shell after use. Never use `supabase db reset` against the remote project.
7. Before this environment becomes primary, create an encrypted logical backup, verify its checksum, restore it into an isolated database, and record the outcome.

## 4. OCI compute, Vault, and containers

1. Create the company OCI tenancy with MFA. Select the approved region carefully; changing home region later is not a routine operation.
2. Create a compartment and least-privilege policies for `neighbourhood-online-test`.
3. Create the smallest available Always Free Ampere VM that safely fits the skeleton. Enable automatic security updates, SSH-key access, and no password login.
4. Keep ingress closed except SSH from the approved administrator range. The future Cloudflare Tunnel makes the outbound connection; do not expose port 3001 publicly.
5. Install a supported rootless container runtime and Compose provider on the VM. Create an unprivileged deployment user.
6. Create OCI Vault secrets only when an implemented server adapter consumes them. The API and
   worker now refuse to start without them: `ALLOW_SYNTHETIC_PROVIDERS`, `OTP_HASH_KEY`,
   `SESSION_TOKEN_HASH_KEY`, `OBJECT_STORAGE_GRANT_KEY`, `PAYMENT_WEBHOOK_KEY`,
   `PROVIDER_CLEARING_ACCOUNT_REFERENCE`, `ONLINE_TEST_DATABASE_URL`, `VALKEY_URL` and
   `ONLINE_TEST_SUPABASE_PROJECT_REF`, each injected through `${VAR:?...}` in the Compose file.
   Committed synthetic defaults are rejected outside local development, so a missing value stops
   the deployment rather than silently falling back.
7. Build API and worker images using a verified digest-pinned Node base. Push them to a private registry available to the VM and capture their immutable digests. Mutable tags such as `latest` are forbidden for releases.
8. Copy `infrastructure/online-test/compose.yaml` and a locally created, uncommitted `release.env` to the deployment directory. Validate before applying:

```bash
podman compose --env-file release.env -f compose.yaml config
podman compose --env-file release.env -f compose.yaml pull
podman compose --env-file release.env -f compose.yaml up -d
podman compose --env-file release.env -f compose.yaml ps
```

9. Configure the Cloudflare Tunnel to reach only `http://127.0.0.1:3001`. Add company access control before sharing the hostname.

Valkey and ClamAV are deferred until their application adapters exist. Running unused daemons would consume scarce VM memory without testing a real integration.

## 5. FCM, Web Push, Grafana Cloud, and PostHog

Create these company projects only when the matching implementation step starts:

- FCM: one company Firebase project with separate Android app registrations. Keep service-account credentials server-side; client configuration is public but environment-specific.
- Web Push: generate a separate online-test VAPID key pair in the approved secret store and implement consent, unsubscribe, rotation, and token deletion first.
- Grafana Cloud: create a free stack, scoped ingestion credential, retention/quota alert, and redaction test before exporting logs or traces.
- PostHog: select the approved region, enable only allowlisted synthetic events, and prove that phone, address, OTP, payment, document, and precise-location fields are rejected.

No setup screen or API key can substitute for the missing provider-neutral adapters.

## 6. Release health and evidence

Set only credential-free HTTPS endpoints and the deployed Git SHA, then run:

```bash
export RELEASE_VERSION='full-lowercase-40-character-git-sha'
export ONLINE_TEST_API_URL='https://approved-api-host/'
export ONLINE_TEST_CUSTOMER_URL='https://customer-project.pages.dev/'
export ONLINE_TEST_VENDOR_URL='https://vendor-project.pages.dev/'
export ONLINE_TEST_PARTNER_URL='https://partner-project.pages.dev/'
export ONLINE_TEST_ADMIN_URL='https://admin-project.pages.dev/'
pnpm online-test:health
```

Attach the generated safe JSON, CI URL, Cloudflare deployment IDs, image digests, Supabase migration output, and OCI Compose status to the company release record. Do not attach raw environment output.

## 7. Rollback rehearsal

Keep the last known-good `release.env` as a protected deployment record. A rollback changes only `API_IMAGE`, `WORKER_IMAGE`, and `RELEASE_VERSION` back to the prior immutable values, validates the rendered Compose configuration, applies it, and reruns the full health command. Do not roll database migrations back automatically; use the reviewed paired migration and backup/restore decision for the specific schema change.

Rollback passes only when all four PWAs, API liveness/readiness, release identity, worker health, and synthetic-data boundary pass. Record start time, end time, operator, reason, old/new image digests, and outcome.

## 8. Gate for making online-test primary

Local can stop being the daily shared environment only after:

- all provider accounts are company-owned with MFA and two administrators;
- the external CI quality gate is enforced;
- two consecutive versioned deployments and one rollback rehearsal pass;
- an encrypted database backup is restored successfully into isolation;
- quotas and alerts are configured;
- no real customer/vendor/partner data is present;
- an Engineering Lead signs the evidence record.

Keep the local files in Git as a disabled recovery and deterministic-test path. Removing them provides no scalability benefit and would weaken disaster recovery. Production remains a separate funded decision.
