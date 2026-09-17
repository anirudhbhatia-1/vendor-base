# Online-Test Account Setup, Deployment, and Rollback (Azure)

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
   for the VM (name it `azure-test-vm-pull`, 90-day expiry) and store it in the password
   manager. It is used once, in §4.6.

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

4. Static Web Apps (Free) for the three static shells. The names become the origins the API
   allows, so record the URLs the commands print:

```bash
for shell in vendor partner admin; do
  az staticwebapp create --name "neighbourhood-${shell}-test" \
    --resource-group rg-neighbourhood-test --location centralindia --sku Free
  az staticwebapp show --name "neighbourhood-${shell}-test" \
    --resource-group rg-neighbourhood-test --query defaultHostname -o tsv
done
```

5. Object storage remains the filesystem adapter on the VM volume for this environment
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
   already requires (`SUPABASE_PRODUCTION_MIGRATION_CONFIRM`); never from the VM.
3. Note for `release.env`: the runtime login is `marketplace_app.<ref>` through the
   transaction pooler on **6543**, `sslmode=verify-full`, and `sslrootcert` must be the path
   the container sees: `/opt/certs/prod-ca-2021.crt`.
4. Supabase Free pauses the project after seven idle days. Resuming it from the dashboard is an
   operator action; the API's `/health/ready` reports the outage until then.

## 4. Azure VM, ingress and containers

1. Create the VM. Central India, Ubuntu 24.04 LTS, SSH key only, **B1ms** (2 GB). If you would
   rather stay inside the offer's free hours use `Standard_B1s` and add the swapfile in step 4;
   `az vm resize` moves between them later.

```bash
az network public-ip create --resource-group rg-neighbourhood-test --name pip-nsapi \
  --sku Standard --allocation-method Static --dns-name "nsapi-$(openssl rand -hex 3)"
az network public-ip create --resource-group rg-neighbourhood-test --name pip-nsshop \
  --sku Standard --allocation-method Static --dns-name "nsshop-$(openssl rand -hex 3)"
az network nsg create --resource-group rg-neighbourhood-test --name nsg-neighbourhood-test
MY_IP="$(curl -s https://api.ipify.org)"
az network nsg rule create --resource-group rg-neighbourhood-test --nsg-name nsg-neighbourhood-test \
  --name ssh --priority 100 --protocol Tcp --destination-port-ranges 22 --source-address-prefixes "${MY_IP}/32"
az network nsg rule create --resource-group rg-neighbourhood-test --nsg-name nsg-neighbourhood-test \
  --name web --priority 110 --protocol Tcp --destination-port-ranges 80 443
az network vnet create --resource-group rg-neighbourhood-test --name vnet-neighbourhood-test \
  --subnet-name default
az network nic create --resource-group rg-neighbourhood-test --name nic-neighbourhood-test \
  --vnet-name vnet-neighbourhood-test --subnet default --network-security-group nsg-neighbourhood-test \
  --public-ip-address pip-nsapi
az network nic ip-config create --resource-group rg-neighbourhood-test --nic-name nic-neighbourhood-test \
  --name shop --public-ip-address pip-nsshop
az vm create --resource-group rg-neighbourhood-test --name vm-neighbourhood-test \
  --image Ubuntu2404 --size Standard_B1ms --nics nic-neighbourhood-test \
  --admin-username azureuser --ssh-key-values ~/.ssh/id_ed25519.pub \
  --os-disk-size-gb 32 --storage-sku StandardSSD_LRS
az network public-ip show --resource-group rg-neighbourhood-test --name pip-nsapi --query dnsSettings.fqdn -o tsv
az network public-ip show --resource-group rg-neighbourhood-test --name pip-nsshop --query dnsSettings.fqdn -o tsv
```

   Both FQDNs resolve to the VM; Caddy tells them apart by hostname. Record them as
   `CADDY_API_HOST` and `CADDY_SHOP_HOST`.

2. Harden the host (as `azureuser`):

```bash
sudo apt-get update && sudo apt-get install -y unattended-upgrades podman podman-compose
sudo dpkg-reconfigure -plow unattended-upgrades
sudo useradd --create-home --shell /bin/bash deploy
sudo loginctl enable-linger deploy
# Rootless containers may bind 80/443 only with this; the compose file publishes nothing else.
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/90-caddy.conf && sudo sysctl --system
```

3. SSH access for the deploy user: copy your public key into `/home/deploy/.ssh/authorized_keys`
   (mode 600, owned by `deploy`). Password login stays disabled.

4. Memory headroom (required on B1s, sensible on B1ms):

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

