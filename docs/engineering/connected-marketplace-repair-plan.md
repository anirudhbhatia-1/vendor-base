# Connected marketplace repair implementation plan

**Prepared:** 7 September 2026  
**Status:** Batch 01 implemented at component level; connected acceptance pending  
**Request:** Repair broken journeys, connect every in-scope feature to its frontend, and keep customer, vendor, partner, admin and background services synchronized.  
**Current operating mode:** Local processes with Supabase database and explicitly acknowledged synthetic providers. The command name `dev:supabase-production` does not mean public production is approved.

## 1. How to use this plan

**Implementation checkpoint — 7 September 2026:** [Batch 01 evidence and restart instructions](repair-batch-01-evidence.md) record R0 offline preflight/naming, R1 transactional customer OTP enrolment and browser recovery, and R2/R8 partner proof-state gating. Baseline findings below describe the original defects; the checkpoint records which bounded repairs now exist. R0–R12 and the full eight-client journey are not complete.

Start with R0, then R1. Do not begin another visual redesign while sign-in, resource selection or the order loop remains broken. Each repair slice ends with persisted behavior tests, PWA and Android evidence, and failure recovery. Backend-only success is not slice completion.

Read alongside:

- [All-feature repair register](connected-marketplace-feature-register.md): one entry for each of the 354 canonical feature IDs, with its exact finished behavior, phase steps, workflow assignment, inherited implementation claim and evidence candidates. Every entry starts **NOT_REVERIFIED** in this repair audit.
- [Canonical phases](../../phases.md): original phase numbering; R0–R12 below are repair work packages, not replacement phases.
- [PRD](../../prd.md), [features](../../FEATURES.md), [workflow](../../workflow.md), [architecture](../../architecture.md), [implementation contracts](../../implementation.md), [D-15](../decisions/D-15.md): authoritative product and architectural boundaries.
- [UI/UX implementation plan](ui-ux-workflow-implementation-plan.md): layout direction and previous bounded changes; keep its acceptance gaps open until tested.
- [Phase conformance audit](phase-conformance-audit.md): historical evidence, not evidence that today's eight clients work.

The August completion plan remains historical where it says no BullMQ, no browser tests or local-database-only. Current code has BullMQ workers, browser test files and Supabase runtime support. This document controls the repair sequence, not product policy. Resolve policy conflicts explicitly; never silently change fees, approvals, role separation or release scope.

### Scope and honest status

The current register has **354 features: 309 Launch, 23 Later, 7 Gated, 15 Excluded**. It claims 265 `complete_local_synthetic`, but that label allows one client and does not prove all applicable PWA/Android clients or today's deployment. We preserve those claims as history and require fresh evidence.

“All features” means:

1. Every Launch feature has its required workflow and applicable client implementation.
2. Shared/backend features have the correct consumers, administration and operational evidence; they do not need an invented standalone screen.
3. Later features are represented in the backlog and remain unavailable in launch paths.
4. Gated features cannot be activated without named approval and implementation evidence.
5. Excluded features have negative tests where relevant; do not implement them to inflate coverage.

### Evidence gathered for this plan

Read-only source review covered the recent OTP/BFF changes, customer authorization, partner field endpoint registration, worker startup/readiness, runtime provider boundaries, feature/phase catalogs, native entry points and browser acceptance suites. It is a targeted repair audit, not an exhaustive live click-through or penetration test. Conclusions here come from inspected repository files and the user's logs; no independent reviewer findings are included.

Checks executed during planning:

| Check | Result | What it establishes |
|---|---|---|
| `node tooling/scripts/verify-feature-matrix.mjs` | PASS: 354 capabilities, 101 canonical steps | Register consistency, not feature operation |
| `node tooling/scripts/verify-api-contracts.mjs` | PASS: 246 served routes | Contract-control consistency, not each route's authorization/data behavior |
| `node tooling/scripts/check-boundaries.mjs` | PASS | Import boundaries only |

Earlier in this conversation: configuration validation passed for API/worker; an API health read reported readiness; OTP/BFF focused tests passed after the enrolment sequence change. No fresh golden order, Android device run, full test suite, provider delivery or database migration was performed for this plan. No secrets belong in this document or the evidence register.

## 2. Baseline problems and first repair queue

This table records the starting defects. Consult [batch evidence](repair-batch-01-evidence.md) for implemented repairs and still-unaccepted integration work; baseline source locations may move as repairs land.

Priority: P0 security/money/data integrity; P1 blocked core task; P2 recovery/visibility/parity; P3 polish. Within a priority, estimate impact, risk and effort from 1–5 and use `(impact + risk) × (6 − effort)` as a sequencing aid, never to move a safety defect behind easy cosmetic work. Re-estimate after reproduction.

