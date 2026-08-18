# Architecture — Neighbourhood Store Marketplace

**Status:** Proposed implementation architecture v0.2
**Synchronized:** 13 August 2026
**Product stage:** Validation / pre-implementation  
**Target market:** India, launched one neighbourhood or pin-code cluster at a time  
**Related documents:** [README](README.md) · [Product Requirements Document](prd.md) · [Design](design.md) · [Workflow](workflow.md) · [Implementation](implementation.md) · [AI Rules](rules.md)

## 1. Purpose

This document describes a practical technical architecture for a vendor-first local commerce platform. Customers order from a named neighbourhood shop, vendors manage and fulfil their own catalogue, delivery partners provide shared last-mile capacity, and administrators control trust, finance, and exceptions.

The project has no production code yet. D-02 and D-03 approve the internal-development technology foundation; hosting and every shared or production environment remain undecided. [ADR-001](docs/architecture/ADR-001-internal-development-stack.md) is authoritative where the older recommendations below differ.

## 2. Architecture goals

The system must:

1. Preserve each vendor as the owner of its storefront, assortment, prices, stock, and preparation promise.
2. Keep an order and its money movements consistent across customer, vendor, delivery, payment, refund, and settlement workflows.
3. Support unreliable mobile networks and low-end Android devices used by vendors and delivery partners.
4. Protect customer location, contact, payment, and future pharmacy data using least-privilege access.
5. Make every sensitive admin action and every order-state change traceable.
6. Launch cheaply in a small service area and scale by zone without an early microservices burden.
7. Allow payment, maps, messaging, and delivery providers to be replaced behind internal interfaces.

## 3. Architecture principles

- **Modular monolith first:** deploy one backend while enforcing module boundaries in code and data access. Extract services only when scale or team ownership justifies it.
- **PostgreSQL is the source of truth:** orders, money, identities, catalogues, and audit records use transactional storage.
- **Explicit state machines:** order, payment, fulfilment, partner, and vendor states change only through validated transitions.
- **At-least-once asynchronous processing:** background jobs may retry, so every handler must be idempotent, meaning the same request can run twice without duplicating its effect.
- **Provider isolation:** external gateways sit behind adapters. Business rules must not depend directly on one provider's payload shape.
- **Privacy by default:** reveal data only when a role needs it for an active task, then remove access when that task ends.
- **Operations are product features:** support, refunds, reconciliation, audit history, and manual recovery are part of the architecture, not afterthoughts.

## 4. System context

```text
┌──────────────┐     ┌────────────────┐     ┌──────────────────┐
│ Customer App │     │ Vendor Portal  │     │ Delivery Partner │
│ / Web        │     │                │     │ App / Portal     │
└──────┬───────┘     └───────┬────────┘     └────────┬─────────┘
       │ HTTPS                │ HTTPS                 │ HTTPS
       └──────────────────────┼───────────────────────┘
                              ▼
                    ┌───────────────────┐
                    │ Marketplace API   │◄──────────── Admin Console
                    │ Modular Monolith  │
                    └───┬──────┬─────┬──┘
                        │      │     │
             ┌──────────┘      │     └───────────────┐
             ▼                 ▼                     ▼
      ┌────────────┐    ┌────────────┐       ┌────────────────┐
      │ PostgreSQL │    │ Redis /    │       │ Object Storage │
      │ + PostGIS  │    │ Job Queue  │       │ Images / Docs  │
      └────────────┘    └──────┬─────┘       └────────────────┘
                               │
                 ┌─────────────┼───────────────────────┐
                 ▼             ▼                       ▼
          Payment/Payout   Maps/Geocoding        SMS/Push/Email
             Provider        Provider               Providers
```

PostGIS is a PostgreSQL extension for geographic queries. It supports service zones, distance calculation, and nearby-store discovery without introducing a separate geospatial database.

## 5. Recommended deployment shape

### 5.1 Pilot

The concierge pilot should avoid building most production components. Use vendor-specific order forms or a thin web interface, manual vendor confirmation, a shared dispatch board, provider payment links, and one or two known delivery partners. Store every order and cost in a structured ledger so the data can validate pricing and inform the MVP.

### 5.2 MVP

Deploy these logical applications:

| Deployable | Responsibility |
|---|---|
| Customer web app | Store discovery, catalogue, cart, checkout, tracking, support, and reordering |
| Operations web app | Vendor portal and admin console, separated by role-based navigation and authorization |
| Delivery-partner app | Availability, assignment, navigation handoff, proof of pickup/delivery, exceptions, and earnings |
| Marketplace API | Authentication, business rules, transactional workflows, provider adapters, and read APIs |
| Background worker | Notifications, timeout handling, payment reconciliation, settlement jobs, report generation, and retries |
| PostgreSQL | Durable transactional and geospatial data |
| Redis | Short-lived cache, rate limits, distributed locks where unavoidable, and job queues |
| Object storage | Product images, vendor documents, issue evidence, and future prescription files |

The API and worker may share one codebase and release artifact while running as separate processes.

### 5.3 Later scale

Extract a module into a service only when one of these conditions exists:

- It has materially different scaling needs, such as high-frequency partner location updates.
- It requires independent security isolation, such as pharmacy prescription processing.
- A separate team owns its roadmap and on-call responsibility.
- Its failures must be isolated from checkout and order fulfilment.

