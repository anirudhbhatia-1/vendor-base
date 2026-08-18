# Incident and End-of-Day Reconciliation Checklists

**Used by:** Support Test Operator, Finance Test Operator, Reconciliation Reviewer, and Operations Lead  
**Use when:** An exception occurs, at staffed-hours handoff, and before closing every test session  
**Protected data:** Minimum synthetic case evidence and safe record references; never OTP content, raw payment/bank data, or unnecessary exact address/location  
**Next handoff:** Open cases go to a named role and deadline; a balanced closed session goes to the Operations Lead for sign-off

## Incident case template

| Field | Entry |
|---|---|
| Case reference | `<CASE-T-...>` |
| Session and affected refs | `<TEST / REQ / ORD / TRIP / PAY / REF / SET>` |
| Severity | `<P0 / P1 / P2 / P3>` |
| Structured category/reason | `<approved code>` |
| Detected at/by | `<timestamp / role>` |
| Safe description | `<no sensitive values>` |
| Active custody | `<YES / NO; state>` |
| Amount at risk minor | `<integer INR or 0>` |
| Protected-data risk | `<NONE / SUSPECTED / CONFIRMED_SYNTHETIC_TEST>` |
| Immediate scoped control | `<pause exact order/vendor/zone/provider/payout or NONE>` |
| Control owner/start/review/rollback | `<role / timestamps / action>` |
| Acknowledged at/by | `<timestamp / role>` |
| Evidence references | `<access-limited safe refs>` |
| Resolution owner/deadline | `<role / timestamp>` |
| Resolution and reconciliation | `<safe summary / refs>` |
| Safe-resumption check | `<PASS / NOT_READY>` |
| Closed/reopened at | `<timestamp or OPEN>` |

## Severity targets

| Severity | Internal test example | Acknowledgement target |
|---|---|---|
| P0 | Immediate safety threat, major data exposure, widespread financial-integrity failure | Immediate escalation; within 5 minutes |
| P1 | Active custody failure, missing tester, serious payment mismatch, unsafe interaction | Within 15 minutes |
| P2 | One stuck order, overdue fake refund, degraded workflow with workaround | Within 4 staffed hours |
| P3 | Routine question or correction | By next staffed day |

### Incident actions

- [ ] Stop the affected work without erasing accepted obligations or history.
- [ ] Confirm severity, exact scope, owner, acknowledgement deadline, and active custody/amount at risk.
- [ ] Apply only a reversible, time-limited control with impact preview and rollback.
- [ ] Keep unrelated vendors, sibling orders, zones, and providers operating unless evidence requires broader scope and separate approval.
- [ ] Limit evidence access and do not copy sensitive content into notes.
- [ ] Reconcile order, custody, payment, refund, earning, settlement, and payout state before closure.
- [ ] Confirm the recovery queue and named owner for every unresolved obligation.
- [ ] Do not permanently restrict an actor from one signal; require review and an appeal path.
- [ ] Record safe-resumption checks before removing a control.

## Staffed-hours handoff

At 19:00 `Asia/Kolkata`, safety, custody, privacy, payment, refund, or payout work cannot be left ownerless.

| Case/ref | Current state | Risk/custody/amount | Outgoing owner | Receiving owner | Next action/deadline | Accepted at |
|---|---|---|---|---|---|---|
| `<reference>` | `<state>` | `<safe summary>` | `<role>` | `<role>` | `<action/time>` | `<timestamp>` |

## End-of-day reconciliation

### Reference completeness

- [ ] Every customer request has a unique `REQ-T-...` reference.
- [ ] Every vendor group has one unique `ORD-T-...`; no order spans vendors.
- [ ] Every delivery attempt has a `TRIP-T-...`, including closed reassignment attempts.
- [ ] Every fake payment/refund has one stable `PAY-T-...`/`REF-T-...` operation reference.
- [ ] Every exception has a `CASE-T-...` or documented no-case reason.
- [ ] Every vendor order has one `SET-T-...` settlement record or a named blocking case.
- [ ] Voided references remain in the reservation log and were not reused.

### Operational closure

- [ ] Every order is completed, cancelled/expired before custody, or linked to controlled return/case handling.
- [ ] Every package has matching pickup and final delivery/return/transfer custody evidence.
- [ ] Proof records contain outcomes and safe evidence references, not OTP content.
- [ ] Duplicate, timeout, stale, retry, offline/reconnect, and unknown results retain one explainable outcome.
- [ ] Every open P0/P1 or custody case has a named owner and immediate next action.
- [ ] No new order began too late to finish safely inside the test window.

### Financial reconciliation table

| Order ref | Captured minor | Refunded minor | Customer net minor | Vendor payable minor | Partner payable minor | Platform remainder minor | Difference minor | Hold/case |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `<ORD-T-...>` | `<integer>` | `<integer>` | `<integer>` | `<integer>` | `<integer>` | `<integer>` | `<must be 0>` | `<NONE or ref>` |

- [ ] Each row satisfies `captured - refunds = customer net`.
- [ ] Each row satisfies `customer net = vendor payable + partner payable + platform remainder`.
- [ ] Combined payment allocation equals the sum of its vendor-order allocations.
- [ ] Vendor fee is `500` minor only when the approved synthetic completed-order rule applies.
- [ ] Tips are allocated 100% to the partner under the approved outcome.
- [ ] Unknown fake-provider results remain unresolved; no second operation was invented.
- [ ] Mismatches open a finance case; no unexplained balancing entry was added.
- [ ] Eligible fake payables respect the 24-test-hour delay, affected holds, and 18:00 batch rule.

### Privacy and external-side-effect closure

- [ ] No real person, shop, address, phone, bank, credential, OTP, location, or payment instrument was recorded.
- [ ] No real email, SMS, push, map request, payment, payout, upload, or delivery occurred.
- [ ] Exact synthetic destination access ended when delivery/return closed.
- [ ] Completed forms are in the approved protected workspace, not Git or a public link.
- [ ] Retention class/next deletion date and any explicit hold are recorded.

## Session sign-off

| Field | Entry |
|---|---|
| Session reference/date | `<TEST-... / YYYY-MM-DD>` |
| Orders by terminal state | `<counts>` |
| Trips by terminal state | `<counts>` |
| Captured/refunded/net totals minor | `<integers INR>` |
| Vendor/partner/platform totals minor | `<integers INR>` |
| Difference minor | `<must be 0>` |
| Open cases by severity | `<counts and refs>` |
| Named handoff owners | `<roles or NONE>` |
| External-side-effect check | `<PASS / STOPPED>` |
| Reconciliation reviewer/time | `<role / timestamp>` |
| Operations Lead decision/time | `<CLOSED / CLOSED_WITH_HANDOFF / STOPPED / timestamp>` |

`CLOSED` requires zero unexplained difference, closed custody, no unowned case, and a negative external-side-effect check. `CLOSED_WITH_HANDOFF` is allowed only for explicitly owned synthetic follow-up with no unsafe custody ambiguity. `STOPPED` preserves safe evidence and triggers the applicable incident path.
