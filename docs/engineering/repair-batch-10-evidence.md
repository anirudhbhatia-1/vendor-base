# Repair batch 10 — the gate that never ran, the order a store could not fulfil, and the sale that never settled

**Implemented:** 18 September 2026. **Verification level:** the hosted CI gate executed on the branch for B10-01; domain services against a real PostgreSQL/PostGIS instance with mutation-proven assertions for B10-02 through B10-05; unit-tested routing for B10-06; not a browser or device run.

This batch opened with a repository-wide read of every planning, decision, audit and evidence document against the tree at `718a63f`. Most of what the documents claim holds. What did not is the batch: a gate, a validation, and — found while repairing the second — three gaps on the path an order takes out of the shop.

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

## B10-04 — vendor self-delivery did not exist (VEN-37)

**What the catalogue says.** VEN-37, *Launch*: "Authorized vendor staff can perform the approved delivery flow with status and proof controls." Workflow 6.7 names the leg. The matrix carried it `backend_only` with "no self-delivery flow in client", and batch 08 recorded, in its open list, that the vendor console had no dispatch or delivery step for it and that the domain still accepted a vendor fallback collection code on such an order.

**What actually happened.** A customer could choose `VENDOR_DELIVERY` at checkout (B10-02 now checks the store offers it) and the order reached READY. Then: the console said the step was "not available yet"; the customer's delivery code was minted only on a delivery assignment, which a self-delivery never has, so `POST customer/orders/:id/delivery-otp` answered "no delivery is in progress"; and the counter still accepted a vendor fallback code, which would have recorded a handover as `CUSTOMER_PICKUP_COMPLETED` on an order nobody collected and left it at PICKED_UP with no path to DELIVERED — where, per B10-05, nothing settles.