Likely first extraction candidates are notifications, dispatch/location tracking, search, and analytics. Orders and financial ledger data should remain together until cross-service consistency is deliberately designed.

## 6. Client architecture

### 6.1 Customer App / Web

Start with a responsive web app or installable progressive web app. Render public store pages for fast loading and discoverability, while authenticated cart, checkout, order history, and support use secured APIs.

The client owns presentation state only. Product availability, fees, slot eligibility, substitution rules, and payable totals must always be recalculated by the server.

### 6.2 Vendor Portal

Optimize for low-end Android devices, intermittent connections, large touch targets, and very short workflows. New-order alerts should combine push notifications with SMS escalation when a vendor fails to respond.

Optimistic UI may improve responsiveness, but the server remains authoritative. Failed actions must show a clear retry or recovery state rather than silently reverting.

### 6.3 Delivery Partner App / Portal

An Android-first progressive web app can validate the workflow. A native or cross-platform mobile app may become necessary for reliable background location, push delivery, battery management, and navigation integration.

The app must cache the active assignment and last confirmed state locally so a temporary network loss does not erase the delivery context. Proof-of-delivery submission should retry safely.

### 6.4 Admin Console

Admin features use the same API but a separate authorization policy. High-risk actions, including refunds, account suspension, payout adjustments, document approval, and catalogue restriction, require a reason and immutable audit record.

## 7. Backend domain modules

The backend is one deployable system with the following enforced modules:

| Module | Owns | Must not own |
|---|---|---|
| Identity & Access | OTP sessions, users, roles, staff membership, devices, consent | Orders or business-specific permissions embedded in UI code |
| Vendor Network | Vendor application, legal profile, locations, licences, service zones, operating hours, status | Customer cart or payment records |
| Catalogue & Inventory | Products, categories, units, images, vendor prices, availability, stock freshness, reservation lifecycle, variable-weight rules | Order-line history after checkout |
| Discovery | Nearby-store queries, search documents, filters, ranking inputs, preferred stores | Authoritative catalogue or vendor state |
| Cart & Pricing | Multi-store cart, vendor-group validation, vendor quotes, checkout-group quote, tax inputs, delivery quotes, promotion allocation | Captured payments or settlement |
| Orders | Checkout group, vendor-scoped order aggregates, immutable line/fee snapshots, substitutions, status transitions, partial-failure and cancellation rules | Raw gateway payloads or partner GPS history |
| Fulfilment & Dispatch | Pickup/delivery choice, assignment attempts, partner availability, waiting, custody, handoff proofs, return-to-origin, delivery exceptions, location lifecycle | Vendor settlement calculations |
| Payments & Ledger | Authorizations, capture, refunds, fees, tips, adjustments, vendor and partner ledger entries | Product or delivery-state decisions |
| Notifications | Templates, preferences, delivery attempts, provider responses | Source business state |
| Support & Trust | Cases, evidence, escalation queues, review moderation, fraud signals/reviews, restrictions and appeals | Direct unlogged changes to other modules |
| Policy & Operations | Versioned operating configuration, approval requests, incident controls/kill switches, work queues and SLAs | Direct mutation of module-owned order or money records |
| Reporting | Read models, metrics, exports, vendor health calculations | Authoritative transaction records |
| Audit | Actor, action, target, before/after metadata, reason, timestamp, request correlation | Mutable operational state |

### Module boundary rules

- Modules expose application-level commands and queries, not unrestricted table access.
- Cross-module writes happen through a coordinating use case inside one database transaction where consistency is required.
- Asynchronous reactions use domain events written through a transactional outbox.
- Reporting reads replicas or projection tables and never changes operational records.

## 8. Data architecture

### 8.1 System-of-record entities

```text
Customer ──< Address
    │
    ├──< FavouriteStore >── VendorLocation >── Vendor
    │                              │
    │                              ├──< Product
    │                              └──< ServiceZone
    │
    └──< Cart ──< CartVendorGroup ──< CartLine
            │
            └── creates ──> CheckoutGroup ──< Order >── VendorLocation
                                      │           │
                                      │           ├──< OrderLine
                                      │           ├──< OrderAdjustment
                                      │           ├──< SubstitutionRequest
                                      │           ├──1 Fulfilment ──0..1 DeliveryAssignment >── DeliveryPartner
                                      │           ├──< LedgerEntry
                                      │           ├──< OrderEvent
                                      │           └──< SupportCase
                                      ├──< PaymentTransaction
                                      └──< PaymentAllocation >── Order

Product ──< InventoryReservation >── Order
Order ──1 Fulfilment ──< AssignmentAttempt >── DeliveryPartner
AssignmentAttempt ──< CustodyEvent
AssignmentAttempt ──0..1 ReturnTask
DeliveryPartner ──< LocationSample
DeliveryPartner ──< EarningAdjustment ──0..1 SupportCase

Actor ──< ApprovalRequest >── ProtectedAction
ConfigurationKey ──< ConfigurationVersion
IncidentControl ──> ConfigurationVersion
Participant ──< VerificationDocument ──< DocumentReview
RiskSignal ──< TrustReview ──0..1 Restriction
FinanceException ──> PaymentTransaction / PaymentAllocation / LedgerEntry
```

### 8.2 Important modelling rules

