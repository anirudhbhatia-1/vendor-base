# Free Online Company-Test Migration Plan

**Status:** Paused by D-12; local company development active; future migration reference only
**Target environment described:** A private, bounded, online company-test environment
**Production authority:** None
**Owner:** Engineering Lead
**Last researched:** 18 August 2026

## 1. Decision and limits

The local system will keep provider-neutral interfaces so that each local dependency can later be replaced without rewriting marketplace domain logic. D-11 and ADR-003 preserve the researched online company-test provider set. D-12 pauses its execution and makes the local stack the only active environment for development, deterministic tests and provider simulators.

This is **not** a promise that a public marketplace serving thousands or lakhs of people can run permanently for zero cost. Free tiers have quotas, can change, usually lack production service-level agreements, and may suspend or reject work at their limits. Real SMS OTP, payment processing, payouts, a branded domain, and unrestricted Google Play distribution have no safe, dependable, permanently free route. Those are explicit cost gates, not missing research.

Before D-12, four synthetic Cloudflare Pages snapshots and an empty Supabase/PostGIS baseline were created. They are paused and non-authoritative. Cloudflare R2 was not activated, OCI was not provisioned, and no API, worker, queue, storage, identity, notification, analytics, or observability adapter was connected online. The repository retains the controlled `online-test` build, database, container, health-evidence, and rollback skeleton as future reference. Production replacements remain unselected until the corresponding row in the [canonical replacement register](test-to-production-replacement-register.md) passes its owners, evidence, security, privacy, finance, recovery, and operational gates.

### Terms used below

| Term | Meaning |
|---|---|
| `FREE_TEST_CANDIDATE` | Credible within the provider's current free allowance for bounded company testing; not approved for production. |
| `SELECTED_ONLINE_TEST` | Approved target for the future private online company-test environment; account creation, integration and deployment are still incomplete. |
| `SELF_HOST_FREE_SOFTWARE` | No software licence fee, but it consumes compute, storage, bandwidth, maintenance, and staff time. |
| `LIMITED_FREE_TIER` | Free only below documented quotas; design must fail safely rather than incur surprise charges. |
| `NO_FREE_SAFE_OPTION` | Real use necessarily has a fee, legal/account requirement, or unacceptable free-service reliability/abuse risk. |
| `LATER_PRODUCTION_DECISION` | A scalable, supported production replacement and budget must be selected from measured demand. |

## 2. Selected online company-test topology

```text
GitHub private repository + bounded GitHub Actions
                │
                ├── Cloudflare Pages / Workers Static Assets
                │       └── four statically exported Next.js PWAs
                │
                └── OCI Always Free Arm VM (private company-test runtime)
                        ├── Caddy or Cloudflare Tunnel ingress
                        ├── NestJS/Fastify API
                        ├── NestJS/BullMQ worker
                        ├── Valkey
                        └── ClamAV scanner
                                  │
               ┌──────────────────┼────────────────────┐
               │                  │                    │
      Supabase Postgres      Cloudflare R2       provider adapters
          + PostGIS          private objects     ├── FCM push
                                                ├── email free tier
                                                ├── maps data/services
                                                └── fake or paid-only gates
```

The database remains authoritative. Valkey may be destroyed and rebuilt from PostgreSQL plus the future transactional outbox. Cloudflare and the OCI VM must not become alternate stores for orders, inventory, prices, or ledgers.

The online company-test environment must remain private or strongly access-controlled, use synthetic data by default, and have hard quota alarms. It is a rehearsal environment between local development and later production-shaped staging; it is not production.

## 3. Complete local-to-online replacement matrix

