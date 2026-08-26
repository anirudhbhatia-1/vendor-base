# API root 404 debug report — 2026-08-21

**Status:** DONE

## Symptom

The running API logged repeated `404 RESOURCE_NOT_FOUND` request failures.

## Root cause

The NestJS service is an API, not a webpage, and intentionally has no `GET /` route. A browser or local preview requesting the API root therefore receives the standard safe 404 envelope. The application and health endpoints remain available.

## Fix

No code change is required. Use `/health/live` for API liveness and port 3100–3103 for the four PWA pages.

## Evidence

- `GET http://127.0.0.1:3001/` returned the expected `404 RESOURCE_NOT_FOUND` envelope.
- `GET http://127.0.0.1:3001/health/live` returned `200` with local/synthetic API status.
- `GET http://127.0.0.1:3100/` returned `200` for the customer PWA.

## Regression test

No regression test was added because no defect was found. The existing API integration smoke suite already verifies `/health/live` and `/health/ready`.
