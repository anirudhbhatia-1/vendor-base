# Repair batch 08 — the handover nobody could complete

**Implemented:** 14 September 2026. **Verification level:** domain services against a real PostgreSQL/PostGIS instance, one platform-delivery order and one collected order walked through the counter; the API contract and controls; not a browser or device run.

**Field report.** A vendor console showing a READY order, its chip reading *Offered to a delivery partner*, a field labelled *Customer's collection code* holding `111111`, and the refusal *"That step is not available yet. Check the job for what still has to happen first."*

## What was actually wrong

The sentence was accurate and useless, and it was the least of it.

**The order was being delivered by a partner, and the console asked for the customer's code.** One handover control served every order. On a platform delivery the customer is at home holding a *delivery* code for their door (CUS-56), and the customer app correctly never offers them a collection code. The partner — the one person who would be at the counter — had nothing to present at all: the only issuers of a pickup code were the customer (CUS-51) and the vendor's fallback, whose reasons are all about the customer's phone. So the shopkeeper was asked for a number nobody had, guessed one, and read a refusal.

**The console offered the handover before anyone had arrived.** The partner was still being *offered* the job. Had the guess matched, the order would have moved to PICKED_UP — committing stock and emitting the event money capture reacts to — for goods still on the shelf. Nothing in `completePickup` looked at the assignment.

**DLP-24 was claimed complete and did not exist.** *"Partners scan or enter approved proof tied to the correct assignment and vendor order."* The partner's pickup sent `vendor_confirmed: true` and a reference invented from the clock. The only server-side link was that the vendor order had to be PICKED_UP first — which, per the above, could only happen through a fallback issued for a reason that was not true. The connected ladder walked exactly that path: the customer minted a collection code for an order a partner delivered, and the vendor completed it as *"Customer collected the synthetic crate in person"* before a partner existed.

**Four refusals shared one code, and four declared codes were dead.** Not issued, wrong, expired and exhausted all reported `ORDER_STATE_CONFLICT`. Meanwhile `CUSTOMER_OTP_ACTIVE` and the three `DELIVERY_OTP_*` codes were declared at their controllers but never registered in `ERROR_DEFINITIONS`, so the filter discarded them: a partner typing a wrong delivery code read *"Something in that request was not valid"*, and an expired one read *"Refresh and try again"*. The batch-07 control checked the *shape* of a declaration and could not see this.

## B08-01 — the partner presents a pickup code (DLP-24, workflow 6.7.6)

`issuePartnerPickupOtp` mints a six-digit code on the partner's own assignment, only while it is `AT_VENDOR`, only for the partner who holds it, and stores its hash on the vendor order's existing `pickup_otp_*` columns with `pickup_otp_issued_by = 'PARTNER'` (migration 0075). Same lifetime, same attempt limit, same validation: `completePickup` did not change, and the shop validates one number whoever is standing there. `POST /partner/assignments/:id/pickup-otp`, guarded by `partner.assignment.act` scoped to the assignment.

The partner PWA and Android job screens show the code once `AT_VENDOR`. The vendor console, for a platform delivery, labels the field *Delivery partner's pickup code* and offers partner-shaped fallback reasons.

**Assumption stated:** the workflow says *"vendor and partner confirm … using QR/OTP"* without saying who holds the code. This batch has the partner present it and the vendor validate it, mirroring the customer path so the existing validated column and endpoint carry both. A QR alternative is not built.

## B08-02 — no handover to nobody

`requireCollectorPresent` runs inside both transactions of `completePickup` and inside the vendor fallback issuer. For a `PLATFORM_DELIVERY` order it locks the latest assignment and refuses unless it is `AT_VENDOR`, with a code of its own — `PARTNER_NOT_PRESENT`, *"Hand this order over when the delivery partner is at your counter."* A pickup or vendor-delivery order has no partner to wait for and is unaffected.

The console no longer renders the handover control on a platform delivery until the partner is at the counter; it says where the partner is instead. The record now says who took the goods — `PARTNER_PICKUP_COMPLETED` on the order event and the aggregate transition — where it used to say a customer collected every delivery.

## B08-03 — one code per refusal, and every declared code registered

| Refusal | Was | Now |
|---|---|---|
| No code issued | `ORDER_STATE_CONFLICT` | `PICKUP_OTP_MISSING` (409) — *ask the person collecting to open theirs* |
| Wrong code | `ORDER_STATE_CONFLICT` | `PICKUP_OTP_MISMATCH` (400) — *check it and try again* |
| Expired / exhausted | `ORDER_STATE_CONFLICT` | `PICKUP_OTP_EXPIRED` / `PICKUP_OTP_EXHAUSTED` (409) |
| Collector already holds a code | declared `CUSTOMER_OTP_ACTIVE`, **discarded** | registered |
| Delivery code wrong / expired / exhausted | declared `DELIVERY_OTP_*`, **discarded** | registered |
| Partner not at counter | (new) | `PARTNER_NOT_PRESENT` (409) |

