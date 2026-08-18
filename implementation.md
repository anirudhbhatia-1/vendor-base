# Implementation Blueprint — Neighbourhood Store Marketplace

**Status:** Build contract for the MVP
**Version:** v0.2 · synchronized 13 August 2026
**Applies to:** Customer App/Web, Vendor Portal, Delivery Partner App/Portal, Admin Console, backend, workers, data, integrations, and operations
**Related documents:** [README](README.md) · [PRD](prd.md) · [Architecture](architecture.md) · [Design](design.md) · [Workflow](workflow.md) · [AI Rules](rules.md)

## 1. Purpose and document authority

This document converts the approved product behavior into an implementation sequence. It is the shared contract for identifiers, state names, commands, events, timers, data ownership, API behavior, background work, and acceptance tests.

When documents appear to overlap, use this ownership order:

| Question | Authoritative document |
|---|---|
| Product outcome, actor need, MVP inclusion | `prd.md` |
| Domain ownership, persistence, state machines, security, reliability | `architecture.md` |
| Screen hierarchy, interaction, accessibility, responsive behavior | `design.md` |
| Cross-role chronology and operational handoffs | `workflow.md` |
| Exact build slices, API contracts, timers, jobs, and test gates | `implementation.md` |
| Contributor authority and prohibited actions | `rules.md` |
| Product summary and navigation to the other documents | `README.md` |

If two documents conflict, implementation stops for a documented decision. No engineer should silently choose whichever version is easier.

## 2. Locked MVP decisions

These are product decisions, not suggestions:

| Area | Locked decision |
|---|---|
| Marketplace | Customers choose named local vendor locations; the platform owns no inventory and operates no dark store. |
| Cart | One cart may contain several vendor-location groups; initial policy defaults to at most 3 groups. |
| Order boundary | One checkout group creates exactly one child order per vendor location; an order never spans vendors. |
| Fulfilment | Each child order has its own pickup/delivery method, fee, promise, assignment, custody, and terminal result. Consolidated pickup is disabled. |
| Payments | MVP is prepaid through UPI, card, or supported wallet. COD is hidden. |
| Substitution | Default is no substitution. Any replacement or material price/weight change follows the customer's recorded rule or explicit decision. |
| Inventory | Cart does not reserve. Checkout may soft-hold counted stock. Placement is provisional. Vendor acceptance commits. Failure releases. |
| Vendor response | Default response deadline is 5 minutes and is server-owned. |
| Proof | Customer pickup and delivery use server-validated OTP by default; QR may support vendor-to-partner pickup. Alternative proof requires an approved policy and support path. |
| Delivery assignment | One active assignment per vendor order by default. Reassignment appends a new attempt and preserves history. |
| Custody | Server-confirmed pickup starts custody. Cancellation after custody becomes a controlled return. |
| Money | All values use integer minor units and explicit currency. Ledger history is append-only and balanced. |
| Admin | Least privilege, attributable actions, and maker-checker approval for protected actions. |
| Language/theme | English and Hindi; white/light visual theme only. |
| Development sequence | Build and test locally inside the company first. Cloud non-production and production deployment require later approved gates; local completion never implies production readiness. |
| Disabled scope | Pharmacy ordering, COD, automatic route optimization, cross-store route consolidation, owned inventory, sponsored ranking, and a 10-minute promise. |

## 3. Pre-build decision gates

Implementation may build provider-neutral interfaces before these are decided, but production launch cannot pass the named gate.

| ID | Decision | Accountable owner | Due date | Blocks | Required evidence/output |
|---|---|---|---|---|---|
| D-01 | Launch neighbourhood and vendor cohort | Product/operations | — | Pilot recruitment and production zones | Named zones, 3–10 pilot vendors, initial catalogues, support hours |
| D-02 | Primary clients and delivery sequence | Engineering Lead | **21 August 2026** | Public client release only; local scaffolding may proceed | Approved PWA and Android app for each of Customer, Vendor, Delivery Partner, and Admin, with bounded shared code |
| D-03 | Internal development technology foundation | Engineering Lead | **28 August 2026** | Hosting, shared cloud test/staging, recovery, and production foundation; local scaffolding may proceed | [ADR-001](docs/architecture/ADR-001-internal-development-stack.md), supported versions, local topology, compatibility and test gates |
| D-04 | Provider simulators and future real-provider gate | Finance/engineering | **4 September 2026** | Real authorization, messaging, maps, storage, refund, payout, credentials, and external side effects; local simulators may proceed | [Simulator contracts](docs/providers/simulator-contracts.md), real-provider conformance and canary gates |
| D-05 | Synthetic fee, earning, and settlement policy | Finance Lead | **11 September 2026** | Production quoting, tax, contracts, settlement, and payout; synthetic financial testing may proceed | [Versioned test policy and balanced examples](docs/finance/test-financial-policy.md) |
| D-06 | Internal delivery testing and future operating-model gate | Operations Lead | **18 September 2026** | Real recruitment, delivery, contracting, insurance, payout and partner production launch | Company-controlled synthetic cohort; production legal/operations evidence remains blocked |
| D-07 | Synthetic verification-document lifecycle | Compliance Lead | **25 September 2026** | Real document collection and vendor/partner publication | Fictional category-aware lifecycle; production requirements remain blocked |
| D-08 | Internal privacy, access, and synthetic retention | Privacy Lead | **2 October 2026** | Production personal data | [Synthetic schedule, access, consent, rights and location](docs/governance/internal-safety-and-production-transition.md); [production replacement register](docs/production/test-to-production-replacement-register.md) |
| D-09 | Internal support, incidents, and approval thresholds | Operations Lead | **9 October 2026** | Public service promises and production action authority | Internal hours, P0–P3 targets, maker-checker and synthetic thresholds |
| D-10 | Recovery targets and synthetic restore drills | Engineering Lead | **16 October 2026** | Public launch until recovery targets are proven | Tiered RPO/RTO, isolated restore, reconciliation and safe-resumption evidence |

D-03 selects the internal server-side software toolkit but intentionally does not select a hosting provider. The implementation sequence is local company development and testing first, followed by a future explicitly approved shared non-production environment, then staging, and only later a separately approved production release.