| Finding | Evidence / current status | Required repair and acceptance | Priority; impact/risk/effort |
|---|---|---|---|
| Environment name and real behavior differ | `package.json`; `database/src/runtime-config.ts`; explicitly acknowledged fake providers in current setup | Create a clearly named development profile; aggregate missing configuration; preserve production fail-closed rules. Cold start and clean stop once without orphaned ports. | P1; 5/4/2 |
| Loopback origin mismatch blocks OTP and other mutations | `app/api/session/otp/request/route.ts`, verify, session DELETE and backend proxy compare `Origin` with normalized `nextUrl.origin`; `127.0.0.1` reproduction failed | One shared strict origin policy for every mutation. Canonical host redirects before form use; account for trusted deployment origin without trusting arbitrary forwarded headers or wildcard localhost ports. Regression-test hosts, ports, scheme, missing/null Origin and forged headers. | P1; 5/4/2 |
| OTP succeeded but customer enrolment followed a permission check | User logs: verify 200 → customer/me 403 → session 401. BFF now calls authenticated enrol before publishing cookies | Keep the sequence; test first-ever account, existing customer and concurrent attempts. Extend failure recovery: verification and enrolment are currently separate upstream calls, so a failure can consume a code without delivering a usable session. | P1; 5/4/3 |
| Used OTP incorrectly appeared as HTTP success | Verify BFF now maps `already_verified` to 409 and malformed session response to 502 | Preserve explicit errors. Test code consumed by a successful request whose response is lost; don't replay raw tokens or auto-grant privileges. | P1; 4/4/2 |
| Permission denial is treated as expired authentication | `app/api/session/route.ts:104` converts customer/me 403 to 401 and clears cookies | Distinguish session invalid, missing customer enrolment and revoked/forbidden access. Offer authorized recovery; never regrant a revoked role simply because login retried. | P1; 4/5/3 |
| Requested return path is lost after customer login | `app/sign-in-panel.tsx:133` sends successful sign-in to `/` | Validate and honor an internal `next` path including safe query; reject external/protocol-relative paths. Test checkout/order deep links. | P2; 3/2/1 |
| Partner offline-proof endpoint returns 404 in the running stack | User logs. `PartnerFieldOpsController` declares the route and `app.module.ts` registers it; 0052 adds self-scoped capability | Check migration/schema, effective role/capability, eligibility and current process build before changing URLs. Concealed authorization can return 404; no evidence yet of a missing route. Separate “no proofs” from denied/unavailable. | P1; 4/4/2 |
| Failed proof lookup becomes a false empty queue | `apps/partner-pwa/app/partner-workspace.tsx:430` catches lookup errors as `{ proofs: [] }`, while held-proof state controls offer acceptance | Model unknown/loading/failed/ready proof state separately. Block new-offer acceptance until a valid read; keep existing custody/safety recovery reachable. Verify 403/404/503 and reconnect behavior. | P1; 4/5/2 |
| Finance UI still synthesizes reconciliation references | `apps/admin-pwa/app/finance-queues-panel.tsx:67–70` creates timestamp command references and a `SYNTH-STMT` reference | Development-only labeling is mandatory. Replace fabricated statements with selected/imported verified references for staging; preserve command identity across uncertain retries. Confirm server deduplication independently. | P1; 4/5/3 |
| Queue readiness is overstated | `apps/api/src/health.controller.ts:40–59` checks PostgreSQL job/outbox table presence, not Valkey or active consumers | Report database schema readiness separately from broker/consumer health. Add actual worker liveness, oldest-job age and controlled queue canary. | P1; 4/4/3 |
| Acceptance tests do not guarantee the journey they name | `e2e/cross-role-journey.spec.ts` conditionally skips actions; live suite opt-in | Build deterministic fixtures and assert mandatory stages. An empty order list must fail the golden path, not skip accept/pick/handoff. | P1; 5/5/3 |
| Acceptance selectors/URLs drifted after UI/BFF changes | `e2e/live-marketplace-loop.spec.ts` waits for `/auth/otp/request` in browser and old admin heading | Use public `/api/session/otp/request`, stable accessible task selectors and explicit role routes. Do not just loosen assertions to any 200. | P1; 4/4/2 |
| Native parity is incomplete | Operational `App.tsx` screen switching; vendor Store/Money unavailable; native coordinate inputs; secure-storage tests alone | Migrate task stacks and fill actual resource actions, then run process-restart/back/offline tests on each role app. | P1; 5/4/5 |
| Live provider behavior is not demonstrated | Runtime fake OTP; acknowledged filesystem/fake payment mode; provider ports and storage code exist at different maturity | Track each adapter separately as absent/partial/contract-tested/staging-verified. Never equate storage adapter code with configured bucket privacy/scanning. | Release blocker; 5/5/5 |

Do not infer that the partner's successful offers endpoint proves held-proof permissions, that a worker heartbeat proves completed jobs, or that a frontend `GET / 200` proves access to business data.

## 3. Non-negotiable connected architecture

Keep the modular NestJS/Fastify business API. Do not rebuild the project as microservices to solve integration defects. Supabase PostgreSQL/PostGIS remains the source of truth. Keep four distinct PWAs and four distinct Android apps.

For every command:

`Frontend intent → authenticated API → authorization + current-state/version checks → database transaction → response + transactional outbox → idempotent workers → scoped projections/notifications → all affected clients refresh`

### Shared connection rules

1. Clients own presentation and safe transient drafts; the server owns price, availability, permission, deadlines, custody, order transitions and money.
2. Session establishment precedes role/resource bootstrap. A role label in a client never grants access. Vendor location and partner assignment are selected from authorized APIs, not unvalidated pasted identifiers.
3. Use one typed contract for each command/query, with runtime validation for external responses. Preserve status, stable error code, request ID and retry guidance; never show raw private provider errors.
4. Name the database transaction boundary and domain owner. Write the business change and its outbox event together. Network/provider calls run outside the transaction and reference a durable attempt.
5. Each mutation carries a stable command/idempotency key and expected aggregate version where appropriate. A timeout is an unknown result, not permission to retry with a new charge or order ID.
6. Every event includes event ID, aggregate type/ID/version, occurred-at time, correlation/causation ID and schema version. Minimize PII. Consumers deduplicate and can catch up after outages.
7. Response success updates the initiating view from server state. Other roles refetch or receive authorized invalidation; do not broadcast full order/address objects across tenants.
8. Use version-aware polling first where already implemented; bounded backoff/jitter and visibility-aware refresh. Add push/SSE only behind scoped authorization and reconnect replay. Polling and push are invalidation signals, not a second source of truth.
9. Clear role-specific data on logout/account/location changes; discard stale asynchronous responses. Cache keys include actor, location, resource, query, selected address and relevant catalogue/policy versions.
10. Refresh relevant data on foreground/resume/reconnect. Durable server state must reproduce the same order after page refresh, browser restart and Android process death.
11. Internal notes, exact location, bank fields and private evidence are omitted server-side from unauthorized projections. Hiding them with CSS does not count.
12. No fake success: unavailable provider/screen/action is visibly unavailable with a useful next step. Synthetic mode is identified at entry and money/proof screens.

### Event/projection connection matrix

Names below describe required event semantics; reuse/version existing event names after inspecting implementation, rather than creating duplicate event families.

