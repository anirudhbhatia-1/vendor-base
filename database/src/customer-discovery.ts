import {
  availabilityFreshness,
  type AvailabilityFreshness,
} from './catalogue-freshness-moderation.js';
import { releaseServicePool, resolveServicePool } from './database-pool.js';
import { RoutingService, type RouteSource } from './routing.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';

export class CustomerDiscoveryInputError extends Error {}
export class CustomerDiscoveryNotFoundError extends Error {}
export class CustomerDiscoveryConflictError extends Error {}
export class CustomerDiscoveryAuthorizationError extends Error {}

/** One product hit, always carrying the shop that sells it (MKT-01, EXC-02). */
export interface ProductSearchHit {
  readonly vendor_location_id: UuidV7;
  readonly catalogue_product_id: UuidV7;
  readonly catalogue_variant_id: UuidV7;
  readonly title: string;
  readonly price_minor: number | null;
  readonly is_available: boolean;
  /** The road to the shop selling it, so a hit can say how far and how long. */
  readonly distance_meters: number;
  readonly travel_seconds: number;
  readonly distance_source: RouteSource;
}

export interface StoreSummary {
  readonly vendor_location_id: UuidV7;
  readonly location_name: string;
  readonly category: string;
  /** By road, from the routing provider or a labelled estimate (0085); a straight line before that. */
  readonly distance_meters: number;
  readonly travel_seconds: number;
  readonly distance_source: RouteSource;
  readonly minimum_order_minor: number;
  readonly currency: string;
  readonly fulfilment_modes: readonly string[];
  readonly is_open_now: boolean;
}

export interface StorefrontProduct {
  readonly catalogue_product_id: UuidV7;
  readonly catalogue_variant_id: UuidV7;
  readonly product_reference: string;
  readonly title: string;
  readonly category: string;
  readonly unit_label: string;
  readonly variable_weight: boolean;
  readonly price_minor: number | null;
  readonly availability_state: string | null;
  /** No inventory row at all: the shop has never said whether it has this. */
  readonly is_stale: boolean;
  /**
   * How recently the shop confirmed the stock, on the tiers 5.7 defines;
   * null when there is no inventory row. Informational — it never gates a
   * purchase, because reservations prevent overselling and the shop confirms
   * at acceptance.
   */
  readonly freshness: AvailabilityFreshness | null;
  readonly last_confirmed_at: Date | null;
  /**
   * For a variable-weight product, how far the final weight may differ from
   * the ordered one, in basis points; null when the product is not sold by
   * weight or the shop set no bound.
   */
  readonly permitted_weight_variance_bps: number | null;
  readonly substitution_available: boolean;
  /**
   * Identifiers of this product's servable images, in display order.
   *
   * Only rows that actually carry stored bytes are listed — a fixture row that
   * names no object would otherwise produce a URL that 404s and a broken image
   * where a designed category placeholder belongs.
   */
  readonly image_ids: readonly string[];
}

export interface Storefront {
  readonly vendor_location_id: UuidV7;
  readonly location_name: string;
  readonly profile_description: string | null;
  readonly category: string;
  readonly minimum_order_minor: number;
  readonly fulfilment_modes: readonly string[];
  readonly operating_hours: readonly {
    readonly weekday: number;
    readonly opens_at: string;
    readonly closes_at: string;
  }[];
  readonly rating_average: number | null;
  readonly rating_count: number;
  readonly products: readonly StorefrontProduct[];
}

export interface FavouriteStore {
  readonly vendor_location_id: UuidV7;
  readonly location_name: string;
  readonly is_currently_eligible: boolean;
}

export interface RecentSearch {
  readonly display_term: string;
  readonly last_searched_at: Date;
}

export interface ShopRequest {
  readonly customer_shop_request_id: UuidV7;
  readonly store_name: string;
  readonly lifecycle_state: 'CLOSED' | 'OPEN' | 'TRIAGED';
}

/**
 * The preferred store as the customer sees it: the preference itself, plus
 * whether that store can serve the address in hand. Eligibility is derived at
 * read time and never stored, so a store that stops covering an address is
 * shown as unavailable rather than silently dropped.
 */
export interface PreferredStore {
  readonly vendor_location_id: UuidV7;
  readonly location_name: string;
  readonly is_currently_eligible: boolean;
}

/**
 * What an operator sees of a nearby-shop request. The customer's identity is
 * not part of it: the request is about a place, and the coordinates and pin
 * the customer gave for that place are what the pipeline needs.
 */
export interface ShopRequestQueueEntry extends ShopRequest {
  readonly pin_code: string;
  readonly note: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly onboarding_case_id: UuidV7 | null;
  readonly resolution: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const storeName = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} &'().,/-]{1,118}$/u;
const pinCode = /^[1-9][0-9]{5}$/;

// Stopwords and common synonyms kept intentionally small; the goal at this
// slice is normalized, forgiving matching, not a full language model.
const synonyms: Readonly<Record<string, readonly string[]>> = Object.freeze({
  aalu: ['potato', 'aloo', 'आलू'],
  aloo: ['potato', 'aalu', 'आलू'],
  आलू: ['potato', 'aloo', 'aalu'],
  pyaz: ['onion', 'pyaaz', 'प्याज', 'पियाज'],
  pyaaz: ['onion', 'pyaz', 'प्याज'],
  प्याज: ['onion', 'pyaz', 'pyaaz'],
  sabji: ['vegetable', 'sabzi', 'सब्जी'],
  sabzi: ['vegetable', 'sabji', 'सब्जी'],
  सब्जी: ['vegetable', 'sabzi', 'sabji'],
  tamatar: ['tomato', 'टमाटर'],
  टमाटर: ['tomato', 'tamatar'],
});

/**
 * Where "near me" is measured from.
 *
 * Discovery was reachable only from a saved address, which meant a visitor had
 * to sign in and save one before a single shop appeared — while
 * `architecture.md` §6.1 asks for public store pages and CUS-08 makes location
 * permission optional. Both origins produce the same one-row `origin`
 * relation, so the discovery queries are unchanged apart from where they start.
 */
