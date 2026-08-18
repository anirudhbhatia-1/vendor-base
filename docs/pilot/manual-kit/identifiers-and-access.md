# Manual Identifiers and Protected-Data Access

**Used by:** Every internal pilot operator  
**Use when:** Opening a session or creating any customer request, vendor order, trip, payment operation, or case  
**Protected data:** All filled records are treated as protected rehearsal data even though they must be synthetic  
**Next handoff:** The role creating a record gives only the minimum fields and its reference to the next named role

## Manual identifier standard

Use `PREFIX-T-TOKEN`, where `T` means test and `TOKEN` is a pre-generated, non-sequential six-character uppercase token excluding `0`, `O`, `1`, and `I`. Operators reserve the next unused token from the protected session roster and mark it used before filling a form. Do not derive tokens from names, phone numbers, dates, vendor IDs, order counts, or other personal/business facts.

| Record | Prefix | Fictional format example | Created by | Links to |
|---|---|---|---|---|
| Customer request | `REQ` | `REQ-T-7F3K9Q` | Customer Intake Operator | Session; one or more vendor orders; payment |
| Vendor order | `ORD` | `ORD-T-4P8M2D` | Customer Intake Operator | Customer request; exactly one vendor; optional trip; cases |
| Trip/assignment attempt | `TRIP` | `TRIP-T-8R2X6N` | Dispatcher | Exactly one vendor order; previous trip when reassigned |
| Payment operation | `PAY` | `PAY-T-6V4C8H` | Finance Test Operator | Customer request; allocations to vendor orders |
| Support/incident case | `CASE` | `CASE-T-5H7T2W` | Support Test Operator | Exact affected request/order/trip/payment references |
| Refund operation | `REF` | `REF-T-3C9J4K` | Finance Test Operator | Payment; exact vendor order and affected components |
| Settlement record | `SET` | `SET-T-2N6W8R` | Finance Test Operator | One vendor order; vendor, partner, and platform allocations |

Examples demonstrate shape only and must not be reused in a completed form. Public-looking references are lookup aids, never proof of identity or authority.

## Reservation log template

| Session reference | Record type | Reserved token | Full reference | Reserved at | Operator role | Used/void | Linked reference | Duplicate check |
|---|---|---|---|---|---|---|---|---|
| `<synthetic>` | `<type>` | `<token>` | `<reference>` | `<ISO 8601 +05:30>` | `<role>` | `<USED or VOID>` | `<reference or NONE>` | `<PASS>` |

A mistake never reuses or erases a reference. Mark it `VOID`, record a safe reason, and reserve a new token. On suspected duplication, stop new work and open a case.

## Minimum access matrix

| Role | May view for assigned work | Must not view | Access ends |
|---|---|---|---|
| Catalogue Test Operator | Fictional vendor ID, product IDs, units, synthetic prices, availability | Customer, partner, payment, or case detail | Catalogue snapshot handoff |
| Customer Intake Operator | Synthetic customer alias, masked contact route, zone/address token, catalogue, visible totals and preferences | Partner identity, vendor settlement, raw payment instrument | Intake handoff or correction closure |
| Vendor Confirmation Operator | Its one vendor order, lines, preferences, fulfilment method, minimum delivery instructions | Sibling orders, full customer history, partner earnings, payment details | Vendor handoff closes |
| Dispatcher | Ready vendor order, package count, pickup token, coarse destination zone; exact synthetic destination only after assignment | Catalogue history, full payment, vendor settlement, unrelated requests | Assignment/return closes |
| Assigned Delivery Tester | Current trip, pickup instructions, package count, exact synthetic destination during active custody, masked contact route | Sibling orders, customer history, payment, settlements | Delivery/return closes |
| Support Test Operator | Minimum fields for the assigned case and its linked references | Unrelated sessions, unrestricted searches, raw payment/bank data | Handoff or case closure |
| Finance Test Operator | Fake provider references, payment allocations, refunds, settlement components, masked payout token | Exact address, phone, raw location, proof secret | Finance task closes |
| Reconciliation Reviewer | Safe references, states, totals, exception/hold status | Exact address, phone, proof content, unrestricted evidence | Review sign-off |
| Operations Lead | Minimum active dispatch, custody, safety, incident, and handoff data | Unrelated historical protected data | Session/case closure |

## Protected-field handling

| Field class | Manual-kit rule |
|---|---|
| Customer alias | Fictional alias only; never a real person's name |
| Address | Fictional address token in ordinary forms; exact synthetic text only in the assigned trip record |
| Phone/contact | Fake route or masked value only; never a callable number |
| Bank/payout | Masked fictional account token only; no account number, UPI ID, card, or bank document |
| Payment | Fake provider reference and state only; no instrument data or credentials |
| OTP/proof | Record verification outcome, method, time, and evidence reference; never record OTP content |
| Location | No offline collection; only the minimum synthetic zone/route detail for an active assignment |
| Free text | Use structured codes first; do not copy sensitive values into notes |

Filled records must not be committed to Git, pasted into chat, or shared through public links. Grant access per role and case/session purpose, remove it at handoff expiry, and record emergency access with scope, reason, start, expiry, and reviewer.

## Handoff receipt

| Source reference | From role | To role | State | Open item | Sent at | Accepted at | Receiver acknowledgement |
|---|---|---|---|---|---|---|---|
| `<reference>` | `<role>` | `<role>` | `<state>` | `<NONE or safe summary>` | `<ISO 8601 +05:30>` | `<ISO 8601 +05:30>` | `<initials/role token>` |
