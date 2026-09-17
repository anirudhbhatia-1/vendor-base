# Marketplace Completion Implementation Plan

**Generated:** 28 August 2026  
**Re-audited:** 28 August 2026 after the contracts, role sign-in, onboarding and feature-matrix changes  
**Scope:** company-local synthetic development through a workflow-complete pilot build  
**Production authority:** none  
**Source contracts:** `FEATURES.md`, `prd.md`, `implementation.md`, `design.md`, `phases.md`

## 1. Executive conclusion

The repository has a strong backend foundation, a sound modular-monolith deployment shape, 39
PostgreSQL/PostGIS migrations, broad API coverage, durable state-machine implementations, and eight
buildable clients. The latest changes materially improve the product: all four PWAs now have
synthetic sign-in panels, vendor onboarding and partner application flows have API-backed PWA
screens, vendor/partner finance views have begun using live APIs, the shared contracts client and
i18n runtime are implemented, and the worker no longer claims to use BullMQ. It still does not
satisfy the repository's definition of a completed marketplace.

The primary gap is not missing database tables. It is end-to-end product integration:

- many backend capabilities still have no complete PWA and Android workflow;
- PWA authentication is present, but role/location/assignment bootstrap and durable session
  restoration remain incomplete; all four Android clients still depend on manually entered access
  tokens or static role context;
- several visible buttons and summaries are presentational rather than connected to commands;
- the shared client has compile-time types but lacks runtime response validation, automatic session
  refresh, timeouts, secure request IDs, and consistent retry/idempotency behaviour;
- the i18n runtime is used only by a small customer PWA locale sample, has no tests, and has not
  replaced hard-coded copy across the eight clients;
- client component, browser, Android, and cross-role end-to-end tests are absent;
- the outbox worker performs two real domain dispatches, but still lacks an explicit versioned
  consumer registry, per-consumer inbox/deduplication and connected replay tests;
- production providers, observability, recovery, security review, and stakeholder sign-off remain
  deliberately gated.

The correct next move is to complete the local synthetic product vertically. Do not split the
system into microservices and do not introduce cloud dependencies during this work.

## 2. Fixed requirements and assumptions

### 2.1 Product surfaces

The product retains eight independently buildable clients:

| Role | PWA | Android |
|---|---|---|
| Customer | `apps/customer-pwa` | `apps/customer-app` |
| Vendor | `apps/vendor-pwa` | `apps/vendor-app` |
| Delivery partner | `apps/partner-pwa` | `apps/partner-app` |
| Admin/support | `apps/admin-pwa` | `apps/admin-app` |

The four roles remain separate applications. Shared contracts and behaviour may be reused, but
navigation, permissions, installed-app identity, and operational context remain role specific.

### 2.2 Current environment

- All activity uses deterministic synthetic data.
- Local PostgreSQL/PostGIS is the system of record.
- The NestJS/Fastify API is the only client-facing authority.
- The NestJS worker owns deadlines, retries, scheduled work, notifications, and outbox delivery.
- Local filesystem object storage and fake OTP/payment/payout/maps/notification adapters remain
  approved for company testing.
- No real customer, vendor, partner, identity, payment, bank, document, or location data is
  permitted.
- Cloud deployment and production-provider replacement are separate later gates.

### 2.3 Scale target

The architecture must preserve a path from a small Jaipur pilot to thousands or lakhs of users,
without paying the complexity cost of distributed services before measurements justify it.

That means the local implementation must already have:

- horizontally scalable stateless API processes;
- database-enforced ownership, uniqueness, idempotency, and concurrency rules;
- bounded queries with indexes and pagination;
- durable asynchronous work and replay-safe handlers;
- provider-neutral contracts;
- immutable money and custody evidence;
- versioned policies and configuration;
- measurable latency, queue age, saturation, and business invariants.

It does not mean introducing microservices, distributed caches, or a message broker before load
evidence identifies a specific bottleneck.

## 3. Re-audit baseline

### 3.1 Verified on the current worktree

- All 16 buildable workspaces compile. The four Next.js applications build, the four Expo Android
  exports build, and the entry-point verifier reports four PWA shells and four Android exports.
- Strict TypeScript, repository controls and dependency-boundary self-tests pass.
- Unit suites pass with 128 actual tests: contracts 7, domain types 21, database 23, worker 1 and
  API 76. The i18n package currently contributes zero tests.
- `packages/contracts` now provides a typed client used by the PWAs and Android data components.
- All four PWAs have synthetic OTP sign-in panels. Vendor onboarding, partner applications,
  partner earnings and parts of vendor/admin finance are API backed.