/** How many in-zone stores, nearest by the line, are routed before a page is cut. */
export const DISCOVERY_ROUTED_CANDIDATES = 200;

export type DiscoveryOrigin =
  | { readonly kind: 'ADDRESS'; readonly customer_address_id: UuidV7; readonly user_id: UuidV7 }
  | { readonly kind: 'POINT'; readonly latitude: number; readonly longitude: number };

/**
 * Both forms consume exactly two placeholders, so every later parameter in the
 * discovery queries keeps its number.
 */
function originRelation(origin: DiscoveryOrigin): {
  readonly sql: string;
  readonly params: readonly [unknown, unknown];
} {
  if (origin.kind === 'ADDRESS') {
    return {
      params: [origin.customer_address_id, origin.user_id],
      sql: `SELECT a.coordinates
              FROM marketplace.customer_addresses a
             WHERE a.customer_address_id = $1 AND a.user_id = $2
               AND a.lifecycle_state = 'ACTIVE'`,
    };
  }
  return {
    // Longitude first: PostGIS takes x,y, and reversing them is the most common
    // way to place a Jaipur shop in the Indian Ocean.
    params: [origin.longitude, origin.latitude],
    sql: `SELECT ST_SetSRID(
              ST_MakePoint($1::double precision, $2::double precision), 4326
            )::geography AS coordinates`,
  };
}

function requireCoordinate(latitude: number, longitude: number): void {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new CustomerDiscoveryInputError('Latitude must be between -90 and 90');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new CustomerDiscoveryInputError('Longitude must be between -180 and 180');
  }
}

function customer(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'customer') throw new CustomerDiscoveryAuthorizationError();
  return context.actor.actor_id;
}

function admin(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'admin') throw new CustomerDiscoveryAuthorizationError();
  return context.actor.actor_id;
}

function pgErrorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : null;
}

/**
 * A preference names a store by id, and a store that does not exist is a
 * client error, not a database one. Without this the foreign-key violation
 * surfaced as a 500.
 */
async function refusingUnknownStore<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work();
  } catch (error) {
    if (pgErrorCode(error) === '23503')
      throw new CustomerDiscoveryNotFoundError('Store was not found');
    throw error;
  }
}

function normalizeTerm(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new CustomerDiscoveryInputError('Search term must be between 1 and 80 characters');
  }
  return trimmed.replace(/\s+/g, ' ');
}

function expandTerm(normalized: string): readonly string[] {
  const expansions = synonyms[normalized];
  return expansions ? [normalized, ...expansions] : [normalized];
}

async function recordEvent(
  pool: Pool,
  input: {
    readonly user_id: UuidV7;
    readonly event_type:
      | 'FAVOURITE_ADDED'
      | 'SEARCH_RUN'
      | 'SEARCH_TO_CART'
      | 'SEARCH_ZERO_RESULT'
      | 'SHOP_REQUESTED'
      | 'STORE_DISCOVERY'
      | 'STORE_VIEWED';
    readonly result_count?: number;
    readonly context: RequestContext;
    readonly now: Date;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO marketplace.customer_discovery_events
       (event_id, user_id, event_type, result_count, request_id, correlation_id, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      createUuidV7({ now_ms: input.now.getTime() }),
      input.user_id,
      input.event_type,
      input.result_count ?? 0,
      parseRequestId(input.context.request_id),
      parseUuidV7(input.context.correlation_id),
      input.now,
    ],
  );
}

export class CustomerDiscoveryService {
  readonly #pool: Pool;