D-04 and D-05 approve deterministic simulators and synthetic money policy only. Future real adapters must pass the same contracts in sandbox and controlled company-account tests before a limited production canary. No synthetic amount is a production price, tax position, contract, or authorization to move money.

D-06 through D-09 approve only internal company testing with synthetic participants, documents, personal data, cases, incidents, and authority. D-10 approves recovery design targets and synthetic drills, not an achieved production capability. The canonical [test-to-production replacement register](docs/production/test-to-production-replacement-register.md) identifies every known fake, synthetic, local-only or unproven component; where and how it changes; the evidence and owner required; and its rollback or containment path.

The pilot formula of ₹15 including 2 route km plus ₹8 per additional route km, with a 40 route-km outer cap, is a versioned validation policy until D-05 is approved.

## 4. Canonical vocabulary and identifiers

### 4.1 Identifier format

Use opaque UUIDv7 identifiers internally. Public references use non-sequential prefixes and a short checksum; they are display references, never authorization secrets.

| Object | Internal field | Public example |
|---|---|---|
| Checkout group | `checkout_group_id` | `CG-7F3K9Q` |
| Vendor order | `order_id` | `ORD-4P8M2D` |
| Fulfilment | `fulfilment_id` | not normally shown |
| Assignment attempt | `assignment_attempt_id` | `JOB-8R2X6N` |
| Payment transaction | `payment_transaction_id` | support-only reference |
| Support case | `support_case_id` | `CASE-5H7T2W` |
| Approval request | `approval_request_id` | `APR-3C9J4K` |

Never accept a public reference alone as proof of ownership. Every read and command checks authenticated actor plus resource ownership/capability.

### 4.2 Time, quantity, and money

- Store timestamps as UTC instants; store the operating timezone IANA name on each vendor location and zone.
- Return timestamps as ISO 8601. Clients localize them but preserve the source timezone for scheduled fulfilment.
- Store money as `{ amount_minor: integer, currency: "INR" }`; never use floating point.
- Store distance in integer metres, weight in integer grams, and duration in integer seconds.
- Every configurable deadline stores `policy_key`, `configuration_version_id`, `starts_at`, and `expires_at`.
- Server time is authoritative. Clients display countdowns derived from `expires_at` and refresh on resume/reconnect.

### 4.3 Canonical aggregate ownership

| Aggregate | Owns | Must not own |
|---|---|---|
| Cart | Vendor groups, mutable lines, customer preferences | Authoritative stock or charged money |
| Checkout group | Child-order references, combined quote/payment summary, projected group state | Child order transitions |
| Vendor order | One vendor's line snapshots, decisions, state, allocated amounts | Sibling data or gateway payloads |
| Fulfilment | Method, promise, package metadata, delivery/customer-pickup result | Payment capture or settlement policy |
| Assignment attempt | One offer/partner attempt, wait, location/custody references | Order-line mutation |
| Payment transaction | Provider operation and verified result | Order-state authority |
| Ledger account/entry | Immutable accounting movement | Mutable operational status |
| Support case | Evidence, messages, ownership, proposed/resolved actions | Direct unlogged state mutation |
| Configuration version | Approved future behavior | Historical-order recalculation |

### 4.4 Canonical reason-code registry

Store stable uppercase codes and localize their labels in clients. `OTHER` always requires safe free text; free text never replaces the code.

| Family | Allowed codes |
|---|---|
| Vendor decline/cancel | `ITEM_AVAILABILITY_LOW`, `STORE_TOO_BUSY`, `CLOSING_SOON`, `CANNOT_MEET_SLOT`, `DELIVERY_UNAVAILABLE`, `CATALOGUE_PRICE_ERROR`, `CUSTOMER_REQUEST_UNFULFILLABLE`, `SAFETY_COMPLIANCE`, `OTHER` |
| Assignment end/reassign | `OFFER_EXPIRED`, `PARTNER_DECLINED`, `PARTNER_CANNOT_PROCEED`, `VEHICLE_PROBLEM`, `VENDOR_DELAY`, `CONNECTIVITY_LOSS`, `NO_MOVEMENT`, `ADMIN_REASSIGNED`, `CUSTOMER_CANCELLED_BEFORE_PICKUP`, `FAILED_PICKUP` |
| Delivery/return | `CUSTOMER_UNREACHABLE`, `INCORRECT_ADDRESS`, `UNSAFE_LOCATION`, `CUSTOMER_CANCELLED_AFTER_PICKUP`, `CUSTOMER_REFUSED`, `PACKAGE_DAMAGED`, `VENDOR_CLOSED`, `VENDOR_REFUSED_RETURN`, `PERISHABLE_POLICY`, `PROHIBITED_GOODS`, `OTHER` |
| Vendor support | `CUSTOMER_NOT_RESPONDING`, `PAYMENT_ADJUSTMENT_BLOCKED`, `RIDER_NOT_ASSIGNED`, `RIDER_LATE`, `PACKAGE_COUNT_DISPUTE`, `CUSTOMER_ARRIVED_EARLY`, `CUSTOMER_REFUSED_PICKUP`, `TECHNICAL_PROBLEM`, `UNSAFE_ABUSIVE_INTERACTION`, `ADMIN_INTERVENTION` |
| Partner earnings dispute | `MISSING_TRIP`, `INCORRECT_DISTANCE`, `MISSING_WAIT_PAY`, `MISSING_RETURN_PAY`, `TIP_DISCREPANCY`, `INCENTIVE_ELIGIBILITY`, `PAYOUT_FAILURE`, `UNAUTHORIZED_ADJUSTMENT` |
| Admin decision | Domain-specific code plus mandatory reason text for overrides, approval/rejection, restrictions, configuration, incident controls, reconciliation, and financial adjustments |

Adding a code is backward compatible. Reinterpreting or deleting a used code requires a migration, reporting update, translated-label update, and historical behavior note.

## 5. Canonical state contracts

### 5.1 State-transition record

Every order, fulfilment, assignment, payment, refund, payout, support, document, approval, configuration, and restriction transition writes:

