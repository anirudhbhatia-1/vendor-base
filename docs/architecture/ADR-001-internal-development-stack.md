# ADR-001 — Internal development stack and scale-ready foundation

**Status:** Accepted for internal company development  
**Decision date:** 13 August 2026  
**Owner:** Engineering Lead  
**Production authority:** None

## Context

The Neighbourhood Store Marketplace is currently a company-level test project. It needs a free local foundation that supports a PWA and an Android application, while preserving a credible route from a Jaipur synthetic pilot to thousands or lakhs (hundreds of thousands) of future users.

Scale-ready means important boundaries and data-access safeguards are designed now. It does not mean building a costly distributed production platform before usage is measured.

## Decision

### Repository and runtime

- Use a TypeScript pnpm workspace monorepo on Node.js 24 LTS.
- Commit one generated lockfile for the entire workspace.
- Link local packages with the explicit `workspace:` protocol.
- Use root pnpm scripts initially; do not add Nx or Turborepo until task orchestration is measurably inadequate.

### Clients

- Build the PWA in Next.js and the Android app in Expo/React Native simultaneously.
- Share contracts, validation schemas, translation keys, canonical state and error names, synthetic-data builders, and basic design tokens.
- Do not share platform-specific screens, navigation, offline behaviour, accessibility implementations, or device integrations.
- Treat every client as untrusted: the server recalculates authorization, price, availability, and allowed state transitions.

### Backend and data

- Use NestJS with TypeScript and Fastify.
- Begin with a modular monolith: one codebase with strict domain modules, stateless API processes, and independently runnable workers.
- Use PostgreSQL 18 as the system of record and PostGIS 3.6 for zones and nearby-store queries.
- Use Drizzle ORM and Drizzle Kit, with reviewed SQL migrations and explicit PostGIS activation.
- Prohibit automatic schema synchronization.
- Extract a module into a service only when measured scaling, fault-isolation, security, or team-ownership evidence requires it.

### Queue, cache, and adapters

- Prefer Valkey with BullMQ for jobs and short-lived cache data.
- Keep Redis 7.2 as a compatibility fallback, not as a simultaneously required service.
- Run the same BullMQ contract tests against Valkey and Redis before claiming fallback compatibility.
- Keep PostgreSQL authoritative; a cache miss or cache loss must not corrupt inventory, prices, orders, or ledger state.
- Use a local-filesystem storage adapter.
- Use deterministic fake email, SMS, payment, and maps adapters. All records and payloads are synthetic.

### Testing

- Use Jest for unit, component, shared-contract, NestJS API, integration, migration, queue, and adapter tests.
- Use Supertest inside the NestJS suite for HTTP behaviour.
- Use Playwright for real-browser PWA journeys.
- Use Maestro CLI against a local Android emulator for Android journeys.
- Do not require paid cloud test services.

### Data performance

- Add spatial indexes for supported PostGIS lookup patterns and ordinary indexes for demonstrated query patterns.
- Require bounded cursor pagination for growing collections.
- Batch related reads to prevent N+1 behaviour, where a list triggers one additional database request per item.
- Cache only measured high-traffic reads and define invalidation and maximum age for every cache entry.
- Add performance baselines before production capacity planning; do not promise a traffic number from local-machine tests.

## Local logical shape

```text
Next.js PWA ───────┐
                   ├──> stateless NestJS/Fastify API ──> PostgreSQL 18 + PostGIS 3.6
Expo Android app ──┘                   │
                                      ├──> local filesystem adapter
                                      └──> synthetic provider adapters

NestJS worker <── BullMQ <── Valkey
                           └── Redis 7.2 compatibility profile
```

During ordinary development, PostgreSQL/PostGIS and Valkey run in local Compose containers. Node applications run on the developer host for fast reload and debugging. The Redis fallback runs only through an explicit compatibility-test profile. No service is reachable from the public internet by default.

## Scale path

1. Keep API instances stateless so future replicas can share requests.
2. Keep background work in independently scalable, idempotent workers.
3. Use transactions and a transactional outbox for authoritative state plus event publication.
4. Measure database queries, queue delay, event-loop delay, memory, and end-to-end latency.
5. Add replicas, partitioning, dedicated search, or extracted services only after a measured bottleneck and an approved production design.

