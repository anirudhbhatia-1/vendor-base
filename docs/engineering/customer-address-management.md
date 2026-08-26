# Customer Address Management

**Scope:** phases.md Phase 6 step 6.1 _customer address management_, company-local synthetic
development only
**Production authority:** None

## Outcome

Migration `0019_customer_addresses` and `CustomerAddressService` let an authenticated customer keep
a small set of saved delivery addresses, choose exactly one as the ordering address, and see which
vendor locations can serve each address. This is the first Phase 6 step; it is a governed slice
with an engineering doc, a connected verify script, a controller authorization spec, and this
completion note.

## Aggregate

`customer_addresses` stores a synthetic address reference, label, six-digit pin, a PostGIS
`geography(Point)` coordinate with its source (`MANUAL_PIN` or `DEVICE_LOCATION`), optional landmark
and delivery instructions, a selection flag, lifecycle state, and an optimistic version.
`customer_address_events` is the append-only history (`CREATED`, `UPDATED`, `SELECTED`,
`DESELECTED`, `ARCHIVED`), protected by a trigger that rejects update and delete.

## Rules this slice enforces

- Every address belongs to one `user_id`; a customer can neither read nor change another
  customer's address (a concealed row returns not-found, never a confirmation).
- A customer keeps at most a configurable number of active addresses. The ceiling is read from
  versioned configuration key `customer.saved_address_limit` and falls back to
  `DEFAULT_SAVED_ADDRESS_LIMIT` (4). The check is serialised with a per-customer transaction-level
  advisory lock, because the row that would breach the ceiling does not exist yet and so cannot be
  row-locked.
- Exactly one active address is selected at a time, enforced by the partial unique index
  `one_selected_address_per_customer`. The first saved address is auto-selected; changing the
  selection deselects the previous one in the same transaction.
- Editing is optimistic: a caller passing a stale `expected_version` is refused.
- Removing an address **archives** it (`lifecycle_state = 'ARCHIVED'`) and releases its selection.
  The row is never deleted, so history and any later order snapshot keep resolving. A CHECK
  constraint forbids an archived address from remaining selected.
- Serviceability is **derived, never stored**: `eligibleVendorLocations` covers the address point
  against active `vendor_service_zones` of active vendor locations at query time, so retiring a
  zone changes the answer immediately with no cache to invalidate.
- Later fulfilment actors are stage-gated. `fulfilmentProjection` withholds precise coordinates and
  the free-text fields until the stage is `CARRYING`; earlier stages see only pin, label, and the
  address id. Orders and assignments do not exist yet (Phase 7+), so the owning customer is the
  only live caller and no fulfilment authorization is fabricated.

## API

Routes under `customer/addresses`, all behind capability `customer.address.manage` with resource
concealment:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/` | List active addresses and the current saved-address limit |
| `POST` | `/` | Create and, for the first address, auto-select |
| `PUT` | `/:id` | Optimistic edit |
| `POST` | `/:id/select` | Make this the single ordering address |
| `GET` | `/:id/eligible-vendor-locations` | Derived serviceability |
| `DELETE` | `/:id` | Archive (never delete) |

## Verification

- `database/scripts/verify-customer-addresses.ts` — 12 connected scenarios: auto-selection and
  coordinate round-trip, creation/selection audit evidence, the default ceiling and its
  enforcement, single-selection invariant with deselection evidence, optimistic edit and stale
  rejection, archive-not-delete with slot release, derived serviceability in and out of zone, a
  deactivated zone dropping serviceability, cross-customer isolation for read and write, the
  fulfilment stage gate, and input/actor validation. Wired into `verify-lifecycle.ts` and reported
  as `customer_address_scenarios`.
- `apps/api/src/customer-addresses.controller.spec.ts` — asserts every route carries the customer
  address capability, conceals resources, is never vendor-scoped, and that no route is exposed
  without an authorization requirement.

## Boundaries

Store discovery, search, favourites, storefront browsing, and the grouped cart are later Phase 6
steps (6.2–6.7) and are **not** part of this slice. Address data feeding a placed order, and the
real fulfilment authorization the stage gate anticipates, begin in Phase 7 onward.
