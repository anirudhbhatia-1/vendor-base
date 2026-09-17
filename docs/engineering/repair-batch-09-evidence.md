# Repair batch 09 — the offer that never moved on

**Implemented:** 14 September 2026. **Verification level:** the dispatch loop against a real PostgreSQL/PostGIS instance with two online partners and a real READY order; not a browser run, and not confirmed against the environment the field report came from (see *Environment note*).

**Field report.** A vendor board reading *Offered to a delivery partner* on a READY order, and a newly created partner — online for offers, in the same session — seeing *"0 offers waiting … new offers arrive here on their own."*

## What was wrong

Offers are personal and last five minutes. The board's chip meant one specific partner held a live offer; a second partner sees nothing until it expires or is declined. That much is by design. What happened next was not.

When the offer expired, the worker returned the attempt to the pool and offered it again to `eligible[0]` — the **nearest** online partner — which is the same partner, every time. Nothing recorded who had let an offer lapse: `OFFERED` is written by the worker and `OFFER_EXPIRED` by the system, so neither event named the rider, and the assignment row forgets its partner the moment the attempt returns to the pool. Dispatch could exclude partners who *declined* (they are the actor on that event) but had no way to know who had *ignored* the job. **An online partner not looking at their phone held the order indefinitely, and a second partner standing ready was never asked.** Workflow 6.7.3 says expired offers return to the pool; a pool of one is not a pool.

The loop that decides this — `offerReadyAssignments` — had **no verifier at all**. The ladder covered offer, accept, expiry and custody as individual transitions, and never the dispatcher choosing between partners.

The earlier comment on `declinedPartners` was explicit that an expired offer should *not* exclude the partner, because expiry usually means they were momentarily away. That reasoning stands, and the fix keeps it: a lapsed partner is asked again — after everyone who has been asked less.

## B09-01 — events name the partner they concern

Migration 0077 adds `assignment_events.partner_user_id`: the offeree on `OFFERED` and `OFFER_EXPIRED`, the holder on every later transition, null when the attempt names nobody. It is deliberately not the actor. `appendEvent` fills it from the row being transitioned; `offer()` passes the offeree explicitly because the row does not hold them yet.

No backfill: history is append-only (0014). The live offer from the field report will get its partner recorded on the expiry event, which is enough for the next re-offer to rotate.

## B09-02 — rotation, not repetition

`offerHistory` replaces `declinedPartners`: decliners are still excluded outright (asking again is the pressure DLP-11 rules out), and `passes` counts the offers each partner let expire. Dispatch ranks the eligible list by **fewest passes, then nearest**. With two partners in range, an ignored offer goes to the other; with both on one pass, it comes back round to the nearest — a finite pool rotates, it does not strand the order.

## B09-03 — the dispatcher walked, for the first time

Five scenarios on the decision-path order (`orderC`, a real platform delivery at storeA), with two fresh eligible partners online 120 m and 450 m from the store:

| Tick | Asserted |
|---|---|
| T1 | `dispatchPlacedOrder` reserves the attempt; the first offer goes to the nearest partner |
| T2 (+5 min) | The `OFFER_EXPIRED` event names the partner who let it lapse; the re-offer goes to the **other** partner |
| T3 (+10 min) | Both on one pass: the nearest is asked again |
| Decline | The nearest declines; the re-offer goes to the other and not back to the decliner |

Each tick calls `expireOffers` then `offerReadyAssignments` with a distinct command prefix, as the worker does per minute.

**Mutation-proven**, each restored byte-identical:

| Probe | Caught by |
|---|---|
| Ranking reverted to `eligible[0]` | *An expired offer was not rotated to the second partner* — `held.partner_user_id` is the near partner again, which is the field report reproduced |
| Events stop recording the partner | *The expiry event did not record which partner let the offer lapse* |
| Decliners no longer excluded | *A declined attempt was re-offered to the partner who declined it* |

## B09-04 — every customer's pending-decision list was a 500

The stack log that arrived with the report shows `GET /customer/decisions/pending` failing on every orders-page load: *column vo.customer_user_id does not exist*. `listPendingCustomerDecisions` — uncommitted work in the tree, wired to the customer app's poll — joined `vendor_orders` for a column that lives on `checkout_groups`. No substitution or weight proposal had ever reached a customer through it, and **nothing in the ladder called it**: the decision path was verified by answering decisions by id, never by asking what the customer could see.

