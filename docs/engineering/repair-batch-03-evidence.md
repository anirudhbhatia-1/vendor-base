# Repair batch 03 — broker and consumer health, and what CI could never have run

**Implemented:** 8 September 2026. **Verification level:** running API and worker processes against a real PostgreSQL and a real Valkey; not staging, and not a full dev-stack cold start.

This takes item 3 from [batch 01's next unaccepted work](repair-batch-01-evidence.md) — *"Perform R0 cold start/stop, migration/effective-role and Valkey/consumer health checks; health-table presence is still not broker health"* — and completes the health half. It does not complete R0.

## The defect, confirmed

`/health/ready` derived `checks.queue` from `to_regclass('marketplace.scheduled_jobs')` and `to_regclass('marketplace.outbox_events')`. That is the presence of two PostgreSQL tables — a migration question — reported under a name that reads as "the queue works". A deployment with Valkey stopped and **no worker running at all** answered `queue: 'ready'`, so nothing downstream could tell that jobs were piling up unclaimed.

The worker's heartbeat was a `setInterval` writing `worker.heartbeat` to its own stdout every 30 seconds. Nothing outside that process could read it, so the API had no way to answer "is anything consuming these queues". A log line is not evidence a consumer exists.

## What changed

**Migration `0071_worker_liveness`** adds `marketplace.worker_heartbeats`: worker id, component, queues, environment, version, `started_at`, `last_seen_at`, `stopped_at`. Upserted in place by worker id. Deliberately not append-only and deliberately without `retention_class` — this is operational liveness, not user data, and `unclassified_retention_rows()` sweeps only tables that declare the column, so it is correctly outside that scope. Down/up round trip verified; declared in `database/schema.ts` as the schema-parity control requires.

**The worker** now writes that heartbeat on ready and on each interval, and marks `stopped_at` on graceful shutdown so a deliberate stop is distinguishable from a worker that vanished mid-job. A failed heartbeat write is logged and swallowed: losing the liveness record must not take down a worker that is otherwise processing jobs correctly.

**`/health/ready`** now reports four separate things:

| Field | Answers | Source |
|---|---|---|
| `checks.database` | Can this process reach PostgreSQL | Connection |
| `checks.job_schema` | Are the job tables installed | `to_regclass` — renamed from `queue`, which is all it ever meant |
| `async_processing.broker` | Is Valkey reachable | A real connection and `PING` |
| `async_processing.workers`, `live_worker_count` | Is anything consuming | Durable heartbeat, 90s freshness window |
| `async_processing.oldest_pending_job_age_seconds` | Is the pipeline draining | Oldest due `SCHEDULED` job |

`unauthenticated` is a distinct broker state from `unreachable`: a broker answering "you are not authenticated" is running and speaking the protocol, and conflating the two sends operators to restart a service that is up.

**Async health does not decide the HTTP status, and that is deliberate.** Orchestrators remove a 503 pod from rotation. Failing readiness on a background-processing outage would take the entire API offline for a fault that leaves every synchronous request working — and would remove the very capacity needed to drain the backlog once the broker returns. 503 stays reserved for this process being unable to serve. The outage is now *visible* rather than hidden behind `queue: 'ready'`, which was the actual problem.

The broker check opens a short-lived connection per probe. A retained client would either retry for ever against a stopped broker — the unbounded `ECONNREFUSED` stream that the worker's `queue-readiness.ts` exists to suppress — or, with retries disabled, stay dead after the first failure and report a recovered broker as still down.

## Findings beyond the stated scope

### B03-01 — `test:integration` had not been run since my own earlier change broke it

Both smokes failed immediately on *"The filesystem object-storage adapter is local-only and cannot serve the online-test environment"*, thrown by the object-storage gate added in run 2 of the phase audit. Their online-test blocks assert that a **knowingly synthetic** configuration is accepted, but did not carry the acknowledgement and injected secret material that non-local environments now require. Both now set `ALLOW_SYNTHETIC_PROVIDERS=synthetic-testing-only` and synthetic stand-ins for the four secrets, which is exactly what the gate was built to demand.

This is my own regression, and it sat undetected because nothing ran the suite that would have caught it. Recorded rather than quietly fixed.

### B03-02 — CI declares no PostgreSQL and no Valkey, while the gate requires integration tests

`.github/workflows/ci.yml` provisioned no service containers and no test stack, yet `ci-evidence.mjs` treats `integration_tests` as a required outcome and fails closed on a missing one. The API smoke asserts `/health/ready` returns `ready`, which needs a database. **That step could not have passed in CI as written** — consistent with the workflow never having been executed.

The workflow now starts the test stack before integration tests and stops it afterwards with `if: always()`. The alternative — letting the smoke skip its own assertions when the stack is absent — is precisely the pattern the repair plan condemns, and precisely how queue health came to be reported from table presence.

Note that `pnpm check` locally also runs `test:integration` without starting the stack; it now requires `pnpm db:test:up` first, for the database as much as the broker.

### B03-04 — `pnpm -r test:integration` runs package smokes in parallel

The API smoke first asserted that no worker was live, which passed alone and failed in the aggregate run: the worker's own smoke had one running at the same time. The assertion was wrong, not the code.

It now checks that consumer state agrees with the count it derives from — `ready` if and only if `live_worker_count > 0` — which is the property that actually matters (readiness must never claim a consumer it cannot count) and is true whether or not something else is running. It still catches the mutation that forces `workers: 'ready'`, now reporting *"Readiness reported workers=ready with live_worker_count=0"*.

Any cross-package assertion of the form "nothing else is running" is unsafe here.

### B03-03 — the worker smoke resolved a different environment than the worker it starts

The script spawns its child with `APP_ENV=test` but its own process never had it set, so my first database assertions connected to the **local** database on 5432 while the worker wrote to the **test** database on 5433. The symptom was `relation "marketplace.worker_heartbeats" does not exist` — indistinguishable from an unapplied migration, and I initially chased it as one. The connection string is now resolved under the same environment the child receives.

## Verification

| Check | Result |
|---|---|
| `pnpm db:verify` | exit 0 — 71 migrations, 28 modules |
| `pnpm test:integration` | exit 0 — API and worker smokes against a live PostgreSQL and Valkey |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` | exit 0 |
| `pnpm test:unit` | 464 pass / 0 fail |
| Migration 0071 down → up | Applied and reverted cleanly |

**Mutation probes, each restored and confirmed byte-identical:**

| Probe | Caught by |
|---|---|
| Unreachable broker reported as ready | *An unreachable broker was reported as ready* |
| Consumer check always claims a live worker | *Readiness reported workers=ready with live_worker_count=0* |
| Worker writes no durable heartbeat | *A running worker recorded no durable liveness, so readiness cannot see it* |
| Canary event type left unhandled | *The queue canary was not consumed (status DEAD_LETTER)* |

A fourth probe exited 2 on a TypeScript error before reaching any assertion and was rewritten rather than counted — the same rule as batch 02: a probe that fails before its assertion runs proves nothing.

## The queue canary

A broker `PING` proves the broker answers and a heartbeat proves a worker is alive. Neither shows that a job enqueued *now* gets consumed, so the worker smoke ends with a real round trip: an outbox event of type `ops.queue_canary`, which reacts to nothing, travelling the whole path — outbox row, dispatch, Valkey, worker, acknowledgement — asserted to reach `PUBLISHED` within a bounded window.

It satisfies every constraint on that path rather than bypassing any of them, which is what makes it a fair test: `outbox_transition_fk` requires a real aggregate transition, which in turn requires an aggregate head, so the canary writes both.

Mutation-proven: removing `ops.queue_canary` from the handled set turns the run red with *"The queue canary was not consumed (status DEAD_LETTER)"* — and the status in that message distinguishes a job that was rejected from one that was merely never picked up.

**It cannot clean up after itself, and says so.** `outbox_events` is append-only — deleting one raises *"messaging history is append-only"* from the guard in migration 0066 — so a canary that travels the real event path cannot delete its own rows. My first version wrapped the deletes in `.catch(() => undefined)`, which would have swallowed that failure and looked tidy: the same shape as the false-empty proof queue this repair plan exists to fix. Instead the canary refuses to run unless the connection string is the disposable test database, and cleanup is satisfied by `db:test:up` / `db:test:down` destroying that database around the run.

### Three wrong diagnoses on the way there, all mine

- **UUIDv7, not UUID.** The canary used `randomUUID()`, which returns a v4. Every identifier on this path is parsed as UUIDv7, so the handler rejected the job and the row sat in `PUBLISHING` — indistinguishable from a stalled queue, and I first read it as one.
- **A 30-second window inside a 15-second tick.** `operations.tick` fires every `POLL_MS` and a poll runs a long sequence of passes before dispatch, so the claim landed about two seconds after I gave up. Widened to clear several ticks.
- **A failed run poisoned the next.** Because cleanup could not run, a stuck row from one attempt was still present for the following one, and I read the leftover as a fresh failure.

## Still open from item 3

- **Effective database role and grants.** Batch 01's preflight states plainly that it does not establish effective grants, and this batch does not either. It needs an authorized read-only check against a real target.
- **Full dev-stack cold start/stop.** The smokes start and stop the API and the worker individually and assert graceful shutdown, including the durable stopped marker. R0.4's scoped watcher — one command from cold, stopping only owned processes, releasing owned ports — is untested, and needs the dev stack rather than the test containers.