```json
{
  "transition_id": "uuidv7",
  "aggregate_type": "order",
  "aggregate_id": "uuidv7",
  "from_state": "PLACED",
  "to_state": "ACCEPTED",
  "actor_type": "vendor_staff",
  "actor_id": "uuidv7",
  "reason_code": "VENDOR_ACCEPTED",
  "evidence_refs": [],
  "occurred_at": "2026-08-13T10:00:00Z",
  "request_id": "uuidv7",
  "correlation_id": "uuidv7",
  "idempotency_key": "opaque-client-key",
  "policy_versions": ["uuidv7"]
}
```

The transition and outbox event commit in the same database transaction. Invalid current state, actor, evidence, or duplicate intent returns a stable error without partial mutation.

### 5.2 Checkout-group projection

`PROCESSING`, `ACTIVE`, `PARTIALLY_CANCELLED`, `PARTIALLY_COMPLETED`, `COMPLETED`, `CANCELLED` are derived from child states. No command directly sets them.

### 5.3 Vendor order

Normal delivery path:

`PLACED → ACCEPTED → PICKING → READY → OUT_FOR_DELIVERY → DELIVERED → COMPLETED`

Customer-pickup path:

`PLACED → ACCEPTED → PICKING → READY → PICKED_UP → COMPLETED`

Decision branch:

`PICKING → AWAITING_CUSTOMER_DECISION → PICKING`

Terminal failure before custody:

`PLACED/ACCEPTED/PICKING/READY → CANCELLED`; `PLACED → EXPIRED`

After partner pickup, a cancellation request cannot set the order to `CANCELLED`; fulfilment enters return handling and the order resolves only after custody and financial treatment are recorded.

### 5.4 Inventory reservation

`SOFT_HELD → PROVISIONAL → COMMITTED → RELEASED` with `SOFT_HELD/PROVISIONAL → EXPIRED`. Counted stock changes use a row lock or conditional atomic update. `VENDOR_CONFIRMS` products record intent but never reduce an exact available count.

### 5.5 Assignment and custody

- Assignment: `UNASSIGNED → OFFERED → ASSIGNED → AT_VENDOR → PICKED_UP → EN_ROUTE_TO_CUSTOMER → ARRIVED → DELIVERED`.
- Attempt endings before pickup: `DECLINED`, `OFFER_EXPIRED`, `FAILED_PICKUP`, `REASSIGNED`, or `CANCELLED`.
- Failure after pickup: `DELIVERY_FAILED → RETURN_REQUIRED → RETURN_AUTHORIZED → RETURNING → RETURNED`.
- Custody: `NONE → PICKUP_VERIFIED → IN_CUSTODY → DELIVERED` or `RETURNED`/approved `TRANSFERRED`.

### 5.6 Payment and money

- Payment: `CREATED → AUTHORIZING → AUTHORIZED → CAPTURE_PENDING → CAPTURED`, with `FAILED`, `CANCELLED`, or `UNKNOWN_REQUIRES_RECONCILIATION` branches.
- Refund: `REQUESTED → PENDING_APPROVAL` when applicable → `SUBMITTED → SUCCEEDED`; failures remain `FAILED_RETRYABLE` or `FAILED_REVIEW`.
- Settlement/payout: `PENDING → ELIGIBLE → SCHEDULED → SUBMITTED → PAID`; exceptions use `HELD` or `FAILED_REVIEW` without deleting the payable balance.
- Support: `OPEN → ASSIGNED → AWAITING_EVIDENCE → RESOLUTION_PROPOSED → PENDING_APPROVAL → RESOLVED → CLOSED`, with `RESOLVED → REOPENED`.

## 6. Default timing policy and minute-by-minute execution

All durations below are launch defaults stored as versioned configuration, not constants in client code.

### 6.0 Non-time operating defaults

| Policy key | Validation default | Launch rule |
|---|---:|---|
| `cart.maximum_vendor_groups` | 3 | Versioned and customer-visible when reached |
| `fulfilment.consolidated_pickup_enabled` | `false` | Cannot be enabled without routing, custody, fee-allocation, and recovery approval |
| `substitution.default` | `NONE` | Customer may opt into another rule per item/group |
| `schedule.window_seconds` | 3600 | Capacity-backed vendor/category override allowed |
| `delivery.base_fee_minor` | 1500 | Approved synthetic D-05 policy only; production remains blocked |
| `delivery.included_distance_metres` | 2000 | Included distance in the approved synthetic D-05 formula |
| `delivery.per_km_minor` | 800 | Synthetic proportional distance rate using versioned integer rounding |
| `delivery.outer_cap_metres` | 40000 | Synthetic outer boundary; vendor/zone/capacity may be smaller |
| `vendor.platform_fee_minor` | 500 | Synthetic completed-order fee; zero on full refund/failure |
| `partner.wait_included_seconds` | 300 | First 5 trusted-arrival minutes included |
| `partner.wait_per_minute_minor` | 100 | Synthetic completed-minute earning after included time |
| `partner.wait_auto_cap_minor` | 1000 | Longer waits require an approved adjustment |
| `settlement.eligibility_seconds` | 86400 | Synthetic 24-hour hold when no affected exception remains |
| `payout.batch_local_time` | `18:00` | Daily fake batch in `Asia/Kolkata` |
| `payment.cod_enabled` | `false` | No client or endpoint exposes COD in MVP |
| `pharmacy.ordering_enabled` | `false` | Separate future compliance release only |

Every quote snapshots all pricing, zone, capacity, timer, substitution, refund, and approval-policy versions that affect it.

