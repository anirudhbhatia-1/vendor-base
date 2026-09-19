# Customer Discovery, Search, Favourites, and Storefront

**Scope:** phases.md Phase 6 steps 6.2 (eligible store discovery), 6.3 (search and filters),
6.4 (favourites, preferred store, shop request), and 6.5 (storefront and product browsing),
company-local synthetic development only
**Production authority:** None

## Outcome

Migration `0020_customer_discovery_and_preferences` and `CustomerDiscoveryService` let an
authenticated customer find eligible stores near a saved address, search products across them,
browse a full storefront, keep favourites and one preferred store, and request a missing shop.
Every read is scoped to stores that are active, published, and covered by an active service zone —
never to a store the customer has no eligibility path to.

## Aggregates

- `customer_favourite_stores` — one row per (customer, store); no cap, dedup on conflict.
- `customer_preferred_store` — at most one row per customer (primary key is `user_id`).
- `customer_shop_requests` — a pin/coordinate/store-name request with a lifecycle
  `OPEN → TRIAGED → CLOSED`; a partial unique index allows only one `OPEN` request per
  `(user_id, pin_code)`. Since 0081 a moved request records who handled it, the onboarding lead it
  became (`onboarding_case_id`) and, when closed, the reason — the table refuses a move with no
  handler and a close with no reason.
- `customer_recent_searches` — deduplicated by normalized term, most-recent-first, capped to the
  10 most recent at read time.
- `customer_discovery_events` — append-only, privacy-safe funnel: event type and result count only,
  never a free-text term, address, or coordinate.

## Rules this slice enforces

- **Eligibility is derived, never cached.** `discoverStores`, `searchProducts`, and the favourite
  eligibility flag all re-check `ACTIVE` vendor location, `PUBLISHED` publication case, and
  `ST_Covers` against an `ACTIVE` service zone at query time. Pausing a store or retiring a zone
  changes the answer on the next call with nothing to invalidate.
- **No cross-vendor catalogue mixing.** Every storefront and search join is pinned to one
  `vendor_location_id`; a product cannot appear under a location it does not belong to.
- **Search ranks available ahead of unavailable**, normalizes the term (lowercase, collapsed
  whitespace), and expands a small synonym table (e.g. `aloo` → `potato`). A zero-result search is
  itself a funnel event (`SEARCH_ZERO_RESULT`), not silently dropped.
- **Storefront freshness** joins each active `catalogue_products` row to `inventory_items` by
  `(vendor_location_id, product_reference)`. A product with no matching inventory row is reported
  `is_stale: true` rather than guessed-available. A product under an open
  `CORRECTION_REQUIRED`/`RESTRICTED` moderation case is excluded entirely, reusing the Phase 5.7
  moderation boundary.
- **Favourites and the preferred store are independent** of eligibility. Losing zone coverage never
  deletes either; both reads take an address and derive `is_currently_eligible` at read time, so
  the change is shown rather than the preference vanishing. Favouriting or preferring a store that
  does not exist is refused as not found.
- **A shop request cannot be spammed** in one area: the partial unique index blocks a second `OPEN`
  request for the same customer and pin until the first is triaged or closed, but a genuinely new
  area is always accepted. Operators read the queue oldest first, triage a request (optionally
  linking the `vendor_onboarding_cases` lead they created through onboarding — that module owns
  lead numbering, so triage links rather than creates) and close one with a reason. The queue
  carries the place, never the customer's identity.

## API

Routes under `customer/discovery`, all behind capability `customer.discovery.use` with resource
concealment: `GET stores`, `GET search`, `GET/DELETE recent-searches`, `GET stores/:id`
(storefront), `POST/DELETE favourites/:id`, `GET favourites`, `POST/DELETE/GET preferred-store`,
`POST shop-requests`; `GET preferred-store` takes an optional `customer_address_id` and returns
`{ preferred_store }` with the eligibility flag.

The pipeline side lives under `admin/shop-requests` (global admin scope): `GET` lists the queue
(`?state=` narrows it) behind `admin.vendor_onboarding.review`; `POST :id/triage` (optional
`onboarding_case_id`) and `POST :id/close` (`resolution`, 1–240 characters) behind
`admin.vendor_onboarding.manage`.

## Verification

`database/scripts/verify-customer-discovery.ts` — 9 connected scenarios: eligible discovery
ordered by distance with a funnel event, a real catalogue product/inventory row joined correctly
into the storefront (price, availability, staleness), a not-found storefront for an unknown
location, search ranking with a zero-result funnel event, recent-search dedup and deletion,
favourite add/idempotent re-add/removal with eligibility from the address and an unknown store
refused, the preferred store returned with its eligibility for an out-of-zone and an in-zone
store with exactly one row, shop-request dedup per pin with acceptance in a new pin and in Hindi,
the operator queue (oldest first, customer identity absent, triage into a real onboarding lead,
close with a reason, the state machine's refusals, the table's own checks, and asking again once
closed), and input/actor validation. Wired
into `verify-lifecycle.ts` as `customer_discovery_scenarios`. Shares
`verify-discoverable-store-fixture.ts` (a published, zoned, all-hours store) with the cart
verifier, so both exercise the real onboarding → publication → discovery chain instead of
faking eligibility.

## Boundaries

The grouped cart itself (6.6–6.7) is a separate slice —
[customer cart and validation](customer-cart-and-validation.md). Fee indication and promise
metadata mentioned in `phases.md` 6.2 are left to the client for this slice; nothing here computes
a delivery fee, since pricing/holds belong to Phase 7.