- Every vendor location is a separate fulfilment node with its own hours, catalogue overrides, service zones, and operational status.
- Product availability records support `AVAILABLE`, `LOW_STOCK`, `VENDOR_CONFIRMS`, and `OUT_OF_STOCK`, with maximum quantity, optional expiry for temporary unavailability, alternative pack references, and an internal last-confirmed timestamp. Vendor reminders may request reconfirmation without converting stale state into a false availability guarantee.
- Reservation states are `SOFT_HELD`, `PROVISIONAL`, `COMMITTED`, `RELEASED`, and `EXPIRED`. Cart lines do not reserve stock. Checkout may create a short soft hold; order placement creates a provisional reservation; vendor acceptance commits it; decline, timeout, cancellation, or expiry releases it. Counted stock uses atomic conditional updates so concurrent requests cannot over-reserve. `VENDOR_CONFIRMS` stock never claims a hard reservation.
- An MVP cart may contain several vendor-location groups, initially capped by configurable launch policy (default three for validation). Every cart line belongs to exactly one vendor group.
- Checkout creates one immutable `CheckoutGroup` and one child `Order` per vendor location. No `Order` may span vendors, and vendors cannot read or mutate sibling orders.
- Each child order owns its acceptance, substitutions, fulfilment, delivery fee, cancellation, refund allocation, settlement, and terminal state. The checkout-group state is a projection of child states, not a shortcut that overwrites them.
- Order lines snapshot title, unit, tax treatment, list price, charged price, and vendor SKU. Later catalogue edits never rewrite completed-order history.
- Monetary values use integer minor units, such as paise, never floating-point numbers.
- Timestamps are stored in UTC and rendered in the user's local timezone.
- Addresses keep both structured fields and a geospatial point. Access to exact customer coordinates is restricted.
- Variable-weight lines store requested quantity, permitted variance, final measured quantity, and the customer's approval rule.
- Ledger entries are append-only. Corrections use reversing or adjusting entries rather than editing history.

### 8.3 Storage responsibilities

| Store | Data |
|---|---|
| PostgreSQL | Users, vendors, products, carts, orders, fulfilment, money ledger, support, audit, configuration |
| PostGIS | Vendor coordinates, address points, service-zone polygons, distance and eligibility queries |
| Redis | Rate limits, expiring OTP metadata, cache, job queue, short-lived presence and assignment offers |
| Object storage | Product images, vendor verification documents, issue photos, generated reports |
| Analytics store, later | Aggregated events and operational metrics after volume justifies separate storage |

Object storage references live in PostgreSQL with classification, owner, retention policy, checksum, and access state.

## 9. Checkout-group and order state machines

The checkout group is a customer-facing projection across vendor orders:

```text
PROCESSING ──> ACTIVE ──> PARTIALLY_COMPLETED ──> COMPLETED
     │            │                 ▲
     │            └──> PARTIALLY_CANCELLED ─────┘
     └──> CANCELLED when every vendor order fails
```

Changing the checkout-group projection never changes a child order. It is recalculated from authoritative vendor-order states and payment/refund allocations.

Each vendor order uses the following state machine:

The order module is authoritative for each vendor-order lifecycle.

```text
                    ┌──────────────┐
                    │   CANCELLED  │
                    └──────▲───────┘
                           │ valid cancellation rule
PLACED ──> ACCEPTED ──> PICKING ──> READY ──> OUT_FOR_DELIVERY ──> DELIVERED ──> COMPLETED
   │            │           │          │
   │            │           └──> AWAITING_CUSTOMER_DECISION
   │            │                         │
   │            └─────────────────────────┘
   │
   └──> EXPIRED / CANCELLED when vendor response SLA is missed
```

Pickup orders move from `READY` to `PICKED_UP`, then `COMPLETED`.

Every transition records:

- Previous and next state
- Actor and role
- Timestamp
- Reason or supporting metadata
- Correlation and idempotency keys

Invalid transitions return a conflict response. No client may set an arbitrary status directly.

A platform-delivery cancellation after the assignment reaches `PICKED_UP` cannot jump directly to order `CANCELLED`; it must enter the controlled delivery-failure/return workflow so custody and partner compensation remain attributable. Order `PICKED_UP` on the separate customer-pickup path means the customer collected the package and proceeds to `COMPLETED`.

## 10. Delivery assignment state machine

```text
UNASSIGNED ──> OFFERED ──> ASSIGNED ──> AT_VENDOR ──> PICKED_UP
    ▲              │           │                           │
    │              └─ expired/declined                     ▼
    │                                              EN_ROUTE_TO_CUSTOMER
    │                                                       │
    │                                                       ▼
    └──────── reassignment when safe                    ARRIVED
                                                            │
                                             ┌──────────────┴─────────────┐
                                             ▼                            ▼
                                         DELIVERED                  DELIVERY_FAILED
                                                                          │
                                                                          ▼
                                                                    RETURN_REQUIRED
                                                                          │
                                                                          ▼
                                                                   RETURN_AUTHORIZED
                                                                          │
                                                                          ▼
                                                              RETURNING ──> RETURNED
```

A job offer reveals only approximate pickup/drop areas. Exact customer address and masked contact become available only after assignment under the active-delivery policy.

Each `AssignmentAttempt` belongs to one vendor order by default. Expiry, decline, partner inability, no movement, connectivity loss, vehicle failure, vendor delay, admin reassignment, and customer cancellation append a terminal attempt event rather than overwriting history. Reassignment carries forward the safe order context while preserving prior wait pay, return pay, ETA changes, reason/actor, and custody state.

