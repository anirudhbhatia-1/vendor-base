import { createDatabasePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import { transaction as tx } from './transaction.js';
import { resolveConfiguration } from './versioned-configuration.js';

export class CustomerCartInputError extends Error {}
export class CustomerCartNotFoundError extends Error {}
export class CustomerCartConflictError extends Error {}
export class CustomerCartAuthorizationError extends Error {}
/**
 * The customer asked to receive a group in a way the store does not offer.
 * Carries the modes it does offer, which is what the customer needs to fix it.
 */
export class CustomerCartFulfilmentMethodError extends Error {
  readonly code = 'FULFILMENT_METHOD_UNAVAILABLE';
  constructor(readonly offered_modes: readonly FulfilmentMethod[]) {
    super('This store does not offer that fulfilment method');
  }
}

/** Applied when no active `customer.cart_group_limit` configuration exists. */
export const DEFAULT_CART_GROUP_LIMIT = 3;
/** The most stores one cart may hold under any configuration: a ceiling on the ceiling. */
export const MAX_CART_GROUP_LIMIT = 10;

export type FulfilmentMethod = 'CUSTOMER_PICKUP' | 'PLATFORM_DELIVERY' | 'VENDOR_DELIVERY';

/**
 * The method a new store group starts with when the customer has not chosen
 * one: platform delivery where the store offers it, otherwise the first of
 * these it does offer. A group used to start as PLATFORM_DELIVERY regardless,
 * so a pickup-only shop's group was born with a method it could never fulfil.
 */
const DEFAULT_METHOD_PREFERENCE: readonly FulfilmentMethod[] = [
  'PLATFORM_DELIVERY',
  'VENDOR_DELIVERY',
  'CUSTOMER_PICKUP',
];

async function approvedFulfilmentModes(
  client: Pick<PoolClient, 'query'>,
  vendorLocationId: string,
): Promise<readonly FulfilmentMethod[]> {
  const modes = await client.query<{ fulfilment_mode: FulfilmentMethod }>(
    `SELECT fulfilment_mode FROM marketplace.vendor_location_fulfilment_modes
      WHERE vendor_location_id = $1 AND approval_state = 'APPROVED'
      ORDER BY fulfilment_mode`,
    [vendorLocationId],
  );
  return Object.freeze(modes.rows.map((row) => row.fulfilment_mode));
}
export type SubstitutionPreference = 'ALLOW_SAME_STORE' | 'ASK_CUSTOMER' | 'NO_SUBSTITUTION';

export interface CartLine {
  readonly cart_line_id: UuidV7;
  readonly catalogue_variant_id: UuidV7;
  readonly catalogue_product_id: UuidV7;
  readonly quantity: number;
  readonly substitution_preference: SubstitutionPreference;
  readonly lifecycle_state: 'ACTIVE' | 'REMOVED' | 'STALE';
  readonly version: number;
  /**
   * Presentation facts resolved from the current catalogue.
   *
   * The read model previously returned identifiers only, so every cart screen
   * had nothing to render but `catalogue_variant_id.slice(0, 12)` — a customer
   * was shown a UUID fragment where the product name belongs. These are the
   * *current* catalogue values, deliberately: a cart is not an order and holds
   * no price snapshot, which is why the quote revalidates before checkout.
   */
  readonly title: string;
  readonly unit_label: string;
  readonly category: string;
  readonly variable_weight: boolean;
  readonly image_reference: string | null;
  readonly unit_price_minor: number | null;
  readonly line_total_minor: number | null;
}

export interface CartVendorGroup {
  readonly cart_vendor_group_id: UuidV7;
  readonly vendor_location_id: UuidV7;
  readonly fulfilment_method: FulfilmentMethod;
  readonly customer_note: string | null;
  readonly tip_minor: number;
  readonly lifecycle_state: 'ACTIVE' | 'INVALID' | 'REMOVED';
  readonly version: number;
  readonly lines: readonly CartLine[];
  /**
   * The named store this group belongs to, and whether it can be ordered from.
   *
   * MKT-01 and CUS-30 make the vendor group the organising unit of the cart, so
   * a group that cannot say which shop it is, or whether its minimum is met, is
   * not showing the customer the thing the architecture says they chose.
   * `subtotal_minor` is null when any line has no active price — an unpriced
   * line makes the sum a guess, and a guessed total is worse than none.
   */
  readonly location_name: string;
  readonly minimum_order_minor: number;
  readonly subtotal_minor: number | null;
  readonly minimum_met: boolean;
  readonly fulfilment_modes: readonly string[];
  /**
   * Whether the store currently offers `fulfilment_method`. False only when a
   * mode was withdrawn after the group chose it; the quote blocks such a group,
   * and the customer's repair is to choose one of `fulfilment_modes`.
   */
  readonly fulfilment_method_offered: boolean;
}

export interface Cart {
  readonly cart_id: UuidV7;
  readonly customer_address_id: UuidV7 | null;
  readonly lifecycle_state: 'ABANDONED' | 'ACTIVE' | 'CHECKED_OUT';
  readonly version: number;
  readonly groups: readonly CartVendorGroup[];
}

export interface RevalidationOutcome {
  readonly cart_vendor_group_id: UuidV7;
  readonly vendor_location_id: UuidV7;
  readonly invalidated: boolean;
  readonly reason: string | null;
  readonly stale_line_ids: readonly UuidV7[];
}

function customer(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'customer') throw new CustomerCartAuthorizationError();
  return context.actor.actor_id;
}

