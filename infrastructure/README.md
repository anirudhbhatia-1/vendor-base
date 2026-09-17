# Infrastructure

This directory owns local, free and reproducible infrastructure definitions.

| Path | Owns |
|---|---|
| root `compose.yaml` | The local stack: `database` and `database-test` (PostgreSQL/PostGIS) and `valkey` and `valkey-test`, the last two under the `test` profile |
| `online-test/` | The deployment skeleton: `Containerfile`, `compose.yaml`, `provider-targets.json` and `release.env.example` |
| `supabase-dev/`, `supabase-production/` | Operator `env.example` files for the two Supabase-backed modes |

Valkey is provisioned today, not later work: `VALKEY_URL` is a required runtime setting, the
`queue-compat` environment exists, and `pnpm db:test:up` starts `valkey-test`.

An infrastructure definition imports no application source. It may name an image digest, a
service, a port and an environment variable, and nothing else — the moment a compose file
depends on a module, the stack stops being reproducible from this directory alone. Definitions
must never contain credentials or real data: `online-test/compose.yaml` takes every piece of
private material through `${VAR:?...}` so a missing value stops the deployment instead of
falling back to the synthetic defaults committed to this repository.

The online-test procedure is in `runbooks/online-test/README.md`. D-15 supersedes D-12's
local-only restriction and records the approved staging direction, but approval is not
activation: no compute is provisioned, and production secrets, production domains, production
certificates, public launch and paid resources remain separately gated.
