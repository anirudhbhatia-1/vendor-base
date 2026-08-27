# Launch Readiness and Localization

**Scope:** phases.md Phase 12 (security, accessibility, localization, resilience, performance, operational readiness), company-local synthetic development only
**Production authority:** None

Phase 12 differs from every phase before it: Phase 3–11 built domain aggregates; Phase 12 **verifies**
that what was built is safe to launch. The honest classification of the seven sub-steps into what a
company-local synthetic environment can genuinely prove versus what must wait for real infrastructure:

| Step | Description | Company-local delivery | Deferred until |
|---|---|---|---|
| 12.1 | Security and privacy review | **Partial** — cross-role capability-catalog probe in `verify-launch-readiness.ts`, controller authorization specs (every controller has one), OTP/session/webhook replay tests in existing verifiers | Full threat-model workshop; real penetration test |
| 12.2 | Accessibility review | **Deferred** — persistent client gap; the browser PWAs and Expo apps used by end users are minimal stubs across every phase | Full UI implementation |
| 12.3 | English/Hindi localization | **Complete** — migration 0033 registers server-code labels + English + Hindi translations; `verify-launch-readiness.ts` fails CI on any missing translation, on a customer bundle leaking admin labels, or on a non-admin locale write | — |
| 12.4 | Low-end device / poor network | **Deferred** — needs real device farm and network shaping infrastructure | Physical device lab or cloud device farm |
| 12.5 | Resilience drills | **Partial** — `verify-launch-readiness.ts` runs an outbox transient-failure retry drill and verifies the event reaches PUBLISHED; `verify-messaging-lifecycle.ts` covers backoff timing and dead-letter | Real chaos-injection tooling; full backup-restore drills against a live replica |
| 12.6 | Performance and concurrency | **Deferred** — needs load-generator infrastructure and a target environment large enough to measure p95/p99 | Phase 13 pilot cohort or a dedicated load-test environment |
| 12.7 | Operational readiness | **This document** — the launch gate matrix below cross-references every Phase 12 requirement with existing evidence, deferrals, and owners |

## What ships in this slice

- Migration `0033_locale_registry` adds `locale_keys` and `locale_translations` with 30 seed keys
  covering customer, vendor, partner, admin, receipt, notification, error, and support namespaces,
  each with both English and Hindi.
- `LocaleRegistryService` exposes `listKeys`, `bundleForLanguage`, `coverage`, `upsertKey`,
  `setTranslation`. Writes are admin-only; reads are unauthenticated so a customer PWA can
  hydrate its label bundle before login.
- `admin.locale.manage` capability granted to `SUPPORT_AGENT` so a support operator can add
  translations without a code deployment.
- `verify-launch-readiness.ts` — 12 connected scenarios covering: locale coverage cleanliness,
  audience-scoped bundle filtering, Devanagari validation, admin-only writes, unregistered-key
  rejection, invalid-shape rejection, capability catalog kind consistency, and the outbox
  transient-retry drill (transient failure returns event to PENDING with `attempt_count=1`;
  a follow-up dispatch settles it to PUBLISHED).

## Launch gate matrix — the 12.7 register

Each row lists a launch-blocking requirement, where its evidence lives today, and the owner who
must sign off before production launch. `Deferred` means the requirement is documented but its
evidence needs infrastructure or people that a company-local synthetic environment cannot supply.

### Security and privacy (Phase 12.1)

| Requirement | Evidence | Owner |
|---|---|---|
| Object-level authorization on every route | Controller `*.spec.ts` files assert `RequireAuthorization` on every exposed method (specs for `customer-addresses`, `customer-cart`, `customer-discovery`, `vendor-fulfilment`, `vendor-staff`, `vendor-publication`, `partner-lifecycle`, `admin-control-plane`) | Engineering Lead |
| Cross-role probe returns concealed 404 | `verify-launch-readiness.ts` §12.1 — capability catalog vs. role kind consistency | Engineering Lead |
| OTP abuse / replay | `verify-otp-identity.ts` — rate limits, expiry, and replay assertions | Engineering Lead |
| Webhook replay refused | `verify-grouped-checkout.ts` — provider webhook idempotency by `provider_event_id` | Finance Lead |
| Encryption / secret handling | `.env.example` uses synthetic tokens only; `security:secrets` scan gate in CI; `verify-static.ts` blocks new migrations from carrying transaction control that could hide credential handling | Engineering Lead |
| Log / event redaction | `SafeLogValue` + `redactProtectedFields` in `packages/domain-types` | Engineering Lead |
| Retention / deletion | `data_classification` + `retention_class` columns on identity, vendor, partner, and object-storage aggregates; documented in `docs/governance/data-classification-retention.md` | Privacy Lead |
| Full threat model workshop | **Deferred** — needs external review | Engineering Lead + Security Lead |
| Penetration test | **Deferred** — production infrastructure required | Engineering Lead + Security Lead |

