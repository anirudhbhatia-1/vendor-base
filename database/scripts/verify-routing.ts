import { Pool } from 'pg';
import {
  ESTIMATE_ROAD_FACTOR,
  RoutingService,
  RoutingUnavailableError,
  type RoutePoint,
  type RoutingProvider,
} from '../src/routing.js';
import { check, rejects } from './verify-support.js';

/**
 * The routing service against the real cache table (0085): a road is asked
 * for once per pair, kept for a day, asked again when it lapses, and never
 * pretended to be known when the provider could not say.
 */
export async function verifyRouting(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 2 });
  const now = new Date('2026-08-28T09:00:00.000Z');
  // Distinct from every other fixture's coordinates, so the cache rows this
  // writes belong to this verifier alone.
  const store: RoutePoint = { latitude: 26.8, longitude: 75.7 };
  const home: RoutePoint = { latitude: 26.81, longitude: 75.71 };
  const other: RoutePoint = { latitude: 26.82, longitude: 75.72 };
  try {
    // This verifier's own pairs, so it re-runs on one database.
    await pool.query(`DELETE FROM marketplace.route_cache WHERE origin_key='75.70000,26.80000'`);
    const state = { calls: 0, fail: false };
    // Read through a function: `check` asserts, and an asserted property stays narrowed.
    const calls = () => state.calls;
    const provider: RoutingProvider = {
      source: 'MAPBOX',
      profile: 'driving',
      route: async () => ({ distance_metres: 2_000, duration_seconds: 400 }),
      routeMany: async (_origin, destinations) => {
        state.calls += 1;
        if (state.fail) throw new RoutingUnavailableError('provider down');
        return destinations.map((destination) => ({
          distance_metres: destination === other ? 3_000 : 2_000,
          duration_seconds: destination === other ? 600 : 400,
        }));
      },
    };
    const routing = new RoutingService({ provider, pool, cache_ttl_seconds: 3_600 });

    // 1. A road is asked for once and remembered.
    const first = await routing.route(store, home, now);
    check(
      first.distance_metres === 2_000 &&
        first.duration_seconds === 400 &&
        first.source === 'MAPBOX',
      'The provider answer was not returned as the route',
    );
    const again = await routing.route(store, home, new Date(now.getTime() + 60_000));
    check(
      calls() === 1 && again.distance_metres === 2_000 && again.source === 'MAPBOX',
      `A known pair was asked of the provider again (${calls()} calls)`,
    );
    const rows = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.route_cache
        WHERE provider='MAPBOX' AND origin_key='75.70000,26.80000' AND destination_key='75.71000,26.81000'`,
    );
    check(rows.rows[0]?.count === '1', 'The route was not cached under its rounded pair');

    // 2. Many destinations: the known one comes from the cache, only the new
    // one is asked, and each keeps its own answer.
    const many = await routing.routeMany(store, [home, other], new Date(now.getTime() + 120_000));
    check(
      calls() === 2 &&
        many[0]?.distance_metres === 2_000 &&
        many[1]?.distance_metres === 3_000 &&
        many[1].duration_seconds === 600,
      `A matrix call re-asked a known pair or mixed up the answers (${JSON.stringify(many)})`,
    );

    // 3. A lapsed entry is asked again.
    const lapsed = await routing.route(store, home, new Date(now.getTime() + 3_601_000));
    check(calls() === 3 && lapsed.source === 'MAPBOX', 'A lapsed cache entry was still trusted');

    // 4. When the provider cannot say, the answer is a labelled estimate, and
    // the estimate is not remembered as if the provider had said it.
    state.fail = true;
    const unknown: RoutePoint = { latitude: 26.83, longitude: 75.73 };
    const estimated = await routing.route(store, unknown, now);
    check(
      estimated.source === 'ESTIMATE' && estimated.distance_metres > 0,
      'A provider failure did not fall back to a labelled estimate',
    );
    const estimatedRows = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.route_cache WHERE destination_key='75.73000,26.83000'`,
    );
    check(estimatedRows.rows[0]?.count === '0', 'An estimate was cached as a provider answer');
    state.fail = false;
    const recovered = await routing.route(store, unknown, now);
    check(
      recovered.source === 'MAPBOX' && recovered.distance_metres === 2_000,
      'The provider was not asked again once it was back',
    );

    // 5. The estimate is the straight line times the road factor, and a
    // service with no provider caches nothing.
    const plain = new RoutingService({ pool });
    const estimate = await plain.route(store, home, now);
    const line = await pool.query<{ metres: string }>(
      `SELECT ST_Distance(ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,
                          ST_SetSRID(ST_MakePoint($3,$4),4326)::geography)::text AS metres`,
      [store.longitude, store.latitude, home.longitude, home.latitude],
    );
    const expected = Math.round(Number(line.rows[0]?.metres) * ESTIMATE_ROAD_FACTOR);
    check(
      estimate.source === 'ESTIMATE' && Math.abs(estimate.distance_metres - expected) <= 2,
      `The estimate is not the straight line times the road factor (${estimate.distance_metres} vs ${expected})`,
    );
    const total = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.route_cache WHERE origin_key='75.70000,26.80000'`,
    );
    check(
      total.rows[0]?.count === '3',
      `The cache holds rows an estimate should not have written (${total.rows[0]?.count})`,
    );

    // 6. Bad coordinates are refused before anything is asked.
    await rejects(
      () => routing.route({ latitude: 91, longitude: 0 }, home, now),
      RangeError,
      'An impossible coordinate reached the provider',
    );
  } finally {
    await pool.end();
  }
}