| Durable change | Initiator | Required consumers / visible outcome | Negative invariant |
|---|---|---|---|
| Identity invited, membership activated/revoked | Admin/owner; recipient verifies | Correct role login/bootstrap; admin pipeline; audit; notification | Invitation cannot grant other vendors, zones or admin functions |
| Store approved/published/paused | Admin + vendor prerequisites | Customer feed/detail, cart revalidation, vendor publication checklist, admin queue | Pause cannot erase accepted orders or refund arbitrary siblings |
| Product/price/stock/moderation version changes | Vendor/admin | Search/detail availability, cart stale indication, quote revalidation, vendor feedback | Old cache cannot authorize new price or sell unavailable stock |
| Address/fulfilment selection changes | Customer | Discovery, delivery options, cart, quote and promise refresh | Old-address quote cannot silently confirm |
| Checkout attempt persisted/payment changes | Customer/provider/worker | Customer payment recovery; holds; vendor visibility only after required payment gate; admin finance | Duplicate webhook cannot duplicate capture/order/ledger |
| Vendor accepts/declines/deadline expires | Vendor/worker | Customer timeline/refund, inventory, dispatch eligibility, admin exceptions | One vendor cannot change a sibling order |
| Substitution/weight decision opens/resolves | Vendor/customer/worker | Customer decision inbox; vendor picking; revised money allocation; notifications | No silent substitution or increase beyond approved cap |
| Ready/package change | Vendor | Dispatch/customer pickup; partner package summary; customer ETA | No custody before required release and proof |
| Offer accepted/expired, custody/delivery/return | Partner/worker/vendor | Partner active task, customer timeline, vendor handoff, admin dispatch, finance eligibility | No double assignment or exact address before custody |
| Case message/evidence/status changes | Participants/admin | Only authorized case views, SLA/alerts, persistent next instructions | Internal notes never appear in participant response/export |
| Refund/settlement/payout/reconciliation | Worker/finance approvers | Customer refund/receipt; vendor statement; partner earnings; admin exceptions | Financial history append-only; no unrelated allocation changed |
| Policy/incident change | Approved admin workflow | Affected quotes/commands disabled or versioned; queues show reason and owner | Existing money/custody obligations retain safe closure paths |

Each row must be tested with independent role sessions observing the **same resource IDs**, including disconnected clients that catch up later.

## 4. Per-feature implementation contract

Before coding a feature listed in the companion register, expand its entry into a repair ticket with these fields. The register supplies the exact required behavior; linked R slices supply the shared implementation sequence. Do not mark a ticket ready if its actual contract or applicable screen is still unknown.

| Field | Required contents |
|---|---|
| Identity | Canonical feature ID/name/scope, all phase steps, relevant PRD/workflow clauses, dependency feature IDs |
| Evidence | Current source locations, reproducible actual behavior, expected behavior, confidence and environment |
| Entry | PWA route + native tab/stack/deep link for each applicable actor; upstream entry and success/return destination |
| Preconditions | Session, role/capability, location/assignment ownership, lifecycle state, approved configuration, serviceability |
| Read model | Exact API method/path, pagination/filter schema, DTO/runtime parser, privacy projection and loading/cache policy |
| Command | Exact method/path/body, expected version, idempotency strategy, actor and request/correlation identity |
| Persistence | Tables/constraints/indexes, transaction boundaries, audit/transition record; migration/backfill plan if needed |
| Propagation | Event ID/schema, outbox/inbox consumer, timers, dependent role projections, notifications and invalidated queries |
| State handling | Loading, empty, offline, stale, denied, invalid, saving, unknown outcome, success, expiry, cancellation |
| Recovery | Safe retry, operation-status lookup, conflict resolution, draft retention, support escalation; never client-side forced state |
| Acceptance | Positive, negative, concurrent/replayed, cross-role, restart/reconnect, privacy, accessibility and EN/HI cases |
| Completion evidence | Command, timestamp/build, environment, fixtures, actual result, redacted artifacts, residual issues, reviewer |

Backend features may say “no direct screen” but must name the affected user screens and admin/operational observability. A customer-only preference need not be mirrored into vendor UI; synchronization means sharing only what the recipient needs.

### Universal frontend state contract

- **Loading:** skeleton matching the layout; label pending work; avoid duplicate submission.
- **Empty:** distinguish no records from no permissions and no selected location; offer the valid next action.
- **Offline:** retain safe draft/read state; clearly mark stale data. Money, proof and approval are not shown as successful offline.
- **401:** recover session if valid refresh exists; otherwise sign-in with safe return destination.
- **403:** explain access/eligibility restriction and authorized recovery; do not clear all state or repeatedly refresh the page.
- **404:** distinguish not found/concealed/not configured internally; do not silently turn errors into empty arrays.
- **409:** reload latest version, explain changed values, let the user reconsider; do not blind retry overwritten edits.
- **422:** associate errors with fields and focus the first invalid field.
- **429:** display server retry timing and preserve inputs; no repeated auto-submit.
- **5xx/timeout:** keep drafts and command key; show retry/status-check/support reference without exposing secrets.
- **Success:** display persisted outcome, update downstream queries, restore meaningful focus and navigate to the owning detail page.

## 5. Step-by-step repair sequence

Effort bands below are relative implementation sizes, not promised calendar dates: S = one bounded component/contract; M = connected service plus both clients; L = multi-role lifecycle; XL = provider/device/release evidence. Engineering should estimate person-days only after R0 reproduction and dependency inventory.

<a id="r0"></a>

### R0 — Reproducible environment and evidence baseline

**Canonical phases:** 0.3–0.5, 2.1–2.6. **Owner:** platform/QA. **Size:** M. **Blocks:** every subsequent slice.

1. Record a source snapshot/build identifier and preserve the dirty worktree. Record Node/pnpm versions; use pinned repository versions. Never reset user changes to make a test green.
2. Define `local-test`, `supabase-development`, `staging` and `production` explicitly. Add an unambiguous development startup alias rather than forcing users to remember that a production-named command is synthetic. Keep migration/runtime identities separate and TLS verification intact.
3. Add a redacted preflight report: required env-key presence, provider mode, port owners, migration status, database role, configured bucket names, queue availability and expected browser origins. Aggregate missing keys into one actionable report, not one restart per key.
4. Validate actual startup/stop/restart behavior of the existing scoped watcher. Stop only owned processes. Report backend failure to users of otherwise-ready PWAs. `.env` changes need a documented restart; never claim an old process picked them up automatically.
5. Split API liveness, DB/schema readiness, broker readiness and worker consumer health. The current queue-table test must not claim Valkey readiness. Add a test-only queue canary with bounded timeout and cleanup in an isolated environment.
6. Create a dedicated acceptance namespace/database and named fixtures for new customer, existing customer, two vendors/locations, partner, scoped admin, independent approver and forbidden actors. Do not run destructive verifier/seed scripts against the shared Supabase project without separate approval.
7. Build route inventory for all eight clients. Classify each route as connected/partial/placeholder/denied/unverified, with actual API dependencies. Capture screenshots at target widths and native screens only after the environment is working.
8. Save a baseline defect list and a sanitized evidence folder. Align historical docs but do not overwrite their historical results.