| Policy key | Default | Owner | Expiry action |
|---|---:|---|---|
| `quote.ttl_seconds` | 300 s | Pricing | Require re-quote before checkout |
| `inventory.soft_hold_seconds` | 300 s | Inventory | Release unplaced soft hold |
| `vendor.response_seconds` | 300 s | Orders | Expire only that vendor order |
| `vendor.reminder_first_seconds` | 120 s | Notifications | Second push/audible attempt |
| `vendor.sms_fallback_seconds` | 240 s | Notifications | Send configured fallback |
| `customer.decision_seconds` | 300 s | Orders | Apply recorded fallback or remove/escalate |
| `assignment.offer_seconds` | 30 s | Dispatch | Close attempt and offer next eligible partner |
| `partner.no_movement_seconds` | 180 s | Dispatch | Check-in prompt; then operations queue |
| `vendor.wait_first_seconds` | 300 s | Fulfilment | Notify vendor/customer; show revised ETA |
| `vendor.wait_leave_seconds` | 600 s | Fulfilment | Allow compensated leave/reassignment |
| `offline_proof.retry_seconds` | 15, 30, 60, 120, 300 | Workers | Escalate after exhausted bounded retries |
| `support.p0_ack_seconds` | 300 s | Operations | Immediate escalation; test acknowledgement within 5 minutes |
| `support.p1_ack_seconds` | 900 s | Operations | Escalate to on-duty lead after 15 minutes |
| `support.p2_staffed_ack_seconds` | 14400 s | Operations | Escalate queue ownership after 4 staffed hours |
| `support.p3_ack_policy` | `NEXT_STAFFED_DAY` | Operations | Escalate when next staffed-day target is missed |
| `support.staffed_timezone` | `Asia/Kolkata` | Operations | Monday–Saturday 09:00–19:00 internal testing only |
| `approval.synthetic_refund_single_actor_max_minor` | 50000 | Finance/Operations | More than ₹500 requires a different Finance approver |
| `privacy.synthetic_request_seconds` | 604800 s | Privacy | Escalate after 7 test days; not a production legal deadline |
| `recovery.critical_backup_rpo_seconds` | 300 s | Engineering | Target only; public launch requires restore evidence |
| `recovery.critical_rto_seconds` | 3600 s | Engineering | Target only; reconcile before safe resumption |

### 6.1 Checkout through vendor response

| Relative time | Actor/system action | Durable result | Customer/vendor experience |
|---:|---|---|---|
| T+0 s | Customer submits checkout with idempotency key | Request record and correlation ID | Button becomes progress state; repeat taps disabled locally |
| T+0–2 s | Server revalidates each vendor group and locks counted inventory in deterministic order | Fresh group validation and soft holds | Blockers identify only affected groups |
| T+2–5 s | Pricing signs per-vendor quotes and combined authorization | Quote/version snapshots | Customer sees final per-store and combined amounts |
| T+5–30 s | Payment adapter authorizes; timeout becomes unknown, never assumed failed | Payment transaction/provider reference | Confirmed, failed-no-charge, or processing/reconciling state |
| On authorization | One transaction creates checkout group, child orders, provisional reservations, allocations, events, and outbox messages | Exactly one checkout result | Customer opens existing group on retry |
| Order T+0 s | Vendor notification attempt 1 | Delivery-attempt record | Push plus audible alert on permitted devices |
| Order T+120 s | If no acknowledgement, notification attempt 2 | Reminder record | Second push/audible alert |
| Order T+240 s | If still unacknowledged, fallback | SMS/provider result | Owner/escalation staff receive fallback |
| Order T+300 s | If no accepted/declined command, order expires | Reservation release, allocation void/refund intent, vendor-health event | Only failed child shows expired; siblings continue |

If a configured value changes while a timer is active, the active object keeps the snapshotted version and expiry unless an authorized incident policy explicitly states otherwise.

### 6.2 Accepted order through ready

1. Acceptance atomically validates `PLACED`, deadline, vendor ownership, and inventory; commits reservations; stores prep estimate; emits `order.accepted`.
2. Picking records each line as pending, found, substituted-proposed, removed, or weighed. A line update never directly edits quoted history.
3. A customer decision creates one request with deadline and fallback. The order blocks `READY` while any required decision is unresolved.
4. Final item quantities and prices produce a capture plan linked to original allocations and adjustments.
5. `READY` requires every line resolved, package count greater than zero, handling flags, fulfilment method, and a current pickup/delivery instruction.

### 6.3 Partner fulfilment timeline

1. Dispatch creates attempts sequentially for eligible partners; only one may be active. Offer expiry is server-owned.
2. Acceptance records the partner and reveals exact vendor pickup. Exact customer address remains withheld until the approved delivery stage.
3. Trusted arrival starts the vendor wait timer. At 5 minutes the flow updates ETA; at 10 minutes the partner can keep waiting, request reassignment, or contact support with accrued pay visible.
4. Pickup requires active assignment, correct proof, package count/condition, vendor confirmation, and server response. This starts custody.
5. Customer location and masked contact become available only when needed for the active trip.
6. Delivery OTP validation is idempotent and tied to customer, order, assignment, attempt count, and expiry. A reused or wrong OTP never completes delivery.
7. Failed delivery after custody creates return instructions; completion waits for receiving-party count/condition confirmation or support resolution.

## 7. API contract

### 7.1 Common request and response rules

- Base path: `/api/v1`.
- JSON uses `snake_case`; enums use uppercase snake case.
- Mutating requests require `Idempotency-Key` when retry can duplicate work or money.
- The server scopes the key by authenticated actor and command, stores a canonical request hash and resulting status/body, and retains it for at least 24 hours and longer while a provider outcome is uncertain. Same key plus same hash returns the original result; same key plus a different hash returns `409 IDEMPOTENCY_KEY_REUSED`.
- Every response includes `request_id`; accepted asynchronous work also includes `operation_id` and current status URL.
- List endpoints use opaque cursor pagination and a server-enforced maximum page size.
- Clients send `If-Match` with the last aggregate version for conflict-sensitive edits.

Standard error:

```json
{
  "error": {
    "code": "ORDER_STATE_CONFLICT",
    "message_key": "orders.state_conflict",
    "request_id": "uuidv7",
    "retryable": false,
    "field_errors": [],
    "current_state": "READY",
    "support_reference": null
  }
}
```

Use `400` malformed request, `401` unauthenticated, `403` authenticated but forbidden, `404` absent or intentionally hidden resource, `409` state/version/idempotency conflict, `422` valid shape but failed business rule, `429` rate limited, and `503` temporary provider/service failure. Unknown payment outcomes return `202`, not a false failure.

