# Customer Order Intake Template

**Used by:** Customer Intake Operator  
**Use when:** A fictional customer selects one or more named synthetic vendors and reviews the complete test price  
**Protected data:** Synthetic alias, masked contact route, fictional address token, preferences, and fake payment reference  
**Next handoff:** One isolated vendor-order form goes to each applicable Vendor Confirmation Operator; payment summary goes to Finance Test Operator

## Request header

| Field | Entry |
|---|---|
| Session reference | `<TEST-...>` |
| Customer request reference | `<REQ-T-...>` |
| Fictional customer alias | `<synthetic alias>` |
| Masked fake contact route | `<FAKE-CHANNEL-...>` |
| Zone ID | `<ZONE-JPR-01 through ZONE-JPR-03>` |
| Fictional address token | `<ADDR-T-...>` |
| Notice version/language | `<version / EN or HI>` |
| Necessary-processing acknowledgement | `<YES / NO>` |
| Optional choice and decision | `<purpose / YES / NO / NOT_ASKED>` |
| Requested fulfilment | `<DELIVERY / CUSTOMER_PICKUP>` |
| Requested window | `<ISO 8601 start/end +05:30>` |
| Intake operator/time | `<role token / timestamp>` |

If necessary processing is declined, do not continue. Optional consent must be separate, unselected by default, and withdrawable; it must not affect the synthetic order unless the optional feature truly requires it.

## Vendor groups and visible totals

Create exactly one `ORD-T-...` record for each vendor. An order may never contain lines from two vendors.

| Vendor order ref | Vendor ID | Catalogue version | Item subtotal minor | Delivery fee minor | Tax minor | Discount minor | Tip minor | Final visible total minor | Currency | Customer confirmed at |
|---|---|---|---:|---:|---:|---:|---:|---:|---|---|
| `<ORD-T-...>` | `<FV-..>` | `<catalogue version>` | `<integer>` | `<integer>` | `<integer>` | `<integer>` | `<integer>` | `<integer>` | `INR` | `<timestamp>` |

The customer is shown item prices, applicable delivery fee, tax, discount, tip, and final price—not the internal formula calculation. Verify for each row:

```text
final_visible_total_minor = item_subtotal_minor
                          + delivery_fee_minor
                          + tax_minor
                          + tip_minor
                          - discount_minor
```

## Order-line snapshot

| Vendor order ref | Line no. | Product ID | Display name snapshot | Unit snapshot | Requested quantity | Quoted weight grams | Unit price minor | Line amount minor | Availability snapshot | Substitution choice |
|---|---:|---|---|---|---:|---:|---:|---:|---|---|
| `<ORD-T-...>` | `<1...>` | `<PROD-FV-...>` | `<fictional name>` | `<unit>` | `<integer>` | `<integer or N/A>` | `<integer>` | `<integer>` | `<state>` | `<NONE / CUSTOMER_DECIDES>` |

## Fake payment authorization

| Payment reference | Requested amount minor | Currency | Simulator scenario | Result | Provider reference | Recorded at |
|---|---:|---|---|---|---|---|
| `<PAY-T-...>` | `<sum of vendor final totals>` | `INR` | `<SUCCESS / DECLINE / TIMEOUT / MALFORMED / DUPLICATE / UNKNOWN>` | `<FAKE state>` | `<fictional masked ref>` | `<timestamp>` |

Do not record a card, UPI ID, bank detail, credential, or OTP. A timeout/unknown result remains unresolved and goes to reconciliation; never create a second payment reference merely to make it pass.

## Intake checklist

- [ ] References were reserved and duplicate-checked.
- [ ] Customer, address, contact, vendors, products, and money are synthetic.
- [ ] Each vendor order contains exactly one named vendor.
- [ ] Catalogue versions are active and quoted lines are snapshotted.
- [ ] Final price was shown and confirmed before fake authorization.
- [ ] Substitution is not silently enabled.
- [ ] The sum of vendor-order totals equals the requested fake payment amount.
- [ ] Decline, timeout, unknown, or malformed payment did not become confirmed.
- [ ] No raw address is sent to a delivery tester at intake.

## Handoff

| Source request | Child order/payment | From role | To role | Current state | Sent/accepted at | Open case |
|---|---|---|---|---|---|---|
| `<REQ-T-...>` | `<ORD-T-... or PAY-T-...>` | `Customer Intake Operator` | `<Vendor Confirmation Operator or Finance Test Operator>` | `<PLACED / PAYMENT_REVIEW>` | `<timestamps>` | `<NONE or CASE-T-...>` |
