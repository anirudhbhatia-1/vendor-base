# Aggregate Versioning and Transition Records

**Scope:** Phase 3.4 local company development with synthetic data only  
**Production authority:** None

The database package provides a shared optimistic-concurrency boundary for domain aggregates. A compact head row stores the current integer version and state. A separate append-only table preserves creation and every accepted state transition with its actor, reason, evidence and request correlation.

## Aggregate policy

Each domain module defines a policy with:

- a stable lowercase aggregate type;
- the complete set of uppercase states;
- permitted initial states and creation actors;
- allowed `from_state` to `to_state` edges;
- allowed actor kinds for each edge;
- whether a reason is forbidden, optional or required; and
- the evidence keys required for the transition.

`defineAggregatePolicy` validates and freezes this definition. It rejects duplicate or undeclared states, duplicate edges, unsafe identifiers, empty actor lists and unsafe evidence-key names. Policy checks complement authorization: a permitted actor kind does not establish ownership, membership or scope. Domain modules must perform those checks before invoking the transition.

## Creation and expected-version edits

`createVersionedAggregate` creates version `1` and an attributable creation record in one transaction. Its optional mutation callback runs before history is appended so related rows and outbox work share that commit. `transitionAggregate` requires the version last observed by the caller. A successful transition atomically:

1. verifies the current version and state;
2. verifies the policy's actor, reason and evidence requirements;
3. conditionally advances the head to `expected_version + 1`;
4. runs the domain module's optional database mutation callback; and
5. appends the transition record.

Any failure rolls back the head, domain mutation and history record together. If another request wins first, the loser receives `AggregateVersionConflictError` with stable code `VERSION_CONFLICT`, current version and current state. It never overwrites the winner.

## Attribution and history

Every transition records UUIDv7 aggregate and transition IDs, previous/resulting versions, previous/resulting states, verified actor ID and kind, stable reason code, JSON evidence, request ID, correlation ID, optional causation ID and optional idempotent-command record ID.

Evidence must contain only bounded domain references and decision facts appropriate for durable history. It must not contain plaintext OTPs, provider secrets, payment credentials, raw authentication material or unnecessary protected personal data.

The database enforces one transition per aggregate version and `resulting_version = previous_version + 1`. An update/delete trigger rejects mutation of history. Application correction is therefore a new attributable transition, never rewriting an earlier record.

## Verification

`pnpm db:verify` proves against the disposable PostgreSQL/PostGIS service:

1. creation begins at version 1 with history;
2. a valid transition advances state and version together with attribution;
3. stale edits return stable version conflicts without mutation;
4. invalid state, actor, evidence and reason combinations leave no partial change;
5. simultaneous edits using the same expected version produce exactly one winner; and
6. a failing domain mutation callback rolls back its side effect, version and history.

It also proves transition history rejects updates and that migration down/up and rebuild-from-zero remain valid. No named local developer database is changed by this verification.

## Current integration boundary

The synthetic Phase 3 exit-gate `reference_submission` aggregate now proves that both creation and transition callbacks keep configuration snapshots, outbox work, state and history in one transaction. It is not a product aggregate. Order, vendor, catalogue, assignment, support and financial modules will define their own policies and keep domain-row mutations inside this boundary in later phases.
