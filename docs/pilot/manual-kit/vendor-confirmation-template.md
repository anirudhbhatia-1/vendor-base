# Vendor Confirmation Template

**Used by:** Vendor Confirmation Operator assigned to one synthetic vendor  
**Use when:** A vendor order reaches `PLACED` after a successful fake authorization  
**Protected data:** One vendor order's synthetic lines, preferences, fulfilment method, and minimum delivery instructions  
**Next handoff:** Accepted orders go to Dispatcher or pickup coordination; declines/timeouts and customer decisions go to Support Test Operator and Finance Test Operator

## Order receipt

| Field | Entry |
|---|---|
| Session/request/order refs | `<TEST-... / REQ-T-... / ORD-T-...>` |
| Synthetic vendor ID | `<FV-01 through FV-09>` |
| Catalogue version | `<ID/version>` |
| Received at | `<ISO 8601 +05:30>` |
| Response due at | `<received + 5 minutes>` |
| Fulfilment method/window | `<DELIVERY or CUSTOMER_PICKUP / window>` |
| Line/package count | `<integer / integer>` |
| Customer preference summary | `<structured values only>` |
| Assigned operator | `<role token>` |
| Duplicate/stale check | `<PASS / FAIL>` |

The operator sees only this vendor order. A request or checkout containing another vendor does not grant access to that sibling's lines or state.

## Line confirmation

| Line no. | Product ID | Requested | Result | Confirmed quantity | Final weight grams | Final line amount minor | Proposed substitute ID | Difference minor | Customer decision required |
|---:|---|---:|---|---:|---:|---:|---|---:|---|
| `<1...>` | `<PROD-FV-...>` | `<quantity>` | `<CONFIRMED / UNAVAILABLE / CHANGE_PROPOSED>` | `<integer>` | `<integer or N/A>` | `<integer>` | `<product or NONE>` | `<signed integer>` | `<YES / NO>` |

Default substitution is `NONE`. A replacement or material weight/price change must follow the recorded preference or an explicit synthetic customer decision. Preserve the original quote and record the final snapshot separately.

## Decision

| Field | Entry |
|---|---|
| Decision | `<ACCEPT / DECLINE / AWAIT_CUSTOMER / EXPIRE>` |
| Reason code | `<approved structured code>` |
| Safe reason text | `<required for OTHER; no sensitive data>` |
| Decision at | `<timestamp>` |
| Operator role token | `<token>` |
| Resulting state | `<ACCEPTED / AWAITING_CUSTOMER_DECISION / CANCELLED / EXPIRED>` |
| Final item subtotal minor | `<integer or unchanged>` |
| Customer response due | `<timestamp or N/A>` |
| Linked support case | `<CASE-T-... or NONE>` |

Allowed decline examples include `ITEM_AVAILABILITY_LOW`, `STORE_TOO_BUSY`, `CLOSING_SOON`, `CANNOT_MEET_SLOT`, `CATALOGUE_PRICE_ERROR`, `CUSTOMER_REQUEST_UNFULFILLABLE`, `SAFETY_COMPLIANCE`, and `OTHER` with safe text.

## Customer-decision branch

| Proposal sent at | Proposed change | Original total minor | Revised visible total minor | Customer result | Result time | Resulting line/order state |
|---|---|---:|---:|---|---|---|
| `<timestamp>` | `<structured change>` | `<integer>` | `<integer>` | `<APPROVE / REJECT / TIMEOUT>` | `<timestamp>` | `<state>` |

Only the changed vendor order is affected. Rejection/timeout applies its recorded fallback or removes/cancels that order according to the test scenario; it never changes a sibling order.

## Preparation and readiness

| Picking started | Picking completed | Package count | Package labels | Ready at | Readiness result | Exception case |
|---|---|---:|---|---|---|---|
| `<timestamp>` | `<timestamp>` | `<integer>` | `<PKG-1...; no customer data>` | `<timestamp>` | `<READY / FAILED>` | `<NONE or CASE-T-...>` |

## Failure rules

- Duplicate receipt returns the original recorded result; do not decide twice.
- A response after the deadline is stale and requires Support review; do not silently revive the order.
- Decline, timeout, or cancellation before pickup releases that order's synthetic stock intent and triggers the applicable fake refund.
- Once pickup starts custody, do not cancel normally; use the controlled return flow.
- Never overwrite the quoted line, previous decision, reason, operator, or timestamp.

## Handoff

| Order ref | From role | To role | State | Package count | Money change/case | Sent at | Accepted at |
|---|---|---|---|---:|---|---|---|
| `<ORD-T-...>` | `Vendor Confirmation Operator` | `<Dispatcher / Pickup Coordinator / Support / Finance>` | `<state>` | `<integer>` | `<reference or NONE>` | `<timestamp>` | `<timestamp>` |