### 7.2 Endpoint inventory

| Method/path | Actor | Command/query | Required checks |
|---|---|---|---|
| `POST /auth/otp/request` | Public | Request OTP | Rate/device/abuse policy |
| `POST /auth/otp/verify` | Public | Create session | OTP expiry/attempts; rotate session |
| `GET /stores` | Customer | Eligible stores | Address/zone, publication, hours |
| `GET /stores/{store_id}/products` | Customer | Catalogue | Published vendor, visibility, freshness metadata |
| `PUT /cart/vendor-groups/{store_id}/lines/{product_id}` | Customer | Set quantity | Ownership, group limit, current product/vendor |
| `POST /checkout-quotes` | Customer | Quote all groups | Every group independently valid; soft-hold policy |
| `POST /checkout-groups` | Customer | Authorize and place | Idempotency, signed quote, payment result, atomic creation |
| `GET /checkout-groups/{id}` | Customer/admin | Group projection | Ownership or scoped admin capability |
| `GET /orders/{id}` | Customer/vendor/admin | Child order | Actor-specific projection; no sibling leakage |
| `POST /vendor/orders/{id}/accept` | Vendor staff | Accept + prep estimate | Store membership, `PLACED`, deadline, inventory commit |
| `POST /vendor/orders/{id}/decline` | Vendor staff | Decline | Impact token, standardized reason, no custody |
| `POST /vendor/orders/{id}/line-decisions` | Vendor staff | Found/remove/weigh/propose substitute | Current picking state and line ownership |
| `POST /orders/{id}/customer-decisions/{decision_id}` | Customer | Approve/reject | Ownership, unresolved request, deadline/idempotency |
| `POST /vendor/orders/{id}/ready` | Vendor staff | Mark ready | Lines resolved, package metadata complete |
| `POST /assignments/{id}/accept` | Partner | Accept offer | Eligible actor, current attempt, not expired, no other active job |
| `POST /assignments/{id}/arrive-vendor` | Partner | Record arrival | Active assignment, trusted-location/vendor fallback |
| `POST /assignments/{id}/pickup-proof` | Partner/vendor | Confirm pickup | Proof, package agreement, custody not already active |
| `POST /assignments/{id}/delivery-proof` | Partner | Confirm delivery | Active custody, proof policy, replay protection |
| `POST /assignments/{id}/exceptions` | Partner/vendor | Start guided exception | Allowed reason/state; returns instruction/case reference |
| `POST /returns/{id}/complete` | Partner/vendor/support | Close return custody | Authorized destination and receiving proof |
| `POST /support-cases` | Any authenticated role | Open structured case | Resource access, evidence policy, dedupe key |
| `POST /admin/actions/{type}` | Scoped admin | Propose/execute intervention | Capability, impact preview, reason, approval policy |
| `POST /approval-requests/{id}/decision` | Approver | Approve/reject | Different actor, unexpired, matching capability |
| `POST /configuration-versions/{id}/activate` | Config approver | Schedule/activate | Validation, maker-checker, effective time |
| `POST /incident-controls` | Incident-capable admin | Activate scoped control | Impact preview, reason, scope, expiry/review |

### 7.3 Impact-token pattern

Destructive or high-impact commands first call a preview query. The server returns a short-lived `impact_token` bound to actor, object version, command, policy versions, and displayed effects. Submission must include that token. If state changes, return `409 IMPACT_PREVIEW_STALE` and require a new preview.

### 7.4 Critical request and response shapes

Create checkout quote:

```json
POST /api/v1/checkout-quotes
Idempotency-Key: quote-attempt-opaque

{
  "cart_id": "uuidv7",
  "address_id": "uuidv7",
  "vendor_groups": [
    {
      "vendor_location_id": "uuidv7",
      "fulfilment_method": "PLATFORM_DELIVERY",
      "slot_start": null,
      "slot_end": null,
      "tip_minor": 0,
      "customer_note": "Please call at the gate"
    }
  ]
}
```

```json
{
  "request_id": "uuidv7",
  "quote_id": "uuidv7",
  "expires_at": "2026-08-13T10:05:00Z",
  "currency": "INR",
  "vendor_quotes": [
    {
      "vendor_location_id": "uuidv7",
      "status": "QUOTED",
      "item_subtotal_minor": 42000,
      "discount_minor": 0,
      "tax_minor": 0,
      "delivery_fee_minor": 3900,
      "tip_minor": 0,
      "authorization_buffer_minor": 2000,
      "authorization_amount_minor": 47900,
      "route_distance_metres": 5000,
      "fulfilment_window": {
        "starts_at": "2026-08-13T10:35:00Z",
        "ends_at": "2026-08-13T11:05:00Z"
      },
      "policy_versions": ["uuidv7"]
    }
  ],
  "combined_authorization_amount_minor": 47900,
  "blocked_groups": []
}
```

If one group is blocked, the response still returns valid quotes for healthy groups plus `blocked_groups[]` with stable reason code, affected line IDs, and repair action. Checkout creation accepts only a currently valid quote with no included blocked group.

Place checkout:

```json
POST /api/v1/checkout-groups
Idempotency-Key: checkout-attempt-opaque

{
  "quote_id": "uuidv7",
  "payment_method_token": "provider-token",
  "accepted_terms_version": "terms-version"
}
```

```json
{
  "request_id": "uuidv7",
  "checkout_group_id": "uuidv7",
  "public_reference": "CG-7F3K9Q",
  "state": "PROCESSING",
  "payment_state": "AUTHORIZED",
  "orders": [
    {
      "order_id": "uuidv7",
      "public_reference": "ORD-4P8M2D",
      "vendor_location_id": "uuidv7",
      "state": "PLACED",
      "vendor_response_expires_at": "2026-08-13T10:10:00Z",
      "allocated_authorization_minor": 47900
    }
  ]
}
```

Vendor acceptance:

```json
POST /api/v1/vendor/orders/{order_id}/accept
Idempotency-Key: vendor-accept-opaque
If-Match: "order-version-1"

{
  "preparation_seconds": 1200,
  "package_estimate": 2
}
```

