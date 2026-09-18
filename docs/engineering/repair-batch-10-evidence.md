# Repair batch 10 — the gate that never ran, and the order a store could not fulfil

**Implemented:** 18 September 2026. **Verification level:** the hosted CI gate executed on the branch for B10-01; domain services against a real PostgreSQL/PostGIS instance with mutation-proven assertions for B10-02 and B10-03; not a browser or device run.

This batch opened with a repository-wide read of every planning, decision, audit and evidence document against the tree at `718a63f`. Most of what the documents claim holds. Three things did not, and they are the batch.

## B10-01 — CI had been red on every push since 18 August

**What the audit recorded.** Run 11 (step 2.5) closed with "executed CI evidence … outstanding, and neither can be produced without pushing". The push happened on 17 September. Seven runs followed on `main` and `start`; every one failed or was cancelled, and the last green run predates any domain code. Branch protection on `main` is not enabled, so nothing stopped the red pushes from landing.

**One cause for all seven.** `packages/contracts/src/client.ts` imports `@neighbourhood-store/domain-types`, whose package export resolves at runtime to `dist/index.js`. A fresh checkout has no `dist/`. Every app's `test:unit` script already ran `ensure-packages-built.mjs` first; the three packages that import another package's runtime (`contracts`, `pwa-auth`, `app-auth`) did not. `pnpm -r` stops at the first failure, so CI only ever saw `contracts`. Locally the suite passed because leftover builds were present — the same shape as every other defect in this audit: a check that could not observe the thing it claimed to.

**Reproduced, then fixed, on a fresh clone.** `git clone` into a scratch directory, `pnpm install --frozen-lockfile`, zero `dist/` directories: `pnpm test:unit` exited 1 with the identical `ERR_MODULE_NOT_FOUND` as CI run 35219514917. The three package scripts gained the guard. The root `test:unit` runs the guard once before the recursive run as well — without that, `contracts` and `database` (topological siblings) both rebuilt `domain-types` concurrently while a third process imported it, which passed once and is exactly the kind of flaky gate batch 06 was written to remove. Re-run from zero `dist/`: exit 0, 485 pass, six rebuilds all serialized from the root.

