# Testing Conventions

**Scope:** Local company development with synthetic data only

## Test layers and locations

| Layer | Location/name | Runner | Responsibility |
|---|---|---|---|
| Unit/component | Beside source as `*.spec.ts` or `*.spec.tsx` | Jest | Pure behavior and one module/component boundary |
| Integration | Beside module or under `tests/integration/` as `*.integration.spec.ts` | Jest/Supertest | Database, HTTP, worker, queue and adapter boundaries |
| PWA end-to-end | `tests/e2e/pwa/<role>/` | Playwright | Browser journeys for Customer, Vendor, Partner and Admin PWAs |
| Android end-to-end | `tests/e2e/android/<role>/` | Maestro | Emulator/device journeys for all four Android apps |
| Provider conformance | `tests/conformance/providers/` | Jest plus approved adapter harness | Same deterministic contract against fake and later sandbox adapters |
| Performance/resilience | `tests/performance/` and `tests/resilience/` | Step-specific local tools | Measured scale, outage, retry and recovery behavior |

## Required behavior coverage

Applicable tests cover success, validation failure, authorization denial, empty/loading/error state, timeout, retry, duplicate, stale state, reconnect/offline behavior, audit result and observable operational failure. Money tests balance to the paise. Custody tests never lose the current package owner. Provider timeouts remain unknown until reconciled.

## Fixture rules

- Use only deterministic synthetic builders from `@neighbourhood-store/test-data`.
- Record a seed for any explicitly seeded exploratory sequence.
- Never use a universal OTP, real phone/email/address, real shop identity, payment instrument, bank detail, credential or production export.
- Reset fixtures without depending on a developer's normal local dataset.
- Keep test clocks and scenario selectors inaccessible to production runtime code.

## Test quality

- Give each test one behavior-focused reason to fail.
- Assert durable state and externally visible outcome, not private implementation order.
- Prove idempotency with the same key and payload; separately reject the same key with a different payload.
- Await asynchronous completion through a bounded observable condition, never an arbitrary long sleep.
- Preserve failure evidence without printing secrets or sensitive fixture content.
- A skipped test requires an owner, reason and removal condition; focused tests are prohibited in committed work.

The package-level Jest, Playwright and Maestro configurations are added with their first executable clients/modules. Step 2.2 defines the conventions and repository controls without creating Step 2.3 entry points.
