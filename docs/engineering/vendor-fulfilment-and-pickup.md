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
| `vendor_order_customer_decisions` | proposal to the customer with decision_deadline_at, one PENDING per pick at a time, authorization_delta_minor; a change applied under the customer's own rule is recorded here too, answered `APPROVED` at once (8.4, audit run 52) |
| `vendor_order_events` | append-only audit; trigger blocks UPDATE/DELETE |
| `vendor_order_ratings` | one row per completed vendor_order |
| `support_cases` | structured support entry, scoped to a vendor_order |

## Rules this slice enforces

- Accept, start-picking, propose, mark-ready, issue-OTP, and complete-pickup all require an active
  `staff_memberships` row at the target vendor location. Every path throws `FulfilmentAuthorizationError`
  otherwise, and a cross-vendor probe returns `FulfilmentNotFoundError` (concealed).
- Accept refuses if the order is not `PLACED`, the response deadline (`accept_by`) has passed or
  the expected version is stale. The acceptance is the sale (8.2, audit run 50): every provisional
  hold on the order's lines is committed in the acceptance's own transaction, recorded against
  `VENDOR_ACCEPTED`; a hold no longer held (released, expired) refuses the acceptance and leaves the
  order as it was. The estimate is on the order and in the `ACCEPTED` event's note. Until run 50
  the holds were committed at pickup, from the worker, one transaction each;
  `settleInventoryOnPickup` remains as the backstop for orders accepted before.
- Decline takes one of the standard reasons (`VENDOR_DECLINE_REASONS`: VENDOR_CLOSED,
  STOCK_MISMATCH, WORKLOAD, SERVICEABILITY, PRICING_ERROR, PROHIBITED_ITEM, TECHNICAL_ISSUE);
  anything else is refused. `previewDecline` (`GET …/orders/:id/decline-preview`) states what a
  decline would do before the shop decides: the customer's money released for this order (its
  allocation), the units back on the shelf per line, the sibling orders left untouched, the shop's
  acceptance record before and after, and the reasons it may give.
- A customer's cancellation of an accepted order returns its committed units (the release includes
  `COMMITTED`), and 0094 lets a cancelled order keep its `accepted_at`: until run 50 the 0026 shape
  constraint refused it, so every cancellation after acceptance was a 500.
- Decline releases the vendor's own `SOFT_HELD` and `PROVISIONAL` reservations, leaving sibling
  vendor_orders in the same checkout_group untouched.
- `timeoutOverdueAccepts` uses `FOR UPDATE SKIP LOCKED` so parallel workers don't collide, and
  transitions overdue orders to `EXPIRED` with `decline_reason_code = 'ACCEPT_DEADLINE_TIMEOUT'`.
- The shop is told (8.1, audit run 49): the worker alerts every current staff member of the
  location when `order.placed` is delivered (in-app and push, audible, carrying `accept_by`), the
  console sounds and acknowledges the alerts for the orders it shows, and an alert nobody opened
  within `vendor.order_alert_escalation` (default 60 s) is escalated once to the owners on the
  configured channels, SMS among them. See `local-notification-delivery.md`.
- The ordered lines are the snapshot the customer paid against and are immutable at the database
  (0095, the same guard as the order history). The shop's answers are the picks, one per line, and
  each is a draft that names the pick version it was read at (8.3, audit run 51): a queued or
  repeated edit that arrives after a newer answer is refused as `VERSION_CONFLICT`, never applied
  over it. Found is the line as ordered or fewer of it, at the snapshot's price; a changed price or
  weight is a proposal for the customer. A replacement must be one of this store's own live
  products and is refused outright (`SUBSTITUTION_NOT_ALLOWED`) on a line the customer marked
  "refund, never replace"; the pick list carries each line's rule and whether it is sold by weight,
  and the console hides the offer accordingly. A line with a proposal pending, or one the customer
  approved, takes no edit from the shop (`LINE_AWAITING_CUSTOMER`); a rejected one may be marked
  again.