**Exit:** one documented command starts the intended stack from cold; dependency failure is correctly reported; stop releases owned ports; no secret values appear in output; fixture environment is explicitly identified.

<a id="r1"></a>

### R1 — Identity, enrolment, sessions and resource bootstrap

**Canonical phases:** 4.1–4.6. **Owner:** identity + all client owners. **Size:** L. **Depends:** R0.

1. Implement and test the customer chronology: request challenge → verify once → create/resolve identity → permitted self-enrolment → session establishment → customer identity → preferences/address/cart bootstrap → validated `next` destination. Anonymous bootstrap must never call customer-role APIs before enrolment.
2. Consolidate completion under a recoverable backend operation. The recent BFF enrolment patch repairs ordering but leaves two network steps: if enrolment or the response fails after OTP consumption, the browser may have no session. Prefer a customer-specific completion transaction/operation; keep existing generic role sign-in behavior intact. Persist resumable completion evidence without storing or replaying plaintext bearer tokens. Require a fresh challenge when secure recovery is impossible.
3. Preserve idempotent self-enrolment for an already active customer, but inspect revocation/expiry/disabled-user policy before granting. Do not auto-restore an intentionally revoked role. Tests must prove no vendor/admin/partner privileges can be obtained through customer enrolment.
4. Standardize Origin/CSRF checks across request, verify, refresh/signout and backend mutations. Canonicalize the browser host at navigation time and validate deployed origins from trusted configuration. Test localhost/127.0.0.1, HTTPS, port changes, malicious cross-origin and forwarded-header spoofing. Do not disable CSRF as a workaround.
5. Separate `unauthenticated`, `enrolment_required`, `forbidden`, `service_unavailable`, `otp_expired`, `otp_consumed` and invalid-response errors. Session introspection must not disguise a role denial as an expired session or drop rotated tokens after a temporary outage.
6. Add token-refresh single-flight across concurrent requests, multi-tab/restart behavior, device revocation and sign-out recovery. Browser refresh tokens stay HttpOnly; Android refresh tokens use SecureStore. Guard stale responses and clear per-actor caches.
7. For vendor/partner/admin: authenticated identity → authorized role list → allowed location/zone/assignment context. A person with no membership sees a setup/review state, not a blank dashboard or reload loop. Validate scope server-side on every command.
8. Admin invitations: scoped creation → expiring single-use invite → recipient credential establishment → membership activation → onboarding. Do not display permanent passwords or equate account creation with store publication/partner eligibility.
9. In synthetic mode, provide a protected, challenge-specific developer OTP retrieval workflow with expiry and no public OTP endpoint/logging. Real SMS mode uses approved allowlisted testing and provider configuration; show the correct mode in UI.

**PWA pages:** login, invite acceptance, access/setup, session/device list, recovery and denied-access screens. **Android:** corresponding routes with native back/restart/deep-link support.

**Exit:** first-time customer login and refresh work; existing accounts retain correct scopes; role switch/location switch cannot leak records; invalid/used code is recoverable; logout and revocation work; no privilege escalation, redirect loop or duplicate customer grant.

<a id="r2"></a>

### R2 — Shared contracts, routing and cross-role synchronization

**Canonical phases:** 3.1–3.7, 4.4, 4.6. **Owner:** platform + client owners. **Size:** L. **Depends:** R0; integrate alongside R1.

1. Inventory every visible button, form, navigation target and background fetch. Trace it to a typed API method, controller registration, authorization rule, service and persistence. Raw requests must have the same error/idempotency/runtime validation contract as typed clients.
2. Resolve endpoint mismatches with served-route tests and actor-specific HTTP tests, not source string matches alone. For partner offline proofs, inspect 0052 migration/capability and `PARTNER_SELF` eligibility before concluding route absence; keep concealed-resource protections.
3. Define resource-specific query keys and invalidation maps from section 3. Propagate selected location/address through all dependent data, not only the header. Cancel/invalidate old account/location requests.
4. Standardize aggregate version conflicts, paging cursors, money minor units, quantities/weight units, timestamps and server deadlines. Add DTO compatibility tests across PWA and native clients.
5. Wire durable outbox consumers, scheduled deadlines, retry/dead-letter handling and event versioning. Broker delivery and PostgreSQL job claiming must not independently execute duplicate effects.
6. Create stable route stacks/deep links for each role; preserve existing PWA URLs. Operational Android apps must replace local screen-string switching. Separate page responsibility from shared session/context providers.
7. Add a common request-reference display and safe problem mapping. Prevent full-page reload loops, noisy polling and silent `catch(() => [])` failure states.

**Exit:** every Launch-feature ticket has an actual connection trace; cross-role invalidation tests use the same IDs; replayed/out-of-order events cannot regress a view or repeat a mutation.

<a id="r3"></a>

### R3 — Admin-created network, onboarding and publication

**Canonical phases:** 5.1–5.4, 9.1, 11.1. **Owner:** admin/vendor/partner teams. **Size:** L. **Depends:** R1–R2.

1. Build admin lead/invitation forms with scoped field validation and duplicate identity/business checks. Show separate identity, membership, onboarding, document, eligibility and publication statuses.
2. Vendor accepts invite and selects an authorized location. Persist business/store profile, coordinates/address, category, hours/holidays, minimum order, preparation time, service area and fulfilment modes. Replace pasted location IDs with an API-backed selector.
3. Upload onboarding evidence through scoped grants; show upload, quarantine, scanning, review, rejection and replacement statuses. Keep private evidence out of public catalogue buckets and logs.
4. Admin reviews the same submitted version; records reason/evidence, approves/rejects or requests correction. Vendor sees actionable field/document feedback rather than only a status badge.
5. Partner application persists identity/documents, vehicle/zone, training/emergency contact and payout setup. Eligibility becomes active only after required review; expiry/restrictions propagate to offer eligibility without stranding held custody.
6. Publication checklist joins approval, active location, category restrictions, catalogue review, media status, inventory, hours/service area/capacity, fee acknowledgment and internal test-order evidence. “Publish” returns blockers and evidence references.
7. Authorized internal test orders for unpublished stores stay out of public discovery, metrics and live payouts. Publication/pausing produces an audit event and invalidates storefront projections.
8. Staff invitations use scoped roles and explicit revocation; active work shows safe handoff/reassignment where policy requires it. No account gets all locations by default.

