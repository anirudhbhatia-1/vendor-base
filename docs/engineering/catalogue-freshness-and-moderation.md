# Catalogue Freshness and Moderation

**Scope:** Phase 5.7, company-local synthetic development only  
**Production authority:** None

## Outcome

Migration `0016_catalogue_freshness_moderation` adds a safe customer read boundary on top of the inventory ledger.

- Customer availability reads return a truthful availability state, `last_confirmed_at`, and server-calculated freshness. Exact counted stock is never exposed.
- A confirmation within 15 minutes is `FRESH`; 15–60 minutes is `STALE`; anything older is `EXPIRED`. Vendor-confirms stock remains explicitly non-guaranteed.
- Administrators with `admin.catalogue.moderate` work a cross-vendor moderation queue. `CORRECTION_REQUIRED` and `RESTRICTED` decisions need an actionable correction reason and hide only the affected product from customer availability.
- Opening and deciding a case writes append-only, attributable evidence. A stale version or repeat decision is rejected.

## Interfaces and access

`GET /catalogue/locations/:vendor_location_id/availability` is the customer-safe read model. It returns active sellable inventory at the requested location and excludes out-of-stock, correction-required, and restricted items.

`GET /admin/catalogue/moderation`, `POST /admin/catalogue/moderation`, and `PUT /admin/catalogue/moderation/:moderation_case_id/decision` require the global `admin.catalogue.moderate` capability held by `CATALOGUE_MODERATOR`.

Vendor mutations remain location-scoped under `vendor.catalogue.manage`; no cross-vendor vendor route or client-only tenancy control was added.

## Verification

`verify-catalogue-freshness-moderation.ts` proves freshness labels, customer suppression of exact stock, location isolation, moderation decisions, product-only hiding, and durable evidence. The API metadata test proves every moderation route requires its scoped capability. `pnpm db:verify` exercises rollback/forward and rebuild behavior.

## Deferred work

This is a local synthetic catalogue boundary, not a production moderation policy. It does not select a real taxonomy, prohibited-goods rules, supplier/POS synchronization, image processing, notifications, legal review, or a public customer storefront. Those remain blocked by D-12 and the production replacement register.