The response returns authoritative `order_version`, `state`, `preparation_due_at`, reservation result, next required action, and audit reference. A late or duplicate acceptance returns the existing accepted result only when the idempotency intent matches; otherwise it returns `409`.

Pickup proof:

```json
POST /api/v1/assignments/{assignment_id}/pickup-proof
Idempotency-Key: pickup-proof-opaque

{
  "proof_type": "QR",
  "proof_token": "short-lived-scanned-token",
  "package_count": 2,
  "package_condition": "ACCEPTABLE",
  "handling_flags": ["FRAGILE"],
  "vendor_confirmation_token": "short-lived-vendor-token",
  "captured_at": "2026-08-13T10:31:00Z"
}
```

Proof tokens are accepted only over TLS, encrypted where temporarily buffered, excluded from logs/analytics/events, hashed or destroyed after verification according to policy, and never returned in a read response.

Admin protected action:

```json
POST /api/v1/admin/actions/refund/preview

{
  "order_id": "uuidv7",
  "line_allocations": [{"order_line_id": "uuidv7", "amount_minor": 12000}],
  "reason_code": "MISSING_ITEM",
  "case_id": "uuidv7"
}
```

The preview returns customer, vendor, platform, tax, settlement, and sibling impact plus an expiring `impact_token`. Execution with that token either completes under the actor's threshold or creates an `approval_request_id`; it never reports a refund as completed before the provider and ledger state confirm it.

## 8. Persistence baseline

Every mutable aggregate table includes `id`, `created_at`, `updated_at`, integer `version`, and lifecycle state. Sensitive rows include data-classification and retention metadata.

Required table families:

| Module | Tables |
|---|---|
| Identity | `users`, `phone_identities`, `sessions`, `otp_challenges`, `devices`, `roles`, `capabilities`, `role_capabilities`, `staff_memberships`, `consents` |
| Vendor | `vendors`, `vendor_locations`, `operating_hours`, `service_zones`, `vendor_staff`, `verification_documents`, `document_reviews` |
| Catalogue | `products`, `product_variants`, `prices`, `availability_records`, `inventory_reservations`, `catalogue_imports`, `catalogue_import_rows` |
| Customer/cart | `customers`, `addresses`, `favourite_stores`, `carts`, `cart_vendor_groups`, `cart_lines`, `substitution_preferences` |
| Pricing/order | `quotes`, `quote_vendor_groups`, `checkout_groups`, `orders`, `order_lines`, `order_adjustments`, `customer_decision_requests`, `order_events` |
| Fulfilment | `fulfilments`, `packages`, `assignment_attempts`, `partner_locations`, `wait_periods`, `custody_events`, `return_tasks`, `proof_records` |
| Money | `payment_transactions`, `payment_allocations`, `refunds`, `ledger_accounts`, `ledger_entries`, `settlements`, `earnings`, `payouts`, `finance_exceptions` |
| Operations | `support_cases`, `case_messages`, `case_evidence`, `risk_signals`, `trust_reviews`, `restrictions`, `approval_requests`, `configuration_versions`, `incident_controls`, `audit_events` |
| Async | `outbox_events`, `inbox_receipts`, `scheduled_jobs`, `notification_attempts`, `provider_webhook_receipts` |

Database constraints must enforce: one vendor location per order, one active assignment per fulfilment, unique provider event receipt, unique idempotency scope/key, non-negative reservation quantity, balanced ledger transaction, proposer not approver, and no overlapping active configuration version for the same key/scope/effective interval.

### 8.1 Critical relational constraints

The exact migration syntax may follow the selected framework, but the resulting PostgreSQL constraints must be equivalent to:

```sql
CREATE UNIQUE INDEX one_order_per_vendor_in_checkout
  ON orders (checkout_group_id, vendor_location_id);

CREATE UNIQUE INDEX one_active_assignment_per_fulfilment
  ON assignment_attempts (fulfilment_id)
  WHERE state IN ('OFFERED', 'ASSIGNED', 'AT_VENDOR', 'PICKED_UP',
                  'EN_ROUTE_TO_CUSTOMER', 'ARRIVED', 'RETURN_REQUIRED',
                  'RETURN_AUTHORIZED', 'RETURNING');

CREATE UNIQUE INDEX unique_idempotent_command
  ON idempotency_records (actor_id, command_scope, idempotency_key);

CREATE UNIQUE INDEX unique_provider_webhook
  ON provider_webhook_receipts (provider, provider_event_id);

ALTER TABLE inventory_reservations
  ADD CONSTRAINT reservation_quantity_positive CHECK (quantity_base_units > 0);

ALTER TABLE approval_requests
  ADD CONSTRAINT proposer_cannot_approve CHECK (approver_id IS NULL OR proposer_id <> approver_id);
```

Ledger balance is checked before commit by grouping entries under one `ledger_transaction_id`; the sum of signed amounts for each currency must equal zero. A deferred database constraint or transaction-owned posting function must prevent an unbalanced transaction from becoming visible.

## 9. Events and background jobs

### 9.1 Event envelope

```json
{
  "event_id": "uuidv7",
  "event_type": "order.accepted",
  "event_version": 1,
  "aggregate_type": "order",
  "aggregate_id": "uuidv7",
  "aggregate_version": 4,
  "occurred_at": "2026-08-13T10:00:00Z",
  "correlation_id": "uuidv7",
  "causation_id": "uuidv7",
  "actor_type": "vendor_staff",
  "actor_id": "uuidv7",
  "data": {}
}
```

Events contain identifiers and minimum facts. Consumers load authorized detail from the owning module. OTPs, bank data, unnecessary full addresses, and future prescription data never enter general events.

### 9.1.1 Canonical event catalogue

