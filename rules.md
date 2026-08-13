# AI Rules and Boundaries — Neighbourhood Store Marketplace

**Status:** Active project policy

**Version:** v0.2 · synchronized 13 August 2026

**Applies to:** AI coding assistants, autonomous agents, automation tools, and human contributors using AI-generated work

**Last updated:** 13 August 2026

**Related documents:** [README](README.md) · [PRD](prd.md) · [Design](design.md) · [Architecture](architecture.md) · [Workflow](workflow.md) · [Implementation](implementation.md)

## 1. Purpose

This document defines what an AI may do, what it must verify, what it must never do, and when it must stop for approval while working on this project. Its purpose is to protect customers, vendors, delivery partners, the platform, and project data while still allowing useful autonomous work.

These rules govern project work; they do not override platform security controls, applicable law, or instructions from the project owner.

## 2. Instruction priority

When instructions conflict, use this order:

1. Platform, system, security, and legal requirements
2. The project owner's latest explicit instruction
3. This `rules.md`
4. The concern-specific authoritative document in `implementation.md` §1: PRD for product outcomes, architecture for durable system design, design for interaction, and workflow for chronology
5. `implementation.md` for exact build-contract details consistent with those authorities
6. `README.md`
7. Existing code, tests, schemas, and API contracts

The AI must stop and ask the project owner when a conflict could materially change product scope, money movement, privacy, security, legal compliance, or production data. It must not silently choose the most convenient interpretation.

Examples, estimates, and pilot assumptions are not permanent decisions. In particular, sample delivery prices and service radii must not be hard-coded as final business policy.

## 3. Product boundaries that must be preserved

Unless the project owner explicitly approves a change, the AI must preserve these principles:

- Customers choose a specific, named local vendor.
- Vendors retain their identity and control their catalogue, prices, availability, hours, and fulfilment estimates.
- The MVP customer cart may contain products from multiple named vendor locations. Checkout groups lines by vendor and creates one independent order per vendor location; no individual order may span vendors.
- Each vendor order retains its own acceptance, fulfilment promise, delivery or pickup fee, substitutions, cancellation, refund, settlement, and audit history. A failure at one vendor must not silently cancel, reassign, or corrupt another vendor's order.
- Vendors may view and act only on their own child order. Support and admin actions must identify the affected child order; checkout-group visibility never grants permission to mutate siblings.
- Delivery fees are distance-based and shown transparently before the customer commits.
- The platform charges the vendor per successfully completed order; a vendor subscription is not the current model.
- Pickup, vendor self-delivery, and shared delivery-partner fulfilment are supported product modes.
- The platform does not own inventory or operate dark stores in the MVP.
- The product does not promise 10-minute delivery.
- Vendor, delivery-partner, finance, and administrative actions are attributable and auditable.
- Substitutions and material price changes require the customer's explicit preference or approval.
- Prescription medicine ordering remains disabled until legal, licensing, privacy, and operational controls are approved.
- Delivery partners receive only the data required to complete their current assignment.
- Every product surface uses the approved white/light visual theme. Dark mode, dark navigation shells, and dark-only screens are outside the approved design unless the project owner changes this rule.

## 4. AI authority

### 4.1 Work allowed without additional approval

Within the task and folder requested by the project owner, an AI may:

- Read, search, and analyse project files.
- Explain, review, diagnose, and propose solutions.
- Make reversible edits that directly implement the requested change.
- Add or update relevant tests and documentation.
- Run local, non-destructive formatting, linting, type-checking, test, and build commands.
- Fix a clear defect caused by its own changes.
- Create temporary local files needed for verification and remove only those temporary files it created.
- Use anonymised or synthetic test data.

The AI should make reasonable, low-risk assumptions when they do not change product intent. It must state any assumption that affects behaviour, money, privacy, or scope.

### 4.2 Work requiring explicit approval

The AI must ask before it:

- Changes the business model, fee policy, marketplace rules, or MVP scope.
- Selects a paid provider or creates an external account, resource, or ongoing cost.
- Adds a dependency with material security, licensing, hosting, or maintenance impact.
- Performs an irreversible or destructive database migration.
- Deletes, renames, or moves user-created files beyond the explicit request.
- Commits, pushes, opens a pull request, publishes, releases, or deploys unless requested.
- Contacts customers, vendors, delivery partners, staff, or any external party.
- Enables pharmacy sales, prescription processing, COD, credit, or another regulated/high-risk workflow.
- Changes authentication, authorization, payment, refund, payout, settlement, or ledger policy.
- Uses real credentials, production data, or privileged production access.
- Alters legal terms, privacy notices, retention periods, or consent language.
- Introduces a new service boundary or replaces a core technology decision.
- Makes a change that creates a significant operational burden for vendors or delivery partners.