Migration 0076 registers the nine locale keys, en + hi (Hindi flagged for native review with 0064–0074). `pwa-auth` carries the wording.

`verify-error-contract.mjs` now reads `ERROR_DEFINITIONS` from source and fails any literal `error_code: 'X'` that is not a key. **Mutation-proven:** unregistering `CUSTOMER_OTP_ACTIVE` turns the control red at `vendor-fulfilment.controller.ts:77`. A code read from `error.code` cannot be checked this way and is left to the domain type.

## B08-04 — the ladder now walks the handover it describes

`verify-vendor-fulfilment.ts` restructured. The delivery leg begins before the handover rather than after it, because the handover is part of it. The customer-code assertions that used to run on the delivered order now run on a second order the customer actually collects (`CUSTOMER_PICKUP`, via `setGroupFulfilmentMethod`). The board-view fixture that inserted a fake `AT_VENDOR` assignment onto an already-picked-up order is gone; the assertion runs on the real assignment while the real partner is at the counter. Scenario count 47 → 60.

| On the delivered order | Asserted |
|---|---|
| Customer | Cannot mint a collection code for an order a partner delivers |
| No partner yet | Handover **and** fallback refused as `PARTNER_NOT_PRESENT` — asserted on the code, not the class |
| Assigned, on the road | Partner cannot mint; handover still `PARTNER_NOT_PRESENT` |
| At the counter | A known stranger partner cannot mint on this assignment; handover with no code is `PickupOtpMissingError` |
| Code issued | Stored as `PARTNER`, hashed, attributed to `delivery_partner` on the order record |
| Canonical | Vendor fallback cannot displace the partner's live code |
| Wrong code | Counted, refused as a mismatch |
| Handover | `PICKED_UP`; recorded as `PARTNER_PICKUP_COMPLETED` on event and transition |
| Board | Says the partner delivers it, that they are at the counter and waiting at threshold two |

| On the collected order | Asserted |
|---|---|
| Board and history | Say the customer collects it; the two-store group says both are delivered |
| Customer's code | Canonical; fallback refused while it is live; survives the attempt |
| Fallback | Refused without a valid reason; issued and recorded with its reason once the code is gone |
| Handover | `PICKED_UP`; recorded as `CUSTOMER_PICKUP_COMPLETED` |

**Mutation-proven**, each restored byte-identical:

| Probe | Caught by |
|---|---|
| `requireCollectorPresent` dropped from handover validation | *Handover with no partner was not refused as PARTNER_NOT_PRESENT (got … No pickup OTP has been issued)* |
| `AT_VENDOR` check dropped from the partner issuer | *A partner minted a pickup code before arriving at the store* |
| `partner_user_id` filter dropped from the partner issuer | *A stranger minted a pickup code on another partner's assignment* |
| `CUSTOMER_PICKUP` check dropped from the customer issuer | *A customer minted a collection code for an order a partner is delivering* |
| Fallback displacement check narrowed back to `CUSTOMER` | *A vendor fallback code displaced the partner's live pickup code* |
| Handover reason fixed to `CUSTOMER_PICKUP_COMPLETED` | *A partner handover was recorded as CUSTOMER_PICKUP_COMPLETED / …* |

The ownership probe was redone once. Its first run failed on the intended assertion but for the wrong reason: the stranger was an unknown id, and the event's foreign key refused it before the ownership filter was reached. A stranger who *is* a known user would have been served. The fixture now inserts a real user, and the probe fails on the filter.

## Verification

| Check | Result |
|---|---|
| `pnpm db:verify` | exit 0 — 76 migrations, 28 modules, `vendor_fulfilment_scenarios` 47 → 60 |
| Migrations 0075, 0076 down → up | Reverted and re-applied cleanly against the test target |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` | exit 0 |
| `pnpm test:unit` | 469 pass / 0 fail (+1: the partner handover route's authorization) |

## Still open

- **Browser and device runs.** The vendor console, partner PWA and partner Android screens changed and were not driven. The Android screen in particular has no test infrastructure; its claim stays `unverified`.
- **Vendor self-delivery has no handover at all.** A customer can choose `VENDOR_DELIVERY` at checkout; the vendor console has no dispatch or delivery step for it and now says so instead of offering a customer code. The domain still accepts a vendor fallback on such an order. Workflow 6.7's self-delivery branch is unimplemented.
- **The chosen fulfilment method is not validated against the store's enabled modes.** Neither the cart nor the quote checks `vendor_location_fulfilment_modes` (CUS-33 says *"where the vendor and zone support them"*). Found while building the collected-order fixture; not fixed here.
- **`confirmPickup` still takes `vendor_confirmed` from the partner.** The vendor's handover is now the real gate, so the flag is redundant rather than dangerous; it should go.
- **QR** is not built; the code is typed.
- **Hindi copy** in 0076 needs a native speaker, with the rest.
