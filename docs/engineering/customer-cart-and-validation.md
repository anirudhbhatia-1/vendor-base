# Vendor-Grouped Cart, Validation, and Recovery

**Scope:** phases.md Phase 6 steps 6.6 (vendor-grouped cart) and 6.7 (cart validation and
recovery), company-local synthetic development only
**Production authority:** None

## Outcome

Migration `0021_customer_cart` and `CustomerCartService` give a customer one active cart split
into per-store groups. Adding a second store creates a second group rather than mixing lines; a
configured ceiling bounds distinct vendor locations, not line count — read from the versioned
configuration key `customer.cart_group_limit` (a `SETTING`, 1–10) at the instant of the add, with
`DEFAULT_CART_GROUP_LIMIT` of three when nothing usable is active. Cart items are never
represented as reserved inventory — nothing here touches `inventory_reservations`. A group carries
a fulfilment method, a customer note (1–240 characters, trimmed) and `tip_minor`; tipping is not
enabled anywhere and nothing sets the tip, which is priced at zero.

## Aggregates

- `carts` — one `ACTIVE` cart per customer (`one_active_cart_per_customer` partial unique index),
  optionally carrying a `customer_address_id`.
- `cart_vendor_groups` — one row per `(cart, vendor_location)`, carrying `fulfilment_method`
  (`CUSTOMER_PICKUP` / `VENDOR_DELIVERY` / `PLATFORM_DELIVERY`, aligned with
  `vendor_location_fulfilment_modes`), a customer note, and a tip.
- `cart_lines` — one row per `(group, catalogue_variant)`; re-adding the same variant merges
  quantity rather than duplicating the line.
- `cart_events` — append-only history of every group/line/address/method mutation.

## Rules this slice enforces

- **A second store never contaminates the first.** Groups are keyed by `(cart_id,
  vendor_location_id)`; every mutation targets one group or one line and is authorized against
  `carts.user_id`, so a stranger's line ID resolves not-found rather than leaking existence.
- **The group ceiling is enforced on distinct vendor locations**, checked against the customer's
  currently `ACTIVE` groups before a new group is created — adding more lines to an existing store
  never counts against it.
- **Removing the last line in a group removes the group.** An empty store never lingers as a silent
  extra delivery fee explanation.
- **A group receives its order in a way the store offers (CUS-33).** A new group starts with
  platform delivery where the store offers it, otherwise the first of vendor delivery or collection
  it does offer; a requested method the store lacks is refused with `FULFILMENT_METHOD_UNAVAILABLE`
  and the modes it has, at both group creation and `PUT groups/:id/fulfilment-method`. A mode
  withdrawn after the group chose it is reported as `fulfilment_method_offered: false` on the
  projection so the customer can choose another; the quote blocks the group meanwhile. Until
  batch 10 nothing checked this and every new group started as `PLATFORM_DELIVERY`, so a
  pickup-only shop could take a delivery order it had no way to fulfil.
- **Revalidation isolates failure to one group, and can undo it.** `revalidate()` re-checks every
  `ACTIVE` *and* `INVALID` group against the vendor location's lifecycle state, its `PUBLISHED`
  publication case, and — when the cart carries an address — live service-zone coverage, and
  marks a failing group `INVALID` with the reason on the row (`invalid_reason`: `STORE_CLOSED`,
  `STORE_UNPUBLISHED`, `ADDRESS_OUT_OF_ZONE`). A group's lines are independently checked and
  marked `STALE` with `stale_reason` when the product or variant is no longer active
  (`PRODUCT_NO_LONGER_ACTIVE`), has no current price (`PRICE_WITHDRAWN`) or has no inventory row
  for the store to answer from (`AVAILABILITY_UNKNOWN`) — each a line the quote's inner joins
  would otherwise drop without a word. Out of stock is not a stale reason: the quote reports it as
  a blocked group the customer can see. **A sibling group in good standing is never touched** —
  this is the exit-gate property from `phases.md` §11: "A stale line or closed store does not
  destroy valid sibling groups," and the verifier below asserts it directly. Since 0083 the way
  back exists too: a group whose checks all pass again returns to `ACTIVE`
  (`GROUP_REVALIDATED`) and a stale line whose product, price or stock record came back returns to
  `ACTIVE` (`LINE_REVIVED`); before that a group could only ever get worse and stayed out of the
  quote while the basket still showed it. Changing the cart's address revalidates in the same
  command, because that is one of the recovery actions 6.7 names. The table refuses a stale line
  or an invalid group with no reason. The basket shows the reason and offers removal of the line
  or the whole store; a stale line has no quantity to step and accepts no quantity change.
- **Cart items are never inventory.** No cart operation reads or writes
  `marketplace.inventory_reservations`; the verifier asserts the reservation table stays empty
  across the whole scenario.
- **Every mutation is audited.** Cart creation, group add/invalidate/remove, line
  add/quantity-change/stale/remove, address change, and fulfilment-method change all write to the
  append-only `cart_events` table.

## API

Routes under `customer/cart`, all behind capability `customer.cart.manage` with resource
concealment: `GET` (find-or-create), `PUT address`, `POST lines`, `PUT lines/:id`,
`POST lines/:id/remove`, `PUT groups/:id/fulfilment-method`, `POST revalidate`.

## Verification

`database/scripts/verify-customer-cart.ts` — 11 connected scenarios: find-or-create idempotency,
two-store grouping with the line's substitution preference kept (and defaulted to asking) and the
group note kept trimmed and bounded, same-variant quantity merge, the group ceiling against a
fourth store and then, once an activated `customer.cart_group_limit` of four is read, the fourth
admitted and a fifth refused, recovery of a closed store's group on refresh, every group
invalidated as out of zone by an address change and recovered by changing back, a paused
publication as `STORE_UNPUBLISHED`, a retired product isolated to its own line with the reason
while its sibling and the group stay active and a stale line refuses a quantity change, revival
when the product returns, `PRICE_WITHDRAWN` and `AVAILABILITY_UNKNOWN` with removal of a stale
line, five consecutive quantity updates landing on the last value with five version steps and
five audit rows, the table's own reason checks,
optimistic quantity change with stale-version rejection and last-line group removal, cross-customer
isolation, revalidation isolating one closed store while a healthy sibling group and its lines stay
untouched, the never-reserved-inventory property, and audit-evidence coverage. Wired into
`verify-lifecycle.ts` as `customer_cart_scenarios`. Shares
`verify-discoverable-store-fixture.ts` with the discovery verifier.

## Boundaries

Pricing, inventory holds, payment authorization, and grouped checkout are Phase 7. Nothing in this
slice quotes a price beyond what the catalogue's current price already provides, and no line here
is ever treated as a stock commitment.
