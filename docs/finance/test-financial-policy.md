# Synthetic financial policy and worked examples

**Status:** Approved for internal company testing only  
**Currency:** INR  
**Real-money authority:** None  
**Production policy:** Unresolved and blocked

## Purpose

This policy gives local development one complete, balanced set of fictional money rules. It exists to test quotes, orders, refunds, earnings, settlement, payout, and reconciliation. It is not a price list, tax opinion, vendor contract, partner contract, or customer-facing production policy.

Every rule is versioned. A new version affects only quotes created after its activation time; historical orders always retain their original version and amounts.

## Money representation and allocation

- Store money as integer paise with explicit currency `INR`.
- Never use floating-point money.
- Round a rational calculation once, half-up, to the nearest paise.
- When dividing a fixed amount, calculate proportional shares and distribute remaining paise in stable line order until allocations equal the source amount exactly.
- Ledger entries are append-only and balanced. Corrections use linked reversing or adjustment entries.

Example: ₹1 divided equally across three lines becomes ₹0.34, ₹0.33, and ₹0.33, totalling exactly ₹1.

## Customer delivery fee

The fee applies once per vendor order:

```text
₹15 includes the first 2 route km
+ ₹8 for each additional route km, charged proportionally
40 route km is the outer synthetic serviceability boundary
```

For integer calculation:

```text
base_minor = 1500
extra_metres = max(0, route_metres - 2000)
extra_minor = round_half_up(extra_metres × 800 ÷ 1000)
delivery_fee_minor = base_minor + extra_minor
```

The customer sees the resulting per-order delivery fee and final total, not the internal formula steps. Receipts still separate items, delivery fee, tax, discount, tip, and total.

## Vendor platform fee

- Charge a fictional flat ₹5 per successfully completed vendor order.
- Charge no fee for decline, timeout, cancellation, platform failure, or full refund.
- Keep the ₹5 fee for a completed order with only a partial item refund.
- Store the fee as its own versioned ledger component.

## Delivery-partner earnings

### Completed outbound trip

Use an independently versioned earning policy with the same synthetic ₹15/2 km plus ₹8/additional km proportional formula. Matching the customer fee is a test simplification, not a required production relationship.

### Waiting

- Trusted vendor arrival starts the server timer.
- The first 5 completed minutes are included.
- Minutes 6 through 15 earn ₹1 per completed minute.
- Automatic waiting pay is capped at ₹10.
- A longer wait requires a linked support case and approved adjustment.
- A minute can be credited only once despite retries or reconnects.

### Return

- The partner retains valid outbound and waiting earnings.
- A return earning starts only after server authorization.
- The approved return route uses the independently versioned distance formula.
- Return earning becomes payable after valid return proof or an approved custody exception.
- Replayed proof cannot duplicate an earning.

### Tips

- Allocate 100% of a valid customer tip to the delivery partner.
- Deduct no vendor or platform fee from a tip.
- Refund the tip if delivery never begins.
- Preserve it after successful delivery when an unrelated item receives a partial refund.
- Hold it for review during delivery failure or return until the final outcome is known.

## Synthetic tax handling

- Normal synthetic quotes and ledger records explicitly store `tax_minor = 0`.
- Zero means tax calculation is disabled in the test environment; it does not mean tax exempt.
- Positive fictional tax fixtures must test allocation, rounding, partial refund, full refund, statement, and reconciliation behaviour.
- Real GST, TCS, invoicing, vendor registration, return, and service treatment remain blocked pending qualified Indian tax and legal approval.

## Cancellation and refunds

### Before partner pickup

- Refund cancelled or unavailable items in full.
- Refund delivery fee and tip in full.
- Set the vendor platform fee to zero.
- Preserve any already valid partner earning and charge it to the synthetic platform account.

### After partner pickup

- Do not perform a simple cancellation.
- Enter the controlled return workflow.
- Complete the customer refund only after return proof or an approved custody exception.
- Preserve valid outbound, waiting, and return earnings.
- Set the vendor platform fee to zero.
- Charge the synthetic platform account for the protected partner earning.

