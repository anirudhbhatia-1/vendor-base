# API 500 from unmigrated local database — 2026-08-21

**Status:** DONE

## Symptom

The customer PWA reached the local API, which returned the standard `500 INTERNAL_ERROR` envelope during an identity request.

## Root cause

The persistent loopback PostgreSQL service was reachable, but none of the ten reviewed migrations had been applied. OTP and customer identity services therefore queried tables that did not exist. This was local environment state, not an API code regression.

## Fix

Ran `pnpm db:migrate` against the approved local target. Migrations `0000_baseline` through `0009_identity_preferences` applied successfully.

## Evidence

- Before migration, `pnpm db:status` reported all ten migrations as `applied:false`.
- After migration, it reported all ten as `applied:true`.
- A synthetic `POST /auth/otp/request` returned `202` with `status: delivered` instead of 500.

## Regression test

No code regression test was added because the code was correct and the failure was missing persistent environment setup. The migration lifecycle remains covered by `pnpm db:verify`.

## Related

After recreating or replacing the persistent local database, run `pnpm db:migrate` before testing identity flows. `pnpm db:verify` uses a disposable test database and does not initialize the persistent local database.