  readonly #routing: RoutingService;
  constructor(input: {
    readonly connection_string: string;
    readonly pool?: Pool;
    readonly routing?: RoutingService;
  }) {
    this.#pool = resolveServicePool(input, {
      application_name: 'neighbourhood-store-customer-discovery',
      max: 8,
    });
    this.#routing = input.routing ?? new RoutingService({ pool: this.#pool });
  }

  async close(): Promise<void> {
    await releaseServicePool(this.#pool);
  }

  /**
   * Eligible = active, published, and covered by an active service zone at the
   * given address. Open/next-open and fee indication are left to the client;
   * this returns the ordering signal only.
   */
  async discoverStores(input: {
    readonly context: RequestContext;
    readonly customer_address_id: UuidV7;
    readonly limit?: number;
    readonly offset?: number;
    readonly now?: Date;
  }): Promise<readonly StoreSummary[]> {
    const userId = customer(input.context);
    const stores = await this.#discoverStores(
      {
        customer_address_id: input.customer_address_id,
        kind: 'ADDRESS',
        user_id: userId,
      },
      input,
    );
    await recordEvent(this.#pool, {
      user_id: userId,
      event_type: 'STORE_DISCOVERY',
      result_count: stores.length,
      context: input.context,
      now: input.now ?? new Date(),
    });
    return stores;
  }

  /**
   * The same feed, for someone who has not signed in yet.
   *
   * No discovery event is recorded: those are keyed to a user, and inventing an
   * identity for an anonymous visitor would corrupt the funnel reporting
   * (ADM-56) rather than improve it.
   */
  async discoverStoresNear(input: {
    readonly latitude: number;
    readonly longitude: number;
    readonly limit?: number;
    readonly offset?: number;
    readonly now?: Date;
  }): Promise<readonly StoreSummary[]> {
    requireCoordinate(input.latitude, input.longitude);
    return this.#discoverStores(
      { kind: 'POINT', latitude: input.latitude, longitude: input.longitude },
      input,
    );
  }

  async #discoverStores(
    origin: DiscoveryOrigin,
    options: { readonly limit?: number; readonly offset?: number; readonly now?: Date },
  ): Promise<readonly StoreSummary[]> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    const offset = Math.max(options.offset ?? 0, 0);
    const now = options.now ?? new Date();
    const from = originRelation(origin);
    // Every eligible store in the zone, nearest by the line first, capped so a
    // dense area stays one matrix call; the page is cut after the road is
    // known, because "nearest first" means the road, not the crow.
    const result = await this.#pool.query<{
      vendor_location_id: string;
      location_name: string;
      category: string;
      distance_meters: string;
      store_latitude: number;
      store_longitude: number;
      origin_latitude: number;
      origin_longitude: number;
      minimum_order_minor: string;
      currency: string;
      fulfilment_modes: string[];
      operating_hours: { weekday: number; opens_at: string; closes_at: string }[];
      rating_average: string | null;
      rating_count: string;
      is_open_now: boolean;
    }>(
      `WITH origin AS (${from.sql})
        SELECT l.vendor_location_id, l.location_name, l.category,
              ST_Distance(l.coordinates, a.coordinates)::text AS distance_meters,
              ST_Y(l.coordinates::geometry)::float8 AS store_latitude,
              ST_X(l.coordinates::geometry)::float8 AS store_longitude,
              ST_Y(a.coordinates::geometry)::float8 AS origin_latitude,
              ST_X(a.coordinates::geometry)::float8 AS origin_longitude,
              l.minimum_order_minor::text AS minimum_order_minor, l.currency,
              -- Platform delivery is only offered when somebody could actually
              -- perform it. Dispatch looks for a partner who is online, still
              -- eligible, and within five kilometres of the shop; promising a
              -- courier the dispatcher will never find is a promise the
              -- platform cannot keep, and the customer sees it as a bug at the
              -- worst moment. The shop's own delivery and collection stay.
              COALESCE(
                (SELECT array_agg(DISTINCT fm.fulfilment_mode)
                   FROM marketplace.vendor_location_fulfilment_modes fm
                  WHERE fm.vendor_location_id = l.vendor_location_id
                    AND (
                      fm.fulfilment_mode <> 'PLATFORM_DELIVERY'
                      OR EXISTS (
                        SELECT 1
                          FROM marketplace.partner_availability pa
                         WHERE pa.availability_state = 'ONLINE'
                           AND ST_DWithin(pa.current_coordinates, l.coordinates, 5000)
                           AND EXISTS (
                             SELECT 1 FROM marketplace.partner_eligibilities pe
                              WHERE pe.user_id = pa.partner_user_id
                                AND pe.state = 'ELIGIBLE'
                                AND (pe.eligible_until IS NULL
                                     OR pe.eligible_until > $3::timestamptz)
                           )
                      )
                    )),
                ARRAY[]::text[]
              ) AS fulfilment_modes,
              EXISTS (
                SELECT 1 FROM marketplace.vendor_location_operating_hours h
                 WHERE h.vendor_location_id = l.vendor_location_id
                   AND h.weekday = EXTRACT(DOW FROM $3::timestamptz)::smallint
                   AND $3::timestamptz::time BETWEEN h.opens_at AND h.closes_at
              ) AS is_open_now
         FROM origin a
         JOIN marketplace.vendor_locations l
           ON l.lifecycle_state = 'ACTIVE'
          -- A store reaches the address if any of its zones covers it. Joining
          -- the zones themselves listed a store once per covering zone, so a
          -- shop with two zones over one street appeared twice on the home
          -- screen (React: "two children with the same key").
          AND EXISTS (
            SELECT 1 FROM marketplace.vendor_service_zones z
             WHERE z.vendor_location_id = l.vendor_location_id
               AND z.lifecycle_state = 'ACTIVE' AND ST_Covers(z.boundary, a.coordinates)
          )
         JOIN marketplace.vendor_publication_cases p
           ON p.vendor_location_id = l.vendor_location_id AND p.lifecycle_state = 'PUBLISHED'
        ORDER BY distance_meters ASC, l.vendor_location_id ASC
        LIMIT $4`,
      [...from.params, now, DISCOVERY_ROUTED_CANDIDATES],
    );
    const first = result.rows[0];
    if (!first) return Object.freeze([]);
    const legs = await this.#routing.routeMany(
      { latitude: first.origin_latitude, longitude: first.origin_longitude },
      result.rows.map((row) => ({ latitude: row.store_latitude, longitude: row.store_longitude })),
      now,
    );
    const routed = result.rows.map((row, index) => {
      const leg = legs[index];
      if (!leg) throw new CustomerDiscoveryConflictError('A store was left without a route');
      return Object.freeze({
        vendor_location_id: parseUuidV7(row.vendor_location_id),
        location_name: row.location_name,
        category: row.category,
        distance_meters: leg.distance_metres,
        travel_seconds: leg.duration_seconds,
        distance_source: leg.source,
        minimum_order_minor: Number(row.minimum_order_minor),
        currency: row.currency,
        fulfilment_modes: Object.freeze([...row.fulfilment_modes]),
        is_open_now: row.is_open_now,
      });
    });
    routed.sort(
      (left, right) =>
        left.distance_meters - right.distance_meters ||
        left.vendor_location_id.localeCompare(right.vendor_location_id),
    );
    return Object.freeze(routed.slice(offset, offset + limit));
  }

  /**
   * Product search ranks eligible-available results ahead of unavailable ones,
   * normalizes the term and expands a small synonym set, and is scoped to
   * stores eligible for the given address so results are always orderable.
   */
  async searchProducts(input: {
    readonly context: RequestContext;
    readonly customer_address_id: UuidV7;
    readonly term: string;
    readonly limit?: number;
    readonly category?: string;
    readonly available_only?: boolean;
    readonly fulfilment_mode?: string;
    readonly max_distance_meters?: number;
    readonly now?: Date;
  }): Promise<readonly ProductSearchHit[]> {
    const userId = customer(input.context);
    const normalized = normalizeTerm(input.term);
    const now = input.now ?? new Date();
    const results = await this.#searchProducts(
      {
        customer_address_id: input.customer_address_id,
        kind: 'ADDRESS',
        user_id: userId,
      },
      input,
    );
    await this.#recordSearch(userId, normalized, input.term, now);
    await recordEvent(this.#pool, {
      user_id: userId,
      event_type: results.length === 0 ? 'SEARCH_ZERO_RESULT' : 'SEARCH_RUN',
      result_count: results.length,
      context: input.context,
      now,
    });
    return results;
  }

  /**
   * The same ranked product search, before sign-in.
   *
   * Neither the search history (CUS-17) nor the funnel event is written: both
   * belong to a person, and an anonymous visitor is not one.
   */
  async searchProductsNear(input: {
    readonly latitude: number;
    readonly longitude: number;
    readonly term: string;
    readonly limit?: number;
    readonly category?: string;
    readonly available_only?: boolean;
    readonly fulfilment_mode?: string;
    readonly max_distance_meters?: number;
  }): Promise<readonly ProductSearchHit[]> {
    requireCoordinate(input.latitude, input.longitude);
    return this.#searchProducts(
      { kind: 'POINT', latitude: input.latitude, longitude: input.longitude },
      input,
    );
  }

  async #searchProducts(
    origin: DiscoveryOrigin,
    options: {
      readonly term: string;
      readonly limit?: number;
      readonly category?: string;
      readonly available_only?: boolean;
      readonly fulfilment_mode?: string;
      readonly max_distance_meters?: number;
    },
  ): Promise<readonly ProductSearchHit[]> {
    const normalized = normalizeTerm(options.term);
    const terms = expandTerm(normalized);
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    const from = originRelation(origin);

    const result = await this.#pool.query<{
      vendor_location_id: string;
      catalogue_product_id: string;
      catalogue_variant_id: string;
      title: string;
      price_minor: string | null;
      is_available: boolean;
      store_latitude: number;
      store_longitude: number;
      origin_latitude: number;
      origin_longitude: number;
    }>(
      `WITH origin AS (${from.sql})
        SELECT p.vendor_location_id, p.catalogue_product_id, v.catalogue_variant_id, p.title,
              price.price_minor::text AS price_minor,
              ST_Y(l.coordinates::geometry)::float8 AS store_latitude,
              ST_X(l.coordinates::geometry)::float8 AS store_longitude,
              ST_Y(a.coordinates::geometry)::float8 AS origin_latitude,
              ST_X(a.coordinates::geometry)::float8 AS origin_longitude,
              COALESCE(item.availability_state IN ('AVAILABLE','LOW_STOCK','VENDOR_CONFIRMS'), false)
                AS is_available
         FROM origin a
         JOIN marketplace.vendor_locations l
           ON l.lifecycle_state = 'ACTIVE'
          AND EXISTS (
            SELECT 1 FROM marketplace.vendor_service_zones z
             WHERE z.vendor_location_id = l.vendor_location_id
               AND z.lifecycle_state = 'ACTIVE' AND ST_Covers(z.boundary, a.coordinates)
          )
         JOIN marketplace.vendor_publication_cases pub
           ON pub.vendor_location_id = l.vendor_location_id AND pub.lifecycle_state = 'PUBLISHED'
         JOIN marketplace.catalogue_products p
           ON p.vendor_location_id = l.vendor_location_id AND p.lifecycle_state = 'ACTIVE'
         LEFT JOIN marketplace.catalogue_product_variants v
           ON v.catalogue_product_id = p.catalogue_product_id AND v.lifecycle_state = 'ACTIVE'
         LEFT JOIN LATERAL (
           SELECT price_minor FROM marketplace.catalogue_prices cp
            WHERE cp.catalogue_variant_id = v.catalogue_variant_id AND cp.effective_until IS NULL
         ) price ON true
         LEFT JOIN marketplace.inventory_items item
           ON item.vendor_location_id = p.vendor_location_id
          AND item.product_reference = p.product_reference
        WHERE (p.search_document @@ plainto_tsquery('simple', $3)
               OR lower(p.title) LIKE ANY (SELECT '%' || unnest($4::text[]) || '%')
               OR lower(p.category) = ANY ($4::text[])
               -- Requirement 1 lists "store" among the term kinds to normalize, and
               -- the store name appeared in no WHERE clause anywhere in this file:
               -- typing a shop's name returned nothing, from any surface. Matched
               -- against the expanded term array so a store name gets the same
               -- synonym and transliteration handling a product title gets.
               OR lower(l.location_name) LIKE ANY (SELECT '%' || unnest($4::text[]) || '%')
               -- Requirement 1 asks for common misspellings, and trigram
               -- similarity appeared only in the ORDER BY, where it can rerank
               -- matches but never produce one: a misspelling was findable only
               -- if somebody had enumerated it in the synonym table, so
               -- "tomatoe" returned nothing at all. The %> operator is word
               -- similarity, so
               -- it compares the term against the closest word in the title
               -- rather than the whole string, which a long product title would
               -- otherwise dilute below any useful threshold. Uses the existing
               -- catalogue_products_title_trigram GIN index.
               OR lower(p.title) %> $3)
          AND ($5::text IS NULL OR p.category=$5)
          AND ($6::boolean=false OR COALESCE(item.availability_state IN ('AVAILABLE','LOW_STOCK','VENDOR_CONFIRMS'),false))
          AND ($7::text IS NULL OR EXISTS (SELECT 1 FROM marketplace.vendor_location_fulfilment_modes fm WHERE fm.vendor_location_id=l.vendor_location_id AND fm.fulfilment_mode=$7))
          -- The line never exceeds the road, so this only discards stores the
          -- road check below could not keep; the road decides the rest.
          AND ($8::integer IS NULL OR ST_Distance(l.coordinates,a.coordinates) <= $8)
        ORDER BY is_available DESC,
                 ts_rank(p.search_document, plainto_tsquery('simple', $3)) DESC,
                 similarity(lower(p.title), $3) DESC, p.title ASC,
                 p.catalogue_product_id ASC
        LIMIT $9`,
      [
        ...from.params,
        normalized,
        terms,
        options.category ?? null,
        options.available_only ?? false,
        options.fulfilment_mode ?? null,
        options.max_distance_meters ?? null,
        limit,
      ],
    );
    const firstHit = result.rows[0];
    if (!firstHit) return Object.freeze([]);
    // One road per distinct store, however many of its products matched.
    const stores = [...new Map(result.rows.map((row) => [row.vendor_location_id, row])).values()];
    const legs = await this.#routing.routeMany(
      { latitude: firstHit.origin_latitude, longitude: firstHit.origin_longitude },
      stores.map((row) => ({ latitude: row.store_latitude, longitude: row.store_longitude })),
      new Date(),
    );
    const roadByStore = new Map(stores.map((row, index) => [row.vendor_location_id, legs[index]]));
    return Object.freeze(
      result.rows.flatMap((row) => {
        const leg = roadByStore.get(row.vendor_location_id);
        if (!leg) throw new CustomerDiscoveryConflictError('A store was left without a route');
        if (
          options.max_distance_meters !== undefined &&
          leg.distance_metres > options.max_distance_meters
        ) {
          return [];
        }
        return [
          Object.freeze({
            vendor_location_id: parseUuidV7(row.vendor_location_id),
            catalogue_product_id: parseUuidV7(row.catalogue_product_id),
            catalogue_variant_id: parseUuidV7(row.catalogue_variant_id),
            title: row.title,
            price_minor: row.price_minor === null ? null : Number(row.price_minor),
            is_available: row.is_available,
            distance_meters: leg.distance_metres,
            travel_seconds: leg.duration_seconds,
            distance_source: leg.source,
          }),
        ];
      }),
    );
  }

  /**
   * Requirement 5 of step 6.3 measures zero-result *and* search-to-cart outcomes.
   * The zero-result half was recorded from the first slice; SEARCH_TO_CART existed
   * only as a member of the event-type union and was never written by anything, so
   * half the funnel this step asks for could not be measured at all.
   *
   * Attribution is explicit rather than inferred. Treating "this customer searched
   * a few minutes ago" as conversion would invent a measurement definition nobody
   * approved, and would silently count adds that had nothing to do with a search.
   * The caller states the add came from search results; unattributed adds are not
   * counted, so this metric is a lower bound rather than a guess.
   */
  async recordSearchToCart(input: {
    readonly context: RequestContext;
    readonly now?: Date;
  }): Promise<void> {
    const userId = customer(input.context);
    await recordEvent(this.#pool, {
      context: input.context,
      event_type: 'SEARCH_TO_CART',
      now: input.now ?? new Date(),
      result_count: 1,
      user_id: userId,
    });
  }

  async recentSearches(input: {
    readonly context: RequestContext;
  }): Promise<readonly RecentSearch[]> {
    const userId = customer(input.context);
    const result = await this.#pool.query<{ display_term: string; last_searched_at: Date }>(
      `SELECT display_term, last_searched_at FROM marketplace.customer_recent_searches
        WHERE user_id = $1 ORDER BY last_searched_at DESC, customer_recent_search_id ASC LIMIT 10`,
      [userId],
    );
    return Object.freeze(result.rows.map((row) => Object.freeze({ ...row })));
  }

  async deleteRecentSearch(input: {
    readonly context: RequestContext;
    readonly display_term: string;
  }): Promise<void> {
    const userId = customer(input.context);
    await this.#pool.query(
      `DELETE FROM marketplace.customer_recent_searches
        WHERE user_id = $1 AND normalized_term = $2`,
      [userId, normalizeTerm(input.display_term)],
    );
  }

  async #recordSearch(
    userId: UuidV7,
    normalized: string,
    display: string,
    now: Date,
  ): Promise<void> {
    await this.#pool.query(
      `INSERT INTO marketplace.customer_recent_searches
         (customer_recent_search_id, user_id, normalized_term, display_term, last_searched_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, normalized_term)
       DO UPDATE SET display_term = $4, last_searched_at = $5`,
      [createUuidV7({ now_ms: now.getTime() }), userId, normalized, display.trim(), now],
    );
  }

  /**
   * The full storefront: identity, category, minimum, fulfilment modes, and
   * every currently active product joined to its live price and freshness
   * label. Products carrying an active correction-required or restricted
   * moderation case never appear here — cross-vendor catalogue mixing is
   * structurally impossible because every join is pinned to one
   * vendor_location_id.
   */
  async storefront(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly now?: Date;
  }): Promise<Storefront> {
    const now = input.now ?? new Date();
    const storefront = await this.#storefront(input.vendor_location_id, now);
    await recordEvent(this.#pool, {
      user_id: customer(input.context),
      event_type: 'STORE_VIEWED',
      context: input.context,
      now,
    });
    return storefront;
  }

  /**
   * The same store page, before sign-in.
   *
   * The projection already carries nothing personal — it is parameterised by
   * the location alone and joins `vendor_publication_cases` on PUBLISHED — so
   * this is the store page `architecture.md` §6.1 asks to be public, minus the
   * per-user view event.
   */
  async publicStorefront(input: {
    readonly vendor_location_id: UuidV7;
    readonly now?: Date;
  }): Promise<Storefront> {
    return this.#storefront(input.vendor_location_id, input.now ?? new Date());
  }

  async #storefront(vendorLocationId: UuidV7, now: Date): Promise<Storefront> {
    const input = { vendor_location_id: vendorLocationId };
    const location = await this.#pool.query<{
      location_name: string;
      profile_description: string | null;
      category: string;
      minimum_order_minor: string;
      fulfilment_modes: string[];
      operating_hours: { weekday: number; opens_at: string; closes_at: string }[];
      rating_average: string | null;
      rating_count: string;
    }>(
      `SELECT l.location_name, l.profile_description, l.category,
              l.minimum_order_minor::text AS minimum_order_minor,
              -- Same capacity test the store list applies, so a shop's own page
              -- never offers a delivery mode the list withheld.
              COALESCE(
                (SELECT array_agg(DISTINCT fm.fulfilment_mode)
                   FROM marketplace.vendor_location_fulfilment_modes fm
                  WHERE fm.vendor_location_id = l.vendor_location_id
                    AND (
                      fm.fulfilment_mode <> 'PLATFORM_DELIVERY'
                      OR EXISTS (
                        SELECT 1
                          FROM marketplace.partner_availability pa
                         WHERE pa.availability_state = 'ONLINE'
                           AND ST_DWithin(pa.current_coordinates, l.coordinates, 5000)
                           AND EXISTS (
                             SELECT 1 FROM marketplace.partner_eligibilities pe
                              WHERE pe.user_id = pa.partner_user_id
                                AND pe.state = 'ELIGIBLE'
                                AND (pe.eligible_until IS NULL
                                     OR pe.eligible_until > clock_timestamp())
                           )
                      )
                    )),
                ARRAY[]::text[]
              ) AS fulfilment_modes
              ,COALESCE((SELECT json_agg(json_build_object('weekday',weekday,'opens_at',opens_at,'closes_at',closes_at) ORDER BY weekday,opens_at) FROM marketplace.vendor_location_operating_hours WHERE vendor_location_id=l.vendor_location_id),'[]') AS operating_hours
              ,(SELECT avg(r.stars)::numeric(3,2)::text FROM marketplace.vendor_order_ratings r JOIN marketplace.vendor_orders vo USING(vendor_order_id) WHERE vo.vendor_location_id=l.vendor_location_id) AS rating_average
              ,(SELECT count(*)::text FROM marketplace.vendor_order_ratings r JOIN marketplace.vendor_orders vo USING(vendor_order_id) WHERE vo.vendor_location_id=l.vendor_location_id) AS rating_count
         FROM marketplace.vendor_locations l
         JOIN marketplace.vendor_publication_cases pub
           ON pub.vendor_location_id = l.vendor_location_id AND pub.lifecycle_state = 'PUBLISHED'
        WHERE l.vendor_location_id = $1 AND l.lifecycle_state = 'ACTIVE'`,
      [input.vendor_location_id],
    );
    const store = location.rows[0];
    if (!store) throw new CustomerDiscoveryNotFoundError('Store is not discoverable');

    const products = await this.#pool.query<{
      catalogue_product_id: string;
      catalogue_variant_id: string;
      product_reference: string;
      title: string;
      category: string;
      unit_label: string;
      variable_weight: boolean;
      permitted_weight_variance_bps: number | null;
      price_minor: string | null;
      availability_state: string | null;
      last_confirmed_at: Date | null;
      substitution_available: boolean;
      image_ids: string[];
    }>(
      `SELECT p.catalogue_product_id, v.catalogue_variant_id, p.product_reference, p.title, p.category, p.unit_label,
              p.variable_weight, p.permitted_weight_variance_bps, price.price_minor::text AS price_minor,
              item.availability_state, item.last_confirmed_at,
              EXISTS (
                SELECT 1 FROM marketplace.catalogue_product_substitutions s
                 WHERE s.catalogue_variant_id = v.catalogue_variant_id AND s.lifecycle_state = 'ACTIVE'
              ) AS substitution_available
              ,COALESCE(
                (SELECT array_agg(i.catalogue_image_id::text ORDER BY i.position)
                   FROM marketplace.catalogue_product_images i
                  WHERE i.catalogue_product_id = p.catalogue_product_id
                    AND i.content_sha256 IS NOT NULL),
                ARRAY[]::text[]
              ) AS image_ids
         FROM marketplace.catalogue_products p
         LEFT JOIN marketplace.catalogue_product_variants v
           ON v.catalogue_product_id = p.catalogue_product_id AND v.lifecycle_state = 'ACTIVE'
         LEFT JOIN LATERAL (
           SELECT price_minor FROM marketplace.catalogue_prices cp
            WHERE cp.catalogue_variant_id = v.catalogue_variant_id AND cp.effective_until IS NULL
         ) price ON true
         LEFT JOIN marketplace.inventory_items item
           ON item.vendor_location_id = p.vendor_location_id
          AND item.product_reference = p.product_reference
        WHERE p.vendor_location_id = $1 AND p.lifecycle_state = 'ACTIVE'
          AND NOT EXISTS (
            SELECT 1 FROM marketplace.catalogue_moderation_cases m
             WHERE m.inventory_item_id = item.inventory_item_id
               AND m.moderation_state IN ('CORRECTION_REQUIRED', 'RESTRICTED')
          )
        ORDER BY p.title ASC, p.catalogue_product_id ASC`,
      [input.vendor_location_id],
    );

    return Object.freeze({
      vendor_location_id: input.vendor_location_id,
      location_name: store.location_name,
      profile_description: store.profile_description,
      category: store.category,
      minimum_order_minor: Number(store.minimum_order_minor),
      fulfilment_modes: Object.freeze([...store.fulfilment_modes]),
      operating_hours: Object.freeze(
        store.operating_hours.map((hour) => Object.freeze({ ...hour })),
      ),
      rating_average: store.rating_average === null ? null : Number(store.rating_average),
      rating_count: Number(store.rating_count),
      products: Object.freeze(
        products.rows.map((row) =>
          Object.freeze({
            catalogue_product_id: parseUuidV7(row.catalogue_product_id),
            catalogue_variant_id: parseUuidV7(row.catalogue_variant_id),
            product_reference: row.product_reference,
            title: row.title,
            category: row.category,
            unit_label: row.unit_label,
            variable_weight: row.variable_weight,
            price_minor: row.price_minor === null ? null : Number(row.price_minor),
            availability_state: row.availability_state,
            is_stale: row.availability_state === null,
            freshness:
              row.last_confirmed_at === null
                ? null
                : availabilityFreshness(row.last_confirmed_at, now),
            last_confirmed_at: row.last_confirmed_at,
            permitted_weight_variance_bps:
              row.permitted_weight_variance_bps === null
                ? null
                : Number(row.permitted_weight_variance_bps),
            substitution_available: row.substitution_available,
            image_ids: Object.freeze([...row.image_ids]),
          }),
        ),
      ),
    });
  }

  async addFavourite(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly now?: Date;
  }): Promise<void> {
    const userId = customer(input.context);
    await refusingUnknownStore(() =>
      this.#pool.query(
        `INSERT INTO marketplace.customer_favourite_stores
           (customer_favourite_store_id, user_id, vendor_location_id)
         VALUES ($1,$2,$3) ON CONFLICT (user_id, vendor_location_id) DO NOTHING`,
        [createUuidV7(), userId, input.vendor_location_id],
      ),
    );
    await recordEvent(this.#pool, {
      user_id: userId,
      event_type: 'FAVOURITE_ADDED',
      context: input.context,
      now: input.now ?? new Date(),
    });
  }

  async removeFavourite(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
  }): Promise<void> {
    const userId = customer(input.context);
    await this.#pool.query(
      `DELETE FROM marketplace.customer_favourite_stores
        WHERE user_id = $1 AND vendor_location_id = $2`,
      [userId, input.vendor_location_id],
    );
  }

  async listFavourites(input: {
    readonly context: RequestContext;
    readonly customer_address_id?: UuidV7;
  }): Promise<readonly FavouriteStore[]> {
    const userId = customer(input.context);
    const result = await this.#pool.query<{
      vendor_location_id: string;
      location_name: string;
      is_currently_eligible: boolean;
    }>(
      `SELECT f.vendor_location_id, l.location_name,
              ($2::uuid IS NOT NULL AND EXISTS (
                SELECT 1 FROM marketplace.customer_addresses a
                JOIN marketplace.vendor_service_zones z
                  ON z.vendor_location_id = f.vendor_location_id AND z.lifecycle_state = 'ACTIVE'
                 AND ST_Covers(z.boundary, a.coordinates)
                WHERE a.customer_address_id = $2 AND a.user_id = $1
              )) AS is_currently_eligible
         FROM marketplace.customer_favourite_stores f
         JOIN marketplace.vendor_locations l ON l.vendor_location_id = f.vendor_location_id
        WHERE f.user_id = $1
        ORDER BY f.created_at DESC`,
      [userId, input.customer_address_id ?? null],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          vendor_location_id: parseUuidV7(row.vendor_location_id),
          location_name: row.location_name,
          is_currently_eligible: row.is_currently_eligible,
        }),
      ),
    );
  }

  /**
   * Exactly one preferred store per customer. Eligibility is never checked
   * here and the preference is never deleted by an eligibility change — the
   * caller re-derives eligibility at read time, same as favourites.
   */
  async setPreferredStore(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly now?: Date;
  }): Promise<void> {
    const userId = customer(input.context);
    const now = input.now ?? new Date();
    await refusingUnknownStore(() =>
      this.#pool.query(
        `INSERT INTO marketplace.customer_preferred_store (user_id, vendor_location_id, updated_at)
         VALUES ($1,$2,$3)
         ON CONFLICT (user_id) DO UPDATE SET vendor_location_id = $2, updated_at = $3`,
        [userId, input.vendor_location_id, now],
      ),
    );
  }

  async clearPreferredStore(input: { readonly context: RequestContext }): Promise<void> {
    const userId = customer(input.context);
    await this.#pool.query('DELETE FROM marketplace.customer_preferred_store WHERE user_id = $1', [
      userId,
    ]);
  }

  async preferredStore(input: {
    readonly context: RequestContext;
    readonly customer_address_id?: UuidV7;
  }): Promise<PreferredStore | null> {
    const userId = customer(input.context);
    const result = await this.#pool.query<{
      vendor_location_id: string;
      location_name: string;
      is_currently_eligible: boolean;
    }>(
      `SELECT p.vendor_location_id, l.location_name,
              ($2::uuid IS NOT NULL AND EXISTS (
                SELECT 1 FROM marketplace.customer_addresses a
                JOIN marketplace.vendor_service_zones z
                  ON z.vendor_location_id = p.vendor_location_id AND z.lifecycle_state = 'ACTIVE'
                 AND ST_Covers(z.boundary, a.coordinates)
                WHERE a.customer_address_id = $2 AND a.user_id = $1
              )) AS is_currently_eligible
         FROM marketplace.customer_preferred_store p
         JOIN marketplace.vendor_locations l ON l.vendor_location_id = p.vendor_location_id
        WHERE p.user_id = $1`,
      [userId, input.customer_address_id ?? null],
    );
    const row = result.rows[0];
    return row
      ? Object.freeze({
          vendor_location_id: parseUuidV7(row.vendor_location_id),
          location_name: row.location_name,
          is_currently_eligible: row.is_currently_eligible,
        })
      : null;
  }

  /**
   * One open request per (customer, pin) prevents duplicate-request spam
   * without blocking a genuinely new request from the same customer once the
   * prior one is triaged or closed.
   */
  async requestShop(input: {
    readonly context: RequestContext;
    readonly pin_code: string;
    readonly latitude: number;
    readonly longitude: number;
    readonly store_name: string;
    readonly note?: string | null;
    readonly now?: Date;
  }): Promise<ShopRequest> {
    const userId = customer(input.context);
    if (!pinCode.test(input.pin_code))
      throw new CustomerDiscoveryInputError('Pin code must be six digits');
    if (!storeName.test(input.store_name))
      throw new CustomerDiscoveryInputError('Store name contains unsupported characters');
    const note = input.note?.trim() || null;
    if (note !== null && (note.length < 1 || note.length > 240))
      throw new CustomerDiscoveryInputError('Note must be between 1 and 240 characters');
    const now = input.now ?? new Date();
    const ids = {
      request: parseRequestId(input.context.request_id),
      correlation: parseUuidV7(input.context.correlation_id),
    };
    try {
      const inserted = await this.#pool.query<{
        customer_shop_request_id: string;
        store_name: string;
        lifecycle_state: ShopRequest['lifecycle_state'];
      }>(
        `INSERT INTO marketplace.customer_shop_requests
           (customer_shop_request_id, user_id, pin_code, coordinates, store_name, note,
            request_id, correlation_id, created_at, updated_at)
         VALUES ($1,$2,$3,ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,$6,$7,$8,$9,$10,$10)
         RETURNING customer_shop_request_id, store_name, lifecycle_state`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          userId,
          input.pin_code,
          input.longitude,
          input.latitude,
          input.store_name,
          note,
          ids.request,
          ids.correlation,
          now,
        ],
      );
      const row = inserted.rows[0];
      if (!row) throw new CustomerDiscoveryConflictError('Shop request was not created');
      await recordEvent(this.#pool, {
        user_id: userId,
        event_type: 'SHOP_REQUESTED',
        context: input.context,
        now,
      });
      return Object.freeze({
        customer_shop_request_id: parseUuidV7(row.customer_shop_request_id),
        store_name: row.store_name,
        lifecycle_state: row.lifecycle_state,
      });
    } catch (error) {
      if (pgErrorCode(error) === '23505')
        throw new CustomerDiscoveryConflictError('An open request already exists for this area');
      throw error;
    }
  }

  /**
   * The pipeline side of a request (requirement 4): the queue an operator
   * reads, oldest first, optionally narrowed to one state.
   */
  async listShopRequests(input: {
    readonly context: RequestContext;
    readonly state?: ShopRequest['lifecycle_state'];
  }): Promise<readonly ShopRequestQueueEntry[]> {
    admin(input.context);
    const result = await this.#pool.query<ShopRequestQueueRow>(
      `${SHOP_REQUEST_SELECT}
        WHERE ($1::text IS NULL OR r.lifecycle_state = $1)
        ORDER BY r.created_at
        LIMIT 200`,
      [input.state ?? null],
    );
    return Object.freeze(result.rows.map(shopRequestEntry));
  }

  /**
   * OPEN -> TRIAGED. The operator may name the onboarding lead the request
   * became; the lead itself is created through vendor onboarding, whose case
   * numbering and audit this module does not own.
   */
  async triageShopRequest(input: {
    readonly context: RequestContext;
    readonly customer_shop_request_id: UuidV7;
    readonly onboarding_case_id?: UuidV7 | null;
    readonly now?: Date;
  }): Promise<ShopRequestQueueEntry> {
    const adminId = admin(input.context);
    const now = input.now ?? new Date();
    let result;
    try {
      result = await this.#pool.query<ShopRequestQueueRow>(
        `WITH moved AS (
           UPDATE marketplace.customer_shop_requests
              SET lifecycle_state = 'TRIAGED', handled_by_user_id = $2,
                  onboarding_case_id = $3, updated_at = $4
            WHERE customer_shop_request_id = $1 AND lifecycle_state = 'OPEN'
            RETURNING *)
         ${SHOP_REQUEST_SELECT.replace('marketplace.customer_shop_requests r', 'moved r')}`,
        [input.customer_shop_request_id, adminId, input.onboarding_case_id ?? null, now],
      );
    } catch (error) {
      if (pgErrorCode(error) === '23503')
        throw new CustomerDiscoveryNotFoundError('Onboarding case was not found');
      throw error;
    }
    const row = result.rows[0];
    if (row) return shopRequestEntry(row);
    throw await this.#shopRequestRefusal(input.customer_shop_request_id, 'triaged');
  }

  /** OPEN or TRIAGED -> CLOSED, with the reason the customer would be told. */
  async closeShopRequest(input: {
    readonly context: RequestContext;
    readonly customer_shop_request_id: UuidV7;
    readonly resolution: string;
    readonly now?: Date;
  }): Promise<ShopRequestQueueEntry> {
    const adminId = admin(input.context);
    const resolution = input.resolution.trim();
    if (resolution.length < 1 || resolution.length > 240)
      throw new CustomerDiscoveryInputError('Resolution must be between 1 and 240 characters');
    const now = input.now ?? new Date();
    const result = await this.#pool.query<ShopRequestQueueRow>(
      `WITH moved AS (
         UPDATE marketplace.customer_shop_requests
            SET lifecycle_state = 'CLOSED', handled_by_user_id = $2, resolution = $3,
                updated_at = $4
          WHERE customer_shop_request_id = $1 AND lifecycle_state IN ('OPEN', 'TRIAGED')
          RETURNING *)
       ${SHOP_REQUEST_SELECT.replace('marketplace.customer_shop_requests r', 'moved r')}`,
      [input.customer_shop_request_id, adminId, resolution, now],
    );
    const row = result.rows[0];
    if (row) return shopRequestEntry(row);
    throw await this.#shopRequestRefusal(input.customer_shop_request_id, 'closed');
  }

  /** Why a transition matched no row: the request is missing, or not in a state it can leave. */
  async #shopRequestRefusal(requestId: UuidV7, verb: string): Promise<Error> {
    const current = await this.#pool.query<{ lifecycle_state: string }>(
      'SELECT lifecycle_state FROM marketplace.customer_shop_requests WHERE customer_shop_request_id = $1',
      [requestId],
    );
    const state = current.rows[0]?.lifecycle_state;
    return state
      ? new CustomerDiscoveryConflictError(`A ${state} shop request cannot be ${verb}`)
      : new CustomerDiscoveryNotFoundError('Shop request was not found');
  }
}

interface ShopRequestQueueRow {
  customer_shop_request_id: string;
  store_name: string;
  lifecycle_state: ShopRequest['lifecycle_state'];
  pin_code: string;
  note: string | null;
  latitude: number;
  longitude: number;
  onboarding_case_id: string | null;
  resolution: string | null;
  created_at: Date;
  updated_at: Date;
}

const SHOP_REQUEST_SELECT = `SELECT r.customer_shop_request_id, r.store_name, r.lifecycle_state, r.pin_code, r.note,
              ST_Y(r.coordinates::geometry) AS latitude, ST_X(r.coordinates::geometry) AS longitude,
              r.onboarding_case_id, r.resolution, r.created_at, r.updated_at
         FROM marketplace.customer_shop_requests r`;

function shopRequestEntry(row: ShopRequestQueueRow): ShopRequestQueueEntry {
  return Object.freeze({
    customer_shop_request_id: parseUuidV7(row.customer_shop_request_id),
    store_name: row.store_name,
    lifecycle_state: row.lifecycle_state,
    pin_code: row.pin_code,
    note: row.note,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    onboarding_case_id: row.onboarding_case_id ? parseUuidV7(row.onboarding_case_id) : null,
    resolution: row.resolution,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}