interface GroupRow {
  readonly cart_vendor_group_id: string;
  readonly vendor_location_id: string;
  readonly fulfilment_method: FulfilmentMethod;
  readonly customer_note: string | null;
  readonly tip_minor: string;
  readonly lifecycle_state: CartVendorGroup['lifecycle_state'];
  readonly version: number;
  readonly location_name: string;
  readonly minimum_order_minor: string;
  readonly fulfilment_modes: readonly string[];
}
interface LineRow {
  readonly cart_line_id: string;
  readonly cart_vendor_group_id: string;
  readonly catalogue_variant_id: string;
  readonly catalogue_product_id: string;
  readonly quantity: number;
  readonly substitution_preference: SubstitutionPreference;
  readonly lifecycle_state: CartLine['lifecycle_state'];
  readonly version: number;
  readonly title: string;
  readonly unit_label: string;
  readonly category: string;
  readonly variable_weight: boolean;
  readonly image_reference: string | null;
  readonly unit_price_minor: string | null;
}
interface CartRow {
  readonly cart_id: string;
  readonly customer_address_id: string | null;
  readonly lifecycle_state: Cart['lifecycle_state'];
  readonly version: number;
}

function projectLine(row: LineRow): CartLine {
  // Integer minor units throughout: the multiply happens on whole paise, never
  // on a rupee float.
  const unitPrice = row.unit_price_minor === null ? null : Number(row.unit_price_minor);
  return Object.freeze({
    cart_line_id: parseUuidV7(row.cart_line_id),
    catalogue_variant_id: parseUuidV7(row.catalogue_variant_id),
    catalogue_product_id: parseUuidV7(row.catalogue_product_id),
    quantity: row.quantity,
    substitution_preference: row.substitution_preference,
    lifecycle_state: row.lifecycle_state,
    version: row.version,
    title: row.title,
    unit_label: row.unit_label,
    category: row.category,
    variable_weight: row.variable_weight,
    image_reference: row.image_reference,
    unit_price_minor: unitPrice,
    line_total_minor: unitPrice === null ? null : unitPrice * row.quantity,
  });
}