| Area | Local implementation or current boundary | Recommended free online company-test candidate | How it changes in the repository | Free boundary and production direction | Register |
|---|---|---|---|---|---|
| Source control | Local Git worktree | Private GitHub Free repository | Add remote only after approval; protect the default branch and require current quality scripts | GitHub Free organizations currently include 2,000 Actions minutes and 500 MB Actions storage per month. Private registry allowance is small; production needs a governed source, artifact, and retention decision. | `INF-06`, `REL-03` |
| CI | Root pnpm checks plus the Step 2.5 workflow; external execution not yet evidenced | GitHub Actions free allowance; optional self-hosted runner on OCI | Activate the pinned least-privilege workflow, require its final gate on protected branches, retain safe outcome-only artifacts for seven days, and record the first external run | Stop jobs at the free quota. Do not weaken checks to save minutes. Self-hosted runners save hosted minutes but add patching and isolation work. | `INF-06`, `REL-03` |
| Four PWAs | Host-run Next.js development/build shells | Cloudflare Pages or Workers Static Assets | Add a dedicated company-test static-export profile, runtime API base URL, immutable build metadata, and deploy four separate role sites | Static requests are free/unlimited under current Workers pricing, but free Worker functions are limited to 100,000 requests/day and 10 ms CPU per invocation. Dynamic Next.js server behavior would require a separately tested runtime. | `INF-01`, `REL-02` |
| Four Android apps | Expo/React Native shells and local emulator/export | Locally signed internal APKs; Expo Free builds as a convenience; Google Play limited distribution only for a tiny test cohort | Add environment-specific API URLs, unique application IDs, protected signing, update policy, and an internal distribution runbook | Expo Free currently includes limited low-priority builds and update usage. Google's no-fee limited distribution is capped at 20 devices; full Play distribution requires a one-time USD 25 registration fee. Public distribution is `NO_FREE_SAFE_OPTION`. | `INF-10`, `REL-02` |
| API runtime | Host-run NestJS/Fastify process on loopback | OCI Always Free Ampere A1 VM with Podman-compatible containers | Add a separate online-test Compose/Quadlet definition, health checks, non-root user, resource limits, immutable image/build reference, and allowlisted config | OCI describes Always Free compute as suitable for small applications/proofs of concept; capacity can be unavailable and there is no production SLA. Scale later through measured stateless replicas on an approved paid platform. | `INF-01` |
| Worker runtime | Host-run NestJS worker shell | Same OCI VM initially, independently supervised and resource-limited | Deploy a distinct worker process/artifact; preserve separate readiness, concurrency, graceful shutdown, and queue-delay telemetry | Sharing one free VM is a single failure domain. Production requires separate scaling/failure boundaries and capacity evidence. | `INF-01`, `INF-03` |
| Container runtime | Podman Desktop and standard local `compose.yaml` | Podman on OCI Linux; keep the standard Compose contract for development | Create an online-test file; never reuse local volumes, credentials, host ports, or fixture commands | Podman/Compose software remains free. Compute and operations do not become free merely because the runtime is open source. | `INF-01` |
| PostgreSQL/PostGIS | Local `postgis/postgis:18-3.6`, paired migrations, synthetic fixtures | Supabase Free PostgreSQL with PostGIS for bounded online testing | Use a direct migration URL and pooled runtime URL; add a Supabase compatibility migration for the extension schema; run reviewed SQL, never copy a local volume; do not run fixtures outside an isolated synthetic schema | Current Free allowance is 500 MB database per project and two free projects. It is unsuitable as the final HA/backup/scale promise. Production provider remains open until load, region, RPO/RTO, and cost tests. | `INF-02` |
| Database pooling | No online pool | Supabase transaction/session pooler as appropriate | Add separate `DATABASE_DIRECT_URL` for migrations and `DATABASE_POOL_URL` for services; set bounded per-process pools | Pool limits and connection behavior must be load-tested. Do not point schema migrations through a transaction pooler. | `INF-02`, `REL-04` |
| Database backup | Disposable local volumes and migration verification | Scheduled encrypted `pg_dump` from OCI to private R2, plus checksum and restore rehearsal | Add a backup job and runbook only after secrets/storage approval; exclude synthetic fixtures where required; record restore evidence | This is an inexpensive test backup, not managed PITR/HA. Free R2 capacity is finite and one VM scheduler is a failure point. Production requires approved PITR, off-site copies, RPO/RTO, and retention. | `INF-02`, `REL-05` |
| Queue/cache | BullMQ pinned; Valkey target not yet connected | Self-hosted Valkey on the OCI VM | In the later queue step, add TLS/private-network config, named queues, idempotency, bounded retention, poison-job handling, and recovery from durable state | Valkey is free software; the VM is finite and single-node. Upstash Free is an optional compatibility target (256 MB/500,000 commands monthly), but BullMQ polling can consume commands even while idle. Production needs a measured managed or HA topology. | `INF-03` |
| Scheduled work | Not implemented | BullMQ repeatable/job scheduler on the same worker; OCI cron only for infrastructure jobs | Domain schedules belong in worker code with durable intent; host cron is limited to backups/maintenance | A single VM can miss schedules. Production requires leader safety, observability, replay, and recovery. | `INF-03`, `REL-05` |
| Object storage | Planned repository-local filesystem adapter | Private Cloudflare R2 bucket | Implement the existing storage contract using S3-compatible calls, per-purpose prefixes, checksums, metadata, signed short-lived access, and lifecycle/deletion jobs | R2 currently includes 10 GB-month storage, 1 million Class A and 10 million Class B operations monthly, with free egress. It is a limited tier, not unlimited storage. | `PRV-07` |
| Malware scanning | Simulated scan result | ClamAV on OCI, scanning quarantined objects before promotion | Upload to quarantine prefix, enqueue scan, stream to ClamAV, record signature/version and result, then copy/promote clean objects; fail closed on scanner outage | ClamAV is GPLv2 open-source software, but signatures, memory, CPU, updates, false positives, and scanner isolation remain operating responsibilities. | `PRV-07` |
| Image processing | Not selected | `sharp`/libvips in the worker, outputs stored in R2 | Validate type/size before decoding, strip metadata, create bounded variants, and preserve original only when policy allows | Free software consumes the same small VM. Production may need a managed media pipeline after measured volume. | `PRV-07`, `REL-04` |
| Secrets and keys | `.env.example` plus local environment values | OCI Vault Always Free for runtime secrets; GitHub encrypted secrets for CI-only delivery | Implement secret references, workload/instance identity, rotation versions, least privilege, startup validation, and redaction; never put secrets in PWA or Android bundles | OCI currently includes 150 Always Free secrets and software-protected master keys. The design still needs rotation, access audit, break-glass, and backup procedures. | `INF-04` |
| Ingress/TLS | Loopback-only local ports | Cloudflare proxy/Tunnel and provider subdomains for company testing; Caddy is an open-source fallback | Keep the API private where possible; allowlist origins; configure TLS, headers, rate limits, health checks, and origin authentication in separate online-test declarations | Cloudflare free services and provider subdomains avoid a test-domain bill. A branded registered domain is `NO_FREE_SAFE_OPTION`; production ingress needs redundancy, ownership, WAF, and incident controls. | `INF-05` |
| DNS/domain | None | Free provider subdomains such as `pages.dev` for company tests | Store hostnames as environment config, never hard-code them in clients | DNS hosting and TLS may be free; acquiring/renewing a branded domain is not reliably free. Budget it before public launch. | `INF-05` |
| Push | Fake push outbox | Firebase Cloud Messaging for Android and standards-based Web Push/VAPID for PWAs | Implement a notification adapter, encrypted token registry, consent, token rotation/revocation, collapse/deduplication, and delivery telemetry | FCM is currently a no-cost Firebase product. It does not guarantee delivery and is not an SMS fallback. Apple/iOS is outside the current Android scope. | `PRV-05` |
| Transactional email | Fake email outbox | OCI Email Delivery Always Free (3,000/month) or Resend Free (3,000/month, 100/day) | Implement one provider-neutral email adapter, verified sender/domain setup, templates, suppression/opt-out where applicable, callback status, and a local fake implementation | Both are bounded free tiers; sender reputation and a branded domain may cost money. Production volume and support require a budgeted provider decision. | `PRV-06` |
| Transactional SMS | Fake SMS outbox | No permanent free real-SMS provider | Keep the fake adapter for local/synthetic tests. Add a paid real adapter only after sender, DLT/regulatory, privacy, rate, fraud, callback, and finance approval | `NO_FREE_SAFE_OPTION`. Trial credits and shared/free gateways are not a safe production architecture. | `PRV-06` |
| Login/handoff OTP | Fake OTP generator/outbox | Email OTP or passkey for no-cost company testing; paid SMS OTP for approved real-phone cases | Keep purpose-scoped request/verify contracts. Add rate limits, hashed short-lived challenges, resend/attempt controls, abuse telemetry, and adapter allowlisting. Never add a universal OTP | Firebase phone verification requires its paid Blaze plan; Supabase phone auth also needs an SMS provider. Real SMS OTP is `NO_FREE_SAFE_OPTION`, even though a bounded real-provider test can be low cost. | `PRV-01` |
| Authentication/session storage | Not yet implemented | Marketplace-owned session/token service backed by PostgreSQL; optional Supabase Auth only after an ADR | Preserve server-side RBAC/tenant checks, refresh rotation, revocation, device/session audit, and account recovery behind domain contracts | Supabase Free lists 50,000 MAU, but provider lock-in and phone delivery are separate concerns. Production identity needs security/privacy review, not just a free MAU count. | `PRV-01`, `DATA-01` |
| Payments | Fake authorization/capture/refund/callback simulator | Provider sandbox remains free for testing; real Indian gateway selected later | Keep payment adapter and authoritative ledger/outbox. Implement signed callback inbox, idempotency, unknown outcomes, reconciliation, and controlled company transactions before canary | `NO_FREE_SAFE_OPTION` for real money. Razorpay advertises no setup/annual fee but charges transaction fees (for example 2% plus GST for standard domestic pricing). Never build around temporary zero-fee promotions. | `PRV-02`, `FIN-06` |
| Payouts/settlements | Fake payout batches and statements | Provider sandbox/manual synthetic statements now; regulated bank/payout provider later | Keep beneficiary tokens out of app storage; add maker-checker, signed callbacks, statement import, immutable ledger, holds, and reconciliation | `NO_FREE_SAFE_OPTION` for real bank payouts at marketplace scale. Provider/bank, KYC, tax, fraud, and transaction costs need Finance and Legal approval. | `PRV-03`, `FIN-07` |
| Customer price calculation | Synthetic policy | Existing server-side pricing policy contract; later versioned approved policy | Customer clients receive only the complete final price and required display lines; server keeps internal fee calculation and version; ledger stores provenance | Software calculation is free. Production tax, platform fee, refund, promotion, and settlement policy are not approved by this plan. | `FIN-01`–`FIN-03` |
| Maps rendering | Fake map response and fixed synthetic coordinates | MapLibre GL plus a bounded Jaipur PMTiles/OSM-derived dataset hosted in R2 | Add a maps adapter and client rendering layer; keep zone/serviceability decisions server-side; preserve attribution and dataset version | MapLibre is open source. OpenStreetMap data has attribution/licence duties; the public OSM tile servers must not be used as a free commercial CDN. | `PRV-04` |
| Geocoding/routing | Fixed synthetic routes/distances | Jaipur-scoped self-hosted Nominatim plus OSRM/Valhalla on OCI only if the VM proves sufficient; otherwise text/landmark entry and deep links to installed navigation | Separate geocoding, routing, and serviceability contracts; cache only under source policy; record dataset/version and provide manual correction | Free software still needs data imports, updates, memory, storage, attribution, and operations. National, real-time, high-volume routing is a `LATER_PRODUCTION_DECISION`. | `PRV-04`, `REL-04` |
| Product analytics | Synthetic metrics and local evidence | PostHog Cloud Free with strict allowlist, or privacy-safe aggregate events stored in PostgreSQL | Add a server/client-neutral analytics interface; prohibit raw phone, address, OTP, payment, document, or precise-location data; include environment and synthetic/real provenance | PostHog currently includes 1 million product analytics events/month. Free quota and retention are not consent, purpose, or privacy approval. | `PRV-08`, `DATA-09` |
| Logs/metrics/traces | Structured local API/worker stdout | OpenTelemetry to Grafana Cloud Free; OCI logging/monitoring as infrastructure fallback | Preserve JSON logs, add trace/request IDs, explicit redaction, sampling, bounded labels, dashboards and alerts; exports must fail open for application traffic but alert on loss | Grafana Free currently includes 10,000 metric series and 50 GB each of logs and traces with shorter retention and three active users. OCI also includes bounded Always Free observability. Production needs retention, SLA, incident, and cost approval. | `PRV-08` |
| Error reporting | Local logs only | OpenTelemetry exception events in Grafana; no separate provider initially | Normalize safe error codes and stack traces server-side; exclude request bodies and secrets; alert only on actionable thresholds | The free observability quota is shared. A dedicated error service is a later measured decision. | `PRV-08` |
| Feature flags/config | Environment files and future DB configuration | Versioned PostgreSQL configuration with admin audit; PostHog flags only if already approved for analytics | Flags must be server-authoritative, environment-scoped, reversible, default-safe, and incapable of selecting fake providers in production | Avoids another dependency. Production still needs approval/rollback ownership and propagation evidence. | `INF-04`, `REL-07` |
| Identity/document review | Fictional manual register and no provider | Protected manual review in the Admin PWA with R2 + ClamAV; external KYC only if later legally required | Implement least-privilege queues, two-person high-risk actions, expiry/appeal, redacted views, audit, deletion and no automated final denial | Manual software can be hosted in the free test stack, but staff time and authoritative verification access are not free. External KYC is a `LATER_PRODUCTION_DECISION`. | `PRV-09`, `DATA-04` |
| Support/operations | Manual Markdown templates | Admin PWA queues backed by PostgreSQL; encrypted email only for approved notifications | Turn runbook fields into audited cases gradually; retain controlled manual fallback and explicit ownership | Staff coverage, phone service, escalation, and public SLA are operational costs. Free hosting does not provide free support. | `OPS-09`, `REL-06` |
| Security scanning | Local secret/dependency scripts plus the Step 2.5 GitHub workflow and bounded Dependabot configuration | Existing scripts in GitHub Actions; Dependabot/security updates within repository plan; periodic OWASP tools on OCI/CI where safe | Activate the workflow, preserve immutable action pins, store only safe outcome reports, triage findings, and never upload secrets/source to unapproved scanners | Free automation has minute/storage quotas and does not replace threat modeling, review, penetration testing, or incident response. | `REL-03` |
| Test frameworks | Local Jest/Supertest/Playwright/Maestro | Keep them free and local/CI; run browser tests within Actions quota and Android tests locally or on a self-hosted runner | Same commands and artifacts across machines; shard only after measured need; do not use real personal/payment data | Free compute quotas constrain frequency. Public release still requires device, accessibility, load, security, and real-provider evidence. | `REL-01`–`REL-04` |
| Backups/artifacts retention | Local workspace | R2 encrypted backup prefixes and minimal GitHub artifacts | Apply classification, checksums, lifecycle expiry, restore tests, and deletion evidence | R2's free storage is shared with application objects. Production needs isolated accounts/buckets, immutable backup controls, and costed retention. | `REL-05`, `PRV-07` |

