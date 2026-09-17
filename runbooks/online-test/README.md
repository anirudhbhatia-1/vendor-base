# Online-Test Account Setup, Deployment, and Rollback (Azure Container Apps)

> **Scope: D-16.** This runbook provisions the synthetic company-test environment on the
> Azure for Students offer. It does not establish production, and it activates none of the
> D-15 gates it does not name: no real people, real money, provider credentials (MSG91,
> Razorpay, Mappls, FCM), production domains or public launch. Use company-owned accounts,
> enable MFA, keep recovery codes in the approved password manager, and never paste
> passwords, OTPs, private keys, database URLs or tokens into chat or Git.
>
> Current state is recorded in `infrastructure/online-test/provider-targets.json`
> (`status` and `activeEnvironment`); update it in the same commit as any change below.

## Stop conditions

Stop before continuing if a provider asks for a payment card or an unexpected charge, the
requested free resource is unavailable in the region, the account is personal instead of
company-owned, a secret would need to be copied into a PWA bundle, or the Supabase project
in use holds anything but synthetic data.

## 1. GitHub source, CI and images

1. Confirm `anirudhbhatia-1/vendor-base` is the intended private repository, MFA is on, and
   `.github/workflows/ci.yml` passes on `main`.
2. Images are built by `.github/workflows/release-images.yml` (**Actions → Release images →
   Run workflow**, `api_url` = the public API origin, e.g.
   `https://nsapi-<x>.centralindia.cloudapp.azure.com`). The run summary prints
   `RELEASE_VERSION`, `API_IMAGE`, `WORKER_IMAGE` and `CUSTOMER_PWA_IMAGE` as digests.
   Optionally store the origin as the repository variable `ONLINE_TEST_API_URL` so tag pushes
   (`v*`) can build without the input.
3. Images live in GHCR as private packages. Create a classic PAT with only `read:packages`
   for Container Apps (name it `azure-test-aca-pull`, 90-day expiry) and store it in the
   password manager and the 0600 file named by `GHCR_READ_TOKEN_FILE` (§4.2).

## 2. Azure subscription, budget and static shells

1. Activate Azure for Students through the GitHub Student Developer Pack and sign in with the
   company GitHub identity. Enable MFA on the Microsoft account.
2. Install the Azure CLI and sign in:

```bash
az login
az account show --query '{name:name, id:id, state:state}'
az group create --name rg-neighbourhood-test --location centralindia
```

3. Budget alerts **before** any compute exists (the portal: Cost Management → Budgets, or):

```bash
az consumption budget create --budget-name neighbourhood-test --amount 20 --category cost \
  --time-grain monthly --start-date "$(date -u +%Y-%m-01)" --end-date 2027-09-01 \
  --resource-group rg-neighbourhood-test
```

4. Static hosting for the three shells. Static Web Apps cannot be created in the regions the
   student subscription allows, so each shell gets a small storage account with static-website
   hosting (HTTPS endpoint included; cost is pennies). The endpoints become the origins the API
   allows, so record what the last command prints:

```bash
for shell in vendor partner admin; do
  az storage account create --name "nbhd${shell}test" --resource-group rg-neighbourhood-test \
    --location centralindia --sku Standard_LRS --kind StorageV2 --https-only true --min-tls-version TLS1_2
  az storage blob service-properties update --account-name "nbhd${shell}test" \
    --static-website --index-document index.html --404-document 404.html
  az storage account show --name "nbhd${shell}test" --resource-group rg-neighbourhood-test \
    --query primaryEndpoints.web -o tsv
done
```

5. Object storage remains the filesystem adapter on each replica's ephemeral storage for this environment
   (`OBJECT_STORAGE_DRIVER=filesystem`, acknowledged by `ALLOW_SYNTHETIC_PROVIDERS`). Supabase
   Storage buckets are a later activation, not a prerequisite.

## 3. Supabase PostgreSQL/PostGIS

The environment uses the existing synthetic development project, exactly as
`infrastructure/supabase-production/.env` does locally. Nothing is created here.

1. Confirm the project holds only synthetic data and that every migration is applied:

```bash
pnpm db:status:production
```

2. Apply any pending migration from your laptop with the explicit confirmation the profile
   already requires (`SUPABASE_PRODUCTION_MIGRATION_CONFIRM`); never from a deployed container.
3. Note for `release.env`: the runtime login is `marketplace_app.<ref>` through the
   transaction pooler on **6543**, `sslmode=verify-full`, and `sslrootcert` must be the path
   the container sees: `/opt/certs/prod-ca-2021.crt`.
4. Supabase Free pauses the project after seven idle days. Resuming it from the dashboard is an
   operator action; the API's `/health/ready` reports the outage until then.

## 4. Container Apps environment and apps

No VM: the subscription offers no B-series size in its allowed regions and the smallest VM
costs about $54/month. Container Apps (consumption) in Central India runs the four apps —
`valkey` (internal TCP ingress), `worker`, `api` and `shop` (public HTTPS ingress) — with the
API and shop allowed to scale to zero.

1. Environment (no Log Analytics workspace; console logs stay readable with `az containerapp logs`):

```bash
az extension add --name containerapp --upgrade
az containerapp env create --name cae-neighbourhood-test --resource-group rg-neighbourhood-test \
  --location centralindia --logs-destination none
az containerapp env show --name cae-neighbourhood-test --resource-group rg-neighbourhood-test \
  --query properties.defaultDomain -o tsv
```

   The default domain fixes every hostname before anything is deployed: the API is
   `https://api.<domain>` and the shop `https://shop.<domain>`. Build the images (§1.2) with
   that API origin.

