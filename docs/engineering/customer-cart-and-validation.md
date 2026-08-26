# Vendor-Grouped Cart, Validation, and Recovery

**Scope:** phases.md Phase 6 steps 6.6 (vendor-grouped cart) and 6.7 (cart validation and
recovery), company-local synthetic development only
**Production authority:** None

## Outcome

Migration `0021_customer_cart` and `CustomerCartService` give a customer one active cart split
into per-store groups. Adding a second store creates a second group rather than mixing lines; a
configured ceiling (default three) bounds distinct vendor locations, not line count. Cart items are
never represented as reserved inventory — nothing here touches `inventory_reservations`.

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
- **Revalidation isolates failure to one group.** `revalidate()` re-checks every `ACTIVE` group
  against the vendor location's lifecycle state, its `PUBLISHED` publication case, and — when the
  cart carries an address — live service-zone coverage and marks a failing group `INVALID` with a
  specific reason (`STORE_CLOSED`, `STORE_UNPUBLISHED`, `ADDRESS_OUT_OF_ZONE`). A group's lines are
  independently checked against `catalogue_product_variants` and marked `STALE` if the variant is
  no longer active. **A sibling group in good standing is never touched** — this is the exit-gate
  property from `phases.md` §11: "A stale line or closed store does not destroy valid sibling
  groups," and the verifier below asserts it directly.
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

`database/scripts/verify-customer-cart.ts` — 9 connected scenarios: find-or-create idempotency,
two-store grouping, same-variant quantity merge, the group ceiling against a fourth store,
optimistic quantity change with stale-version rejection and last-line group removal, cross-customer
isolation, revalidation isolating one closed store while a healthy sibling group and its lines stay
untouched, the never-reserved-inventory property, and audit-evidence coverage. Wired into
`verify-lifecycle.ts` as `customer_cart_scenarios`. Shares
`verify-discoverable-store-fixture.ts` with the discovery verifier.

## Boundaries

Pricing, inventory holds, payment authorization, and grouped checkout are Phase 7. Nothing in this
slice quotes a price beyond what the catalogue's current price already provides, and no line here
is ever treated as a stock commitment.
