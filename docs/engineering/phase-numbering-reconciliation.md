# Phase Numbering Reconciliation

**Scope:** documentation ledger only, company-local synthetic development
**Production authority:** None

## Why this exists

`phases.md` is the delivery register. As Phase 5 was executed, several foundation slices were
built ahead of their plan position and were labelled with Phase 5 sub-numbers that `phases.md`
assigns to different work. Two documents can therefore both call themselves "Phase 5.6" while
describing unrelated slices, and neither `README.md` nor the engineering docs could be trusted to
answer "what is done".

This table is the reconciliation. **`phases.md` remains authoritative for what a step number
means.** Where a shipped document uses a conflicting label, that label is recorded here as a known
alias rather than silently renumbered.

## Executed slices

| Migration | Slice | `phases.md` position | Label used in its doc | Status |
|---|---|---|---|---|
| `0010` | Vendor and location domain | 5.1 | — | agrees |
| `0011` | Vendor onboarding and verification | 5.2 | — | agrees |
| `0012` | Vendor publication workflow | 5.3 | — | agrees |
| `0013` | Inventory reservations | **Phase 7** (inventory holds) | "Phase 5.4" | built early; label conflicts with `phases.md` 5.4 *vendor staff and settings* |
| `0014` | Assignment and custody | **Phase 9** | "Phase 5.5" | built early; label conflicts with `phases.md` 5.5 *catalogue product management* |
| `0015` | Synthetic money lifecycle | **Phase 10** | "Phase 5.6" | built early; label conflicts with `phases.md` 5.6 *CSV import* |
| `0016` | Catalogue freshness and moderation | 5.7 | "Phase 5.7" | agrees |
| `0017`, `0018` | Catalogue products, CSV import, substitutions | 5.5 and 5.6 | named, not numbered | documented in [catalogue products and import](catalogue-products-and-import.md) |
| `0019` | Customer address management | 6.1 | "Phase 6.1" | agrees; documented in [customer address management](customer-address-management.md) |
| `0020` | Customer discovery, search, favourites, storefront | 6.2–6.5 | named, not numbered | documented in [customer discovery and storefront](customer-discovery-and-storefront.md) |
| `0021` | Vendor-grouped cart, validation, and recovery | 6.6–6.7 | named, not numbered | documented in [customer cart and validation](customer-cart-and-validation.md) |

## Consequences to carry forward

- `phases.md` steps **5.4** (vendor staff and settings) and parts of **5.3** (admin vendor
  pipeline views, test-order gate) are **not** delivered by any migration above. They remain open
  Phase 5 work despite Phase 5 otherwise being complete at the persistence and service layer.
- Phases 7, 9 and 10 each have persistence foundations in place but none of their workflow,
  API, or UI steps. A future Phase 7/9/10 must treat `0013`/`0014`/`0015` as groundwork already
  laid, not as those phases being started.
- Client surfaces lag throughout. Phase 5 exit requires a published vendor to be *discoverable*;
  that is currently provable through the service layer and `pnpm db:verify`, not through a UI.

## Rule going forward

A new slice states its `phases.md` step by number **and** name in its scope line, and is added to
the table above in the same change. A slice that deliberately runs ahead of its plan position says
so explicitly instead of borrowing a free-looking number from the current phase.