This avoids premature microservices while preventing a boundary-free monolith.

## Failure modes and required safeguards

| Failure | Required behaviour or evidence |
|---|---|
| Duplicate HTTP request or retried job | Stable idempotency key; no duplicate order, charge, refund, notification intent, or ledger effect |
| Queue process stops or reconnects | Durable jobs retry with bounded backoff; poisoned jobs become visible for review |
| Valkey/BullMQ incompatibility | Compatibility suite fails; use the Redis 7.2 profile until resolved |
| Cache unavailable or stale | Authoritative write path continues through PostgreSQL; critical reads are revalidated |
| Database query grows with catalogue size | Pagination limit, query-plan test, appropriate index, and a response-time baseline |
| PostGIS extension or migration missing | Startup/readiness and migration tests fail clearly |
| Fake provider returns timeout, decline, malformed data, or duplicate event | Deterministic fixture drives a safe, observable business outcome |
| Local filesystem receives unsafe path or file | Reject traversal, unsupported type, and size-limit violations |
| A client changes a price or transition locally | Server rejects it and returns the canonical result |
| Local service is exposed beyond the machine | Bind to loopback by default; fail documentation review before shared use |

## Verification map for Phase 2

```text
Shared schemas ──> Jest contract tests ──> PWA + Android + API agreement
API routes ──────> Jest/Supertest ───────> auth, validation, idempotency, errors
SQL migrations ─> up/down/up tests ─────> PostgreSQL 18 + PostGIS 3.6
BullMQ jobs ─────> identical suites ─────> Valkey preferred / Redis fallback
PWA flows ───────> Playwright ───────────> browser behaviour + accessibility
Android flows ──> Maestro local ────────> emulator behaviour + accessibility IDs
Fake adapters ──> deterministic tests ──> success, failure, timeout, duplicate
```

## Not in scope

- Hosting or a cloud provider
- A shared development environment, staging, or production
- Production credentials, secrets, domains, certificates, backups, restores, rollback, monitoring, or on-call operations
- Real email, SMS, payment, maps, push, analytics, or object-storage integrations
- App-store publication or a public PWA deployment
- Production traffic promises or a production cost estimate
- Microservices, Kubernetes, service mesh, multi-region data, or premature database sharding

## Alternatives rejected for this phase

- **One client first:** rejected because the owner explicitly requires simultaneous PWA and Android company development.
- **Microservices immediately:** rejected because distributed failure and operational costs arrive before measured need.
- **Cache-first data access:** rejected because stale inventory, price, and order state would create correctness risk.
- **All applications in containers:** rejected for the default inner loop because host-run Node processes provide simpler debugging and faster reload; container application builds may be added later for repeatability checks.
- **Paid provider sandboxes or hosted testing:** rejected because this company-development phase must use free local substitutes.

## Consequences

Phase 2 can create a reproducible local workspace and test harness. Simultaneous clients require more engineering coordination than a sequential release, and local-only adapters cannot prove production provider behaviour. Hosting, recovery, security hardening, production capacity, and operating cost must receive new decisions before any shared or public environment is created.

## References

- [Node.js releases](https://nodejs.org/en/about/previous-releases)
- [pnpm installation and supported runtime](https://pnpm.io/installation)
- [pnpm workspaces](https://pnpm.io/workspaces)
- [Next.js support policy](https://nextjs.org/support-policy)
- [NestJS 11 migration guidance](https://docs.nestjs.com/migration-guide)
- [Expo SDK releases](https://expo.dev/sdk)
- [Podman Compose guidance](https://podman-desktop.io/docs/compose)
- [Valkey compatibility guidance](https://valkey.io/topics/migration/)
- [BullMQ documentation](https://docs.bullmq.io/)
- [Drizzle PostGIS guidance](https://orm.drizzle.team/docs/guides/postgis-geometry-point)
- [Next.js testing guidance](https://nextjs.org/docs/app/guides/testing)
- [Expo testing guidance](https://docs.expo.dev/develop/unit-testing/)
- [NestJS testing guidance](https://docs.nestjs.com/fundamentals/testing)
- [Maestro local Android testing](https://docs.maestro.dev/getting-started/build-and-install-your-app/android)