- The worker smoke shutdown race is fixed by waiting for `close`, and the worker integration smoke
  passes.
- The worker package description and dependencies now consistently describe PostgreSQL durable
  jobs; BullMQ is no longer an active dependency.
- `docs/feature-matrix.json` contains 354 feature records: 160 `implemented`, 21 `partial`, 34
  `missing`, 73 `backend_only`, 22 `ui_only`, 22 `later`, 7 `gated` and 15 `excluded`.
- The API exposes broad identity, vendor, catalogue, inventory, discovery, cart, checkout,
  fulfilment, partner, money, notification, configuration and admin-control surfaces.
- Database verifiers exist for the critical domain and concurrency scenarios listed in
  `implementation.md` section 13.2.

### 3.2 Currently failing or unverified

- `pnpm check` is red. Prettier reports 22 changed source files, and ESLint reports two
  `preserve-caught-error` violations in `apps/vendor-pwa/app/vendor-workspace.tsx`.
- API integration smoke fails its readiness assertion when the local database is stopped. The
  current re-audit confirmed `127.0.0.1:5432` is refusing connections; `/health/ready` is therefore
  correctly degraded. The smoke command needs an explicit documented database prerequisite or an
  isolated database harness so environment absence is distinguishable from a code regression.
- `pnpm db:verify:connected` remains unverified because the isolated database at
  `127.0.0.1:5433` is not running.
- The current local database migration state could not be re-confirmed while port 5432 was down.
  Migration files `0000` through `0038` are present; applied state must be checked after startup.
- No PWA component, Playwright, React Native component, Maestro, or real cross-role E2E suite is
  present.
- `docs/feature-matrix.json` is not validated by a repository command or CI and already contains
  stale statuses for newly added onboarding/application screens. Its `implemented` definition
  requires only one client, which is weaker than this plan's cross-client completion gate.

### 3.3 Completion assessment by implementation slice

| Slice | Backend | PWA | Android | Automated proof | Overall |
|---|---|---|---|---|---|
| S0 Repository foundation | Strong | Builds | Builds | Red quality baseline | Partial |
| S1 Identity and access | Strong | Sign-in present; bootstrap partial | Manual-token flows | Backend focused | Partial |
| S2 Vendor and catalogue | Strong | Onboarding/catalogue partial | Partial/static | DB focused | Partial |
| S3 Customer discovery/cart | Strong | Core journey | Core journey | No client E2E | Partial |
| S4 Quote/grouped checkout | Strong synthetic | Basic flow | Basic flow | DB focused | Partial |
| S5 Vendor fulfilment | Strong core | Core actions | Core actions | DB focused | Partial |
| S6 Partner fulfilment | Strong core | Application/active-job subset | Active-job subset | DB focused | Partial |
| S7 Money lifecycle | Strong synthetic | Some live finance reads/actions | Partial/static | DB focused | Partial |
| S8 Operations control plane | Broad | Partial queues | Overview shell | Authorization focused | Partial |
| S9 Hardening/pilot | Foundations | Partial | Partial | External gates deferred | Incomplete |

## 4. Target architecture

### 4.1 Deployment shape

```text
Customer PWA / Android ─┐
Vendor PWA / Android ───┤
Partner PWA / Android ──┼──> NestJS + Fastify API ───> PostgreSQL + PostGIS
Admin PWA / Android ────┘              │                        ▲
                                      │                        │
                                      └── transactional outbox │
                                                               │
                                      NestJS worker ────────────┘
                                      deadlines / jobs / consumers
```

The API remains stateless. Sessions, idempotency records, aggregate versions, jobs, outbox events,
and business state remain durable in PostgreSQL.

### 4.2 Code ownership layers

```text
Role UI
  -> role client facade
  -> @neighbourhood-store/contracts client
  -> API controller and authorization boundary
  -> application/domain service
  -> repository/transaction boundary
  -> PostgreSQL/PostGIS
```

Required package responsibilities:

| Package | Responsibility |
|---|---|
| `domain-types` | Framework-free identifiers, money, time, errors, contexts and envelopes |
| `contracts` | Versioned request/response/event types plus the current shared HTTP client; add runtime validation at the transport boundary |
| `i18n` | Stable translation keys, English/Hindi catalogues and formatting helpers |
| `ui-tokens` | Shared visual tokens only; no role workflow logic |
| `test-data` | Deterministic builders and named scenarios, unavailable to production runtime |
| `database` | Migrations, repositories, transactional persistence and query implementations |