5. Deployment directory (as `deploy`): copy `infrastructure/online-test/compose.yaml`,
   `infrastructure/online-test/Caddyfile` and `infrastructure/supabase-production/prod-ca-2021.crt`
   into `/home/deploy/neighbourhood/`. Create `release.env` there from
   `infrastructure/online-test/release.env.example` — image digests and SHA from §1.2,
   hostnames from §4.1, the three SWA origins plus the shop origin in `CORS_ALLOWED_ORIGINS`,
   the Supabase values from the password manager, and four fresh `openssl rand -hex 32`
   values for the key material. `chmod 600 release.env`. The file never leaves the VM.

6. Registry login and first start (as `deploy`, in that directory):

```bash
podman login ghcr.io -u <github-username>            # paste the read:packages PAT
podman compose --env-file release.env -f compose.yaml config > /dev/null
podman compose --env-file release.env -f compose.yaml pull
podman compose --env-file release.env -f compose.yaml up -d
podman compose --env-file release.env -f compose.yaml ps
podman compose --env-file release.env -f compose.yaml logs --tail 50 api worker caddy
```

   `config` fails on any missing `release.env` value by design. Caddy obtains the two
   certificates on first start; both hostnames must already resolve.

7. Keep the stack across reboots: `podman generate systemd` is deprecated in favour of
   Quadlet, but for compose the simplest reliable path is a user service that runs
   `podman compose up -d` after boot:

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/neighbourhood.service <<'EOF'
[Unit]
Description=Neighbourhood online-test stack
After=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/deploy/neighbourhood
ExecStart=/usr/bin/podman compose --env-file release.env -f compose.yaml up -d
ExecStop=/usr/bin/podman compose --env-file release.env -f compose.yaml down
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload && systemctl --user enable --now neighbourhood.service
```

## 5. Static shells: build and upload

From your laptop, with the API origin from §4.1 and the public Supabase values (never the
service-role key):

```bash
export NEXT_PUBLIC_API_URL='https://<CADDY_API_HOST>'
export NEXT_PUBLIC_SUPABASE_URL='https://<ref>.supabase.co'
export NEXT_PUBLIC_SUPABASE_ANON_KEY='<anon key>'
pnpm build:online-test:pwas
for shell in vendor partner admin; do
  token="$(az staticwebapp secrets list --name "neighbourhood-${shell}-test" \
    --resource-group rg-neighbourhood-test --query properties.apiKey -o tsv)"
  npx --yes @azure/static-web-apps-cli@2 deploy "apps/${shell}-pwa/out" \
    --deployment-token "$token" --env production
done
```

Each export carries a generated `staticwebapp.config.json` (route rewrites for Next's
`<route>.html` files, 404 handling, security headers). Deployment tokens are read into the
shell for the command and never written down.

## 6. Release health and evidence

Set only credential-free HTTPS endpoints and the deployed Git SHA, then run:

```bash
export RELEASE_VERSION='full-lowercase-40-character-git-sha'
export ONLINE_TEST_EXPECTED_ENVIRONMENT='supabase-production'
export ONLINE_TEST_API_URL='https://<CADDY_API_HOST>/'
export ONLINE_TEST_CUSTOMER_URL='https://<CADDY_SHOP_HOST>/'
export ONLINE_TEST_VENDOR_URL='https://neighbourhood-vendor-test.azurestaticapps.net/'
export ONLINE_TEST_PARTNER_URL='https://neighbourhood-partner-test.azurestaticapps.net/'
export ONLINE_TEST_ADMIN_URL='https://neighbourhood-admin-test.azurestaticapps.net/'
pnpm online-test:health
```

Then a manual pass: customer sign-in with a synthetic phone (read the code with
`pnpm --filter @neighbourhood-store/database otp:read:supabase-production`),
vendor email sign-in and catalogue load, admin console load. Attach the generated safe JSON,
the Actions run URL, the three digests and `podman compose ps` output to the release record
(`release-record.example.json`). Do not attach raw environment output.

When health passes, set `status: active-azure-test` and `activeEnvironment: azure-test` in
`provider-targets.json` in a follow-up commit.

## 7. FCM, Web Push, Grafana Cloud, and PostHog

Unchanged from D-15: create these only when the matching adapter exists. No setup screen or
API key substitutes for the missing provider-neutral adapters.

## 8. Rollback rehearsal

Keep the last known-good `release.env` as a protected deployment record. A rollback changes
only `API_IMAGE`, `WORKER_IMAGE`, `CUSTOMER_PWA_IMAGE` and `RELEASE_VERSION` back to the prior
immutable values, validates the rendered Compose configuration, applies it, and reruns the
health command. Do not roll database migrations back automatically; use the reviewed paired
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
