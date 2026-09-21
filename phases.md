# Phased Delivery Plan — Neighbourhood Store Marketplace

**Status:** Execution roadmap for building the product
**Version:** v1.1 · 6 September 2026
**Applies to:** Product validation, Customer App/Web, Vendor Portal, Delivery Partner App/Portal, Admin Console, backend, workers, data, integrations, testing, security, operations, and launch

## 1. Purpose

This file breaks the complete product into ordered phases and small, verifiable steps. It also defines how every completed step must be explained to the project owner.

This plan does not replace the existing product contracts:

| Question | Source of truth |
|---|---|
| Features that will exist | `FEATURES.md` |
| Product outcomes and MVP scope | `prd.md` |
| System boundaries and durable state | `architecture.md` |
| Screens and interaction behaviour | `design.md` |
| Cross-role sequence and handoffs | `workflow.md` |
| APIs, state, data, timers, events, and tests | `implementation.md` |
| Contributor authority and restrictions | `rules.md` |

If documents conflict, implementation stops. The conflict must be resolved in the authoritative document before code continues.

## 2. How this plan must be executed

### 2.1 One step at a time

Work proceeds in this order:

1. Confirm the current phase entry gate.
2. Select one numbered step inside that phase.
3. State the intended change before editing files.
4. Inspect existing files and preserve unrelated work.
5. Implement the smallest complete vertical change.
6. Add or update the required tests, fixtures, observability, and documentation in the same step.
7. Run the verification commands relevant to that step.
8. Review the resulting diff for scope, security, privacy, and accidental changes.
9. Explain exactly what was created or changed using the completion report in §3.
10. Report step evidence. During an explicitly requested sequential audit, continue to the next safe audit step without repeated confirmation; stop affected work for missing authority, destructive actions or unresolved business decisions.

The owner requested a sequential re-audit on 6 September 2026. Report per-step findings without treating this as approval for production activation. Historical one-step pauses do not prevent the authorized audit.

A step is not complete merely because a screen renders or an endpoint returns success. Its error, timeout, retry, duplicate, permission, empty, loading, stale, reconnect, audit, and observable states must also be handled where applicable.

### 2.2 No hidden bundling

- Do not silently complete several numbered steps under one update.
- Do not introduce later-phase features because they are convenient while editing nearby code.
- Do not create abstractions for hypothetical future requirements when a simple phase-scoped implementation is enough.
- Do not defer financial integrity, authorization, failure handling, or audit work to the hardening phase.
- Do not claim a phase is complete while its exit gate contains an unresolved item.

### 2.3 File paths are responsibilities until the stack is chosen

D-15 records the selected client/backend/staging target. Paths below remain responsibility examples; actual clients are apps/{customer,vendor,partner,admin}-{pwa,app}, with apps/api, apps/worker, database, packages and infrastructure. Public production hosting is still gated.

For example:

| Responsibility | Illustrative path only | What it contains |
|---|---|---|
| Customer client | `apps/customer/` | Customer routes, screens, state, accessibility, and client tests |
| Vendor client | `apps/vendor/` | Vendor onboarding, catalogue, order operations, and client tests |
| Partner client | `apps/partner/` | Availability, assignment, proof, exceptions, earnings, and offline state |
| Admin client | `apps/admin/` | Operational queues, protected actions, reporting, and audit views |
| Backend application | `apps/api/` | HTTP entry point, authentication middleware, modules, commands, and queries |
| Background workers | `apps/worker/` | Outbox, deadlines, notifications, reconciliation, and recovery jobs |
| Shared contracts | `packages/contracts/` | Request/response schemas, event envelopes, enums, and generated client types |
| Shared UI | `packages/ui/` | Accessible design tokens and reusable components without domain decisions |
| Database | `database/` | Migrations, constraints, seeds, and database-owned functions |
| Infrastructure | `infra/` | Environment definitions, deployment, secrets references, networking, and alerts |
| Tests | `tests/` | Cross-module, provider-contract, end-to-end, security, resilience, and performance tests |
| Operations | `docs/runbooks/` | Incident diagnosis, recovery, escalation, and verification procedures |

After D-02 and D-03 are approved, Phase 2 records the actual directory map and all later steps use it consistently.

## 3. Mandatory completion report after every step

After each numbered step, the implementer must explain the work in plain language before moving on. This applies to code, configuration, migrations, tests, documents, assets, and generated files.

### 3.1 Required report format

```markdown
## Step <phase.step> completion report

Status: DONE | DONE_WITH_CONCERNS | BLOCKED
Goal: <what this step was meant to accomplish>
User-visible result: <what a customer/vendor/partner/admin can now do or observe>

### Files created

| File | Why it exists | What the code/file does | Main inputs | Main outputs | Used by |
|---|---|---|---|---|---|
| exact/path/file.ext | reason | plain-language explanation | inputs | outputs | callers/readers |

### Files changed

| File | Previous responsibility | Exact change | Why the change was required | Behaviour affected |
|---|---|---|---|---|
| exact/path/file.ext | before | change | reason | result |

### Files deleted or renamed

| Old path | New path or deletion | Reason | Replacement/migration impact |
|---|---|---|---|

### Code walkthrough

1. `<symbol or section>` receives ...
2. It validates ...
3. It calls/reads/writes ...
4. On success ...
5. On failure, timeout, duplicate, or retry ...
6. It records/logs/emits ...

### Data and state changes

- Tables/fields/indexes/constraints added or changed:
- State transitions introduced or changed:
- Events emitted or consumed:
- Personal or financial data touched:
- Migration and rollback behaviour:

### API and UI changes

- Endpoints/contracts:
- Screens/components:
- Loading/empty/error/stale/offline/accessibility states:
- Authorization rules:

### Verification performed

| Command/test | What it verifies | Result |
|---|---|---|
| exact command | purpose | pass/fail and useful counts |

### Decisions and assumptions

- Approved decisions used:
- Assumptions made:
- Remaining concerns or follow-up:

### How to inspect it

1. Command or route to open.
2. Test account/fixture to use, containing no real credentials.
3. Expected visible result.
4. Known limitations that belong to a later step.
```

### 3.2 Explanation quality rules

- Name every intentional file. Do not say only “backend files were added.”
- Explain each file's responsibility, not merely its extension or framework type.
- For generated files, name the source and generation command. Do not manually explain every generated line.
- Explain important functions, classes, handlers, schemas, migrations, jobs, components, and tests.
- Explain how the new code connects to existing modules.
- State what happens on success and on failure.
- State what data is read, written, cached, logged, or sent externally.
- State the exact verification result. Do not say “tests passed” without naming the commands and relevant test count.
- State explicitly when no files were deleted, no database migration was needed, or no user-visible behaviour changed.
- If the step is blocked, list what was attempted and the exact decision, permission, provider, or evidence required.

## 4. Phase overview

| Phase | Outcome | Primary dependency | Product checkpoint |
|---|---|---|---|
| 0 | Governance and unresolved production decisions are controlled | Existing planning documents | Team knows what may and may not be built |
| 1 | Concierge pilot proves demand and basic economics | D-01 and pilot operations | Evidence supports or rejects full build |
| 2 | Repository and delivery foundation exists | D-02 and D-03 | Safe build/test/deploy loop |
| 3 | Shared platform kernel protects state, events, jobs, and observability | Phase 2 | Modules can be built without inventing infrastructure repeatedly |
| 4 | Identity, sessions, roles, consent, and tenant isolation work | Phase 3 | Every later surface has a secure actor boundary |
| 5 | Vendors can be onboarded, published, and maintain catalogues | Phase 4 | At least one real pilot store is discoverable in test |
| 6 | Customers can select an address, discover stores, and build a grouped cart | Phase 5 | Multi-store cart is correct before money exists |
| 7 | Quotes, inventory holds, prepaid payment, and grouped checkout work | Phase 6 plus D-04/D-05 | One payment creates isolated child orders exactly once |
| 8 | Vendors can accept, pick, resolve changes, and complete pickup | Phase 7 | One-store pickup closes operationally and financially |
| 9 | Delivery partners can accept, carry, deliver, return, and recover offline | Phase 8 plus D-06/D-07 | Platform delivery preserves custody and proof |
| 10 | Ledger, refunds, earnings, settlements, payouts, and reconciliation close | Phases 7–9 | Every unit of money is explainable |
| 11 | Admin support, trust, configuration, incidents, reporting, and audit work | Phases 4–10 plus D-08/D-09 | Operations can control the product without database edits |
| 12 | Security, accessibility, localization, resilience, and performance pass | All launch capabilities | Release candidate satisfies non-functional gates |
| 13 | Controlled pilot launch and production stabilization | D-10 and Phase 12 | Production MVP is ready |
| 14 | Later roadmap features ship one evidence-backed lake at a time | Stable production baseline | Expansion does not weaken launch invariants |

## 5. Phase 0 — Governance and production decisions

### Goal

Turn unresolved business choices into named, testable gates so engineers never encode policy by accident.

### Entry gate

- `prd.md`, `architecture.md`, `design.md`, `workflow.md`, `implementation.md`, `FEATURES.md`, and `rules.md` exist.
- The project owner accepts their authority order.

### Steps

#### 0.1 Establish decision ownership

1. Create a decision register from D-01 through D-10.
2. Assign one accountable owner and due date to each decision.
3. Record which phase and production capability each decision blocks.
4. Define the evidence required to close each decision.
5. Mark assumptions as validation-only, never production defaults.

**Expected file responsibilities:** decision records, owner matrix, and decision templates. Each decision record explains context, options, decision, reasons, consequences, approval date, and superseded decisions.

**Verification:** every D-01–D-10 item has an owner, evidence requirement, status, and blocking phase.

#### 0.2 Select launch neighbourhood and cohort

1. Name the city, two or three candidate pin-code clusters, and operating timezone.
2. Select the first category and 3–10 pilot vendors.
3. Define service hours and support coverage.
4. Record approximately 20–50 fast-moving products per pilot vendor.
5. Document excluded zones and categories.

**Expected file responsibilities:** launch-zone data, pilot-vendor cohort data, and an operations checklist. No production personal data belongs in source control.

**Verification:** the cohort can be represented using synthetic identifiers and has named operational owners.

#### 0.3 Lock client, backend, and hosting direction

1. Verify four separate Next.js PWAs and four separate Expo/React Native Android apps against D-15; do not reopen the approved client count.
2. Select backend framework and supported runtime versions.
3. Select database, cache/job, object-storage, and deployment services.
4. Document local development, staging, production, rollback, and cost expectations.
5. Write architecture decision records for choices and rejected alternatives.

**Expected file responsibilities:** stack ADRs, supported-version policy, and environment topology.

**Verification:** Phase 2 can name concrete commands and directories without an unresolved framework choice.

#### 0.4 Lock providers and financial policy

1. Select OTP, payment, payout, maps, push, SMS, and object-storage providers or approved temporary simulators.
2. Approve fee, earning, tax, rounding, refund, cancellation, settlement, and payout examples.
3. Obtain sandbox credentials through secret management, never checked-in files.
4. Collect provider webhook, statement, retry, timeout, and reconciliation contracts.
5. Keep COD disabled.

**Verification:** provider-neutral interfaces have contract fixtures for success, decline, timeout, malformed response, replay, duplicate, and reconciliation.

#### 0.5 Lock privacy, support, compliance, and recovery policy

1. Approve purpose, viewer, consent, retention, and deletion for each data class.
2. Approve vendor/partner document requirements and expiry effects.
3. Approve support SLAs, roles, approval thresholds, and staffed hours.
4. Approve delivery operating, safety, insurance, and incident ownership.
5. Approve RPO, RTO, backup, restore, and escalation requirements.