**Frontend:** admin Onboarding/Vendors/Partners/Access; vendor Onboarding and Store subpages; partner Application/Account. Every data-entry task has PWA and native equivalent or remains explicitly incomplete.

**Exit:** admin creates vendor/partner → recipient logs in → submissions persist → approval is visible → eligible store appears without redeploy; denied/rejected/expired variants behave correctly across roles.

<a id="r4"></a>

### R4 — Catalogue, media, CSV, inventory and moderation

**Canonical phases:** 5.5–5.7, 7.2, 11.4. **Owner:** vendor/catalogue + admin. **Size:** L. **Depends:** R3.

1. Separate product list, create/edit, variants, media, inventory and CSV tasks. Load actual product IDs/versions; no synthetic local array can represent a persisted edit.
2. Persist title/category/tax/unit/pack/price, variable-weight bounds, permitted substitutions and lifecycle state. Show saved result and handle stale-version conflicts. Validate decimal input into integer minor units and explicit weight units.
3. Separate on-hand stock, holds, committed quantity and available-to-sell. Vendor adjustments use ledger commands with reason/version; never directly overwrite reserved stock. Out-of-stock/deactivation updates customer discovery/cart and prevents new checkout.
4. Media: scoped upload → format/size/dimension validation → quarantine/scan/moderation → approved asset reference → publication. Failed upload has retry/removal; rejected image never gets a public URL. Native uses real capture/file selection.
5. CSV: upload → parse/header mapping → row validation → preview additions/updates/errors → user confirms → idempotent commit → progress/result download. Partial results are explicit; re-upload cannot duplicate products or overwrite newer manual edits unnoticed.
6. Admin moderation queue names the product/store/version, reason and approved policy; decision updates vendor feedback and customer-safe availability. Keep category taxonomy/prohibited goods consistent with publication, cart and order intake.
7. Expiry/freshness workers mark stale availability; stale/closed/capacity-full are distinct states. Existing accepted orders follow order policy, not automatic deletion.

**Exit:** vendor creates and edits a product and uploads/imports stock; admin approves; customer sees current values without rebuild. Two clients racing for the last unit cannot oversell. Cross-vendor product and media access is denied.

<a id="r5"></a>

### R5 — Customer location, discovery, storefront and cart

**Canonical phases:** 6.1–6.7, 5.7. **Owner:** customer + discovery/cart. **Size:** L. **Depends:** R1–R4.

1. Guest can browse and choose location through manual address/search or optional device location. Do not force raw coordinates or sign-in as the sole denied-permission fallback. Implement Mappls behind the existing provider boundary for approved staging.
2. Save/edit/delete/select address with structured fields, pin, landmark and instructions. Show serviceability before promising stores; changing address invalidates incompatible delivery/quote data with a clear explanation.
3. Home, Categories, Stores and Search use eligible API results with pagination/debounce/sort/filter, typo/local-language handling and true empty/error states. Route state retains filters and back position.
4. Store detail shows current identity, hours, rating, fulfilment, policies and catalogue. Product detail shows unit/pack/price/stock freshness, permitted substitutions and variable-weight estimate/cap. No marketing promise overrides the serviceability API.
5. Favourites/preferred shop and shop requests persist through APIs; requests enter the admin/vendor lead pipeline without automatically publishing a vendor.
6. Guest cart keeps safe local intent. On login merge once with stable idempotency and deterministic variant/location quantity rules; surface conflicts and clear guest data only after acknowledgement.
7. Cart groups by location; each group has fulfilment choice, notes and permitted substitutions. Respect group limits and explicit add-another-store decision. Server returns current prices/availability and isolated recovery for changed lines.
8. Provide focused cart page with update/remove/clear-group, quantity validation and checkout CTA. Keep basket access global except where checkout owns the action bar. Address or vendor state changes trigger revalidation, not a silent charge change.

**Exit:** guest → location → store/product → grouped cart → login/merge → persisted cart works on PWA and Android; closure/deactivation/address change recover without losing unrelated groups.

<a id="r6"></a>

### R6 — Quotes, checkout, payment and inventory correctness

**Canonical phases:** 7.1–7.8, 10.1–10.2. **Owner:** checkout/money + customer. **Size:** XL. **Depends:** R2/R4/R5.

1. Entering Checkout automatically validates cart/address/fulfilment and obtains a current quote. Relevant changes invalidate/requote; show server expiry and block expired confirmation.
2. Explain final payable amount and customer-facing components, independent store promises and authorization cap. Keep internal platform fee formulas/margins out of customer DTOs/UI. No COD.
3. In one transaction lock/check cart version, acquire stock safely and persist holds, checkout group, one child draft per location, payment attempt, allocations/ledger intents and outbox. Validate group limit, inventory, publication, serviceability and policy snapshots again.
4. Create provider order outside that transaction using the durable attempt. Persist external reference and normalized state. Unknown provider result enters reconciliation; retry must not create another payable order.
5. Integrate Razorpay Test hosted/tokenized checkout on PWA and Android under approved credentials. Verify callback signatures and signed durable webhooks; customer UI success is not payment truth. Keep synthetic mode explicitly separate until sandbox acceptance passes.
6. Release child orders to vendors only after the configured verified payment gate. Keep payment pending/failed/abandoned/unknown distinct from order acceptance. A refresh/deep link restores attempt state without resubmission.
7. Expiry worker releases holds; late successful payment cannot resurrect expired stock—reconcile/refund if fulfilment cannot safely resume. Duplicate/out-of-order events and retried commands have unique effects.
8. Weight decreases create allocation-scoped partial refunds; increases require explicit new cap/top-up approval and confirmed collection. Refusal follows the documented remove-line/cancel policy. Never silently overcharge.

**Exit:** one multi-vendor golden checkout and failure/abandonment/timeout/expired quote/duplicate click/duplicate webhook/invalid signature/last-unit race tests pass; zero duplicate charges/oversells in the tested workload. Fake-provider success is not staging payment acceptance.

<a id="r7"></a>

### R7 — Vendor fulfilment and customer decisions

