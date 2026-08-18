# Synthetic Desk-Run Scenario Plan

**Data:** Fictional and safe for repository use
**Money unit:** Integer paise, currency `INR`
**Policy:** Approved internal synthetic financial policy

## Scenario matrix

| Run | Customer/vendor | Products | Route/fulfilment | Visible amount before confirmation | Required branch | Proof/case | Expected terminal result |
|---|---|---|---|---:|---|---|---|
| `RUN-T-01` | `CUS-T-01` / `FV-01` | `PROD-FV-001`, `PROD-FV-002` | 5,000 m delivery | `34900` | Normal accept/pick/deliver | Fake delivery proof ref; no OTP content | Completed and settled |
| `RUN-T-02` | `CUS-T-06` / `FV-03` | `PROD-FV-015`, `PROD-FV-019` | 3,000 m delivery | Original `22300`; revised `24300` | Variable weight/price change approved explicitly | Decision ref and fake proof | Completed at revised amount |
| `RUN-T-03` | `CUS-T-03` / `FV-02` | `PROD-FV-008` | 1,500 m delivery | `16500` | Unavailable before pickup after 7 trusted wait minutes | `CASE-T-R03A7K`; fake full refund | Cancelled; wait earning preserved |
| `RUN-T-04` | `CUS-T-07` / `FV-07` | `PROD-FV-004`, `PROD-FV-011` | Customer pickup | `12500` | Vendor accepts and customer collects | Fake customer-pickup proof | Completed without trip earning |
| `RUN-T-05` | `CUS-T-12` / `FV-01` | `PROD-FV-001`, `PROD-FV-002` | 5,000 m outbound and return | `34900` | Unreachable after pickup; controlled return | `CASE-T-R05K8M`; pickup and return proof refs | Returned, refunded, custody closed |
| `RUN-T-06` | `CUS-T-15` / `FV-01` | `PROD-FV-001`, `PROD-FV-002`, `PROD-FV-003` | 5,000 m delivery | `34900` | Completed delivery then `6000` item refund | `CASE-T-R06P4W`; fake refund ref | Completed with partial refund |
| `RUN-T-07` | `CUS-T-10` / `FV-08` | `PROD-FV-010`, `PROD-FV-013` | 3,000 m delivery | `24300` | Fake authorization timeout/unknown; same ref later matched by statement | `CASE-T-R07N6X`; reconciliation evidence | Completed only after fake match |
| `RUN-T-08` | `CUS-T-20` / `FV-04` and `FV-05` | One isolated line per vendor | 1,500 m and 3,000 m deliveries | Combined `33800` (`11500` + `22300`) | First order cancels; second completes unchanged | Refund for first; proof for second | Partial group completion; siblings isolated |

## Synthetic references

| Run | Request | Vendor order(s) | Trip(s) | Payment | Refund | Settlement(s) |
|---|---|---|---|---|---|---|
| `RUN-T-01` | `REQ-T-R01F3K` | `ORD-T-R01P8M` | `TRIP-T-R01X6N` | `PAY-T-R01V4C` | `NONE` | `SET-T-R01N6W` |
| `RUN-T-02` | `REQ-T-R02H7Q` | `ORD-T-R02D5K` | `TRIP-T-R02M4R` | `PAY-T-R02C8V` | `NONE` | `SET-T-R02W3N` |
| `RUN-T-03` | `REQ-T-R03Q5H` | `ORD-T-R03K8D` | `TRIP-T-R03V2M` | `PAY-T-R03C7N` | `REF-T-R03W4P` | `SET-T-R03X6R` |
| `RUN-T-04` | `REQ-T-R04M2K` | `ORD-T-R04V7Q` | `NONE` | `PAY-T-R04H5C` | `NONE` | `SET-T-R04N8W` |
| `RUN-T-05` | `REQ-T-R05D4R` | `ORD-T-R05P7X` | `TRIP-T-R05K3V` | `PAY-T-R05N8C` | `REF-T-R05W2M` | `SET-T-R05Q6H` |
| `RUN-T-06` | `REQ-T-R06V5N` | `ORD-T-R06K2W` | `TRIP-T-R06C8Q` | `PAY-T-R06M4H` | `REF-T-R06P7X` | `SET-T-R06D3R` |
| `RUN-T-07` | `REQ-T-R07W8K` | `ORD-T-R07Q4C` | `TRIP-T-R07N2V` | `PAY-T-R07H6M` | `NONE` | `SET-T-R07P3X` |
| `RUN-T-08` | `REQ-T-R08C5V` | `ORD-T-R08H2K`, `ORD-T-R08N7Q` | `TRIP-T-R08M4W` | `PAY-T-R08P6X` | `REF-T-R08D3R` | `SET-T-R08V8C`, `SET-T-R08K5N` |

## Expected handoff sequence

```text
Customer scenario
→ intake with visible total
→ one vendor confirmation per order
→ dispatch or customer pickup
→ proof/case and custody result
→ refund when applicable
→ settlement and independent reconciliation
```

`RUN-T-07` pauses after the payment result becomes unknown. Vendor confirmation and dispatch occur only after the fictional statement matches the same payment reference. `RUN-T-08` maintains two separate vendor-order paths and allocates the combined fake payment explicitly.