Approval for one action does not imply approval for broader or future actions.

### 4.3 Actions that are prohibited

An AI must never:

- Bypass authentication, authorization, sandboxing, review gates, or safety controls.
- Reveal, copy, commit, or print secrets, tokens, OTPs, bank details, prescriptions, full addresses, or other sensitive personal data.
- Fabricate test results, user research, metrics, citations, completed work, or production readiness.
- Use destructive Git operations such as hard reset or force push without a precise, explicit instruction and verified target.
- Silently overwrite or discard changes made by the project owner or another contributor.
- Allow a client application to set trusted order, payment, refund, payout, or delivery states directly.
- Use floating-point values for money or recalculate historical orders using current fee rules.
- Mark a payment successful from an unverified callback or create duplicate capture, refund, settlement, or payout operations.
- Modify production data manually to hide an inconsistency.
- Send external messages, place orders, spend money, or accept legal terms without approval.
- Train on, reuse, or export project/customer data outside the approved project purpose.
- Introduce microservices, dedicated search infrastructure, or complex route optimisation merely for anticipated scale.

## 5. File and change discipline

Before substantial implementation work, the AI must review `README.md`, `prd.md`, `architecture.md`, `design.md`, `workflow.md`, `implementation.md`, this file, and any repository-specific agent instructions that exist.

For every change, the AI must:

- Inspect the current state before editing and preserve unrelated work.
- Keep the change within the user's requested scope.
- Prefer the smallest coherent change that completely handles relevant success and failure paths.
- Follow existing naming, formatting, module ownership, and test conventions.
- Keep documentation, schemas, APIs, and tests consistent with behaviour.
- Avoid committing generated junk, temporary output, credentials, or personal data.
- Clearly label examples and unconfirmed decisions as examples or proposals.
- Use a reversible migration path wherever practical.
- Report which files changed and what verification was performed.

The AI must not treat an existing implementation as correct merely because it already exists. Where code and approved requirements disagree, it should identify the conflict and use the instruction priority in Section 2.

## 6. Architecture boundaries

The MVP architecture is a modular monolith unless measured evidence and an approved architecture decision justify a change.

The AI must preserve these boundaries:

- PostgreSQL is the authoritative store for durable business and financial state.
- PostGIS handles geographic eligibility and distance-related queries.
- Redis is for cache, rate limits, queues, locks where unavoidable, and expiring state; it is not the source of truth.
- Object storage holds uploaded objects; the database holds their ownership, status, and access metadata.
- Modules own their data and business rules. Other modules use defined commands, queries, or events rather than writing directly to their tables.
- Order and ledger invariants use database transactions.
- Durable asynchronous work uses an outbox or equivalent atomic handoff.
- External payment, maps, messaging, storage, and identity systems sit behind provider adapters.
- API operations with retry or money impact are idempotent.
- Search begins with PostgreSQL capabilities; a dedicated search engine requires evidence.
- Responsive web/PWA is the default validation surface; native apps require a demonstrated device capability need.
- Manual or simple dispatch precedes automated route optimisation.

An AI proposing a boundary change must document the problem, evidence, alternatives, migration cost, rollback plan, and operational owner.

## 7. Role and data-access boundaries

Access must use least privilege and server-side authorization.

| Role | May access | Must not access or control |
|---|---|---|
| Customer | Own profile, addresses, carts, orders, payments, support cases, and public vendor data | Other customers' data; vendor operations; partner earnings; administrative controls |
| Vendor | Its own stores, staff, catalogue, orders, fulfilment, settlements, and permitted customer order details | Other vendors' private data; unrelated customer history; platform-wide finance or admin controls |
| Delivery partner | Eligible offers and the minimum data for an accepted, active assignment; own earnings | Prescription contents; full customer history; vendor settlements; unrelated orders; exact address before the approved disclosure stage |
| Admin/support | Data and actions required by the assigned role and case | Unrestricted access by default; unlogged high-risk actions; secret or payment-instrument data |

Additional requirements:

- Exact customer address and masked contact details are disclosed to the assigned partner only at the approved assignment stage.
- Sensitive admin actions require a reason, actor identity, timestamp, before/after record, and audit event.
- High-value or high-risk financial, restriction, configuration, and incident-control actions require separate approval at the configured threshold. The proposer must not approve their own request.
- Tenancy and ownership checks must occur in the backend, not only by hiding controls in the UI.
- A fraud or risk signal opens a review and may trigger only an approved, scoped, time-bound protection. It must not become an unexplained automatic punishment; evidence, reviewer, outcome, and appeal/review path are retained.

## 8. Orders, delivery, and financial integrity

Order, assignment, payment, refund, settlement, and payout states must follow explicit state machines. Every transition must be validated on the server against the actor, current state, requested next state, and required evidence.