The current client lives in `packages/contracts`. Keep that location during stabilization to avoid a
package-move-only refactor. Extract `@neighbourhood-store/api-client` later only if runtime schemas,
generated contracts or non-HTTP transports make the separation valuable. New business
orchestration must not be added directly to UI components or database scripts. Existing services
may be moved gradually after contract and characterization tests exist; a large rewrite is not
required before feature work.

### 4.3 Async architecture

PostgreSQL durable jobs remain the approved local queue. The worker now dispatches
`vendor_order.picked_up` to inventory settlement and `order.placed` to partner-offer creation.
Complete the design with:

1. an outbox consumer registry keyed by event type and version;
2. one inbox/deduplication scope per consumer;
3. bounded concurrent claims with leases;
4. classified transient, permanent, and unknown failures;
5. retry/backoff and dead-letter ownership;
6. replay commands with authorization and audit evidence;
7. metrics for oldest-ready age, throughput, failures, retries and dead letters.

BullMQ/Valkey has been removed from the active worker dependencies. Remove any remaining stale
documentation, and adopt a broker only when measured queue throughput, lock contention or latency
exceeds an agreed PostgreSQL threshold—not merely because the future user count is large.

## 5. Definition of feature completion

A feature from `FEATURES.md` is `COMPLETE_LOCAL_SYNTHETIC` only when every applicable item below is
present:

1. Domain states, commands, queries, events, deadlines and invariants are defined.
2. Schema, constraints, indexes, migration and rollback are implemented.
3. API contract, authorization, validation, idempotency and error shapes are implemented.
4. Required worker/event behaviour is durable and replay safe.
5. PWA workflow is usable without developer-only tokens or opaque IDs.
6. Android workflow is usable without developer-only tokens or opaque IDs.
7. Loading, empty, error, stale, conflict, offline/reconnect and success states exist.
8. English and Hindi content exists for critical copy, validation, deadlines and support.
9. Unit, integration, contract, component and applicable E2E tests pass.
10. Logs, metrics, audit evidence and support/runbook ownership exist.

A provider-dependent feature may be `COMPLETE_LOCAL_SYNTHETIC` while remaining
`BLOCKED_PRODUCTION_PROVIDER`. These statuses must never be collapsed into one value.

## 6. Feature traceability governance

`docs/feature-matrix.json` is now the checked-in feature inventory and should remain the single
source rather than creating a competing CSV. Extend each record, where applicable, with explicit
evidence fields:

```text
id,status,owner,domain_service,migrations,api_routes,worker_handlers,
customer_pwa,customer_android,vendor_pwa,vendor_android,partner_pwa,
partner_android,admin_pwa,admin_android,unit_tests,integration_tests,
component_tests,e2e_tests,runbook,production_gate,notes
```

Normalize implementation statuses to:

- `not_started`
- `backend_only`
- `ui_only`
- `partial_workflow`
- `complete_local_synthetic`
- `blocked_production_provider`
- `later`
- `gated`
- `excluded`

The existing `implemented` status must be migrated to `complete_local_synthetic` only after all
applicable PWA, Android, test and runbook evidence passes. “Backend plus one client” is useful as a
progress signal but is not completion.

Add `tooling/scripts/verify-feature-matrix.mjs`, a root command and a CI step that fail when:

- a Launch feature has no owner;
- a status is not in the normalized enum;
- a completed feature references a missing file, route or test;
- a UI-required role lacks either PWA or Android evidence without an explicit applicability note;
- a provider-dependent feature is marked production ready with a fake adapter;
- a new feature ID appears in `FEATURES.md` without a matrix record;
- duplicate IDs exist or a matrix record no longer exists in the feature catalogue.

First reconcile stale records for the newly added vendor onboarding and partner application pages,
then use the validator to prevent future drift.

## 7. Implementation workstreams

### Workstream 0 — Restore a green baseline

#### Completed since the first audit

- Worker smoke now waits for `close`, drains output and passes.
- README migration head is updated to `0038`/39 migrations.
- All workspaces compile, all eight client builds/entry points verify, TypeScript passes and 128
  unit tests pass.

#### Remaining tasks

1. Format the 22 reported changed files and fix the two vendor PWA caught-error lint violations
   without discarding their original causes.
2. Make the integration test environment explicit: either start/check the local database before
   API smoke or provision the isolated test database inside the command.
3. Start the isolated test database through the repository command.
4. Run the complete forward/down/up migration and connected verifier ladder.
5. Add connected database verification to a dedicated CI service job.
6. Ensure generated build artifacts and local logs stay outside source-review diffs.
7. Reconcile `docs/feature-matrix.json`, add its validator and make it part of `pnpm check`.

#### Exit gate

