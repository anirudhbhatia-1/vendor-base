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

`SOFT_HELD` and `PROVISIONAL` carry server-time deadlines. A bounded worker command selects due records with `FOR UPDATE SKIP LOCKED`, returns counted units, writes the terminal state, and appends evidence in one transaction. `COMMITTED` has no expiry transition; cancellation or other later order policy must release it explicitly.

Every accepted mutation increments the inventory-item version. Every reservation transition also increments its reservation version. Events are unique by item/version and reservation/version and reject update or deletion.

## Concurrency and retries

Counted availability is checked while holding the inventory-item row lock. Two concurrent requests cannot both spend the same remaining units. The losing request receives `INVENTORY_UNAVAILABLE` with the safe exact remainder when one exists.

The pair `(inventory_item_id, source_reference)` is unique. Repeating an identical synthetic source and quantity returns the original reservation without reducing stock again; reusing the source for another quantity is rejected. Full checkout/order command idempotency will additionally use the shared Phase 3 command boundary when those endpoints are introduced.

Manual counted-stock replacement is rejected while an active hold, provisional reservation, or commitment exists. This prevents a stocktake from silently rewriting already-promised inventory.

## Authorization and interfaces

Vendor inventory APIs live under `/vendor/locations/:vendor_location_id/inventory`. Every route requires `vendor.catalogue.manage`, passes the location UUID to the authorization guard, conceals missing/sibling resources, and rechecks the item-to-location relationship inside the service before mutation.

The API currently exposes vendor item creation, location listing, counted-stock update, vendor-confirmation refresh, and reservation visibility. Reservation creation and checkout/order transitions remain internal service methods until their owning authenticated aggregates exist.

The vendor PWA and Android app show the same synthetic stock ledger: exact free units, soft-held, provisional and committed quantities, plus an explicit vendor-confirms treatment. The horizontal movement strip is the defining interaction—it explains where units move without implying that the marketplace owns the stock.

## Verification

`verify-inventory-reservations.ts` proves concurrent over-reservation, exact retry replay, the full commit/release flow, server-time expiry restoration, vendor-confirms honesty, sibling-location containment, and append-only evidence. `pnpm db:verify` also proves migration down/up boundaries and rebuild from zero. API metadata tests prove that every vendor inventory route carries the scoped catalogue capability.

## Deferred production and later-phase work

The synthetic product references are not a full catalogue implementation. Phase 5.7 adds customer-safe freshness labels and an audited product moderation boundary, but product pricing, tax, images, variable-weight rules, substitutions, CSV import, customer cart ownership, checkout quotes, placed orders, and vendor acceptance remain later work. Real stock, real catalogues, POS synchronization, production expiry workers, capacity evidence, monitoring and reconciliation remain blocked by the production replacement register and D-12.