Fixed with the join the schema actually has. Three assertions on the decision-path order: the customer sees the proposal awaiting them; another customer does not; an answered proposal leaves the list. **Mutation-proven:** dropping the customer scoping fails on *Another customer saw this customer's pending decision*.

## B09-05 — a dropped connection ended the worker

The same log ends with the worker dead: *Connection terminated unexpectedly … Emitted 'error' event on Client instance … Waiting for file changes before restarting.* `createDatabasePool` already listened for idle-client errors on the pool, and the earlier note on it says why. But pg-pool listens on a client only while it is idle — the listener comes off at checkout and goes back on at release — so a hosted pooler closing the socket under a client mid-transaction raised `'error'` on a client nobody was listening to, and an unlistened `'error'` is thrown from `emit`. The tick that was running died with the process.

The pool now attaches a per-client listener on `connect`, which pg-pool does not remove. The statement in flight still rejects to its caller; only the unhandled event is gone. Verified by raising the exact event on a checked-out client (`database_pool_scenarios: 2`, first in the ladder): the process survives and the pool serves again. **Mutation-proven:** removing the listener fails on *A connection error on a checked-out client was unhandled and would end the process*.

Also in that log, unfixed: `Missing lock for job repeat:operations-tick` — the worker's tick overran its queue lock, which against a remote pooler with a failing pass every 15 s is unsurprising, and is recorded rather than tuned.

## B09-06 — confirmed on the reporting environment: the new partner lost to ghosts

With the migrations applied and the worker restarted, the new partner still saw nothing. The read-only diagnostic (`database/scripts/diagnose-dispatch.ts`, run by the operator against that environment) showed why, exactly:

- The new partner (`c884d8cd`) was **a valid candidate**: online, eligible, role active, 3,330 m from the store, free, zero passes.
- The rotation from B09-02 was **working**: the offer had moved `14f2f926 → f5828e75 → 6437e04f → 951e7d24`, five minutes each, each recorded as a pass.
- All four, and six more, were **synthetic partners from an acceptance run on 30 August** — still `ONLINE`, still at the coordinates they had then, 30 m from the store, two weeks later. Ranked by fewest passes then nearest, seven of them stood between the real partner and their first turn; the real partner would have been offered the job once every ~40 minutes.

`ONLINE` was a state a partner set once and nothing ever cleared. Presence was permanent.

**Fix.** Migration 0078 adds `partner_availability.last_seen_at` (backfilled from `updated_at`, the last time each row was touched). Going online sets it; a new `POST /partner/availability/heartbeat` refreshes it — and the device's coordinates — once a minute from both partner apps while online, writing no availability event. Dispatch considers only partners seen within `PRESENCE_WINDOW_SECONDS` (5 minutes), evaluated against the tick's own clock so the ladder is deterministic. **Assumption stated:** five minutes and a one-minute heartbeat are my choice; nothing in the PRD names a window, and a partner whose presence lapses stays `ONLINE` on their own screen — they are simply not offered work until the next beat.

On the reporting environment, applying 0078 removes all ten ghosts from dispatch at once (their `last_seen_at` backfills to 30 August), and the real partner's open tab starts heartbeating on the next interval.

`verify-partner-availability.ts` (now `partner_availability_scenarios: 14`): a partner unseen for longer than the window is absent from dispatch; a heartbeat restores them and carries their position; a heartbeat writes no event; an offline partner cannot heartbeat. **Mutation-proven:** removing the window from `eligible()` fails on *A partner whose presence had lapsed was still offered to dispatch*. The dispatch scenario's ticks now heartbeat both riders first, as the apps do; removing those heartbeats makes the second tick find nobody (`waiting: 1`), which is the dispatcher honouring the window rather than `eligible()` alone.

**Also seen in that output, not fixed here:** three partners at 0 m from the store hold `ACTIVE` memberships on two `ASSIGNED` attempts from 30 August whose orders are still `READY` at acceptance-run stores — the e2e suite has been run against this environment and leaves its state behind. And the diagnostic tool itself is the answer to the "waiting in silence" problem only for an operator with database access; the worker still logs nothing when an attempt finds no candidate.

## B09-07 — the partner got the job and could not mark arrival

