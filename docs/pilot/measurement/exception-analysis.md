# Synthetic Exception Analysis

**Source:** Step 1.3 scripted desk runs
**Scope:** Control coverage and financial representation only
**Cases:** Four explicit case records plus two non-case operational branches

## Exception register

| Run/case | Category | Stage | Customer effect | Vendor effect | Partner/custody effect | Platform/finance effect | Control result | Future owner |
|---|---|---|---|---|---|---|---|---|
| `RUN-T-02` / no case | Variable weight/price | Picking | Revised total shown and explicitly approved | Final snapshot preserved | Normal delivery | Revised allocation balanced | `PASS_SYNTHETIC` | Vendor Operations |
| `RUN-T-03` / `CASE-T-R03A7K` | Item unavailable | Before pickup | Full `16500` refund | No proceeds/fee | `200` wait pay; no custody | Platform funds `200` | `PASS_SYNTHETIC` | Support + Finance |
| `RUN-T-05` / `CASE-T-R05K8M` | Customer unreachable | After pickup | Full `34900` refund | No proceeds/fee | Return closes custody; `7800` pay | Platform funds `7800` | `PASS_SYNTHETIC` | Operations + Support + Finance |
| `RUN-T-06` / `CASE-T-R06P4W` | Partial item refund | After delivery | `6000` refunded | `23500` proceeds after fee | Completed pay/tip retained | `500` contribution retained | `PASS_SYNTHETIC` | Support + Finance |
| `RUN-T-07` / `CASE-T-R07N6X` | Payment initially unknown | Before fulfilment | Order held until match | No action until resolved | No dispatch until resolved | Same `PAY` ref reconciled; no duplicate | `PASS_SYNTHETIC` | Finance |
| `RUN-T-08` / no case | Sibling cancellation | Before pickup | `11500` affected-order refund; sibling continues | Cancelled vendor zero; sibling `19500` | Trip only for surviving order | Allocation/refund isolated | `PASS_SYNTHETIC` | Operations + Finance |

## Coverage by control family

| Control family | Covered branch | Missing evidence |
|---|---|---|
| Customer decision | Approve changed weight/price | Human comprehension, refusal friction, response time |
| Vendor availability | Unavailable before pickup | Actual stock accuracy and vendor response behaviour |
| Custody/return | Failure after pickup and safe return | Human safety, package condition, real elapsed time |
| Refund | Full and partial component refunds | Real provider timing, dispute, callback, statement failure |
| Payment reconciliation | Unknown then matched under same reference | Real sandbox/provider reliability and manual finance effort |
| Multi-vendor isolation | One sibling cancelled, one completed | Human communication and grouped-customer experience |

## Synthetic financial exposure

| Exposure class | Amount paise | Meaning |
|---|---:|---|
| Customer refunds | `68900` | Total scripted successful refunds |
| Protected wait/return pay funded by platform | `8000` | `200` wait plus `7800` controlled return |
| Completed-order platform fees | `3000` | Six completed orders × `500` |
| Net platform contribution | `-5000` | Fees less protected exception funding before all real costs |

## Priority observations

1. Post-pickup failure is the largest scripted exposure and requires custody, support, return, and finance to remain coordinated.
2. Payment uncertainty must block fulfilment until the original operation is reconciled; a new payment reference would create duplicate risk.
3. Multi-vendor isolation protects the surviving order and makes group-level rates easy to misstate unless request and vendor-order denominators remain separate.
4. Partial refunds require component-level allocation; order-level subtraction alone would misstate vendor proceeds or partner earnings.
5. Scripted cases demonstrate control shape but cannot estimate support staffing or incident frequency.

## Required future evidence

- Trained-operator acknowledgement and resolution times by severity.
- Actual handoff count and active handling seconds per case.
- Realistic sandbox provider timeout, callback, statement, duplicate, and reconciliation drills.
- Controlled custody/return exercise with safety observer and package-count evidence.
- Customer comprehension of revised totals and grouped-order outcomes.
- Vendor effort, spoilage, and incremental-cost evidence.

No exception frequency, severity distribution, or staffing conclusion may be inferred from this intentionally failure-heavy scenario set.