## 4. Provider-neutral implementation structure

The provider must never be selected by a client request. Runtime configuration chooses one allowlisted adapter at startup. Domain modules depend only on ports/contracts.

```text
packages/
  contracts/                    public request/event schemas
  config/                       typed environment schema and provider allowlists

apps/api/src/
  modules/<domain>/             marketplace rules; no provider SDK imports
  infrastructure/
    database/                   pooled PostgreSQL implementation
    identity/                   session and OTP implementations
    storage/                    filesystem | r2
    maps/                       fake | osm-self-hosted | later-provider
    notifications/              fake | fcm | email | later-sms
    payments/                   fake | sandbox | later-live
    observability/              stdout | otel

apps/worker/src/
  queues/                       BullMQ registration and durable job handlers
  processors/                   storage scan, notifications, reconciliation, backup intent

infrastructure/
  local/                        current loopback-only definitions
  online-test/                  future OCI/Cloudflare/Supabase declarations
  production/                   must not exist until separately approved

docs/runbooks/
  online-test/                  deploy, rollback, quota, backup and restore procedures
```

These are responsibility targets, not authorization to create empty directories now. Use the canonical path map in `docs/architecture/repository-structure.md` when implementation begins.

### Required configuration contract

Use distinct typed keys rather than one ambiguous `ENV` switch:

