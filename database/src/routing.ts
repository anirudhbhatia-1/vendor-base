import type { Pool } from 'pg';
import { createUuidV7 } from '@neighbourhood-store/domain-types';
import { LocalDeterministicRouteProvider } from './provider-ports.js';

/**
 * Road distance and travel time between two points.
 *
 * D-05 prices delivery per *route* kilometre and the partner's earning by the
 * same route; the register (PRV-04) names an approved maps provider as the
 * replacement for the synthetic straight line. Until this module, every
 * distance in the system was `ST_Distance` -- a straight line -- so every fee,
 * earning and "distance to store" was short by whatever the roads add, and no
 * travel time existed at all.
 *
 * One service, one cache, two sources:
 *
 * - `MAPBOX`: the Mapbox Directions and Matrix APIs (OpenStreetMap road
 *   network, driving profile), reached with a token that lives only in the
 *   environment. Approved by the owner on 20 September 2026 for the synthetic
 *   environments (D-17).
 * - `ESTIMATE`: the straight line times a road factor at a city speed. It is
 *   the provider when no maps provider is configured (development, automated
 *   tests) and the fallback when the provider fails, times out or finds no
 *   road -- a quote must still be possible when a third party is down, and an
 *   honest estimate labelled as one beats a refusal. Every route carries its
 *   source, and the source is stored wherever the route is.
 *
 * Results are cached by rounded coordinate pair. A store and a saved address
 * are fixed points, so the second quote, the partner offer and the settlement
 * of one order never call the provider again.
 */
export type RouteSource = 'ESTIMATE' | 'MAPBOX';
export type RoutingProfile = 'cycling' | 'driving' | 'walking';

export interface RoutePoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface RouteLeg {
  readonly distance_metres: number;
  readonly duration_seconds: number;
  readonly source: RouteSource;
}

export interface RoutingProvider {
  readonly source: RouteSource;
  readonly profile: RoutingProfile;
  route(origin: RoutePoint, destination: RoutePoint): Promise<Omit<RouteLeg, 'source'>>;
  /** One origin to many destinations; a null entry is a destination no road reaches. */
  routeMany(
    origin: RoutePoint,
    destinations: readonly RoutePoint[],
  ): Promise<readonly (Omit<RouteLeg, 'source'> | null)[]>;
}

export class RoutingUnavailableError extends Error {
  readonly code = 'ROUTING_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'RoutingUnavailableError';
  }
}

/**
 * Roads are not straight. 1.3 is the customary urban circuity factor (the
 * ratio of road distance to straight-line distance across many city studies
 * sits between 1.2 and 1.4); 18 km/h is a two-wheeler's realistic urban
 * average with stops. Both are estimates and are labelled as such wherever
 * the number is shown.
 */
export const ESTIMATE_ROAD_FACTOR = 1.3;
export const ESTIMATE_SPEED_METRES_PER_SECOND = 5;
export const ESTIMATE_MINIMUM_SECONDS = 60;

export function requireRoutePoint(point: RoutePoint, label: string): RoutePoint {
  if (
    !Number.isFinite(point.latitude) ||
    !Number.isFinite(point.longitude) ||
    Math.abs(point.latitude) > 90 ||
    Math.abs(point.longitude) > 180
  ) {
    throw new RangeError(`${label} must be a finite coordinate`);
  }
  return point;
}

export class EstimatedRouteProvider implements RoutingProvider {
  readonly source = 'ESTIMATE' as const;
  readonly profile: RoutingProfile;
  readonly #straight = new LocalDeterministicRouteProvider();
  constructor(profile: RoutingProfile = 'driving') {
    this.profile = profile;
  }
  async route(origin: RoutePoint, destination: RoutePoint): Promise<Omit<RouteLeg, 'source'>> {
    requireRoutePoint(origin, 'Route origin');
    requireRoutePoint(destination, 'Route destination');
    const straight = await this.#straight.route({
      origin: [origin.longitude, origin.latitude],
      destination: [destination.longitude, destination.latitude],
    });
    const distance = Math.round(straight.distance_metres * ESTIMATE_ROAD_FACTOR);
    return Object.freeze({
      distance_metres: distance,
      duration_seconds: Math.max(
        ESTIMATE_MINIMUM_SECONDS,
        Math.round(distance / ESTIMATE_SPEED_METRES_PER_SECOND),
      ),
    });
  }
  async routeMany(
    origin: RoutePoint,
    destinations: readonly RoutePoint[],
  ): Promise<readonly (Omit<RouteLeg, 'source'> | null)[]> {
    return Promise.all(destinations.map((destination) => this.route(origin, destination)));
  }
}

