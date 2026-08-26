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

export interface StoreSummary {
  readonly vendor_location_id: UuidV7;
  readonly location_name: string;
  readonly category: string;
  readonly distance_meters: number;
  readonly minimum_order_minor: number;
  readonly currency: string;
  readonly fulfilment_modes: readonly string[];
  readonly is_open_now: boolean;
}

export interface StorefrontProduct {
  readonly catalogue_product_id: UuidV7;
  readonly product_reference: string;
  readonly title: string;
  readonly category: string;
  readonly unit_label: string;
  readonly variable_weight: boolean;
  readonly price_minor: number | null;
  readonly availability_state: string | null;
  readonly is_stale: boolean;
  readonly substitution_available: boolean;
}

export interface Storefront {
  readonly vendor_location_id: UuidV7;
  readonly location_name: string;
  readonly profile_description: string | null;
  readonly category: string;
  readonly minimum_order_minor: number;
  readonly fulfilment_modes: readonly string[];
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

const storeName = /^SYNTH [A-Za-z0-9][A-Za-z0-9 &'().,-]{1,118}$/;
const pinCode = /^[1-9][0-9]{5}$/;

// Stopwords and common synonyms kept intentionally small; the goal at this
// slice is normalized, forgiving matching, not a full language model.
const synonyms: Readonly<Record<string, readonly string[]>> = Object.freeze({
  aloo: ['potato', 'aalu'],
  pyaz: ['onion', 'pyaaz'],
  tamatar: ['tomato'],
});

function customer(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'customer') throw new CustomerDiscoveryAuthorizationError();
  return context.actor.actor_id;
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

  constructor(input: { readonly connection_string: string }) {
    this.#pool = new Pool({
      connectionString: input.connection_string,
      application_name: 'neighbourhood-store-customer-discovery',
      max: 8,
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
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
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const offset = Math.max(input.offset ?? 0, 0);
    const now = input.now ?? new Date();
    const result = await this.#pool.query<{
      vendor_location_id: string;
      location_name: string;
      category: string;
      distance_meters: string;
      minimum_order_minor: string;
      currency: string;
      fulfilment_modes: string[];
      is_open_now: boolean;
    }>(
      `SELECT l.vendor_location_id, l.location_name, l.category,
              ST_Distance(l.coordinates, a.coordinates)::text AS distance_meters,
              l.minimum_order_minor::text AS minimum_order_minor, l.currency,
              COALESCE(
                (SELECT array_agg(DISTINCT fulfilment_mode)
                   FROM marketplace.vendor_location_fulfilment_modes
                  WHERE vendor_location_id = l.vendor_location_id),
                ARRAY[]::text[]
              ) AS fulfilment_modes,
              EXISTS (
                SELECT 1 FROM marketplace.vendor_location_operating_hours h
                 WHERE h.vendor_location_id = l.vendor_location_id
                   AND h.weekday = EXTRACT(DOW FROM $3::timestamptz)::smallint
                   AND $3::timestamptz::time BETWEEN h.opens_at AND h.closes_at
              ) AS is_open_now
         FROM marketplace.customer_addresses a
         JOIN marketplace.vendor_service_zones z
           ON z.lifecycle_state = 'ACTIVE' AND ST_Covers(z.boundary, a.coordinates)
         JOIN marketplace.vendor_locations l
           ON l.vendor_location_id = z.vendor_location_id AND l.lifecycle_state = 'ACTIVE'
         JOIN marketplace.vendor_publication_cases p
           ON p.vendor_location_id = l.vendor_location_id AND p.lifecycle_state = 'PUBLISHED'
        WHERE a.customer_address_id = $1 AND a.user_id = $2 AND a.lifecycle_state = 'ACTIVE'
        ORDER BY distance_meters ASC, l.vendor_location_id ASC
        LIMIT $4 OFFSET $5`,
      [input.customer_address_id, userId, now, limit, offset],
    );
    await recordEvent(this.#pool, {
      user_id: userId,
      event_type: 'STORE_DISCOVERY',
      result_count: result.rows.length,
      context: input.context,
      now,
    });
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          vendor_location_id: parseUuidV7(row.vendor_location_id),
          location_name: row.location_name,
          category: row.category,
          distance_meters: Number(row.distance_meters),
          minimum_order_minor: Number(row.minimum_order_minor),
          currency: row.currency,
          fulfilment_modes: Object.freeze([...row.fulfilment_modes]),
          is_open_now: row.is_open_now,
        }),
      ),
    );
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
    readonly now?: Date;
  }): Promise<
    readonly {
      readonly vendor_location_id: UuidV7;
      readonly catalogue_product_id: UuidV7;
      readonly title: string;
      readonly price_minor: number | null;
      readonly is_available: boolean;
    }[]
  > {
    const userId = customer(input.context);
    const normalized = normalizeTerm(input.term);
    const terms = expandTerm(normalized);
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const now = input.now ?? new Date();

    const result = await this.#pool.query<{
      vendor_location_id: string;
      catalogue_product_id: string;
      title: string;
      price_minor: string | null;
      is_available: boolean;
    }>(
      `SELECT p.vendor_location_id, p.catalogue_product_id, p.title,
              price.price_minor::text AS price_minor,
              COALESCE(item.availability_state IN ('AVAILABLE','LOW_STOCK','VENDOR_CONFIRMS'), false)
                AS is_available
         FROM marketplace.customer_addresses a
         JOIN marketplace.vendor_service_zones z
           ON z.lifecycle_state = 'ACTIVE' AND ST_Covers(z.boundary, a.coordinates)
         JOIN marketplace.vendor_locations l
           ON l.vendor_location_id = z.vendor_location_id AND l.lifecycle_state = 'ACTIVE'
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
        WHERE a.customer_address_id = $1 AND a.user_id = $2 AND a.lifecycle_state = 'ACTIVE'
          AND (lower(p.title) LIKE ANY (SELECT '%' || unnest($3::text[]) || '%')
               OR lower(p.category) = ANY ($3::text[]))
        ORDER BY is_available DESC, p.title ASC
        LIMIT $4`,
      [input.customer_address_id, userId, terms, limit],
    );
    await this.#recordSearch(userId, normalized, input.term, now);
    await recordEvent(this.#pool, {
      user_id: userId,
      event_type: result.rows.length === 0 ? 'SEARCH_ZERO_RESULT' : 'SEARCH_RUN',
      result_count: result.rows.length,
      context: input.context,
      now,
    });
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          vendor_location_id: parseUuidV7(row.vendor_location_id),
          catalogue_product_id: parseUuidV7(row.catalogue_product_id),
          title: row.title,
          price_minor: row.price_minor === null ? null : Number(row.price_minor),
          is_available: row.is_available,
        }),
      ),
    );
  }

  async recentSearches(input: {
    readonly context: RequestContext;
  }): Promise<readonly RecentSearch[]> {
    const userId = customer(input.context);
    const result = await this.#pool.query<{ display_term: string; last_searched_at: Date }>(
      `SELECT display_term, last_searched_at FROM marketplace.customer_recent_searches
        WHERE user_id = $1 ORDER BY last_searched_at DESC LIMIT 10`,
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
  }): Promise<Storefront> {
    customer(input.context);
    const location = await this.#pool.query<{
      location_name: string;
      profile_description: string | null;
      category: string;
      minimum_order_minor: string;
      fulfilment_modes: string[];
    }>(
      `SELECT l.location_name, l.profile_description, l.category,
              l.minimum_order_minor::text AS minimum_order_minor,
              COALESCE(
                (SELECT array_agg(DISTINCT fulfilment_mode)
                   FROM marketplace.vendor_location_fulfilment_modes
                  WHERE vendor_location_id = l.vendor_location_id),
                ARRAY[]::text[]
              ) AS fulfilment_modes
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
      product_reference: string;
      title: string;
      category: string;
      unit_label: string;
      variable_weight: boolean;
      price_minor: string | null;
      availability_state: string | null;
      substitution_available: boolean;
    }>(
      `SELECT p.catalogue_product_id, p.product_reference, p.title, p.category, p.unit_label,
              p.variable_weight, price.price_minor::text AS price_minor,
              item.availability_state,
              EXISTS (
                SELECT 1 FROM marketplace.catalogue_product_substitutions s
                 WHERE s.catalogue_variant_id = v.catalogue_variant_id AND s.lifecycle_state = 'ACTIVE'
              ) AS substitution_available
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

    await recordEvent(this.#pool, {
      user_id: customer(input.context),
      event_type: 'STORE_VIEWED',
      context: input.context,
      now: new Date(),
    });

    return Object.freeze({
      vendor_location_id: input.vendor_location_id,
      location_name: store.location_name,
      profile_description: store.profile_description,
      category: store.category,
      minimum_order_minor: Number(store.minimum_order_minor),
      fulfilment_modes: Object.freeze([...store.fulfilment_modes]),
      products: Object.freeze(
        products.rows.map((row) =>
          Object.freeze({
            catalogue_product_id: parseUuidV7(row.catalogue_product_id),
            product_reference: row.product_reference,
            title: row.title,
            category: row.category,
            unit_label: row.unit_label,
            variable_weight: row.variable_weight,
            price_minor: row.price_minor === null ? null : Number(row.price_minor),
            availability_state: row.availability_state,
            is_stale: row.availability_state === null,
            substitution_available: row.substitution_available,
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
    await this.#pool.query(
      `INSERT INTO marketplace.customer_favourite_stores
         (customer_favourite_store_id, user_id, vendor_location_id)
       VALUES ($1,$2,$3) ON CONFLICT (user_id, vendor_location_id) DO NOTHING`,
      [createUuidV7(), userId, input.vendor_location_id],
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
    await this.#pool.query(
      `INSERT INTO marketplace.customer_preferred_store (user_id, vendor_location_id, updated_at)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id) DO UPDATE SET vendor_location_id = $2, updated_at = $3`,
      [userId, input.vendor_location_id, now],
    );
  }

  async clearPreferredStore(input: { readonly context: RequestContext }): Promise<void> {
    const userId = customer(input.context);
    await this.#pool.query('DELETE FROM marketplace.customer_preferred_store WHERE user_id = $1', [
      userId,
    ]);
  }

  async preferredStore(input: { readonly context: RequestContext }): Promise<UuidV7 | null> {
    const userId = customer(input.context);
    const result = await this.#pool.query<{ vendor_location_id: string }>(
      'SELECT vendor_location_id FROM marketplace.customer_preferred_store WHERE user_id = $1',
      [userId],
    );
    const row = result.rows[0];
    return row ? parseUuidV7(row.vendor_location_id) : null;
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
      throw new CustomerDiscoveryInputError('Store name must be a synthetic label');
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
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === '23505'
      )
        throw new CustomerDiscoveryConflictError('An open request already exists for this area');
      throw error;
    }
  }
}