### Exit gate

- Every decision required for Phase 2 has an approved record.
- Later unresolved gates are visible and cannot be mistaken for implementation freedom.
- No source code is started under an undefined stack or production policy.

## 6. Phase 1 — Concierge validation pilot

### Goal

Prove that customers will pay to order from a specific local store, vendors can fulfil reliably, and each order can support partner and platform economics before building the full system.

### Steps

#### 1.1 Prepare the manual operating kit

1. Create a safe vendor catalogue template.
2. Create customer-order intake, vendor-confirmation, dispatch, proof, refund, and settlement templates.
3. Define manual identifiers for customer request, vendor order, trip, payment, and case.
4. Define who may view customer address, phone, bank, and payment information.
5. Create incident and end-of-day reconciliation checklists.

**Deliverable explanation:** every template must state who uses it, when, its fields, protected data, and the next handoff.

#### 1.2 Recruit and verify pilot participants

1. Onboard 3–10 vendors from one dense category cluster.
2. Recruit 10–20 known customers within the pilot radius.
3. Recruit one or two delivery partners under the approved operating model.
4. Verify required documents outside source control.
5. Train every actor using the manual workflow.

#### 1.3 Run end-to-end manual orders

1. Customer chooses a named store and products.
2. Show complete item and delivery charges before confirmation.
3. Vendor confirms stock, prepares, and records substitutions or weight.
4. Dispatcher assigns a partner or arranges pickup.
5. Complete handoff with manual proof and case reference.
6. Reconcile customer payment, vendor amount, partner amount, platform amount, refund, and exception.

#### 1.4 Measure results and exceptions

Track fee-visible conversion, vendor response time, preparation time, pickup delay, delivery time, completion, cancellation, refund, support load, partner pay, vendor proceeds, platform contribution, and repeat orders.

#### 1.5 Make the build/no-build decision

1. Compare observed results with agreed thresholds.
2. Identify which assumptions failed and whether operations or product can fix them.
3. Approve, revise, repeat, or stop the software build.
4. Convert observed exception cases into acceptance tests for later phases.

### Exit gate

- Real transactions show enough demand and operational feasibility to justify the build.
- Unit economics are measured, not survey-only.
- The build decision and revised assumptions are documented.

## 7. Phase 2 — Repository and delivery foundation

### Goal

Create the safe development loop that every later phase uses.

### Steps

#### 2.1 Scaffold the approved repository structure

1. Create actual application, package, database, infrastructure, test, and runbook directories.
2. Add workspace/package manifests and lockfiles.
3. Pin supported runtime and package-manager versions.
4. Add root scripts for build, lint, type-check, unit test, integration test, format check, and development startup.
5. Document what every top-level directory owns and may import.

**Expected file explanation:** the completion report must explain every manifest, workspace definition, entry point, configuration file, and generated lockfile.

#### 2.2 Add code-quality and contribution controls

1. Configure formatting, linting, strict type checking, import boundaries, and test conventions.
2. Add pull-request and issue templates if the team will use them.
3. Add secret scanning and dependency/security checks.
4. Add a safe environment example containing placeholders only.
5. Ensure local generated files and secrets are ignored.

#### 2.3 Create application and worker entry points

1. Add minimal client shells for the selected launch sequence.
2. Add backend application bootstrap and dependency wiring.
3. Add worker bootstrap and graceful shutdown.
4. Add liveness and readiness endpoints.
5. Add structured startup logs with environment and version, excluding secrets.

#### 2.4 Establish database migration and seed flow

1. Configure PostgreSQL and PostGIS for local/test environments.
2. Create migration commands and a blank baseline migration.
3. Add transaction-safe migration conventions.
4. Add deterministic synthetic seeds and fixture reset.
5. Prove migration forward, rollback where safe, and rebuild from zero.

#### 2.5 Create CI pipeline

1. Install dependencies from the lockfile.
2. Run format, lint, type, unit, migration, integration, build, and security checks.
3. Publish useful test reports without credentials or personal data.
4. Block merge on mandatory failures.
5. Cache only safe reproducible artifacts.

#### 2.6 Deploy a non-production skeleton

1. Provision isolated staging resources.
2. Inject secrets from the approved secret manager.
3. Deploy clients, API, and worker skeletons.
4. Run health and rollback checks.
5. Record deployment version and environment evidence.

### Exit gate

- A clean checkout can install, migrate, seed, test, build, and start using documented commands.
- CI performs the same gates.
- Staging deploys and rolls back without manual database edits.

## 8. Phase 3 — Shared platform kernel

### Goal

Build the shared technical controls once so domain modules can focus on business behaviour.

### Steps

#### 3.1 Define shared identifiers, money, time, quantities, and errors

1. Implement opaque UUID identifiers and non-secret public references.
2. Implement integer minor-unit money and explicit currency.
3. Implement UTC instants plus vendor timezone context.
4. Implement metres, grams, seconds, and versioned deadlines.
5. Implement stable error codes, localization keys, retryability, request IDs, and field errors.

#### 3.2 Implement request context and correlation

1. Generate or validate request IDs.
2. Attach authenticated actor and trace context.
3. Propagate correlation and causation into commands, events, jobs, and provider calls.
4. Redact protected fields from logs.
5. Return request references safely to clients.

#### 3.3 Implement idempotent command handling

1. Store actor, command scope, idempotency key, canonical request hash, status, and response.
2. Replay the original result for the same key and body.
3. Reject reuse with a different body.
4. Hold uncertain provider outcomes long enough for reconciliation.
5. Test simultaneous duplicate submissions.

#### 3.4 Implement aggregate versioning and transition records

1. Add integer aggregate versions.
2. Require expected versions for conflict-sensitive edits.
3. Validate allowed state, actor, evidence, and reason.
4. Append an attributable transition record.
5. Return stable conflicts without partial mutation.

#### 3.5 Implement transactional outbox and inbox

1. Store business change and outbox event in the same transaction.
2. Poll committed events in bounded batches.
3. Publish or dispatch with retry and backoff.
4. Deduplicate consumer receipts.
5. Expose dead-letter and recovery operations.

#### 3.6 Implement scheduler and job framework

1. Store durable scheduled jobs and ownership.
2. Claim concurrent work safely.
3. Retry idempotently with bounded backoff.
4. Record attempts, error class, next attempt, and terminal failure.
5. Add queue age, throughput, failure, and recovery metrics.

#### 3.7 Implement configuration and feature-flag foundation

1. Add scoped, versioned configuration records.
2. Add draft, validation, approval, schedule, active, superseded, and rollback lifecycle.
3. Add safe flag evaluation by internal user, vendor, category, zone, or cohort.
4. Preserve configuration versions on created business records.
5. Add invalid/overlap constraint tests.

### Exit gate

- A reference module proves request context, transaction, state transition, outbox, worker consumption, idempotency replay, conflict handling, metrics, and audit correlation.

## 9. Phase 4 — Identity, sessions, roles, and privacy boundaries

### Goal

Give every product surface a secure actor identity and enforce access before business modules grow.

### Steps

#### 4.1 Build OTP request and verification

1. Create OTP challenge storage and provider adapter.
2. Add rate, device, phone, attempt, expiry, and replay controls.
3. Store no plaintext OTP in logs or durable general-purpose data.
4. Add synthetic provider fixtures for success, failure, delay, and duplicate callback.
5. Build accessible sign-in states in the first client surface.

#### 4.2 Build sessions and devices

1. Issue secure sessions after successful verification.
2. Rotate, refresh, revoke, and expire sessions.
3. Record safe device metadata and notification-token lifecycle.
4. Implement sign-out for current and approved other sessions.
5. Test stolen, expired, replayed, and cross-account session cases.

#### 4.3 Build roles, capabilities, and memberships

1. Model roles and fine-grained capabilities.
2. Model vendor-location staff membership.
3. Model partner eligibility and active-assignment capability.
4. Model admin scopes and separation of duties.
5. Deny access by default.

#### 4.4 Add authorization enforcement

1. Enforce customer resource ownership.
2. Enforce vendor and location membership.
3. Enforce current assignment for partner detail.
4. Enforce admin capability and scope.
5. Return safe 403/404 behaviour without leaking record existence.

#### 4.5 Add profile, consent, language, and notification preferences

1. Add optional customer profile fields.
2. Add versioned consent records.
3. Add English/Hindi preference.
4. Add channel preferences within required-notification policy.
5. Add retention classification to sensitive identity rows.

#### 4.6 Prove isolation

Run automated tests for cross-customer reads, cross-vendor writes, wrong-location staff, inactive partner assignment, wrong admin role, self-approval, object reference guessing, and redacted logs.

### Exit gate

- Every later module can express its authorization as reusable policy plus domain ownership checks.
- Cross-role isolation and OTP abuse controls are observable and tested.

## 10. Phase 5 — Vendor onboarding, publication, and catalogue

### Goal

Allow operations to approve a real vendor location and allow authorized vendor staff to maintain a customer-visible catalogue.

### Steps

#### 5.1 Build vendor and location domain

1. Create vendor and vendor-location aggregates.
2. Add business profile, timezone, coordinates, category, and lifecycle state.
3. Add hours, holiday, and temporary-closure rules.
4. Add service zones and approved fulfilment modes.
5. Add minimum order and preparation-time settings.

#### 5.2 Build vendor onboarding workflow

1. Support lead, invitation, and application entry.
2. Collect business and payout-profile references.
3. Upload required documents through protected object storage.
4. Show pending, under-review, approved, rejected, expiring, grace, and reverification states.
5. Preserve reviewer evidence, notes, reason, and appeal.

#### 5.3 Build admin vendor pipeline

1. Add role-scoped pipeline list and filters.
2. Add owner, checklist, SLA, and document-review views.
3. Add test-order gate.
4. Add impact-aware publish, pause, unpublish, and restore actions.
5. Audit every decision.

#### 5.4 Build vendor staff and settings

1. Invite owner, manager, and picker roles.
2. Show permission summaries and access-denied states.
3. Build store-profile, hours, closure, zone, minimum, prep-time, and fulfilment settings.
4. Prevent vendors from overriding platform-owned fee policy.
5. Record activity history.

#### 5.5 Build catalogue product management

1. Create product, variant, category, image, price, tax, unit, and availability models.
2. Build add, edit, view, activate, and deactivate flows.
3. Support packaged and variable-weight definitions.
4. Support substitution suggestions.
5. Preserve product/price history needed for later order snapshots.

#### 5.6 Build CSV import

1. Publish an explicit template and version.
2. Upload and scan the file.
3. Parse into staged rows without changing the live catalogue.
4. Show row-level validation and correction.
5. Commit valid rows idempotently and produce an import report.

#### 5.7 Build availability freshness and moderation

1. Record stock status and last-confirmed time.
2. Expose freshness to customer queries.
3. Add cross-vendor moderation queue for restricted or invalid products.
4. Return actionable correction reasons.
5. Test one vendor cannot read or edit another vendor's catalogue.

### Exit gate

- One approved vendor is published and discoverable using synthetic/staging data.
- A second vendor cannot access it.
- Catalogue import, stale availability, moderation, and document expiry paths pass.

## 11. Phase 6 — Customer address, discovery, storefront, and grouped cart

### Goal

Let customers find named eligible stores and build a correct multi-store cart before payment complexity begins.

### Steps

#### 6.1 Build customer address management

1. Add manual search, optional device location, coordinates, pin adjustment, landmark, and instructions.
2. Add create, edit, select, and remove saved addresses.
3. Enforce the configurable default limit of four.
4. Validate serviceability against active zones.
5. Stage-gate address visibility for later fulfilment actors.

#### 6.2 Build eligible store discovery

