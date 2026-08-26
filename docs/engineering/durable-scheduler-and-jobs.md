# Durable Scheduler and Jobs

**Scope:** Phase 3.6 local company development with synthetic data only  
**Production authority:** None

The database package provides a durable scheduled-work boundary for later domain workers. PostgreSQL is the source of truth for schedule, ownership, attempt history, retry timing, terminal failure, and operator recovery. A process restart cannot silently lose accepted work.

## Scheduling and deduplication

`scheduleDurableJob` creates a job with a UUIDv7 identifier, stable dotted queue scope and job type, opaque idempotency key, JSON payload, request/correlation/causation context, priority, execution time, and maximum attempt count.

The unique `(queue_scope, idempotency_key)` boundary makes scheduling replay-safe. Repeating the same key and immutable schedule content returns the original job ID. Reusing the key with a different type, payload, priority, attempt policy, or execution time returns `IDEMPOTENCY_KEY_REUSED`.

Scheduling should participate in the same PostgreSQL transaction as the business change that requires the job. The lifecycle proof confirms that rolling back that transaction also removes the schedule.

## Safe ownership and attempts

`claimDurableJobs` claims due work in priority order using `FOR UPDATE SKIP LOCKED`. Batch size is limited to 1–100 and ownership leases are limited to one second through five minutes. Concurrent workers therefore receive disjoint bounded batches.

Every successful claim increments the lifetime attempt number and inserts a `RUNNING` attempt record in the same transaction. Completion closes that exact attempt as one of:

- `SUCCEEDED`;
- `RETRY_SCHEDULED`, with a safe error code and next attempt time;
- `DEAD_LETTER`, after the attempt allowance is exhausted; or
- `LEASE_EXPIRED`, when a later claimant detects abandoned ownership.

A stale worker cannot complete a job after losing ownership. Job identity and content cannot be updated, scheduled jobs cannot be deleted, and completed attempt/recovery history is append-only.

## Retry and handler contract

`runDurableJobBatch` claims a bounded batch, invokes the caller's handler, and records each outcome. Retry delay uses capped exponential backoff. Defaults begin at one second, cap at fifteen minutes, and allow eight attempts; callers may tighten those bounds.

Only a classified stable error code is persisted. Raw exception text, credentials, provider responses, OTPs, and unnecessary protected data must never enter job state.

Delivery is at least once. A handler may finish an external side effect and lose its claim before recording success. Every handler must therefore use the Phase 3.3 idempotent-command boundary, the Phase 3.5 inbox receipt boundary, a provider idempotency key, or another transactionally enforced domain deduplication key. Scheduling deduplication alone does not make execution idempotent.

## Dead letters and recovery

`listDeadLetterJobs` returns a bounded operational view containing job metadata and safe terminal error codes. `recoverDeadLetterJob` accepts only a current dead letter, adds a bounded attempt allowance, resets it to scheduled state, and appends actor ID, request ID, reason code, previous lifetime attempt count, and added allowance to immutable recovery history.

Recovery does not reset or rewrite attempt numbers. Operators can therefore distinguish a first execution from work that succeeded only after intervention.

## Queue metrics

`readJobQueueMetrics` reports, per queue scope:

- scheduled, ready, running, and dead-letter counts;
- age in seconds of the oldest ready job;
- successful completions in the last hour;
- failed attempts in the last hour; and
- recoveries in the last hour.

These are database-derived operational signals, not a complete observability platform. Later worker modules will export them through the approved metrics adapter and add alert thresholds.

## Verification

`pnpm db:verify` proves against the disposable PostgreSQL/PostGIS service:

1. transactional schedule rollback;
2. idempotent schedule replay and changed-content rejection;
3. concurrent, bounded, non-overlapping claims and expired-lease recovery;
4. classified retry timing followed by success;
5. retry exhaustion, dead-letter listing, attributable recovery, and eventual success;
6. queue age, throughput, failure, and recovery metrics; and
7. immutable job content and append-only history.

It also verifies independent migration rollback/reapply and rebuild from zero. The disposable container is removed after the run.

## Current integration boundary

No product job types, external queue, provider, or always-running scheduler are active. BullMQ/Valkey can later be used as a wake-up and distribution adapter, but PostgreSQL remains the durable authority described here. Phase 3.7 now adds scoped versioned configuration and feature flags; domain phases will register concrete idempotent handlers.