**Fix.** The leg reuses the order's own states. `POST …/self-delivery/start` moves READY → PICKED_UP with `out_for_delivery_at` and the carrying staff member recorded (`vendor_delivery_by_user_id`, migration 0080), reason `VENDOR_DELIVERY_STARTED`, and emits the same `vendor_order.picked_up` a counter handover does. The customer's delivery-otp route now branches by method and mints the code on the order for a self-delivery. `POST …/self-delivery/complete` validates it with the two-transaction pattern `complete-pickup` uses (a wrong attempt is counted even though the caller's error unwinds them), spends it, and ends the order through `completeVendorOrder` as DELIVERED with reason `VENDOR_DELIVERY_COMPLETED` — the same event a partner delivery emits. The four door refusals carry the `DELIVERY_OTP_*` codes the partner's door uses. The counter (`complete-pickup` and the vendor fallback issuer) now refuses a self-delivered order. The vendor console gains *Start delivery* on a READY self-delivery and the customer's-code field plus *Mark delivered* on the road, and keeps such an order in the active list until the door.

**Assumption stated:** the fee the customer paid for a self-delivery rests with the platform, as the pricing module already did; whether it should settle to the shop is D-05's to decide and is named in the code rather than guessed. The vendor Android shell is unchanged (it does not complete any handover today, and every Android claim in the matrix is `unverified`).

## B10-05 — a collected order never settled

`createSettlement` was called from exactly one place, `recordDeliveryEarnings`, which the worker ran only on `vendor_order.delivered`. A collected order's last state is PICKED_UP. So the shop was never paid for anything a customer carried out of it themselves — and §13.2 scenario 1, *"one-store pickup completes and settles exactly once"*, was recorded as covered by a verifier that asserted inventory settlement, not money.

The worker's `vendor_order.picked_up` handler now runs the settlement when the method is `CUSTOMER_PICKUP`; a delivery is still on its way and settles at the door. The ladder asserts a settlement paying the shop for both the collected and the self-delivered order, and no partner earning for either.

## B10-06 — the worker's event routing could not be tested

The routing lived in a closure inside a service that constructs fourteen dependencies in its constructor, reachable only through the integration queue canary — which carries an event that reacts to nothing. It had never been asserted. `apps/worker/src/domain-event-handler.ts` now holds it as a function over the narrowest shape each branch needs; the service delegates to it, and `domain-event-handler.spec.ts` asserts every branch with fakes: which service each event reaches, that a collected order settles on pickup while a delivery does not, that acknowledged-without-reaction types do nothing, and that an unknown type fails rather than being acknowledged. Mutation-proven: dropping the pickup-settlement branch fails one test.

## B10-07 — the live journeys had no fixtures, and two of them could not have passed

The 25 Playwright journeys gated on `LIVE_SUPABASE_ACCEPTANCE` fail without their data (batch 04 removed the conditionals that let them pass empty), and nothing provided the data. `database/scripts/live-supabase-fixtures.ts` now does, through the API and Supabase Auth only: a store with a stocked product, a rider holding an order that is `EN_ROUTE_TO_CUSTOMER` and then taken offline, a second order left `PLACED`, and a `PENDING` moderation case. Because the awaiting order expires minutes after placement, `e2e/global-setup.ts` seeds inside the same `pnpm test:e2e` run when `ACCEPTANCE_SEED_FIXTURES=true`, and copies the printed `ACCEPTANCE_*` block onto the process the workers fork from. The helpers it shares with `live-supabase-acceptance.ts` moved to `acceptance-support.ts`.

Building it exposed three defects by source inspection:

- The partner journey asserted a button named *Delivery failed*. No such control exists — that string is the `DELIVERY_FAILED` state label in `packages/ui`; the control is *I cannot deliver this*, offered only `EN_ROUTE_TO_CUSTOMER` or `ARRIVED`. The spec now names the control, and the fixture leaves the rider in that state.
- The admin journey's `/checkout group/` and `/live cases/` were satisfied by "0 checkout groups loaded" and "0 live cases" — the empty state the batch-04 control was written to reject, reached through a count rather than an alternation. Both now require a non-zero leading digit.
- `live-supabase-acceptance.ts` polled for a partner offer straight after checkout, but dispatch offers only `ACCEPTED/PICKING/READY` orders (a rider is never offered an order the shop may still decline). The script could not have passed since that guard was added; it now has the vendor accept first.

Plumbing proven locally: with both flags set and no Supabase environment, `playwright test` spawns the provisioner from `database/`, the provisioner exits 1 on `SUPABASE_URL is required`, and the run fails at global setup; without the flags the setup is a no-op and `playwright test --list` still enumerates 40 tests. **The provisioner has not been run against a Supabase project**: the role PWAs sign in through Supabase Auth, so it cannot run against local PostgreSQL, and seeding the shared synthetic project needs approval.

## What the ladder now asserts

`verify-customer-cart.ts` (30 → 37): a pickup-only store's group defaults to collection and reports it offered; delivery from that store is refused as `FULFILMENT_METHOD_UNAVAILABLE` with exactly `['CUSTOMER_PICKUP']` offered and the group's method and version unchanged; collection from a delivery-only store is refused before any group exists; a withdrawn mode reads `fulfilment_method_offered: false`.

`verify-grouped-checkout.ts` (15 → 23): a collected group is quoted with `delivery_minor` 0 and total equal to items plus tip while a delivered group at the same distance carries the fee; withdrawing the store's mode after the quote expires blocks that group as `FULFILMENT_METHOD_UNAVAILABLE` and leaves its sibling quoted.

`verify-vendor-fulfilment.ts` (145 → 171): its stores approve all three modes. A self-delivered order is walked end to end — quoted with a delivery fee, accepted, picked, ready; the customer cannot mint a collection code for it, the vendor fallback is refused, the delivery code cannot be minted before it leaves, it cannot be completed before it starts, another store's staff cannot start it, a stale version is `VERSION_CONFLICT`, and a collected order (asserted while it is still READY, so the method check and not the state check is what refuses) cannot be sent out with staff; starting it records the carrying member of staff and `VENDOR_DELIVERY_STARTED`; inventory settles; a stranger cannot mint the delivery code; a wrong code is counted; the right code ends it as DELIVERED with `VENDOR_DELIVERY_COMPLETED` and the code spent; a spent code cannot complete it again. Then both the collected and the self-delivered order capture and settle with a positive vendor payable and no partner earning.

**Mutation-proven**, each on a fresh test database, each source restored and confirmed byte-identical:

| Probe | Caught by |
|---|---|
| Refusal removed from `setGroupFulfilmentMethod` | *Delivery from a pickup-only store was not refused as FULFILMENT_METHOD_UNAVAILABLE* |
| New group defaults to `PLATFORM_DELIVERY` regardless (old behaviour) | *A pickup-only store's group did not default to collection (got PLATFORM_DELIVERY)* |
| Quote ignores `method_offered` | *A group whose method the store withdrew was not blocked … (got [])* |
| Pricing charges delivery to a collected group (old behaviour) | *A collected group was charged a delivery fee (delivery 1500)*, and `checkout-pricing.spec.ts` 1 fail |
| Explicit unoffered method accepted at group creation | *Collection from a delivery-only store was accepted at group creation* |
| Counter accepts a self-delivered order again | *A vendor fallback collection code was issued on a self-delivered order* |
| `startVendorDelivery` ignores the method | *A collected order was sent out with store staff* — after moving the assertion to the READY state; in its first position the order was already PICKED_UP and the state check refused it for the wrong reason, the trap runs 17 and 30 recorded |
| The door accepts any code | *A wrong delivery code completed a self-delivery* |
| Settlement demands a partner assignment | *The collected order did not settle without a partner earning* |
| Delivery code minted before dispatch | *A delivery code was minted before the order left the shop* |
| Worker no longer settles on pickup | `domain-event-handler.spec.ts` 1 fail |

The first probe run failed on `customer_addresses_address_reference_key` before reaching its assertion: the cart verifier uses a fixed address reference, so it cannot run twice on one database. Redone on a fresh stack rather than counted — the rule from batches 02–05 — and it is the harness property batch 06 recorded, unchanged.

## Verification

| Check | Result |
|---|---|
| `pnpm db:verify` | exit 0 — 81 migrations, full down/up ladder and rebuild from zero; `customer_cart` 30 → 37, `grouped_checkout` 15 → 23, `vendor_fulfilment` 145 → 171 |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls`, `pnpm contracts:check` (250 routes) | exit 0 |
| `pnpm test:unit` | 495 pass / 0 fail (+1 pricing, +8 worker routing) |
| `pnpm test:integration` | exit 0 — API and worker smokes including the queue canary through the extracted handler |
| CI run 35329095886 (B10-01, before B10-02–06) | success |

## Still open

- **Branch protection** on `main` requiring the Mandatory quality gate — a repository setting, not a file.
- **Browser and device runs.** The checkout panel changed and was not driven; the Android customer app's own default was already correct and is unchanged. The live journeys now have a provisioner (B10-07) but no recorded run: that needs a Supabase project and approval to seed it.
- **Who settles the vendor-delivery fee** — carried to D-05.
- **A self-delivery that fails at the door** (customer unreachable, wrong address) has no exception path of its own; the shop's route is a support case. The partner's guided exceptions (DLP-36–42) do not apply to staff.
- **Settlement is attempted once.** `recordDeliveryEarnings` returns `settled: false` when the group's authorization has not yet been captured (a sibling still PLACED) and nothing retries it — for a delivered order this window is minutes; for a fast collection it is real. Pre-existing, now shared by the collected path, recorded rather than solved here.
- **The vendor Android shell's *Issue pickup OTP*** sends no reason code and has done so since the fallback gained one — a 400 on every tap. Pre-existing and outside this batch.
- **The cart verifier cannot re-run on one database** (fixed address reference); every verifier that assumes a fresh schema shares this, as batch 06 recorded.