### 10.1 Waiting, custody, and return state machines

```text
ASSIGNED ──> AT_VENDOR ──> WAITING ──> PICKUP_VERIFIED ──> IN_CUSTODY
                            │                 │
                            ├──> REASSIGNED   └──> DELIVERY_FAILED ──> RETURN_REQUIRED
                            │                                            │
                            └──> CANCELLED_BEFORE_CUSTODY                 ▼
                                                     RETURN_AUTHORIZED ──> RETURNING ──> RETURNED
```

- `AT_VENDOR` starts a server-authoritative waiting timer after trusted geofence and/or vendor confirmation. Thresholds determine wait compensation and when leave/reassign/support actions become available.
- `PICKUP_VERIFIED` requires vendor/order identity, package count/condition, handling flags, OTP/QR, and vendor confirmation. It appends a custody event; later package changes require an exception event.
- Reassignment after custody is prohibited unless an authorized custody-transfer or return event closes the previous partner's responsibility.
- `ReturnTask` stores authorization, reason, destination, package expectations, perishable/damage instructions, vendor availability/refusal outcome, proof, compensation, and completion state.

## 11. Critical transaction flows

### 11.1 Multi-store quote and checkout

```text
Customer → Cart API: request checkout-group quote
Cart API → Vendor/Catalogue: validate each vendor group and product availability
Cart API → Fulfilment: validate address/pickup point, zone, method, and slot per vendor
Fulfilment → Maps adapter: calculate each required vendor-to-customer route
Cart API → Pricing: calculate per-vendor items, tax, delivery fee, discounts, tip, and authorization buffer
Cart API → Customer: signed expiring vendor quotes plus combined checkout-group quote
Customer → Order API: place grouped checkout with quote ID + idempotency key
Order API → Payment adapter: authorize combined amount
Order API → Database: atomically create checkout group, one order per vendor, allocations, payment reference, events, and outbox records
Worker → Each vendor: its own new-order notification
```

The server rejects an expired or changed vendor quote and returns a replacement that identifies the affected store group. Repeated placement with the same idempotency key returns the same checkout group and child orders. The customer sees every vendor's fee and fulfilment promise plus the combined authorization amount before committing.

Vendor orders are independent after creation. If one vendor declines or times out, accepted siblings continue, the failed order's allocated amount is voided or refunded, and the checkout group becomes partially accepted or partially cancelled. The platform does not silently move failed lines to another vendor. Initial delivery execution remains separate per vendor order; combined multi-pickup routing requires a later explicit dispatch decision.

### 11.2 Vendor acceptance and preparation

```text
Vendor → Order API: accept order with preparation estimate
Order API → Database: validate SLA and move PLACED → ACCEPTED
Vendor → Order API: record unavailable item / final weight / substitute
Order API → Customer: approval request when policy requires it
Customer → Order API: approve or reject adjustment
Order API → Payment module: update planned capture or refund difference
Vendor → Fulfilment API: mark packed and ready
Fulfilment API → Dispatch: create delivery request or pickup notification
```

### 11.3 Delivery and settlement

```text
Dispatch → Partner: offer job with expected earnings
Partner → Dispatch: accept assignment
Partner → Fulfilment: confirm pickup using OTP/QR
Fulfilment → Customer: out-for-delivery notification
Partner → Fulfilment: submit customer OTP and proof metadata
Fulfilment → Orders: mark delivered
Orders → Payments: calculate final approved amount per vendor order
Payments → Payment adapter: capture the aggregate eligible amount or execute the provider-approved equivalent
Payments → Ledger: post checkout-level payment and vendor-order allocations for customer, vendor, partner, platform, tax, fee, discount, refund, and tip entries
Settlement worker → Payout provider: create eligible vendor/partner payouts
Reconciliation worker → Gateway records: verify captures, refunds, and payouts
```

Settlement occurs only after the configured completion or dispute window. Webhooks are verified, stored, deduplicated, and processed asynchronously.

## 12. Pricing and financial integrity

### 12.1 Delivery quote

A configurable initial model is:

```text
delivery_fee = base_fee + max(0, route_distance_km - included_km) × per_km_fee
```

The pilot example is ₹15 base, 2 km included, then ₹8 per km. A 5 km order therefore produces a ₹39 delivery fee. This is a validation assumption, not a permanent constant.

The quote stores the formula version, route distance, configuration inputs, amount, currency, expiry, and source coordinates. Never recalculate historical orders using current fee rules.

### 12.2 Financial invariants

- A vendor fee is created only for a successfully completed order under the active fee policy.
- A checkout-group payment is fully allocated to vendor orders using immutable allocation records. Allocations, partial captures, voids, and refunds must reconcile to the provider transaction and the balanced ledger.
- A vendor decline, timeout, cancellation, or refund changes only that vendor order's allocation unless a published customer action explicitly cancels other orders.
- Platform-caused failures and fully refunded orders do not retain the normal vendor fee unless a published policy explicitly allows it.
- A partner's displayed job earning is preserved after acceptance except for a transparent, auditable adjustment.
- The sum of ledger debits and credits for a transaction is zero.
- Payment authorization, capture, refund, and payout use unique idempotency keys.
- Provider webhook state never overwrites a newer internal state without reconciliation review.
- Manual money adjustments require privileged access, a reason, and dual approval above a configured threshold.
- Waiting pay, return pay, reassignment adjustments, and earning disputes are immutable partner-order ledger components. A correction records original amount, replacement/adjustment amount, reason, actor, approval, and linked case.