async function loadCart(client: PoolClient, cartId: string): Promise<Cart> {
  const cart = await client.query<CartRow>(
    `SELECT cart_id, customer_address_id, lifecycle_state, version
       FROM marketplace.carts WHERE cart_id = $1`,
    [cartId],
  );
  const cartRow = cart.rows[0];
  if (!cartRow) throw new CustomerCartNotFoundError();
  const groups = await client.query<GroupRow>(
    `SELECT g.cart_vendor_group_id, g.vendor_location_id, g.fulfilment_method, g.customer_note,
            g.tip_minor::text AS tip_minor, g.lifecycle_state, g.version,
            l.location_name, l.minimum_order_minor::text AS minimum_order_minor,
            COALESCE(
              (SELECT array_agg(DISTINCT fulfilment_mode)
                 FROM marketplace.vendor_location_fulfilment_modes
                WHERE vendor_location_id = l.vendor_location_id),
              ARRAY[]::text[]
            ) AS fulfilment_modes
       FROM marketplace.cart_vendor_groups g
       JOIN marketplace.vendor_locations l ON l.vendor_location_id = g.vendor_location_id
      WHERE g.cart_id = $1 AND g.lifecycle_state <> 'REMOVED'
      ORDER BY g.created_at ASC`,
    [cartId],
  );
  const lines = await client.query<LineRow>(
    `SELECT l.cart_line_id, l.cart_vendor_group_id, l.catalogue_variant_id, l.quantity,
            l.substitution_preference, l.lifecycle_state, l.version,
            p.catalogue_product_id, p.title, p.unit_label, p.category, p.variable_weight,
            price.price_minor::text AS unit_price_minor,
            (SELECT i.object_reference
               FROM marketplace.catalogue_product_images i
              WHERE i.catalogue_product_id = p.catalogue_product_id
              ORDER BY i.position ASC
              LIMIT 1) AS image_reference
       FROM marketplace.cart_lines l
       JOIN marketplace.cart_vendor_groups g ON g.cart_vendor_group_id = l.cart_vendor_group_id
       JOIN marketplace.catalogue_product_variants v
         ON v.catalogue_variant_id = l.catalogue_variant_id
       JOIN marketplace.catalogue_products p
         ON p.catalogue_product_id = v.catalogue_product_id
       LEFT JOIN LATERAL (
         SELECT cp.price_minor FROM marketplace.catalogue_prices cp
          WHERE cp.catalogue_variant_id = v.catalogue_variant_id AND cp.effective_until IS NULL
       ) price ON true
      WHERE g.cart_id = $1 AND l.lifecycle_state <> 'REMOVED'
      ORDER BY l.created_at ASC`,
    [cartId],
  );
  const linesByGroup = new Map<string, LineRow[]>();
  for (const line of lines.rows) {
    const bucket = linesByGroup.get(line.cart_vendor_group_id) ?? [];
    bucket.push(line);
    linesByGroup.set(line.cart_vendor_group_id, bucket);
  }
  return Object.freeze({
    cart_id: parseUuidV7(cartRow.cart_id),
    customer_address_id: cartRow.customer_address_id
      ? parseUuidV7(cartRow.customer_address_id)
      : null,
    lifecycle_state: cartRow.lifecycle_state,
    version: cartRow.version,
    groups: Object.freeze(
      groups.rows.map((group) => {
        const groupLines = (linesByGroup.get(group.cart_vendor_group_id) ?? []).map(projectLine);
        // One unpriced line makes the subtotal a guess. A cart that guesses is
        // how a customer arrives at checkout expecting a different number.
        const priced = groupLines.every((line) => line.line_total_minor !== null);
        const subtotal = priced
          ? groupLines.reduce((sum, line) => sum + (line.line_total_minor ?? 0), 0)
          : null;
        const minimum = Number(group.minimum_order_minor);
        return Object.freeze({
          cart_vendor_group_id: parseUuidV7(group.cart_vendor_group_id),
          vendor_location_id: parseUuidV7(group.vendor_location_id),
          fulfilment_method: group.fulfilment_method,
          customer_note: group.customer_note,
          tip_minor: Number(group.tip_minor),
          lifecycle_state: group.lifecycle_state,
          version: group.version,
          lines: Object.freeze(groupLines),
          location_name: group.location_name,
          minimum_order_minor: minimum,
          subtotal_minor: subtotal,
          minimum_met: subtotal !== null && subtotal >= minimum,
          fulfilment_modes: Object.freeze([...group.fulfilment_modes]),
          fulfilment_method_offered: group.fulfilment_modes.includes(group.fulfilment_method),
        });
      }),
    ),
  });
}

async function recordEvent(
  client: PoolClient,
  input: {
    readonly cart_id: UuidV7;
    readonly cart_vendor_group_id?: UuidV7 | null;
    readonly cart_line_id?: UuidV7 | null;
    readonly event_type:
      | 'ADDRESS_CHANGED'
      | 'CART_CREATED'
      | 'FULFILMENT_METHOD_CHANGED'
      | 'GROUP_ADDED'
      | 'GROUP_INVALIDATED'
      | 'GROUP_REMOVED'
      | 'LINE_ADDED'
      | 'LINE_MARKED_STALE'
      | 'LINE_QUANTITY_CHANGED'
      | 'LINE_REMOVED';
    readonly reason_code: string;
    readonly ids: { readonly request: string; readonly correlation: string };
    readonly now: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO marketplace.cart_events
       (event_id, cart_id, cart_vendor_group_id, cart_line_id, event_type, reason_code,
        request_id, correlation_id, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      createUuidV7({ now_ms: input.now.getTime() }),
      input.cart_id,
      input.cart_vendor_group_id ?? null,
      input.cart_line_id ?? null,
      input.event_type,
      input.reason_code,
      input.ids.request,
      input.ids.correlation,
      input.now,
    ],
  );
}

export class CustomerCartService {
  readonly #pool: Pool;

