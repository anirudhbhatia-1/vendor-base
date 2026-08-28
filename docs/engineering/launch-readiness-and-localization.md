# Launch Readiness and Localization

**Scope:** phases.md Phase 12 (security, accessibility, localization, resilience, performance, operational readiness), company-local synthetic development only
**Production authority:** None

Phase 12 differs from every phase before it: Phase 3–11 built domain aggregates; Phase 12 **verifies**
that what was built is safe to launch. The honest classification of the seven sub-steps into what a
company-local synthetic environment can genuinely prove versus what must wait for real infrastructure:

| Step | Description | Company-local delivery | Deferred until |
|---|---|---|---|
| 12.1 | Security and privacy review | **Partial** — cross-role capability-catalog probe in `verify-launch-readiness.ts`, controller authorization specs (every controller has one), OTP/session/webhook replay tests in existing verifiers | Full threat-model workshop; real penetration test |
| 12.2 | Accessibility review | **Partial** — all four PWAs and Android clients now have API-backed role journeys and automated JSX accessibility lint | Manual assistive-technology and device review |
| 12.3 | English/Hindi localization | **Complete** — migration 0033 registers server-code labels + English + Hindi translations; `verify-launch-readiness.ts` fails CI on any missing translation, on a customer bundle leaking admin labels, or on a non-admin locale write | — |
| 12.4 | Low-end device / poor network | **Deferred** — needs real device farm and network shaping infrastructure | Physical device lab or cloud device farm |
| 12.5 | Resilience drills | **Partial** — `verify-launch-readiness.ts` runs an outbox transient-failure retry drill and verifies the event reaches PUBLISHED; `verify-messaging-lifecycle.ts` covers backoff timing and dead-letter | Real chaos-injection tooling; full backup-restore drills against a live replica |
| 12.6 | Performance and concurrency | **Partial** — `pnpm load:smoke` records local p50/p95/p99 for readiness and locale reads; connected verifiers cover inventory and assignment races | Production-sized authenticated load environment |
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

Automated JSX accessibility lint now covers every PWA, and the role clients expose API-backed
customer shopping, vendor fulfilment, partner custody, and admin control-plane journeys. Manual
keyboard, screen-reader, 200% zoom, 360 px reflow, touch-target, reduced-motion, and map-alternative
passes remain required on supported devices. Owner: **Design Lead + Engineering Lead**.

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
| Discovery/read-surface load | Local smoke — `pnpm load:smoke` measures readiness and locale reads with bounded concurrency; production-sized authenticated discovery remains deferred | Engineering Lead |
| Three-store checkout load | **Deferred** — requires a production-sized authenticated load environment and a real payment provider boundary | Engineering Lead |
| Inventory reservation race | Partial — `verify-inventory-reservations.ts` covers `FOR UPDATE` correctness on the durable path but not p99 latency under load | Engineering Lead |
| Partner assignment race | Partial — `verify-assignment-custody.ts` covers one-active-attempt uniqueness | Engineering Lead |
| p50/p95/p99 measurement | Local smoke — `pnpm load:smoke`; production-scale p99 remains deferred | Engineering Lead |

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

## Per-component rollback register (Phase 12.7)

Every deployable component has a rehearsed rollback path plus a named owner. Migrations own
themselves via paired `.down.sql`; services expose `close()`. `verify-lifecycle.ts` rehearses
the full forward-and-back migration ladder end-to-end on every `pnpm db:verify` — the down
migrations are not aspirational.

| Component | Rehearsed rollback command | Owner |
|---|---|---|
| API (`apps/api`) | `pnpm --filter @neighbourhood-store/api build && APP_ENV=… node dist/main.js` (previous release SHA); Nest `enableShutdownHooks` drains connections cleanly on SIGTERM | Engineering Lead |
| Worker (`apps/worker`) | `pnpm --filter @neighbourhood-store/worker build && APP_ENV=… node dist/main.js` (previous release SHA); each `Injectable` implements `onApplicationShutdown` to close pools and release claims | Engineering Lead |
| Customer / Vendor / Partner / Admin PWA | Redeploy previous immutable Next.js build; static assets are content-hashed | Engineering Lead |
| Customer / Vendor / Partner / Admin native app | Store rollback: promote the previous signed bundle from the release track | Engineering Lead |
| Any single migration | `pnpm --filter @neighbourhood-store/database migration:down` (rehearsed by `verify-lifecycle.ts` for every migration in the ladder, one step at a time) | Engineering Lead |
| Database (whole schema) | `DB_REBUILD_CONFIRM=… pnpm db:rebuild` (only for the local synthetic env; production would be a restore drill against a live replica — deferred, see 12.5) | Engineering Lead |
| Locale registry contents | `AdminLocaleController` upsert / translation; no service restart required | Operations Lead |
| Trust restrictions | `AdminControlPlaneService.transitionTrust('REVOKE')` — proposer/approver separation preserved through the revoke path | Operations Lead |
| Incident controls (kill switches) | `AdminControlPlaneService.revokeIncident` — the switch is scoped and existing custody is preserved | Incident Commander (`INCIDENT_COMMANDER` role) |
| Configuration versions | `MoneyLifecycleService` / versioned-configuration path — versions are append-only; rollback is a new APPROVED version referencing the prior one | Config Approver |
| Refunds and payouts | Ledger is append-only; corrections post reversing entries. No destructive rollback — see `verify-money-lifecycle.ts` | Finance Approver |

## Stakeholder gate signatures (Phase 12.7)

Human sign-offs cannot be produced by code. This register makes them explicit and trackable —
each row is `PENDING` until the named owner signs, and the row records who signed against what
evidence. Add a `Signed on` column entry (ISO date) beside `Owner` when a gate clears.

| Gate | Evidence to review | Owner | Status |
|---|---|---|---|
| Security / privacy | Threat model, controller `*.spec.ts` authorization matrix, `verify-launch-readiness.ts` §12.1 cross-role probe, `security:secrets` scan | Security Lead + Privacy Lead | `PENDING` |
| Accessibility | `jsx-a11y` gate output, manual NVDA/JAWS/VoiceOver walkthrough for the eight critical role tasks | Design Lead + Engineering Lead | `PENDING` |
| Operations | Dashboards + alert owners map, on-call rotation, runbook rehearsal log, this per-component rollback register | Operations Lead | `PENDING` |
| Finance | `verify-money-lifecycle.ts` ledger conservation, refund maker-checker with self-approval rejection, reconciliation drill against a real provider statement | Finance Lead + Finance Approver | `PENDING` |
| Support | `admin.support.case_manage` scoped surface, `verify-admin-control-plane.ts` scenarios, synthetic-hours documented in `docs/governance/support-service-levels.md` | Operations Lead | `PENDING` |

None of these gates may be silently promoted to signed without visible evidence in this file.
When a signature lands, it should be entered in a commit whose message names the gate, the
owner, and the evidence hash (e.g. `git rev-parse HEAD` at the review time).
