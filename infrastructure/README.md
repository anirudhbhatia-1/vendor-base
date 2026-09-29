# Infrastructure

This directory owns local, free and reproducible infrastructure definitions.

| Path | Owns |
|---|---|
| root `compose.yaml` | The local stack: `database` and `database-test` (PostgreSQL/PostGIS) and `valkey` and `valkey-test`, the last two under the `test` profile |
| `online-test/` | The Azure company-test deployment (D-16): `Containerfile`, `Containerfile.customer-pwa`, `compose.yaml`, `Caddyfile`, `provider-targets.json` and `release.env.example` |
| `supabase-dev/`, `supabase-production/` | Operator `env.example` files for the two Supabase-backed modes |

Valkey is provisioned today, not later work: `VALKEY_URL` is a required runtime setting, the
`queue-compat` environment exists, and `pnpm db:test:up` starts `valkey-test`.

An infrastructure definition imports no application source. It may name an image digest, a
service, a port and an environment variable, and nothing else — the moment a compose file
depends on a module, the stack stops being reproducible from this directory alone. Definitions
must never contain credentials or real data: `online-test/compose.yaml` takes every piece of
private material through `${VAR:?...}` so a missing value stops the deployment instead of
falling back to the synthetic defaults committed to this repository.

The online-test procedure is in `runbooks/online-test/README.md`. D-16's compute target is Azure
Container Apps (`online-test/aca/*.json`, rendered and applied by
`tooling/scripts/deploy-azure-test.mjs`), with Azure Static Web Apps for the static shells; the
earlier Azure for Students VM definition remains in `online-test/compose.yaml` for reference. The
stack runs the `supabase-production` profile in synthetic mode against the development Supabase
project.
Production secrets, production domains, public launch and paid resources remain separately
gated.
