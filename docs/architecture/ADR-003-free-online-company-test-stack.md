# ADR-003 — Free online company-test stack

**Status:** Accepted as historical provider research; execution paused by D-12
**Decision date:** 18 August 2026
**Owner:** Engineering Lead
**Production authority:** None

## Context

The local foundation is reproducible, but the company also needs an online test target for the eight clients, API, worker, database, queue, storage, notifications, observability, analytics, and future CI. The selected services must remain free within bounded company-test quotas and preserve a credible provider-replacement path.

The local environment remains necessary for offline development, deterministic tests, provider simulators, and recovery when a free service is unavailable. This decision changes the selected **online-test target**, not the local test runner and not the production architecture.

[D-12](../decisions/D-12.md) subsequently returned the project to local-only active development. The provider selection below remains reference material and does not authorize further provisioning or integration.

## Decision

Select the following provider set for the future private `online_test` environment:

| Responsibility | Selected online company-test service |
|---|---|
| PWA hosting, static CDN and private object storage | Cloudflare Pages/Workers Static Assets and R2 |
| PostgreSQL and PostGIS | Supabase Free |
| NestJS/Fastify API, NestJS/BullMQ worker, Valkey and ClamAV | OCI Always Free compute |
| Android and PWA push | Firebase Cloud Messaging and standards-based Web Push/VAPID |
| Logs, metrics and traces | Grafana Cloud Free through OpenTelemetry |
| Product analytics | PostHog Free with an explicit privacy-safe event allowlist |
| Source hosting and future CI | Private GitHub Free repository and GitHub Actions |

Use provider-neutral ports and adapters. Domain modules must not import a provider SDK. PostgreSQL remains authoritative, Valkey remains disposable, and free-service quota exhaustion must fail safely without corrupting orders, inventory, prices, or ledgers.

## Activation boundary

This ADR selects targets but does not create accounts or deploy them. Activation requires the applicable numbered step and all of the following:

1. company-owned accounts with MFA and named recovery owners;
2. approved region, access, data mode, retention and deletion date;
3. typed `online_test` configuration and production-deny checks;
4. secrets from approved secret management, never committed files;
5. quota alerts and no uncontrolled paid overage;
6. provider contract, backup/restore, rollback and deletion evidence; and
7. synthetic data by default, with separately approved controlled real cases only.

GitHub Actions is defined by Step 2.5, with external execution and branch enforcement still awaiting authorized activation. Deployment remains Step 2.6. Selecting GitHub and the runtime providers does not start deployment.

## Explicitly unselected

This decision does not select production hosting, production database/queue/storage, real SMS or SMS OTP, payment gateway, payout provider, transactional email provider, commercial maps, identity/KYC provider, branded domain, or public Android distribution. The [free online migration plan](../production/free-online-company-test-migration-plan.md) records candidates and unavoidable costs for those responsibilities.

## Consequences

- Local `local`, `test`, and `queue-compat` modes continue to work without cloud access.
- A future `online_test` mode uses the selected services and must never silently fall back to live payment, payout, or SMS behavior.
- The selected free topology is deliberately a bounded company-test environment with several single failure domains and no production SLA.
- Production still requires measured capacity, security, privacy, finance, legal, recovery, support, cost, and provider decisions.

## References

- [Free online company-test migration plan](../production/free-online-company-test-migration-plan.md)
- [Local development stack](ADR-001-internal-development-stack.md)
- [Environment topology](environment-topology.md)
- [Canonical replacement register](../production/test-to-production-replacement-register.md)
