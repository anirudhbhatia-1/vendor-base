# Repair batch 06 — the two flaky assertions, diagnosed and fixed

**Implemented:** 8 September 2026. **Verification level:** both defects reproduced, explained from source and schema, fixed, and the fix measured where the module allows repetition.

Batches 02 and 05 each recorded a ladder assertion that failed once and passed on an immediate re-run. Two is enough to matter: `pnpm db:verify` is the gate every batch in this audit has leaned on, and a gate that goes red at random teaches its readers to re-run until green — which is exactly how a real regression passes unnoticed.

Both turned out to be the same defect in different clothes: **a test that races two things and then asserts on a property only one of the outcomes satisfies.**

## B06-01 — inbox deduplication (`verify-messaging-lifecycle.ts`)

Two `processInboxEvent` calls run concurrently for the same event and consumer scope, and exactly one must win. That part works. The handlers, however, were not equivalent:

- one incremented the counter **and inserted a row** into `inbox_effects`;
- the other incremented the counter and returned a marker, writing nothing.

Deduplication holds whichever wins, but the assertion checked `effect_count = 1`. When the non-writing handler won, the count was zero and the suite reported a broken inbox.

**Measured, not inferred.** Running the module standalone in a loop: **6 of 8 passed** before the change, failing with the recorded message.

**Fix:** make both handlers do the same thing. The assertion then means what it says — one effect exists because exactly one processor ran, whichever it was.

**After the fix: 36 of 36 passed.** At the observed ~25% failure rate, 36 consecutive passes by chance is about 0.003%.

## B06-02 — invalid lifecycle jump (`verify-configuration-lifecycle.ts`)

The test schedules two configuration versions concurrently over an overlapping window, asserts exactly one wins, and then attempts a direct `UPDATE ... SET status = 'ACTIVE'` on **`secondScheduled`**, expecting SQLSTATE `23514`.

Whether that update is refused depends entirely on the row's status, and its status depends on who won the race. Migration 0005's trigger lists the permitted transitions, and `SCHEDULED → ACTIVE` **is one of them**.

Proven directly against the schema with a throwaway probe rather than argued from reading:

```
from APPROVED  -> REFUSED(23514)
from SCHEDULED -> ACCEPTED
```

So when the second version won the schedule race it became SCHEDULED, the update was legitimately accepted, and the assertion reported the database accepting an invalid jump. The first-issued schedule usually wins, which is why this failed only occasionally — the worst kind of red, rare enough to read as noise.

**Fix:** perform the jump on a version that never enters the race and is therefore APPROVED deterministically. The coin flip is removed by construction rather than made less likely, so no amount of re-running is needed to demonstrate its absence.

This module leaves state behind and is not re-runnable in-process, so it has no loop measurement; the probe above is the evidence for the mechanism.

## A note on the second diagnosis

My first clean-database run of the fixed configuration module failed on an unrelated assertion — *"Configuration draft did not start at version one"*. That was my own doing: the loop experiments had left data in the shared test container, and `db:verify` reuses a running container rather than insisting on a fresh one. Tearing the stack down first made it green.

Worth recording as a property of the harness, not just my mistake: **`pnpm db:verify` does not guarantee a clean database.** If a container is already running, it is reused with whatever state it holds. Any verifier that assumes a fresh schema — several assert "version one" or "exactly one row" — can fail for reasons that have nothing to do with the code under test.

## Verification

| Check | Result |
|---|---|
| `pnpm db:verify` (clean container) | exit 0 — 71 migrations, 28 modules |
| Messaging module, standalone loop | 6/8 before, **36/36 after** |
| Configuration transition, direct probe | `APPROVED → ACTIVE` refused 23514; `SCHEDULED → ACTIVE` accepted |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` | exit 0 |
| `pnpm test:unit` | 464 pass / 0 fail |

## Still open

- **No other flaky assertion is ruled out.** Two were found because they happened to fail in front of me. Nothing has systematically looked for others, and the cheapest way to would be repeated full-ladder runs recording which assertions fail — worth doing before the ladder is treated as a release gate.
- **`db:verify` container reuse** is unchanged. Making it insist on a fresh database, or having verifiers assert their own preconditions, would remove a whole class of confusing failures.