### Partial refund after successful delivery

- Refund only the affected item amount and that item's allocated fictional tax.
- Reverse the affected discount allocation deterministically.
- Keep the delivery fee if delivery completed correctly.
- Keep completed partner earnings and tip.
- Keep the ₹5 vendor fee while at least one item remains completed.
- Treat a refund of every item as a full refund and set the vendor fee to zero.

## Settlement and payout

- Vendor and partner payable entries become eligible 24 hours after completion.
- Open refund, return, custody, or dispute work holds only the affected amount.
- One fake payout batch runs daily at 18:00 Asia/Kolkata.
- Tests advance a controllable clock; they never wait a real day.
- Each batch and beneficiary payout uses a unique idempotency key.
- Failed or unknown payouts remain unpaid and enter reconciliation.
- The payout simulator produces a fictional statement for matching.

## Reconciliation at scale

- Read statements in bounded pages.
- Resume from a saved provider checkpoint.
- Match provider reference, internal operation ID, amount, currency, and account token.
- Process pages through horizontally scalable workers.
- Send unmatched or conflicting records to a finance-exception queue with amount at risk, age, owner, and next action.
- Never rewrite balanced history to conceal a mismatch; post an approved linked adjustment.

## Worked examples

### 1. Normal completed 5 km order

```text
Items                                      ₹300
Customer delivery fee                      ₹39
Customer tip                               ₹10
Synthetic tax                               ₹0
Customer pays                              ₹349

Vendor item proceeds                       ₹300
Less vendor platform fee                    ₹5
Vendor payable                             ₹295

Partner trip earning                        ₹39
Partner tip                                 ₹10
Partner payable                             ₹49

Platform remainder: ₹349 - ₹295 - ₹49       ₹5
```

After 24 hours without a hold, the ₹295 vendor payable and ₹49 partner payable enter the next 18:00 fake payout batch.

### 2. Completed order with ₹60 item refund

```text
Original customer payment                  ₹349
Item refund                                 ₹60
Customer net payment                       ₹289

Vendor payable: ₹300 - ₹60 - ₹5            ₹235
Partner payable remains                     ₹49
Platform remainder remains                   ₹5

Balance: ₹235 + ₹49 + ₹5                   ₹289
```

### 3. Cancellation before pickup after 7 minutes of trusted wait

```text
Customer refund: items + delivery + tip     ₹349
Vendor payable                                ₹0
Vendor platform fee                           ₹0
Partner waiting earning: minutes 6 and 7      ₹2
Synthetic platform adjustment                -₹2
```

The customer and vendor are not charged for the already valid partner waiting amount.

### 4. Delivery failure followed by a 5 km authorized return

```text
Outbound partner earning                     ₹39
Return partner earning                       ₹39
Total partner earning                        ₹78
Customer full refund after return proof     ₹349
Vendor platform fee                           ₹0
Synthetic platform funds partner earning     ₹78
```

### 5. Unknown payout result

The worker submits one payout ID and times out. The payout remains `SUBMITTED/UNKNOWN`, is not retried under a new ID, and is not marked paid. A later fictional statement confirms success; reconciliation advances the existing payout once and records the matching evidence.

### 6. Positive fictional tax allocation fixture

This fixture does not use or imply a real tax rate. A fixed fictional ₹1 tax amount is divided across three equal eligible lines:

```text
Line 1 fictional tax                         ₹0.34
Line 2 fictional tax                         ₹0.33
Line 3 fictional tax                         ₹0.33
Allocated fictional tax total                ₹1.00
```

Refunding line 1 reverses exactly ₹0.34. Refunding every line reverses exactly ₹1 with no missing or extra paise.

## Production gate

Before real money, controlled company accounts must exercise real-provider authorization, capture, void, refund, payout, callback, statement, timeout, duplicate, and reconciliation paths. Finance, product, operations, legal/tax, privacy, security, support, monitoring, rollback, and approval thresholds must all be approved. A limited canary precedes wider use.