With 0078 applied, the offer went to the new partner, they accepted, and *Confirm arrival at the store* returned *"Something went wrong at our end."* The API log: `new row for relation "assignment_events" violates check constraint "assignment_event_command_shape"` — a 500.

The partner console built its command reference as `SYNTH-CMD-${action.replaceAll('-', '_').toUpperCase()}-…`, so `arrive-vendor` became `SYNTH-CMD-ARRIVE_VENDOR-…`. The schema (0014) allows `SYNTH-CMD-` followed by upper-case letters, digits and hyphens only. `accept`, `decline`, `pickup` and `deliver` are single words and worked; **every multi-word step** — arrive at the store, begin the route, arrive at the customer, fail, and all three return steps — has failed from this console since it was written. A partner could take a job and never move it.

It reached the database because the domain's own check was *wider* than the constraint: it accepted `_ . : /` and any prefix. So the reference passed validation, and the refusal came back from PostgreSQL as an internal error instead of from the API as a bad request. The same wide check sat in `partner-wait-policy.ts`, which writes to the same table.

Two more producers had the same defect and had never been exercised: the Android partner app's `SYNTH-ANDROID-…` (every transition), and the admin console's `MANUAL-OFFER-…` (manual dispatch).

**Fix.** Both domain checks now enforce exactly the schema's shape, so a bad reference is a 400. The partner console builds references through one tested function, `transitionCommandReference`, whose spec runs every step the console can send against the schema's pattern; restoring the underscore builder fails it. Android and admin references carry the required prefix. The wait policy's `DELIVERY_FAILED` event now also records the partner (B09-01's column). **Mutation-proven at the domain:** restoring the wide regex fails on *A command reference the schema refuses was not refused as input (raised … violates check constraint "assignment_event_command_shape")* — the field 500, reproduced.

Also noticed, not fixed: the admin console's refund creation sends `provider_operation_reference: SYNTH-REFUND-…`; batch 05 hit `refund_operation_shape` requiring `^SYNTH-REF-…` and it is unclear without a run whether that prefix satisfies the constraint.

## B09-08 — the customer could never open a delivery code

With the handover fixed, the partner reached the customer's door and the console asked for the *Customer's delivery code*. The customer's order card, in state `PICKED_UP`, showed *Collected* and no way to open one.

The card offered the code only when `lifecycle_state === 'OUT_FOR_DELIVERY'` — a phrase from the workflow that no vendor order is ever in. The order's states are `PLACED … READY, PICKED_UP, DELIVERED …` (migrations 0026, 0055); the server issues a delivery code while the assignment is in custody, which is `PICKED_UP` on the order. So the button never rendered for any delivery, and **no platform delivery could be completed from the apps**: DLP-30 requires the code and admits no alternative, and CUS-56 never showed it.

A second, smaller thing on the same card: `PICKED_UP` is labelled *Collected*, which is true of a pickup order and wrong for a delivery the customer is still waiting for. The shared vocabulary already had *On the way* (`state.out_for_delivery`, 0049); the card now uses it for that leg.

**Fix.** `order-code-policy.ts` decides both: a collection code once a pickup order is `READY`; a delivery code once a delivery order is `PICKED_UP`; the delivery leg displayed as `OUT_FOR_DELIVERY`. Its spec walks every state a vendor order can be in for both methods. **Mutation-proven:** restoring the `OUT_FOR_DELIVERY` rule fails it.

Not exercised in a browser: the code button rendering, the code being read into the partner console, and the delivery completing end to end — that is the run in progress on the reporting environment, one step at a time.

## B09-09 — the delivery completed, and the vendor's payouts page crashed

The loop closed on the reporting environment: the order reached `DELIVERED`, the settlement was written, and the first thing the vendor console did with it was throw — `undefined is not an object (evaluating 's.lifecycle_state.toLowerCase')` in `payouts-panel.tsx`.

`vendorStatement` returned raw `settlements.*` rows: bigint strings under the table's own column names. The typed contract (`VendorStatement`) and the console both expect a projection — `reference`, `lifecycle_state`, `gross_minor`, `platform_fee_minor`, `net_minor`, plus pending/eligible/settled totals. The page had only ever rendered an empty statement. `partnerStatement` had the same defect (`PartnerEarningEntry` expects `reference`, `lifecycle_state`, `total_minor`, `posted_at`; it returned `net_minor`, `outcome` and friends), so the partner's earnings page would have crashed the moment they opened it — and its query joined *every* settlement of the partner to *every* earning, so a rider with two deliveries would have seen each earning twice.

