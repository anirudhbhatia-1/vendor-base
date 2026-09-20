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

## Maps in the shells: nobody types a coordinate

Every role used to type latitude and longitude, or had them guessed: the customer's address form had two number fields; the vendor's application read the device and fell back to a hard-coded point in Jaipur when permission was refused; the admin's provisioning form defaulted every store to that same point; the rider went online at it whenever the phone would not say where they were; and a delivery zone was four typed corners.

`LocationPicker` in `packages/ui` is one component for all of them: a Mapbox GL map (loaded from Mapbox's CDN when a picker first mounts, pinned to one version, never bundled, so the shells stay the size they were), a place search (Mapbox Geocoding v6, fenced to India and biased to where the map is looking), tap-to-place and drag, "use my location", a reverse-geocoded read-back of where the pin landed, and the hand-entered fields behind a disclosure for anyone without WebGL, without a token, or who would rather type. The public token reaches the browser through `GET catalogue/maps/config`, which hands out a `pk.` token only — a secret `sk.` token is never given to a page — and answers `provider: none` when maps are not configured, at which point every picker shows its fallback and says so. The library's own type declarations do not compile under this repository's compiler settings, so the picker is typed against a hand-written subset (`mapbox-gl-loader.ts`) of exactly what it calls.

| Surface | Before | Now |
|---|---|---|
| Customer address (new and edit) | two number fields; device fix or nothing | search, tap, drag, device; the record still says whether the point was a device fix or a placed pin |
| Vendor application | device fix, else a hard-coded Jaipur point | the shop placed on the map; submission refused without it |
| Vendor delivery zone | four typed corners | a centre and a radius drawn on the map (`circleWkt`), corners by hand behind a disclosure |
| Admin store provisioning | two text fields defaulting to one point | the store placed on the map; creation refused without it |
| Rider going online | device fix, else a hard-coded Jaipur point | device first; if the phone will not say, the rider places themselves on the map before going online |

Verified in the browser against the synthetic project on 20 September 2026: the customer address map rendered Jaipur, a search for "Vaishali Nagar" listed five places, choosing one flew the map there and dropped the pin (`26.91104, 75.73854 · Nursery Cir 10, Jaipur`), a tap moved it, the address saved at that point, editing reopened the map on the saved pin, and the home feed listed stores at their road distance and time (`10.0 km · ~22 min`, no estimate marker). The Playwright journeys grant a device position for the rider and place the customer's address through the picker.

## What remains

- Configure `MAPBOX_ACCESS_TOKEN` and `ROUTING_PROVIDER=mapbox` in the Azure company-test environment's `release.env` (the templates already carry the variables) and in developers' local `.env` where real roads are wanted. Until then every route is a labelled estimate.
- Production routing, real customer coordinates and any paid tier remain gated by PRV-04 and D-17.
- An ETA model beyond preparation plus road time; live traffic; the mobile map handoff to a navigation app (PRV-04's remaining half). Geocoding is in place through the picker.
- The Android shells still take coordinates the old way; they are `unverified` in the matrix and outside this change.