  constructor(input: { readonly connection_string: string }) {
    this.#pool = createDatabasePool({
      connectionString: input.connection_string,
      application_name: 'neighbourhood-store-customer-cart',
      max: 8,
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  /**
   * The store-group ceiling is operator policy (6.6: "the configured group
   * limit, default three"), read from versioned configuration the way the
   * saved-address limit is. A missing or unusable value falls back to the
   * documented default; a value above MAX_CART_GROUP_LIMIT is treated the
   * same way rather than honoured, because a checkout across dozens of shops
   * is not a cart anyone designed for.
   */
  async cartGroupLimit(at?: Date): Promise<number> {
    const resolved = await resolveConfiguration(this.#pool, {
      configuration_key: 'customer.cart_group_limit',
      configuration_kind: 'SETTING',
      ...(at ? { at } : {}),
    });
    const value = resolved?.configuration_value;
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > MAX_CART_GROUP_LIMIT
    ) {
      return DEFAULT_CART_GROUP_LIMIT;
    }
    return value;
  }

  /** Finds the customer's one active cart, creating it if none exists. */
  async currentCart(input: {
    readonly context: RequestContext;
    readonly now?: Date;
  }): Promise<Cart> {
    const userId = customer(input.context);
    const now = input.now ?? new Date();
    const ids = {
      request: parseRequestId(input.context.request_id),
      correlation: parseUuidV7(input.context.correlation_id),
    };
    return tx(this.#pool, async (client) => {
      const existing = await client.query<{ cart_id: string }>(
        `SELECT cart_id FROM marketplace.carts WHERE user_id = $1 AND lifecycle_state = 'ACTIVE'`,
        [userId],
      );
      const existingRow = existing.rows[0];
      if (existingRow) return loadCart(client, existingRow.cart_id);
      const cartId = createUuidV7({ now_ms: now.getTime() });
      const inserted = await client.query<{ cart_id: string }>(
        `INSERT INTO marketplace.carts (cart_id, user_id, request_id, correlation_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$5)
         ON CONFLICT (user_id) WHERE lifecycle_state = 'ACTIVE' DO NOTHING
         RETURNING cart_id`,
        [cartId, userId, ids.request, ids.correlation, now],
      );
      const insertedId = inserted.rows[0]?.cart_id;
      if (insertedId) {
        await recordEvent(client, {
          cart_id: parseUuidV7(insertedId),
          event_type: 'CART_CREATED',
          reason_code: 'CUSTOMER_STARTED_CART',
          ids,
          now,
        });
        return loadCart(client, insertedId);
      }
      const concurrent = await client.query<{ cart_id: string }>(
        `SELECT cart_id FROM marketplace.carts
          WHERE user_id = $1 AND lifecycle_state = 'ACTIVE'`,
        [userId],
      );
      const concurrentId = concurrent.rows[0]?.cart_id;
      if (!concurrentId) throw new CustomerCartConflictError('Active cart could not be resolved');
      return loadCart(client, concurrentId);
    });
  }

  async setCartAddress(input: {
    readonly context: RequestContext;
    readonly customer_address_id: UuidV7;
    readonly now?: Date;
  }): Promise<Cart> {
    const userId = customer(input.context);
    const now = input.now ?? new Date();
    const ids = {
      request: parseRequestId(input.context.request_id),
      correlation: parseUuidV7(input.context.correlation_id),
    };
    const cart = await this.currentCart({ context: input.context, now });
    return tx(this.#pool, async (client) => {
      const owned = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM marketplace.customer_addresses
          WHERE customer_address_id = $1 AND user_id = $2 AND lifecycle_state = 'ACTIVE'`,
        [input.customer_address_id, userId],
      );
      if (owned.rows[0]?.count !== '1') throw new CustomerCartInputError('Address is not owned');
      const changed = await client.query<{ cart_id: string }>(
        `UPDATE marketplace.carts SET customer_address_id=$2, version=version+1, updated_at=$3
          WHERE cart_id=$1 AND user_id=$4 AND lifecycle_state='ACTIVE'
          RETURNING cart_id`,
        [cart.cart_id, input.customer_address_id, now, userId],
      );
      if (!changed.rows[0]) throw new CustomerCartConflictError('Active cart changed');
      await recordEvent(client, {
        cart_id: cart.cart_id,
        event_type: 'ADDRESS_CHANGED',
        reason_code: 'CUSTOMER_CHANGED_ADDRESS',
        ids,
        now,
      });
      return loadCart(client, cart.cart_id);
    });
  }

  /**
   * Adding a line for a vendor location not yet in the cart creates a new
   * group, explaining that a second store means a second fee/order. The
   * configured group ceiling is enforced against distinct vendor locations,
   * not lines.
   */
  async addLine(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly catalogue_variant_id: UuidV7;
    readonly quantity: number;
    readonly fulfilment_method?: FulfilmentMethod;
    readonly substitution_preference?: SubstitutionPreference;
    readonly now?: Date;
  }): Promise<Cart> {
    customer(input.context);
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 1000)
      throw new CustomerCartInputError('Quantity must be between 1 and 1000');
    const now = input.now ?? new Date();
    const ids = {
      request: parseRequestId(input.context.request_id),
      correlation: parseUuidV7(input.context.correlation_id),
    };
    const limit = await this.cartGroupLimit(now);
    const cart = await this.currentCart({ context: input.context, now });
    if (cart.lifecycle_state !== 'ACTIVE')
      throw new CustomerCartConflictError('Cart is not active');

    return tx(this.#pool, async (client) => {
      const group = cart.groups.find((g) => g.vendor_location_id === input.vendor_location_id);
      let groupId: UuidV7;
      if (!group) {
        const activeGroups = cart.groups.filter((g) => g.lifecycle_state === 'ACTIVE');
        if (activeGroups.length >= limit) {
          throw new CustomerCartConflictError(`A cart may hold at most ${limit} vendor groups`);
        }
        // CUS-33: the group receives its order in a way the store actually offers.
        // A requested method the store lacks is refused with the modes it has; no
        // request means the first offered mode in the default preference order.
        const offered = await approvedFulfilmentModes(client, input.vendor_location_id);
        if (offered.length === 0)
          throw new CustomerCartConflictError('This store is not taking orders');
        if (input.fulfilment_method !== undefined && !offered.includes(input.fulfilment_method))
          throw new CustomerCartFulfilmentMethodError(offered);
        const method =
          input.fulfilment_method ??
          DEFAULT_METHOD_PREFERENCE.find((candidate) => offered.includes(candidate)) ??
          offered[0];
        // A store removed from the cart keeps its row as REMOVED (the unique key is
        // cart + location), so adding it back revives that row rather than
        // inserting a second one -- which was a duplicate-key 500 for every
        // customer who removed a store's last line and then changed their mind.
        const revived = await client.query<{ cart_vendor_group_id: string }>(
          `INSERT INTO marketplace.cart_vendor_groups
             (cart_vendor_group_id, cart_id, vendor_location_id, fulfilment_method, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$5)
           ON CONFLICT (cart_id, vendor_location_id)
           DO UPDATE SET lifecycle_state = 'ACTIVE',
                         fulfilment_method = EXCLUDED.fulfilment_method,
                         customer_note = NULL, tip_minor = 0,
                         version = marketplace.cart_vendor_groups.version + 1,
                         updated_at = EXCLUDED.updated_at
           RETURNING cart_vendor_group_id`,
          [
            createUuidV7({ now_ms: now.getTime() }),
            cart.cart_id,
            input.vendor_location_id,
            method,
            now,
          ],
        );
        const revivedRow = revived.rows[0];
        if (!revivedRow) throw new CustomerCartConflictError('Vendor group could not be added');
        groupId = parseUuidV7(revivedRow.cart_vendor_group_id);
        await recordEvent(client, {
          cart_id: cart.cart_id,
          cart_vendor_group_id: groupId,
          event_type: 'GROUP_ADDED',
          reason_code: 'CUSTOMER_ADDED_STORE',
          ids,
          now,
        });
      } else {
        groupId = group.cart_vendor_group_id;
      }

      const lineId = createUuidV7({ now_ms: now.getTime() + 1 });
      const upserted = await client.query<{ cart_line_id: string; quantity: number }>(
        `INSERT INTO marketplace.cart_lines
           (cart_line_id, cart_vendor_group_id, catalogue_variant_id, quantity,
            substitution_preference, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$6)
         ON CONFLICT (cart_vendor_group_id, catalogue_variant_id)
         DO UPDATE SET quantity = CASE
                          WHEN marketplace.cart_lines.lifecycle_state = 'REMOVED' THEN EXCLUDED.quantity
                          ELSE marketplace.cart_lines.quantity + EXCLUDED.quantity
                        END,
                        substitution_preference = CASE
                          WHEN marketplace.cart_lines.lifecycle_state = 'REMOVED' THEN EXCLUDED.substitution_preference
                          ELSE marketplace.cart_lines.substitution_preference
                        END,
                        lifecycle_state = 'ACTIVE', version = marketplace.cart_lines.version + 1,
                        updated_at = $6
         RETURNING cart_line_id, quantity`,
        [
          lineId,
          groupId,
          input.catalogue_variant_id,
          input.quantity,
          input.substitution_preference ?? 'ASK_CUSTOMER',
          now,
        ],
      );
      const line = upserted.rows[0];
      await recordEvent(client, {
        cart_id: cart.cart_id,
        cart_vendor_group_id: groupId,
        cart_line_id: line ? parseUuidV7(line.cart_line_id) : null,
        event_type: 'LINE_ADDED',
        reason_code: 'CUSTOMER_ADDED_LINE',
        ids,
        now,
      });
      return loadCart(client, cart.cart_id);
    });
  }

  /**
   * Changes a line's quantity and, optionally, its substitution rule.
   *
   * The rule could previously only be chosen when the line was added and never
   * afterwards, so a customer who wanted "no substitution" on something already
   * in the basket had to remove it and add it again. CUS-34 makes the choice a
   * per-line decision, which means a changeable one. It rides the same
   * optimistic-version command so the two can never disagree about which
   * version of the line was edited.
   */
  async setLineQuantity(input: {
    readonly context: RequestContext;
    readonly cart_line_id: UuidV7;
    readonly expected_version: number;
    readonly quantity: number;
    readonly substitution_preference?: SubstitutionPreference;
    readonly now?: Date;
  }): Promise<Cart> {
    const userId = customer(input.context);
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 1000)
      throw new CustomerCartInputError('Quantity must be between 1 and 1000');
    if (!Number.isSafeInteger(input.expected_version) || input.expected_version < 1)
      throw new CustomerCartInputError('An expected version is required');
    const now = input.now ?? new Date();
    const ids = {
      request: parseRequestId(input.context.request_id),
      correlation: parseUuidV7(input.context.correlation_id),
    };
    return tx(this.#pool, async (client) => {
      const updated = await client.query<{ cart_id: string; cart_vendor_group_id: string }>(
        `UPDATE marketplace.cart_lines l
            SET quantity=$3,
                substitution_preference=COALESCE($6, l.substitution_preference),
                version=l.version+1,
                updated_at=$4
           FROM marketplace.cart_vendor_groups g, marketplace.carts c
          WHERE l.cart_line_id=$1 AND l.version=$2 AND l.lifecycle_state='ACTIVE'
            AND g.cart_vendor_group_id=l.cart_vendor_group_id AND c.cart_id=g.cart_id
            AND c.user_id=$5
        RETURNING c.cart_id, l.cart_vendor_group_id`,
        [
          input.cart_line_id,
          input.expected_version,
          input.quantity,
          now,
          userId,
          input.substitution_preference ?? null,
        ],
      );
      const row = updated.rows[0];
      if (!row) throw new CustomerCartNotFoundError();
      await recordEvent(client, {
        cart_id: parseUuidV7(row.cart_id),
        cart_vendor_group_id: parseUuidV7(row.cart_vendor_group_id),
        cart_line_id: input.cart_line_id,
        event_type: 'LINE_QUANTITY_CHANGED',
        reason_code:
          input.substitution_preference === undefined
            ? 'CUSTOMER_CHANGED_QUANTITY'
            : 'CUSTOMER_CHANGED_SUBSTITUTION_RULE',
        ids,
        now,
      });
      return loadCart(client, row.cart_id);
    });
  }

  async removeLine(input: {
    readonly context: RequestContext;
    readonly cart_line_id: UuidV7;
    readonly now?: Date;
  }): Promise<Cart> {
    const userId = customer(input.context);
    const now = input.now ?? new Date();
    const ids = {
      request: parseRequestId(input.context.request_id),
      correlation: parseUuidV7(input.context.correlation_id),
    };
    return tx(this.#pool, async (client) => {
      const removed = await client.query<{ cart_id: string; cart_vendor_group_id: string }>(
        `UPDATE marketplace.cart_lines l SET lifecycle_state='REMOVED', version=l.version+1, updated_at=$3
           FROM marketplace.cart_vendor_groups g, marketplace.carts c
          WHERE l.cart_line_id=$1 AND l.lifecycle_state IN ('ACTIVE','STALE')
            AND g.cart_vendor_group_id=l.cart_vendor_group_id AND c.cart_id=g.cart_id
            AND c.user_id=$2
        RETURNING c.cart_id, l.cart_vendor_group_id`,
        [input.cart_line_id, userId, now],
      );
      const row = removed.rows[0];
      if (!row) throw new CustomerCartNotFoundError();
      await recordEvent(client, {
        cart_id: parseUuidV7(row.cart_id),
        cart_vendor_group_id: parseUuidV7(row.cart_vendor_group_id),
        cart_line_id: input.cart_line_id,
        event_type: 'LINE_REMOVED',
        reason_code: 'CUSTOMER_REMOVED_LINE',
        ids,
        now,
      });
      // Removing the last line in a group removes the group too, so an empty
      // store never lingers as a silent extra fee explanation.
      const remaining = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM marketplace.cart_lines
          WHERE cart_vendor_group_id = $1 AND lifecycle_state <> 'REMOVED'`,
        [row.cart_vendor_group_id],
      );
      if (remaining.rows[0]?.count === '0') {
        await client.query(
          `UPDATE marketplace.cart_vendor_groups SET lifecycle_state='REMOVED', version=version+1, updated_at=$2
            WHERE cart_vendor_group_id=$1`,
          [row.cart_vendor_group_id, now],
        );
        await recordEvent(client, {
          cart_id: parseUuidV7(row.cart_id),
          cart_vendor_group_id: parseUuidV7(row.cart_vendor_group_id),
          event_type: 'GROUP_REMOVED',
          reason_code: 'LAST_LINE_REMOVED',
          ids,
          now,
        });
      }
      return loadCart(client, row.cart_id);
    });
  }

  async setGroupFulfilmentMethod(input: {
    readonly context: RequestContext;
    readonly cart_vendor_group_id: UuidV7;
    readonly expected_version: number;
    readonly fulfilment_method: FulfilmentMethod;
    readonly customer_note?: string | null;
    readonly now?: Date;
  }): Promise<Cart> {
    const userId = customer(input.context);
    if (!Number.isSafeInteger(input.expected_version) || input.expected_version < 1)
      throw new CustomerCartInputError('An expected version is required');
    const note = input.customer_note?.trim() || null;
    if (note !== null && (note.length < 1 || note.length > 240))
      throw new CustomerCartInputError('Note must be between 1 and 240 characters');
    const now = input.now ?? new Date();
    const ids = {
      request: parseRequestId(input.context.request_id),
      correlation: parseUuidV7(input.context.correlation_id),
    };
    return tx(this.#pool, async (client) => {
      // Resolve the store first, scoped to this customer so a stranger's group
      // id is concealed as not-found rather than answered with the store's modes.
      const owned = await client.query<{ vendor_location_id: string }>(
        `SELECT g.vendor_location_id
           FROM marketplace.cart_vendor_groups g
           JOIN marketplace.carts c ON c.cart_id = g.cart_id
          WHERE g.cart_vendor_group_id = $1 AND c.user_id = $2 AND g.lifecycle_state = 'ACTIVE'
          FOR UPDATE OF g`,
        [input.cart_vendor_group_id, userId],
      );
      const ownedRow = owned.rows[0];
      if (!ownedRow) throw new CustomerCartNotFoundError();
      // CUS-33: a method the store does not offer is refused, not recorded.
      const offered = await approvedFulfilmentModes(client, ownedRow.vendor_location_id);
      if (!offered.includes(input.fulfilment_method))
        throw new CustomerCartFulfilmentMethodError(offered);
      const updated = await client.query<{ cart_id: string }>(
        `UPDATE marketplace.cart_vendor_groups g SET fulfilment_method=$3, customer_note=$4,
                version=g.version+1, updated_at=$5
           FROM marketplace.carts c
          WHERE g.cart_vendor_group_id=$1 AND g.version=$2 AND g.lifecycle_state='ACTIVE'
            AND c.cart_id=g.cart_id AND c.user_id=$6
        RETURNING c.cart_id`,
        [
          input.cart_vendor_group_id,
          input.expected_version,
          input.fulfilment_method,
          note,
          now,
          userId,
        ],
      );
      const row = updated.rows[0];
      if (!row) throw new CustomerCartNotFoundError();
      await recordEvent(client, {
        cart_id: parseUuidV7(row.cart_id),
        cart_vendor_group_id: input.cart_vendor_group_id,
        event_type: 'FULFILMENT_METHOD_CHANGED',
        reason_code: 'CUSTOMER_CHANGED_METHOD',
        ids,
        now,
      });
      return loadCart(client, row.cart_id);
    });
  }

  /**
   * Re-checks every active group against publication, product/variant/price
   * existence, and (when the cart carries an address) service-zone coverage
   * and the vendor's minimum order. A failing group is marked INVALID and its
   * lines STALE; sibling groups are never touched, so one closed store cannot
   * destroy a valid multi-store cart.
   */
  async revalidate(input: {
    readonly context: RequestContext;
    readonly now?: Date;
  }): Promise<readonly RevalidationOutcome[]> {
    const now = input.now ?? new Date();
    const ids = {
      request: parseRequestId(input.context.request_id),
      correlation: parseUuidV7(input.context.correlation_id),
    };
    const cart = await this.currentCart({ context: input.context, now });
    if (cart.groups.length === 0) return Object.freeze([]);

    return tx(this.#pool, async (client) => {
      const outcomes: RevalidationOutcome[] = [];
      for (const group of cart.groups) {
        if (group.lifecycle_state !== 'ACTIVE') continue;
        const check = await client.query<{
          reason: string | null;
          stale_line_ids: string[];
        }>(
          `WITH location_check AS (
             SELECT l.vendor_location_id,
                    (l.lifecycle_state <> 'ACTIVE') AS closed,
                    NOT EXISTS (
                      SELECT 1 FROM marketplace.vendor_publication_cases p
                       WHERE p.vendor_location_id = l.vendor_location_id AND p.lifecycle_state = 'PUBLISHED'
                    ) AS unpublished,
                    ($2::uuid IS NOT NULL AND NOT EXISTS (
                      SELECT 1 FROM marketplace.customer_addresses a
                      JOIN marketplace.vendor_service_zones z
                        ON z.vendor_location_id = l.vendor_location_id AND z.lifecycle_state = 'ACTIVE'
                       AND ST_Covers(z.boundary, a.coordinates)
                      WHERE a.customer_address_id = $2
                    )) AS out_of_zone
               FROM marketplace.vendor_locations l WHERE l.vendor_location_id = $1
           ),
           stale AS (
             SELECT cl.cart_line_id
               FROM marketplace.cart_lines cl
              WHERE cl.cart_vendor_group_id = $3 AND cl.lifecycle_state = 'ACTIVE'
                AND NOT EXISTS (
                  SELECT 1 FROM marketplace.catalogue_product_variants v
                   WHERE v.catalogue_variant_id = cl.catalogue_variant_id
                     AND v.lifecycle_state = 'ACTIVE'
                )
           )
           SELECT
             CASE
               WHEN lc.closed THEN 'STORE_CLOSED'
               WHEN lc.unpublished THEN 'STORE_UNPUBLISHED'
               WHEN lc.out_of_zone THEN 'ADDRESS_OUT_OF_ZONE'
               ELSE NULL
             END AS reason,
             COALESCE((SELECT array_agg(cart_line_id::text) FROM stale), ARRAY[]::text[])
               AS stale_line_ids
             FROM location_check lc`,
          [group.vendor_location_id, cart.customer_address_id, group.cart_vendor_group_id],
        );
        const row = check.rows[0];
        const reason = row?.reason ?? null;
        const staleLineIds = row?.stale_line_ids ?? [];

        if (reason) {
          await client.query(
            `UPDATE marketplace.cart_vendor_groups SET lifecycle_state='INVALID', version=version+1, updated_at=$2
              WHERE cart_vendor_group_id=$1`,
            [group.cart_vendor_group_id, now],
          );
          await recordEvent(client, {
            cart_id: cart.cart_id,
            cart_vendor_group_id: group.cart_vendor_group_id,
            event_type: 'GROUP_INVALIDATED',
            reason_code: reason,
            ids,
            now,
          });
        }
        for (const lineId of staleLineIds) {
          await client.query(
            `UPDATE marketplace.cart_lines SET lifecycle_state='STALE', version=version+1, updated_at=$2
              WHERE cart_line_id=$1`,
            [lineId, now],
          );
          await recordEvent(client, {
            cart_id: cart.cart_id,
            cart_vendor_group_id: group.cart_vendor_group_id,
            cart_line_id: parseUuidV7(lineId),
            event_type: 'LINE_MARKED_STALE',
            reason_code: 'PRODUCT_NO_LONGER_ACTIVE',
            ids,
            now,
          });
        }
        outcomes.push(
          Object.freeze({
            cart_vendor_group_id: group.cart_vendor_group_id,
            vendor_location_id: group.vendor_location_id,
            invalidated: reason !== null,
            reason,
            stale_line_ids: Object.freeze(staleLineIds.map((id) => parseUuidV7(id))),
          }),
        );
      }
      return Object.freeze(outcomes);
    });
  }
}
