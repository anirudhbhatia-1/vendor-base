import assert from 'node:assert/strict';
import test from 'node:test';
import {
  circleRing,
  circleWkt,
  formatPoint,
  forwardGeocodeUrl,
  isFinitePoint,
  parseGeocodeCandidates,
  parseReverseLabel,
  reverseGeocodeUrl,
} from './location-picker-support.js';

const token = 'pk.eyJ1IjoidW5pdCIsImEiOiJ0ZXN0MDEyMyJ9.unit-test-signature';

test('a forward search is fenced to the country, biased to the map, and carries the token', () => {
  const url = new URL(
    forwardGeocodeUrl({
      query: '  Vaishali Nagar ',
      accessToken: token,
      proximity: { latitude: 26.9124, longitude: 75.7873 },
    }),
  );
  assert.equal(url.origin + url.pathname, 'https://api.mapbox.com/search/geocode/v6/forward');
  assert.equal(url.searchParams.get('q'), 'Vaishali Nagar');
  assert.equal(url.searchParams.get('country'), 'in');
  assert.equal(url.searchParams.get('proximity'), '75.787300,26.912400');
  assert.equal(url.searchParams.get('limit'), '5');
  assert.equal(url.searchParams.get('access_token'), token);
  const reverse = new URL(
    reverseGeocodeUrl({ point: { latitude: 26.9, longitude: 75.8 }, accessToken: token }),
  );
  assert.equal(reverse.searchParams.get('longitude'), '75.800000');
  assert.equal(reverse.searchParams.get('latitude'), '26.900000');
});

test('geocoding answers become candidates, and a feature without a usable point is dropped', () => {
  const body = {
    features: [
      {
        id: 'a',
        geometry: { coordinates: [75.81, 26.91] },
        properties: { name: 'MI Road', full_address: 'MI Road, Jaipur, Rajasthan' },
      },
      { id: 'b', geometry: { coordinates: ['x', 26.9] }, properties: { name: 'Broken' } },
      { id: 'c', geometry: { coordinates: [75.8, 26.9] }, properties: {} },
      {
        id: 'd',
        geometry: { coordinates: [75.7, 26.8] },
        properties: { place_formatted: 'Somewhere, Jaipur' },
      },
    ],
  };
  const candidates = parseGeocodeCandidates(body);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates[0], {
    id: 'a',
    name: 'MI Road',
    address: 'MI Road, Jaipur, Rajasthan',
    point: { longitude: 75.81, latitude: 26.91 },
  });
  assert.equal(candidates[1]?.name, 'Somewhere, Jaipur');
  assert.equal(parseReverseLabel(body), 'MI Road, Jaipur, Rajasthan');
  assert.equal(parseReverseLabel({ features: [] }), null);
  assert.deepEqual(parseGeocodeCandidates(null), []);
  assert.deepEqual(parseGeocodeCandidates('nonsense'), []);
});

test('a service-zone circle is a closed ring of the right size, and its WKT is a multipolygon', () => {
  const centre = { latitude: 26.9124, longitude: 75.7873 };
  const ring = circleRing(centre, 1_000, 8);
  assert.equal(ring.length, 9);
  assert.deepEqual(ring[0], ring[8]);
  // The easternmost point sits one kilometre east: about 0.01 degrees at this latitude.
  const east = ring[0];
  assert.ok(east && Math.abs(east[0] - centre.longitude - 0.010072) < 0.0002, String(east));
  assert.ok(east && Math.abs(east[1] - centre.latitude) < 0.000001);
  const wkt = circleWkt(centre, 500, 4);
  assert.match(wkt, /^MULTIPOLYGON\(\(\(75\.\d+ 26\.\d+(, 75\.\d+ 26\.\d+){4}\)\)\)$/);
  assert.throws(() => circleRing(centre, 0), /positive/);
  assert.throws(() => circleRing({ latitude: 91, longitude: 0 }, 10), /finite/);
});

test('points are validated and read back to five decimals', () => {
  assert.equal(isFinitePoint({ latitude: 26.9, longitude: 75.8 }), true);
  assert.equal(isFinitePoint({ latitude: 91, longitude: 75.8 }), false);
  assert.equal(isFinitePoint({ latitude: Number.NaN, longitude: 75.8 }), false);
  assert.equal(isFinitePoint(null), false);
  assert.equal(formatPoint({ latitude: 26.91549, longitude: 75.811512 }), '26.91549, 75.81151');
  assert.equal(formatPoint(null), '—');
});