**Hosted evidence.** [Run 35329095886](https://github.com/anirudhbhatia-1/vendor-base/actions/runs/35329095886), dispatched on `feat/azure-test-deployment`: every mandatory step green, including the disposable-database `pnpm db:verify` ladder (79 migrations at the time) and the API/worker integration smokes. The first green "Mandatory quality gate" on a tree containing domain code. Step 2.5's two outstanding items are now one: branch protection is a repository setting only the owner can enable.

## B10-02 — the cart took any fulfilment method for any store (CUS-33)

**What the catalogue says.** CUS-33: *"Customers select pickup, vendor delivery, or platform delivery independently **where the vendor and zone support them**."* Batch 08 recorded, in its still-open list, that neither the cart nor the quote checked `vendor_location_fulfilment_modes`. The feature matrix nonetheless carried CUS-33 as `complete_local_synthetic`.

**What actually happened.** `addLine` created every new store group as `PLATFORM_DELIVERY`, whatever the store offered. `setGroupFulfilmentMethod` wrote whatever it was given. `createQuote` quoted the group. A pickup-only shop could therefore take a platform-delivery order it had no way to fulfil, and the ladder itself contained the case: the vendor-fulfilment verifier's store approved only `PLATFORM_DELIVERY` (the fixture default) and checked out a `CUSTOMER_PICKUP` order from it. On the customer PWA the `<select>` listed only offered modes while binding its value to the server's method, so for a pickup-only store the screen read *Pickup* while the server held *Delivery*. The Android app had already chosen a valid default client-side (`Marketplace.tsx:85`); the server never did.

**Fix, at the server so every client is right.**

- A new group starts with platform delivery where the store offers it, otherwise the first of vendor delivery or collection it does offer. A store with no approved mode refuses the add; publication requires at least one, so this cannot strand a published store.
- A requested method the store lacks is refused with `FULFILMENT_METHOD_UNAVAILABLE` (422) carrying `offered_modes` — at group creation and at `PUT groups/:id/fulfilment-method`. The code is registered in `ERROR_DEFINITIONS` (the typed message table refuses to compile without a sentence), its locale key in migration 0079 with English and Hindi (the Hindi carried forward for native-speaker review with 0064–0076), and `offered_modes` joins the exception filter's detail allowlist, which stays an allowlist.
- The cart projection carries `fulfilment_method_offered`. It is false only when a store withdrew a mode after the group chose it; the customer's repair is to choose another, so the group is not invalidated. The PWA lists the withdrawn value as a disabled option and shows the field error, so the bound value is honest.
- The quote blocks such a group with `FULFILMENT_METHOD_UNAVAILABLE`, ahead of minimum and stock because it is the one the customer can repair without changing what they are buying. The schema's CHECK on blocked reasons had to be widened in 0079 — it refused the new reason on the first run, which is the constraint doing its job.

## B10-03 — a collected order was charged the delivery fee

Found on the same path. `calculateCheckoutPricing` took no fulfilment method and charged `calculateDistanceAmount(route_metres)` to every group. design.md 7.8 says *"delivery fee/pickup ₹0"*; a customer who chose to collect paid ₹15 or more to do so, and the amount sat in the platform's clearing with nobody's earning against it. `fulfilment_method` is now an input and `CUSTOMER_PICKUP` prices at zero delivery. Vendor delivery keeps the distance fee the customer already paid; to whom that fee settles is a D-05 question the code now names rather than decides.

## What the ladder now asserts

`verify-customer-cart.ts` (30 → 37): a pickup-only store's group defaults to collection and reports it offered; delivery from that store is refused as `FULFILMENT_METHOD_UNAVAILABLE` with exactly `['CUSTOMER_PICKUP']` offered and the group's method and version unchanged; collection from a delivery-only store is refused before any group exists; a withdrawn mode reads `fulfilment_method_offered: false`.

`verify-grouped-checkout.ts` (15 → 23): a collected group is quoted with `delivery_minor` 0 and total equal to items plus tip while a delivered group at the same distance carries the fee; withdrawing the store's mode after the quote expires blocks that group as `FULFILMENT_METHOD_UNAVAILABLE` and leaves its sibling quoted.

`verify-vendor-fulfilment.ts`: its stores now approve both modes, since one of their orders is collected.

**Mutation-proven**, each on a fresh test database, each source restored and confirmed byte-identical:

| Probe | Caught by |
|---|---|
| Refusal removed from `setGroupFulfilmentMethod` | *Delivery from a pickup-only store was not refused as FULFILMENT_METHOD_UNAVAILABLE* |
| New group defaults to `PLATFORM_DELIVERY` regardless (old behaviour) | *A pickup-only store's group did not default to collection (got PLATFORM_DELIVERY)* |
| Quote ignores `method_offered` | *A group whose method the store withdrew was not blocked … (got [])* |
| Pricing charges delivery to a collected group (old behaviour) | *A collected group was charged a delivery fee (delivery 1500)*, and `checkout-pricing.spec.ts` 1 fail |
| Explicit unoffered method accepted at group creation | *Collection from a delivery-only store was accepted at group creation* |

The first probe run failed on `customer_addresses_address_reference_key` before reaching its assertion: the cart verifier uses a fixed address reference, so it cannot run twice on one database. Redone on a fresh stack rather than counted — the rule from batches 02–05 — and it is the harness property batch 06 recorded, unchanged.

## Verification

| Check | Result |
|---|---|
| `pnpm db:verify` | exit 0 — 80 migrations, full down/up ladder and rebuild from zero; `customer_cart` 30 → 37, `grouped_checkout` 15 → 23 |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls`, `pnpm contracts:check` | exit 0 |
| `pnpm test:unit` | 486 pass / 0 fail (+1: the collected-group pricing case) |
| CI run 35329095886 (B10-01, before B10-02/03) | success |

## Still open

- **Branch protection** on `main` requiring the Mandatory quality gate — a repository setting, not a file.
- **Browser and device runs.** The checkout panel changed and was not driven; the Android customer app's own default was already correct and is unchanged.
- **Who settles the vendor-delivery fee** — carried to D-05.
- **The cart verifier cannot re-run on one database** (fixed address reference); every verifier that assumes a fresh schema shares this, as batch 06 recorded.