| Event | Producer | Primary consumers |
|---|---|---|
| `checkout_group.placed` | Orders | Customer projection, payments, analytics |
| `checkout_group.partially_accepted` | Orders projection | Customer notification, operations |
| `checkout_group.partially_cancelled` | Orders projection | Customer notification, finance reconciliation |
| `order.placed` | Orders | Vendor alerts, reservation expiry, customer projection |
| `order.accepted` | Orders | Inventory, fulfilment, customer notification |
| `order.vendor_response_expired` | Orders | Inventory release, allocation release/refund, vendor health |
| `order.customer_decision_required` | Orders | Customer notification, decision-expiry job |
| `inventory.soft_hold_created` | Inventory | Expiry scheduler, metrics |
| `inventory.reservation_committed` | Inventory | Vendor/order projections, metrics |
| `inventory.reservation_released` | Inventory | Availability projection, reconciliation |
| `fulfilment.ready` | Fulfilment | Dispatch/customer notification |
| `delivery.assignment_offered` | Dispatch | Partner notification, offer-expiry job |
| `delivery.assignment_reassigned` | Dispatch | Partner/customer/vendor projections, earnings |
| `delivery.wait_threshold_reached` | Fulfilment | Partner/vendor notification, operations |
| `delivery.custody_started` | Fulfilment | Order lock, customer tracking, risk monitoring |
| `delivery.picked_up` | Fulfilment | Order transition, customer tracking |
| `delivery.return_authorized` | Fulfilment/support | Partner/vendor notification, customer case |
| `delivery.return_completed` | Fulfilment | Custody closure, earnings, refund/settlement review |
| `delivery.completed` | Fulfilment | Order completion, capture/ledger eligibility |
| `payment.captured` | Payments | Ledger, receipt, settlement eligibility |
| `refund.completed` | Payments | Ledger, customer/vendor projections, case |
| `settlement.eligible` | Ledger | Settlement/payout scheduler |
| `vendor.document_expiring` | Compliance | Vendor notification, compliance queue |
| `approval.requested` | Policy/operations | Authorized approver queue |
| `incident_control.activated` | Policy/operations | Affected modules, banners, on-call/audit |
| `trust.review_opened` | Support/trust | Trust queue; no automatic durable punishment |

Event names and versions are additive contracts. Renaming or removing one requires a compatibility migration and consumer inventory.

### 9.2 Required workers

| Worker | Trigger | Idempotent outcome | Exhaustion route |
|---|---|---|---|
| Vendor alert escalation | `order.placed` + scheduled deadlines | Attempt records and vendor reminders | Operations notification-failure queue |
| Vendor response expiry | `expires_at` | One child expires, reservation/allocation released | Stuck-order queue |
| Inventory hold expiry | reservation deadline | Release remaining quantity once | Inventory reconciliation queue |
| Customer decision expiry | decision deadline | Apply recorded fallback exactly once | Support if no deterministic fallback |
| Assignment offer expiry | offer deadline | End attempt and create next eligible attempt | Manual dispatch queue |
| No-movement monitor | active assignment timer | Partner check-in and operations task | Delivery operations queue |
| Payment webhook processor | verified durable receipt | Advance transaction once | Finance exception queue |
| Payment reconciler | periodic/provider statement | Match internal and provider states | Finance exception queue |
| Refund worker | approved refund | Submit/retry same provider operation | Refund-failed queue |
| Settlement eligibility | order completion/dispute window | Post vendor/partner payable lines | Ledger exception queue |
| Payout worker | payout schedule | One provider payout per payout ID | Payout-failed queue |
| Document reminder/restriction | expiry schedule | Reminder or policy-scoped capability change | Compliance queue |
| Data retention | approved schedule | Delete/anonymize eligible records with audit summary | Privacy operations queue |

## 10. Authorization and privacy enforcement

Authorization is evaluated on the server using actor role, capability, resource ownership, vendor location, current assignment/case, state, and action. Query filters are not enough; each loaded resource is checked before projection.

| Data/action | Customer | Vendor | Partner | Support | Finance | Trust/compliance | Reporting |
|---|---|---|---|---|---|---|---|
| Child order | Own projection | Own vendor projection | Active-assignment minimum | Assigned-case projection | Money projection | Risk/compliance projection | Masked aggregate |
| Sibling orders | Own checkout summary | No | No | Only with explicit group-case need | Allocation summary | Linked-review minimum | Aggregate only |
| Customer exact address | Own | When fulfilment requires | Active stage only | Assigned case only | No | Incident need only | No |
| Bank details | Own masked/managed path | Own masked/managed path | Own masked/managed path | No | Verification/payment need | Compliance need | No |
| Refund | Request | Request/see own result | No | Propose within capability | Approve/execute by threshold | No | No |
| Restriction | No | Appeal own | Appeal own | Case input | No | Propose/approve by policy | No |
| Configuration | No | View applicable policy | View applicable pay policy | No | Finance keys only | Compliance keys only | Masked read |

Location collection must record consent/purpose, start and stop times, frequency mode, assignment, viewers, offline-buffer expiry, and deletion/aggregation result.

## 11. Observability and operational readiness

Every request propagates `request_id`, `correlation_id`, actor type, aggregate type/ID, and safe outcome. Logs never contain proof codes or unnecessary personal data.

Minimum launch dashboards and alerts:

- Checkout success/unknown/failure by provider and app version.
- Vendor-response countdowns, notification delivery failures, and expiry rate.
- Inventory reservation age, negative/overcommitted guard violations, and release lag.
- Active assignment age, excessive wait, no movement, custody without progress, and return age.
- Payment allocation mismatch, unbalanced-ledger attempt, refund age, payout failure, and unmatched statement.
- Support P1/P2 SLA, unowned cases, approval expiry, document expiry, and active incident controls.
- API latency/error rate, queue lag/dead letters, database saturation, cache/provider health, backup and restore-test age.

Any invariant breach pages the owning on-call role and activates a runbook. An alert is not considered resolved until business state and customer-visible state are reconciled.

## 12. Vertical implementation slices

Each slice must include schema, migration, module logic, API, UI, jobs, permissions, audit, observability, fixtures, tests, and runbook before it is marked complete.