1. Query active, published, open/next-open, zone-eligible vendor locations.
2. Return category, distance, minimum, supported methods, rating, fee indication, and promise metadata.
3. Add pagination and deterministic ordering.
4. Build loading, empty, denied-location, unavailable-zone, error, and stale states.
5. Record privacy-safe discovery funnel events.

#### 6.3 Build search and filters

1. Normalize product, store, brand, category, Hindi, transliteration, synonym, and common misspelling terms.
2. Rank eligible available results ahead of unavailable results.
3. Add approved filters.
4. Store and delete recent searches safely.
5. Measure zero-result and search-to-cart outcomes.

#### 6.4 Build favourites, preferred store, and shop request

1. Add/remove favourite stores.
2. Set exactly one preferred store per customer where desired.
3. Show eligibility changes without deleting preference.
4. Submit a nearby shop request into the admin/vendor pipeline.
5. Prevent duplicate request spam.

#### 6.5 Build storefront and product browsing

1. Build vendor identity header, images, description, hours, rating, minimum, methods, policies, and offers.
2. Build categories, product search, product cards, and product detail.
3. Show price, unit, availability freshness, variable-weight estimate, and substitution behaviour.
4. Add accessible loading, empty, unavailable, stale, and error states.
5. Prove no cross-vendor catalogue mixing.

#### 6.6 Build vendor-grouped cart

1. Create cart, vendor groups, lines, quantities, and preferences.
2. Adding another store creates a separate group with a clear fee/order explanation.
3. Enforce the configured group limit, default three.
4. Store per-group fulfilment method, notes, substitution preferences, and tip where enabled.
5. Never represent cart items as reserved inventory.

#### 6.7 Build cart validation and recovery

1. Revalidate product publication, price, availability, store state, minimum, method, and address.
2. Isolate stale or invalid lines to the affected group.
3. Preserve valid sibling groups.
4. Provide remove, replace, refresh, change method, or change address actions.
5. Test reconnect and repeated quantity updates.

### Exit gate

- A customer can build and restore a three-store cart.
- A stale line or closed store does not destroy valid sibling groups.
- No UI or API claims cart inventory is reserved.

## 12. Phase 7 — Pricing, inventory holds, payment, and grouped checkout

**Implementation status:** Complete and verified for the approved company-local synthetic environment. Real providers and production data remain gated by D-12 and the production replacement register.

### Goal

Convert a validated grouped cart into isolated vendor orders and one explainable prepaid authorization exactly once.

### Steps

#### 7.1 Implement pricing and policy evaluation

1. Calculate item subtotal, discount, tax, delivery fee, tip, authorization buffer, and final authorization amount in integer minor units.
2. Attach active policy/configuration versions.
3. Produce independent vendor-group calculations plus a combined total.
4. Reject unsupported currency, negative results, overflow, and invalid rounding.
5. Add table-driven policy examples from D-05.

#### 7.2 Implement inventory soft holds

1. Create an expiring hold only during checkout quoting where policy permits.
2. Scope reservations to vendor location and product variant.
3. Prevent over-reservation under concurrency.
4. Release or expire invalid, abandoned, timed-out, or failed groups.
5. Preserve independent sibling reservations.

#### 7.3 Implement quote creation

1. Revalidate every vendor group.
2. Calculate route, fee, promise, minimum, availability, and buffer.
3. Return quoted and blocked groups explicitly.
4. Sign or otherwise bind the quote to customer, cart, address, group content, versions, and expiry.
5. Make quote retry idempotent.

#### 7.4 Implement payment adapter and webhook intake

1. Create provider-neutral authorization, capture, refund, and status interfaces.
2. Verify webhook signature, timestamp/replay, event identity, and payload.
3. Store unique provider receipts.
4. Handle success, decline, timeout, network error, malformed response, duplicate, and late success.
5. Add provider contract tests and statement fixtures.

#### 7.5 Implement checkout transaction

1. Validate authenticated owner, idempotency key, quote integrity, expiry, and current versions.
2. Atomically persist holds, checkout group, child-order drafts, line snapshots, payment attempt, allocations/ledger intents, transitions and outbox before provider calls.
3. Create provider order outside the database transaction; hosted checkout and verified webhook/reconciliation confirm capture before vendor release. Unknown/late success reconciles safely without reviving expired inventory.
4. Return the same result for duplicate submission.
5. Never report failure when the provider outcome is still unknown.

#### 7.6 Build customer checkout UI

1. Show every store group, amount, method, promise, decision rule, and blocked issue.
2. Show combined authorization and buffer explanation.
3. Implement UPI, card, and supported-wallet presentation through the approved provider.
4. Disable COD.
5. Handle processing, provider handoff, pending/unknown, decline, expiry, partial group blockage, success, and reconnect.

#### 7.7 Build group and child-order projections

1. Return overall group summary.
2. Return actor-specific child-order views.
3. Prevent sibling product, support, or financial leakage.
4. Derive group status from children without owning their transitions.
5. Add cursor-based history and request references.

#### 7.8 Prove checkout invariants

Test duplicate taps, last-unit competition, three-store partial failure, expired quote, changed price, closed store, provider timeout then webhook success, webhook replay, allocation totals, rollback, and cross-customer access.

### Exit gate

- One checkout creates one group and exactly one order per valid vendor.
- Duplicate action creates no duplicate payment, order, allocation, hold, event, or notification.
- Invalid or failed groups release only their own resources.

## 13. Phase 8 — Vendor fulfilment, customer decisions, and pickup

**Implementation status:** Complete and verified for the approved company-local synthetic environment. Real capture, ledger posting for authorization deltas, and outbox-driven cross-service orchestration remain gated by Phase 10 and D-12.

### Goal

Complete the first real vertical transaction: customer checkout, vendor preparation, verified customer pickup, and financial closure inputs.

### Steps

#### 8.1 Build vendor alert and response deadline

1. Deliver push/audible alert to authorized devices.
2. Escalate after non-acknowledgement using configured channels.
3. Display server-owned countdown.
4. Auto-timeout the affected child order at deadline.
5. Notify customer and release reservations/allocations correctly.

#### 8.2 Build accept and decline

1. Accept only from valid placed state and before deadline.
2. Commit counted inventory atomically.
3. Store preparation estimate.
4. Preview decline impact and require standardized reason.
5. Preserve sibling orders and complete audit history.

#### 8.3 Build picking workflow

1. Show immutable ordered-line snapshots.
2. Mark found, remove, weigh, or propose substitution.
3. Save safe drafts during reconnect.
4. Prevent unresolved lines from reaching ready.
5. Lock ordinary edits after custody begins.

#### 8.4 Build customer decision requests

1. Create substitution or material weight/price proposal.
2. Notify the customer with old/new item, quantity, amount, reason, and deadline.
3. Accept approve/reject once.
4. Apply configured timeout behaviour.
5. Update authorization/capture or create transparent refund/adjustment path.

#### 8.5 Build package and ready state

1. Require all lines and decisions to resolve.
2. Record package count, condition, and handling needs.
3. Mark ready with server timestamp and applicable pickup/delivery promise.
4. Notify customer or begin delivery assignment.
5. Prevent duplicate ready transitions.

#### 8.6 Build customer pickup

1. Generate time-limited pickup OTP.
2. Validate actor, order, state, attempts, expiry, and replay.
3. Record server-confirmed pickup proof.
4. Complete fulfilment and order once.
5. Trigger capture/ledger/receipt events.

#### 8.7 Build order history, receipt, reorder, rating, and support entry

1. Show completed and failed child orders under their checkout group.
2. Produce itemized vendor-scoped receipt.
3. Recreate a basket with current revalidation.
4. Allow eligible vendor rating/review.
5. Open a structured support case on the smallest affected object.

### Exit gate

- One-store prepaid pickup completes exactly once end to end.
- Vendor timeout, decline, substitution approve/reject/timeout, variable weight, cancellation, OTP failure/replay, support, and refund input paths pass.

## 14. Phase 9 — Delivery partner, custody, delivery, and returns

**Implementation status:** Complete and verified for the approved company-local synthetic environment. Earnings ledger posting and payout batching are now delivered by Phase 10; admin dispute negotiation queues remain Phase 11 work. Real providers remain gated by D-12.

### Goal

Add platform-managed delivery without losing assignment ownership, physical custody, proof, safety, or partner-pay history.

### Steps

#### 9.1 Build partner onboarding and eligibility

1. Collect approved identity, vehicle, bank, insurance, zone, emergency contact, and training data.
2. Review documents with expiry and reverification lifecycle.
3. Show exact online eligibility blockers.
4. Apply capability-specific restrictions.
5. Preserve appeal and active-custody obligations.

#### 9.2 Build availability and offer eligibility

1. Add online/offline and active-zone state.
2. Select eligible partners by zone, vehicle, document, account, capacity, and incident controls.
3. Exclude partners with active work.
4. Record privacy-safe location/presence state.
5. Show daily trips, earnings, online time, and device guidance.

#### 9.3 Build immutable offer attempts

1. Create one offered attempt with expiry.
2. Show expected pay, approximate areas, distance/time, pickup deadline, wait/return policy, and constraints.
3. Accept atomically so only one partner owns the fulfilment.
4. Close decline/expiry attempts without deleting them.
5. Support manual reassignment with reason and compensation history.

#### 9.4 Build active-job navigation and arrival

1. Cache the active assignment and last server-confirmed state.
2. Provide resume-active-job control.
3. Show vendor address plus map and text/landmark fallback.
4. Record trusted arrival or approved fallback.
5. Keep support and emergency controls available.

#### 9.5 Build waiting and pickup proof

1. Start server wait timer at valid arrival.
2. Show thresholds, compensation, revised estimate, wait/leave/reassign/support choices.
3. Validate QR/OTP and vendor/order/assignment.
4. Agree package count, condition, and handling.
5. Begin custody only after server confirmation.

#### 9.6 Build customer delivery

1. Reveal exact customer address only after custody.
2. Provide masked contact and navigation fallback.
3. Record arrival.
4. Validate delivery OTP or approved alternative proof.
5. Complete custody, fulfilment, order, and earning trigger exactly once.

#### 9.7 Build offline proof recovery

1. Encrypt locally saved proof and bind it to the active assignment.
2. Display pending synchronization, never false success.
3. Retry idempotently after reconnect.
4. Block new work until server confirmation or support resolution.
5. Remove local sensitive proof after verified synchronization or approved expiry.

#### 9.8 Build guided exceptions and safety

1. Add vendor delay, missing/damaged package, unreachable customer, wrong address, unsafe location, accident, medical emergency, threat, vehicle failure, and prohibited-goods paths.
2. End each path in a named retry, continue, return, cancel, reassign, or support state.
3. Record evidence and current instruction.
4. Avoid automatic guilt from one integrity signal.
5. Keep emergency handling separate from generic support.

#### 9.9 Build return to origin

1. Authorize return and destination.
2. Preserve custody while returning.
3. Handle vendor closed/refusal and alternate safe point.
4. Record recipient, counts, condition, and proof.
5. Close custody separately from refund, settlement, earning, and dispute.

#### 9.10 Build earnings and disputes UI

1. Show trip base, distance/time, wait, return, incentive, tip, adjustment, and net.
2. Show daily/weekly rollups and payout status.
3. Export statements.
4. Open a dispute on an exact line.
5. Show original/new amount, evidence, owner, deadline, and outcome.

### Exit gate

- Offer expiry/reassignment, one active assignment, waiting, pickup, delivery, offline proof, post-pickup cancellation, return, safety, and earning-dispute scenarios pass.
- Customer detail is exposed only during the permitted custody stage.

## 15. Phase 10 — Complete money lifecycle and reconciliation

