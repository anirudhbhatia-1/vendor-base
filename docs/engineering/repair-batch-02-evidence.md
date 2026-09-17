# Repair batch 02 — enrolment against a real database, and the duplicate-grant race

**Implemented:** 7 September 2026. **Verification level:** domain/transaction behaviour against a real containerised PostgreSQL/PostGIS instance; not connected staging acceptance, and not an HTTP or browser journey.

This takes item 1 from [batch 01's next unaccepted work](repair-batch-01-evidence.md) — *"Run G01 on an explicitly isolated PostgreSQL/PostGIS target … Review the new lock order under concurrency"* — and completes the part that can be proven at the database layer. It does not complete G01. No shared database, remote target, provider or credential was touched; the isolated target is the local `db:test:up` container, which is created and destroyed per run.

## Why this batch existed

`customer-enrolment.spec.ts` covers the enrolment module with a `PoolClient` test double. That is the right tool for branch coverage, and batch 01 used it well. It cannot observe the two properties that decide whether the new transactional enrolment is actually safe:

- that a rollback really discards the role grant **and** its membership audit event;
- that two concurrent first-time enrolments cannot both insert.

A stub returns whatever it was told to return, so it can never fail the way a race fails.

`database/scripts/verify-customer-enrolment.ts` is new and joins the connected ladder as module 28, run by `pnpm db:verify` against the real schema with all 70 migrations applied.

## Findings

### B02-01 — nothing in the schema forbade a duplicate active role grant

`role_assignments_user_active` (migration 0008) is a **plain** partial index, not a unique one. The invariant "one active assignment per identity and role" was held only by serialization inside application code — an advisory lock plus two `FOR UPDATE` reads in `customer-enrolment.ts`.

Of the six modules that insert into `role_assignments`, **three take no lock at all**: `vendor-onboarding.ts`, `partner-lifecycle.ts` and `admin-onboarding.ts`. Only `identity-access.ts` and `customer-enrolment.ts` do.

This was not theoretical. An instrumented standalone race against this schema, with the serialization removed, produced **three active CUSTOMER grants for one person**:

```
t+ 140ms tx1 BEGIN   t+ 154ms tx1 read -> 0 rows   t+ 195ms tx1 INSERT
t+ 143ms tx2 BEGIN   t+ 166ms tx2 read -> 0 rows   t+ 217ms tx2 INSERT
t+ 142ms tx3 BEGIN   t+ 166ms tx3 read -> 0 rows   t+ 215ms tx3 INSERT
RESULT: 3 assignment rows for one user
```

**Fix:** migration `0070_role_assignment_single_active` adds a partial unique index over `(user_id, role_key) WHERE state = 'ACTIVE'`. Revoked and superseded rows are unaffected, so an identity may still hold any number of historical assignments for the same role. The constraint holds whichever path writes and whether or not that path remembered to take a lock. Down/up round trip verified.

Mutation-proven: weakening the migration to a non-unique index turns the ladder red with *"The schema accepted a second active CUSTOMER assignment for one identity"*.

### B02-02 — the concurrency test is not a reliable test, and is labelled as such

This is the more important finding, because it nearly produced a false pass.

The first version of the race assertion passed with the advisory lock removed, then passed with `users FOR UPDATE` removed, then passed with **all serialization removed** — while the standalone diagnostic using the same function produced three duplicate rows. The assertion looked like proof and proved nothing.

Two distinct causes, both timing:

1. **Connections open lazily and serially.** The pool established tx1's connection ~40 ms before tx2 and tx3, so tx1 had already committed before the others issued their first read. They observed its row instead of racing it. Pre-warming the connections with `Promise.all([pool.connect(), …])` before any transaction begins fixes this — and with it, the standalone race produces the three duplicate rows above.
2. **Even pre-warmed, the race is not sensitive inside this verifier's sequence.** With all serialization removed, the same code produces three rows when run standalone and one row when run after the verifier's earlier transactions, because the transactions no longer overlap tightly enough:

```
RACE t+42ms tx1 BEGIN   RACE t+48ms tx1 enrol returned
RACE t+44ms tx2 BEGIN   RACE t+74ms tx2 enrol returned
RACE t+44ms tx3 BEGIN   RACE t+74ms tx3 enrol returned
```

A test whose sensitivity depends on what ran before it cannot carry an invariant. The race is retained as a smoke check with that stated in the code, and the invariant is carried by the schema constraint in B02-01 instead, which is deterministic and mutation-proven.

**The general lesson, which applies beyond this file:** a concurrency test that has never been observed to fail is not evidence of a working lock. It has to be shown failing with the protection removed, in the exact context it will run in — not in isolation, and not once.

### B02-03 — `verify-messaging-lifecycle.ts` has a flaky assertion

During this batch, `pnpm db:verify` failed once with *"Inbox deduplication did not preserve exactly one database effect"* ([verify-messaging-lifecycle.ts:323](../../database/scripts/verify-messaging-lifecycle.ts#L323)), then passed on an immediate re-run with identical code. The assertion covers concurrent inbox receipt processing.

It is recorded rather than fixed: I did not reproduce it a second time and will not claim a diagnosis I do not have. A flaky assertion in the connected ladder is a real problem — it trains readers to re-run until green, which is exactly how a genuine concurrency regression would be missed. It should be characterised before the ladder is used as a release gate.

## What the new verifier asserts

Fifteen scenarios against the real database:

| Group | Assertions |
|---|---|
| First enrolment | Grants the role; writes exactly one `ROLE_GRANTED` membership event bound to that assignment |
| Repeat login | Returns the same assignment id; inserts nothing |
| Rollback | A rolled-back transaction leaves no assignment **and** no orphaned membership event |
| Concurrency | Three pre-warmed concurrent enrolments yield one active assignment (smoke check, see B02-01) |
| Schema constraint | A second active CUSTOMER assignment is refused with SQLSTATE `23505` |
| Not a restoration authority | Revoked, expired and not-yet-valid assignments are each refused, and no second row is written |
| Disabled identity | Refused, with no grant |
| Escalation | No role other than CUSTOMER appears for any identity touched by this path |

## Two errors of my own, recorded because they were nearly invisible

- The revoked-role fixture violated `role_assignment_revocation_shape`, which requires a revoked row to carry both a revocation time and an uppercase reason code. The schema caught it; the fixture now looks like a real revocation.
- The denied-case assertions counted rows with `state = 'ACTIVE'`, but an expired or not-yet-valid assignment **is** state ACTIVE — the helper was counting the seeded row and could not tell a refused enrolment from the row it refused over. They now count all rows for the identity and assert no second row appeared.

## Verification

| Check | Result |
|---|---|
| `pnpm db:verify` | exit 0 — 70 migrations, 28 modules, `customer_enrolment_scenarios: 15` |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` | exit 0 |
| `pnpm test:unit` | 464 pass / 0 fail |
| Migration 0070 down → up round trip | Applied and reverted cleanly against the test target |

## Still open from batch 01 item 1

G01 is **not** complete. The database layer is done; these need the HTTP/BFF and client layers and are untouched here:

- **Lost response** — a committed enrolment whose response never reaches the browser.
- **Refresh replay and multi-tab** — token rotation under concurrent tabs; batch 01 already records distributed refresh coordination as open.
- **Access denial end to end** — the 403-vs-401 separation is asserted at the domain layer here, not through the BFF.

Items 2–6 of batch 01's list (browser and Android runs, R0 cold start and broker health, the partner 404 diagnosis, R12 acceptance fixtures, and the cross-role loop) are untouched by this batch.
