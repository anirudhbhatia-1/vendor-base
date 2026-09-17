# Repair batch 05 — the cross-role loop, and the money nobody could see

**Implemented:** 8 September 2026. **Verification level:** domain services against a real PostgreSQL/PostGIS instance, one order walked by four roles; not a browser or device run.

This takes item 6 from [batch 01's next unaccepted work](repair-batch-01-evidence.md) — *"Complete the cross-role supply → customer order → vendor preparation → partner delivery → receipt/refund/earnings loop"*.

## What was already connected

More than the module names suggest, and it is worth recording so nobody rebuilds it. `verify-vendor-fulfilment.ts` already walks one real order end to end: two stores, a real cart, a real grouped checkout placing two child orders in one group, accept-by deadlines, a decline on the sibling, picking, ready, partner assignment, custody, delivery with OTP, replay protection, ratings — and then capture, settlement and the partner earning posted to the ledger, all keyed to the same `vendor_order_id`.

`verify-money-lifecycle.ts` looks like it covers the money, but it builds its own vendor and location and operates on invented string references (`SYNTH-ORDER-MONEY-0001`, `SYNTH-CHECKOUT-MONEY-0001`). It never sees a real order. That is fine as unit-level coverage of the money rules; it is not the loop.

## B05-01 — every role-facing money view was unexercised

The ledger was asserted directly from its tables. What nothing checked was whether the people involved can *see* it. `customerReceipt`, `vendorStatement` and `partnerStatement` appeared in **no verifier in the repository**.

That matters because the repair plan's exit condition for R9 is that *"customer/vendor/partner/admin views reconcile to the same ledger"*. A ledger nobody can read is not a reconciliation, and three scoped read models — each with its own authorization query — were carrying that guarantee untested.

Eleven assertions now close it, on the same checkout group, the same delivered order and the same declined sibling the walk already produced:

| Role | Asserted |
|---|---|
| Customer | The receipt mirrors the group's orders exactly — none omitted, none invented; the delivered order reads `DELIVERED` and the declined sibling does not; **no refund is allocated against the delivered order** |
| Customer (negative) | Another customer is refused the receipt |
| Vendor | The statement returns settlements for their own location and no other |
| Vendor (negative) | The other store's owner is refused this location's statement |
| Partner | The statement reports the same `net_minor` the ledger holds, under their own identity |
| Partner (negative) | A stranger's statement is empty |

The refund assertion is the money-side counterpart of the sibling isolation the walk already proves operationally: whatever declining storeB's order did to its share, it must not have moved storeA's.

**Mutation-proven** on the two privacy scopings, which are the assertions worth trusting least on inspection alone:

| Probe | Caught by |
|---|---|
| Receipt query stops scoping on `customer_user_id` | *Another customer read this checkout group's receipt* |
| Partner earnings query stops scoping on `partner_user_id` | *A stranger read this partner's earnings* |

Both probes first failed with `could not determine data type of parameter` — a SQL error before any assertion ran — and were redone with explicit casts rather than counted. Third time this session that a probe has died before reaching its assertion; the rule holds that such a run proves nothing.

## An assumption I had to correct

My first version asserted the receipt reports exactly two orders, because the checkout places two. It reported three: by the time the money leg runs, the walk has added a third order to the same group for the acceptance-timeout case, and the receipt correctly includes it as `EXPIRED` alongside the `DELIVERED` and `CANCELLED` ones.

The fixed count was my assumption, not the system's behaviour. The assertion now derives the expected set from the group itself — the receipt must mirror the group's orders, no more and no fewer — which is both the real invariant and immune to the fixture growing again.

Worth noting the diagnosis only took one run because the failure message carried the actual payload. A bare `length === 2` failure would have said nothing about why.

## B05-02 — the refund journey (G10), now walked

The negative assertion above — that no refund is allocated against the delivered order — is a true statement about a group where no refund exists, and it would stay true if raising one were broken. A real one is now raised on the same order and followed into the customer's receipt.

Eight assertions:

| Stage | Asserted |
|---|---|
| Propose | A partial `PARTIAL_ITEM_REFUND` against the delivered order's reference, on the group's real payment transaction |
| Maker/checker | The proposer **cannot** approve their own refund |
| Approve | A second finance identity approves and submits it |
| Replay | Re-approving on the version already consumed is refused, so a duplicate correction cannot post twice |
| Receipt | Exactly one refund appears against the delivered order, for the exact amount |
| Sibling | No refund appears against the declined sibling |
| Arithmetic | `refunded_total_minor` grows by exactly the refund, once |
| Immutability | The delivered order stays `DELIVERED`, and no order total is rewritten — a refund posts *against* money, it does not edit history |

**Mutation-proven, and it revealed defence in depth.** Disabling the application's self-approval check (`refund.proposed_by_user_id === who`) turned the ladder red on *"A finance actor approved the refund they proposed"* — and the error it carried was `new row for relation "refunds" violates check constraint "refund_maker_checker"`. The database enforces maker/checker independently of the service. Both layers hold; the assertion demands the application-level `MoneyStateError`, which is the contract a caller sees.

Three fixture errors of mine on the way, each caught by a constraint rather than by review: the provider reference must match `^SYNTH-REF-…` (I used `SYNTH-REFUND-…`), the proposer must be a real user row (`refund_proposer_fk`), and maker/checker needs two identities the database knows about.

## B05-03 — a second flaky assertion in the connected ladder

`verify-configuration-lifecycle.ts:274` — *"Database accepted an invalid lifecycle jump"* — failed once during this batch and passed on an immediate re-run with identical code. It expects a direct `UPDATE` to `status = 'ACTIVE'` to be refused with SQLSTATE `23514`.

Migration 0005 line 197 explicitly **permits** `SCHEDULED → ACTIVE`, so whether that update is refused depends on the row's status at that instant. That is a plausible mechanism and I am not claiming it as the diagnosis; what is established is that the assertion is not deterministic.

This is the **second** such assertion, after `verify-messaging-lifecycle.ts:323` in [batch 02](repair-batch-02-evidence.md). Two known non-deterministic assertions in the ladder matters more than either alone: this suite is the primary gate every batch in this audit has leaned on, and a gate that goes red at random trains its readers to re-run until green — which is precisely how a genuine regression would pass unnoticed. Both should be characterised before the ladder is used as a release gate.

## B05-04 — admin reconciliation, against this order's real operations

`importProviderStatement` and `financeQueue` were exercised only by `verify-money-lifecycle.ts`, which invents its own references. The rule that matters — reconciliation compares durable provider events to the attempts and ledger a real order produced — had never been tested against one.

Seven assertions on the same order:

| Case | Asserted |
|---|---|
| Refund settled | The approved refund reads `SUCCEEDED` for exactly the amount proposed |
| Agreeing statement | A row matching the refund's reference, amount and state reconciles as `MATCHED` |
| Disagreeing statement | A row claiming one paisa more than the captured payment is classified `AMOUNT_MISMATCH`, not absorbed |
| Operator surface | The resulting `AMOUNT_MISMATCH` exception reaches `financeQueue` naming that payment's operation reference |
| Read-only | Importing a statement does not change the customer receipt — reconciliation reports, it does not move money |
| Authorization | A customer is refused the finance exception queue |

The read-only assertion is the one worth naming: a provider disagreement must raise an exception for a person to resolve, never quietly adjust the customer's receipt to match the provider.

**Mutation-proven:**

| Probe | Caught by |
|---|---|
| Amount comparison neutralised | *A statement disagreeing with the captured amount was accepted as matched* |
| `admin()` check dropped from `financeQueue` | *A customer read the finance exception queue* |

A first attempt at the amount probe used `else if (false)`, which TypeScript rejected as unreachable code before the suite ran. Rewritten to compare the row against itself — always false, still compiles. Fourth probe this session to die before its assertion; each was redone rather than counted.

Two more shape errors of mine, both caught by the run rather than by reading: `financeQueue` returns `{ exceptions }` and not `{ rows }`, and the statement row's verdict column is `reconciliation_class`, not `classification` — the base table in migration 0015 does not declare it at all.

## Verification

| Check | Result |
|---|---|
| `pnpm db:verify` | exit 0 — 71 migrations, 28 modules, `vendor_fulfilment_scenarios` 20 → 46 |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` | exit 0 |
| `pnpm test:unit` | 464 pass / 0 fail |

## Still open
- **The browser and device halves.** This is the domain loop. The same journey through eight clients is items 2 and 4, and the acceptance journeys that would walk it in a browser still lack fixtures ([batch 04](repair-batch-04-evidence.md)).
- **`verify-money-lifecycle.ts` still runs on invented references.** It is not wrong — the money rules deserve isolated coverage — but it should not be read as evidence that the money follows a real order. This batch is that evidence, and only for the paths listed above.
