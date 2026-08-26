# Customer profile, consent, and preferences

**Status:** Phase 4.5 verified locally  
**Environment:** synthetic company development only

Phase 4.5 adds privacy-minimal customer settings without turning OTP verification into a role grant. The customer PWA explicitly calls the authenticated enrolment command after sign-in; repeated enrolment is idempotent. Vendor, partner, and admin memberships remain controlled by their separate reviewed workflows.

## Data model

- `customer_profiles` stores only an optional display name, `EN` or `HI` preference, and an optimistic version. An absent row means no display name and English; no row is created merely by reading defaults.
- `consents` is append-only. Each location, marketing, privacy, or terms decision names its policy version, source, previous record, request/correlation IDs, and per-kind version. Withdrawal creates a new record rather than rewriting history.
- `notification_preferences` stores explicit overrides with optimistic versions. `notification_preference_events` keeps append-only change evidence.
- Sensitive identity tables carry explicit data classification, retention class, and review date. Classification is operational metadata; it does not claim that deletion or legal-hold automation already exists.

Raw phone numbers, addresses, tokens, documents, and payment data are not profile fields.

## Notification policy

| Purpose | SMS | Push |
|---|---|---|
| Security | Required, enabled | Customer-controllable, enabled by default |
| Order status | Required, enabled | Customer-controllable, enabled by default |
| Active support | Customer-controllable, off by default | Required, enabled |
| Marketing | Customer-controllable, off | Customer-controllable, off |

The database trigger and service both reject disabling a required channel. Marketing can become effective only when the customer both enables that channel and has a current `GRANTED` marketing consent; withdrawal suppresses it immediately without erasing preference history.

## API surface

| Endpoint | Authorization | Result |
|---|---|---|
| `POST /auth/customer/enrol` | Valid session | Explicitly and idempotently grants the `CUSTOMER` role |
| `GET /auth/customer/preferences` | `customer.account.read` | Returns profile, current consent decisions, and effective channel state |
| `PUT /auth/customer/profile` | `customer.account.manage` | Updates optional display name/language using `expected_version` |
| `POST /auth/customer/consents` | `customer.account.manage` | Appends one versioned grant or withdrawal |
| `PUT /auth/customer/notifications/{kind}/{channel}` | `customer.account.manage` | Updates one controllable channel using `expected_version` |

All settings routes use the Phase 4.4 authorization guard. The user ID comes from the verified server request context, never from the body or a client actor header. Concurrent stale edits return `409`; required-channel attempts return `422` using the standard safe error envelope.

## Customer PWA behavior

The local customer PWA keeps access and refresh tokens only in component memory. After OTP completion it separately enrols the signed-in identity, loads privacy-minimal defaults, and exposes optional display name, English/Hindi choice, marketing consent, and reviewed notification controls. Required channels are labelled rather than rendered as toggles.

## Verification

`pnpm db:verify` proves defaults, profile normalization/clearing, optimistic conflicts, request replay, consent grant/withdrawal/version chains, consent-gated marketing, required-channel enforcement through both service and direct SQL, cross-customer isolation, classification/retention defaults, append-only history, migration rollback/reapplication, and rebuild from zero.

API tests prove that enrolment requires a valid opaque session but does not infer a role in the guard. The integration smoke test proves its missing-credential response is the standard `401 UNAUTHENTICATED` envelope.

## Phase 4.6 integration

Phase 4.6 now proves the broader cross-role and cross-tenant identity/access abuse matrix, including vendor-location, partner-assignment, admin-role, enumeration, and log-redaction cases. See [Identity and Access Isolation Proof](identity-isolation-proof.md). Production retention schedules, deletion/legal-hold workers, policy text, and real notification providers remain separately gated.