## 13. Asynchronous processing

Use a transactional outbox: save the business change and an event record in the same PostgreSQL transaction. A worker later publishes or handles the event. This prevents an accepted order from being saved without its notification or follow-up job being scheduled.

New-order notification escalation is driven by server deadlines, not client timers: initial push/audible alert, reminder push, SMS/provider fallback, then vendor-order expiry. Every attempt is deduplicated and recorded with device/provider outcome. Vendor device registration and staff escalation order are server-managed.

Example events:

- `checkout_group.placed`
- `checkout_group.partially_accepted`
- `checkout_group.partially_cancelled`
- `inventory.soft_hold_created`
- `inventory.reservation_committed`
- `inventory.reservation_released`
- `order.placed`
- `order.accepted`
- `order.vendor_response_expired`
- `order.customer_decision_required`
- `fulfilment.ready`
- `delivery.assignment_offered`
- `delivery.assignment_reassigned`
- `delivery.wait_threshold_reached`
- `delivery.custody_started`
- `delivery.return_authorized`
- `delivery.return_completed`
- `delivery.picked_up`
- `delivery.completed`
- `payment.captured`
- `refund.completed`
- `settlement.eligible`
- `vendor.document_expiring`
- `approval.requested`
- `incident_control.activated`
- `trust.review_opened`

Event payloads contain identifiers and necessary facts, not full customer profiles or prescription data. Consumers deduplicate by event ID and record their processing result.

## 14. External integrations

| Integration | Internal boundary | Failure strategy |
|---|---|---|
| Payment gateway | Payment provider adapter | Idempotent requests, signed webhooks, polling reconciliation, manual review queue |
| Payout provider | Payout adapter | Retry transient failures, reconcile provider statements, block duplicate payout keys |
| Maps/geocoding | Location adapter | Cache stable geocodes, use bounded retry, allow admin/partner incorrect-pin reports; always retain text address, landmark, instructions, and preferred-map deep-link fallback |
| SMS/OTP | Messaging and identity adapters | Rate limit, provider fallback where justified, never log OTP content |
| Push notifications | Notification adapter | Treat as best-effort; retain in-app authoritative state |
| Email | Notification adapter | Retry and suppress repeated permanent failures |
| Object storage | Document adapter | Signed short-lived URLs, malware scanning, checksums, access logging |
| POS/inventory, later | Vendor integration adapter | Per-vendor sync cursor, conflict policy, import audit log |

Provider callbacks enter through dedicated webhook endpoints. Each endpoint verifies the provider signature before acknowledging the event.

## 15. API design

The exact MVP endpoint inventory, common error envelope, optimistic concurrency, idempotency requirements, impact-token pattern, and asynchronous response rules are authoritative in `implementation.md` §7. This section defines architecture-level API principles.

Use versioned HTTPS JSON APIs. REST is sufficient for transactional commands and queries; real-time status can use server-sent events or managed push notifications before adding WebSockets.

API conventions:

- Use opaque resource IDs, not sequential public identifiers.
- Require an idempotency key for checkout-group creation, vendor-order creation, payment, refund, assignment acceptance, and proof submission.
- Return machine-readable error codes plus safe human-readable messages.
- Use cursor pagination for products, orders, vendors, and audit history.
- Accept a request correlation ID and return it in errors and logs.
- Enforce authorization on the server for every resource, not only at route level.
- Avoid returning exact customer location or contact information in list APIs.
- Separate command endpoints from unrestricted record updates. For example, use `/orders/{id}/accept` rather than allowing clients to patch `status`.

The exact endpoint catalogue should be written after the domain model and client choice are approved.

## 16. Authentication and authorization

### 16.1 Authentication

- Customers, vendors, and partners may begin with phone OTP authentication.
- Admins require stronger authentication, preferably passkeys or password plus phishing-resistant multi-factor authentication.
- Sessions use short-lived access tokens and rotated refresh tokens stored securely by the client.
- OTP attempts, resend frequency, login devices, and suspicious patterns are rate-limited and monitored.

### 16.2 Authorization

Use role-based access plus resource attributes:

- A customer can read only their own orders, addresses, payments, and cases.
- Vendor staff can access only assigned vendor locations and actions allowed by their staff role.
- A delivery partner can access only an offered or active assignment under its data-disclosure stage.
- Support agents receive the minimum tools needed for their queue.
- Finance operators can reconcile money but cannot approve vendors unless separately authorized.
- High-risk admin permissions are separated and reviewed regularly.

Authorization decisions should be centralized in policy functions with automated tests.

### 16.3 Admin separation and maker-checker approval

Admin permissions are capabilities, not a single `admin` boolean. Initial roles are vendor onboarding, partner onboarding, catalogue moderation, live operations, customer support, finance, trust and safety, compliance, reporting, and exceptional super admin.

