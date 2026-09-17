# End-to-end journeys

This directory owns the Playwright journeys that cross more than one client and the API.
`playwright.config.ts` points its `testDir` here, so these are the specs `pnpm test:e2e` runs.

| Spec | Journey |
|---|---|
| `auth-gates.spec.ts` | Sign-in and the authorization boundaries between roles |
| `cross-role-journey.spec.ts` | Admin, vendor, partner and customer across one order |
| `live-marketplace-loop.spec.ts` | Discovery through checkout against the running stack |

A journey may drive any client through its browser and may import `@neighbourhood-store/contracts`
for request and response shapes. It must not import application source, reach into a client's
internal modules, or query the database to assert an outcome a role can observe for itself — a
journey that reads the database is testing the schema, not the workflow.

These specs must never run against real people, real money or a production environment.

## Required fixtures

**These do not exist yet, and the journeys now fail without them rather than skipping.** Until
recently every mandatory stage of `cross-role-journey.spec.ts` was wrapped in
`if (await button.isVisible())`, so a run against an empty database clicked nothing and reported
success. The conditionals are gone, which means the preconditions below are now the suite's
responsibility to provide:

| Journey | Precondition |
|---|---|
| Vendor accept → pick → ready → handover | One payment-confirmed child order awaiting acceptance for `ACCEPTANCE_VENDOR_*`, with at least one line to mark found |
| Partner custody | A partner eligible to go online — not merely a partner account — with an offer reachable for the same order |
| Admin monitor and moderation | At least one checkout group visible to the admin monitor, and a moderation queue with a live case |
| Customer OTP → grouped checkout | `ACCEPTANCE_VENDOR_LOCATION_ID` naming an active, published location with a purchasable published product in stock |

`tooling/scripts/verify-acceptance-specs.mjs` (run by `pnpm test:controls`) keeps the conditionals
from coming back: it rejects `isVisible().catch(...)`, actions guarded by `isVisible()`, and
assertions that accept an empty state as one branch of an alternation. A dedicated empty-state
assertion is fine and is left alone — the defect is an empty state standing in for the populated
path.

Seeding these fixtures needs an explicitly isolated target and has not been done. Do not create
them in a shared database without approval.