Batch 05 asserted both statements and missed this, because its assertions cast the rows to whatever they wanted to check: *"returns settlements for their own location"* was true of the raw rows too. `verify-api-contracts.mjs` checks that client paths exist, not that responses have the declared fields. A statement of the wrong shape passed every gate.

**Fix.** Both services now return exactly the declared shape. Vendor: gross is what the goods sold for after refunds, fee the platform's share, net the vendor's — and the ladder asserts net and fee against the settlement row, that gross − fee = net, and that the three totals add up to the entries. Partner: the earning under its order reference, `EARNED` until a payout says otherwise, totals following from the entries, the payout found through the earning's own order. **Mutation-proven:** gross without the fee fails on *The vendor statement does not reconcile to the settlement*; a zeroed partner total fails on *The partner statement did not report the earning the ledger holds*. The duplicate-join fix has no fixture with two settlements for one partner and is recorded as untested.

**The general finding** is the one that matters for the rest of this audit: a `readonly { … }` cast in a verifier is a hole the size of the contract. Every statement-shaped assertion in the ladder should read the contract type, not invent one.

## Environment note — this could not be confirmed where it happened

The running API and worker are started with `--env-file=infrastructure/supabase-production/.env`: the stack behind these screenshots is the **Supabase production project**, not the local container. A read-only diagnosis against it was not run — reading that environment from this session was declined, and rightly; the mechanism above is established from the code and reproduced in the ladder, not observed live.

Two consequences the operator needs to act on:

1. **Migrations 0075–0077 are not applied there, and the log proves it.** The worker on that environment logged *column "partner_user_id" of relation "assignment_events" does not exist* on every 15-second tick from the moment 0077's code hot-reloaded — so offer expiry and re-dispatch have not run there since. The API and worker hot-reload source; until the migrations are applied, the partner's *Show my pickup code* and every assignment transition will fail on that environment, and the rotation in B09-02 cannot happen. This batch made that environment's dispatch worse until the migration lands, and that is stated here rather than softened. `pnpm --filter @neighbourhood-store/database migration:supabase-production:status` shows the gap; `…:up` applies it behind `SUPABASE_PRODUCTION_MIGRATION_CONFIRM`. Applying a remote migration is the operator's decision and was not taken here.
2. **Whether the new partner is in range is unknown.** Eligibility needs the partner's recorded coordinates within 5 km of the store's. The partner PWA sends the browser's real location when permitted, else a fixed Jaipur point. `GET admin/delivery/eligible-partners/:vendor_location_id` — the admin console's order-intervention panel — lists exactly the candidates dispatch sees, with distance. If the new partner is not on it, no rotation will reach them.

## Verification

| Check | Result |
|---|---|
| `pnpm db:verify` | exit 0 — 78 migrations, 28 modules, `vendor_fulfilment_scenarios` 60 → 70, `assignment_custody_scenarios` 11 → 12, `database_pool_scenarios` 2 (new), `partner_availability_scenarios` 14 (now recorded) |
| Migrations 0077, 0078 down → up | Reverted and re-applied cleanly against the test target |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` | exit 0 |
| `pnpm test:unit` | 472 pass / 0 fail |

## Still open

- **The worker logs nothing when an attempt finds no candidate.** `waiting` is not part of the tick's change count, so a job nobody can be offered is invisible in the log; the diagnostic script is the only view, and it needs database access.
- **The partner is told nothing when their presence has lapsed** — their screen still says online.
- **The partner is told nothing when out of range.** *"Stay online — new offers arrive here on their own"* is shown to a partner whom dispatch will never consider. The availability summary could carry what dispatch knows; it does not yet.
- **The vendor is told nothing about how long an offer has left.** The chip says *Offered* without the five-minute window.
- **Dispatch has one candidate order: distance.** Vehicle, capacity, safety rules and route (workflow 6.7.1) are not consulted.
- **The tick's queue lock** is lost when a pass runs long against a remote pooler (`Missing lock for job repeat:operations-tick`); lock duration and pass timeouts are untuned.
- Confirmation on the reporting environment, once its migrations are applied and the worker is restarted — it is currently stopped, waiting for a file change.
