# Acceptance Tests Derived from Phase 1 Exceptions

**Purpose:** Convert synthetic exception findings into test contracts for later numbered phases
**Current status:** Specifications only; no application code exists
**Data:** Deterministic synthetic fixtures only

## Test contracts

### `AT-01` — Material weight or price change needs explicit decision

**Later phases:** 7–8
**Given** a vendor is picking a variable-weight line with a material final-amount change
**When** the vendor submits the final weight and revised amount
**Then** the affected order enters `AWAITING_CUSTOMER_DECISION`, shows original and revised totals, and cannot continue until the recorded rule or explicit decision permits it. Reject, timeout, duplicate decision, and stale order version must be tested.

### `AT-02` — Unavailable item before pickup refunds only its order

**Later phases:** 7–8 and 10
**Given** one vendor order becomes unavailable before custody while a sibling order remains valid
**When** the vendor declines/cancels with an approved reason
**Then** only that order releases inventory/allocation, refunds its customer components, charges no vendor fee, and leaves the sibling unchanged. Retry and duplicate cancellation return the same outcome.

### `AT-03` — Trusted wait earning survives pre-pickup cancellation

**Later phases:** 9–10
**Given** trusted vendor arrival and seven completed wait minutes
**When** the order cancels before pickup
**Then** customer/vendor amounts unwind, minutes 6–7 create exactly `200` paise partner earning, and the platform funds it once. Reconnect or duplicate timer events cannot double-credit.

### `AT-04` — Failure after pickup requires controlled return

**Later phases:** 9–10
**Given** pickup proof has started custody
**When** delivery fails because the customer is unreachable
**Then** ordinary cancellation is rejected, return is authorized, return proof closes custody, valid outbound/return earnings remain, and refund waits for proof or approved exception. Unsafe/missing return destination and vendor-refused return require owned cases.

### `AT-05` — Partial item refund preserves completed fulfilment economics

**Later phase:** 10
**Given** delivery completed and one item needs a `6000`-paise refund
**When** the component refund succeeds
**Then** only that item/tax allocation reverses, delivery earning and valid tip remain, vendor fee remains while another item is completed, and ledger difference is zero. Full-item reversal uses the full-refund rule instead.

### `AT-06` — Unknown payment uses one stable operation

**Later phases:** 7 and 10
**Given** provider authorization times out after submission
**When** the immediate outcome is unknown
**Then** fulfilment remains blocked, no new payment ID is created, and a later verified statement/callback advances the same operation exactly once. Conflicting amount/currency/token enters finance review.

### `AT-07` — Multi-vendor sibling isolation is transactional

**Later phases:** 7–10
**Given** one checkout group contains two independently allocated vendor orders
**When** the first cancels and the second completes
**Then** group projection becomes partial, the first allocation refunds, the second retains its lines/fee/trip/settlement, and combined payment reconciliation remains balanced. Authorization must prevent either vendor changing the sibling.

### `AT-08` — Proof retry cannot duplicate custody or earnings

**Later phase:** 9
**Given** proof is saved against an active assignment during connectivity loss
**When** the same proof retries after reconnect
**Then** one transition and one earning result exist, the original result replays, and another job remains blocked until proof resolves. Wrong/expired/reused proof never completes custody.

### `AT-09` — Sensitive data and fake adapters remain isolated

**Later phases:** 2 onward
**Given** local fixtures and fake provider scenarios
**When** tests, logs, reports, retries, and failures execute
**Then** no real participant data, OTP content, payment instrument, bank detail, exact unnecessary location, credential, or external side effect appears. Detection stops the run and emits only safe evidence.

### `AT-10` — Reconciliation refuses unexplained balance fixes

**Later phases:** 7–10
**Given** captured, refund, vendor, partner, and platform components
**When** reconciliation calculates a non-zero difference or mismatched provider record
**Then** the affected record enters a finance exception with owner and amount at risk; history is not edited and no unexplained adjustment is posted. A linked approved reversal/adjustment is required.

## Coverage map

| Control | Happy | Failure | Duplicate/retry | Permission | Reconciliation |
|---|---|---|---|---|---|
| Customer change | `AT-01` | `AT-01` | `AT-01` | Later role tests | `AT-05` |
| Vendor cancellation | `AT-02` | `AT-02` | `AT-02` | `AT-07` | `AT-02` |
| Wait/custody/return | Later normal trip test | `AT-03`, `AT-04` | `AT-03`, `AT-08` | Later assignment tests | `AT-03`, `AT-04` |
| Payment/refund | Later capture test | `AT-05`, `AT-06` | `AT-05`, `AT-06` | Maker-checker tests | `AT-05`, `AT-10` |
| Multi-vendor | Later grouped success | `AT-07` | `AT-07` | `AT-07` | `AT-07`, `AT-10` |
| Privacy/provider isolation | `AT-09` | `AT-09` | `AT-09` | `AT-09` | Safe evidence only |

Each implementation step must turn applicable specifications into unit, integration, and end-to-end tests in that same step. This file does not authorize bundling later phases together.