```text
pnpm check
pnpm build:verify
pnpm db:verify:connected
```

All must pass from a clean checkout using documented commands.

### Workstream 1 — Harden shared contracts, client runtime and i18n

#### Current state

`packages/contracts` now supplies shared types and an API client to PWA and Android components.
It has seven unit tests. `packages/i18n` now supplies a locale bundle runtime and React hook, but is
only demonstrated in the customer PWA and has no tests.

#### Remaining tasks

1. Add runtime schemas for standard success/error envelopes and bounded-domain responses; reject
   malformed responses at the transport boundary rather than trusting TypeScript casts.
2. Replace the client's `Math.random()` request-ID entropy with the repository's secure UUID
   implementation.
3. Complete the shared client with:
   - base URL configuration;
   - request/correlation IDs;
   - bearer sessions and refresh rotation;
   - idempotency keys for commands;
   - timeout and abort handling;
   - normalized 400/401/403/404/409/422/429/500 handling;
   - pagination and optimistic-version helpers;
   - safe retry only for explicitly replay-safe operations.
4. Add PWA session storage and Android secure-storage adapters behind one interface; do not put
   bearer tokens in ordinary component state or manual text fields.
5. Replace remaining ad hoc `createRawRequester` calls where a typed endpoint exists; add the
   missing typed endpoints before adding new raw calls.
6. Add deterministic clocks, IDs, provider scenarios and role fixtures to `test-data`.
7. Add i18n unit tests, missing-key validation and English/Hindi catalogues; migrate critical copy
   in all four PWAs and four Android clients.

#### Exit gate

- Every client imports the shared contract/client packages through one role facade.
- No normal screen defines a private copy of a server response type.
- No normal screen hand-assembles authorization or standard error handling.
- Contract tests prove runtime client schemas match representative success and failure responses.
- Session restore/refresh and translated critical errors are tested on web and Android.

### Workstream 2 — Complete identity and role bootstrap

#### Current state

All four PWAs can request and verify a synthetic OTP, hold a session token for the current browser
session and sign out. This closes the earlier “PWA sign-in missing” gap, but a reload does not
reliably restore/refresh the full role context. Vendor screens still request a location ID, partner
screens still request an assignment ID, and Android clients still expose manual token inputs or
static identity context.

#### Customer

- OTP request, delivery state, verification, resend and attempt lockout.
- Session restore, refresh, sign-out and device/session management.
- Optional profile, consent, language and notification preferences.
- Account recovery and support route.

#### Vendor

- Restore and refresh the existing synthetic OTP session.
- Membership discovery and vendor-location selection.
- Current role/capability summary.
- Expired/revoked/inactive membership states.

#### Partner

- Restore and refresh the existing synthetic OTP session.
- Connect the new application screen to eligibility and role bootstrap.
- Active assignment restoration after launch or reconnect.
- Device-health and document-expiry blockers.

#### Admin

- Restore and refresh the existing synthetic OTP session.
- Admin membership and capability bootstrap.
- Capability-derived navigation and safe denied states.
- Maker/checker role-conflict display.

#### Exit gate

No primary workflow requires a pasted token, user UUID, vendor-location UUID, assignment UUID, or
role-assignment UUID. IDs may appear in diagnostic/admin detail views but are never navigation
prerequisites.

This gate applies to Android as well as PWA and includes expired, revoked, inactive and
capability-denied states.

### Workstream 3 — Customer PWA and Android completion

#### Current state

The customer PWA builds six product routes (`/`, `/account`, `/cart`, `/categories`, `/orders`,
`/stores`) and the typed client is used for core shopping calls. The Android app exports and covers
parts of the same journey. Store/product/order detail routing, location editing, recovery,
decision/tracking/refund/support flows and live My Stores/Account content remain incomplete.

#### Required route/screen map

| Area | Required screens |
|---|---|
| Access | Sign in, verify OTP, profile, preferences, sessions, help |
| Address | Address list, add/edit, pin adjustment, selection, serviceability |
| Discovery | Home, search results, categories, filters, recent search, favourites |
| Store | Store profile, hours/policies, catalogue, reviews |
| Product | Product detail, unit/weight, freshness, substitution policy |
| Cart | Grouped cart, group settings, notes, substitutions, validation recovery |
| Checkout | Quote, expiry, group summary, payment method, pending/unknown/failure/success |
| Order | Group overview, child detail, timeline, decision, pickup/delivery tracking |
| Aftercare | Cancellation preview, refund, receipt, history, reorder, rating, support |
| Communication | Notification centre and safe order/support context |

#### Workflow requirements

