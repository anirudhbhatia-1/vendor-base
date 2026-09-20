/**
 * The parts of the map picker that are arithmetic and parsing rather than a
 * browser: the geocoding requests and their answers, and the circle a service
 * zone is drawn as. Kept apart from the component so they run under node's
 * test runner without a window.
 */
export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

/** One place a search could mean, as the picker lists it. */
export interface GeocodeCandidate {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly point: GeoPoint;
}

export const MAPBOX_GEOCODING_BASE = 'https://api.mapbox.com/search/geocode/v6';

export function isFinitePoint(point: Partial<GeoPoint> | null | undefined): point is GeoPoint {
  return (
    !!point &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude as number) <= 90 &&
    Math.abs(point.longitude as number) <= 180
  );
}

/**
 * Forward search: what the person typed, biased to where the map is looking
 * and fenced to one country. The token travels as a query parameter, which is
 * how Mapbox takes it; the request is made from the browser with a public
 * token scoped to this use.
 */
export function forwardGeocodeUrl(input: {
  readonly query: string;
  readonly accessToken: string;
  readonly proximity?: GeoPoint | null;
  readonly country?: string;
  readonly limit?: number;
  readonly language?: string;
}): string {
  const url = new URL(`${MAPBOX_GEOCODING_BASE}/forward`);
  url.searchParams.set('q', input.query.trim());
  url.searchParams.set('limit', String(input.limit ?? 5));
  url.searchParams.set('country', input.country ?? 'in');
  url.searchParams.set('language', input.language ?? 'en');
  if (input.proximity && isFinitePoint(input.proximity)) {
    url.searchParams.set(
      'proximity',
      `${input.proximity.longitude.toFixed(6)},${input.proximity.latitude.toFixed(6)}`,
    );
  }
  url.searchParams.set('access_token', input.accessToken);
  return url.toString();
}

export function reverseGeocodeUrl(input: {
  readonly point: GeoPoint;
  readonly accessToken: string;
  readonly language?: string;
}): string {
  const url = new URL(`${MAPBOX_GEOCODING_BASE}/reverse`);
  url.searchParams.set('longitude', input.point.longitude.toFixed(6));
  url.searchParams.set('latitude', input.point.latitude.toFixed(6));
  url.searchParams.set('limit', '1');
  url.searchParams.set('language', input.language ?? 'en');
  url.searchParams.set('access_token', input.accessToken);
  return url.toString();
}

/**
 * Reads a Mapbox Geocoding v6 answer into candidates. Anything without a
 * usable point is dropped rather than listed as a place nobody can go to.
 */
export function parseGeocodeCandidates(body: unknown): readonly GeocodeCandidate[] {
  if (!body || typeof body !== 'object') return [];
  const features = (body as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  const candidates: GeocodeCandidate[] = [];
  for (const feature of features) {
    if (!feature || typeof feature !== 'object') continue;
    const record = feature as {
      id?: unknown;
      geometry?: { coordinates?: unknown };
      properties?: { name?: unknown; full_address?: unknown; place_formatted?: unknown };
    };
    const coordinates = record.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const point = { longitude: Number(coordinates[0]), latitude: Number(coordinates[1]) };
    if (!isFinitePoint(point)) continue;
    const name = typeof record.properties?.name === 'string' ? record.properties.name : '';
    const address =
      typeof record.properties?.full_address === 'string'
        ? record.properties.full_address
        : typeof record.properties?.place_formatted === 'string'
          ? record.properties.place_formatted
          : '';
    if (!name && !address) continue;
    candidates.push(
      Object.freeze({
        id: typeof record.id === 'string' ? record.id : `${point.longitude},${point.latitude}`,
        name: name || address,
        address,
        point: Object.freeze(point),
      }),
    );
  }
  return Object.freeze(candidates);
}

/** Where a dropped pin landed, in words, with the postcode the place carries. */
export interface ReversePlace {
  readonly label: string;
  /** The postcode Mapbox attaches to the place, or null when it has none. */
  readonly postcode: string | null;
}

/**
 * The first candidate's address and postcode, for saying where a dropped pin
 * landed and for filling the PIN a person would otherwise read off the map
 * and type back in. Mapbox v6 carries the postcode in the feature's context.
 */
export function parseReversePlace(body: unknown): ReversePlace | null {
  const [first] = parseGeocodeCandidates(body);
  if (!first) return null;
  const features = (body as { features?: unknown[] }).features ?? [];
  const feature = features[0] as
    { properties?: { context?: { postcode?: { name?: unknown } } } } | undefined;
  const postcode = feature?.properties?.context?.postcode?.name;
  return Object.freeze({
    label: first.address || first.name,
    postcode: typeof postcode === 'string' && postcode.trim() ? postcode.trim() : null,
  });
}

/** The first candidate's address, for saying where a dropped pin landed. */
export function parseReverseLabel(body: unknown): string | null {
  return parseReversePlace(body)?.label ?? null;
}

/**
 * A circle of `radiusMetres` around a centre as a closed ring of
 * [longitude, latitude] pairs, counter-clockwise. Good to a metre at city
 * scale; the zone is a promise about streets, not a survey.
 */
export function circleRing(
  centre: GeoPoint,
  radiusMetres: number,
  points = 48,
): readonly (readonly [number, number])[] {
  if (!isFinitePoint(centre)) throw new RangeError('Circle centre must be a finite coordinate');
  if (!Number.isFinite(radiusMetres) || radiusMetres <= 0) {
    throw new RangeError('Circle radius must be positive');
  }
  const metresPerDegreeLatitude = 111_320;
  const metresPerDegreeLongitude =
    metresPerDegreeLatitude * Math.cos((centre.latitude * Math.PI) / 180);
  const ring: (readonly [number, number])[] = [];
  for (let index = 0; index < points; index += 1) {
    const angle = (index / points) * 2 * Math.PI;
    const longitude =
      centre.longitude + (radiusMetres * Math.cos(angle)) / metresPerDegreeLongitude;
    const latitude = centre.latitude + (radiusMetres * Math.sin(angle)) / metresPerDegreeLatitude;
    ring.push([Number(longitude.toFixed(6)), Number(latitude.toFixed(6))]);
  }
  const first = ring[0];
  if (first) ring.push(first);
  return Object.freeze(ring);
}

/** The same circle as the WKT MULTIPOLYGON the service-zone API accepts. */
export function circleWkt(centre: GeoPoint, radiusMetres: number, points = 48): string {
  const ring = circleRing(centre, radiusMetres, points)
    .map(([longitude, latitude]) => `${longitude} ${latitude}`)
    .join(', ');
  return `MULTIPOLYGON(((${ring})))`;
}

/** "26.9155, 75.8115" — what a person can read back or paste elsewhere. */
export function formatPoint(point: GeoPoint | null): string {
  return point ? `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}` : '—';
}
