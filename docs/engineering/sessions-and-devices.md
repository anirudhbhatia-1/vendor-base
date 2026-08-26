# Sessions and Devices

**Status:** Phase 4.2 verified locally  
**Scope:** Synthetic company testing only  
**Production authority:** None

Phase 4.2 turns a fresh successful OTP verification into a minimal user identity, safe device registration, and revocable session. A successful sign-in still assigns no role automatically. Phase 4.3 adds explicit roles and memberships, while reusable route authorization begins in Phase 4.4.

## Credential contract

- Access tokens are opaque 256-bit values prefixed `nsa_` and expire after 15 minutes.
- Refresh tokens are independent opaque 256-bit values prefixed `nsr_` and belong to a 30-day session family.
- Only keyed HMAC digests are stored. Raw access, refresh, notification, OTP, and fictional phone values never enter durable general-purpose tables, logs, events, or metrics.
- A refresh rotates both tokens, invalidates the previous access token, marks the used refresh token `ROTATED`, and appends a lifecycle event.
- Reuse of any rotated refresh token is treated as theft: the active token and entire session are revoked, with a `REPLAY_DETECTED` event.
- Access-token expiry does not destroy a still-valid refresh session. Refresh-family expiry transitions the session to `EXPIRED` and prevents recovery.

Tokens are returned once to the calling client with `Cache-Control: no-store`. The customer PWA keeps its local test tokens in component memory only; it does not write them to local storage. Production client storage, cookie policy, CSRF controls, attestation, and public rollout remain separately gated.

## Identity and device records

A verified keyed phone lookup resolves one stable `user_id`. The database stores no raw phone identifier. `users` remains minimal; Phase 4.5 stores optional customer profile and consent records separately.

Each user/device pair has a safe registration containing UUIDv7 client device ID, `WEB` or `ANDROID` platform, bounded label, last-seen time, and optional keyed notification-token hash. Notification tokens can be replaced or removed. Revoking the final active session on a registration removes its notification hash.

## API surface

| Endpoint | Credential | Result |
|---|---|---|
| `POST /auth/otp/verify` | Fresh OTP challenge and same device | Atomically consumes OTP and issues one session |
| `POST /auth/sessions/refresh` | Refresh token | Rotates both credentials or revokes on replay |
| `GET /auth/sessions` | Bearer access token | Returns up to 50 safe same-user session/device summaries |
| `POST /auth/sessions/sign-out` | Bearer access token | Revokes the current session |
| `POST /auth/sessions/{session_id}/revoke` | Bearer access token | Revokes a same-user selected session; cross-user targets are denied |
| `PUT /auth/devices/current/notification-token` | Bearer access token | Replaces or removes the current device token hash |

These session-management routes validate their bearer credential internally. They do not by themselves authorize product routes; the Phase 4.4 guard attaches a verified actor to request context only after domain authorization succeeds.

Phase 4.5 adds `POST /auth/customer/enrol` as a session-only command. The explicit call grants an idempotent customer assignment; session issuance itself remains role-neutral.

## Transaction and evidence guarantees

Fresh OTP consumption, principal resolution/creation, device upsert, session creation, refresh-token insertion, and the `CREATED` event share one PostgreSQL transaction. Failure rolls back every effect. A consumed challenge cannot issue a second session.

Session lifecycle events are append-only and contain session/version, stable event type, request/correlation identity, and time—never credentials. Database constraints enforce one session per OTP challenge, one active refresh token per session, unique token hashes, bounded states, ordered expiries, and coherent revocation fields.

## Verification

`pnpm db:verify` proves:

- fresh issuance and consumed-OTP replay;
- access, refresh, fictional phone, notification, and OTP plaintext absence;
- access/refresh rotation and old-access invalidation;
- stolen rotated-refresh replay revoking the family;
- access expiry with valid refresh, then terminal refresh expiry;
- cross-account access denial;
- stable user identity across three devices;
- safe session listing, selected-session revocation, and current sign-out;
- notification-token activation/removal;
- append-only lifecycle counts; and
- migration down/up and rebuild from zero.

## Boundary with Phase 4.3

Every session identifies only a minimal active user. Phase 4.3 role and membership authority is separate and explicit: signing in never grants customer, vendor, partner, or admin access. See [Roles, Capabilities, and Memberships](roles-capabilities-and-memberships.md). Phase 4.4 now combines the session principal with those policy decisions through the reusable [Authorization Enforcement](authorization-enforcement.md) boundary.
