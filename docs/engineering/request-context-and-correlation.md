# Request Context and Correlation

**Scope:** Phase 3.2 foundation with Phase 4.4 authenticated actor integration, local synthetic data only  
**Production authority:** None

## HTTP boundary

The API accepts an optional `x-request-id` UUIDv7 and W3C version `00` `traceparent` header. A missing request ID is generated securely. A malformed supplied request ID or trace header returns `400 INVALID_ARGUMENT` with a newly generated safe request reference; unsafe client text is never reflected.

Every successful API response contains the request ID in both the `x-request-id` header and the JSON `request_id` field. The response also returns the current server `traceparent`. Nest exception responses use the standard error envelope and preserve the request ID when a request context exists.

## Actor context

The root HTTP context is anonymous until the Phase 4.4 authorization guard verifies a session and allows a capability against authoritative ownership or scope evidence. `AuthenticatedActorInterceptor` creates a nested asynchronous context containing only a validated UUIDv7 actor ID, actor kind and session ID. Client actor headers are not trusted. Phase 4.2 session-management routes continue to validate their bearer credential internally.

## Propagation

The shared domain package defines immutable command, event and job envelopes plus provider-call context. Child contexts preserve `request_id`, root `correlation_id`, authenticated actor and trace ID; they set `causation_id` to the parent message or operation and create a new child span. Queue and provider adapters added in later phases must use these factories at their outbound boundaries and restore the context before handling inbound work.

## Safe structured logging

API and worker loggers add request, correlation, causation, trace, span and verified actor references from asynchronous context. Metadata is recursively bounded and redacts protected key classes including authorization, cookies, secrets, credentials, OTPs, passwords, tokens, phone/email/address data, bank/card data and precise location. Error messages are not serialized from arbitrary metadata because they may contain protected values.

Operational identifiers and state names remain visible so logs can be correlated without copying protected content.

## Current limitations

- Anonymous health and sign-in requests correctly retain a `null` actor. Protected handlers receive an actor only after session and policy enforcement.
- The worker has a context-restoration boundary but no live queue consumer yet.
- Provider-call envelopes are defined but no external provider is active.
- OpenTelemetry export and sampling are deferred; W3C-compatible trace fields are preserved now.
- The Phase 3.3 database-backed idempotency boundary now stores and replays request-correlated command outcomes; domain endpoints will adopt it as they are introduced.
