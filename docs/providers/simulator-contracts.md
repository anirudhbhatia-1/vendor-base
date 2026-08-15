# Local provider simulator contracts

**Status:** Approved for internal company development  
**Data classification:** Synthetic only  
**Network access:** None by default

## Purpose

Provider simulators are local fake implementations of services that will eventually send OTPs and messages, authorize money, pay vendors and partners, calculate routes, deliver push notifications, and store files. They exercise the complete application contract without contacting a real provider or using real credentials, people, phone numbers, addresses, bank accounts, or money.

Simulators must implement the same provider-neutral interfaces used by future real adapters. Business modules may not depend on simulator-only payload fields.

## Common operation contract

Every provider operation receives:

- a unique internal operation ID;
- an idempotency key, which makes a retry return the existing outcome instead of repeating the effect;
- a correlation ID linking the operation to its order, case, or test;
- a deterministic scenario name selected by the test harness;
- synthetic input data appropriate to the capability.

Every result returns or records:

- a fictional provider reference;
- an explicit state such as succeeded, declined, pending, unknown, or failed;
- a safe error code where applicable;
- provider time and attempt number;
- callback or statement records when that capability supports them.

The scenario selector is accepted only in `local`, `test`, or `queue-compat` mode. A future shared or production process must fail startup if scenario selection or a test outbox is enabled.

## Mandatory deterministic scenarios

Each applicable adapter must provide fixtures for:

| Scenario | Required behaviour |
|---|---|
| `success` | Return one successful result with a stable fictional reference |
| `decline` | Return a stable business decline without a side effect |
| `timeout` | Simulate no timely response; caller must not assume failure |
| `unknown` | Record an unresolved provider outcome for reconciliation |
| `malformed_response` | Return invalid shape and prove validation rejects it safely |
| `invalid_signature` | Reject a callback without changing business state |
| `replay` | Deliver an already processed callback and prove it is ignored safely |
| `duplicate` | Deliver the same valid result twice and produce one business effect |
| `temporary_outage` | Return a retryable failure with bounded retry behaviour |
| `reconciliation_mismatch` | Produce a statement that conflicts with the internal record and opens one finance exception |

Random failures are prohibited in automated tests. A developer may run an explicitly seeded exploratory fault sequence, but the seed must be printed and repeatable.

## Capability contracts

### OTP identity and delivery proof

- Generate a new fake OTP per synthetic challenge.
- Store it briefly in a protected test-only outbox.
- Do not return OTP content from the public API or general logs.
- Permit automated tests to read it only through a local/test helper.
- Exercise expiry, wrong attempts, resend limits, reuse, duplicate request, and already-consumed outcomes.
- Use only fictional phone identifiers.

### Payment

Support authorization, status lookup, capture, void, refund, callback receipt, and statement generation. A timeout or unknown response remains unresolved until a later callback, lookup, or statement reconciles it. Authorization, capture, void, and refund each use their own idempotency key.

### Payout

Support batch submission, per-beneficiary result, pending, failure, unknown outcome, duplicate submission, callback, and fictional statement generation. Bank and UPI payout identifiers are synthetic tokens, never plausible real account data.

### Maps and routes

Use a fixed synthetic Jaipur map fixture containing fictional coordinates, serviceability results, route distances, and route failures. The same origin and destination produce the same distance. Tests cover unavailable route, out-of-zone, malformed coordinate, timeout, and stale cached route. No public map API is called.

### Push, SMS, and email

Write safe message metadata and redacted synthetic content into separate local outboxes. Support delivered, delayed, rejected, rate-limited, duplicate receipt, and provider-outage outcomes. Never include OTP content in the general messaging outbox.

### Object storage

Use the repository-configured local runtime directory behind the provider-neutral storage interface. Support upload, read, delete, missing object, checksum mismatch, simulated scan rejection, size violation, unsupported media type, and permission denial. Reject absolute paths, `..` traversal, symlink escape, and unsafe filenames.

## Callback processing

Synthetic callbacks follow the same boundary as a future real provider:

1. receive raw body and safe headers;
2. verify the simulator signature using a test-only runtime key;
3. persist the receipt before processing;
4. deduplicate by provider event ID;
5. enqueue processing;
6. validate the allowed state transition;
7. record the outcome or exception without rewriting history.

No callback handler trusts a client-supplied success state.

## Production certification gate

Before enabling a real adapter, the company must select and approve the provider, obtain credentials through secret management, and run the same contract suite against the provider sandbox. Controlled company accounts then verify real OTP/message delivery, authorization, capture, void, refund, payout, route, callback, statement, timeout, and reconciliation behaviour. A limited production canary follows only after privacy, finance, legal, security, rollback, support, and monitoring approval.

Passing simulator tests alone never authorizes real provider use.

