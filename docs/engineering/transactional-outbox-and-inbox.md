# Transactional Outbox and Inbox

**Scope:** Phase 3.5 local company development with synthetic data only  
**Production authority:** None

The database package implements durable at-least-once event delivery with deduplicated consumer database effects. Domain changes and their outbox events share one PostgreSQL transaction. Consumers commit an inbox receipt in the same transaction as their local database mutation.

## Transactional event creation

Domain modules call `enqueueOutboxEvent` from the transaction callback supplied to `transitionAggregate`. The outbox row references the aggregate transition through a deferred foreign key, allowing the event to be inserted before the transition history row while requiring both to exist at commit.

If the business mutation, transition append or event insert fails, the entire transaction rolls back. A worker can therefore never observe an event for business state that did not commit.

Each immutable event records its UUIDv7 event and aggregate identifiers, aggregate version, dotted event type, JSON payload, request/correlation/causation context, attempt policy and operational delivery state. Payloads contain domain facts and safe references, never secrets, credentials, OTPs or unnecessary protected data.

## Bounded claiming and delivery

`claimOutboxBatch` selects only committed, available work using `FOR UPDATE SKIP LOCKED`. Batch size is restricted to 1–100 and claims have bounded leases. Concurrent workers therefore receive disjoint batches without a global queue lock.

`dispatchOutboxBatch` publishes each claimed event and records one of these outcomes:

- `PUBLISHED`: dispatch completed;
- `PENDING`: the safe classified failure code is stored and the event is scheduled with capped exponential backoff;
- `DEAD_LETTER`: maximum attempts or expired claim leases were exhausted; or
- lost claim: another worker owns recovery, so the stale worker cannot overwrite its state.

Raw exception messages are never persisted. Publication is intentionally at least once: a worker can crash after publishing but before recording success. Event IDs and inbox receipts make that replay safe.

## Inbox deduplication

`processInboxEvent` inserts a receipt keyed by `(consumer_scope, event_id)` before invoking the consumer. The receipt, consumer handler's database writes and final `PROCESSED` state share one transaction.

Concurrent delivery of the same event makes one transaction the processor. Other deliveries return `processed: false` without invoking their handler. A handler failure rolls back both its database changes and receipt so the queue can retry.

Consumer scope is part of the key because independent consumers must each process the same event once. Inbox deduplication does not replace domain authorization or transition validation.

## Dead letters and recovery

`listDeadLetterEvents` exposes a bounded operational list containing safe error codes and event metadata. `recoverDeadLetterEvent` accepts only a current `DEAD_LETTER`, resets it to dispatchable state, and appends actor ID, request ID, reason code and previous attempt count to immutable recovery history.

Direct deletion of outbox events is rejected. Event identity, payload and correlation content cannot be updated. Inbox receipts and recovery history allow only their controlled state transition and otherwise reject updates/deletes.

## Verification

`pnpm db:verify` proves:

1. business rollback also removes its outbox event;
2. committed transitions expose their event;
3. concurrent workers claim disjoint bounded batches;
4. publish failure schedules capped retry and then dead-letters;
5. attributable recovery returns a dead letter to successful dispatch; and
6. concurrent inbox delivery produces one receipt and one database effect.

The lifecycle also verifies immutable content, deletion protection, migration rollback/reapply and rebuild from zero. It uses only the disposable PostgreSQL/PostGIS test service.

## Current integration boundary

No external broker or provider is active. Later workers will adapt `publish` to BullMQ or a provider-specific dispatcher and will retain the event ID as the downstream deduplication key. Phase 3.6 now provides durable scheduled jobs, ownership, retry metrics and recovery controls above this foundation.