- Address eligibility controls discovery and checkout.
- Opening a store never mixes another vendor's products into its page.
- Adding from another store explains and creates a separate cart group.
- Every group shows independent subtotal, fee, fulfilment method and promise.
- Quote and checkout expose every child order and combined authorization.
- Payment unknown remains pending until reconciliation; retry never duplicates checkout.
- Decisions and countdowns use server timestamps.
- Cancellation previews custody and financial impact before confirmation.
- Reorder revalidates price, stock, vendor and serviceability.

#### Exit gate

One-store pickup and three-store partial-failure journeys pass in customer PWA and Android E2E
tests using the same backend fixtures.

### Workstream 4 — Vendor PWA and Android completion

#### Current state

The vendor PWA now builds `/onboarding`, `/catalogue`, `/store`, `/payouts` and `/more` in addition
to its dashboard. Onboarding is API backed and catalogue/payout integration has progressed. Store
configuration, staff, service area, support, statement download and several visible actions remain
static or unbound. The Android app still uses manual token/location context and contains static
store/finance surfaces.

#### Required route/screen map

| Area | Required screens |
|---|---|
| Access | Sign in, location selection, access summary |
| Onboarding | Application, profile, payout reference, documents, review, appeal |
| Publication | Readiness strip, test order, submit, review status, pause/unpublish impact |
| Store | Profile, images, hours, closures, fulfilment, service zone, minimum/prep time |
| Staff | Invitations, roles, locations, deactivate/revoke history |
| Catalogue | List, create, edit, variants, images, weight, substitutions, lifecycle |
| Import | Template, upload/paste, row errors, preview, explicit commit |
| Inventory | Stock state, counted quantity, freshness, bulk update, reservation view |
| Orders | Queue, child-order detail, accept/decline, picking and decisions |
| Handoff | Package metadata, ready, customer pickup, partner handoff, self-delivery |
| Finance | Settlement lines, payouts, statement download, exceptions/disputes |
| Support | Notifications, escalation, protected communication and cases |

#### Workflow requirements

- Replace every decorative store/settings/support/finance button with an API-backed workflow or
  remove it until implemented.
- Decline and cancellation require impact preview and standardized reason.
- Picking cannot complete while a line or customer decision remains unresolved.
- Weight and substitution proposals show customer price impact and deadline.
- Ready/handoff actions validate package count, proof and current state.
- Finance distinguishes estimated, eligible, settled, refunded and paid values.

#### Exit gate

A vendor can onboard, publish, configure a store, manage a catalogue, receive and complete an
order, review settlement and open support entirely through either client.

### Workstream 5 — Partner PWA and Android completion

#### Current state

The partner PWA now builds `/applications`, `/earnings` and `/profile` in addition to its active-job
dashboard. Application and earnings data are API backed. Active assignment bootstrap still depends
on an entered identifier, while documents, training, emergency, offline proof, exception handling
and much of the profile remain static or incomplete. Android retains manual-token/static flows.

#### Required route/screen map

| Area | Required screens |
|---|---|
| Access | Sign in, application status, eligibility blockers |
| Profile | Identity/documents, vehicle, zones, bank reference, emergency contact |
| Training | Checklist, completion and required refresh |
| Dispatch | Online/offline, zone selection, offer, accept/decline/expiry |
| Active job | Persistent current step, vendor/customer address gating, navigation fallback |
| Pickup | Arrival, wait, package count/condition, QR/OTP, custody confirmation |
| Delivery | Route, contact, arrival, wait, OTP/proof and completion confirmation |
| Offline | Encrypted pending proof, sync status, retry and escalation |
| Exceptions | Missing/damaged, unreachable, wrong address, unsafe, breakdown, return |
| Money | Offer preview, trip breakdown, daily/weekly rollups, payouts, statement, dispute |
| Safety | Persistent emergency action, location disclosure and permission withdrawal |
| Trust | Review, restriction effect and appeal |

#### Workflow requirements

- The app restores the server-confirmed active assignment automatically.
- Only the active assignment exposes exact customer information.
- Local proof never displays completed before server confirmation.
- An unresolved offline proof blocks a second active job.
- Returns close custody independently of later money resolution.
- Every exception preserves the current safe instruction.

#### Exit gate

Offer expiry/reassignment, wait thresholds, offline proof synchronization, delivery completion and
post-pickup return pass in PWA and Android E2E tests.

### Workstream 6 — Admin PWA and Android completion

#### Current state

The admin PWA builds ten operational routes and now signs in through synthetic OTP. Some finance
exception/refund actions are API backed, but several queues/actions remain UI-only or backend-only.
The Android app is still primarily an overview: non-overview tabs report no loaded queue and
critical protected operations are not at PWA parity.

