# Shared packages

Only code that has the same meaning on every consuming platform belongs here. Shared packages must never make a client authoritative for permissions, prices, availability or workflow transitions.

| Directory | May contain | Must not contain |
|---|---|---|
| `domain-types/` | Framework-free identifiers, value shapes, state names and error names | Business commands, database access or UI behavior |
| `contracts/` | Versioned HTTP/event schemas and generated client-facing types | Server handlers, provider payload leakage or app screens |
| `i18n/` | Translation keys and shared message catalogues | Platform-specific layout or accessibility behavior |
| `ui-tokens/` | Basic color, spacing and typography tokens | Shared screens, navigation or device integrations |
| `test-data/` | Deterministic synthetic builders and fixture namespaces | Real people, businesses, contacts, addresses, credentials or production runtime imports |

## Shared platform kernel

`@neighbourhood-store/domain-types` owns the Phase 3.1 framework-free primitives:

- UUIDv7 internal identifiers, branded request IDs, and checksummed non-secret public references;
- integer minor-unit money with explicit three-letter currency codes and currency-safe arithmetic;
- canonical UTC instants paired with validated IANA operating timezones;
- non-negative integer metres, grams, seconds, and configuration-versioned deadlines;
- stable error definitions with HTTP status, localization keys, retryability, request IDs, and field errors.

Phase 3.2 adds validated request and W3C trace contexts, authenticated-actor attachment, correlation/causation propagation envelopes for commands, events, jobs and provider calls, plus bounded recursive protected-field redaction for structured logs.

Construct values through the exported validation functions rather than using type assertions. Public references are display/search aids only and never prove ownership or authorization.

Import direction is one way: applications may import packages; packages never import applications. `contracts` may import `domain-types`. `test-data` may import `contracts` and `domain-types` in tests only. Other shared packages remain independent unless a reviewed dependency is added with the explicit `workspace:` protocol.