**Implementation status:** Complete and verified for the approved company-local synthetic environment. Thirty migrations pass full rollback/forward rehearsal and 22 connected money scenarios. Provider calls and statements remain synthetic; production credentials, real payment/payout providers, tax policy, and external bank settlement are explicitly gated by D-12.

### Goal

Make every customer, vendor, partner, platform, tax, refund, settlement, and payout amount traceable and balanced.

### Steps

#### 10.1 Build ledger accounts and posting engine

1. Define account types and ownership.
2. Post immutable debit/credit entries under one transaction ID.
3. Enforce zero sum per currency before commit.
4. Store business, provider, policy, and correlation references.
5. Reject direct edits and unbalanced visibility.

#### 10.2 Build authorization, capture, void, and refund lifecycle

1. Map provider attempts to internal transactions.
2. Capture only permitted completed/accepted amounts.
3. Void unused authorization where supported.
4. Allocate partial/full refund to exact child orders and lines.
5. Handle unknown, late, duplicated, and failed outcomes through reconciliation.

#### 10.3 Build vendor fees and settlements

1. Calculate approved platform/payment/tax rules from preserved versions.
2. Avoid normal completed-order fee on failed, platform-cancelled, or fully refunded orders under policy.
3. Create settlement lines and batches.
4. Submit payout safely.
5. Show vendor statement and dispute path.

#### 10.4 Build partner earnings and payouts

1. Post base, distance/time, waiting, return, incentive, tip, and adjustment entries.
2. Preserve earning effects across reassignment and return.
3. Create payout batches and provider items.
4. Handle bank failure and duplicate-risk safely.
5. Show partner statement and line dispute.

#### 10.5 Build provider-statement reconciliation

1. Import or retrieve provider statements idempotently.
2. Match expected and actual transactions.
3. Classify unmatched, duplicated, amount mismatch, status mismatch, and missing cases.
4. Retry only safe operations.
5. Route the remainder to owned finance queues.

#### 10.6 Build financial correction workflow

1. Preview amount and participant impact.
2. Require reason and evidence.
3. Require maker-checker approval above policy threshold.
4. Correct through reversal and adjustment entries.
5. Preserve original and correction history.

#### 10.7 Prove money conservation

Use unit/property, integration, concurrency, provider-contract, and end-to-end tests covering partial vendor failure, substitution, weight change, timeout, duplicate webhook, refund, waiting, return, dispute, payout failure, reversal, and statement mismatch.

### Exit gate

- Every test scenario conserves money and balances per currency.
- Provider statements reconcile or create an owned, visible exception.
- No interface can edit or force-balance history.

## 16. Phase 11 — Admin control plane, support, trust, configuration, and reporting

**Implementation status:** Complete and verified for the approved company-local synthetic environment. The control plane operates only on synthetic records; production operational authority, provider credentials, and personal data remain gated by D-12.

### Goal

Allow authorized operations teams to run and recover the marketplace without direct database edits.

### Steps

#### 11.1 Build role-scoped admin dashboard

1. Rank safety/security, ledger, live-order, compliance, and routine work consistently.
2. Show severity, owner, SLA, age, object, custody/amount risk, and next action.
3. Filter rows by capability without changing severity meaning.
4. Provide safe access-denied states.
5. Trace every view/action through request and audit references.

#### 11.2 Build live order monitor and intervention

1. Filter checkout groups and child orders by state, vendor, fulfilment, exception, and time-in-state.
2. Expand groups while preserving sibling isolation.
3. Show transition, payment, ledger, assignment, custody, case, and notification timelines.
4. Preview cancel, refund, reassign, return, and communication impact.
5. Require confirmation, reason, capability, and approval where configured.

#### 11.3 Build support case lifecycle

1. Create or deduplicate structured cases.
2. Attach to the smallest affected object.
3. Assign owner/team and response deadline.
4. Separate internal notes and participant-visible messages.
5. Support evidence, response request, resolution, merge, reopen, escalation, and quality review.

#### 11.4 Build trust and safety review

1. Collect signals without automatic irreversible action.
2. Show linked authorized objects and evidence quality.
3. Propose scoped, time-bounded restriction.
4. Protect active orders and custody.
5. Record reviewer, reason, policy, review date, outcome, and appeal.

#### 11.5 Build finance queues

Create owned queues for authorization without checkout, payment unknown, capture/allocation mismatch, webhook duplication, refund failure, unbalanced ledger, vendor settlement mismatch, partner earning mismatch, payout failure/duplicate risk, statement unmatched, and disputes.

Each row must show expected/actual values, provider and business references, risk, age, last retry, next safe action, correction proposal, approval, evidence, and history.

#### 11.6 Build configuration approval and publication

1. Edit zones, fees, commissions, earnings, timers, limits, and operational rules as drafts.
2. Validate examples and affected-scope preview.
3. Require different proposer/approver for protected changes.
4. Schedule activation.
5. Roll back through a new version.

#### 11.7 Build incident controls

1. Pause scoped vendor, category, zone, platform delivery, partner assignment, payment method/provider, promotion, substitution, grouped checkout, or payout.
2. Show affected new flows and obligations that must continue.
3. Require owner, reason, expiry/review, and approval where necessary.
4. Display status banners and recovery checklist.
5. Prove rollback does not cancel orders, lose custody, or rewrite money.

#### 11.8 Build reporting and exports

1. Add customer funnel, marketplace, vendor health, delivery operations, finance, support, and risk reports.
2. Enforce role and scope.
3. Label metric definitions and freshness.
4. Produce protected expiring exports.
5. Record exporter, filters, time, classification, and access.

#### 11.9 Build searchable audit interface

1. Search actor, action, target, reason, time, request, and approval reference.
2. Show before/after safely.
3. Enforce read-only behaviour.
4. Protect sensitive evidence and financial fields by capability.
5. Test an admin cannot erase their own action.

### Exit gate

- Operations can resolve launch scenarios through controlled product actions.
- Maker-checker, sibling isolation, reversal-only money correction, audit immutability, and incident rollback pass.

## 17. Phase 12 — Security, accessibility, localization, resilience, and performance

**Implementation status:** Complete for the requirements a company-local synthetic environment can genuinely prove — English/Hindi localization (12.3) with CI missing-translation gate, cross-role capability probe (12.1), and outbox transient-retry drill (12.5). Accessibility review (12.2), low-end device / poor network testing (12.4), full performance and concurrency measurement (12.6), and stakeholder gate signatures (12.7) are documented as deferred with named owners in `docs/engineering/launch-readiness-and-localization.md`; they require infrastructure or people outside D-12 scope and must clear before Phase 13.

### Goal

Prove the complete launch system works safely for real people, devices, networks, providers, and operational failures.

### Steps

#### 12.1 Run security and privacy review

1. Threat-model identity, checkout, payment, assignment, proof, admin, uploads, webhooks, and exports.
2. Test object-level authorization and role escalation.
3. Test OTP/session abuse, request replay, proof replay, webhook forgery, upload abuse, and provider impersonation.
4. Verify encryption, secrets, log/event redaction, retention, deletion, and least-data views.
5. Resolve all launch-blocking findings and rerun tests.

#### 12.2 Complete accessibility review

1. Test keyboard order, focus, dialogs, forms, errors, status, tables, proof, and time limits.
2. Test screen-reader names, structure, announcements, and live updates.
3. Test 200% zoom and 360 px reflow.
4. Test non-colour status, contrast, touch targets, and reduced motion.
5. Test map alternatives and accessible deadline support.

#### 12.3 Complete English/Hindi localization

1. Extract user-visible strings.
2. Translate critical tasks, errors, reasons, notifications, receipts, and support content.
3. Preserve stable server codes and localize labels only.
4. Test expansion, plural, currency, time, address, and mixed-script search.
5. Add missing-translation detection to CI.

#### 12.4 Test low-end devices and poor networks

1. Test supported low-end Android/browser devices.
2. Simulate slow, intermittent, offline, reconnect, background, and clock-skew conditions.
3. Verify active order/job restoration and draft recovery.
4. Verify no false pickup, delivery, payment, or refund success.
5. Measure bundle, memory, battery, data, and interaction latency.

#### 12.5 Run resilience drills

1. Stop or delay OTP, payment, payout, maps, push, SMS, object storage, database replica, cache, and worker dependencies as applicable.
2. Exercise outbox retry and dead-letter recovery.
3. Exercise payment-unknown and statement reconciliation.
4. Exercise incident controls and safe continuation of custody.
5. Restore backups and prove RPO/RTO.

#### 12.6 Run performance and concurrency tests

1. Load eligible-store discovery and search.
2. Load three-store quote and checkout.
3. Race inventory reservations and partner assignments.
4. Burst vendor alerts, partner offers, deadlines, notifications, and webhooks.
5. Measure p50/p95/p99 latency, throughput, errors, queue age, locks, and resource saturation.

#### 12.7 Complete operational readiness

1. Assign every dashboard, alert, queue, and runbook owner.
2. Confirm support and incident rotations.
3. Rehearse high-risk runbooks with synthetic data.
4. Confirm rollback owner and command for every deployable component.
5. Sign security/privacy, accessibility, operations, finance, and support gates.

### Exit gate

- All mandatory end-to-end scenarios in `implementation.md` pass.
- No unresolved launch-blocking security, privacy, accessibility, financial, data-loss, or custody finding remains.
- Recovery and rollback evidence satisfies D-10.

## 18. Phase 13 — Controlled launch and stabilization

### Goal

Release the production MVP gradually, observe real behaviour, and stabilize it before expanding scope.

### Steps

#### 13.1 Prepare production

1. Provision production with isolated credentials and least-privilege access.
2. Apply migrations using the rehearsed procedure.
3. Verify configuration versions, provider webhooks, zones, vendors, partner eligibility, fees, support hours, and incident controls.
4. Run production smoke tests with approved synthetic or internal accounts.
5. Confirm rollback and emergency owners are present.

#### 13.2 Launch internally

1. Enable staff/test cohort only.
2. Complete pickup, vendor-delivery if enabled, and platform-delivery flows.
3. Reconcile payment, refund, settlement, earning, and payout.
4. Review logs, traces, alerts, audit, and personal-data exposure.
5. Fix launch blockers before vendor/customer expansion.

#### 13.3 Launch the pilot cohort

1. Enable named pilot vendors and zone.
2. Invite the controlled customer group.
3. Limit order/store/delivery volume to staffed capacity.
4. Monitor every order through financial closure.
5. Hold daily operations, finance, support, and product review.

#### 13.4 Expand gradually

1. Expand by vendor, zone, category, fulfilment mode, and customer cohort separately.
2. Compare business and technical thresholds after each expansion.
3. Stop or roll back a scoped expansion when thresholds fail.
4. Preserve valid orders and financial history.
5. Record the evidence behind each expansion decision.

#### 13.5 Declare production MVP ready

Confirm all twelve readiness conditions in `FEATURES.md` §17, all applicable production gates, and all enabled Launch features.

### Exit gate

- The production MVP operates through the agreed stabilization window.
- Order, fulfilment, support, ledger, settlement, payout, and reconciliation are dependable at approved volume.
- Named owners accept normal operations.

## 19. Phase 14 — Post-launch roadmap

### Goal

Add later features without weakening the proven vendor-order, custody, money, privacy, or operational model.

### Execution rule

Each later feature becomes its own mini-program and repeats discovery, decision gates, architecture, design, implementation, tests, rollout, completion reports, and stabilization. Do not implement all later features as one phase-sized change.

### Ordered capability groups

#### 14.1 Customer retention

- Loyalty rewards
- Recurring baskets
- Shared shopping lists
- Richer reorder and preferred-store experiences