```text
DEPLOYMENT_STAGE=local|online_test|staging|production
DATA_MODE=synthetic|approved_controlled_real|real

DATABASE_POOL_URL=<runtime pool, secret>
DATABASE_DIRECT_URL=<migration connection, secret>
QUEUE_URL=<Valkey TLS/private URL, secret>

STORAGE_ADAPTER=filesystem|r2
OTP_ADAPTER=fake|email|paid_sms
PAYMENT_ADAPTER=fake|sandbox|live
PAYOUT_ADAPTER=fake|sandbox|live
MAPS_ADAPTER=fake|osm_self_hosted|commercial
PUSH_ADAPTER=fake|fcm
EMAIL_ADAPTER=fake|oci_email|resend
OBSERVABILITY_ADAPTER=stdout|otel
ANALYTICS_ADAPTER=none|postgres_aggregate|posthog
```

Production startup must reject `DATA_MODE=synthetic`, all fake/sandbox money adapters, filesystem object storage, fixture loaders, controllable clocks, universal OTPs, local outboxes, placeholder secrets, and unapproved provider names. `online_test` must reject public discovery and must not silently fall through to live money, payout, or SMS calls.

## 5. Migration sequence

This plan does not start the next engineering step. D-12 currently prohibits executing it. After a new explicit resume decision inventories existing resources and rotates credentials, use this order:

1. **Approve the environment boundary.** Name the owner, users, data mode, access method, region, quota ceilings, stop conditions, deletion date, and incident route.
2. **Create accounts and cost guards.** Use company-owned accounts, least privilege, MFA, recovery owners, provider budgets/quotas, and no automatic paid overage where the provider permits it.
3. **Prepare artifacts.** Activate and prove the Step 2.5 CI gate, then build immutable PWA/API/worker/Android artifacts, generate an SBOM, scan secrets/dependencies, and record commit/version.
4. **Provision secrets and network.** Configure OCI Vault, private ingress/origin authentication, scoped GitHub delivery credentials, TLS, firewall rules, and redaction before application data.
5. **Create the database.** Enable PostGIS in the approved Supabase schema, run paired migrations through the direct URL, verify indexes/extensions, and seed only the isolated synthetic schema.
6. **Restore-proof first.** Produce an encrypted dump, write it to R2, restore into a disposable target, compare migration/version/checksums, and record achieved recovery time/data loss.
7. **Deploy API and worker.** Start stateless API plus separately supervised worker on OCI; connect pooled database and Valkey; validate readiness, graceful shutdown, idempotency, queue recovery, and resource ceilings.
8. **Add storage quarantine.** Configure private R2, ClamAV signatures, upload limits, quarantine/clean prefixes, signed access, lifecycle, and deletion verification.
9. **Deploy static PWAs.** Export four role-specific sites, set only public-safe configuration, enforce access control/CORS/CSP, and confirm no server secret is bundled.
10. **Distribute Android internally.** Protect signing material, use environment-specific application IDs, distribute only to named company devices, and test upgrade/rollback and API trust.
11. **Enable non-money providers.** Prove email, FCM, maps, observability, and analytics adapters with synthetic payloads and quota alarms. Keep fake adapters available only outside production.
12. **Run controlled real-provider cases separately.** After approvals, use named company contacts/accounts for real OTP, payment, refund, and payout contract evidence. Do not treat this as public production.
13. **Reconcile and destroy.** Confirm database/queue/provider statements, export safe evidence, revoke temporary access, delete expired data, and either shut down or explicitly renew the test environment.

