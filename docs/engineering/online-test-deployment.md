# Online-Test Deployment

**Environment:** the synthetic company-test environment under [D-16](../decisions/D-16.md)
**Data:** synthetic only
**Production approval:** none
**Current state:** live on Azure Container Apps since 17 September 2026; `provider-targets.json` records `status: active-azure-test`

> This environment runs the `supabase-production` profile with `DATA_MODE=synthetic` and
> `ALLOW_SYNTHETIC_PROVIDERS=synthetic-testing-only`: the fake OTP adapter is the only phone
> sign-in and object storage is each replica's ephemeral filesystem. Nobody outside the company is
> invited. The `online-test` profile — which refuses a fake adapter — remains the future staging
> profile and is not activated. D-12's pause was superseded by D-15 and D-16; the runbook is
> authorized to execute within D-16's boundaries, and nothing beyond them.

## What is deployed

- The API, the worker and the customer PWA with its same-origin BFF run as three Azure Container
  Apps (consumption) in Central India, built from one digest-pinned `Containerfile` and
  `Containerfile.customer-pwa` by `.github/workflows/release-images.yml`, stored in GHCR and
  deployed by digest through `tooling/scripts/deploy-azure-test.mjs` rendering
  `infrastructure/online-test/aca/*.json`.
- Valkey runs as a fourth container app with internal TCP ingress only.
- The vendor, partner and admin PWAs are static exports on one Azure Storage static-website
  account each; the customer PWA is not a static export because its BFF routes need a server.
- The database is the existing synthetic Supabase development project, reached through the
  transaction pooler as `marketplace_app` with `sslmode=verify-full`.
- API and worker refuse `production`, refuse non-synthetic data, require every private key to be
  injected explicitly (a committed default or placeholder fails startup), and require a full Git SHA.
- `infrastructure/online-test/compose.yaml` remains the laptop rehearsal of the same images.

Object storage (the Supabase Storage adapter exists but no bucket is provisioned), malware
scanning, push, observability and analytics are `notYetConnected` in `provider-targets.json`.
Creating an account does not make an adapter implemented.

## Repository commands

```bash
pnpm online-test:verify
pnpm build:online-test:pwas
pnpm test:controls
```

With the deployed URLs and the deployed Git SHA in the environment (never credentials):

```bash
pnpm online-test:health
```

The safe evidence file is written to `.online-test-evidence/<git-sha>.json`, which is ignored by
Git; the file for the current head records all six health checks passing.

## Promotion boundary

This environment is not staging and cannot be renamed or configured as production. Staging needs
the D-15 adapters implemented and configured; production needs a new approval, real-provider
adapters, real-data controls, a separate paid database project (D-14), recovery evidence, capacity
testing, budget approval, and a separately reviewed deployment definition. The
[runbook](../../runbooks/online-test/README.md) §9 lists what must hold before this environment
becomes the daily shared one instead of local.