Before release, define refund, expiry, accounting, consent, household authorization, edit conflict, and checkout-ownership rules.

#### 14.2 Delivery intelligence

- Customer live delivery map
- Batch assignment
- Automated route optimization
- Cross-store route consolidation

Before release, prove privacy, partner choice, battery/data use, package separation, custody, pickup reliability, ETA, fee allocation, waiting, return, and exception handling.

#### 14.3 Vendor integrations and growth

- POS/inventory connectors
- Richer vendor marketing
- Vendor advertising

Before release, define sync-conflict ownership, freshness, idempotency, support, consent, frequency, sponsored disclosure, ranking fairness, billing, refunds, moderation, and reporting.

#### 14.4 Marketplace expansion

- Additional store categories
- B2B ordering
- Wider service zones and cities

Before release, validate category compliance, catalogue differences, tax/invoice rules, payment/credit, quantity, fulfilment, support, supply density, and unit economics.

#### 14.5 Pharmacy, only through the gated program

Pharmacy remains unavailable until legal approval, licence verification, prescription controls, pharmacist review, restricted catalogue rules, no automatic prescription substitution, protected health-data storage/access/retention, safe delivery disclosure, and audit requirements pass.

## 20. Phase and step status tracking

Use these states consistently:

| State | Meaning |
|---|---|
| `NOT_STARTED` | Entry work has not begun. |
| `BLOCKED` | A named decision, dependency, permission, provider, or failed gate prevents progress. |
| `IN_PROGRESS` | One or more steps are actively being implemented. |
| `VERIFYING` | Implementation is complete but tests, review, or evidence remain. |
| `DONE_WITH_CONCERNS` | Accepted for now with explicitly owned, non-gating concerns. |
| `DONE` | All exit criteria and the completion report are satisfied. |

Recommended tracker:

```markdown
| Phase.step | Status | Owner | Started | Completed | Evidence | Blocker/concern |
|---|---|---|---|---|---|---|
| 2.1 | NOT_STARTED | | | | | |
```

Status is evidence-based. A verbal claim, merged pull request, deployed screen, or passing happy-path test alone does not make a step `DONE`.

## 21. Definition of done for every implementation step

A step is done only when all applicable statements are true:

1. The step's user or operator outcome works.
2. The implementation follows the authoritative state, ownership, policy, and privacy contracts.
3. Required schema migrations, constraints, indexes, and rollback/forward strategy exist.
4. API and event contracts include validation, authorization, idempotency, errors, and versions.
5. UI includes loading, empty, error, stale, offline/reconnect, success, and accessibility behaviour.
6. Background jobs include ownership, retry, backoff, deduplication, dead-letter, and recovery behaviour.
7. Unit, property, integration, contract, API, UI, end-to-end, security, resilience, or performance tests pass as applicable.
8. Logs, metrics, traces, alerts, and audit events allow the team to understand failure without exposing protected data.
9. Documentation and runbooks match the implemented behaviour.
10. The diff contains no unrelated or accidental changes.
11. The mandatory completion report explains every created, changed, deleted, renamed, and generated file.
12. The project owner can inspect the result using the supplied commands or routes.

## 22. First implementation starting point

Do not begin by scaffolding the entire four-surface product. Start with Phase 0 and Phase 1. After the build decision, execute Phase 2 and then construct the first walking transaction in dependency order:

1. Foundation and shared kernel.
2. Identity and authorization.
3. One approved vendor and small catalogue.
4. Customer address, one-store discovery, and cart.
5. Prepaid sandbox quote and checkout.
6. Vendor accept, pick, ready, and customer pickup OTP.
7. Minimal balanced ledger, receipt, reconciliation, support, and admin visibility.

Then expand the same verified model to multi-store checkout, delivery-partner custody, returns, full settlement/payout, and the complete operations control plane. This preserves the full product plan while producing testable end-to-end value early.

## 23. September 2026 reconciliation and sequential audit

UI implementation follows the [connected UI/UX plan](docs/engineering/ui-ux-workflow-implementation-plan.md). Its UX slices map to these canonical phases; they do not replace phase numbers or completion gates. Each applicable feature requires independently verified PWA and Android behavior and cross-role handoffs.

[D-15](docs/decisions/D-15.md) is the approved staging implementation delta. [Phase conformance audit](docs/engineering/phase-conformance-audit.md) records evidence; this roadmap never grants completion by itself.

| Phase | Additional/revised acceptance obligation |
|---|---|
| 0 | Reconcile D-01–D-15, distinguish historical approvals, configured services and unproven production gates. |
| 1 | Preserve NOT_OBSERVED business metrics; synthetic desk runs never count as real pilot validation. |
| 2 | Eight clients, customer Workers/OpenNext BFF, separate Supabase migration/runtime users, verify-full staging session pooler; executed CI/deployment evidence. |
| 3 | Fail-closed environment/provider rules; active outbox/BullMQ, health, deadlines, idempotency and redacted observability in real workflows. |
| 4 | MSG91 test-recipient controls, cookie BFF/CSRF, Android SecureStore, rotation/revocation, account recovery/phone change/export/deletion and secure admin invitations. |
| 5 | Persisted onboarding/catalogue/CSV clients, internal publication test path, scanned media, public/private storage separation and reliable publication gates. |
| 6 | Manual/geocoded address CRUD/serviceability, dedicated routes on both clients, API-driven discovery, deterministic guest-cart merge and current availability. |
| 7 | Durable drafts before provider calls; Razorpay Test Mode, signed webhooks, confirmed capture before vendor release, late-payment/expired-hold recovery and zero oversell/duplicate charge. |
| 8 | Customer-approved weight cap and explicit top-up/refusal, substitution decisions, deadlines and OTP-only pickup proof. |
| 9 | Custody-gated exact address, assignment isolation, delivery OTP, returns and offline recovery; no moving customer map or masked-call launch dependency. |
| 10 | Child-scoped refunds, balanced append-only ledger, receipt revisions, payout eligibility/provider gate and reconciliation. |
| 11 | Participant-message/evidence privacy, internal-note isolation, scoped interventions, notifications/deep links and audit. |
| 12 | Behavioral PWA/Android, database/queue, provider, accessibility, security, failure and load gates; D-15 performance targets measured, not asserted. |
| 13–14 | Recheck actual phase exit gates and production ownership; this update grants no public deployment. |

Audit statuses: NOT_REVIEWED, PARTIAL, VERIFIED_LOCAL, VERIFIED_STAGING, BLOCKED. A source-text test or rendered screen is not an end-to-end test. Each numbered step records evidence, gaps, owner/dependency and next verification. Preserve canonical numbering: 5.6 is CSV import; finance belongs to Phase 10.

Current re-audit: Phase 0 PARTIAL; Phase 1 market validation unmet; Phase 2 preliminary controls only. Phases 3 onward NOT_REVIEWED in this re-audit.

Run 2 (6 September 2026) re-audited Phase 0.3/0.4 against the runtime loaders instead of the documents and corrected two defects: committed synthetic secret material was reachable by every deployed environment (including an `online-test` compose file that injected none of it), and the deployment control still demanded a static export from the customer PWA after D-15 moved it to a Workers/OpenNext BFF. Both are fixed and covered by regression tests; `pnpm lint` passes for the first time in this working tree. The approved OTP, payment, maps, push and storage adapters remain unimplemented, so every non-local environment must now declare itself synthetic to start at all. Detail and commands: [phase conformance audit](docs/engineering/phase-conformance-audit.md).

Run 3 (6 September 2026) executed `pnpm db:verify` — the PostgreSQL/PostGIS gate CI depends on — and found it **red, and red before any change in this session**: a vendor-name assertion still demanded a synthetic prefix that migration 0062 had removed, and migration 0062 itself could not be re-applied after its own rollback, breaking the rebuild-from-zero proof that step 2.4 requires. Both are fixed; the ladder now passes with 64 migrations, 27 verifier modules and 298 scenarios. Every capability in the feature matrix now carries `phase_steps`, and the control fails if any of the **101** canonical steps has no capability mapped to it or if a capability names a step that does not exist.

Runs 4–6 (6 September 2026) tied every capability to an executable verifier, built Android test infrastructure for all four shells, and implemented the approved Supabase Storage adapter. Along the way: 141 client evidence claims turned out to have no verifier behind them and are now recorded as `unverified`; three of four Android shells kept credentials in memory only despite D-15 requiring SecureStore, and the dependency they claimed to be waiting on was already installed; and durable jobs were scheduled against the application clock but claimed against the database clock, which made the mandatory `pnpm db:verify` gate fail intermittently. Detail and commands: [phase conformance audit](docs/engineering/phase-conformance-audit.md).

Step 2.1 is **VERIFIED_LOCAL** as of run 7 (6 September 2026). Two defects were corrected: the Node and pnpm pins were advisory — `pnpm install` warned and exited 0 on a mismatched runtime — and the top-level ownership map had stopped describing the repository (two shared packages undocumented, two directories with no README, `tests/` claiming the Playwright journeys that live in `e2e/`, and `infrastructure/` repeating a superseded D-12 restriction and calling Valkey later work while compose provisions it). `tooling/scripts/check-directory-ownership.mjs` now enforces the map in `pnpm lint`.

Step 2.2 is **VERIFIED_LOCAL** as of run 8 (6 September 2026). The secret scanner matched AWS, GitHub, Stripe, Google and npm credentials — none of which this project uses — and missed the Supabase service-role JWT, inline connection-string passwords and Razorpay keys that it does. Patterns for those were added, and the first run caught two committed test fixtures of our own. The strict-type overrides were tested rather than trusted (all four are needed; the comment explaining them was wrong), and the dependency-audit exception was re-verified against the registry instead of inherited.

Step 2.3 is **VERIFIED_LOCAL** as of run 9 (6 September 2026). Beyond the readiness defect closed in run 2, the worker was found to abandon in-flight jobs after a hard-coded 4s while its container allows a 30s stop grace, wasting 26s of drain time the orchestrator had granted; the grace is now configurable, still 4s locally so watch-mode restarts stay fast, and 25s in the deployment. Startup logs were checked for secret leakage with canary values rather than by reading: both processes are clean.

Step 2.4 is **VERIFIED_LOCAL** as of run 10 (6 September 2026). The migration and rollback proof turned out to be thorough — it reverts through every migration to the baseline and re-applies them, which is why it caught 0062 — and the seed is deterministic across repeated runs with a genuinely derived hash. The defect was on the documented path: `pnpm db:seed` seeds only a fixture-determinism schema and never touches `marketplace`, so the documented local setup left a developer with eight correct, entirely empty screens. `db:seed:marketplace` and `db:seed:admin` are now part of the documented sequence.

Step 2.5 is **PARTIAL** as of run 11 (6 September 2026). The pipeline has never run on this work: 11 commits are unpushed with 441 uncommitted files on top, so no CI evidence exists for any of it. Configuration was audited locally and one real defect corrected — the local `check` aggregate and CI enforced different sets, with `build:online-test:pwas` running only locally and `db:verify`/`security:dependencies` only in CI. Both now enforce the same set, and `verify-ci-workflow.mjs` derives its requirement from `check` so they cannot drift apart again. Two gates remain outstanding: an executed CI run, and confirmation that branch protection requires the job before merge.

Step 2.6 is **BLOCKED** as of run 12 (6 September 2026): nothing is provisioned or deployed, and that needs owner approval and a spending decision. Auditing the artifacts a deployment would use found three defects, all corrected. The container build would have carried `infrastructure/supabase-*/.env` — live Supabase service-role keys and pooler passwords — into the builder layer, because `.containerignore` wrote `.env` where it needed `**/.env`; proven with a probe build and re-proven after the fix. The deployment inventory still named Cloudflare R2 and Cloudflare Pages, both superseded by D-15's Supabase Storage and the customer PWA's move to Workers/OpenNext. And the runbook was paused waiting for a superseding decision that D-15 already provides — its banner now names D-15 while keeping execution unauthorized, since approval is not activation.