## 6. Free-quota failure policy

Every free service must expose usage and have thresholds at 50%, 75%, 90%, and 100% where measurable.

| Event | Required behavior |
|---|---|
| A non-critical analytics/observability quota nears exhaustion | Increase sampling or stop the optional export; never drop authoritative business writes. |
| Email/push quota nears exhaustion | Stop non-essential messages, preserve notification intents, and show in-app state. Do not silently switch to paid SMS. |
| Database/storage quota nears exhaustion | Stop new test onboarding/uploads before corruption; retain approved reads and active obligations; archive/delete only under policy. |
| Queue becomes unavailable | Stop accepting operations that cannot be safely represented in PostgreSQL/outbox; recover jobs from durable intent. |
| Compute capacity is exhausted | Apply admission control and reduce company-test concurrency; do not claim production scale. |
| Provider changes or removes a free tier | Freeze new dependency use, evaluate exit/export, and update this file plus the replacement register before migration. |
| A provider requests a payment method | Apply a zero/low budget alert and explicit overage controls; do not authorize charges from this plan. |

## 7. Hard-cost exceptions

The following cannot be honestly designed as permanently free for the intended public marketplace:

| Capability | Why free is unsafe or unavailable | Required later decision |
|---|---|---|
| Real SMS and SMS OTP | Carrier delivery, sender registration, anti-abuse, and message fees exist; trial credits expire | Approved provider, DLT/regulatory path, per-message budget, fraud controls, fallback and support |
| Real card/UPI payment processing | Gateway/network/regulatory processing charges apply per transaction | Merchant/provider contract, fee/tax model, reconciliation, disputes, reserves and incident controls |
| Real vendor/partner payouts | Banking rails, KYC, beneficiary verification, fraud and payout operations cost money | Payout provider/bank, maker-checker, funding, statements, reversals and finance approval |
| Branded domain | Registration and renewal are scarce-resource fees even when DNS/TLS hosting is free | Company ownership, registrar, renewal controls, DNSSEC, recovery and budget |
| Unrestricted Play Store distribution | Google full-distribution registration requires a one-time USD 25 fee | Company developer account, verification, signing custody, store policy/support and release process |
| High-scale hosting/database/maps/observability | Free quotas and single nodes do not provide lakhs-user capacity, HA, SLA, support, recovery, or predictable performance | Load-derived architecture, capacity model, provider contract, budgets, SLOs, multi-failure recovery and exit plan |
| Staffed operations and compliance | Human verification, support, finance, security, privacy, incident response and legal review are labor, not cloud features | Named teams, hours, authority, training, escalation, contracts and operating budget |

