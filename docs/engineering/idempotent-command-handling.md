# Idempotent Command Handling

**Scope:** Phase 3.3 local company development with synthetic data only  
**Production authority:** None

The database package provides the shared command boundary for mutations that a client, queue, or provider adapter may submit more than once. It is PostgreSQL-backed so duplicate protection remains correct across API replicas and worker processes; process memory is never the source of truth.

## Command identity

Callers provide a verified UUIDv7 actor ID, a stable lowercase dotted command scope, an opaque 8–200 character idempotency key, the JSON request body, and the current request ID. The unique database identity is `(actor_id, command_scope, idempotency_key)`.

The request body is recursively canonicalized, with object keys sorted and array order preserved, then represented by a SHA-256 hash. The request payload itself is not copied into the idempotency table. Unsupported JSON values, cycles, non-finite numbers, unsafe keys/scopes, and top-level-null response bodies are rejected at the boundary.

## Claim and replay behaviour

`executeIdempotentCommand` atomically inserts an `IN_PROGRESS` claim before calling the command handler:

- The claim owner executes the handler once and stores its HTTP status and exact JSON result.
- A duplicate with the same body waits for the owner within a bounded window and then replays the stored result.
- A duplicate with a different request hash raises `IDEMPOTENCY_KEY_REUSED`; an API adapter maps this to `409`.
- If the wait window ends first, the duplicate receives a non-terminal `202 IN_PROGRESS` result and may retry safely.
- A lease that expires without a known result becomes `UNCERTAIN`; it is never silently executed again.

Normal results remain available for more than 24 hours. Uncertain results are retained until at least both their reconciliation deadline and seven days after creation. These guarantees are database constraints, not only application calculations.

## Provider uncertainty and reconciliation

A handler explicitly returns an uncertain outcome when a provider may have accepted a request but its response is unknown. A thrown handler error is also stored conservatively as `202 UNCERTAIN`. Retrying the command replays that state instead of risking a duplicate payment, message, or dispatch.

After provider evidence establishes the actual result, the reconciliation owner calls `reconcileUncertainCommand`. It can transition only an `UNCERTAIN` record to `SUCCEEDED` or `FAILED`; later client retries replay the reconciled body. Phase-specific provider modules will own their evidence, polling/webhook rules, authorization, and audit records.

## Verification

`pnpm db:verify` uses the disposable PostgreSQL/PostGIS test service and proves:

1. sequential duplicate replay with one handler execution;
2. rejection of a reused key with a changed body;
3. simultaneous duplicate collapse across separate pool connections;
4. uncertain-result retention, replay, and reconciliation; and
5. conservative handling of a thrown provider call.

The same lifecycle verifies migration up/down/up and rebuild-from-zero. It does not mutate the named local developer database.

## Current integration boundary

No business command endpoint exists yet. Each later domain module must call this boundary after authentication and authorization, and must choose a scope specific enough that unrelated commands cannot share keys. Database storage does not replace access control, aggregate-version checks, transition validation, outbox publication, or provider-specific reconciliation evidence.