**Phase 2 exit gate remains open.** Steps 2.1–2.4 are VERIFIED_LOCAL; 2.5 and 2.6 are blocked on a push, branch protection and provisioning approval. Step 3.1 is **VERIFIED_LOCAL** as of run 13 (6 September 2026). Three defects were corrected: the exported `roundHalfUp` was wrong for negative amounts by a whole unit and now refuses them, since how a refund rounds is an owner decision; `createIanaTimeZone` accepted a fixed UTC offset because ECMA-402 does, which would have computed vendor opening hours wrongly for half the year in any DST zone; and all eleven stable error codes pointed at localization keys that were never registered, so every error response carried a key no bundle could resolve, while all 324 other keys had both languages. Identifiers, money and quantities were measured rather than read and hold up.

Step 3.2 is **VERIFIED_LOCAL** as of run 14 (7 September 2026). Log redaction — the single gate every log line passes through — missed camelCase entirely, so `phoneNumber`, `otpCode` and `accessToken` were written in full while their snake_case spellings were redacted, and it covered none of this marketplace's own identifiers: UPI, IFSC, account number, Aadhaar, PAN, `mobile`, or the short `lat`/`lng` forms. Both fixed, and verified in both directions so the logs stay legible. Two field-error localization keys were unregistered for the same reason as yesterday's eleven, and are now a declared constant the verifier can enumerate. Request-id handling, trace context and correlation propagation were exercised against a running API and hold up.

Step 3.3 is **VERIFIED_LOCAL** as of run 15 (7 September 2026) and was the best-built step audited so far: canonical hashing, replay, reuse rejection, actor/scope isolation on both the write and read paths, and a genuine concurrency test all hold up under measurement. One defect: a command abandoned mid-flight had its reconciliation due date set from the seven-day retention constant, so a crashed payment authorization would have been invisible to a reconciliation sweep for a week. The constants are now separate, and the abandoned-lease path — previously untested — has a mutation-tested regression check. No sweep consumes `reconciliation_due_at` yet; that worker belongs to phase 10.5 / ENG-15.

Step 3.4 is **VERIFIED_LOCAL** as of run 16 (7 September 2026) and is the strongest step audited so far: version conflicts, policy validation, attributable history, real concurrency, and rollback of the caller's own writes through the shared transaction client are all genuinely asserted. One gap: the append-only guard on transition history fires on both UPDATE and DELETE, but only UPDATE was tested, so narrowing the trigger would have passed the suite while letting an actor erase the record of what they did. The deletion case is now asserted and mutation-tested.

Step 3.5 is **VERIFIED_LOCAL** as of run 17 (7 September 2026). The outbox side was already the best-covered module in the repository. The inbox guard beside it — which permits exactly one transition with every identity field unchanged, and whose narrowness is what makes deduplication hold — had no assertion at all; an update free to repoint a receipt at another event would defeat deduplication rather than merely corrupt an audit row. It is now asserted and mutation-tested, after two of the new assertions turned out to pass for the wrong reasons and had to be corrected.

Step 3.6 is **VERIFIED_LOCAL** as of run 18 (7 September 2026). Following a lead from step 2.4, two of the four append-only guards were found to refuse writes with an internal PL/pgSQL field-resolution error (`42703`) instead of the documented `55000`: two shared trigger functions read columns belonging only to the first of the two tables they guard. Nothing was permitted that should have been refused — the write still failed — but the contract the other verifiers check was broken, and three assertions used a bare `catch` that accepted any error, which is why it survived. Migration 0066 fixes both functions, all four tables now refuse with the intended code, and the assertions were tightened and proven by reverting the fix.

Step 3.7 is **VERIFIED_LOCAL** as of run 19 (7 September 2026) and was the best-covered step in Phase 3: lifecycle, self-approval refusal, scope precedence, overlap constraints and business-record version pinning all have real assertions, and flag evaluation fails safe. Its two bare-catch assertions were tightened and proven by changing a guard's error code without changing its behaviour.

**Phase 3 exit gate is met.** Steps 3.1–3.7 are VERIFIED_LOCAL and `verify-reference-module.ts` proves the full walking path — request context, transaction, state transition, outbox, worker consumption, idempotency replay, conflict handling, metrics and audit correlation — on every `pnpm db:verify`. "Local" means this machine: Phase 2's CI and staging gates remain open, so none of it has been observed elsewhere.

A repository-wide sweep found 17 bare `} catch {` assertions in the connected verifiers. Those in phases 3.6 and 3.7 are fixed; the rest are recorded against their own phases (money-lifecycle in 10, assignment-custody in 9, inventory in 7) because each needs its own judgement about whether the specific error matters.

Step 4.1 is **VERIFIED_LOCAL** as of run 20 (7 September 2026). Storage was already sound — the challenge holds only hashes of the code and the phone — and the untested half of "no plaintext OTP in logs" was proven by canary: a real request generated a six-digit code and neither it nor the phone appears in 326 captured log lines. One finding: sign-in routed failures through the same polite live region as progress, so a screen reader could queue or miss "that code was wrong" — which costs a bounded attempt and can lock the account out. Failures now announce assertively. Its regression test reads source rather than rendering, which is the same client-testing gap recorded in run 5.

Step 4.2 is **VERIFIED_LOCAL** as of run 21 (7 September 2026), with no defect found in the implementation: rotation, revocation, expiry, device and notification-token lifecycle, and the stolen, expired, replayed and cross-account cases were all already asserted. One strengthening: replay revocation was proven by watching the rotated access token die, which also passes if only that token is invalidated, so it now asserts the reason is recorded and that no refresh token in the family survives — the newer token surviving would leave a thief holding the session. Mutation-tested by disabling family revocation alone, which every pre-existing assertion still passed.

Step 4.3 is **VERIFIED_LOCAL** as of run 22 (7 September 2026) with **no defect found and no files changed** — the first step to need no correction. Deny-by-default is asserted 15 times and demands the denial carry `DENY_BY_DEFAULT` as its reason rather than merely being false; separation of duties is enforced by a trigger that matches conflicting pairs in either order and only across overlapping validity windows, confirmed live. Two findings of mine were wrong and withdrawn: searching for domain wording and SQLSTATE literals missed tests written through shared helpers. Read a verifier's helpers before searching it.

Step 4.4 is **VERIFIED_LOCAL** as of run 23 (7 September 2026). Requirement 5 was proven end to end rather than only in unit tests: a customer owning nothing asked for another user's real address and for a nonexistent one, and both returned 404 with byte-identical bodies, so existence cannot be inferred. One finding: the unprotected-route allowlist exempted `CatalogueProductsController.map`, described as a public endpoint but actually a private error translator — a dead entry that reserved the name, so a future real route called `map` would have been silently unprotected and the test meant to catch that would have stayed green. Removed, with a new control requiring every exemption to name a route that exists. The customer BFF's cookie and CSRF handling is sound; whether `Secure` survives a TLS-terminating proxy is recorded for when step 2.6 unblocks.

Step 4.5 is **VERIFIED_LOCAL** as of run 24 (7 September 2026). Profile, consent versioning, language and channel preferences are all soundly enforced — a marketing preference cannot be enabled while consent is withdrawn, so preference is gated on consent rather than recorded beside it. One defect: the retention-classification assertion counted rows where the column `IS NULL` on columns declared `NOT NULL`, so it could not fail and had proved nothing for four phases. My first fix widened its scope and was equally vacuous; the mutation probe caught that. It now asserts the schema declaration — both columns present and NOT NULL on every classifying table — which fails when a column is made nullable. No consumer reads `retention_class` yet; SEC-11's retention engine remains outstanding.

Step 4.6 is **VERIFIED_LOCAL** as of run 25 (7 September 2026). All eight named isolation cases are genuinely proven — fifteen labelled denials, each requiring the reason be `DENY_BY_DEFAULT` — and the isolation proof document's claims check out, including its count of sixteen opaque guesses. One finding against the exit gate's word *observable*: denials were tested but invisible. The interceptor logs method and route on the success path only, and every denial is a thrown exception, so a concealed 404 for someone enumerating another customer's records was logged identically to a dead link on every route. The failure path now records the route pattern — the parameter name, never its value, verified end to end.

**Phase 4 exit gate is met.** Steps 4.1–4.6 are VERIFIED_LOCAL: authorization is expressed as a capability plus ownership evidence against a default-deny evaluator, with a control that fails when a route appears without one, and both OTP abuse controls and isolation denials are now observable. Local still means this machine; Phase 2's CI and staging gates remain open.

Step 5.1 is **VERIFIED_LOCAL** as of run 26 (7 September 2026). All five requirements were already covered by fourteen assertions. The finding was systemic and deferred from run 13: every user-visible name field rejected Hindi, because `\p{L}` matches Devanagari consonants but not the vowel signs that spell most Hindi words. `शर्मा किराना` was refused while the database — length-only since migration 0062 — would have accepted it. Eight patterns shared the defect, covering vendor and location names, product titles, inventory display names, address labels, discovery store names, delivery areas and the dispatch sanitizer. All eight now permit combining marks in the continuation class only, so bidi and format controls stay excluded; verified in both directions and mutation-tested. MKT-11 is a Launch capability and the launch city is Jaipur, so this blocked real vendors.

Step 5.2 is **VERIFIED_LOCAL** as of run 27 (7 September 2026). All five requirements were covered by 26 assertions, including that approval both creates the draft aggregates and grants `VENDOR_OWNER`. The finding was against D-15's "expiring one-use invitation": one-use was enforced, expiry was not. Because the applicant is optional — inviting a vendor before they sign up is the ordinary case — the admin-chosen reference was the sole credential and stayed claimable forever, and claiming it means becoming the applicant for that vendor. Migration 0068 adds an expiry with a fourteen-day default an owner can revise, refused with its own message and mutation-tested. Reference entropy is recorded rather than changed: that is a product decision about how admins issue them.

Step 5.3 is **PARTIAL** as of run 28 (7 September 2026). Four of five requirements are met — pipeline list with ordering, readiness checklist, impact-aware publish/pause/unpublish/restore, and audited decisions with refused self-approval and immutable evidence. Requirement 3, the test-order gate, **does not exist**: no schema column, no service, and the publication checklist's six checks contain no test-order among them. `VEN-12` claimed `backend_only` with the note "Publication requires test"; both halves were untrue and it is corrected to `not_started`. Its three verifiers came from my own run-4 step-level `verified_by` mapping, which for an unimplemented capability manufactures apparent evidence — a limitation now recorded. Unpublished stores do stay out of discovery, which joins on `PUBLISHED`; the gap is the missing sanctioned internal test path, not a leak. A test-order system spans phases 7–11 and was deliberately not built to close a step.

Step 5.4 is **VERIFIED_LOCAL** as of run 29 (7 September 2026), with thirty-one assertions covering staff invitation, permission summaries, denied states, settings, and activity history. Requirement 4 — vendors must not override platform-owned fee policy — holds structurally, since the eight vendor-facing writes reach no fee column and `updateOrderingSettings` takes two bounded fields through a literal SQL fragment. The check enforcing it was a two-name blocklist that would have passed a method called `updateFulfilmentModes` and said nothing about fees; it is now an allowlist of the approved write surface, mutation-tested by adding a commission writer. That is the third control found to be a blocklist where an allowlist was needed, after run 11's CI commands and run 23's route exemptions.