**Canonical phases:** 8.1–8.7, 9.5–9.6. **Owner:** vendor + customer/orders. **Size:** L. **Depends:** R6.

1. Payment-confirmed child appears in the correct vendor queue and triggers an idempotent alert. Show server deadline, preparation promise, items and permitted actions, not client-inferred transitions.
2. Accept/decline uses expected order version and reason/impact preview. Deadline worker races safely with acceptance. Decline changes only the child allocation/stock/refund and updates customer/admin.
3. Dedicated pick list: found/missing, actual weight, permitted substitution proposal. Never mark picking done with unresolved required decisions.
4. Customer decision screen receives the same decision ID/version, old/new item/price and deadline. Approve/reject or expiry updates vendor pick state, amount and notifications exactly once.
5. Package count/condition and ready command follow validated picking. Ready updates dispatch or pickup eligibility and the customer timeline/ETA. “Ready” is not “delivered.”
6. Customer pickup uses issued challenge/order evidence and server acknowledgment. Vendor self-delivery uses its own authorized custody/completion path; platform delivery follows R8. Do not accidentally create partner assignments for pickup.
7. Order history/receipt/reorder/review entry reads terminal server outcomes. Reorder revalidates current catalogue/prices instead of copying obsolete totals. Review is fulfilment-eligible and unique per allowed subject.

**Exit:** customer sees every vendor transition and decision; deadline/decline/weight/substitution failure paths settle correct amounts; siblings remain unchanged; refresh resumes the exact pick/handoff stage.

<a id="r8"></a>

### R8 — Partner assignment, custody, delivery and offline recovery

**Canonical phases:** 9.2–9.9. **Owner:** dispatch/partner + vendor/customer. **Size:** XL. **Depends:** R3/R7.

1. Bootstrap partner eligibility, zone, availability, active assignment and held-proof queue independently. Failed proof lookup must block unsafe new-work claims and show retry, not pretend there are zero proofs.
2. Offers have immutable attempt ID, expiry, earnings/pickup summary and privacy-limited destination. Accept is atomic; enforce one active assignment per fulfilment and applicable partner work limits server-side.
3. Work → active job opens a single selected assignment. Native back/deep link/process restore returns to the active stage; server status chooses the next allowed action.
4. Vendor navigation/arrival/wait uses server timestamps and capture evidence. Record package count/condition agreement and pickup QR/OTP. Only verified handoff establishes custody.
5. Before custody, omit exact customer address/contact; after custody reveal authorized navigation/instructions. Permission refusal has text/landmark fallback. Do not enable moving customer maps in this release.
6. Arrival/delivery OTP advances state only after server acknowledgment; wrong/expired proof, emergency holds and conflicting state provide safe retry or support. Never report delivered because a local button was tapped.
7. Offline proof uses real encrypted device persistence, a capture identity/timestamp, bounded expiry and pending/synced/rejected/escalated status. A digest string sent to a server is not by itself offline capture. Reconnect sync is idempotent and reconciles conflicts before offering more work.
8. Missing/damaged package, delay, unreachable customer, wrong address and unsafe location each have a reasoned exception flow. Emergency remains reachable but blocks inappropriate completion; alternative proof remains gated.
9. Return-to-origin/fallback destination and handoff terminate custody before assignment closure/earnings. Customer refund and vendor receipt of returns link to the same child order.

**Exit:** offer → pickup → custody → delivery or return works across partner/vendor/customer/admin; held proof survives process death; no unauthorized address exposure or duplicate assignment; suspended eligibility cannot strand safe custody closure.

<a id="r9"></a>

### R9 — Receipts, money, settlement, payouts and reconciliation

**Canonical phases:** 10.1–10.7, 9.10, 11.5. **Owner:** finance + all affected clients. **Size:** XL. **Depends:** R6–R8.

1. Maintain integer-minor-unit append-only double-entry postings and child allocations. Enforce balances, uniqueness and allowed financial transitions with transaction tests.
2. Customer cancellation preview is server-calculated by stage/child; capture reason and actual money consequence. Post-custody requests route through operations/return policy rather than immediate client cancellation.
3. Capture/void/full and partial refund commands carry stable references and unknown-result recovery. Reconciliation compares durable provider events/statements to attempts and ledger, never to browser success pages.
4. Receipts are generated from settled facts, versioned on correction, and downloadable via authorized access. Customer refund status links to the affected child; vendor sees contracted deductions; partner sees trip line items.
5. Settlement eligibility follows fulfilment/dispute rules. Schedule the approved payout window/timezone through jobs, not an arbitrary client timer; record eligible/held/attempted/failed/paid/reconciled separately. Do not assume payout-provider approval exists.
6. Admin queue actions preview impact, require reason and independent approver where specified, and execute idempotently. A rejected approval changes no money. Corrections append compensating postings rather than editing history.
7. Vendor statements/disputes and partner earnings/payout/dispute screens must name original order/trip/line references and show progress. No unsourced ₹0 balance as a substitute for unavailable data.

**Exit:** refund/cancellation/weight corrections preserve money conservation and sibling isolation; duplicate callbacks/corrections cannot double-post; customer/vendor/partner/admin views reconcile to the same ledger and provider test statement.

<a id="r10"></a>

### R10 — Support, communication, trust, configuration and incidents

**Canonical phases:** 11.1–11.9, 4.5, 3.5–3.7. **Owner:** operations + communications. **Size:** L. **Depends:** R2; integrate with R3–R9.

1. Risk-ranked admin queues show owner, age/SLA, scope, reason and next action. Drill into real entity detail and timeline; avoid raw JSON or UUID-only forms as the main operational interface.
2. Customer/vendor/partner case entry attaches the correct order/assignment/product. Case list → conversation → evidence → status/resolution persists across restart. Internal notes are a separate server-only projection and visibly separate composer.
3. Upload evidence with private signed grants, quarantine/scan limits and short-lived read URLs; validate actor and resource ownership on upload/finalize/download. Test rejected file and unauthorized URL access.
4. Participant messages use allowed participants/templates, safe metadata and audited delivery. Notify subscribed actors idempotently, deep-linking to an authorized resource; deep links re-check permissions.
5. Trust restriction/appeal uses review/evidence, scoped consequences, expiry and independent checks where required. No automatic permanent punishment from one signal; show safe operational obligations for active orders/custody.
6. Policy UI supports draft → validation/impact preview → independent approval → scheduled activation → supersession/rollback. Every quote/order keeps its applicable snapshot. Zone/fee/timer changes visibly affect only intended new work.
7. Incidents specify owner, scope, reason, expiry/review, affected queues and recovery checklist. Pausing checkout/dispatch/payouts does not block safe refund, return or incident resolution paths.
8. Notifications: database record/outbox → preference-aware provider attempt → retry/escalation → in-app history/read state. Implement/test FCM/Web Push and approved SMS fallback separately. No heartbeat counts as delivery evidence.
9. Reporting/audit/export must join consistent event/financial facts, paginate and protect scope. Downloads must be usable files, not a JSON dump; no private evidence or internal note leakage in participant exports.

