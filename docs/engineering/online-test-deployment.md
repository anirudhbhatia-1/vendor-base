# Online-Test Deployment Skeleton

**Environment:** `online-test` only
**Data:** synthetic only
**Production approval:** none
**Current state:** repository controls implemented; provider resources and external evidence pending

## What is deployable now

- Four Next.js shells can be exported as static `out/` directories for separate Cloudflare Pages projects.
- The API and worker can be built as separate non-root container images from one digest-pinned `Containerfile`.
- The OCI Compose definition keeps the API on host loopback for a future authenticated Cloudflare Tunnel and gives API and worker an internal-only network.
- API and worker refuse `production`, refuse non-synthetic data, and require a full Git SHA in `online-test`.
- Remote migrations accept only the selected Supabase project, require TLS, and require a project-specific typed confirmation.
- The external health verifier checks four HTTPS clients plus API identity and records non-secret evidence outside Git.

The API and worker are still shells. Database, queue, R2, ClamAV, notifications, analytics, and observability are intentionally marked `notYetConnected` in `provider-targets.json`. Creating an account does not make an adapter implemented.

## Repository commands

```bash
pnpm online-test:verify
pnpm build:online-test:pwas
pnpm test:controls
```

After resources exist, use the environment variables documented in the runbook and run:

```bash
pnpm online-test:health
```

The safe evidence file is written to `.online-test-evidence/<git-sha>.json`, which is ignored by Git.

## Promotion boundary

`online-test` cannot be renamed or configured as production. A production environment needs a new approval, real-provider adapters, real-data controls, recovery evidence, capacity testing, budget approval, and a separately reviewed deployment definition.