Step 5.5 is **VERIFIED_LOCAL** as of run 30 (7 September 2026). Twenty-five assertions already covered products, variants, packaged and variable-weight definitions, substitutions and cross-vendor isolation. The finding was requirement 5: `catalogue_prices` is a proper temporal history, but it was the one financial history table without an append-only guard, so a past price could be rewritten or deleted. Orders copy their amount so no past order changes, but the history is the independent corroboration a disputed charge is settled against, and it could be edited to agree with whatever was claimed. Migration 0069 permits only closing the open row and refuses everything else. My first assertion passed for the wrong reason — setting the amount alone is refused on the status clause before the amount clause is reached — the same mistake as run 17's inbox guard.

Step 5.6 is **PARTIAL** as of run 31 (7 September 2026). The template and version (`CATALOGUE_CSV_V1`), staged parsing that leaves the live catalogue untouched, row-level validation, and idempotent replay-safe commit are all met and asserted. The 10,001-row cap — the only bound between an upload and parsing every row into memory, since the 7 MB body limit constrains bytes rather than rows — was untested and now is, mutation-tested by raising it. Requirement 2's scan does not exist: a CSV arrives as an inline string and never passes through protected object storage. The exposure is small, because the file is parsed and discarded and never served back; the applicable threat is formula injection through the stored `raw_row`, which has no delivery vector until exportable reports are built in 11.8. Neutralising at ingest would corrupt a product legitimately named `+1 Fresh`, so it is recorded against 11.8 rather than fixed here.

Step 5.7 is **VERIFIED_LOCAL** as of run 32 (7 September 2026). Freshness labels three tiers and deliberately does not gate purchase — the requirement says expose, and reservations plus acceptance-time confirmation carry the correctness. The finding was that the moderation verifier contained no rejection assertion of any kind, leaving `assertAdmin` untested on all three moderation methods; `listQueue` is cross-vendor by design, so removing that one call would expose every vendor's moderation cases to any authenticated actor. Three isolation assertions added and mutation-tested.

**Phase 5 is PARTIAL.** Five of seven steps are VERIFIED_LOCAL and the exit gate's own criteria are met: a published vendor is discoverable, a second vendor cannot reach it on any surface, and import, stale availability, moderation and document expiry all pass. Two steps fall short of their own requirements without the gate noticing — 5.3's test-order gate does not exist (VEN-12 corrected to `not_started`) and 5.6's file scan does not exist.

Step 6.1 is **VERIFIED_LOCAL** as of run 33 (7 September 2026) and was the most thoroughly covered step audited, with thirty-four assertions. Requirement 5's custody-gated address disclosure — D-15's rule that partners see an exact address only after verified custody — was mutation-tested by widening the gate to assigned-but-not-carrying, which the suite caught. The finding was requirement 3: the limit of four was tested, its *configurability* was not, and because `savedAddressLimit` falls back to 4 whenever the configuration lookup yields nothing, renaming the key to a typo left every assertion green with the operator control dead. The verifier now drives a real configuration through draft, validate, approve, schedule and activate and asserts the limit changes. Same shape as run 24's vacuous retention check: wherever a default exists, the test must move the value away from it.

Step 6.2 is **VERIFIED_LOCAL** as of run 34 (7 September 2026). Requirements 1, 2, 4 and 5 were already well covered, including two privacy assertions worth naming: anonymous browsing must not write a per-user discovery event, and a zero-result search must still record funnel evidence. Requirement 3 was defective in both halves. Product search ordering ended at `p.title`, which is not unique, so results at the `LIMIT` boundary were non-deterministic — the same file already ended its other two ordered queries with a primary key, and search and `recentSearches` now do the same. Pagination was accepted and never exercised: `limit` and `offset` are optional, so removing them from the SQL would have gone unnoticed and a request for page two would have silently returned page one. The verifier now asserts an offset past the last result returns nothing, mutation-proven by neutralising the clause. The tiebreaker fix is recorded as inspection-verified rather than mutation-proven, because PostgreSQL's unspecified order is unspecified, not guaranteed different. A true multi-page ordering test needs a second discoverable fixture store and remains open.

Step 6.3 is **VERIFIED_LOCAL** as of run 35 (7 September 2026), after two requirements turned out to be partly unimplemented rather than merely untested. Requirement 1 names store and misspelling terms: `similarity()` sat only in the ORDER BY, where it reranks matches but cannot produce one, so a misspelling was findable only if somebody had enumerated it in the synonym table, and `location_name` appeared in no WHERE clause anywhere in the file, so typing a shop's name returned nothing from any surface. Both now match, the first through trigram word similarity on the existing GIN index. Requirement 5 measures zero-result and search-to-cart outcomes; `SEARCH_TO_CART` was a member of the event-type union that nothing in the repository ever wrote, and is now recorded after a line is held, with explicit client attribution rather than an inferred time window. Requirement 2's ranking and all four of requirement 3's filters were implemented and unexercised; `max_distance_meters` proved untestable until a third fixture store existed, because the store sat on the customer's own coordinates at zero distance. That store also closed run 34's open gap, making pagination a genuine multi-page test. Nine mutation probes, all caught. Two probes that first failed on a SQL syntax error and a TypeScript build error were redone: a probe that fails before its assertion runs proves nothing.

Batch 10 (18 September 2026) followed a repository-wide read of every document against the tree. Step 2.5 gained the executed CI evidence it lacked — and it was negative: every push since 18 August had failed on unit tests that imported a shared package's `dist/` before anything built it, and branch protection was never enabled, so the red runs landed on `main`. Fixed and proven on a fresh clone; the first green hosted run followed on a branch. Then, from one order walked out of the shop three ways: the cart took any fulfilment method for any store (CUS-33, marked complete while batch 08 had recorded it open), a collected order was charged the delivery fee, vendor self-delivery (VEN-37, Launch) had no flow at all, and a collected order never settled because settlement ran only on delivery — §13.2 scenario 1 was recorded as covered by a verifier that asserted inventory, not money. All four are closed with mutation-proven assertions; the worker's event routing is now a unit-tested function. Detail: [repair batch 10](docs/engineering/repair-batch-10-evidence.md).

Step 6.4 is **VERIFIED_LOCAL** as of run 37 (19 September 2026). Two of its five requirements held; one was tested vacuously (the preferred store was read back twice with nothing changed between), one was met for favourites but not for the preferred store (whose read returned a bare id, so an eligibility change could not be shown), and requirement 4 — submit a shop request into the admin/vendor pipeline — was half absent: the request was stored with a lifecycle nothing could advance. Migration 0081 and the domain now give operators a queue, triage into an onboarding lead, and closure with a reason, behind the onboarding capabilities; favourites assert removal and refuse an unknown store as not found instead of a 500; a shop named in Hindi no longer fails at the table. Eleven mutation probes, all caught. The feature matrix had CUS-21 as PWA-working (no surface exists) and CUS-22 as not started (the domain and route had existed since 0020); both are `backend_only`.

Step 6.5 is **VERIFIED_LOCAL** as of run 38 (19 September 2026). Two of requirement 3's five items were not met: the customer's store page reported staleness only as "no inventory row" while the 5.7 freshness tiers reached only an availability endpoint no customer surface called, and the variable-weight "estimate" was a fixed sentence with no number. The storefront now carries the shared freshness tier with the confirmation time and the loose product's permitted variance, and the product sheet says both (migration 0082 registers the copy en and hi). Requirement 5 — no cross-vendor catalogue mixing — had no assertion and now has one in both directions. Four mutation probes, all caught, one redone after failing at bind time rather than at the assertion. Scope note: store images, per-store policy text and offers are not modelled.

Step 6.6 is **VERIFIED_LOCAL** as of run 39 (19 September 2026). The "configured" group limit was a constant with a comment naming a configuration key nothing read — the shape run 33 found on the saved-address limit — and now resolves `customer.cart_group_limit` from versioned configuration at the instant of the add, defaulting to three; the verifier activates four and admits a fourth store, then refuses a fifth. The line's substitution preference and the group's note were stored and never asserted; both are now. Five mutation probes, all caught, two redone to fail at the assertion rather than at bind time or inside the command. Scope notes: tipping is priced but not enabled or catalogued; the separate-order explanation lives at the basket, not at the add.

Step 6.7 is **VERIFIED_LOCAL** as of run 40 (19 September 2026), and with it **Phase 6 is VERIFIED_LOCAL** on every step. The step is named validation *and recovery*, and recovery did not exist: revalidation skipped every `INVALID` group, so a store that reopened or an address changed back left the group invalid for good, silently out of the quote while the basket still showed it with a working stepper; nothing recorded why a group or line had failed; and a line with no current price or no inventory row stayed active and was dropped by the quote's joins without a word. Migration 0083 puts the reason on the row with table checks, revalidation examines invalid groups and stale lines and returns what recovered, an address change revalidates, and the basket says why and offers removal. Eight mutation probes, all caught; the new table check caught one defect before any probe (a removed stale line kept its reason). The cart verifier now re-runs on one database.

Step 7.1 is **VERIFIED_LOCAL** as of run 41 (19 September 2026). The pricing function held; what surrounded it did not. The policy version stamped on every quote and allocation could not be resolved once superseded — the resolver considered `ACTIVE` rows only — so after the first policy change every earlier order's settlement threw, contradicting the code's own comment that an order settles under the rules it was sold under; run 19's verdict on 3.7 requirement 4 is corrected. The connected verifier never checked what a quote cost; it now checks the amounts against the pricing module for each store's real route and the policy stamp against the version in force, and proves a quote made after a policy change for an earlier instant is priced under the predecessor. D-05's worked examples are a table; the policy reader's refusals have tests. Six mutation probes, all caught. Scope notes for an owner: `tax_basis = 'EXEMPT'` is a claim D-05 forbids, and "route km" is a straight line.

Step 7.2 is **VERIFIED_LOCAL** as of run 42 (19 September 2026). The inventory module was sound; the two modules that bypassed it each had a private "release a hold" and each was wrong. The checkout's restored units without the shelf state, which the counted-state check refuses whenever a hold had taken the last units — so a declined payment on such a quote was a 500 and one lapsed quote stalled the worker's whole quote sweep. The fulfilment's flipped reservations to RELEASED and never returned the units, so every vendor decline, timeout or customer cancellation of a counted item lost that stock for good. Both now use one routine that restores, recomputes and records; a re-quote gives back the same cart's lapsed holds first; the last-unit race through the checkout is proven with the interleaving forced. Six mutation probes, five caught outright and one redone after the unforced race proved nothing.

Step 7.3 is **VERIFIED_LOCAL** as of run 43 (19 September 2026). The quote was not bound to the cart: its digest hashed the shelf, so the first quote's own hold broke every retry and a cart-only shortcut returned whatever live quote existed — the one the customer had just changed away from — and placement never compared the cart to the quote, so a line added, a quantity changed or an address switched after quoting was placed as quoted. A closed or paused store was neither quoted nor blocked but gone, and a group with an unpriced line was quoted without it. Migration 0084: a content digest (unique among live quotes), supersession of a changed cart's live quotes with their holds given back, a placement-time content check, every group returned quoted or blocked with a reason the checkout explains by store. Seven mutation probes, all caught, one redone to reproduce the old silent trim. Scope notes: the promise is fixed copy; the route is a straight line.

D-17 (20 September 2026) closed the route and promise scope notes of runs 41 and 43: one routing service, Mapbox in the synthetic environments with a labelled estimate as fallback and test provider, a day-long route cache (migration 0085); the quote stores the road it priced on and the promise made from it, offers and settlement read that stored road, discovery orders and filters by road, and the shop's console shows the road for a self-delivered order. The Mapbox token is configured in the laptop profiles and the Azure environment (release f661558, 20 September 2026); an environment without it runs every route as a labelled estimate.