- Ready records the package (8.5, audit run 53): the count, the condition note, and the handling
  needs (`HANDLING_FLAGS`: FRAGILE, KEEP_COLD, KEEP_FROZEN, KEEP_UPRIGHT, HEAVY, LEAK_RISK; 0097
  puts them on the order), stamps `ready_at` on the server's clock, and makes the promise
  (`pickup_promise_at`, read as `promise_at`): a collected order is ready from now; a delivered one
  should arrive after the road the quote was priced on. The delivery attempt made at placement
  carried a package count guessed from the line count — which the partner then had to type back
  exactly at the counter — and no handling needs; ready passes the shop's own count and needs to
  it (packaging facts, not a transition: the attempt's version stands, so a partner's open offer is
  not made stale). The `READY` event's note carries all three. A second ready is refused for its
  state. Until run 53 the condition was never sent, the needs had nowhere to go and the promise was
  never set.
- Mark-ready refuses if any line row is missing a pick or any proposal is still `PENDING`; a
  proposal must be answered (or timed-out) before its vendor_order can leave picking. Once the
  picks are final, every line that will not be in the bag as ordered -- missing, a refused
  proposal, an approved replacement -- gives its committed units back to the shelf
  (`LINE_NOT_SUPPLIED`); until run 51 they stayed sold to nobody.
- Pickup OTP is a six-digit random number stored as SHA-256; the plaintext is returned to the
  vendor caller once. Every failed attempt increments a counter in its **own** transaction so the
  attempt survives even though the outer pickup transaction rolls back — otherwise
  `PICKUP_OTP_MAX_ATTEMPTS` would be unenforceable.
- A completed pickup clears the OTP hash and expiry, so a leaked slip cannot pick up the order a
  second time. `settleInventoryOnPickup` commits any `PROVISIONAL` reservation still attached to
  the order (none, for an order accepted since run 50), and the inventory service's own version
  guard makes that idempotent.

## Deliberate scope decisions

- **Fulfilment notification signals use the append-only order history.** The local notification
  worker consumes `vendor_order_events` under a source-event deduplication key and records durable
  intents/attempts. Inventory settlement remains transaction-owned by pickup, avoiding an
  eventually-consistent stock commit. The generic outbox remains for aggregates registered in
  `aggregate_transitions`; the domain-specific order history is itself the durable source here.
- **Only a material change is a question for the customer (8.4, audit run 52).** A proposal whose
  total rises waits on the customer: `PENDING`, with the deadline from `customer.decision_seconds`
  (implementation.md 6.1; 60–3600 s, default 300) unless the call names its own. A lighter weight
  is recorded at once as `WEIGHT_APPROVED` and the difference comes off the authorisation; a
  replacement at no extra cost on an `ALLOW_SAME_STORE` line is applied as
  `SUBSTITUTION_APPROVED` under that rule. Both are recorded as decisions answered `APPROVED`, and
  the customer is told (`vendor_order_event.substitution_approved` / `weight_approved` from the
  shop). The customer's pending list and the notice carry the item as ordered, the item offered,
  quantities, prices, the difference, the reason, the deadline and the store — the event links
  its decision (0096) so the notice can be built from the history.
- **Customer decision timeout auto-answers as REJECTED**, not APPROVED — never charge for a
  substitution the customer never saw.
- **Adjustments are posted before capture, and capture waits for the bags.** An approved change
  moves the payment and the order's allocation by its delta in the decision's own transaction
  (`adjustAuthorizationForOrder`, one append-only adjustment per decision). At ready, what is not
  in the bag — a missing line, a refused proposal, a short found line — comes off in one
  `LINES_NOT_SUPPLIED` adjustment per order (the capture plan, implementation.md 6.2.4), and an
  order with nothing in the bag cannot be ready. The group's authorisation is captured only once
  every order is READY or ended (`settleAuthorizationForOrder` on `vendor_order.ready` as well as
  on each answer): until run 52 it was captured as soon as every shop had accepted, so every
  approved dearer change after that was refused for want of an uncaptured payment and a missing
  line was captured in full.