**Exit:** a real fixture support case crosses customer/operations and returns a persistent instruction; notes stay private; two-admin approval and rollback work; notifications/deep links recover after outage without duplicates.

<a id="r11"></a>

### R11 — Eight-client UX, accessibility, localization and native parity

**Canonical phases:** 12.2–12.4 plus every feature's owning phase. **Owner:** client/design/QA. **Size:** XL. **Depends:** run within each R1–R10 slice, not only at the end.

1. Keep the shared light-theme tokens, role-specific information hierarchy and dedicated routes from the UI plan. Backend connection/state correctness comes before visual polish.
2. Customer: Home/Categories/Stores/Search, detail, cart/checkout, orders/decisions/tracking/receipt, account/address/privacy/support/notifications. Vendor: Orders, Catalogue product/stock/import, Store/settings/staff/areas, Money, More. Partner: Work, Active job, Earnings, Account/application/alerts. Admin: grouped queues, network, catalogue, support/trust, finance/configuration/reports/audit.
3. For every task, port actual inputs/actions to Android with native file/location/secure storage APIs and Expo Router tab/stack transitions; no single giant ScrollView with local screen flags as the completed implementation.
4. Use device-friendly validation, amount/unit labels, native text scaling, 48dp operational targets, accessible names and announced mutation states. Web supports keyboard/focus return, visible focus, 200% zoom/reflow and responsive tables/cards.
5. English/Hindi covers errors, field labels, deadlines, decisions, money, proof, accessibility labels and notification templates—not just a locale toggle. Preserve entered names and safe drafts on language change.
6. Test 360/390/768/1440px web views, keyboard-only journeys, screen reader and reduced motion; Android hardware back, permission changes, foreground/resume, process death, low-memory/slow-network and offline proof on devices/emulators.
7. Remove hard-coded store identity, fake completion counts, synthetic proof references in non-test interfaces and unexplained internal identifiers. Unavailable capabilities show truthful status and authorized recovery.

**Exit:** PWA/native evidence is recorded separately per applicable feature; no “Android supported” claim from TypeScript or Expo export alone; all critical task states are usable in both languages.

<a id="r12"></a>

### R12 — Connected acceptance, controlled staging and release gates

**Canonical phases:** 12.1, 12.5–12.7, 13.1–13.5. **Owner:** QA/platform/security/operations. **Size:** XL. **Depends:** R0–R11.

1. Repair the current browser tests first: correct BFF URLs and task selectors; remove conditional skips of mandatory actions. Live acceptance needs deterministic prerequisites, not whatever orders happen to exist.
2. Separate source/metadata controls, unit behavior, HTTP integration, database concurrency, mounted component, browser and native device results. Missing fixture/provider credentials mark BLOCKED; release jobs fail if required tests skip.
3. Run the golden journeys below with role-isolated browser/native sessions and persisted evidence for the same resource IDs. Use unique run IDs, scoped test accounts and recoverable cleanup. Never start a live test against a production-named URL solely because its name looks familiar.
4. Test worker/broker/database/provider outage, retry/restart, dead-letter replay, stale policies, network loss, callback delay and deployment during active work. Confirm backlog drains and business invariants hold.
5. Run the D-15 staging load target: 1,000 concurrent browsing users, 100 checkout confirmations/minute; discovery/search p95 <500ms and transactional API p95 <750ms with provider wait separately reported. Measure zero duplicate charges/oversells, saturation and recovery; report hardware/tier/dataset, not unlimited-scale claims.
6. Security/privacy: authorization matrix and negative endpoints, CSRF/origins, session rotation/revocation, uploads, secret/dependency/container/migration scanning, retention/deletion obligations and internal-note/address isolation. Record manual security review, not only scanners.
7. In authorized staging, prove approved MSG91/Mappls/Razorpay Test/Storage/FCM/Web Push behavior. Keep synthetic and provider acceptance reports distinct. Account approvals, costs/quotas and payout provider need explicit owner decisions.
8. Perform authorized backup restoration and rollback drills in isolated targets. Assign alert/support ownership and verify incident runbooks. Public production remains blocked until separate security/legal/compliance/restore/capacity approval.

**Exit:** all applicable Launch tickets accepted with evidence; no untriaged P0/P1; no missing required client or hidden skipped gate; operational/provider approvals recorded. Otherwise report the exact incomplete slice, not “phase fully done.”

## 6. Golden journeys and required failure suites

Each test uses fixed fixture relationships and fresh command IDs. It must assert database/projection outcomes, not just button clicks or HTTP 200. Native acceptance repeats relevant UI actions; it cannot borrow a PWA pass.

