# Shared packages

Only code that has the same meaning on every consuming platform belongs here. Shared packages must never make a client authoritative for permissions, prices, availability or workflow transitions.

| Directory | May contain | Must not contain |
|---|---|---|
| `domain-types/` | Framework-free identifiers, value shapes, state names and error names | Business commands, database access or UI behavior |
| `contracts/` | Versioned HTTP/event schemas and generated client-facing types | Server handlers, provider payload leakage or app screens |
| `i18n/` | Translation keys and shared message catalogues | Platform-specific layout or accessibility behavior |
| `ui-tokens/` | Basic color, spacing and typography tokens | Shared screens, navigation or device integrations |
| `test-data/` | Deterministic synthetic builders and fixture namespaces | Real people, businesses, contacts, addresses, credentials or production runtime imports |

Import direction is one way: applications may import packages; packages never import applications. `contracts` may import `domain-types`. `test-data` may import `contracts` and `domain-types` in tests only. Other shared packages remain independent unless a reviewed dependency is added with the explicit `workspace:` protocol.
