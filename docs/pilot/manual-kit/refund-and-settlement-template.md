# Synthetic Refund and Settlement Template

**Used by:** Finance Test Operator; reviewed by Reconciliation Reviewer; protected actions use the approved separate approver  
**Use when:** Recording a fake refund, calculating one vendor order's settlement, applying a hold, or reconciling an unknown result  
**Protected data:** Fake payment/payout references, allocations, case evidence, and masked fictional beneficiary tokens  
**Next handoff:** Reconciled records go to end-of-day review; mismatches go to a finance case owned by Support and Finance

## Refund proposal

| Field | Entry |
|---|---|
| Session/request/order refs | `<TEST-... / REQ-T-... / ORD-T-...>` |
| Payment/refund refs | `<PAY-T-... / REF-T-...>` |
| Trigger | `<PRE_PICKUP_CANCEL / CONTROLLED_RETURN / PARTIAL_ITEM_REFUND / FULL_ITEM_REFUND / PROVIDER_EXCEPTION>` |
| Affected line/component refs | `<specific references>` |
| Original captured minor | `<integer INR>` |
| Item refund minor | `<integer>` |
| Tax refund minor | `<integer>` |
| Delivery refund minor | `<integer>` |
| Tip refund minor | `<integer>` |
| Discount reversal minor | `<integer>` |
| Total refund minor | `<integer>` |
| Impact preview | `<customer/vendor/partner/platform resulting amounts>` |
| Linked custody/proof/case | `<references or NONE>` |
| Proposed by/at | `<Finance role token / timestamp>` |

## Approval and execution

| Amount/impact | Approval rule | Approval ref | Approver role/time | Preview still current | Simulator result | Executed at |
|---|---|---|---|---|---|---|
| `₹0–₹500` synthetic refund/adjustment | Authorized Support Lead may execute after preview | `<APR ref or recorded authority>` | `<different role if proposer is Support Lead>` | `<PASS / STALE>` | `<SUCCESS / DECLINE / TIMEOUT / UNKNOWN / DUPLICATE>` | `<timestamp or NOT_EXECUTED>` |
| `>₹500` or another protected action | Separate Finance approver required; proposer cannot self-approve | `<APR-T-...>` | `<Finance approver/timestamp>` | `<PASS / STALE>` | `<result>` | `<timestamp or NOT_EXECUTED>` |

Reject expired, reused, self-approved, or stale approvals. Timeout/unknown remains unresolved under the same operation reference until reconciliation; do not submit a new operation to force success.

## Settlement record

Create one settlement per vendor order.

| Field | Amount minor or value |
|---|---|
| Settlement reference | `<SET-T-...>` |
| Order/payment/refund/trip refs | `<references>` |
| Currency | `INR` |
| Customer captured amount | `<integer>` |
| Less successful customer refunds | `<integer>` |
| Customer net amount | `<integer>` |
| Vendor item proceeds after item refunds | `<integer>` |
| Less vendor platform fee | `<0 or 500 under synthetic policy>` |
| Vendor payable | `<integer>` |
| Partner outbound earning | `<integer>` |
| Partner wait earning | `<integer>` |
| Partner return earning | `<integer>` |
| Partner tip | `<integer>` |
| Partner adjustment | `<signed integer with approval/case>` |
| Partner payable | `<integer>` |
| Platform remainder/adjustment | `<signed integer>` |
| Hold amount/reason/case | `<integer / code / reference>` |
| Eligible at | `<completion + 24 test hours when no affected hold>` |
| Fake payout batch | `<18:00 Asia/Kolkata batch ref or NOT_ELIGIBLE>` |

## Balance checks

All calculations use integer paise. Never add an unexplained adjustment to make a mismatch disappear.

```text
customer_net_minor = customer_captured_minor - successful_refunds_minor

customer_net_minor = vendor_payable_minor
                   + partner_payable_minor
                   + platform_remainder_minor
```

For a completed order with at least one completed item, the synthetic vendor fee is ₹5 (`500` minor). Decline, timeout, cancellation, platform failure, or full item refund uses zero. Completed delivery keeps applicable partner earnings; a valid tip goes 100% to the partner.

## Fake payout/reconciliation

| Beneficiary type | Masked fictional token | Payable minor | Hold minor | Submitted ref/state | Statement ref/state | Match result | Next action |
|---|---|---:|---:|---|---|---|---|
| `<VENDOR / PARTNER>` | `<FAKE-...LAST4>` | `<integer>` | `<integer>` | `<ref / state>` | `<ref / state>` | `<MATCH / MISSING / CONFLICT / UNKNOWN>` | `<close / CASE-T-...>` |

Match operation reference, amount, currency, and masked account token. Preserve the original unknown/failed state and evidence. Corrections are linked reversals or adjustments, never edits to balanced history.

## Sign-off and handoff

| Settlement ref | Prepared by/at | Reviewed by/at | Balance | Open holds/cases | Sent to EOD at | Accepted by |
|---|---|---|---|---|---|---|
| `<SET-T-...>` | `<role/time>` | `<different role/time>` | `<PASS / FAIL>` | `<NONE or refs>` | `<timestamp>` | `Reconciliation Reviewer` |