Step 7.4 is **VERIFIED_LOCAL** as of run 44 (20 September 2026). The port could not be implemented by a real provider (synchronous, no void), so an authorization was "voided" by writing VOIDED with a provider result nobody gave, and a provider that threw at authorize, capture, refund or payout escaped the transaction with nothing recorded. A placement the provider did not answer was held as PAYMENT_UNKNOWN with no finance exception; the expiry sweep gave its stock back five minutes later, so a late "succeeded" met a missing hold and was refused on every redelivery; every other late answer was recorded and ignored; two concurrent deliveries of one event died on the unique key; a reused event id with different content passed as a replay; and the API read any unrecognised outcome as a failure that cancels the placement. Migration 0086: an asynchronous port with `void`, one no-answer helper at every call site, the void through the provider, the exception at placement, holds kept while the provider is awaited and an abandonment sweep after fifteen minutes, late answers acted on by what they say about the money (void through the provider, close, or conflict for a person), the receipt as the lock-ordered replay guard with content compared. Nine mutation probes, all caught, one after the race was forced. Scope notes for the real-adapter step: the signature is over a canonical re-serialisation, not the raw bytes; orphan webhooks leave no receipt; the fake's memo is per operation reference, so a scenario decides every operation alike.

Step 7.5 is **VERIFIED_LOCAL** as of run 45 (20 September 2026). The provider was asked inside the transaction that would record its answer, with nothing written until it came back: a process that died after the provider had authorised left money held and no record, and a row lock was held for as long as the provider took. A placed order's stock holds kept the quote's five-minute expiry, so the inventory sweep gave every placed order's stock back to the shelf while it was being packed and the pickup commit silently skipped the released hold; run 44's "holds kept while the provider is awaited" was defeated by the same sweep. An idempotency key reused for a different quote returned the earlier checkout; a duplicate of a declined submission was "quote invalid" rather than the decline; aggregate transitions were written as 1 → 2 whatever the head's version. Migration 0087: the submission recorded and committed first (`PROCESSING`, `AUTHORIZING`, holds carried to the submission's deadline, `CHECKOUT_SUBMITTED`, `checkout.submitted`), the provider asked outside any transaction, the answer recorded by one routine the webhook and the sweep share, a placed order's holds carried to twenty-four hours, `reconcileProcessingPlacements` asking the provider's status for a submission whose answer was never recorded, version-aware transitions, key-reuse refused, a decline replayed as a decline. Nine mutation probes, all caught (two by exception rather than assertion).

Step 7.6 is **VERIFIED_LOCAL** as of run 46 (20 September 2026). A declined payment reached the customer as ORDER_STATE_CONFLICT — "That step is not available yet. Check the job for what still has to happen first.", a shop's sentence — in an error box whose "Try again" fetched a fresh quote; so did a lapsed quote, a changed basket, and a dropped connection, so an order whose confirmation was lost was followed by a second basket. The quote showed neither the fulfilment method nor the decision rule, and `decision_rule` was a fixed sentence: the customer's substitution rule was chosen per basket line and went no further (not on the quote, not in the digest, not on the shop's order line). Migration 0088: the rule snapshotted on quote and order lines and bound by the digest, `decision_rule` per group (or MIXED), three stable codes (PAYMENT_DECLINED, QUOTE_EXPIRED, QUOTE_CHANGED) with customer copy, and a checkout screen that names a decline and re-quotes under it, re-quotes for a lapsed or changed quote, keeps the quote and re-asks with the same key when no answer came, announces the placement in flight, and states method, rule and the buffer either way. Verified live in the browser against the synthetic project. Three mutation probes, all caught. Forward finding for Phase 8: the fulfilment's substitution flow asks the customer whatever the rule says.

A live QA pass (20 September 2026) walked every role's workflow against the running `supabase-production` stack — 163 API steps and the four Playwright journeys — and fixed nine defects outside the step audits' domains: the worker's sweeps failing on a foreign key every tick (a platform system user, 0089); every session-only route running with no actor (notifications 500); two admin requirements without a scope (partner applications unreachable); reads gated on one side of three maker-checker pairs (0090, 0091); a delivered order that could not be rated; a repeated role grant surfacing as a unique violation; the PIN read off the map having to be typed back; the admin console opening empty. See the audit log.

Step 7.7 is **VERIFIED_LOCAL** as of run 47 (20 September 2026). The customer's group projection spread the whole group row and every column of every order row — the idempotency key, request ids, the shop's decline note, the staff member who delivered, and the pickup and delivery code hashes, which are plain SHA-256 of six digits and therefore the codes. The group's summary state was never derived: the one derivation that existed counted CANCELLED children alone and nobody read it, and the customer's order history and the admin monitor showed the stored payment state, so a group of delivered orders read "In progress" for good and one whose only order expired unanswered did too. Now: a named projection; `deriveCheckoutGroupState` (the PRD's seven states, a collected order complete at PICKED_UP, EXPIRED and RETURNED as endings, an order that will never arrive said first) serving the projection, the order history and the admin monitor, with the payment state beside it; the missing `state.partially_accepted` copy (0092). Four mutation probes, all caught. Forward finding for the OTP steps (8.x/9.x): the pickup and delivery codes are hashed with plain SHA-256; keyed hashing would make a leaked hash worthless.

Step 7.8 is **VERIFIED_LOCAL** as of run 48 (20 September 2026), and with it Phase 7's exit gate. Of the eleven named proofs, seven already stood in the verifiers (last-unit competition forced in run 42, three-store partial failure, expired quote, provider timeout then webhook success, webhook replay, cross-customer access, sibling release); four were missing and two of them found defects when written: two taps that overlapped died on the group's unique quote id (the earlier-submission lookup ran before the quote row was locked), and a placement the provider authorised whose holds had lapsed was thrown away with the group left PROCESSING and the money held, for every sweep to fail on again. Now: the quote row is the lock a submission is serialised on; the orders are made in a savepoint and an unfulfillable placement is ended with the money voided and the customer refused as INVENTORY_UNAVAILABLE (0093 `CHECKOUT_FAILED`); placement refuses a store paused since the quote; the authorised amount, its allocations and the orders are proven equal; a duplicate's footprint is proven unchanged across payments, groups, orders, allocations, holds, outbox and history. Four mutation probes, three caught (the dropped price check is still caught by the content digest, which is the second proof of the same invariant).

Phase 7 exit gate: one checkout creates one group and one order per valid vendor (runs 43, 45, 48); a duplicate creates no duplicate payment, order, allocation, hold, event or notification (run 48's footprint; notifications follow the outbox, which is proven single); an invalid or failed group releases only its own resources (runs 42, 43, 44, 48).

Step 8.1 is **VERIFIED_LOCAL** as of run 49 (20 September 2026). The deadline, the timeout and the customer's notice held; the shop's alert and its escalation did not exist — the customer was told of every state change while the shop's console polled a list in silence. Now: the worker alerts every current staff member of the location when `order.placed` is delivered (in-app and push, audible, carrying `accept_by`, once per order and person), the console sounds and acknowledges the alerts for the orders it shows, and an alert nobody opened within the configured wait (`vendor.order_alert_escalation`, default 60 s) is escalated once to the owners on the configured channels, SMS among them. Found beside it: `GET /notifications` answered a bare array that the interceptor wrapped as `data`, so every inbox reading `notifications` had always been empty. Seven mutation probes, all caught.

Step 8.2 is **VERIFIED_LOCAL** as of run 50 (20 September 2026). The gates on accept held; the acceptance committed nothing — the holds placed at checkout were committed at pickup, from the worker, one transaction each, so an accepted order lived its whole preparation on a hold with a deadline — and the decline took any shouting-snake-case string for a reason and previewed nothing the server had computed. Now: the acceptance commits every hold in its own transaction (`commitReservationsLocked`) and refuses an order whose hold lapsed; the seven standard reasons are the server's vocabulary; `previewDecline` states the money released (the allocation), the units per line, the siblings and the shop's record before and after, and the console shows the API's answer. Found beside it: no customer had ever cancelled an accepted order — the 0026 shape constraint refused a cancelled order with an `accepted_at` (0094). Eight mutation probes, all caught. Forward findings: a missing or removed line keeps its committed units (8.3/8.5); a returned order's units are never released (9.x); a completed sale's commitment blocks stocktakes for good (6.x).

Step 8.3 is **VERIFIED_LOCAL** as of run 51 (21 September 2026). Unresolved lines could not reach ready and edits lock at READY; but the ordered lines were immutable by convention only, "found" took any quantity at any price, a replacement ignored the customer's rule (carried to the order line since 0088 and never read) and could name another store's variant, and a pick carried no version — a queued or repeated tap overwrote whatever had happened since, a pending customer decision included. Now: 0095 guards the lines and adds two codes; found is the line as ordered or fewer at the snapshot's price; a "refund, never replace" line takes no proposal (`SUBSTITUTION_NOT_ALLOWED`) and a replacement is the store's own live product; every pick edit names the pick version it saw and a line with the customer takes no edit (`LINE_AWAITING_CUSTOMER`); at ready the lines not in the bag give their committed units back (closing run 50's finding). Eight mutation probes, all caught. Forward findings for 8.4 (a lighter weight needs no decision; ALLOW_SAME_STORE still asks), 8.4/8.5 (an approved replacement reserves nothing; a short found line keeps its whole reservation) and 8.5/8.6 (capture is not reduced for a missing or short line).

Step 8.4 is **VERIFIED_LOCAL** as of run 52 (21 September 2026). Approve/reject once held. Every weight and every replacement was a question — a lighter weight and a replacement at no extra cost under an `ALLOW_SAME_STORE` rule included; the question said nothing about what it was (the proposed quantity and price alone, no item, no store, no difference; the notice carried the event type alone); the deadline was a constant rather than `customer.decision_seconds`; and the group's money was captured the moment every shop had accepted, so in the running system every approved dearer change was a 409 for want of an uncaptured payment and a missing line was captured in full. Now: only a rising total asks; the rest is applied, recorded as an answered decision, the difference taken off, and the customer told; the decision and its notice carry the item as ordered, the item offered, quantities, prices, the difference, the reason, the deadline and the store (0096 links the event to its decision); the deadline is configuration; the authorisation is captured only once every bag is final (`vendor_order.ready`), ready takes what is not in the bag off it in one `LINES_NOT_SUPPLIED` adjustment, and an empty bag cannot be ready. Nine mutation probes, all caught. Forward findings for 8.5 (the console does not say a change was applied without asking; no vendor cancellation after acceptance), 8.6/8.7 (the receipt shows refunds but not pre-capture adjustments) and 8.4/8.5 (an approved replacement reserves no stock; a short found line keeps its whole reservation).

Step 8.5 is **VERIFIED_LOCAL** as of run 53 (21 September 2026). Every line resolved and ready-once held. The package's condition was accepted and sent by no screen, its handling needs had no column, field or route, and the promise (`pickup_promise_at`, since 0026) was never set; the delivery attempt made at placement carried a package count guessed from the line count, which the partner then had to type back exactly at the counter. Now: 0097 puts handling needs on the order (a fixed vocabulary) and the console records count, condition and needs; ready stamps the server time and the promise — a collected order ready from now, a delivered one arriving after the quoted road — read by the customer's card; ready passes the shop's count and needs to the live attempt without staling a partner's open offer, and the partner's job says them. Six mutation probes, all caught. Forward findings: offers go out from acceptance rather than ready (owner decision, 9.x); a partner handed a different number of bags than recorded can only type the shop's number (8.6).

Continue the step audit from 8.6 while keeping the Phase 2 gates (branch protection) visible.