### Accessibility (Phase 12.2)

All items **deferred**. The customer, vendor, partner, and admin PWAs and Expo apps are minimal
stubs across every phase; Phase 12 cannot audit accessibility of interfaces that do not exist as
end-user products. A separate UI-completion phase must precede a real accessibility review with
NVDA, JAWS, and VoiceOver. Owner: **Design Lead + Engineering Lead**.

### Localization (Phase 12.3)

| Requirement | Evidence | Owner |
|---|---|---|
| Extract user-visible strings | 30 seed keys across 8 namespaces in `0033_locale_registry` | Design Lead |
| English + Hindi coverage | `LocaleRegistryService.coverage()` fails CI on any missing translation | Design Lead |
| Stable server codes; localize labels only | Server codes are dotted `namespace.family.leaf`; UIs render `bundle[locale_key]`, never the code | Engineering Lead |
| Missing-translation CI check | `verify-launch-readiness.ts` runs coverage() and asserts empty missing list | Engineering Lead |
| Expansion / plural / currency / time / address | **Deferred** to UI phase — same client gap as 12.2 | Design Lead |

### Low-end devices / poor networks (Phase 12.4)

All items **deferred**. Requires physical device lab (Android 8/9 mid-range, PWA on 3G-throttled)
plus network shaping. Draft plan lives in `docs/production/free-online-company-test-migration-plan.md`
under "device coverage". Owner: **Engineering Lead**.

### Resilience drills (Phase 12.5)

| Requirement | Evidence | Owner |
|---|---|---|
| Outbox retry / dead-letter | `verify-launch-readiness.ts` §12.5 transient retry drill + `verify-messaging-lifecycle.ts` full lifecycle | Engineering Lead |
| Payment-unknown reconciliation | `verify-grouped-checkout.ts` — provider timeout → webhook success recovery | Finance Lead |
| Statement reconciliation | `verify-complete-money-lifecycle.ts` (from Phase 10 slice) | Finance Lead |
| Incident controls + safe custody continuation | `verify-admin-control-plane.ts` — incident scope + `verify-assignment-custody.ts` — return-to-origin | Engineering Lead + Operations Lead |
| Backup restore + RPO/RTO | `docs/governance/recovery-objectives-and-restore.md` documents targets; the drill needs a live replica and is **deferred** | Engineering Lead |

### Performance and concurrency (Phase 12.6)

| Requirement | Evidence | Owner |
|---|---|---|
| Discovery load | **Deferred** — needs load generator | Engineering Lead |
| Three-store checkout load | **Deferred** | Engineering Lead |
| Inventory reservation race | Partial — `verify-inventory-reservations.ts` covers `FOR UPDATE` correctness on the durable path but not p99 latency under load | Engineering Lead |
| Partner assignment race | Partial — `verify-assignment-custody.ts` covers one-active-attempt uniqueness | Engineering Lead |
| p50/p95/p99 measurement | **Deferred** — needs production-scale test environment | Engineering Lead |

### Operational readiness (Phase 12.7)

| Requirement | Evidence | Owner |
|---|---|---|
| Dashboards / alerts / queue owners | **Deferred** — needs live observability stack; skeleton in `docs/architecture/ADR-003-free-online-company-test-stack.md` | Operations Lead |
| Support / incident rotations | `docs/governance/support-service-levels.md` documents synthetic hours | Operations Lead |
| High-risk runbook rehearsal | `runbooks/online-test/` skeleton; execution deferred | Operations Lead |
| Rollback owner + command per component | Every migration has a paired `.down.sql`; each service exposes `close()`; `verify-lifecycle.ts` rehearses full rollback ladder end-to-end | Engineering Lead |
| Gate signatures (security, privacy, accessibility, operations, finance, support) | **Deferred** — requires stakeholder sign-off outside the code repository; register lives here so a sign-off row can be added when it happens | Project Owner |

## Boundaries

This slice does not fabricate evidence for deferred items. It does not stand up a device farm,
run a real threat model workshop, or execute chaos tooling. Every "Deferred" row above must
either be executed in a Phase 13 pilot with real infrastructure or explicitly waived by the
named owner before a production release. Server codes never change; adding a new user-visible
string requires adding a locale key + both language translations, and CI blocks the merge if
either is missing.
