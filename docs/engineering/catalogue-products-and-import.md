# Catalogue Products and CSV Import

**Scope:** phases.md Phase 5 steps *catalogue product management* and *CSV import*, company-local
synthetic development only. These are steps 5.5 and 5.6 in `phases.md`; this repository's earlier
docs already used the labels "5.5" and "5.6" for other slices, so this document names the steps
rather than renumbering them. See [phase numbering reconciliation](phase-numbering-reconciliation.md).
**Production authority:** None

## Outcome

Migrations `0017_catalogue_products_and_imports` and `0018_catalogue_substitutions` give a vendor
location an owned product catalogue: products, variants, prices, images, a staged CSV import
pipeline, and substitution suggestions. Every write is contained to one `vendor_location_id`.

## Aggregates

| Table | Owns |
|---|---|
| `catalogue_products` | Product identity, category, unit, tax basis, variable-weight rule, lifecycle, version |
| `catalogue_product_variants` | SKU, variant title, pack quantity, lifecycle |
| `catalogue_prices` | Price history; one open-ended row per variant at a time |
| `catalogue_product_images` | Ordered images, unique position per product |
| `catalogue_imports` | One staged or committed CSV import per idempotency key |
| `catalogue_import_rows` | Row-level state, raw row, validation errors, committed product |
| `catalogue_product_substitutions` | Replacement suggestions between variants |

## Rules this slice enforces

- A product reference is unique inside a vendor location, never globally
  (`catalogue_product_vendor_reference_unique`).
- A variable-weight product must carry a variance between 0 and 10000 basis points; a packaged
  product must carry none (`catalogue_product_weight_shape`).
- Exactly one price per variant may be open-ended (`one_active_catalogue_price`), so price history
  is preserved for later order snapshots.
- Lifecycle changes are optimistic: a caller passing a stale `expected_version` is refused.
- Staging an import never touches the live catalogue. Rows are parsed, validated and stored with
  their errors; only an import whose rows are all valid and non-empty may commit.
- Commit is idempotent per `(vendor_location_id, idempotency_key)`. Replaying a staged import
  returns the original import; replaying a commit returns the same committed result without
  creating a second product.
- A substitution is a single row per `(variant, replacement)` pair that toggles state rather than
  accumulating duplicates, and both variants must belong to the acting vendor location.

## Verification

`database/scripts/verify-catalogue-products.ts` runs 11 connected scenarios covering product
creation and pricing, duplicate references, both variable-weight validation directions, optimistic
lifecycle transitions, cross-vendor isolation for both reads and writes, staged-import isolation
and idempotency, invalid-row commit refusal, commit replay, malformed headers, substitution
toggling, and unauthenticated access. It is wired into `verify-lifecycle.ts` and reported as
`catalogue_product_scenarios`.

## Fixed during verification

The original `0017` migration constrained `source_filename` with `'…\\.csv$'`. Under
`standard_conforming_strings`, that requires a literal backslash before `csv`, so the check
rejected every well-formed filename and CSV import could never insert a row. The application-level
regex accepted the same filename, so the mismatch only surfaced at the database boundary. The
constraint now uses `'…\.csv$'`. This slice had no verification script when it was written, which
is why the defect survived; the verifier above closes that gap.

## Boundaries

Customer-facing discovery, storefront browsing, and cart behaviour are **not** part of this slice.
Availability freshness and moderation belong to Phase 5.7
([catalogue freshness and moderation](catalogue-freshness-and-moderation.md)). Order snapshots that
consume this price history begin in a later phase.
