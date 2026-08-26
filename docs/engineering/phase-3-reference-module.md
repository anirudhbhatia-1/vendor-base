# Phase 3 Reference Module

**Status:** Phase 3 exit gate verified locally  
**Scope:** Synthetic company development only  
**Production authority:** None

The `reference_submission` module is a deliberately small synthetic vertical slice. It proves the Phase 3 foundations cooperate under one request and correlation identity before Phase 4 introduces real identity and authorization boundaries. It is verification infrastructure, not a customer, order, payment, or production API.

## Successful flow

```text
authenticated synthetic request context
  → idempotent reference.submit command
  → one transaction:
      aggregate SUBMITTED version 1
      effective configuration snapshot
      reference.submission_created outbox event
      attributable transition history
  → bounded outbox dispatch
  → inbox receipt and durable job schedule in one worker transaction
  → bounded job claim
  → idempotent SUBMITTED → PROCESSED version 2 transition
  → queue metrics and correlated evidence query
```

The module uses the active server-side `reference.processing_enabled` feature flag. Disabled or changed configuration cannot silently create the aggregate. The effective configuration version is retained with the business record before the outbox event commits.

## Idempotency and transaction boundary

`executeReferenceSubmission` accepts a validated request context, authenticated synthetic customer actor, opaque idempotency key, caller-selected UUIDv7 aggregate ID, and explicitly synthetic bounded body. Repeating the same command returns the original `201` body without creating another aggregate or outbox event.

Aggregate creation now supports the same optional transaction callback as aggregate transitions. The reference callback snapshots configuration and enqueues the outbox event before transition history is appended. PostgreSQL commits all four records together. A deliberate callback failure proves the aggregate head, transition, snapshot, and outbox work roll back rather than leaving partial state.

## Worker consumption and durable job

`dispatchReferenceEvents` claims the outbox event and processes it through the inbox boundary. The inbox handler schedules `reference.process_submission` using the outbox event ID as its scheduling idempotency key. Inbox receipt and job schedule commit together.

`runReferenceJobs` claims the durable job and performs the expected-version transition. If an at-least-once replay observes that the same aggregate is already `PROCESSED`, it treats that exact terminal state as success; other conflicts remain failures and follow bounded job retry/dead-letter handling.

No BullMQ/Valkey service is required for this proof. PostgreSQL remains authoritative; a future queue adapter may only wake and distribute work.

## Correlation and metrics

`readReferenceEvidence` checks the request ID and correlation ID across:

- the idempotency record;
- aggregate creation and processing transitions;
- the outbox event;
- the inbox receipt; and
- the durable scheduled job.

It also reports the final aggregate state/version, exact record counts, configuration snapshot count, and Phase 3.6 queue metrics. This provides audit correlation without creating a premature general-purpose production audit API.

## Exit-gate verification

`pnpm db:verify` proves five integrated scenarios:

1. exact idempotent command replay;
2. atomic aggregate, configuration snapshot, transition, and outbox creation;
3. inbox-deduplicated worker consumption and durable job completion;
4. one winner and one stable `VERSION_CONFLICT` from simultaneous edits; and
5. complete rollback under a deliberate transaction failure.

The successful path must contain one idempotency record, two transitions, one outbox event, one inbox receipt, one job, one configuration snapshot, successful throughput, zero failed attempts, and matching request/correlation evidence.

## Boundary after Phase 3

The Phase 3 engineering exit gate is complete locally. The reference module is not connected to NestJS routes, client applications, external providers, cloud services, or real data. Phase 4 must establish OTP challenges, sessions, roles, capabilities, privacy boundaries, and authorization before real domain endpoints reuse this foundation.