/** The Mapbox token shape: a public or secret token, base64url body. */
const MAPBOX_TOKEN = /^(pk|sk)\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}$/;
/** Mapbox Matrix accepts up to 25 coordinates per request, the origin included. */
const MAPBOX_MATRIX_DESTINATIONS = 24;

type FetchLike = (
  input: string,
  init: { readonly signal: AbortSignal },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

function coordinate(point: RoutePoint): string {
  return `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`;
}

function integerMetres(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RoutingUnavailableError(`Mapbox returned no ${label}`);
  }
  return Math.round(value);
}

export class MapboxRouteProvider implements RoutingProvider {
  readonly source = 'MAPBOX' as const;
  readonly profile: RoutingProfile;
  readonly #token: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #baseUrl: string;
  constructor(input: {
    readonly access_token: string;
    readonly profile?: RoutingProfile;
    readonly timeout_ms?: number;
    readonly base_url?: string;
    readonly fetch?: FetchLike;
  }) {
    if (!MAPBOX_TOKEN.test(input.access_token)) {
      throw new Error('MAPBOX_ACCESS_TOKEN is not a Mapbox token');
    }
    this.#token = input.access_token;
    this.profile = input.profile ?? 'driving';
    this.#timeoutMs = input.timeout_ms ?? 4_000;
    this.#baseUrl = (input.base_url ?? 'https://api.mapbox.com').replace(/\/$/, '');
    this.#fetch = input.fetch ?? ((url, init) => fetch(url, init));
  }

