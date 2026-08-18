# Synthetic Desk-Run Reconciliation Summary

**Currency:** `INR`
**Amount representation:** Integer paise
**Tax in these runs:** `0` synthetic fixture value
**Authority:** Internal calculation test only; no real money

## Per-order reconciliation

The required equation is:

```text
customer_net_minor = captured_minor - refunded_minor
customer_net_minor = vendor_payable_minor
                   + partner_payable_minor
                   + platform_remainder_minor
difference_minor   = 0
```

| Run/order | Captured | Refunded | Customer net | Vendor payable | Partner payable | Platform remainder | Difference | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `RUN-T-01 / ORD-T-R01P8M` | `34900` | `0` | `34900` | `29500` | `4900` | `500` | `0` | `BALANCED` |
| `RUN-T-02 / ORD-T-R02D5K` | `24300` | `0` | `24300` | `21500` | `2300` | `500` | `0` | `BALANCED` |
| `RUN-T-03 / ORD-T-R03K8D` | `16500` | `16500` | `0` | `0` | `200` | `-200` | `0` | `BALANCED` |
| `RUN-T-04 / ORD-T-R04V7Q` | `12500` | `0` | `12500` | `12000` | `0` | `500` | `0` | `BALANCED` |
| `RUN-T-05 / ORD-T-R05P7X` | `34900` | `34900` | `0` | `0` | `7800` | `-7800` | `0` | `BALANCED` |
| `RUN-T-06 / ORD-T-R06K2W` | `34900` | `6000` | `28900` | `23500` | `4900` | `500` | `0` | `BALANCED` |
| `RUN-T-07 / ORD-T-R07Q4C` | `24300` | `0` | `24300` | `21500` | `2300` | `500` | `0` | `BALANCED_AFTER_FAKE_MATCH` |
| `RUN-T-08 / ORD-T-R08H2K` | `11500` | `11500` | `0` | `0` | `0` | `0` | `0` | `BALANCED_CANCELLED` |
| `RUN-T-08 / ORD-T-R08N7Q` | `22300` | `0` | `22300` | `19500` | `2300` | `500` | `0` | `BALANCED_COMPLETED` |

## Group and overall checks

| Check | Calculation | Result |
|---|---|---|
| `RUN-T-08` allocation | `11500 + 22300 = 33800` captured | `PASS` |
| `RUN-T-08` post-refund net | `33800 - 11500 = 22300` | `PASS` |
| All rows captured | `216100` | Informational synthetic total |
| All rows refunded | `68900` | Informational synthetic total |
| All rows customer net | `147200` | Matches captured less refunds |
| All rows vendor payable | `127500` | Included in balanced allocation |
| All rows partner payable | `24700` | Includes protected wait/return earnings |
| All rows platform remainder | `-5000` | Includes synthetic cancellation/return funding |
| Allocation total | `127500 + 24700 - 5000 = 147200` | `PASS` |
| Sum of differences | `0` | `PASS` |

Negative platform remainder in cancellation/return scenarios is intentional synthetic funding of protected partner earnings; it is not hidden or reassigned to the customer/vendor.

## Exception register

| Case | Run | Exception | Affected amount | Resolution | Residual hold |
|---|---|---|---:|---|---|
| `CASE-T-R03A7K` | `RUN-T-03` | Item unavailable after trusted arrival | `16700` gross exposure including wait obligation | Customer refund plus `200` partner wait earning funded by platform | `0` |
| `CASE-T-R05K8M` | `RUN-T-05` | Customer unreachable after pickup | `42700` gross exposure including protected partner earnings | Return proof, full customer refund, `7800` partner payable | `0` |
| `CASE-T-R06P4W` | `RUN-T-06` | Partial item refund | `6000` | Component refund; completed delivery economics preserved | `0` |
| `CASE-T-R07N6X` | `RUN-T-07` | Fake payment result initially unknown | `24300` | Same payment ref matched to fictional statement before fulfilment | `0` |

## Payout eligibility

Vendor and partner payables become eligible only after 24 test hours without an affected open hold and enter the next fake 18:00 `Asia/Kolkata` batch. This desk run checks the rule but does not execute a payout adapter or create a payout claim.

## Conclusion

All nine vendor-order rows across eight desk scenarios reconcile with zero unexplained difference. The manual financial policy can represent completion, pre-pickup cancellation, pickup, controlled return, partial refund, unknown payment resolution, and grouped sibling isolation. Operational timing and human error remain untested.