| Capability boundary | Rule |
|---|---|
| High-value refund | Support proposes; authorized finance approver decides above threshold |
| Bank or payout-account change | Onboarding/support may collect; finance verifies and a second actor approves |
| Vendor/partner suspension | Trust/operations proposes with evidence; second approver required by severity policy |
| Fee, zone, earning, timeout, or refund-policy change | Drafted as versioned configuration; reviewed and activated by a different authorized actor |
| High-risk document approval | Compliance review plus maker-checker when category policy requires it |
| Manual reconciliation | Finance proposes the linked adjustment; separate approval above threshold |
| Reporting | Masked read models only; no mutation or unnecessary bank/contact access |
| Super admin | Time-bounded exceptional use with enhanced reason, alerting, and audit review |

`ApprovalRequest` stores proposer, proposed command and impact snapshot, threshold/policy version, approver, decision, reason, expiry, and execution reference. The proposer cannot approve their own protected action.

## 17. Security and privacy

### Data classification

| Class | Examples | Controls |
|---|---|---|
| Public | Published store name, hours, catalogue, approximate area | Integrity controls and moderation |
| Internal | Operational metrics, vendor health, configuration | Authenticated role access |
| Confidential | Customer address, phone, bank details, identity documents | Encryption, field masking, strict access, audit logs |
| Restricted | Prescription data, controlled-product evidence, security secrets | Separate access boundary, minimum retention, enhanced audit and legal review |

### Required controls

- TLS for all network traffic and managed encryption for databases, caches, and object storage.
- Secrets stored in a secrets manager, never source code or logs.
- Personally identifiable information removed or masked in logs and analytics.
- Short-lived signed URLs for protected documents.
- Malware scanning and type/size validation for uploads.
- Verified payment and payout webhooks with replay protection.
- Immutable audit events for approvals, suspensions, refunds, payouts, document access, and configuration changes.
- Data-retention jobs for expired OTP metadata, location history, inactive documents, and support evidence.
- Assignment-stage location policy: collect only after consent and operational need; use lower frequency outside active navigation, higher frequency only during active travel, bounded encrypted offline buffering, and immediate active-sharing stop when delivery/return responsibility ends. Retention duration remains an explicit legal/product decision before launch.
- Live partner location is visible only to the assigned operations/support roles and, where approved, the active customer order. Permission denial/withdrawal produces a capability-limited state and never silently continues tracking.
- Device/risk signals such as mock GPS, reused proof, implausible travel, wrong-location completion, multi-device/account sharing, compromised-device indicators, repeated unreachable claims, excessive proof failures, and possible collusion create `TrustReview` records. No single signal alone causes an irreversible restriction.
- Dependency, container, and infrastructure scanning in continuous integration.
- Tested incident-response and account-recovery procedures before public launch.

## 18. Pharmacy isolation

Pharmacy support remains disabled until legal and operational approval. When introduced:

- Store prescription files in a restricted document bucket with a separate access policy.
- Keep prescription metadata out of general analytics, notifications, and delivery events.
- Require verified pharmacy staff to approve prescription orders.
- Prohibit automatic medicine substitution.
- Reveal only package handling instructions to delivery partners, never prescription contents.
- Define jurisdiction-specific retention and deletion policies before accepting uploads.

If pharmacy volume becomes material, extract prescription processing into a separately deployed security boundary.

## 19. Reliability and consistency

### Availability targets

Initial service objectives should be measured before aggressive promises. Suggested MVP targets:

- 99.9% monthly availability for checkout and active-order APIs.
- 99.5% monthly availability for catalogue management and reporting.
- No acknowledged order or captured payment may be lost.
- Payment and settlement reconciliation completes daily, with exceptions visible to operations.

### Failure handling

- Use bounded retries with exponential backoff and randomness for transient provider failures.
- Send exhausted jobs to a dead-letter queue with an operations runbook.
- Put timeouts on all external calls and isolate failing providers with circuit breakers.
- Use database transactions for order and ledger invariants.
- Avoid distributed transactions. Coordinate external steps using durable state, outbox events, and reconciliation.
- Store webhook receipts before processing and return success only after durable acceptance.
- Finance exceptions use durable queues for authorized-without-checkout, unknown checkout payment, capture failure, capture/allocation mismatch, duplicate webhook, refund failure, vendor settlement mismatch, partner earning mismatch, payout failure, and unmatched provider statement. Queue records include severity, amount at risk, age, owner, last retry, next safe action, audit history, and linked provider/internal references.
- Operational work is ranked safety → payment/ledger → stuck customer decision → expiring vendor acceptance → excessive partner wait → delivery failure → return required → overdue refund → payout failure → routine work. Each item has an owner and SLA; dashboards never replace this action queue.

### Versioned configuration and incident controls

Operational configuration follows `DRAFT → REVIEW → SCHEDULED → ACTIVE → SUPERSEDED`, with controlled rollback creating a new active version rather than rewriting history. Orders, quotes, assignments, approvals, and ledger entries reference the effective versions they used.

Versioned keys include delivery fees, zones, vendor fees, partner earnings/wait/return pay, cancellation/refund rules, response/offer timers, maximum stores per cart, order-capacity rules, and approval thresholds.

Kill switches are versioned, reversible incident controls for a vendor, category, zone, platform delivery, payment method, promotion, new grouped checkout, substitutions, or provider adapter. Activation requires impact preview, reason, actor, activation time, expiry or manual-resume rule, notification plan, and audit event. A kill switch prevents new affected work and uses explicit recovery policy for in-flight work; it never mass-mutates historical state.
- Make notification failures visible but never treat a push notification as authoritative order state.