2. Registry credentials: save the `read:packages` PAT from §1.3 into a 0600 file that only
   `release.env` names (`GHCR_READ_TOKEN_FILE`). It is sent to Container Apps as a secret and
   never printed.

3. `release.env` (mode 600, never committed) from `infrastructure/online-test/release.env.example`:
   image digests and SHA from §1.2, `API_HOST`/`SHOP_HOST` from the domain above,
   `VALKEY_HOST=valkey` (TCP apps are reached by app name inside an environment), the three
   storage endpoints plus the shop origin in `CORS_ALLOWED_ORIGINS`, the Supabase values from
   the password manager, and four fresh `openssl rand -hex 32` values for the key material.

4. Deploy. The script renders `infrastructure/online-test/aca/*.json`, applies each app with
   `az containerapp create|update --yaml`, and removes the rendered files:

```bash
node tooling/scripts/deploy-azure-test.mjs --env ~/.config/neighbourhood/release.env
az containerapp revision list --name api --resource-group rg-neighbourhood-test \
  --query '[].{name:name, healthy:properties.healthState, running:properties.runningState}' -o table
az containerapp logs show --name api --resource-group rg-neighbourhood-test --type console --tail 50
```

   `--only api,shop` redeploys a subset. The API runs with `INGRESS_REQUEST_ID_MODE=replace`
   because the platform ingress stamps a v4 `x-request-id` on every request.

5. Costs: the worker and Valkey are always on (one replica each at 0.25 vCPU / 0.5 GiB); the
   API and shop scale to zero unless `API_MIN_REPLICAS` / `SHOP_MIN_REPLICAS` are raised.
   Expect roughly $15–20/month against the credit after the free grant. The filesystem
   object store lives in each replica's ephemeral storage: uploads do not survive a restart
   in this environment.

## 5. Static shells: build and upload

From your laptop, with the API origin from §4.1 and the public Supabase values (never the
service-role key):

```bash
export NEXT_PUBLIC_API_URL='https://api.<domain>'
export NEXT_PUBLIC_SUPABASE_URL='https://<ref>.supabase.co'
export NEXT_PUBLIC_SUPABASE_ANON_KEY='<anon key>'
pnpm build:online-test:pwas
for shell in vendor partner admin; do
  az storage blob upload-batch --account-name "nbhd${shell}test" --destination '$web' \
    --source "apps/${shell}-pwa/out" --overwrite --only-show-errors -o none
done
```

The exports use directory indexes (`catalogue/index.html`), which is what a static host
answers `/catalogue/` from. Uploading with the account key is fine here: the accounts hold
only public bundles.

## 6. Release health and evidence

Set only credential-free HTTPS endpoints and the deployed Git SHA, then run:

```bash
export RELEASE_VERSION='full-lowercase-40-character-git-sha'
export ONLINE_TEST_EXPECTED_ENVIRONMENT='supabase-production'
export ONLINE_TEST_API_URL='https://api.<domain>/'
export ONLINE_TEST_CUSTOMER_URL='https://shop.<domain>/'
export ONLINE_TEST_VENDOR_URL='https://nbhdvendortest.z29.web.core.windows.net/'
export ONLINE_TEST_PARTNER_URL='https://nbhdpartnertest.z29.web.core.windows.net/'
export ONLINE_TEST_ADMIN_URL='https://nbhdadmintest.z29.web.core.windows.net/'
pnpm online-test:health
```

Then a manual pass: customer sign-in with a synthetic phone (read the code with
`pnpm --filter @neighbourhood-store/database otp:read:supabase-production`),
vendor email sign-in and catalogue load, admin console load. Attach the generated safe JSON,
the Actions run URL, the three digests and the `az containerapp revision list` output to the release record
(`release-record.example.json`). Do not attach raw environment output.

When health passes, set `status: active-azure-test` and `activeEnvironment: azure-test` in
`provider-targets.json` in a follow-up commit.

## 7. FCM, Web Push, Grafana Cloud, and PostHog

Unchanged from D-15: create these only when the matching adapter exists. No setup screen or
API key substitutes for the missing provider-neutral adapters.

## 8. Rollback rehearsal

Keep the last known-good `release.env` as a protected deployment record. A rollback changes
only `API_IMAGE`, `WORKER_IMAGE`, `CUSTOMER_PWA_IMAGE` and `RELEASE_VERSION` back to the prior
immutable values, runs the deploy script again, and reruns the health command. Container Apps
keeps the previous revisions; `az containerapp revision activate` is the emergency path. Do not roll database migrations back automatically; use the reviewed paired
migration and backup/restore decision for the specific schema change.

Rollback passes only when all four PWAs, API liveness/readiness, release identity, worker
health, and synthetic-data boundary pass. Record start time, end time, operator, reason,
old/new image digests, and outcome.

## 9. Gate for making the Azure environment primary

Local can stop being the daily shared environment only after:

- the Azure subscription and GitHub organisation are company-owned with MFA and two administrators;
- the external CI quality gate is enforced on `main`;
- two consecutive versioned deployments and one rollback rehearsal pass;
- an encrypted database backup is restored successfully into isolation;
- budget alerts and Supabase usage alerts are configured;
- no real customer/vendor/partner data is present;
- an Engineering Lead signs the evidence record.

Keep the local files in Git as a disabled recovery and deterministic-test path. Production
remains a separate funded decision.