  async #get(path: string, query: Readonly<Record<string, string>>): Promise<unknown> {
    const url = new URL(`${this.#baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    url.searchParams.set('access_token', this.#token);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url.toString(), { signal: controller.signal });
      if (!response.ok) {
        throw new RoutingUnavailableError(`Mapbox answered HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof RoutingUnavailableError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new RoutingUnavailableError(
        controller.signal.aborted
          ? `Mapbox did not answer within ${this.#timeoutMs}ms`
          : `Mapbox was unreachable: ${message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async route(origin: RoutePoint, destination: RoutePoint): Promise<Omit<RouteLeg, 'source'>> {
    requireRoutePoint(origin, 'Route origin');
    requireRoutePoint(destination, 'Route destination');
    const body = await this.#get(
      `/directions/v5/mapbox/${this.profile}/${coordinate(origin)};${coordinate(destination)}`,
      { overview: 'false', alternatives: 'false', steps: 'false' },
    );
    const answer = body as { code?: unknown; routes?: unknown };
    if (answer.code !== 'Ok' || !Array.isArray(answer.routes) || !answer.routes[0]) {
      throw new RoutingUnavailableError(
        `Mapbox found no road between the points (${String(answer.code ?? 'no code')})`,
      );
    }
    const first = answer.routes[0] as { distance?: unknown; duration?: unknown };
    return Object.freeze({
      distance_metres: integerMetres(first.distance, 'distance'),
      duration_seconds: integerMetres(first.duration, 'duration'),
    });
  }

  async routeMany(
    origin: RoutePoint,
    destinations: readonly RoutePoint[],
  ): Promise<readonly (Omit<RouteLeg, 'source'> | null)[]> {
    requireRoutePoint(origin, 'Route origin');
    destinations.forEach((destination) => requireRoutePoint(destination, 'Route destination'));
    const legs: (Omit<RouteLeg, 'source'> | null)[] = [];
    for (let start = 0; start < destinations.length; start += MAPBOX_MATRIX_DESTINATIONS) {
      const chunk = destinations.slice(start, start + MAPBOX_MATRIX_DESTINATIONS);
      const coordinates = [origin, ...chunk].map(coordinate).join(';');
      const body = await this.#get(`/directions-matrix/v1/mapbox/${this.profile}/${coordinates}`, {
        sources: '0',
        annotations: 'distance,duration',
      });
      const answer = body as { code?: unknown; distances?: unknown; durations?: unknown };
      const distances = Array.isArray(answer.distances) ? answer.distances[0] : null;
      const durations = Array.isArray(answer.durations) ? answer.durations[0] : null;
      if (answer.code !== 'Ok' || !Array.isArray(distances) || !Array.isArray(durations)) {
        throw new RoutingUnavailableError(
          `Mapbox matrix did not answer (${String(answer.code ?? 'no code')})`,
        );
      }
      chunk.forEach((_destination, index) => {
        // Column 0 is the origin itself; a null cell is a point no road reaches.
        const distance = distances[index + 1];
        const duration = durations[index + 1];
        legs.push(
          typeof distance === 'number' && typeof duration === 'number'
            ? Object.freeze({
                distance_metres: integerMetres(distance, 'distance'),
                duration_seconds: integerMetres(duration, 'duration'),
              })
            : null,
        );
      });
    }
    return Object.freeze(legs);
  }
}

/** Five decimals is about a metre: the same store and the same doorstep hit the same row. */
function cacheKey(point: RoutePoint): string {
  return `${point.longitude.toFixed(5)},${point.latitude.toFixed(5)}`;
}

export const ROUTE_CACHE_TTL_SECONDS = 24 * 60 * 60;

export class RoutingService {
  readonly #provider: RoutingProvider;
  readonly #estimate: EstimatedRouteProvider;
  readonly #pool: Pick<Pool, 'query'> | null;
  readonly #ttlSeconds: number;
  readonly #log: (event: string, fields: Record<string, unknown>) => void;

  constructor(
    input: {
      readonly provider?: RoutingProvider;
      /** Where the route cache lives; without one, nothing is cached. */
      readonly pool?: Pick<Pool, 'query'>;
      readonly cache_ttl_seconds?: number;
      readonly log?: (event: string, fields: Record<string, unknown>) => void;
    } = {},
  ) {
    this.#estimate = new EstimatedRouteProvider(input.provider?.profile ?? 'driving');
    this.#provider = input.provider ?? this.#estimate;
    this.#pool = input.pool ?? null;
    this.#ttlSeconds = input.cache_ttl_seconds ?? ROUTE_CACHE_TTL_SECONDS;
    this.#log = input.log ?? (() => undefined);
  }

  get source(): RouteSource {
    return this.#provider.source;
  }

  async route(origin: RoutePoint, destination: RoutePoint, now = new Date()): Promise<RouteLeg> {
    const [leg] = await this.routeMany(origin, [destination], now);
    if (!leg) throw new RoutingUnavailableError('No route leg was produced');
    return leg;
  }

  /**
   * Every destination gets a leg: from the cache when the pair is known, from
   * the provider otherwise, and as an estimate when the provider cannot say.
   * Estimates are never cached -- the next call should ask the provider again.
   */
  async routeMany(
    origin: RoutePoint,
    destinations: readonly RoutePoint[],
    now = new Date(),
  ): Promise<readonly RouteLeg[]> {
    requireRoutePoint(origin, 'Route origin');
    destinations.forEach((destination) => requireRoutePoint(destination, 'Route destination'));
    const legs: (RouteLeg | null)[] = destinations.map(() => null);
    const cached = await this.#readCache(origin, destinations, now);
    cached.forEach((leg, index) => {
      legs[index] = leg;
    });
    const missing = destinations
      .map((destination, index) => ({ destination, index }))
      .filter(({ index }) => legs[index] === null);
    if (missing.length > 0 && this.#provider.source !== 'ESTIMATE') {
      try {
        const answered = await this.#provider.routeMany(
          origin,
          missing.map(({ destination }) => destination),
        );
        const toCache: { destination: RoutePoint; leg: RouteLeg }[] = [];
        answered.forEach((answer, position) => {
          const target = missing[position];
          if (!target || !answer) return;
          const leg = Object.freeze({ ...answer, source: this.#provider.source });
          legs[target.index] = leg;
          toCache.push({ destination: target.destination, leg });
        });
        await this.#writeCache(origin, toCache, now);
      } catch (error) {
        this.#log('routing.provider.failed', {
          provider: this.#provider.source,
          message: error instanceof Error ? error.message : String(error),
          pairs: missing.length,
        });
      }
    }
    for (const { destination, index } of missing) {
      if (legs[index] !== null) continue;
      const estimate = await this.#estimate.route(origin, destination);
      legs[index] = Object.freeze({ ...estimate, source: 'ESTIMATE' as const });
    }
    return Object.freeze(legs.map((leg) => leg as RouteLeg));
  }

  async #readCache(
    origin: RoutePoint,
    destinations: readonly RoutePoint[],
    now: Date,
  ): Promise<readonly (RouteLeg | null)[]> {
    if (!this.#pool || destinations.length === 0 || this.#provider.source === 'ESTIMATE') {
      return destinations.map(() => null);
    }
    const result = await this.#pool.query<{
      destination_key: string;
      distance_metres: number;
      duration_seconds: number;
    }>(
      `SELECT destination_key, distance_metres, duration_seconds
         FROM marketplace.route_cache
        WHERE provider=$1 AND profile=$2 AND origin_key=$3 AND destination_key = ANY($4::text[])
          AND expires_at > $5`,
      [
        this.#provider.source,
        this.#provider.profile,
        cacheKey(origin),
        destinations.map(cacheKey),
        now,
      ],
    );
    const byKey = new Map(result.rows.map((row) => [row.destination_key, row]));
    return destinations.map((destination) => {
      const row = byKey.get(cacheKey(destination));
      return row
        ? Object.freeze({
            distance_metres: Number(row.distance_metres),
            duration_seconds: Number(row.duration_seconds),
            source: this.#provider.source,
          })
        : null;
    });
  }

  async #writeCache(
    origin: RoutePoint,
    entries: readonly { readonly destination: RoutePoint; readonly leg: RouteLeg }[],
    now: Date,
  ): Promise<void> {
    if (!this.#pool || entries.length === 0) return;
    const expiresAt = new Date(now.getTime() + this.#ttlSeconds * 1_000);
    for (const entry of entries) {
      await this.#pool.query(
        `INSERT INTO marketplace.route_cache
           (route_cache_id, provider, profile, origin_key, destination_key,
            distance_metres, duration_seconds, computed_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (provider, profile, origin_key, destination_key)
         DO UPDATE SET distance_metres=EXCLUDED.distance_metres,
                       duration_seconds=EXCLUDED.duration_seconds,
                       computed_at=EXCLUDED.computed_at, expires_at=EXCLUDED.expires_at`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          this.#provider.source,
          this.#provider.profile,
          cacheKey(origin),
          cacheKey(entry.destination),
          entry.leg.distance_metres,
          entry.leg.duration_seconds,
          now,
          expiresAt,
        ],
      );
    }
  }
}

/**
 * The promise a quote makes, from the shop's own preparation time and the
 * road. Collection is ready when the shop is; a delivery arrives after the
 * shop has prepared it and the road has been driven. The upper bound gives
 * the rider a quarter of an hour of slack -- an estimate, and shown as one.
 */
export const PROMISE_SLACK_SECONDS = 15 * 60;

export function promiseWindow(input: {
  readonly preparation_seconds: number;
  readonly route: RouteLeg | null;
}): { readonly ready_after_seconds: number; readonly arrives_after_seconds: number | null } {
  const preparation = Math.max(0, Math.round(input.preparation_seconds));
  return Object.freeze({
    ready_after_seconds: preparation,
    arrives_after_seconds: input.route ? preparation + input.route.duration_seconds : null,
  });
}

/**
 * The routing service an application builds from its runtime configuration:
 * Mapbox with the injected token, or the estimate. The cache pool is the
 * application's own; a service without one caches nothing.
 */
export function createRoutingService(input: {
  readonly routing: {
    readonly provider: 'estimate' | 'mapbox';
    readonly mapboxAccessToken: string | undefined;
    readonly profile: RoutingProfile;
    readonly timeoutMs: number;
  };
  readonly pool?: Pick<Pool, 'query'>;
  readonly log?: (event: string, fields: Record<string, unknown>) => void;
}): RoutingService {
  const provider =
    input.routing.provider === 'mapbox' && input.routing.mapboxAccessToken
      ? new MapboxRouteProvider({
          access_token: input.routing.mapboxAccessToken,
          profile: input.routing.profile,
          timeout_ms: input.routing.timeoutMs,
        })
      : new EstimatedRouteProvider(input.routing.profile);
  return new RoutingService({
    provider,
    ...(input.pool ? { pool: input.pool } : {}),
    ...(input.log ? { log: input.log } : {}),
  });
}
