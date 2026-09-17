# Vendor Fulfilment, Customer Decisions, and Pickup

**Scope:** phases.md Phase 8, company-local synthetic development only
**Production authority:** None

## Outcome

Migration `0026_vendor_fulfilment_and_pickup` and `VendorFulfilmentService` take Phase 7's placed
`vendor_orders` all the way through vendor acceptance, picking, customer decisions on
substitutions or weight changes, ready state, hashed-OTP pickup, and light history (receipt,
rating, support entry). Phase 8's exit gate — one-store prepaid pickup completes exactly once end
to end — is met at the persistence and service layer, verified through `pnpm db:verify`.

## Aggregates

The vendor_order aggregate (Phase 7) grows from four states to seven:

```
PLACED -> ACCEPTED -> PICKING -> READY -> PICKED_UP
   |          |
   v          v
CANCELLED  (decline)      EXPIRED (accept_by timeout)
```

New per-line and per-decision tables let a picker mark, propose, and get answers without breaking
the vendor_order or line-snapshot invariants Phase 7 established:

| Table | Owns |
|---|---|
| `vendor_orders` (extended) | accept_by, accepted_at, preparation_estimate_seconds, decline_reason_code, picking_started_at, ready_at, package_count, package_condition_note, pickup_otp_hash (SHA-256), pickup_otp_expires_at, pickup_otp_attempts, picked_up_at |
| `vendor_order_line_picks` | one row per touched line: FOUND/MISSING/PROPOSED_SUBSTITUTION/PROPOSED_WEIGHT/SUBSTITUTION_APPROVED/SUBSTITUTION_REJECTED/WEIGHT_APPROVED/WEIGHT_REJECTED, actual_quantity, actual_unit_price_minor |
| `vendor_order_customer_decisions` | proposal to the customer with decision_deadline_at, one PENDING per pick at a time, authorization_delta_minor recorded but not yet posted |
| `vendor_order_events` | append-only audit; trigger blocks UPDATE/DELETE |
| `vendor_order_ratings` | one row per completed vendor_order |
| `support_cases` | structured support entry, scoped to a vendor_order |

## Rules this slice enforces

- Accept, start-picking, propose, mark-ready, issue-OTP, and complete-pickup all require an active
  `staff_memberships` row at the target vendor location. Every path throws `FulfilmentAuthorizationError`
  otherwise, and a cross-vendor probe returns `FulfilmentNotFoundError` (concealed).
- Accept refuses if the response deadline (`accept_by`) has passed or the expected version is stale.
- Decline releases the vendor's own `SOFT_HELD` and `PROVISIONAL` reservations, leaving sibling
  vendor_orders in the same checkout_group untouched.
- `timeoutOverdueAccepts` uses `FOR UPDATE SKIP LOCKED` so parallel workers don't collide, and
  transitions overdue orders to `EXPIRED` with `decline_reason_code = 'ACCEPT_DEADLINE_TIMEOUT'`.
- Mark-ready refuses if any line row is missing a pick or any proposal is still `PENDING`; a
  proposal must be answered (or timed-out) before its vendor_order can leave picking.
- Pickup OTP is a six-digit random number stored as SHA-256; the plaintext is returned to the
  vendor caller once. Every failed attempt increments a counter in its **own** transaction so the
  attempt survives even though the outer pickup transaction rolls back — otherwise
  `PICKUP_OTP_MAX_ATTEMPTS` would be unenforceable.
- A completed pickup clears the OTP hash and expiry, so a leaked slip cannot pick up the order a
  second time. `settleInventoryOnPickup` commits every `PROVISIONAL` reservation attached to the
  order once, and the inventory service's own version guard makes that idempotent.

## Deliberate scope decisions

- **Fulfilment notification signals use the append-only order history.** The local notification
  worker consumes `vendor_order_events` under a source-event deduplication key and records durable
  intents/attempts. Inventory settlement remains transaction-owned by pickup, avoiding an
  eventually-consistent stock commit. The generic outbox remains for aggregates registered in
  `aggregate_transitions`; the domain-specific order history is itself the durable source here.
- **Customer decision timeout auto-answers as REJECTED**, not APPROVED — never charge for a
  substitution the customer never saw.
- **Approved `authorization_delta_minor` is posted before capture.** The customer decision and
  synthetic payment adjustment commit in one transaction. The payment and its order allocation
  move by the same delta, an append-only provider-style adjustment is recorded once per decision,
  and approval fails closed if payment is no longer authorized and uncaptured.
- **Support cases live at `vendor_order` grain**, not at line grain. Phases.md 8.7 says "the
  smallest affected object"; today the smallest addressable object a customer support workflow
  can act on is the vendor_order. Line-level support scoping is a later refinement.

## Modules (16 September 2026)

`VendorFulfilmentService` (`database/src/vendor-fulfilment.ts`) is the one object the API and the
worker construct; since the tech-debt audit's Phase D the work is in five modules, by who acts and
on what, with what they share in `vendor-order-core.ts` (errors, shapes, lock, event, holds
release, authorization release, the one order-summary query):

| Module | Concern |
| --- | --- |
| `vendor-order-transitions.ts` | accept, decline, start picking, mark ready; the system's expiry of an unanswered order |
| `order-picking.ts` | lines found / missing / substitution / weight; the customer's decision and its timeout; the pick list |
| `order-handover.ts` | the three collection-code issuers, who must be at the counter, `completePickup`, inventory settlement |
| `customer-orders.ts` | history, receipt, tracking, cancellation, rating, support cases |
| `vendor-order-views.ts` | the board, one order, the store's numbers and open cases |

Two behaviours changed with the split. The shop's response deadline (`accept_by`) is written by
checkout at placement — before, only the verifier ever set one, so no real order carried a
countdown and none ever expired. And the pick list is scoped to the route's location, so a member
of one store can no longer read another store's picks by order id.

## API

- **`vendor/locations/:vendor_location_id/orders`** (`vendor.order.fulfil`): `accept`, `decline`,
  `start-picking`, `lines/:id/found`, `lines/:id/missing`, `lines/:id/propose-substitution`,
  `lines/:id/propose-weight`, `ready`, `pickup-otp`, `complete-pickup`, `picks` (list).
- **`customer/decisions/:decision_id/answer`** (`customer.order.decide`).
- **`customer/orders`** (`customer.order.read`): list groups + vendor_orders; `receipt`; and,
  behind distinct capabilities, `rating` (`customer.order.rate`) and `support`
  (`customer.support.open`).

## Verification

`database/scripts/verify-vendor-fulfilment.ts` — connected scenarios (145 counted assertions) driving Phase 7 into
Phase 8: a real two-store checkout is placed, one order is declined and its reservations released
without touching the sibling's, the other is accepted (with stale-version rejection covered), a
line is picked, mark-ready fails first while lines are unresolved and succeeds after, an OTP is
issued and verified against the stored SHA-256 hash, a wrong OTP increments the attempt counter,
the right OTP completes pickup and clears the hash, inventory commits transition `PROVISIONAL`
holds to `COMMITTED`, the customer's history and receipt reflect the outcome, rating is
single-shot, and a support case can be opened. A third store fixture is used to drive the
system-timeout path in isolation. Wired into `verify-lifecycle.ts` as
`vendor_fulfilment_assertions`.

## Boundaries

Delivery partner assignment stays in Phase 9. Real provider capture/refund and settlement remain
production gates. Reorder and eligible-vendor rating aggregation are implemented in the later
customer discovery and complete-money slices.
