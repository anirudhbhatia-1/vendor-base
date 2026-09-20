import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ESTIMATE_ROAD_FACTOR,
  EstimatedRouteProvider,
  MapboxRouteProvider,
  RoutingService,
  RoutingUnavailableError,
  promiseWindow,
  type RoutePoint,
} from './routing.js';

const jaipurStore: RoutePoint = { latitude: 26.91, longitude: 75.81 };
const jaipurHome: RoutePoint = { latitude: 26.92, longitude: 75.82 };

test('the estimate is the straight line times the road factor at a city speed', async () => {
  const provider = new EstimatedRouteProvider();
  const leg = await provider.route(jaipurStore, jaipurHome);
  // The straight line here is about 1.49 km.
  assert.ok(
    leg.distance_metres > 1_900 && leg.distance_metres < 2_000,
    String(leg.distance_metres),
  );
  assert.equal(
    leg.distance_metres,
    Math.round((leg.distance_metres / ESTIMATE_ROAD_FACTOR) * ESTIMATE_ROAD_FACTOR),
  );
  assert.equal(leg.duration_seconds, Math.max(60, Math.round(leg.distance_metres / 5)));
  const same = await provider.route(jaipurStore, jaipurStore);
  assert.deepEqual(same, { distance_metres: 0, duration_seconds: 60 });
  await assert.rejects(
    () => provider.route({ latitude: 91, longitude: 0 }, jaipurHome),
    /finite coordinate/,
  );
});

function mapbox(answer: (url: string) => { ok: boolean; status: number; body: unknown }) {
  const calls: string[] = [];
  const provider = new MapboxRouteProvider({
    access_token: 'pk.eyJ1IjoidW5pdCIsImEiOiJ0ZXN0MDEyMyJ9.unit-test-signature',
    fetch: async (url) => {
      calls.push(url);
      const reply = answer(url);
      return { ok: reply.ok, status: reply.status, json: async () => reply.body };
    },
  });
  return { calls, provider };
}

test('a Mapbox token that is not one is refused at construction', () => {
  assert.throws(
    () => new MapboxRouteProvider({ access_token: 'not-a-token' }),
    /not a Mapbox token/,
  );
});

test('Mapbox directions are read as whole metres and seconds, and the token never leaves the query', async () => {
  const { calls, provider } = mapbox(() => ({
    ok: true,
    status: 200,
    body: { code: 'Ok', routes: [{ distance: 2_345.6, duration: 512.4 }] },
  }));
  const leg = await provider.route(jaipurStore, jaipurHome);
  assert.deepEqual(leg, { distance_metres: 2_346, duration_seconds: 512 });
  assert.equal(calls.length, 1);
  assert.match(
    calls[0] ?? '',
    /\/directions\/v5\/mapbox\/driving\/75\.810000,26\.910000;75\.820000,26\.920000\?/,
  );
  assert.match(calls[0] ?? '', /access_token=pk\./);
});

test('no road, an HTTP failure and a timeout are each a routing-unavailable refusal, not a number', async () => {
  const noRoute = mapbox(() => ({ ok: true, status: 200, body: { code: 'NoRoute', routes: [] } }));
  await assert.rejects(
    () => noRoute.provider.route(jaipurStore, jaipurHome),
    RoutingUnavailableError,
  );
  const failing = mapbox(() => ({ ok: false, status: 429, body: {} }));
  await assert.rejects(() => failing.provider.route(jaipurStore, jaipurHome), /HTTP 429/);
  const slow = new MapboxRouteProvider({
    access_token: 'pk.eyJ1IjoidW5pdCIsImEiOiJ0ZXN0MDEyMyJ9.unit-test-signature',
    timeout_ms: 20,
    fetch: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  });
  await assert.rejects(() => slow.route(jaipurStore, jaipurHome), /did not answer within 20ms/);
});

test('the matrix is chunked at 24 destinations and a null cell is an unreachable point', async () => {
  const destinations = Array.from({ length: 30 }, (_value, index) => ({
    latitude: 26.9 + index / 1_000,
    longitude: 75.8,
  }));
  const { calls, provider } = mapbox((url) => {
    const count =
      url.split('/directions-matrix/v1/mapbox/driving/')[1]?.split('?')[0]?.split(';').length ?? 0;
    const row = Array.from({ length: count }, (_value, index) =>
      index === 0 ? 0 : index === 3 ? null : index * 100,
    );
    return { ok: true, status: 200, body: { code: 'Ok', distances: [row], durations: [row] } };
  });
  const legs = await provider.routeMany(jaipurStore, destinations);
  assert.equal(calls.length, 2);
  assert.equal(legs.length, 30);
  assert.deepEqual(legs[0], { distance_metres: 100, duration_seconds: 100 });
  assert.equal(legs[2], null);
  assert.equal(legs[26], null);
  assert.deepEqual(legs[24], { distance_metres: 100, duration_seconds: 100 });
});

test('the service falls back to a labelled estimate when the provider fails, and labels the provider when it answers', async () => {
  let fail = true;
  const provider = {
    source: 'MAPBOX' as const,
    profile: 'driving' as const,
    route: async () => ({ distance_metres: 3_000, duration_seconds: 600 }),
    routeMany: async (_origin: RoutePoint, destinations: readonly RoutePoint[]) => {
      if (fail) throw new RoutingUnavailableError('down');
      return destinations.map(() => ({ distance_metres: 3_000, duration_seconds: 600 }));
    },
  };
  const service = new RoutingService({ provider });
  const estimated = await service.route(jaipurStore, jaipurHome);
  assert.equal(estimated.source, 'ESTIMATE');
  assert.ok(estimated.distance_metres > 1_900);
  fail = false;
  const real = await service.route(jaipurStore, jaipurHome);
  assert.deepEqual(real, { distance_metres: 3_000, duration_seconds: 600, source: 'MAPBOX' });
  const plain = new RoutingService();
  assert.equal(plain.source, 'ESTIMATE');
  assert.equal((await plain.route(jaipurStore, jaipurHome)).source, 'ESTIMATE');
});

test('the promise is preparation for collection and preparation plus the road for delivery', () => {
  assert.deepEqual(promiseWindow({ preparation_seconds: 900, route: null }), {
    ready_after_seconds: 900,
    arrives_after_seconds: null,
  });
  assert.deepEqual(
    promiseWindow({
      preparation_seconds: 900,
      route: { distance_metres: 3_000, duration_seconds: 600, source: 'MAPBOX' },
    }),
    { ready_after_seconds: 900, arrives_after_seconds: 1_500 },
  );
});