| ID | Required connected journey | Essential failure variants |
|---|---|---|
| G01 | New customer → OTP → enrolment → session → address → refresh → Orders | Used/expired/wrong code, throttling, enrolment outage, revoked role, lost response, multi-tab rotation, safe return URL |
| G02 | Admin invite → vendor login → onboarding → document review → approved store | Expired invite, duplicate submission, missing membership, rejected/quarantined evidence, forbidden location |
| G03 | Vendor creates/imports product → admin moderation → customer search/detail | Deactivation, stale stock, closed store, capacity full, price version change, CSV conflict, rejected image |
| G04 | Guest cart with two stores → login/merge → address change → quote → prepaid order | Group limit, unavailable line, expired quote, parallel confirmation, last-unit race, duplicate webhook, unknown payment |
| G05 | Vendor A accepts/picks/proposes substitution → customer decides → ready | Reject/timeout/top-up refusal, stale decision version, vendor B unaffected, acceptance deadline race |
| G06 | Partner eligible/online → offer → vendor pickup → custody → customer delivery | Offer race/expiry, held proof, wrong OTP, no location permission, emergency hold, forbidden pre-custody address |
| G07 | Customer pickup and vendor self-delivery as separate fulfilment branches | Wrong actor/proof, accidental platform assignment, duplicate completion |
| G08 | Offline delivery proof → app process death → restart/reconnect → acknowledged sync | Expired/replayed/mismatched proof, unsafe new-offer attempt, server conflict, alternative proof still gated |
| G09 | Post-custody exception → support instruction → return/handoff → money closure | Wrong return location, customer unreachable, unresolved custody, sibling unaffected |
| G10 | Cancellation/partial refund → regenerated receipt → vendor/partner statements → admin reconciliation | Duplicate correction, maker=self-checker, mismatched provider statement, payout hold, rounding/weight edge cases |
| G11 | Participant support conversation/evidence → admin notes/resolution → notification/deep link | Internal-note leak, unrelated participant, expired signed URL, duplicate notification, reopened case |
| G12 | Config approval/activation → new quote behavior → incident pause → controlled resume | Forbidden approver, stale proposal, timer race, rollback preserving old snapshots, active-work closure |
| G13 | Account export/deletion/revocation and retention processing | Active orders/disputes/legal holds, wrong account, worker retry, old device access, audit redaction |

Release evidence must include EN/HI and permission-denied cases on critical paths, plus independent actor A/B isolation for customer, vendor and partner resources.

## 7. Execution checklist for every repair ticket

1. Select the next feature ID from the register and its R slice; state affected canonical steps and dependencies.
2. Reproduce in the named test environment. Capture safe request ID/status and source location. Do not collect OTP/token/password dumps.
3. Write a failing behavior regression at the layer where the defect occurs, plus a cross-layer test if the problem is sequencing.
4. Identify root cause and smallest durable fix. Reuse existing domain services, grants and contracts; do not hide backend failures behind local fake state.
5. Plan migration/index/backfill/rollback only if needed. Do not run it against shared Supabase without reviewed target/approval and recovery plan.
6. Implement backend/contract and worker changes first; preserve authorization, state transitions, idempotency and audit.
7. Wire each applicable PWA and Android task to the same contract with role-specific presentation and recovery.
8. Test initiating action plus every affected downstream role, including reconnect and stale-version behavior.
9. Run targeted tests, typecheck/lint and safe controls; then the relevant integration/browser/native suite. Read destructive test scripts before running them.
10. Record evidence and residual gaps. Review safety and usability; update feature/phase/UI register consistently. Do not promote status from file presence or inherited claims.
11. Stop for new external-provider authority, approval/cost, policy conflict or destructive operation. Continue safe independent work without claiming the blocked gate is done.

### Ticket completion states

`NOT_REVERIFIED → REPRODUCED or SPECIFIED → IMPLEMENTING → VERIFIED_COMPONENT → VERIFIED_CONNECTED_LOCAL → VERIFIED_STAGING`

Use `BLOCKED` with the exact dependency and owner; `DEFERRED`, `GATED`, `EXCLUDED` are scope labels, not failed implementations. Partial work may close a subtask but does not close the whole feature. Each applicable client has its own verification state.

## 8. Deliverables and rollout discipline

- R0 output: reproducible profile/preflight, fixture ownership, route inventory and defect baseline.
- R1–R2 output: tested identity/resource bootstrap, contract registry, error policy, version/idempotency and event-invalidation map.
- R3–R10 output: connected domain/client slices with screenshots, test logs and shared resource IDs across roles.
- R11 output: eight-client parity grid, native device results, EN/HI and accessibility findings resolved or explicitly open.
- R12 output: golden/failure-path results, load/security/recovery/provider evidence and named approval checklist.

Limit work in progress: finish a vertical task rather than mark backend, UI and worker done independently. Run customer identity first, then supply/publication, then one actual shopping/fulfilment loop, before broad cosmetic changes. Once the loop is reliable, close every remaining Launch entry using the same acceptance template.

Do not automatically deploy, rotate real credentials, purchase services, send real SMS, process real money, seed shared records, rewrite migrations, or remove existing user work as part of executing this plan. Those require the appropriate explicit authorization. Implementation changes and verification boundaries are recorded in the linked batch evidence.

## 9. First implementation batch and handoff

Execute this batch before broad catalogue/visual work:

1. **R0 preflight and naming:** identify the intended development target and running process versions; show all missing prerequisites safely. Reproduce one clean start/stop with no provider actions.
2. **R1 customer bootstrap:** test a never-enrolled customer through request/verify/enrol/session/preferences/Orders; then existing/revoked users, enrolment failure and a lost response. Preserve the current patch while designing durable recovery. Honor the requested return route.
3. **R1 common origin/session errors:** remove hostname-dependent failures through one reviewed policy, not a permissive comparison. Exercise all cookie-authenticated mutations and CSRF failures.
4. **R2/R8 partner proof access:** prove the route/capability/migration/eligibility state with read-only diagnostics; then replace false-empty fallback with explicit unknown/denied/unavailable states and test blocked offer acceptance.
5. **R12 acceptance harness repair:** update BFF response waits/admin route selectors; create deterministic fixtures in an approved isolated target; make missing golden-path prerequisites fail the acceptance job.
6. **R3–R9 thin connected order:** admin invites vendor/partner → vendor catalogue published → customer buys → vendor prepares → partner custody/delivery → all roles see consistent receipt/refund/earnings. Record each intermediate state and one failure path before widening coverage.

Suggested execution instruction for the next implementation session:

> Read this plan, the all-feature register, current UI plan, canonical phases and D-15. Start at the first unaccepted repair item, not the next historical phase number. Reproduce the defect and write a behavior test; trace frontend → contract/API → authorization → domain transaction/outbox → worker → affected role projections. Implement the smallest durable fix and its applicable PWA/Android tasks without bypassing permissions or faking success. Verify the connected result and negative/retry/restart cases, then record exact evidence and remaining gaps against feature IDs and canonical steps. Continue safe independent work; stop for provider activation, policy decisions or destructive/shared-database changes requiring approval. Never call a feature complete from source-text checks alone.

Planning artifact verification: all 354 feature IDs occur once in the companion register; all 101 canonical phase steps are indexed; all register file links and R0–R12 anchors resolve. This is documentation coverage only, not application acceptance.