### Backup and recovery

- Automated point-in-time database recovery.
- Encrypted object-storage versioning where policy permits.
- Regular restore tests, not only successful backup reports.
- Document recovery-point and recovery-time objectives before public launch.

## 20. Performance and scaling

### MVP targets

- Nearby-store and store-page responses under 3 seconds on standard mobile networks.
- Server processing under 500 ms at the 95th percentile for common reads, excluding external provider time.
- Core checkout commands under 2 seconds, excluding payment UI and provider latency.
- New-order notification queued within seconds of durable order creation.

### Scaling approach

1. Add appropriate indexes, including vendor location, product lookup, order status/time, partner availability, and ledger references.
2. Cache public store and catalogue reads with short expiry and event-driven invalidation.
3. Move search to a dedicated engine only when PostgreSQL search quality or load becomes inadequate.
4. Add read replicas for reporting before splitting transactional modules.
5. Partition high-volume append-only tables, such as events, audit logs, and location samples, by time or zone when evidence requires it.
6. Separate high-frequency partner location ingestion from the core API before it threatens checkout latency.

## 21. Observability

Every request and background job carries a correlation ID across modules and provider calls.

### Logs

Use structured logs containing service, environment, correlation ID, actor type, safe resource IDs, outcome, duration, and error code. Do not log OTPs, access tokens, bank details, prescriptions, complete addresses, or payment credentials.

### Metrics

Monitor both technical and business health:

- API latency, error rate, saturation, database connections, queue depth, job age
- OTP failure and abuse rates
- Payment authorization, capture, refund, payout, and reconciliation failures
- Vendor acceptance time and SLA expiry
- Checkout-group partial acceptance/cancellation and payment-allocation mismatch rates
- Preparation, pickup wait, and delivery duration
- Assignment acceptance and reassignment rate
- Cancellation, substitution, support-case, and refund rates
- Contribution per completed order by zone, distance, category, and basket value

### Traces and alerts

Distributed traces cover checkout, order acceptance, dispatch, payment, and settlement. Alerts must link to a runbook and distinguish customer-impacting failures from delayed internal work.

## 22. Environments and delivery pipeline

Development starts locally on company-controlled machines using documented, reproducible tooling such as containers, local PostgreSQL/PostGIS, local Redis, synthetic data, and sandbox or fake provider adapters. The team must be able to build, run, test, migrate, seed, and reset the application locally without production credentials or production data.

Local development and tests come before cloud deployment. Passing locally does not authorize publishing the system or imply production readiness. After the relevant decision gates are approved, add a shared non-production environment for integration testing, then staging, and only later production. Shared development, staging, and production use separate data and provider credentials.

The continuous delivery pipeline should:

1. Run formatting, type checks, unit tests, integration tests, dependency scans, and secret scans.
2. Build immutable application images that use the same application configuration contract verified locally.
3. Apply backward-compatible database migrations before or alongside deployment.
4. Deploy first to an approved shared non-production environment and run integration tests with synthetic data and sandbox providers.
5. Deploy the same artifact to staging and run smoke tests for login, store discovery, order placement, vendor acceptance, assignment, and refund.
6. Promote the same artifact to production only after separate launch approval using a controlled rollout.
7. Verify health metrics and support rollback without reversing already-applied business events.

Database migrations follow expand-and-contract changes: add compatible fields first, deploy readers/writers, migrate data, then remove old fields in a later release.

## 23. Testing strategy

The minimum layer coverage, 15 mandatory end-to-end scenarios, per-slice gates, and release acceptance are authoritative in `implementation.md` §§12–16.

| Test level | Primary coverage |
|---|---|
| Unit | Pricing rules, state transitions, authorization policies, fee eligibility, ledger balancing |
| Module integration | Database transactions, outbox publishing, catalogue snapshots, assignment concurrency |
| Provider contract | Payment, payout, maps, SMS, push, and storage adapters against sandbox/fixtures |
| End-to-end | Grouped customer checkout through independent vendor acceptance, partial decline/timeout, delivery proofs, allocated capture/refund, and settlement eligibility |
| Security | Broken object authorization, role escalation, OTP abuse, webhook forgery, upload handling |
| Resilience | Duplicate grouped checkout, partial vendor failure, delayed webhooks, provider outage, allocation mismatch, queue retry, database failover |
| Performance | Nearby-store search, large catalogues, active-order polling, dispatch bursts |

Critical invariants should use property-based tests where practical, especially money conservation, idempotency, and legal state transitions.

## 24. Approved internal-development technology baseline

The internal-development choices below are approved by D-02, D-03, and [ADR-001](docs/architecture/ADR-001-internal-development-stack.md). Managed services and production deployment remain recommendations only.

| Layer | Recommendation | Reason |
|---|---|---|
| Web clients | Next.js with TypeScript | Responsive web, server-rendered store pages, shared language with backend |
| Android client | Expo and React Native with TypeScript, developed alongside the PWA | Native Android path with shared contracts but platform-specific UX |
| Backend | NestJS with TypeScript and Fastify in a modular monolith | Strong module structure, stateless APIs, independent workers, and later extraction boundaries |
| Database | Local PostgreSQL 18 with PostGIS 3.6 | Transactions plus geographic queries; future managed provider undecided |
| Cache/jobs | Valkey preferred with BullMQ; Redis 7.2 compatibility fallback | Free local cache, timeouts, retries, and scheduled work |
| Object storage | Local filesystem adapter | Free synthetic testing behind a replaceable interface |
| Deployment | Standard local `compose.yaml` through Podman Desktop or Docker Compose | Reproducible company development; hosting remains undecided |
| Observability | OpenTelemetry plus managed logs, metrics, traces, and error reporting | Provider-neutral instrumentation and faster incident diagnosis |

