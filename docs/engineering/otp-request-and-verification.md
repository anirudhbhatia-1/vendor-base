# OTP Request and Verification

**Status:** Phase 4.1 verified locally  
**Scope:** Synthetic company testing only  
**Production authority:** None

Phase 4.1 adds the first identity proof boundary. The public API accepts only fictional identifiers matching `SYNTH-PHONE-*`; a real phone number is rejected before persistence or provider work. Phase 4.2 now consumes this proof transactionally to create a minimal user, device, and session, while roles and access rights remain absent.

## HTTP contract

- `POST /auth/otp/request` accepts `phone_identifier`, UUIDv7 `device_id`, and an opaque `request_key`. It returns a challenge reference, expiry, delivery state, and replay marker—never the OTP.
- `POST /auth/otp/verify` accepts the challenge, same device, and six-digit code. The API now couples fresh success to Phase 4.2 session creation in the same transaction. A repeated successful submission reports `already_verified` and creates neither a second session nor replacement credentials.

The request endpoint supports deterministic `test_scenario` values (`success`, `failure`, `delay`, and `duplicate_callback`) only because every currently allowed runtime is synthetic. A production runtime does not exist and the API accepts only `OTP_ADAPTER=fake`.

## Storage and privacy boundary

`otp_challenges` stores a keyed HMAC lookup for the fictional phone identifier and a separate keyed HMAC for the challenge-bound code. It never stores either value in plaintext. General logs, provider callback rows, HTTP responses, and metrics contain no OTP content.

The generated code exists briefly in `otp_protected_test_outbox`, the explicit local simulator delivery boundary. Only `readSyntheticOtpForTest` reads this table. Verification, expiry, or attempt lockout deletes the row. Future real adapters must replace this outbox with an approved provider and secret-management path; they must not add a test read route.

## Abuse and replay controls

- Three requests per fictional phone and five per device in a rolling 15-minute window.
- Thirty-second resend cooldown.
- Ten-minute challenge expiry.
- Five wrong attempts before lockout.
- Request deduplication by phone-purpose-request key.
- Database advisory locks serialize phone and device limit decisions under concurrency.
- Challenge verification is bound to the requesting device.
- Provider event IDs are unique, so a duplicated callback records one delivery fact.

Each wrong, expired, or successful verification appends an attributable outcome row containing challenge, request/correlation identity, attempt number, and time—never the submitted code. Metrics expose only bounded counts for delivered, failed, locked, and verified challenges. Together these provide abuse evidence without exposing identity or OTP content.

## Local verification

`pnpm db:verify` proves concurrent duplicate request collapse, successful verification and replay, plaintext absence, outbox destruction, provider failure/delay, duplicate callback deduplication, wrong-attempt lockout, expiry, rate limiting, metrics, migration rollback, and rebuild from zero.

The customer PWA contains labelled phone/code forms, keyboard-visible focus, numeric OTP input, a polite live status region, busy states, and clear synthetic-only guidance. It calls the local API but cannot retrieve OTP content. Developers obtain the current code only through the database package's test helper.

## Integration with Phase 4.2

The framework-free `verifyChallenge` primitive remains usable for isolated OTP contract tests, while the public API calls `completeOtpSignIn` so OTP consumption and session issuance are atomic. See [Sessions and Devices](sessions-and-devices.md) for rotation, refresh, revocation, expiry, device lifecycle, and stolen-token replay behavior. Roles and reusable authorization remain blocked until Phases 4.3 and 4.4.