#### Required route/screen map

| Area | Required screens |
|---|---|
| Dashboard | Risk-ranked queues, SLA, owner and next action |
| Search | Checkout, order, assignment, vendor, partner, payment and case lookup |
| Vendors | Leads, applications, documents, publication and service configuration |
| Partners | Applications, documents, zones, vehicles, restrictions and appeals |
| Live operations | Orders, assignments, waits, returns and manual dispatch |
| Catalogue | Moderation, prohibited goods, taxonomy and correction workflow |
| Zones/config | Zone editor, fees, policies, feature flags and version history |
| Support | Cases, messages, evidence, assignment, escalation and reopen |
| Finance | Refunds, settlements, payouts, reconciliation and corrections |
| Trust | Signals, review, restriction proposal/approval, expiry and appeal |
| Incidents | Scoped kill switch, impact preview, activation and revocation |
| Access | Membership grant/revoke, conflict detection and history |
| Reporting | Filtered reports, downloads and provenance |
| Audit | Actor/action/reason/version/correlation search and detail |

#### Workflow requirements

- Every queue loads from an authorized endpoint; fixed zero-value cards are only valid empty states
  after a successful response.
- Every protected mutation shows affected scope and requires a reason.
- Maker/checker controls visually separate proposal and approval.
- Cross-scope data is concealed rather than merely disabled in the UI.
- Android provides the same critical operational actions as the PWA, not only an overview shell.

#### Exit gate

Support isolation, refund maker/checker, trust review/appeal, scoped incident control, manual
dispatch, reconciliation and access provisioning pass through both clients.

### Workstream 7 — Money and provider orchestration

#### Current state

Synthetic payment/refund/ledger/settlement/payout/reconciliation services exist. Partner earnings,
vendor payout and selected admin finance screens now use real APIs, but checkout-owned payment
closure, scheduled payout execution, complete statements/downloads and Android finance parity
remain incomplete.

#### Local synthetic completion

- Route payment authorization, capture, void, refund, settlement, payout and reconciliation through
  explicit provider interfaces.
- Preserve scenario selection only in fake adapters and test fixtures, never normal role UI.
- Connect worker schedules to payout, reconciliation, refund retry and exception queues.
- Generate downloadable synthetic customer receipts, vendor statements and partner statements.
- Add UI for unknown, pending, failed, reversed, partially refunded and correction states.
- Prove every ledger transaction balances per currency.

#### Production gate retained

Real payment and payout adapters remain blocked until provider choice, credentials, webhooks,
contract tests, reconciliation statements, security review, financial approval and rollback plans
exist.

#### Exit gate

All synthetic money flows close exactly once and remain traceable from customer charge through
child allocation, refund, vendor settlement, partner earning and payout.

### Workstream 8 — Notifications, communication and retention

#### Current state

Outbox persistence and PostgreSQL worker claims are implemented. Two event types now trigger domain
work, while other events are effectively only published/logged. Notification inboxes, localized
delivery, retention UI and general consumer governance remain incomplete.

#### Tasks

- Convert outbox events into localized notification intents.
- Replace hard-coded event branching with a versioned consumer registry and per-consumer inbox.
- Verify the `order.placed` event payload/aggregate mapping for partner assignment creation with a
  connected test before treating that path as complete.
- Add replay-safe connected tests for inventory settlement and partner-offer dispatch.
- Implement actor-specific in-app inboxes in all eight clients.
- Add safe deep links to the exact authorized resource.
- Record attempt, provider reference, result, retry and fallback history.
- Implement fake push/SMS acknowledgement, delay, failure and invalid-token scenarios.
- Add template-first customer/vendor/partner messages.
- Implement retention/deletion jobs for eligible synthetic records and local protected objects.
- Add admin views for failed notification and retention queues.

#### Exit gate

Order, decision, assignment, proof, refund, payout, support and account events create one deduplicated
notification and open the correct authorized context.

### Workstream 9 — UI quality, accessibility and localization

#### Current state

The design system and role shells are substantially improved, and each PWA has real route-level
navigation. However, many workflows are still compressed into dashboard panels, critical copy is
mostly hard-coded English, `packages/i18n` has zero tests, and systematic keyboard/screen-reader/
Hindi/offline-state proof is absent.

#### Tasks

