# Dispatch, Custody, and Proof Template

**Used by:** Dispatcher and assigned Delivery Tester; Support Test Operator handles exceptions  
**Use when:** One vendor order is `READY` for platform delivery, or a customer-pickup proof must be rehearsed  
**Protected data:** Fictional exact address, masked contact route, assignment, route, custody, and proof metadata  
**Next handoff:** Successful completion goes to Finance Test Operator; failure/custody uncertainty goes to Support Test Operator and Operations Lead

## Dispatch record

| Field | Entry |
|---|---|
| Session/request/order refs | `<TEST-... / REQ-T-... / ORD-T-...>` |
| Trip reference | `<TRIP-T-...>` |
| Previous trip reference | `<TRIP-T-... or NONE>` |
| Synthetic vendor/zone | `<FV-.. / ZONE-JPR-..>` |
| Package count | `<integer>` |
| Fulfilment method | `<PLATFORM_DELIVERY / CUSTOMER_PICKUP>` |
| Coarse destination before assignment | `<zone only>` |
| Delivery tester role token | `<synthetic authorized token>` |
| Offer/accept timestamps | `<ISO 8601 +05:30>` |
| Route metres/policy version | `<integer / synthetic version>` |
| Expected synthetic earning minor | `<integer INR>` |
| Duplicate/active-trip check | `<PASS / FAIL>` |

Only one trip may be active for an order. Reassignment closes the earlier attempt with its reason and creates a new trip reference; it never erases prior effort, waiting, or custody history.

## Minimum-data release

| Stage | Data released | Released by/at | Access expiry | Verified |
|---|---|---|---|---|
| Offer | Vendor zone, destination zone, distance, deadline, expected synthetic earning | `<Dispatcher/timestamp>` | Offer end | `<PASS>` |
| Assigned | Fictional vendor pickup instructions and package count | `<Dispatcher/timestamp>` | Assignment end | `<PASS>` |
| Active delivery after pickup | Exact fictional address token/text and masked fake contact route | `<Dispatcher/timestamp>` | Delivery/return closure | `<PASS>` |

No exact address is released before the approved stage. No payment details, customer history, sibling order, vendor settlement, or proof secret is disclosed.

## Pickup and custody

| Arrived vendor | Wait started | Pickup proof method | Verification outcome | Proof evidence ref | Pickup time | Packages received | Custody state |
|---|---|---|---|---|---|---:|---|
| `<timestamp>` | `<timestamp>` | `<FAKE_OTP / FAKE_QR / MANUAL_EXCEPTION>` | `<PASS / FAIL>` | `<safe ref>` | `<timestamp>` | `<integer>` | `<NONE / IN_CUSTODY>` |

Never record OTP content. Custody begins only after valid pickup verification and matching package count. A mismatch blocks departure and opens a case.

## Waiting and movement

| Trusted arrival | Departure | Completed wait minutes | Included minutes | Paid wait minutes | Wait earning minor | Exception case |
|---|---|---:|---:|---:|---:|---|
| `<timestamp>` | `<timestamp>` | `<integer>` | `<0–5>` | `<0–10>` | `<0–1000>` | `<NONE or CASE-T-...>` |

The first five completed minutes are included; minutes 6–15 earn synthetic ₹1 per completed minute, capped at ₹10 automatically. Longer or disputed waits require a case and approved adjustment. A minute is counted once despite retry/reconnect.

## Delivery or pickup proof

| Arrival time | Method | Verification outcome | Evidence reference | Package count | Recipient result | Completed at | Custody state |
|---|---|---|---|---:|---|---|---|
| `<timestamp>` | `<FAKE_OTP / MANUAL_EXCEPTION>` | `<PASS / FAIL>` | `<safe ref; no OTP>` | `<integer>` | `<ACCEPTED / REFUSED / UNREACHABLE>` | `<timestamp or N/A>` | `<DELIVERED / IN_CUSTODY>` |

Proof must match the active order, trip, stage, and package count. A duplicate proof returns the original outcome and cannot duplicate completion or earnings.

## Failure and controlled return

| Failure time | Reason code | Case ref | Return authorized at/by | Return trip/route metres | Return proof outcome/ref | Final custody state |
|---|---|---|---|---|---|---|
| `<timestamp>` | `<CUSTOMER_UNREACHABLE / INCORRECT_ADDRESS / UNSAFE_LOCATION / CUSTOMER_REFUSED / PACKAGE_DAMAGED / OTHER>` | `<CASE-T-...>` | `<timestamp/Operations role>` | `<reference/integer>` | `<PASS or exception / safe ref>` | `<RETURNED / TRANSFERRED / UNRESOLVED>` |

After pickup, a customer cancellation or delivery failure cannot set the order directly to cancelled. Preserve custody and use `DELIVERY_FAILED → RETURN_REQUIRED → RETURN_AUTHORIZED → RETURNING → RETURNED`, or an approved custody exception. `UNRESOLVED` requires a named Operations handoff and blocks ordinary settlement closure.

## Handoff

| Order/trip | From role | To role | Terminal result or issue | Custody | Earnings refs | Sent/accepted at | Case |
|---|---|---|---|---|---|---|---|
| `<refs>` | `<Dispatcher/Delivery Tester>` | `<Finance / Support / Operations>` | `<DELIVERED / PICKED_UP / RETURNED / UNRESOLVED>` | `<state>` | `<safe refs>` | `<timestamps>` | `<NONE or CASE-T-...>` |