The following are non-negotiable invariants:

- Money is stored as integer minor units with an ISO currency code.
- Order lines snapshot product name, variant, quantity basis, tax inputs, and agreed price.
- Multi-store checkout uses an immutable checkout-group record plus vendor-scoped child orders. Customer payment, refund, discount, tip, and fee amounts must be explicitly allocated to those child orders so partial acceptance and partial failure remain reconcilable.
- Cart additions do not create a hard inventory reservation. Any checkout soft hold is short-lived and attributable; placement remains provisional, vendor acceptance commits it, and rejection, cancellation, or timeout releases it. Concurrent hold/commit decisions must be atomic and idempotent.
- A vendor decline or cancellation uses a standardized reason and a server-computed impact preview. It cannot transfer lines to another vendor or change a sibling order implicitly.
- Delivery quotes snapshot distance, coordinates or zone inputs, formula version, fee components, currency, and expiry.
- Historical charges are never recomputed using a newer price formula.
- Ledger entries are append-only, attributable, and balanced; corrections use reversal or adjustment entries.
- Payment capture, refund, settlement, and payout operations use idempotency keys.
- Provider webhooks are signature-verified, replay-safe, stored for audit where appropriate, and processed idempotently.
- A completed delivery alone does not silently resolve an unresolved payment or ledger mismatch.
- Vendor fees are applied according to the approved completed-order policy, including documented cancellation and refund treatment.
- Delivery proof must be tied to the active assignment and must not expose the OTP in logs.
- One vendor order has no more than one active delivery assignment by default. Reassignment creates a new attempt and preserves prior partner, reason, actor, timing, compensation, and custody history.
- Server-confirmed pickup starts package custody. While custody is active, vendor edits and ordinary cancellation are blocked; failure or cancellation follows an authorized return/handoff flow until custody is closed.
- Waiting, reassignment, return, and manual earning adjustments are posted as attributable ledger lines and may be disputed. They are never silently folded into base pay.
- Retry, timeout, duplicate event, partial failure, cancellation, and dispute paths must be designed and tested.

Versioned business configuration is immutable after activation. Every material change records scope, diff, proposer, approver, validation result, effective time, and rollback target. Rollback creates another version and does not recalculate historical orders.

Incident controls must be scoped, reversible, attributable, and time-bound or explicitly reviewed. They may stop new work but must not silently erase accepted orders, active package custody, refunds, ledger entries, settlements, or payouts.

No AI may invent a financial adjustment to make totals balance. It must surface the mismatch and preserve evidence.

## 9. Security and privacy boundaries

The AI must apply data minimisation, purpose limitation, least privilege, and secure defaults.

- Secrets belong in an approved secret manager or local untracked environment configuration, never source control.
- Logs use identifiers and redacted values, not OTPs, tokens, bank information, prescription data, or unnecessary full addresses.
- Sensitive files use private object storage, short-lived signed access, file-type validation, size limits, and malware scanning.
- Data is encrypted in transit and at rest using supported platform controls.
- Test and development environments use synthetic or irreversibly anonymised data.
- Production data must not be downloaded to a developer machine without explicit, documented approval and safeguards.
- Analytics events exclude secret, payment-instrument, prescription, and unnecessary personal fields.
- Delivery-partner location is collected only for an approved online/active-assignment purpose, at the minimum useful frequency, with visible state and bounded offline buffering. Collection stops when that purpose ends; retention/deletion follows an approved policy.
- Rate limits and abuse protections cover login, OTP, checkout, promo, support, upload, and partner-state endpoints.
- Account deletion, retention, consent, and access requests follow approved legal policy rather than AI-created assumptions.

Pharmacy and prescription data require a separate compliance decision and stronger isolation. Until then, the AI may document or design the future boundary but must not enable the workflow.

## 10. Testing and verification rules

Verification must be proportional to risk. A change is not complete merely because it compiles.

The AI must, where relevant:

- Test the expected path and important failure paths.
- Test authorization and ownership boundaries for every affected role.
- Test valid and invalid state transitions.
- Test inventory reservation concurrency, expiry, commit, and release without overselling or leaking one vendor's stock state to another.
- Test assignment replacement, waiting thresholds, custody locks, cancellation-after-pickup, return proof, and compensation disputes.
- Test admin role denial, proposer/approver separation, configuration activation/rollback, scoped kill switches, trust-review decisions/appeals, and child-order support isolation.
- Test retries, duplicate requests, duplicate webhooks, timeout, and partial failure behaviour.
- Test money rounding, ledger balance, refund, cancellation, and fee eligibility.
- Test geographic boundary and quote-expiry cases.
- Test that sensitive information is absent from logs, events, and unauthorized responses.
- Run the narrowest useful checks first, then broader checks when warranted.
- Verify documentation links and examples after documentation changes.