| Slice | Delivers | Depends on | Exit gate |
|---|---|---|---|
| S0 Repository foundation | Toolchain, local environments, config validation, logging, health, migration framework | D-02, D-03 | Local build and tests pass; shared non-production deployment remains gated |
| S1 Identity and access | OTP, sessions, roles/capabilities, staff membership, consent | S0 | Cross-role authorization tests pass; OTP abuse controls observable |
| S2 Vendor and catalogue | Vendor/location, publication, zones/hours, product/import, availability freshness | S1 | One approved vendor is discoverable; another vendor cannot access it |
| S3 Customer discovery/cart | Address eligibility, search, storefront, multi-store groups, preferences | S2 | Three groups persist; stale/invalid line recovery is isolated |
| S4 Quote and grouped checkout | Quotes, holds, allocations, authorization, checkout/child creation, partial failure | S3, payment adapter | Duplicate submit produces one result; money and inventory invariants pass |
| S5 Vendor fulfilment | Alerts, acceptance, picking, decisions, ready, pickup | S4 | Timeout/decline affects one child; customer decision and reservation release pass |
| S6 Partner fulfilment | Eligibility, offers, assignment, wait, custody, proof, return, location | S5 | One active attempt; offline proof and post-pickup return pass |
| S7 Money lifecycle | Capture, refunds, ledger, fees, earnings, settlements, payouts, reconciliation | S4–S6 | Property tests conserve money; provider statement reconciles |
| S8 Operations control plane | Support, finance queues, trust review, approvals, configs, incident controls, audit | S1, S4–S7 | Maker-checker, scoped action, rollback, and sibling isolation pass |
| S9 Hardening/pilot | Accessibility, localization, performance, security, restore, incident drills | All | Launch checklist signed by product, engineering, operations, finance, security |

No slice may defer its failure handling to S9. S9 verifies the system; it does not retrofit missing integrity.

## 13. Testing and traceability

### 13.1 Minimum automated coverage by layer

| Layer | Required coverage |
|---|---|
| Unit/property | State transition tables, pricing/rounding, reservation math, money conservation, permission policies, timer calculation |
| Module integration | Transactions, constraints, outbox/inbox, concurrency, snapshots, maker-checker, retention eligibility |
| Provider contract | OTP, payment, payout, maps, push/SMS, object storage fixtures including timeout/replay/malformed response |
| API | Authentication, ownership, validation, idempotency replay, optimistic conflict, pagination, error shape |
| UI component | Loading/empty/error/success/stale states, keyboard/focus, translation expansion, timer display |
| End-to-end | Customer to vendor to partner/admin and financial closure, including partial vendor failure and return |
| Security/privacy | Cross-tenant object access, role escalation, address stage-gating, log/event redaction, upload abuse, webhook forgery |
| Resilience/performance | Provider outage, queue retry, dead-letter recovery, failover, 3-store concurrency, dispatch burst, restore drill |

### 13.2 Required end-to-end scenarios

1. One-store pickup completes and settles exactly once.
2. Three-store checkout: two accept, one times out; siblings continue and only failed allocation releases.
3. Two customers compete for the last counted unit; at most one reservation commits.
4. Vendor proposes substitution; customer approves, rejects, and times out under separate tests.
5. Payment authorization times out but later webhook succeeds; customer receives one checkout and no duplicate charge.
6. Partner offer expires, second partner accepts, and the first attempt plus compensation history remains visible.
7. Partner waits past both thresholds, leaves under policy, and earning adjustment is posted once.
8. Customer cancels after pickup; return closes custody before final financial resolution.
9. Delivery proof is saved offline, retried, and synchronized without duplicate completion.
10. Support resolves one child order without mutating siblings.
11. Support proposes a protected refund and finance approves; self-approval is rejected.
12. A risk signal opens review; no irreversible restriction occurs without an attributable decision and appeal path.
13. A kill switch blocks new scoped work while existing custody and ledger history remain intact.
14. Expired partner document blocks going online under policy but does not strand an active package.
15. English/Hindi, keyboard/screen reader, 200% zoom, 360 px width, slow network, and reconnect paths complete every critical role task.

## 14. Release and rollback gates

Every release records schema version, configuration versions, client versions, feature flags, migration status, and rollback owner.

1. Expand schema with backwards-compatible nullable/default-safe fields.
2. Deploy readers compatible with old and new representation.
3. Deploy writers behind a scoped flag and observe shadow/validation metrics.
4. Enable by internal users, pilot vendor/zone, then wider pilot cohort.
5. Verify business metrics, invariant alerts, queues, and customer-visible state after each expansion.
6. Roll back code/flag/config without deleting valid business events. Financial corrections use reversal entries.
7. Contract/remove old schema only in a later release after evidence shows no old readers/writers remain.

Incident controls may pause new checkout, dispatch, payment method/provider, payout, vendor/category/zone, substitutions, promotion, or grouped checkout. They never silently cancel existing orders or end custody.

## 15. Definition of implementation-ready

A slice may enter development only when:

- Its locked decisions and required pre-build gates are identified.
- Domain owner, aggregate, states, commands, queries, events, timers, permissions, and audit fields are named.
- API request/response/error/idempotency behavior is specified.
- Schema constraints and migration/rollback strategy are specified.
- Screen states and accessible alternatives are linked to `design.md`.
- Success, timeout, retry, duplicate, cancellation, partial failure, and support paths have pass/fail tests.
- Observability, queue ownership, SLA, and runbook entry are defined.
- No unresolved money, privacy, safety, legal, or provider decision is hidden as an engineering assumption.

## 16. Definition of done for a production slice

1. Implementation and migrations are reviewed and deployed to the non-production environment.
2. Unit, integration, contract, API, UI, end-to-end, security, and relevant resilience tests pass.
3. Authorization tests prove cross-customer, cross-vendor, sibling-order, inactive-assignment, and wrong-admin-role denial.
4. Metrics, traces, alerts, dashboards, queue ownership, and runbooks are exercised with synthetic data.
5. Accessibility and English/Hindi acceptance pass on the supported device/browser matrix.
6. Rollback is rehearsed without rewriting order or ledger history.
7. Product, operations, finance, security/privacy, and support owners sign the applicable gate.
8. Documentation references and configuration examples match the released behavior.
