# Phased Delivery Plan — Neighbourhood Store Marketplace

**Status:** Execution roadmap for building the product
**Version:** v1.0 · 13 August 2026
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
10. Stop and wait for the project owner's instruction before starting the next numbered step.

The project owner has explicitly requested step-by-step supervision. Therefore, the completion report and pause are mandatory for this project unless the owner later changes that instruction.

A step is not complete merely because a screen renders or an endpoint returns success. Its error, timeout, retry, duplicate, permission, empty, loading, stale, reconnect, audit, and observable states must also be handled where applicable.

### 2.2 No hidden bundling

- Do not silently complete several numbered steps under one update.
- Do not introduce later-phase features because they are convenient while editing nearby code.
- Do not create abstractions for hypothetical future requirements when a simple phase-scoped implementation is enough.
- Do not defer financial integrity, authorization, failure handling, or audit work to the hardening phase.
- Do not claim a phase is complete while its exit gate contains an unresolved item.

### 2.3 File paths are responsibilities until the stack is chosen

The final client, backend framework, hosting platform, and repository layout are decision gates. Therefore, paths shown in this plan are illustrative responsibility groups, not permission to invent the stack.

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

1. Decide responsive web/PWA versus staged native clients.
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
2. Resolve payment authorization or record an honest unknown state.
3. Atomically create checkout group, one child order per vendor, line snapshots, provisional reservations, payment allocation, transition records, and outbox events.
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