- **Support cases live at `vendor_order` grain**, not at line grain. Phases.md 8.7 says "the
  smallest affected object"; today the smallest addressable object a customer support workflow
  can act on is the vendor_order. Line-level support scoping is a later refinement.

## Modules

`VendorFulfilmentService` (`database/src/vendor-fulfilment.ts`) is the one object the API and the
worker construct, and it is still one module. The tech-debt audit's Phase D proposed splitting it
by actor and concern (`vendor-order-transitions`, `order-picking`, `order-handover`,
`customer-orders`, `vendor-order-views`), and a `vendor-order-core` split was begun; commit
`f0e646e` dropped it as abandoned, and the earlier version of this section describing it as done
was wrong. What survived the attempt: `grouped-checkout` writes the shop's response deadline
(`accept_by`) at placement — before, only the verifier ever set one, so no real order carried a
countdown and none ever expired — and the pick list is scoped to the route's location, so a member
of one store can no longer read another store's picks by order id. `vendor-order-completion.ts`
holds the ending shared with `assignment-custody` (`completeVendorOrder`); the split itself remains
tech-debt item 5.

## Vendor self-delivery (VEN-37, workflow 6.7)

The store's own staff carry the order (batch 10). A `VENDOR_DELIVERY` order reuses the order's
states rather than inventing a parallel machine:

- `POST …/orders/:id/self-delivery/start` (`vendor.order.fulfil`, `expected_version`): READY →
  PICKED_UP with `out_for_delivery_at` and `vendor_delivery_by_user_id`, reason
  `VENDOR_DELIVERY_STARTED`. It emits the same `vendor_order.picked_up` event a counter handover
  does, so inventory settles and the customer's card reads "on the way". A collected or
  platform-delivered order is refused here; a self-delivered order is refused at the counter
  (`complete-pickup` and the vendor fallback code), which it used to accept.
- `POST customer/orders/:id/delivery-otp` mints the customer's delivery code (CUS-56) on the
  order once it is PICKED_UP — the partner's door keeps this code on the delivery assignment, which
  a self-delivery never has. Same lifetime and attempt ceiling as every other code.
- `POST …/orders/:id/self-delivery/complete` (`otp`): validates the code with the two-transaction
  pattern `complete-pickup` uses (a wrong attempt is counted even though the caller's error unwinds
  them), spends it, and ends the order through `completeVendorOrder` as DELIVERED with reason
  `VENDOR_DELIVERY_COMPLETED` — the same `vendor_order.delivered` event a partner delivery emits, so
  settlement runs with no partner earning. The four door refusals carry the `DELIVERY_OTP_*` codes
  the partner's door uses.

Who the customer's delivery fee settles to on a self-delivery is a D-05 question; today it rests
with the platform, as the pricing module says.

## Settlement of a collected order

`createSettlement` was called only from `recordDeliveryEarnings`, which ran only on
`vendor_order.delivered`. A collected order ends at PICKED_UP, so it was never settled and the shop
was never paid for it, although §13.2 scenario 1 ("one-store pickup completes and settles exactly
once") was recorded as covered — the verifier had asserted inventory settlement, not money. The
worker's `vendor_order.picked_up` handler (`apps/worker/src/domain-event-handler.ts`) now settles
when the method is `CUSTOMER_PICKUP`; the ladder asserts a settlement paying the shop for both the
collected and the self-delivered order and no partner earning for either.

## API

- **`vendor/locations/:vendor_location_id/orders`** (`vendor.order.fulfil`): `accept`, `decline`,
  `start-picking`, `lines/:id/found`, `lines/:id/missing`, `lines/:id/propose-substitution`,
  `lines/:id/propose-weight`, `ready`, `pickup-otp`, `complete-pickup`, `self-delivery/start`,
  `self-delivery/complete`, `picks` (list).
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
