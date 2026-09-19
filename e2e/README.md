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

Every mandatory stage of `cross-role-journey.spec.ts` used to be wrapped in
`if (await button.isVisible())`, so a run against an empty database clicked nothing and reported
success. The conditionals are gone, and the journeys fail without their data rather than skipping
stages. The preconditions are therefore the suite's responsibility to provide:

| Journey | Precondition | What the provisioner leaves |
|---|---|---|
| Vendor accept → pick → ready → handover | One payment-confirmed order awaiting acceptance for `ACCEPTANCE_VENDOR_*`, with at least one line to mark found | A `PLACED` order with one line, placed last so it is still inside its accept window |
| Partner custody | A rider who is eligible and currently offline, holding an order on its way (the "I cannot deliver this" control is offered only `EN_ROUTE_TO_CUSTOMER` or `ARRIVED`) | A second order accepted, picked, readied, handed over at the counter against the rider's pickup code, and set off; the rider is then taken offline so "Go online" is a real transition |
| Admin monitor and moderation | At least one checkout group on the monitor, and a live moderation case | The two checkout groups above, and a `PENDING` case on the store's product — the one state that does not hide it from customers |
| Customer OTP → grouped checkout | `ACCEPTANCE_VENDOR_LOCATION_ID` naming an active, published location with a purchasable published product in stock | The store, published with 20 units of one product and both `CUSTOMER_PICKUP` and `PLATFORM_DELIVERY` |

`database/scripts/live-supabase-fixtures.ts` provisions all of this through the API and Supabase
Auth, the way the roles themselves would, creating only `SYNTH` records. It shares its steps with
`live-supabase-acceptance.ts` through `database/scripts/acceptance-support.ts`. Its last stdout
line is JSON whose `environment` holds the `ACCEPTANCE_VENDOR_*`, `ACCEPTANCE_PARTNER_*` and
`ACCEPTANCE_VENDOR_LOCATION_ID` values; the admin credentials it signs in with are the ones it
was given.

The awaiting order expires a few minutes after placement, so the fixtures cannot be made once and
kept. `playwright.config.ts` runs `e2e/global-setup.ts`, which seeds them inside the same
`pnpm test:e2e` invocation when both flags are set and copies the environment block onto the
process the workers fork from:

```bash
set -a; source infrastructure/supabase-production/.env; set +a
LIVE_SUPABASE_ACCEPTANCE=true ACCEPTANCE_SEED_FIXTURES=true \
ACCEPTANCE_ADMIN_EMAIL=… ACCEPTANCE_ADMIN_PASSWORD=… pnpm test:e2e
```

The API and worker must already be running on that profile (`E2E_BASE_URL` defaults to
`http://127.0.0.1:3001`). `LIVE_SUPABASE_ACCEPTANCE=true` without `ACCEPTANCE_SEED_FIXTURES`
runs the journeys against credentials already in the environment, as before. The provisioner can
also be run on its own as `pnpm --dir database acceptance:fixtures`.

`tooling/scripts/verify-acceptance-specs.mjs` (run by `pnpm test:controls`) keeps the conditionals
from coming back: it rejects `isVisible().catch(...)`, actions guarded by `isVisible()`, and
assertions that accept an empty state as one branch of an alternation. A dedicated empty-state
assertion is fine and is left alone — the defect is an empty state standing in for the populated
path. The admin journey's two counts must start with a non-zero digit for the same reason:
`/checkout group/` was satisfied by "0 checkout groups loaded".

**The provisioner has not yet been run against a Supabase project.** It needs one, because the
role PWAs sign in through Supabase Auth, and seeding a shared project — including the synthetic
development project the Azure company-test environment uses — needs approval first. Until a run
is recorded, the journeys' selectors remain verified by source inspection only.