- Use route-level loading, error and not-found boundaries.
- Provide skeleton, empty, error, stale, conflict and offline states for each core page.
- Remove hard-coded operational data unless explicitly labelled demo-only.
- Replace hard-coded user-visible strings with registered keys.
- Complete English and Hindi for validation, errors, deadlines, support and proof.
- Test 360 px width, 200% zoom, keyboard order, focus restoration and screen readers.
- Ensure statuses never rely only on colour.
- Respect reduced motion.
- Provide text/landmark alternatives wherever maps or location are involved.
- Confirm touch targets and one-handed partner/vendor actions on supported Android devices.

#### Exit gate

Every critical role task passes the accessibility/localization matrix in `implementation.md`
section 13.2 scenario 15.

### Workstream 10 — Test and quality strategy

#### Current state

The repository has 128 passing unit tests and broad database/API verification scripts. The worker
integration smoke passes. API integration currently depends on a running migrated local database
and fails readiness when it is absent. There are no client component tests, Playwright projects,
React Native component tests, Maestro flows or application-level cross-role scenarios.

#### Unit and property tests

- State transitions and invalid transitions.
- Money allocation, rounding and conservation.
- Reservation and weight calculations.
- Timers, policies, capability rules and redaction.

#### Module integration tests

- Transactions, constraints and optimistic conflicts.
- Outbox/inbox and job retry/dead-letter recovery.
- Concurrency for inventory, checkout, assignment and approvals.
- Provider receipt authenticity and replay.
- Retention eligibility and object deletion.

#### API contract tests

- Runtime schema compatibility.
- Ownership and wrong-role denial.
- Validation and error envelopes.
- Idempotency replay and version conflict.
- Pagination, sorting and filters.
- Session restore/refresh and role bootstrap across all four roles.

#### UI component tests

- Loading, empty, error, stale, success and conflict.
- Deadline and retry presentation.
- Keyboard/focus behaviour.
- English/Hindi expansion.
- Permission-derived actions.

#### PWA E2E

Use Playwright projects for customer, vendor, partner and admin. Add a cross-role orchestration
fixture that drives all actors against the same synthetic checkout.

#### Android E2E

Use Maestro for each installed role app. Prioritize sign-in, active work restoration, checkout,
vendor picking, partner proof and admin exception handling.

#### Required cross-role journeys

Automate all 15 scenarios in `implementation.md` section 13.2 at the application level. Existing
database verifiers remain lower-level proofs and are not removed.

#### CI order

```text
format/lint/boundaries
  -> typecheck/contracts
  -> unit/property
  -> isolated PostgreSQL migrations
  -> module/API integration
  -> PWA component + Playwright
  -> Android build + selected Maestro smoke
  -> security/secrets/dependency checks
  -> evidence and feature-traceability validation
```

### Workstream 11 — Observability and operational readiness

#### Current state

Structured request/correlation/trace logging and several operational foundations exist. Queue and
business metrics, owned alert/runbook evidence, restore rehearsal, realistic load evidence and
end-to-end dead-letter/reconciliation operations remain incomplete.

#### Local implementation

- Structured logs with request, correlation, causation, trace and safe actor identifiers.
- Metrics endpoint/adapter for HTTP, database, job, outbox, provider and domain invariants.
- Local dashboards or generated reports for checkout, inventory, fulfilment, money and support.
- Alert-rule definitions with owner, severity, threshold and runbook.
- Dead-letter, stuck-order, custody-risk, payment-unknown and reconciliation-age queues.
- Backup script and isolated synthetic restore rehearsal.
- Local load scenarios for discovery, three-store checkout, inventory race and assignment burst.

#### Production-deferred evidence

- Real telemetry destination and retention policy.
- Production-scale authenticated load.
- Live replica and point-in-time restore.
- External penetration test.
- Physical low-end device/network matrix.
- Stakeholder gate signatures.

#### Exit gate

Every invariant alert can be triggered synthetically, reaches an owned queue/runbook, and can be
resolved without deleting valid order, custody or ledger history.

## 8. Recommended implementation sequence

The workstreams should execute in this order:

```text
0 Green baseline + feature-matrix governance
  -> 1 Contracts/client/i18n hardening
  -> 2 PWA session restore + Android identity + role bootstrap
  -> 3 Customer discovery/cart/checkout
  -> 4 Vendor catalogue/fulfilment
  -> 5 Partner dispatch/custody
  -> 6 Admin operations
  -> 7 Money/provider orchestration
  -> 8 Notifications/retention
  -> 9 UI quality/localization/accessibility
  -> 10 Full E2E and quality gates
  -> 11 Operational readiness
```

Testing is added inside each workstream; Workstream 10 completes the cross-role suite and closes
coverage gaps rather than postponing all testing until the end.

### 8.1 Next executable batch

