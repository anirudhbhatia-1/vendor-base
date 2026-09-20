# Road routing

**Decision:** [D-17](../decisions/D-17.md) — Mapbox for the synthetic environments, a labelled estimate as fallback and test provider
**Module:** `database/src/routing.ts`; cache in `marketplace.route_cache` (migration 0085)
**Register:** PRV-04, `PATH_PENDING_2_1`

## Why

D-05 prices the customer delivery fee per *route* kilometre and pays the partner's trip by the same route. Until 20 September 2026 every distance in the system was `ST_Distance` — a straight line — so every fee and earning was short by whatever the roads add, "nearest first" ranked by the crow, and no surface knew a travel time: the checkout's "Arrives in 45–75 minutes" was fixed copy.

## One service, two sources

`RoutingService.route(origin, destination)` and `routeMany(origin, destinations)` return a `RouteLeg` — `distance_metres`, `duration_seconds` and a `source`:

- `MAPBOX` — `MapboxRouteProvider`: the Directions API for one pair, the Matrix API (24 destinations a call) for many, `driving` profile by default, a 4-second timeout, HTTP failures, `NoRoute` and timeouts each a `RoutingUnavailableError`. The token is `MAPBOX_ACCESS_TOKEN`, from the environment store only, never committed, never sent to a browser.
- `ESTIMATE` — `EstimatedRouteProvider`: the straight line times a road factor of 1.3 (the customary urban circuity range is 1.2–1.4) at 18 km/h, never under a minute. It is the provider when `ROUTING_PROVIDER=estimate` (local development, automated tests, `pnpm check`) and the fallback whenever Mapbox cannot answer. An estimate is never cached and is labelled wherever it is stored or shown.

Routes are cached by rounded coordinate pair (five decimals, about a metre) for a day, so one order's quote, offer and settlement ask the provider once. The cache is written only for provider answers.

## Configuration

| Variable | Values | Rule |
|---|---|---|
| `ROUTING_PROVIDER` | `estimate` (default), `mapbox` | `estimate` is a synthetic provider: outside local development and tests a deployment must set `mapbox` or `ALLOW_SYNTHETIC_PROVIDERS=synthetic-testing-only`, the same rule the fake OTP adapter follows. |
| `MAPBOX_ACCESS_TOKEN` | a `pk.` or `sk.` token | Required with `mapbox`; its shape is checked at startup. |
| `ROUTING_PROFILE` | `driving` (default), `cycling`, `walking` | The Mapbox profile and the cache's profile key. |
| `ROUTING_TIMEOUT_MS` | 500–30000, default 4000 | Per provider call. |

The API builds one service (`createRoutingService`) and injects it into discovery and checkout; the worker needs none, because settlement reads the route the quote stored.

## Where the road is used

| Surface | Before | Now |
|---|---|---|
| Quote (`checkout_quote_groups`) | fee on the straight line; promise fixed copy | fee on the road; `route_metres`, `route_seconds`, `route_source` stored; `ready_after_seconds` = the shop's preparation time, `arrives_after_seconds` = that plus the road; the promise composed from them in the customer's language, marked estimated when the road is |
| Partner offer | a line measured at offer time | the quote's stored route, its travel time and source; expected earning on it |
| Partner earning at settlement | a line measured at settlement | the quote's stored route (`recordDeliveryEarnings`), so the rider is paid on the distance the customer was charged for |
| Store discovery and search | ordered and filtered by the line | up to 200 in-zone candidates by the line, then routed in one matrix call, ordered and paged by the road; `travel_seconds` and `distance_source` on every store and hit; `max_distance_meters` applied to the road |
| Vendor self-delivery | nothing | the order summary carries the quoted route, and the shop's console says how far and how long before the driver leaves |
| Collected orders | — | no route; the promise is the preparation time |

Quotes made before 0085 carry no route; the offer and settlement fall back to the line for them.

## Verification

`verify-routing.ts` (`routing` in the ladder): a road is asked for once and cached under its rounded pair, a matrix call re-asks only unknown pairs, a lapsed entry is asked again, a provider failure yields a labelled estimate that is not cached and the provider is asked again once back, the estimate is the line times the factor, and a service without a provider caches nothing. `verify-grouped-checkout.ts`: a quote with no provider prices and promises on the estimate and says so; a collected group travels no route; a quote with a (fake) Mapbox answering 3 500 m / 700 s is priced at ₹27 delivery, promised at 32–47 minutes, stores the road and its source, and asks the provider once for the pair. `verify-vendor-fulfilment.ts`: the offer shows the quoted road, travel time and source with the earning computed on it; the settled earning equals the earning on the quoted road, which differs from the line. `verify-customer-discovery.ts`: stores are listed at their road distance with its source. `routing.spec.ts` covers the estimate arithmetic, the Mapbox adapter against a fake fetch (parsing, no route, HTTP failure, timeout, matrix chunking and unreachable cells), the service's fallback, and the promise window. `runtime-config.spec.ts` covers the provider gate.

Mutation probes recorded in the working log: pricing on the line, storing an estimate whatever the provider said, settlement and the offer measuring their own line, and discovery listing the line were each caught by the assertions above once the fulfilment fixture's address was moved off the store so a road and a line differ.

## What remains

- Configure `MAPBOX_ACCESS_TOKEN` and `ROUTING_PROVIDER=mapbox` in the Azure company-test environment's `release.env` (the templates already carry the variables) and in developers' local `.env` where real roads are wanted. Until then every route is a labelled estimate.
- Production routing, real customer coordinates and any paid tier remain gated by PRV-04 and D-17.
- An ETA model beyond preparation plus road time; live traffic; geocoding and the mobile map handoff (PRV-04's other halves).