The marketplace may recover approved per-order platform and operational charges through the final customer-visible price, as already required by the pricing policy. The internal calculation does not need to be exposed, but all legally required price/tax/fee information must be shown before confirmation. Free-tier assumptions must never be embedded as permanent customer pricing.

## 8. Production replacement trigger

Before any public production canary, replace or formally re-approve every free candidate when any of these is true:

- expected peak or monthly use exceeds 60% of a free limit;
- a provider lacks the required India region, data controls, export, support, SLA, audit, or contract;
- one VM, one region, or one account can stop ordering or corrupt recovery objectives;
- achieved load/soak tests miss the latency, queue-delay, connection, storage, or recovery target;
- a card-funded account can incur unbounded overage;
- operating effort costs more than a managed service;
- provider terms prohibit or materially restrict the intended marketplace use; or
- Finance, Security, Privacy, Legal/Compliance, Operations, or Engineering rejects the risk.

Production selection should compare at least two suitable providers using measured Jaipur pilot traffic, order rate, catalogue/object volume, database size, queue commands, messages, map requests, log volume, RPO/RTO, staffing, and exit cost. “Has a free tier” is not a production selection criterion.

## 9. Source facts and review cadence

Provider limits below were checked against official documentation on 18 August 2026. Recheck them before account creation, every 90 days while used, and before each environment promotion because providers can change pricing and terms.

- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), and [Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Oracle Cloud Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Supabase billing and Free quotas](https://supabase.com/docs/guides/platform/billing-on-supabase), [cost controls](https://supabase.com/docs/guides/platform/cost-control), and [PostGIS](https://supabase.com/docs/guides/database/extensions/postgis)
- [Upstash Redis pricing](https://upstash.com/pricing/redis) and [BullMQ integration warning](https://upstash.com/docs/redis/integrations/bullmq)
- [GitHub included usage](https://docs.github.com/en/billing/reference/product-usage-included) and [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Expo plans](https://docs.expo.dev/billing/plans/), [Google Play developer registration](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en), and [Google limited distribution](https://support.google.com/android-developer-console/answer/16640817?hl=en)
- [Firebase pricing](https://firebase.google.com/pricing) and [Firebase Authentication limits](https://firebase.google.com/docs/auth/limits)
- [Resend pricing](https://resend.com/pricing)
- [MapLibre](https://maplibre.org/about/) and [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
- [Razorpay e-commerce pricing](https://razorpay.com/solutions/e-commerce/)
- [Grafana Cloud Free plan](https://grafana.com/docs/grafana/latest/introduction/grafana-cloud/) and [usage limits](https://grafana.com/docs/grafana-cloud/cost-management-and-billing/manage-invoices/understand-your-invoice/usage-limits/)
- [PostHog current free allowances](https://posthog.com/)
- [ClamAV official repository and GPLv2 licence](https://github.com/Cisco-Talos/clamav)

## 10. Relationship to the canonical register

This file supplies researched candidates and a migration structure. It does **not** advance any canonical status. To adopt one candidate:

1. update the matching row in `test-to-production-replacement-register.md` with the exact provider/version and repository paths;
2. record account ownership, region, quota, terms, data processing, security, cost, support, exit, rollback, and evidence;
3. pass the provider-neutral contract suite in its sandbox/test environment;
4. complete controlled company-account cases where real behavior matters; and
5. obtain the named approvals before changing the row from `BLOCKED`.

The fake/local implementation remains the default until those steps are complete. A provider name in this plan is a researched option, not an activated dependency.
