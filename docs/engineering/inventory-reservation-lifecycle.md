# Inventory Reservation Lifecycle

**Scope:** Phase 5.4, company-local synthetic development only  
**Production authority:** None

## Outcome

Migration `0013_inventory_reservations` and `InventoryReservationService` add an authoritative inventory ledger with two deliberately different quantity models:

- `COUNTED` stores an exact free quantity. A soft hold atomically subtracts units while the inventory row is locked; release or expiry restores those units exactly once.
- `VENDOR_CONFIRMS` stores no exact quantity. A reservation records customer intent, but `counted_stock_applied=false` prevents the system and clients from presenting it as guaranteed stock.

Cart activity remains reservation-free. Future checkout code may call the internal soft-hold command; future order placement may advance that hold to provisional; future vendor acceptance may commit it. Those aggregates and public customer/order routes do not exist yet, so Phase 5.4 does not fabricate ownership or authorization evidence for them.

## State contract

```text
SOFT_HELD ──> PROVISIONAL ──> COMMITTED ──> RELEASED
    │               │
    └──> EXPIRED <──┘
```

Checkout takes the soft hold at the quote and makes it provisional at placement; the shop's
acceptance commits it (`commitReservationsLocked`, inside the acceptance's transaction, since
audit run 50); decline, timeout, the customer's cancellation or expiry release it.
`SOFT_HELD` and `PROVISIONAL` carry server-time deadlines. A bounded worker command selects due records with `FOR UPDATE SKIP LOCKED`, returns counted units, writes the terminal state, and appends evidence in one transaction. `COMMITTED` has no expiry transition; cancellation or other later order policy must release it explicitly.

Every accepted mutation increments the inventory-item version. Every reservation transition also increments its reservation version. Events are unique by item/version and reservation/version and reject update or deletion.

## Concurrency and retries

Counted availability is checked while holding the inventory-item row lock. Two concurrent requests cannot both spend the same remaining units. The losing request receives `INVENTORY_UNAVAILABLE` with the safe exact remainder when one exists.

The pair `(inventory_item_id, source_reference)` is unique. Repeating an identical synthetic source and quantity returns the original reservation without reducing stock again; reusing the source for another quantity is rejected. Full checkout/order command idempotency will additionally use the shared Phase 3 command boundary when those endpoints are introduced.

Manual counted-stock replacement is rejected while an active hold, provisional reservation, or commitment exists. This prevents a stocktake from silently rewriting already-promised inventory.

## Authorization and interfaces

Vendor inventory APIs live under `/vendor/locations/:vendor_location_id/inventory`. Every route requires `vendor.catalogue.manage`, passes the location UUID to the authorization guard, conceals missing/sibling resources, and rechecks the item-to-location relationship inside the service before mutation.

The API currently exposes vendor item creation, location listing, counted-stock update, vendor-confirmation refresh, and reservation visibility. Reservation creation and checkout/order transitions remain internal service methods until their owning authenticated aggregates exist.

The checkout writes its soft holds inline, under the item's row lock, and both the checkout and vendor fulfilment release holds through one exported routine, `releaseReservationsLocked(client, …)`, which restores counted units, recomputes the shelf state and appends the `RELEASED` event inside the caller's transaction. Until audit run 42 each module had a private copy: the checkout's restored the units without the state, which the `inventory_counted_state_shape` check refused whenever the hold had taken the last units — so a declined payment on a sold-out-by-quote item failed outright, and one such expired quote stalled the worker's whole quote sweep — and the fulfilment's flipped the reservation to `RELEASED` without returning the units at all, so every vendor decline, timeout or customer cancellation of a counted item lost that stock for good. A re-quote also gives back the same cart's lapsed holds first, so a customer re-quoting the last units is not blocked by their own dead hold before the sweep reaches it.

The vendor PWA and Android app show the same synthetic stock ledger: exact free units, soft-held, provisional and committed quantities, plus an explicit vendor-confirms treatment. The horizontal movement strip is the defining interaction—it explains where units move without implying that the marketplace owns the stock.

## Verification

`verify-inventory-reservations.ts` proves concurrent over-reservation, exact retry replay, the full commit/release flow, server-time expiry restoration, vendor-confirms honesty, sibling-location containment, and append-only evidence. `verify-grouped-checkout.ts` proves the checkout's side: one soft hold per quoted line expiring with the quote and none for a blocked store; a declined payment giving the shelf back with its state recomputed and the release recorded; a re-quote after one's own quote lapsed taking a fresh hold; a competing customer blocked on the held store alone; and two customers quoting the last unit at once, with the interleaving forced by a held row lock, producing exactly one hold. `verify-vendor-fulfilment.ts` proves a declined order returns its units with the release recorded. `pnpm db:verify` also proves migration down/up boundaries and rebuild from zero. API metadata tests prove that every vendor inventory route carries the scoped catalogue capability.

## Deferred production and later-phase work

The synthetic product references are not a full catalogue implementation. Phase 5.7 adds customer-safe freshness labels and an audited product moderation boundary, but product pricing, tax, images, variable-weight rules, substitutions, CSV import, customer cart ownership, checkout quotes, placed orders, and vendor acceptance remain later work. Real stock, real catalogues, POS synchronization, production expiry workers, capacity evidence, monitoring and reconciliation remain blocked by the production replacement register and D-12.