A serverless platform is suitable for web rendering and light APIs, but long-running workers, connection limits, queue processing, and background location workloads must be evaluated explicitly.

## 25. Trade-offs and rejected early approaches

### Modular monolith instead of microservices

One backend reduces deployment, tracing, data-consistency, and on-call complexity. The trade-off is that module boundaries require discipline and one release can affect all domains. This is acceptable before separate teams and independently scaled workloads exist.

### PostgreSQL search before a dedicated search engine

PostgreSQL full-text search plus `pg_trgm` can support initial vendor, brand, category, product, common-misspelling, synonym, and transliteration search. Store normalized recent-search references and privacy-safe funnel events for zero-result, result-click, and search-to-cart analysis. A dedicated search engine may later improve ranking and scale, but adds synchronization and operations work before search volume is known.

### Simultaneous PWA and Android development

The owner selected one Next.js PWA and one Expo/React Native Android app for each of Customer, Vendor, Delivery Partner, and Admin in the same development phase. This creates eight role clients and costs more coordination than a sequential client rollout. Shared contracts reduce semantic drift, while screens, navigation, offline behaviour, accessibility, and device integration remain platform-specific.

### Manual dispatch before route optimisation

Manual dispatch exposes actual pickup delay, partner supply, and exception patterns. Automated routing before those facts exist would encode guesses. The trade-off is limited pilot volume and higher operations effort.

### Multi-store cart with vendor-scoped orders

Customers may combine several named stores in one cart and one checkout, but the backend never creates a cross-vendor order aggregate. A checkout group coordinates the customer-facing payment and summary while one child order per vendor preserves ownership, acceptance, substitutions, fulfilment, cancellation, refunds, settlement, and audit isolation. This improves customer convenience at the cost of more explicit partial-success and money-allocation handling. Separate fulfilments are the safe launch default; route consolidation comes only after operational evidence.

## 26. Production architecture gates

The canonical gate register is `implementation.md` §3. The list below explains the architecture subjects that those gates must settle before their affected production slice is enabled:

1. Public release sequence and distribution controls for the approved PWA and Android clients.
2. Hosting provider, shared-environment topology, rollback, recovery, operating cost, and production capacity.
3. Payment gateway, payout provider, grouped-authorization/partial-capture or refund behavior, and allocation reconciliation. COD remains disabled.
4. Delivery-distance source, fee formula, rounding rules, maximum radius, and quote expiry.
5. Vendor fee amount and the exact definition of a successfully completed order.
6. Delivery-partner engagement, insurance, safety, cash handling, and payout model.
7. Service-zone representation: radius, pin codes, polygons, or a combination.
8. Vendor catalogue import and stock-accuracy operating model.
9. Data-retention periods and India-specific privacy/legal requirements.
10. Pharmacy launch criteria and compliance owner for a separate future release; pharmacy remains disabled in the MVP.
11. Support coverage, refund authority, and financial adjustment thresholds.
12. Recovery objectives and public service-level promises.

## 27. Implementation sequence

This is the architecture dependency summary. `implementation.md` §12 is authoritative for the vertical slices, dependencies, and pass/fail exit gates.

1. **Pilot ledger and manual operations:** validate paid checkout, distance fee, vendor preparation, rider cost, and repeat demand.
2. **Foundation:** identity, vendor/location, catalogue, customer address, audit, provider interfaces, and deployment pipeline.
3. **Order core:** multi-store cart groups, per-vendor quotes, checkout-group aggregate, vendor-scoped order state machines, idempotency, independent vendor acceptance, partial-failure handling, and notifications.
4. **Fulfilment:** pickup, partner eligibility, manual assignment, OTP/QR handoff, exceptions, and active-order tracking.
5. **Money:** authorization/capture, append-only ledger, refunds, vendor fee, partner earning, payout, and reconciliation.
6. **Operations:** vendor/partner approval, live order monitor, support cases, refund tooling, finance exceptions, and reports.
7. **Hardening:** security tests, load tests, backup restore, incident runbooks, privacy retention, and staged rollout.

Each step must produce a complete, supportable vertical slice. Do not postpone reconciliation, audit, or recovery until after money begins moving.

## 28. Definition of architecture readiness

Implementation can begin when:

- The pilot category, neighbourhood, radius, and delivery model are selected.
- Customer and vendor fee policies are written with examples and refund behavior.
- Order, fulfilment, payment, refund, and settlement state machines are approved.
- The initial data model and authorization matrix are reviewed.
- Payment, payout, maps, OTP, push, and storage providers are selected or represented by tested adapters.
- Privacy, delivery-partner safety, and pharmacy exclusions are documented.
- Monitoring, reconciliation, backup, and support ownership are assigned.
- Major technology choices are captured in architecture decision records.

Until those decisions are made, this document is a reference design rather than a production commitment.
