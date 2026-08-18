# Safe Aggregate Desk-Run Evidence

**Evidence type:** Synthetic state and handoff summary
**Excluded:** Completed forms, personal assignments, exact addresses, contacts, OTP content, raw location, payment instruments, and real timestamps

## State and handoff results

| Run | Intake | Vendor result | Fulfilment/custody | Proof/case result | Finance result | External side effect | Outcome |
|---|---|---|---|---|---|---|---|
| `RUN-T-01` | Final `34900` confirmed | `FV-01` accepted both lines | One trip; pickup then delivered | Fake proof matched active order/trip; custody `DELIVERED` | Settlement balanced | `NONE` | `PASS_DESK_SIMULATION` |
| `RUN-T-02` | Original `22300`, revised `24300` shown | `FV-03` recorded final weight and `2000` increase | One trip; delivered | Explicit customer approval preceded continuation | Revised settlement balanced | `NONE` | `PASS_DESK_SIMULATION` |
| `RUN-T-03` | Final `16500` confirmed | `FV-02` marked item unavailable | Trip arrived; no pickup; custody `NONE` | Case recorded 7 completed wait minutes | Full refund; `200` wait earning; platform `-200` | `NONE` | `PASS_DESK_SIMULATION` |
| `RUN-T-04` | Final `12500` confirmed | `FV-07` accepted and prepared | Customer pickup; no delivery trip | Fake pickup proof matched order; custody closed | Settlement balanced without partner amount | `NONE` | `PASS_DESK_SIMULATION` |
| `RUN-T-05` | Final `34900` confirmed | `FV-01` accepted and prepared | Pickup, unreachable, authorized return, returned | Case and return proof closed custody | Full refund; protected outbound/return earning | `NONE` | `PASS_DESK_SIMULATION` |
| `RUN-T-06` | Final `34900` confirmed | `FV-01` accepted and prepared | Delivered successfully | Delivery proof retained; refund linked to affected item | `6000` partial refund; fee/earning retained; balanced | `NONE` | `PASS_DESK_SIMULATION` |
| `RUN-T-07` | Final `24300` shown | Held until payment reconciliation | Dispatch began only after fake statement match | Finance case closed against same payment ref | Unknown became matched success once; settlement balanced | `NONE` | `PASS_DESK_SIMULATION` |
| `RUN-T-08` | Combined `33800` confirmed and allocated | `FV-04` cancelled; `FV-05` accepted | Only second order received an active trip and proof | First refund isolated; second custody delivered | `11500` refund; surviving order balanced | `NONE` | `PASS_DESK_SIMULATION` |

## Required Step 1.3 observations

| Requirement | Evidence |
|---|---|
| Customer chooses named store and products | Every run names fictional customer, vendor, and product IDs; `RUN-T-08` explicitly names both vendor groups |
| Complete charges shown before confirmation | Each scenario records its final visible amount; `RUN-T-02` records both original and revised totals |
| Vendor confirms stock/preparation/changes | Vendor outcomes are recorded per order; change, unavailability, and timeout/unknown gates are explicit |
| Dispatcher assigns partner or pickup | Delivery runs have one active trip; `RUN-T-04` uses customer pickup; cancelled sibling in `RUN-T-08` gets no trip |
| Manual proof and case reference | Proof metadata excludes OTP content; exception runs include safe case references |
| Reconcile all money and exceptions | All terminal financial rows balance; the unknown payment pauses under one reference until matched |

## Failure-control observations

- A vendor change does not continue before the fictional customer decision.
- Pre-pickup cancellation does not create custody or a delivery earning.
- Failure after pickup follows return states and preserves outbound/return earnings.
- A successful delivery followed by partial refund keeps delivery earning, tip, and the synthetic vendor fee.
- An unknown fake-provider result is not retried under a new payment reference.
- One cancelled vendor order in a grouped request does not cancel or mutate its sibling.
- Every proof is metadata tied to the active reference; no OTP value appears.
- All external-side-effect checks are `NONE` by construction; this has not tested real adapter isolation.

## Evidence limitation

The outcomes above were derived by document walkthrough and deterministic calculations. No person performed timed handoffs, no fake adapter process was executed, and no observed operational metric was collected. Therefore these records must not be used as conversion, acceptance-time, preparation-time, delivery-time, support-load, repeat-order, or satisfaction data in Step 1.4.
