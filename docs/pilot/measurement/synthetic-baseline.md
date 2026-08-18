# Synthetic Desk Baseline

**Source:** Eight `DESK_SIMULATION_ONLY` runs and nine vendor-order reconciliation rows
**Evidence labels:** `SYNTHETIC_COVERAGE` and `SYNTHETIC_CALCULATION`
**Not valid for:** Market demand, real operations, production economics, or staffing

## Counts and outcome rates

| Measure | Numerator | Denominator | Result | Interpretation |
|---|---:|---:|---:|---|
| Customer requests modelled | `8` | — | `8` | Scenario count only |
| Vendor orders modelled | `9` | — | `9` | One grouped request created two isolated orders |
| Complete-price path exercised | `8` | `8` requests | `100.00%` | Coverage, not fee-visible conversion |
| Completed vendor orders | `6` | `9` orders | `66.67%` | Scripted outcome mix |
| Pre-pickup cancelled orders | `2` | `9` orders | `22.22%` | Scripted cancellation coverage |
| Controlled returns | `1` | `9` orders | `11.11%` | Scripted post-custody failure coverage |
| Orders with any refund | `4` | `9` orders | `44.44%` | Three full and one partial scripted refund |
| Orders with full refund | `3` | `9` orders | `33.33%` | Scripted outcome mix |
| Orders with partial refund | `1` | `9` orders | `11.11%` | Scripted outcome mix |
| Cases modelled | `4` | `9` orders | `44.44 per 100 orders` | Coverage, not staffing forecast |
| Cases per request | `4` | `8` requests | `50.00 per 100 requests` | Coverage, not observed support load |
| Initially unknown payments | `1` | `8` payment attempts | `12.50%` | Scripted provider branch, not reliability |
| Financial rows with zero difference | `9` | `9` rows | `100.00%` | Valid calculation integrity result |

## Synthetic money baseline

| Measure | Total paise | Display-only INR | Denominator | Per-denominator result |
|---|---:|---:|---|---:|
| Customer captured | `216100` | `₹2,161.00` | 9 vendor orders | `24011.11` paise/order |
| Successful refunds | `68900` | `₹689.00` | Captured amount | `31.88%` refund-value ratio |
| Customer net | `147200` | `₹1,472.00` | 6 completed orders | `24533.33` paise/completed order |
| Vendor proceeds | `127500` | `₹1,275.00` | 6 completed orders | `21250.00` paise/completed order |
| Partner pay | `24700` | `₹247.00` | 9 vendor orders | `2744.44` paise/order |
| Partner pay on positive-pay rows | `24700` | `₹247.00` | 7 positive-pay rows | `3528.57` paise/positive-pay row |
| Platform contribution | `-5000` | `-₹50.00` | 9 vendor orders | `-555.56` paise/order |
| Reconciliation difference | `0` | `₹0.00` | 9 rows | `0` |

The negative platform contribution results from a `200`-paise wait obligation and `7800`-paise controlled-return obligation, partly offset by six completed-order platform fees totalling `3000` paise. It excludes real operating costs and therefore is not a production margin.

## Metrics not observed

| Required Step 1.4 metric | Current value | Why unavailable | Evidence needed |
|---|---|---|---|
| Fee-visible conversion | `NOT_OBSERVED` | Every desk persona was scripted to continue | Eligible real/controlled requests that may confirm or abandon |
| Vendor response time | `NOT_OBSERVED` | No operator timing | Ordered placed/decision timestamps from trained sessions |
| Preparation time | `NOT_OBSERVED` | No vendor work occurred | Accepted/ready timestamps with pause handling |
| Pickup delay | `NOT_OBSERVED` | No dispatcher/partner handoff occurred | Ready/arrival/pickup timestamps |
| Delivery time | `NOT_OBSERVED` | No delivery occurred | Pickup/delivery timestamps |
| On-time delivery | `NOT_OBSERVED` | No real promise or elapsed time | Versioned promise and completion timestamps |
| Support effort/load | `NOT_OBSERVED` | Cases were scripted and consumed no staffed effort | Case handling seconds, handoffs, severity, owner |
| Partner earnings per active hour | `NOT_OBSERVED` | No active person/time | Eligible active seconds and reconciled partner pay |
| Vendor incremental profit | `NOT_OBSERVED` | No costs or incremental sale | Vendor cost, labour, spoilage, baseline, proceeds |
| Repeat-order rate | `NOT_OBSERVED` | Personas are not customers | Privacy-approved longitudinal customer evidence |

## Data-quality result

- All nine money rows reconcile with zero unexplained difference.
- The grouped request preserves two vendor-order denominators.
- Cancellation and return are kept separate.
- Missing times remain `NOT_OBSERVED`, not zero.
- Scripted outcomes are labelled and excluded from behavioural claims.

This baseline is reproducible from the Step 1.3 reconciliation table. It cannot satisfy the Phase 1 exit gate requiring real transactions and measured operational feasibility.