If a check cannot be run, the AI must say exactly which check was not run and why. It must not imply that unrun checks passed.

### Definition of done for AI changes

A change is done only when:

- The requested outcome is implemented or documented.
- Relevant product and architecture invariants are preserved.
- Relevant tests or checks pass, or limitations are explicitly reported.
- No secrets or unintended personal data were introduced.
- Documentation and links are consistent.
- Files changed, assumptions, remaining risks, and required user actions are reported.

## 11. Communication rules

The AI must:

- Lead with the result or current blocker.
- Separate confirmed facts from assumptions and proposals.
- State material trade-offs and consequences in plain language.
- Report partial completion honestly.
- Ask a concise question only when the missing decision materially changes the result or authority.
- Provide evidence for diagnoses and avoid unsupported certainty.
- Never use invented customer/vendor feedback as justification.

Recommended handoff format:

1. Outcome
2. Files changed
3. Verification performed
4. Assumptions or decisions made
5. Remaining risks or user action required

## 12. Stop and escalate conditions

The AI must pause the affected work and request direction when it encounters:

- Conflicting requirements that materially affect scope or behaviour.
- An unclear target for a destructive or irreversible action.
- A suspected credential, privacy, security, fraud, or legal incident.
- An unexplained financial, ledger, order-state, settlement, or payout mismatch.
- A need for production credentials, personal data, privileged access, or a paid resource.
- Pharmacy, prescription, COD, credit, employment-classification, or tax decisions without an approved policy.
- A request to publish, deploy, communicate externally, or spend money beyond granted authority.
- Repeated failure where further retries could alter or damage data.
- Evidence that an approved requirement would create a serious safety, privacy, or security problem.

An escalation should include the blocker, evidence, affected users or systems, safe options, and a recommended next action. Sensitive values must remain redacted.

## 13. Incident boundaries

For a suspected production incident, the AI may perform authorized read-only diagnosis and propose containment. It must not improvise destructive remediation.

For payment duplication, ledger imbalance, unauthorized access, or personal-data exposure:

- Stop or recommend stopping the affected automated operation through an approved reversible control.
- Preserve relevant request IDs, timestamps, state transitions, and audit references without copying sensitive values.
- Do not delete logs, rewrite ledger entries, or directly patch records to conceal symptoms.
- Make recovery operations idempotent, reviewed, and auditable.
- Document affected scope and verification required before resuming.

## 14. MVP anti-goals

Unless explicitly approved, an AI must not expand the MVP to include:

- Automatic combined-route or single-fee promises across multiple vendor orders before dispatch, allocation, and recovery rules are approved
- Platform-owned inventory or dark stores
- A 10-minute delivery guarantee
- Citywide launch before zone economics are validated
- Fully automated routing and dispatch
- A full vendor POS or ERP replacement
- Prescription medicine ordering
- Vendor subscriptions as a replacement for the current per-completed-order fee model
- Advertising, sponsored ranking, or pay-to-win discovery
- Native applications for every role before the web workflow is validated

The AI may record these as future options but must not build hidden foundations that significantly increase current complexity without approval.

## 15. Changing these rules

Permanent changes to product, business, security, privacy, or financial rules require approval from the project owner. When a rule changes, the AI must update all affected documentation, tests, schemas, and examples together.

Every material amendment should record:

- Date
- Rule changed
- Reason
- Approver
- Affected documents or systems

### 15.1 Cross-document synchronization protocol

For any product behavior change, update the authoritative source and every affected projection in the same change:

| Change type | Required updates |
|---|---|
| Scope, actor outcome, business rule | `prd.md`, then traceability row and README summary where material |
| Aggregate, state, data owner, security boundary | `architecture.md` and `implementation.md` |
| Screen/action/status/error presentation | `design.md`, relevant workflow step, and UI tests in `implementation.md` |
| Timer, endpoint, event, job, persistence constraint | `implementation.md`, with architecture/workflow references where externally visible |
| Role, approval, privacy, financial or incident rule | `rules.md`, `architecture.md`, `implementation.md`, affected PRD/design/workflow sections |
| Locked decision or production gate | `implementation.md` §§2–3 and the PRD/README decision summary |

The change is incomplete if the same state, timer, fee example, role, or scope is named differently across documents without an explicit mapping. Run documentation link, heading, state/event vocabulary, and contradiction checks before handoff.

This file should be reviewed before production launch and whenever the business model, regulated scope, payment flow, delivery model, or system architecture materially changes.

### Amendment history

| Date | Rule changed | Reason | Approver | Affected documents |
|---|---|---|---|---|
| 11 August 2026 | Added white/light-theme-only design boundary | Keep every product surface visually consistent and explicitly exclude dark mode | Project owner | `rules.md`, `design.md`, `README.md` |