Do not begin another broad feature phase until this batch is green:

1. Restore repository quality: format the 22 reported files and fix both vendor PWA lint errors.
2. Make `pnpm test:integration` self-describing and deterministic by checking/provisioning its
   database prerequisite, then run migrations and the connected verifier.
3. Reconcile and validate `docs/feature-matrix.json`; require file/test evidence before migrating
   any of its 160 `implemented` entries to `complete_local_synthetic`.
4. Harden the shared client with runtime envelopes, secure UUIDs, timeout/abort and session refresh.
5. Implement persistent session and role bootstrap in this order: customer PWA, vendor PWA,
   partner PWA, admin PWA, then the four Android clients using secure storage.
6. Remove the vendor-location and partner-assignment manual ID prerequisites.
7. Add the first cross-role Playwright thin slice: sign in → discover → cart → quote → checkout →
   vendor accept/pick/ready → partner offer/pickup/deliver → customer completion.

The batch exits only when `pnpm check`, `pnpm build:verify`, `pnpm db:verify:connected`, the feature
matrix validator and the first cross-role PWA test all pass from documented setup commands.

## 9. Delivery increments

### Increment A — Trustworthy developer platform

Includes Workstreams 0–2. The repository is green, the feature matrix is evidence-validated,
contracts are runtime checked, and every role can enter and restore its app on PWA and Android
without manual tokens or opaque identifiers.

### Increment B — Shopping and store operations

Includes Customer S2–S5 and Vendor S2/S5 workflows. A synthetic customer can discover, shop,
checkout and complete pickup with a vendor.

### Increment C — Platform delivery

Includes Partner S6, live vendor handoff, customer delivery progress, offline proof and returns.

### Increment D — Financial and operational closure

Includes Money S7, Admin S8, notifications, support, trust, incidents and reconciliation.

### Increment E — Company-test release candidate

Includes accessibility, localization, resilience, performance, restore and all application-level
E2E gates. This is still synthetic and not production authorized.

## 10. Risks and trade-offs

| Decision | Benefit | Cost/risk | Revisit trigger |
|---|---|---|---|
| Keep modular monolith | Fast iteration and transactional correctness | Coarse module boundaries can grow | Teams cannot deploy/test modules independently or ownership becomes unclear |
| Keep PostgreSQL jobs | One durable operational system, no extra service | High queue volume could contend with OLTP | Measured lag/lock/saturation exceeds target under representative load |
| Eight clients | Clear role isolation and app identity | Feature parity costs more | Evidence supports merging selected non-sensitive surfaces |
| Shared contracts, not shared screens | Consistent behaviour without forced UI sameness | Some duplicate presentation code | Repeated defects show a stable cross-platform component is warranted |
| Synthetic providers | Safe free local development | Cannot prove real-provider behaviour | Provider decisions and non-production credentials are approved |
| Incremental layering cleanup | Avoids risky rewrite | `database` remains broad temporarily | Characterization tests protect a safe extraction |

## 11. Production transition boundary

Completing this plan produces a workflow-complete local company-test application. It does not
authorize production.

The executable production migration, secure admin invitation design and end-to-end
vendor-listing-to-customer plan are defined in
`docs/production/production-readiness-implementation-plan.md`.

Before real deployment, replace or approve:

- fake OTP, push and SMS;
- fake payment and payout providers;
- fake maps/geocoding/routing;
- local filesystem storage and simulated scanning;
- synthetic identities, documents, orders, payments and metrics;
- local secrets and service identities;
- local-only logs and monitoring;
- local backup/restore assumptions;
- unsigned/development Android distribution;
- privacy, retention, support, security, accessibility and operational policies.

The replacement inventory remains governed by
`docs/production/test-to-production-replacement-register.md`.

## 12. Final completion gate

The project may be described as **feature-complete for local synthetic company testing** only when:

1. every Launch feature has a traceability row;
2. every applicable row is `COMPLETE_LOCAL_SYNTHETIC` or explicitly
   `BLOCKED_PRODUCTION_PROVIDER`;
3. all eight clients implement their critical workflows without developer-only credentials or IDs;
4. every visible primary action is functional or explicitly disabled with an honest explanation;
5. `pnpm check`, `pnpm build:verify`, and the connected database lifecycle pass;
6. all 15 cross-role E2E scenarios pass through the applications;
7. English/Hindi and accessibility acceptance pass for critical journeys;
8. backup/restore, incident, dead-letter and reconciliation drills have recorded synthetic evidence;
9. README, architecture, feature catalogue and phase records match the released behaviour;
10. no document describes a production provider, environment or readiness state that has not been
    proven.
