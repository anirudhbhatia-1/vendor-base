import { releaseServicePool, resolveServicePool } from './database-pool.js';
import { createHash } from 'node:crypto';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import { calculateCheckoutPricing } from './checkout-pricing.js';
import { resolveFinancialPolicy } from './financial-policy.js';
import { releaseReservationsLocked } from './inventory-reservations.js';
import { deriveCheckoutGroupState } from './checkout-group-state.js';
import { promiseWindow, RoutingService, type RouteLeg } from './routing.js';
import type { SubstitutionPreference } from './customer-cart.js';
import {
  LocalFakeMoneyProvider,
  type FakeProviderOutcome,
  type FakeProviderScenario,
  type MoneyProviderAdapter,
  providerOutcome,
} from './money-policy.js';
import { transaction as tx } from './transaction.js';
import { DEFAULT_ACCEPT_DEADLINE_SECONDS } from './vendor-fulfilment.js';
import { resolveConfiguration } from './versioned-configuration.js';

/**
 * Prepaid methods the platform accepts.
 *
 * Cash on delivery is a gated capability (GAT-01): it is absent from this union
 * and from the database constraint, not merely hidden in a UI.
 */
export type PaymentMethod = 'UPI' | 'CARD' | 'WALLET';

export class CheckoutInputError extends Error {}
export class CheckoutNotFoundError extends Error {}
/**
 * A checkout refusal with the stable code the customer's screen answers to.
 * A lapsed quote and a changed basket carry their own codes; every other
 * conflict is the generic one.
 */
export class CheckoutConflictError extends Error {
  constructor(
    message: string,
    readonly code:
      'ORDER_STATE_CONFLICT' | 'QUOTE_CHANGED' | 'QUOTE_EXPIRED' = 'ORDER_STATE_CONFLICT',
  ) {
    super(message);
  }
}
/**
 * The provider authorised but the orders could not be made: the stock the
 * quote held was gone by the time the answer arrived. The money is released
 * and the customer can quote again. Its own class because it answers 422
 * INVENTORY_UNAVAILABLE, not the 409 the other conflicts answer.
 */
export class CheckoutUnfulfillableError extends Error {
  readonly code = 'INVENTORY_UNAVAILABLE';
  constructor() {
    super('The stock the quote held was no longer available');
  }
}
export class CheckoutPaymentDeclinedError extends Error {
  readonly code = 'PAYMENT_DECLINED';
  constructor() {
    super('Payment declined');
  }
}

/**
 * How long a placement waits for a provider that gave no usable answer. The
 * holds stand for the whole of it, because a late "succeeded" needs them;
 * after it the group is abandoned and the money left to reconciliation.
 * Three times the quote's own life: long enough for a provider's retry
 * schedule, short enough that a shelf is not held for an evening.
 */
export const PAYMENT_UNKNOWN_DEADLINE_MS = 15 * 60_000;

/**
 * How long a submission may sit between "recorded" and "answered" before the
 * sweep treats the missing answer as an unknown one. The provider call has a
 * timeout of its own; this is for the process that died between the two
 * transactions of a placement.
 */
export const PROCESSING_DEADLINE_MS = 2 * 60_000;

/**
 * How long an order's stock hold stands once the order is placed. The hold is
 * committed at pickup and released by every ending the fulfilment knows; this
 * is the safety net for an order nothing ever ended, and it has to outlive
 * any order that is merely slow. The quote's own five minutes used to be
 * carried onto the placed order's holds unchanged, so the inventory sweep gave
 * every placed order's stock back to the shelf five minutes after it was
 * quoted, while the order was being packed.
 */
export const PLACED_ORDER_HOLD_MS = 24 * 60 * 60_000;

/** A group's rule as the quote states it: one rule for every line, or not. */
export type DecisionRule = SubstitutionPreference | 'MIXED';

type QuoteLineRow = {
  cart_line_id: string;
  catalogue_variant_id: string;
  substitution_preference: SubstitutionPreference;
  /**
   * Whether the store can supply this line at all: an active variant of an
   * active product with a current price and a stock record. A line that
   * cannot be supplied blocks its group rather than being left out of it.
   */
  supplied: boolean;
  inventory_item_id: string | null;
  product_title: string | null;
  variant_title: string | null;
  quantity: number;
  unit_price_minor: string | null;
  product_version: number | null;
  variant_version: number | null;
  exact_available_quantity: string | null;
  quantity_basis: 'COUNTED' | 'VENDOR_CONFIRMS' | null;
  inventory_version: number | null;
};
/** A line the classification proved supplied, so every catalogue field is present. */
type SuppliedLineRow = QuoteLineRow & {
  inventory_item_id: string;
  product_title: string;
  variant_title: string;
  unit_price_minor: string;
  product_version: number;
  variant_version: number;
  quantity_basis: 'COUNTED' | 'VENDOR_CONFIRMS';
  inventory_version: number;
};
type GroupRow = {
  cart_vendor_group_id: string;
  vendor_location_id: string;
  fulfilment_method: 'CUSTOMER_PICKUP' | 'PLATFORM_DELIVERY' | 'VENDOR_DELIVERY';
  /**
   * The store can take an order at all: active location and vendor, a
   * published storefront, and a service zone covering the address. Every
   * group is returned whatever this says, so a store that cannot is blocked
   * with a reason rather than left out of the quote.
   */
  store_available: boolean;
  /** Whether the store still offers `fulfilment_method`; false blocks the group. */
  method_offered: boolean;
  /**
   * A trust restriction in force keeps this customer from ordering here
   * (11.4). Their orders already placed are not read against it.
   */
  customer_restricted: boolean;
  tip_minor: string;
  minimum_order_minor: string;
  /** The straight line, kept as the estimate's input; the road comes from routing. */
  straight_line_metres: string;
  store_latitude: number;
  store_longitude: number;
  address_latitude: number;
  address_longitude: number;
  preparation_seconds: number;
  lines: QuoteLineRow[];
};
type SuppliedGroupRow = Omit<GroupRow, 'lines'> & { lines: SuppliedLineRow[] };

/**
 * The identity of a quote: who is buying, from which cart, to which address,
 * and exactly what -- each group's method and tip, each line's variant,
 * quantity, price, catalogue versions and substitution rule. Not the stock on the shelf, which
 * the quote's own hold changes, and not the policy, which the quote stamps.
 * A retry with the same content replays the live quote; any change to it
 * re-quotes; placing a quote whose content no longer matches the cart is
 * refused.
 */
export function quoteContentDigest(input: {
  readonly user_id: string;
  readonly cart_id: string;
  readonly customer_address_id: string;
  readonly groups: readonly GroupRow[];
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        user: input.user_id,
        cart: input.cart_id,
        address: input.customer_address_id,
        groups: input.groups.map((group) => ({
          group: group.cart_vendor_group_id,
          location: group.vendor_location_id,
          method: group.fulfilment_method,
          tip: group.tip_minor,
          lines: group.lines.map((line) => ({
            line: line.cart_line_id,
            variant: line.catalogue_variant_id,
            quantity: line.quantity,
            price: line.unit_price_minor,
            product_version: line.product_version,
            variant_version: line.variant_version,
            // The rule the order proceeds under is part of what was quoted.
            substitution: line.substitution_preference,
          })),
        })),
      }),
    )
    .digest('hex');
}
/**
 * The rule a group's order proceeds under, as the quote states it. One rule
 * shared by every line is that rule; lines with different rules are told
 * apart per item at picking, and the quote says so rather than picking one.
 */
export function decisionRule(
  preferences: readonly SubstitutionPreference[] | null | undefined,
): DecisionRule {
  const distinct = [...new Set(preferences ?? [])];
  const [only] = distinct;
  return distinct.length === 1 && only ? only : distinct.length === 0 ? 'ASK_CUSTOMER' : 'MIXED';
}
type InventoryItemRow = {
  readonly exact_available_quantity: string | number | null;
  readonly quantity_basis: 'COUNTED' | 'VENDOR_CONFIRMS';
  readonly version: number;
};
type CheckoutQuoteRow = Record<string, unknown> & {
  readonly cart_id: UuidV7;
  readonly checkout_quote_id: UuidV7;
  readonly customer_user_id: UuidV7;
  readonly expires_at: Date;
  readonly lifecycle_state: string;
  readonly policy_version_reference: string;
  readonly total_minor: string | number;
};
type WebhookPaymentRow = CheckoutQuoteRow & {
  readonly checkout_group_id: UuidV7;
  readonly checkout_state: string;
  readonly payment_transaction_id: UuidV7;
  readonly payment_state: string;
  readonly provider_operation_reference: string;
  readonly provider_scenario: FakeProviderScenario;
  readonly amount_minor: string | number;
  readonly version: number;
};
type FinalizeGroupRow = Record<string, unknown> & {
  readonly checkout_quote_group_id: string;
  readonly delivery_minor: string | number;
  readonly fulfilment_method: string;
  readonly item_minor: string | number;
  readonly tip_minor: string | number;
  readonly total_minor: string | number;
  readonly vendor_location_id: string;
};
type FinalizeLineRow = Record<string, unknown> & {
  readonly catalogue_variant_id: string;
  readonly substitution_preference: SubstitutionPreference;
  readonly exact_available_quantity: string | number | null;
  readonly inventory_item_id: string;
  readonly inventory_reservation_id: string;
  readonly item_version: number;
  readonly line_total_minor: string | number;
  readonly product_title_snapshot: string;
  readonly quantity: string | number;
  readonly reservation_version: number;
  readonly unit_price_minor: string | number;
  readonly variant_title_snapshot: string;
};
type CheckoutEventRow = {
  readonly checkout_event_id: string;
  readonly correlation_id: string;
  readonly event_type: string;
  readonly occurred_at: Date;
  readonly request_id: string;
};
type QuoteGroupProjection = Record<string, unknown> & {
  readonly delivery_minor: string | number;
  readonly fulfilment_method: string;
  readonly item_minor: string | number;
  readonly location_name: string;
  readonly tip_minor: string | number;
  readonly total_minor: string | number;
  readonly vendor_location_id: string;
  readonly route_metres: string | number | null;
  readonly route_seconds: string | number | null;
  readonly route_source: 'ESTIMATE' | 'MAPBOX' | null;
  readonly ready_after_seconds: string | number;
  readonly arrives_after_seconds: string | number | null;
  readonly substitution_preferences: readonly SubstitutionPreference[] | null;
};

/**
 * The promise in words, from the numbers the quote stored. Rounded up to
 * whole minutes with a quarter hour of slack on delivery; an estimate says
 * "about" the same way a routed answer does, because both are.
 */
export function promiseSentence(input: {
  readonly fulfilment_method: string;
  readonly ready_after_seconds: number;
  readonly arrives_after_seconds: number | null;
  readonly route_source: 'ESTIMATE' | 'MAPBOX' | null;
}): string {
  const readyMinutes = Math.max(1, Math.ceil(input.ready_after_seconds / 60));
  if (input.fulfilment_method === 'CUSTOMER_PICKUP' || input.arrives_after_seconds === null) {
    return `Ready in about ${readyMinutes} minutes`;
  }
  const from = Math.max(1, Math.ceil(input.arrives_after_seconds / 60));
  return `Arrives in about ${from}–${from + 15} minutes`;
}
type BlockedGroupProjection = {
  readonly cart_vendor_group_id: string;
  readonly reason_code: string;
  readonly vendor_location_id: string;
};
type CheckoutGroupProjection = {
  readonly checkout_group_id: string;
  readonly checkout_reference: string;
  readonly checkout_quote_id: string;
  readonly created_at: Date;
  readonly lifecycle_state: string;
  readonly payment_transaction_id: string;
  readonly total_minor: string | number;
  readonly version: number;
};
type VendorOrderProjection = {
  readonly accept_by: Date | null;
  readonly checkout_group_id: string;
  readonly fulfilment_method: string | null;
  readonly lifecycle_state: string;
  readonly location_name: string;
  readonly order_reference: string;
  readonly total_minor: string | number;
  readonly vendor_location_id: string;
  readonly vendor_order_id: string;
  readonly version: number;
};

function customer(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'customer')
    throw new CheckoutInputError('Customer session required');
  return context.actor.actor_id;
}
function ids(context: RequestContext) {
  return {
    request: parseRequestId(context.request_id),
    correlation: parseUuidV7(context.correlation_id),
  };
}
function reference(prefix: 'CHECKOUT' | 'ORDER' | 'PAY' | 'CMD', id: string) {
  return `SYNTH-${prefix}-${id.replaceAll('-', '').toUpperCase()}`;
}

export class GroupedCheckoutService {
  readonly #pool: Pool;
  readonly #provider: MoneyProviderAdapter;
  readonly #routing: RoutingService;
  constructor(input: {
    readonly connection_string: string;
    readonly pool?: Pool;
    readonly provider?: MoneyProviderAdapter;
    /** Road distance and travel time; without one, every route is a labelled estimate. */
    readonly routing?: RoutingService;
    readonly webhook_key?: string;
  }) {
    this.#pool = resolveServicePool(input, {
      application_name: 'neighbourhood-store-grouped-checkout',
      max: 12,
    });
    this.#provider =
      input.provider ??
      new LocalFakeMoneyProvider({
        ...(input.webhook_key === undefined ? {} : { webhook_key: input.webhook_key }),
      });
    this.#routing = input.routing ?? new RoutingService({ pool: this.#pool });
  }
  async close() {
    await releaseServicePool(this.#pool);
  }

  async createQuote(input: {
    readonly context: RequestContext;
    readonly cart_id: UuidV7;
    readonly now?: Date;
  }) {
    const userId = customer(input.context);
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + 300_000);
    return tx(this.#pool, async (client) => {
      const cart = await client.query<{ customer_address_id: string }>(
        `SELECT customer_address_id FROM marketplace.carts WHERE cart_id=$1 AND user_id=$2 AND lifecycle_state='ACTIVE' FOR UPDATE`,
        [input.cart_id, userId],
      );
      if (!cart.rows[0]?.customer_address_id)
        throw new CheckoutConflictError('Active cart requires a delivery address');
      const addressId = cart.rows[0].customer_address_id;
      // Bound to the cart's content first. A retry with the same content
      // replays the live quote -- the first quote's own hold has changed the
      // stock, which is why stock is not part of the identity -- and a change
      // to the content supersedes any live quote that no longer matches it.
      const digest = quoteContentDigest({
        user_id: userId,
        cart_id: input.cart_id,
        customer_address_id: addressId,
        groups: (await this.#loadCartGroups(client, userId, input.cart_id, now)).rows,
      });
      const replay = await client.query<{ checkout_quote_id: string }>(
        `SELECT checkout_quote_id FROM marketplace.checkout_quotes
          WHERE cart_id=$1 AND customer_user_id=$2 AND quote_digest=$3
            AND lifecycle_state='ACTIVE' AND expires_at>$4`,
        [input.cart_id, userId, digest, now],
      );
      // A live quote is replayed only while it could still be placed. One
      // that placement would refuse -- a price, a paused store, a restriction
      // since (11.4) -- is released below with the others and quoted afresh;
      // until audit run 76 it was handed back, and placing it failed again.
      if (
        replay.rows[0] &&
        !(await this.#quoteStale(client, replay.rows[0].checkout_quote_id as UuidV7, userId, now))
      )
        return this.#projectQuote(client, replay.rows[0].checkout_quote_id);
      // Every other quote this cart still holds: lapsed ones, and live ones the
      // cart has since changed away from. Their holds go back before the stock
      // is read, so the customer is never blocked by their own earlier quote.
      const stale = await client.query<{ checkout_quote_id: UuidV7; lapsed: boolean }>(
        `SELECT checkout_quote_id, (expires_at<=$3) AS lapsed FROM marketplace.checkout_quotes
          WHERE cart_id=$1 AND customer_user_id=$2 AND lifecycle_state='ACTIVE'
          FOR UPDATE`,
        [input.cart_id, userId, now],
      );
      for (const quote of stale.rows) {
        await this.#releaseQuote(
          client,
          input.context,
          quote.checkout_quote_id,
          now,
          quote.lapsed ? 'QUOTE_EXPIRED' : 'QUOTE_SUPERSEDED',
        );
        await client.query(
          `UPDATE marketplace.checkout_quotes SET lifecycle_state=$2,updated_at=$3 WHERE checkout_quote_id=$1`,
          [quote.checkout_quote_id, quote.lapsed ? 'EXPIRED' : 'INVALID', now],
        );
      }
      const groups = await this.#loadCartGroups(client, userId, input.cart_id, now);
      if (!groups.rows.length) throw new CheckoutConflictError('No cart group can be quoted');
      const classified = groups.rows.map((group) => {
        const subtotal = group.lines.reduce(
          (sum, line) => sum + Number(line.unit_price_minor ?? 0) * line.quantity,
          0,
        );
        // Ordered by what the customer can repair: a store that cannot take
        // the order at all, then a method it does not offer (CUS-33), then a
        // line it can no longer supply, then the minimum, then stock.
        // A restriction on the customer comes first: nothing they change in
        // the basket repairs it, and it is the one thing they can appeal.
        const reason = group.customer_restricted
          ? 'CUSTOMER_RESTRICTED'
          : !group.store_available
            ? 'STORE_UNAVAILABLE'
            : !group.method_offered
              ? 'FULFILMENT_METHOD_UNAVAILABLE'
              : group.lines.some((line) => !line.supplied)
                ? 'LINE_UNAVAILABLE'
                : subtotal < Number(group.minimum_order_minor)
                  ? 'MINIMUM_NOT_MET'
                  : group.lines.some(
                        (line) =>
                          line.quantity_basis === 'COUNTED' &&
                          Number(line.exact_available_quantity) < line.quantity,
                      )
                    ? 'INVENTORY_UNAVAILABLE'
                    : null;
        return { group, reason };
      });
      const valid = classified
        .filter((entry) => entry.reason === null)
        .map((entry) => entry.group as unknown as SuppliedGroupRow);
      if (!valid.length) throw new CheckoutConflictError('Every cart group is blocked');
      // The road from each store to the door, for every group that travels
      // one. D-05 prices per route kilometre; until routing existed the fee
      // was priced on the straight line and no travel time was promised.
      const routes = new Map<string, RouteLeg | null>();
      for (const group of valid) {
        routes.set(
          group.cart_vendor_group_id,
          group.fulfilment_method === 'CUSTOMER_PICKUP'
            ? null
            : await this.#routing.route(
                { latitude: group.store_latitude, longitude: group.store_longitude },
                { latitude: group.address_latitude, longitude: group.address_longitude },
                now,
              ),
        );
      }
      // The quote is priced by whichever policy version is in force right now,
      // and stamps that version so nothing can re-price it later under another.
      const financialPolicy = await resolveFinancialPolicy(client, { at: now });
      const pricing = calculateCheckoutPricing(
        valid.map((group) => ({
          vendor_location_id: group.vendor_location_id,
          fulfilment_method: group.fulfilment_method,
          item_subtotal_minor: group.lines.reduce(
            (sum, line) => sum + Number(line.unit_price_minor) * line.quantity,
            0,
          ),
          route_metres: routes.get(group.cart_vendor_group_id)?.distance_metres ?? 0,
          tip_minor: Number(group.tip_minor),
        })),
        financialPolicy,
      );
      const quoteId = createUuidV7({ now_ms: now.getTime() });
      const contextIds = ids(input.context);
      await client.query(
        `INSERT INTO marketplace.checkout_quotes (checkout_quote_id,customer_user_id,cart_id,customer_address_id,quote_digest,total_minor,policy_version_reference,expires_at,request_id,correlation_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
        [
          quoteId,
          userId,
          input.cart_id,
          addressId,
          digest,
          pricing.total_minor,
          pricing.policy_version_reference,
          expiresAt,
          contextIds.request,
          contextIds.correlation,
          now,
        ],
      );
      for (const blocked of classified.filter((entry) => entry.reason !== null)) {
        await client.query(
          `INSERT INTO marketplace.checkout_quote_blocked_groups
             (checkout_quote_blocked_group_id,checkout_quote_id,cart_vendor_group_id,vendor_location_id,reason_code)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            createUuidV7(),
            quoteId,
            blocked.group.cart_vendor_group_id,
            blocked.group.vendor_location_id,
            blocked.reason,
          ],
        );
      }
      for (const group of valid) {
        const price = pricing.groups.find(
          (entry) => entry.vendor_location_id === group.vendor_location_id,
        );
        if (!price) throw new CheckoutConflictError('Pricing group disappeared');
        const quoteGroupId = createUuidV7();
        const reservationRef = reference('CHECKOUT', quoteGroupId);
        const route = routes.get(group.cart_vendor_group_id) ?? null;
        const promise = promiseWindow({ preparation_seconds: group.preparation_seconds, route });
        await client.query(
          `INSERT INTO marketplace.checkout_quote_groups (checkout_quote_group_id,checkout_quote_id,cart_vendor_group_id,vendor_location_id,item_minor,delivery_minor,tip_minor,total_minor,reservation_reference,route_metres,route_seconds,route_source,ready_after_seconds,arrives_after_seconds) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            quoteGroupId,
            quoteId,
            group.cart_vendor_group_id,
            group.vendor_location_id,
            price.item_subtotal_minor,
            price.delivery_minor,
            price.tip_minor,
            price.total_minor,
            reservationRef,
            route?.distance_metres ?? null,
            route?.duration_seconds ?? null,
            route?.source ?? null,
            promise.ready_after_seconds,
            promise.arrives_after_seconds,
          ],
        );
        for (const [lineIndex, line] of group.lines.entries()) {
          const locked = await client.query<InventoryItemRow>(
            `SELECT * FROM marketplace.inventory_items WHERE inventory_item_id=$1 FOR UPDATE`,
            [line.inventory_item_id],
          );
          const item = locked.rows[0];
          if (!item) throw new CheckoutConflictError('Inventory changed');
          const counted = item.quantity_basis === 'COUNTED';
          const available =
            item.exact_available_quantity === null ? null : Number(item.exact_available_quantity);
          if (counted && (available === null || available < line.quantity))
            throw new CheckoutConflictError('Inventory changed');
          if (counted && available !== null)
            await client.query(
              `UPDATE marketplace.inventory_items SET exact_available_quantity=$2::bigint,availability_state=CASE WHEN $2::bigint=0 THEN 'OUT_OF_STOCK' WHEN $2::bigint<=low_stock_threshold THEN 'LOW_STOCK' ELSE 'AVAILABLE' END,version=version+1,updated_at=$3 WHERE inventory_item_id=$1`,
              [line.inventory_item_id, available - line.quantity, now],
            );
          else
            await client.query(
              `UPDATE marketplace.inventory_items SET version=version+1,updated_at=$2 WHERE inventory_item_id=$1`,
              [line.inventory_item_id, now],
            );
          const reservationId = createUuidV7();
          const lineReservationRef = `${reservationRef}-${lineIndex + 1}`;
          await client.query(
            `INSERT INTO marketplace.inventory_reservations (reservation_id,inventory_item_id,vendor_location_id,source_reference,reservation_state,quantity,counted_stock_applied,expires_at,request_id,correlation_id,created_at,updated_at) VALUES ($1,$2,$3,$4,'SOFT_HELD',$5,$6,$7,$8,$9,$10,$10)`,
            [
              reservationId,
              line.inventory_item_id,
              group.vendor_location_id,
              lineReservationRef,
              line.quantity,
              counted,
              expiresAt,
              contextIds.request,
              contextIds.correlation,
              now,
            ],
          );
          await this.#inventoryEvent(client, {
            context: input.context,
            event_type: 'SOFT_HELD',
            exact_available_quantity:
              counted && available !== null ? available - line.quantity : null,
            inventory_item_id: line.inventory_item_id,
            item_version: Number(item.version) + 1,
            now,
            quantity: line.quantity,
            reservation_id: reservationId,
            reservation_version: 1,
            resulting_state: 'SOFT_HELD',
          });
          await client.query(
            `INSERT INTO marketplace.checkout_quote_lines (checkout_quote_line_id,checkout_quote_group_id,cart_line_id,catalogue_variant_id,inventory_reservation_id,product_title_snapshot,variant_title_snapshot,quantity,unit_price_minor,line_total_minor,product_version,variant_version,substitution_preference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              createUuidV7(),
              quoteGroupId,
              line.cart_line_id,
              line.catalogue_variant_id,
              reservationId,
              line.product_title,
              line.variant_title,
              line.quantity,
              line.unit_price_minor,
              Number(line.unit_price_minor) * line.quantity,
              line.product_version,
              line.variant_version,
              line.substitution_preference,
            ],
          );
        }
      }
      await client.query(
        `INSERT INTO marketplace.checkout_events (checkout_event_id,checkout_quote_id,event_type,actor_id,request_id,correlation_id,occurred_at) VALUES ($1,$2,'QUOTE_CREATED',$3,$4,$5,$6)`,
        [createUuidV7(), quoteId, userId, contextIds.request, contextIds.correlation, now],
      );
      return this.#projectQuote(client, quoteId);
    });
  }

  async place(input: {
    readonly context: RequestContext;
    readonly checkout_quote_id: UuidV7;
    readonly provider_scenario?: FakeProviderScenario;
    /** The prepaid method the customer chose. COD is gated and not accepted. */
    readonly payment_method?: PaymentMethod;
    readonly idempotency_key?: string;
    readonly now?: Date;
  }) {
    const userId = customer(input.context);
    const now = input.now ?? new Date();
    // Only this customer's lapsed quotes: the sweep of everyone's belongs to
    // the worker, not to a customer's request, and the release events it
    // writes name the actor who released.
    await this.expireQuotes({ context: input.context, customer_user_id: userId, now });
    // First transaction: everything this platform can record before anyone
    // is asked for money -- the payment attempt, the group, the holds carried
    // to the submission's deadline, the transition and its outbox event. If
    // the process dies after this, the sweep finds a PROCESSING group and
    // asks the provider what became of it; nothing is authorised in secret.
    const submitted = await tx(this.#pool, async (client) => {
      // The quote row is the lock a submission is serialised on, whatever the
      // quote's state, and the earlier submission is looked for under it. Two
      // taps that overlapped used to both read "no group yet" before either
      // had the row, and the second died on the group's unique quote id
      // instead of being answered with the first tap's checkout.
      const quote = await client.query<CheckoutQuoteRow>(
        `SELECT * FROM marketplace.checkout_quotes WHERE checkout_quote_id=$1 AND customer_user_id=$2 FOR UPDATE`,
        [input.checkout_quote_id, userId],
      );
      const q = quote.rows[0];
      const existing = await client.query<{
        checkout_group_id: UuidV7;
        checkout_quote_id: string;
        idempotency_key: string | null;
      }>(
        `SELECT checkout_group_id, checkout_quote_id, idempotency_key FROM marketplace.checkout_groups
          WHERE customer_user_id=$2 AND (checkout_quote_id=$1 OR ($3::text IS NOT NULL AND idempotency_key=$3))`,
        [input.checkout_quote_id, userId, input.idempotency_key ?? null],
      );
      const found = existing.rows[0];
      if (found) {
        // A key is a promise that this is the same submission. Reusing it for
        // another quote used to hand back the earlier checkout as if it were
        // this one.
        if (
          input.idempotency_key !== undefined &&
          found.idempotency_key === input.idempotency_key &&
          found.checkout_quote_id !== input.checkout_quote_id
        )
          throw new CheckoutConflictError('Idempotency key was used for a different quote');
        return { checkout_id: found.checkout_group_id, replay: true as const };
      }
      if (!q || q.lifecycle_state !== 'ACTIVE') throw new CheckoutNotFoundError();
      if (q.expires_at <= now) {
        await this.#releaseQuote(
          client,
          input.context,
          input.checkout_quote_id,
          now,
          'QUOTE_EXPIRED',
        );
        await client.query(
          `UPDATE marketplace.checkout_quotes SET lifecycle_state='EXPIRED',updated_at=$2 WHERE checkout_quote_id=$1`,
          [input.checkout_quote_id, now],
        );
        throw new CheckoutConflictError('Quote expired', 'QUOTE_EXPIRED');
      }
      if (await this.#quoteStale(client, input.checkout_quote_id, userId, now))
        throw new CheckoutConflictError('Quote contents changed', 'QUOTE_CHANGED');
      // The cart itself may have moved on since the quote: a line added or
      // removed, a quantity, a method, the address. The quote is for what was
      // quoted, and an order for a cart that no longer matches it is refused.
      const currentAddress = await client.query<{ customer_address_id: string | null }>(
        `SELECT customer_address_id FROM marketplace.carts WHERE cart_id=$1 AND user_id=$2`,
        [q.cart_id, userId],
      );
      const cartDigest = quoteContentDigest({
        user_id: userId,
        cart_id: q.cart_id,
        customer_address_id: currentAddress.rows[0]?.customer_address_id ?? '',
        groups: (await this.#loadCartGroups(client, userId, q.cart_id, now)).rows,
      });
      if (cartDigest !== q.quote_digest)
        throw new CheckoutConflictError('Quote contents changed', 'QUOTE_CHANGED');
      const checkoutId = createUuidV7();
      const paymentId = createUuidV7();
      const checkoutRef = reference('CHECKOUT', checkoutId);
      const operation = reference('PAY', paymentId);
      const contextIds = ids(input.context);
      await client.query(
        `INSERT INTO marketplace.payment_transactions (payment_transaction_id,source_checkout_reference,provider_operation_reference,payment_state,amount_minor,provider_scenario,payment_method,request_id,correlation_id,created_at,updated_at) VALUES ($1,$2,$3,'AUTHORIZING',$4,$5,$6,$7,$8,$9,$9)`,
        [
          paymentId,
          checkoutRef,
          operation,
          q.total_minor,
          input.provider_scenario ?? 'SUCCESS',
          input.payment_method ?? null,
          contextIds.request,
          contextIds.correlation,
          now,
        ],
      );
      await this.#paymentEvent(client, {
        context: input.context,
        event_type: 'AUTHORIZATION_STARTED',
        now,
        payment_id: paymentId,
        payment_version: 1,
        previous_state: null,
        provider_result: 'PENDING',
        resulting_state: 'AUTHORIZING',
      });
      await client.query(
        `INSERT INTO marketplace.checkout_groups (checkout_group_id,checkout_reference,checkout_quote_id,customer_user_id,payment_transaction_id,lifecycle_state,total_minor,idempotency_key,request_id,correlation_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'PROCESSING',$6,$7,$8,$9,$10,$10)`,
        [
          checkoutId,
          checkoutRef,
          input.checkout_quote_id,
          userId,
          paymentId,
          q.total_minor,
          input.idempotency_key ?? null,
          contextIds.request,
          contextIds.correlation,
          now,
        ],
      );
      // The quote's holds were good for the quote's five minutes. A
      // submission may wait on its provider for fifteen; the inventory sweep
      // reads the hold's own expiry, so the hold has to say so.
      await client.query(
        `UPDATE marketplace.inventory_reservations r
            SET expires_at=$2,updated_at=$3
           FROM marketplace.checkout_quote_lines l
           JOIN marketplace.checkout_quote_groups g ON g.checkout_quote_group_id=l.checkout_quote_group_id
          WHERE g.checkout_quote_id=$1 AND r.reservation_id=l.inventory_reservation_id
            AND r.reservation_state='SOFT_HELD' AND r.expires_at<$2`,
        [input.checkout_quote_id, new Date(now.getTime() + PAYMENT_UNKNOWN_DEADLINE_MS), now],
      );
      await this.#createAggregate(client, {
        aggregate_id: checkoutId,
        aggregate_type: 'checkout_group',
        context: input.context,
        event_type: 'checkout.submitted',
        now,
        state: 'PROCESSING',
      });
      await client.query(
        `INSERT INTO marketplace.checkout_events (checkout_event_id,checkout_group_id,checkout_quote_id,event_type,actor_id,request_id,correlation_id,occurred_at) VALUES ($1,$2,$3,'CHECKOUT_SUBMITTED',$4,$5,$6,$7)`,
        [
          createUuidV7(),
          checkoutId,
          input.checkout_quote_id,
          userId,
          contextIds.request,
          contextIds.correlation,
          now,
        ],
      );
      return {
        checkout_id: checkoutId,
        operation,
        replay: false as const,
        scenario: input.provider_scenario ?? 'SUCCESS',
        total_minor: Number(q.total_minor),
      };
    });
    if (submitted.replay) return this.#replayPlacement(submitted.checkout_id);

    // Outside any transaction: the provider. No row is locked while a
    // network is waited on, and a provider that does not answer is UNKNOWN.
    const outcome = await providerOutcome(() =>
      this.#provider.authorize({
        amount_minor: submitted.total_minor,
        operation_reference: submitted.operation,
        scenario: submitted.scenario,
      }),
    );

    // Second transaction: the answer. A webhook may have settled the group
    // first -- providers do send the callback before answering the call --
    // in which case the answer is a receipt and the settled group stands.
    const result = await tx(this.#pool, async (client) => {
      const row = await this.#lockPlacement(client, submitted.checkout_id);
      const waiting =
        row.checkout_state === 'PROCESSING' ||
        (row.checkout_state === 'PAYMENT_UNKNOWN' && outcome !== 'UNKNOWN');
      if (waiting)
        return this.#settleAuthorization(client, {
          context: input.context,
          event_type: 'AUTHORIZATION_RESULT',
          now,
          outcome,
          release_reason: 'PAYMENT_DECLINED',
          row,
        });
      if (outcome !== 'UNKNOWN')
        await this.#lateAnswer(
          client,
          { context: input.context, outcome: outcome === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED' },
          row,
          now,
          null,
        );
      return this.#projectCheckout(client, row.checkout_group_id);
    });
    if ('payment_declined' in result) throw new CheckoutPaymentDeclinedError();
    if ('unfulfillable' in result) throw new CheckoutUnfulfillableError();
    return result;
  }

  /**
   * The same submission again. A placed or waiting group is its projection;
   * one the provider declined is the decline again, because that is what the
   * first submission answered and a retry must not answer differently.
   */
  async #replayPlacement(checkoutId: UuidV7) {
    return tx(this.#pool, async (client) => {
      const row = await this.#lockPlacement(client, checkoutId);
      if (row.checkout_state === 'CANCELLED' && row.payment_state === 'FAILED')
        throw new CheckoutPaymentDeclinedError();
      return this.#projectCheckout(client, checkoutId);
    });
  }

  async #lockPlacement(client: PoolClient, checkoutId: UuidV7): Promise<WebhookPaymentRow> {
    const found = await client.query<WebhookPaymentRow>(
      `SELECT p.*,c.checkout_group_id,c.checkout_quote_id,c.customer_user_id,c.lifecycle_state AS checkout_state,
              q.cart_id,q.policy_version_reference,q.total_minor AS quote_total,q.expires_at
         FROM marketplace.checkout_groups c
         JOIN marketplace.payment_transactions p ON p.payment_transaction_id=c.payment_transaction_id
         JOIN marketplace.checkout_quotes q ON q.checkout_quote_id=c.checkout_quote_id
        WHERE c.checkout_group_id=$1 FOR UPDATE OF p,c,q`,
      [checkoutId],
    );
    const row = found.rows[0];
    if (!row) throw new CheckoutNotFoundError();
    return row;
  }

  /**
   * What the provider's answer does to a submitted group, whichever way it
   * arrived: the call's return, a webhook while the call was still out or
   * after it came back unknown, or the sweep's status query for a placement
   * whose process died between the two transactions. One routine, so the
   * three cannot drift.
   */
  async #settleAuthorization(
    client: PoolClient,
    input: {
      readonly context: RequestContext;
      readonly event_type: 'AUTHORIZATION_RESULT' | 'RECONCILIATION_RESULT' | 'WEBHOOK_RESULT';
      readonly now: Date;
      readonly outcome: FakeProviderOutcome;
      readonly release_reason: 'PAYMENT_DECLINED' | 'PAYMENT_FAILED';
      readonly row: WebhookPaymentRow;
    },
  ) {
    const { now, row } = input;
    // Only a group still waiting for its answer can be settled by one. Every
    // caller checks this first; a group settled twice would be an order
    // cancelled by a late decline, so the routine refuses on its own too.
    if (row.checkout_state !== 'PROCESSING' && row.checkout_state !== 'PAYMENT_UNKNOWN')
      throw new CheckoutConflictError('Checkout is not awaiting a payment answer');
    const contextIds = ids(input.context);
    const version = Number(row.version) + 1;
    const checkoutEvent = async (type: string) => {
      await client.query(
        `INSERT INTO marketplace.checkout_events (checkout_event_id,checkout_group_id,checkout_quote_id,event_type,actor_id,request_id,correlation_id,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          createUuidV7(),
          row.checkout_group_id,
          row.checkout_quote_id,
          type,
          row.customer_user_id,
          contextIds.request,
          contextIds.correlation,
          now,
        ],
      );
    };
    const paymentState =
      input.outcome === 'SUCCEEDED'
        ? 'AUTHORIZED'
        : input.outcome === 'DECLINED'
          ? 'FAILED'
          : 'UNKNOWN_REQUIRES_RECONCILIATION';
    await client.query(
      `UPDATE marketplace.payment_transactions SET payment_state=$2,version=version+1,updated_at=$3 WHERE payment_transaction_id=$1`,
      [row.payment_transaction_id, paymentState, now],
    );
    await this.#paymentEvent(client, {
      context: input.context,
      event_type: input.event_type,
      now,
      payment_id: row.payment_transaction_id,
      payment_version: version,
      previous_state: row.payment_state,
      provider_result: input.outcome,
      resulting_state: paymentState,
    });
    if (input.outcome === 'DECLINED') {
      await this.#releaseQuote(
        client,
        input.context,
        row.checkout_quote_id,
        now,
        input.release_reason,
      );
      await client.query(
        `UPDATE marketplace.checkout_quotes SET lifecycle_state='INVALID',updated_at=$2 WHERE checkout_quote_id=$1`,
        [row.checkout_quote_id, now],
      );
      await client.query(
        `UPDATE marketplace.checkout_groups SET lifecycle_state='CANCELLED',version=version+1,updated_at=$2 WHERE checkout_group_id=$1`,
        [row.checkout_group_id, now],
      );
      await this.#transitionAggregate(client, {
        aggregate_id: row.checkout_group_id,
        aggregate_type: 'checkout_group',
        context: input.context,
        event_type: 'checkout.payment_failed',
        evidence: { source: input.event_type.toLowerCase() },
        from_state: row.checkout_state,
        now,
        reason_code: input.release_reason,
        state: 'CANCELLED',
      });
      await checkoutEvent('PAYMENT_DECLINED');
      await this.#resolveException(client, row.provider_operation_reference, now);
      return { payment_declined: true as const };
    }
    if (input.outcome === 'UNKNOWN') {
      await client.query(
        `UPDATE marketplace.checkout_groups SET lifecycle_state='PAYMENT_UNKNOWN',version=version+1,updated_at=$2 WHERE checkout_group_id=$1`,
        [row.checkout_group_id, now],
      );
      await this.#transitionAggregate(client, {
        aggregate_id: row.checkout_group_id,
        aggregate_type: 'checkout_group',
        context: input.context,
        event_type: 'checkout.payment_unknown',
        evidence: { source: input.event_type.toLowerCase() },
        from_state: row.checkout_state,
        now,
        reason_code: 'PROVIDER_RESULT_UNKNOWN',
        state: 'PAYMENT_UNKNOWN',
      });
      await checkoutEvent('PAYMENT_UNKNOWN');
      // Finance sees the unknown money from the moment it is unknown, not
      // only if the provider's webhook ever comes.
      await client.query(
        `INSERT INTO marketplace.finance_exceptions
           (finance_exception_id,exception_kind,operation_reference,amount_at_risk_minor,
            next_action_code,created_at,updated_at)
         VALUES ($1,'PAYMENT_UNKNOWN',$2,$3,'AWAIT_PROVIDER_WEBHOOK',$4,$4)`,
        [createUuidV7(), row.provider_operation_reference, row.amount_minor, now],
      );
      return this.#projectCheckout(client, row.checkout_group_id);
    }
    // The orders are made inside a savepoint. A hold that is no longer there
    // -- the stock lapsed while the answer was awaited, or was taken by the
    // inventory sweep -- used to throw the whole settlement away: the group
    // stayed PROCESSING with the customer's money authorised, and every sweep
    // ran into the same missing hold. A placement that cannot be fulfilled is
    // ended here instead, with the money released, and the customer told.
    await client.query('SAVEPOINT finalize_orders');
    try {
      await this.#finalize(client, {
        checkout_id: row.checkout_group_id,
        context: input.context,
        now,
        payment_id: row.payment_transaction_id,
        quote: {
          cart_id: row.cart_id,
          checkout_quote_id: row.checkout_quote_id,
          customer_user_id: row.customer_user_id,
          policy_version_reference: row.policy_version_reference,
        },
      });
      await client.query('RELEASE SAVEPOINT finalize_orders');
    } catch (error) {
      if (!(error instanceof CheckoutConflictError)) throw error;
      await client.query('ROLLBACK TO SAVEPOINT finalize_orders');
      return this.#endUnfulfillable(client, input, row, version, now);
    }
    await client.query(
      `UPDATE marketplace.checkout_groups SET lifecycle_state='ACTIVE',version=version+1,updated_at=$2 WHERE checkout_group_id=$1`,
      [row.checkout_group_id, now],
    );
    await this.#transitionAggregate(client, {
      aggregate_id: row.checkout_group_id,
      aggregate_type: 'checkout_group',
      context: input.context,
      event_type:
        input.event_type === 'WEBHOOK_RESULT' ? 'checkout.webhook_authorized' : 'checkout.placed',
      evidence: { source: input.event_type.toLowerCase() },
      from_state: row.checkout_state,
      now,
      reason_code: 'PAYMENT_AUTHORIZED',
      state: 'ACTIVE',
    });
    await checkoutEvent('CHECKOUT_PLACED');
    await this.#resolveException(client, row.provider_operation_reference, now);
    return this.#projectCheckout(client, row.checkout_group_id);
  }

  /**
   * A placement the provider authorised that cannot be fulfilled: nothing of
   * the orders is kept, the holds that remain are given back, the quote is
   * retired, the group is cancelled, and the authorisation is voided through
   * the provider -- or, if the provider does not answer the void, the payment
   * stays AUTHORIZED with a finance exception asking for it. The customer is
   * refused with INVENTORY_UNAVAILABLE and can quote again.
   */
  async #endUnfulfillable(
    client: PoolClient,
    input: { readonly context: RequestContext; readonly event_type: string },
    row: WebhookPaymentRow,
    authorizedVersion: number,
    now: Date,
  ) {
    const contextIds = ids(input.context);
    await this.#releaseQuote(
      client,
      input.context,
      row.checkout_quote_id,
      now,
      'FULFILMENT_UNAVAILABLE',
    );
    await client.query(
      `UPDATE marketplace.checkout_quotes SET lifecycle_state='INVALID',updated_at=$2 WHERE checkout_quote_id=$1`,
      [row.checkout_quote_id, now],
    );
    await client.query(
      `UPDATE marketplace.checkout_groups SET lifecycle_state='CANCELLED',version=version+1,updated_at=$2 WHERE checkout_group_id=$1`,
      [row.checkout_group_id, now],
    );
    await this.#transitionAggregate(client, {
      aggregate_id: row.checkout_group_id,
      aggregate_type: 'checkout_group',
      context: input.context,
      event_type: 'checkout.payment_failed',
      evidence: { source: input.event_type.toLowerCase(), reason: 'FULFILMENT_UNAVAILABLE' },
      from_state: row.checkout_state,
      now,
      reason_code: 'FULFILMENT_UNAVAILABLE',
      state: 'CANCELLED',
    });
    await client.query(
      `INSERT INTO marketplace.checkout_events (checkout_event_id,checkout_group_id,checkout_quote_id,event_type,actor_id,request_id,correlation_id,occurred_at) VALUES ($1,$2,$3,'CHECKOUT_FAILED',$4,$5,$6,$7)`,
      [
        createUuidV7(),
        row.checkout_group_id,
        row.checkout_quote_id,
        row.customer_user_id,
        contextIds.request,
        contextIds.correlation,
        now,
      ],
    );
    const voided = await providerOutcome(() =>
      this.#provider.void({
        amount_minor: Number(row.amount_minor),
        operation_reference: row.provider_operation_reference,
        scenario: row.provider_scenario,
      }),
    );
    if (voided === 'SUCCEEDED') {
      await client.query(
        `UPDATE marketplace.payment_transactions
            SET payment_state='VOIDED',voided_amount_minor=amount_minor,voided_at=$2,version=version+1,updated_at=$2
          WHERE payment_transaction_id=$1`,
        [row.payment_transaction_id, now],
      );
      await this.#paymentEvent(client, {
        context: input.context,
        event_type: 'PAYMENT_VOIDED',
        now,
        payment_id: row.payment_transaction_id,
        payment_version: authorizedVersion + 1,
        previous_state: 'AUTHORIZED',
        provider_result: 'SUCCEEDED',
        reason_code: 'FULFILMENT_UNAVAILABLE',
        resulting_state: 'VOIDED',
      });
      await this.#resolveException(client, row.provider_operation_reference, now);
    } else {
      await client.query(
        `INSERT INTO marketplace.finance_exceptions
           (finance_exception_id,exception_kind,operation_reference,amount_at_risk_minor,
            next_action_code,created_at,updated_at)
         VALUES ($1,'PAYMENT_UNKNOWN',$2,$3,'VOID_UNFULFILLED_AUTHORIZATION',$4,$4)`,
        [createUuidV7(), row.provider_operation_reference, row.amount_minor, now],
      );
    }
    return { unfulfillable: true as const };
  }

  async receiveWebhook(input: {
    readonly context: RequestContext;
    readonly provider_event_id: string;
    readonly provider_operation_reference: string;
    readonly outcome: 'SUCCEEDED' | 'FAILED';
    readonly occurred_at: string;
    readonly signature: string;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    if (!/^[A-Z0-9][A-Z0-9._:/-]{3,127}$/.test(input.provider_event_id))
      throw new CheckoutInputError('Invalid provider event');
    const occurredAt = new Date(input.occurred_at);
    if (
      !Number.isFinite(occurredAt.getTime()) ||
      Math.abs(now.getTime() - occurredAt.getTime()) > 300_000
    )
      throw new CheckoutInputError('Stale provider event');
    const body = JSON.stringify({
      provider_event_id: input.provider_event_id,
      provider_operation_reference: input.provider_operation_reference,
      outcome: input.outcome,
      occurred_at: input.occurred_at,
    });
    if (!this.#provider.verifyWebhook({ payload: body, signature: input.signature }))
      throw new CheckoutInputError('Invalid webhook signature');
    return tx(this.#pool, async (client) => {
      const found = await client.query<WebhookPaymentRow>(
        `SELECT p.*,c.checkout_group_id,c.checkout_quote_id,c.customer_user_id,c.lifecycle_state AS checkout_state,
                q.cart_id,q.policy_version_reference,q.total_minor AS quote_total
           FROM marketplace.payment_transactions p
           JOIN marketplace.checkout_groups c ON c.payment_transaction_id=p.payment_transaction_id
           JOIN marketplace.checkout_quotes q ON q.checkout_quote_id=c.checkout_quote_id
          WHERE p.provider_operation_reference=$1 FOR UPDATE OF p,c,q`,
        [input.provider_operation_reference],
      );
      const row = found.rows[0];
      if (!row) throw new CheckoutNotFoundError();
      // The receipt is the replay guard, and it is taken under the payment's
      // lock: two deliveries of one event used to both pass a read-then-insert
      // and the second died on the unique key. A reused event id carrying
      // different content is not a replay and is refused.
      const digest = createHash('sha256').update(body).digest('hex');
      const receipt = await client.query(
        `INSERT INTO marketplace.provider_webhook_receipts
           (provider_receipt_id,provider_event_id,provider_operation_reference,payload_digest,received_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (provider_event_id) DO NOTHING
         RETURNING provider_receipt_id`,
        [createUuidV7(), input.provider_event_id, input.provider_operation_reference, digest, now],
      );
      if (!receipt.rows[0]) {
        const earlier = await client.query<{ payload_digest: string }>(
          `SELECT payload_digest FROM marketplace.provider_webhook_receipts WHERE provider_event_id=$1`,
          [input.provider_event_id],
        );
        if (earlier.rows[0]?.payload_digest !== digest) {
          // Refused, and queued for a person (11.5): recorded on its own
          // connection, since the refusal rolls this transaction back.
          await this.#pool.query(
            `INSERT INTO marketplace.finance_exceptions
               (finance_exception_id,exception_kind,operation_reference,amount_at_risk_minor,
                expected_minor,business_reference,owner_reference,next_action_code,created_at,updated_at)
             SELECT $1,'WEBHOOK_CONFLICT',$2,$3,$3,$4,'FINANCE_RECONCILIATION','CONFIRM_WITH_PROVIDER',$5,$5
              WHERE NOT EXISTS (SELECT 1 FROM marketplace.finance_exceptions
                                 WHERE exception_kind='WEBHOOK_CONFLICT' AND business_reference=$4
                                   AND exception_state<>'RESOLVED')`,
            [
              createUuidV7(),
              input.provider_operation_reference,
              row.amount_minor,
              input.provider_event_id,
              now,
            ],
          );
          throw new CheckoutInputError('Provider event conflicts with its earlier delivery');
        }
        return { replayed: true };
      }
      const waiting =
        row.checkout_state === 'PAYMENT_UNKNOWN' || row.checkout_state === 'PROCESSING';
      if (!waiting) {
        await this.#lateAnswer(client, input, row, now, 'WEBHOOK_ACCEPTED');
        return {
          replayed: false,
          checkout: await this.#projectCheckout(client, row.checkout_group_id),
        };
      }
      await this.#settleAuthorization(client, {
        context: input.context,
        event_type: 'WEBHOOK_RESULT',
        now,
        outcome: input.outcome === 'SUCCEEDED' ? 'SUCCEEDED' : 'DECLINED',
        release_reason: 'PAYMENT_FAILED',
        row,
      });
      const eventIds = ids(input.context);
      await client.query(
        `INSERT INTO marketplace.checkout_events
           (checkout_event_id,checkout_group_id,checkout_quote_id,event_type,actor_id,request_id,correlation_id,occurred_at)
         VALUES ($1,$2,$3,'WEBHOOK_ACCEPTED',$4,$5,$6,$7)`,
        [
          createUuidV7(),
          row.checkout_group_id,
          row.checkout_quote_id,
          row.customer_user_id,
          eventIds.request,
          eventIds.correlation,
          now,
        ],
      );
      return {
        replayed: false,
        checkout: await this.#projectCheckout(client, row.checkout_group_id),
      };
    });
  }

  async expireQuotes(input: {
    readonly context: RequestContext;
    readonly customer_user_id?: UuidV7;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      // A quote whose placement is waiting on the provider keeps its holds:
      // a late "succeeded" turns them into an order, and without them it
      // could only be refused. Giving up on that wait is the abandonment
      // sweep's decision, on its own deadline.
      const quotes = await client.query<{ checkout_quote_id: UuidV7 }>(
        `SELECT checkout_quote_id FROM marketplace.checkout_quotes quote
          WHERE lifecycle_state='ACTIVE' AND expires_at<=$1
            AND ($2::uuid IS NULL OR customer_user_id=$2)
            AND NOT EXISTS (SELECT 1 FROM marketplace.checkout_groups grouping
                             WHERE grouping.checkout_quote_id=quote.checkout_quote_id
                               AND grouping.lifecycle_state IN ('PROCESSING','PAYMENT_UNKNOWN'))
          FOR UPDATE SKIP LOCKED`,
        [now, input.customer_user_id ?? null],
      );
      for (const quote of quotes.rows) {
        await this.#releaseQuote(
          client,
          input.context,
          quote.checkout_quote_id,
          now,
          'QUOTE_EXPIRED',
        );
        await client.query(
          `UPDATE marketplace.checkout_quotes SET lifecycle_state='EXPIRED',updated_at=$2 WHERE checkout_quote_id=$1`,
          [quote.checkout_quote_id, now],
        );
      }
      return quotes.rowCount ?? 0;
    });
  }

  /**
   * Gives up on placements whose provider never answered. A group held as
   * PAYMENT_UNKNOWN past the deadline has its stock given back, its quote
   * retired and itself cancelled; the payment stays unknown, because it is,
   * and its finance exception now asks for the authorisation to be found and
   * released. A webhook that arrives after this is handled by `#lateWebhook`.
   */
  async abandonUnknownPayments(input: { readonly context: RequestContext; readonly now?: Date }) {
    const now = input.now ?? new Date();
    const contextIds = ids(input.context);
    return tx(this.#pool, async (client) => {
      const groups = await client.query<{
        checkout_group_id: UuidV7;
        checkout_quote_id: UuidV7;
        customer_user_id: UuidV7;
        provider_operation_reference: string;
      }>(
        `SELECT grouping.checkout_group_id, grouping.checkout_quote_id, grouping.customer_user_id,
                payment.provider_operation_reference
           FROM marketplace.checkout_groups grouping
           JOIN marketplace.payment_transactions payment USING (payment_transaction_id)
          WHERE grouping.lifecycle_state='PAYMENT_UNKNOWN' AND grouping.created_at<=$1
          FOR UPDATE OF grouping, payment SKIP LOCKED`,
        [new Date(now.getTime() - PAYMENT_UNKNOWN_DEADLINE_MS)],
      );
      for (const group of groups.rows) {
        await this.#releaseQuote(
          client,
          input.context,
          group.checkout_quote_id,
          now,
          'PAYMENT_ABANDONED',
        );
        await client.query(
          `UPDATE marketplace.checkout_quotes SET lifecycle_state='EXPIRED',updated_at=$2 WHERE checkout_quote_id=$1`,
          [group.checkout_quote_id, now],
        );
        await client.query(
          `UPDATE marketplace.checkout_groups SET lifecycle_state='CANCELLED',version=version+1,updated_at=$2 WHERE checkout_group_id=$1`,
          [group.checkout_group_id, now],
        );
        await this.#transitionAggregate(client, {
          aggregate_id: group.checkout_group_id,
          aggregate_type: 'checkout_group',
          context: input.context,
          event_type: 'checkout.payment_abandoned',
          evidence: { source: 'abandonment_sweep', deadline_ms: PAYMENT_UNKNOWN_DEADLINE_MS },
          from_state: 'PAYMENT_UNKNOWN',
          now,
          reason_code: 'PAYMENT_ABANDONED',
          state: 'CANCELLED',
        });
        await client.query(
          `INSERT INTO marketplace.checkout_events
             (checkout_event_id,checkout_group_id,checkout_quote_id,event_type,actor_id,request_id,correlation_id,occurred_at)
           VALUES ($1,$2,$3,'PAYMENT_ABANDONED',$4,$5,$6,$7)`,
          [
            createUuidV7(),
            group.checkout_group_id,
            group.checkout_quote_id,
            group.customer_user_id,
            contextIds.request,
            contextIds.correlation,
            now,
          ],
        );
        await client.query(
          `UPDATE marketplace.finance_exceptions
              SET next_action_code='RECONCILE_ABANDONED_AUTHORIZATION',updated_at=$2
            WHERE operation_reference=$1 AND exception_state<>'RESOLVED'`,
          [group.provider_operation_reference, now],
        );
      }
      return groups.rowCount ?? 0;
    });
  }

  /**
   * Placements whose process died between recording the submission and
   * recording the provider's answer. After `PROCESSING_DEADLINE_MS` the
   * sweep asks the provider what became of the operation -- outside any
   * transaction, like the call it stands in for -- and settles the group with
   * the answer; no answer is the unknown answer, and the abandonment sweep
   * takes it from there. Nothing here revives a hold: a settlement that finds
   * the holds gone fails on them rather than inventing stock.
   */
  async reconcileProcessingPlacements(input: {
    readonly context: RequestContext;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const stale = await this.#pool.query<{
      checkout_group_id: UuidV7;
      provider_operation_reference: string;
    }>(
      `SELECT grouping.checkout_group_id, payment.provider_operation_reference
         FROM marketplace.checkout_groups grouping
         JOIN marketplace.payment_transactions payment USING (payment_transaction_id)
        WHERE grouping.lifecycle_state='PROCESSING' AND grouping.created_at<=$1
        ORDER BY grouping.created_at
        LIMIT 100`,
      [new Date(now.getTime() - PROCESSING_DEADLINE_MS)],
    );
    let settled = 0;
    for (const group of stale.rows) {
      const status = await providerOutcome(async () => {
        const answer = await this.#provider.status(group.provider_operation_reference);
        return answer ?? 'UNKNOWN';
      });
      const done = await tx(this.#pool, async (client) => {
        const row = await this.#lockPlacement(client, group.checkout_group_id);
        if (row.checkout_state !== 'PROCESSING') return false;
        await this.#settleAuthorization(client, {
          context: input.context,
          event_type: 'RECONCILIATION_RESULT',
          now,
          outcome: status,
          release_reason: 'PAYMENT_FAILED',
          row,
        });
        return true;
      });
      if (done) settled += 1;
    }
    return settled;
  }

  /**
   * A provider's answer for a placement that is no longer waiting for one.
   *
   * After abandonment the payment is still unknown, so the answer is the
   * first real word about the money: "succeeded" means the customer's bank
   * holds an amount no order will use, and it is voided here, through the
   * provider, before anyone has to notice; "failed" closes the exception.
   * For a payment the checkout already settled one way, an answer that
   * agrees is a receipt and an answer that disagrees is a conflict for a
   * person -- the orders may be in flight, so nothing is moved on its own.
   * Before this every late answer was recorded and ignored. The call's own
   * return can be late too, when a webhook settled the group first; it is
   * checked the same way and leaves no webhook event.
   */
  async #lateAnswer(
    client: PoolClient,
    input: {
      readonly context: RequestContext;
      readonly outcome: 'SUCCEEDED' | 'FAILED';
    },
    row: WebhookPaymentRow,
    now: Date,
    checkoutEvent: 'WEBHOOK_ACCEPTED' | null,
  ) {
    const contextIds = ids(input.context);
    const paymentId = row.payment_transaction_id;
    const version = Number(row.version);
    const unresolved = row.payment_state === 'UNKNOWN_REQUIRES_RECONCILIATION';
    if (unresolved && input.outcome === 'FAILED') {
      await client.query(
        `UPDATE marketplace.payment_transactions SET payment_state='FAILED',version=version+1,updated_at=$2 WHERE payment_transaction_id=$1`,
        [paymentId, now],
      );
      await this.#paymentEvent(client, {
        context: input.context,
        event_type: 'WEBHOOK_RESULT',
        now,
        payment_id: paymentId,
        payment_version: version + 1,
        previous_state: row.payment_state,
        provider_result: 'FAILED',
        reason_code: 'LATE_PROVIDER_RESULT',
        resulting_state: 'FAILED',
      });
      await this.#resolveException(client, row.provider_operation_reference, now);
    } else if (unresolved) {
      await client.query(
        `UPDATE marketplace.payment_transactions SET payment_state='AUTHORIZED',version=version+1,updated_at=$2 WHERE payment_transaction_id=$1`,
        [paymentId, now],
      );
      await this.#paymentEvent(client, {
        context: input.context,
        event_type: 'WEBHOOK_RESULT',
        now,
        payment_id: paymentId,
        payment_version: version + 1,
        previous_state: row.payment_state,
        provider_result: 'SUCCEEDED',
        reason_code: 'LATE_PROVIDER_RESULT',
        resulting_state: 'AUTHORIZED',
      });
      const voided = await providerOutcome(() =>
        this.#provider.void({
          amount_minor: Number(row.amount_minor),
          operation_reference: row.provider_operation_reference,
          scenario: row.provider_scenario,
        }),
      );
      if (voided === 'SUCCEEDED') {
        await client.query(
          `UPDATE marketplace.payment_transactions
              SET payment_state='VOIDED',voided_amount_minor=amount_minor,voided_at=$2,version=version+1,updated_at=$2
            WHERE payment_transaction_id=$1`,
          [paymentId, now],
        );
        await this.#paymentEvent(client, {
          context: input.context,
          event_type: 'PAYMENT_VOIDED',
          now,
          payment_id: paymentId,
          payment_version: version + 2,
          previous_state: 'AUTHORIZED',
          provider_result: 'SUCCEEDED',
          reason_code: 'LATE_AUTHORIZATION_VOIDED',
          resulting_state: 'VOIDED',
        });
        await this.#resolveException(client, row.provider_operation_reference, now);
      } else {
        await client.query(
          `UPDATE marketplace.finance_exceptions
              SET next_action_code='VOID_LATE_AUTHORIZATION',updated_at=$2
            WHERE operation_reference=$1 AND exception_state<>'RESOLVED'`,
          [row.provider_operation_reference, now],
        );
      }
    } else {
      const heldMoney = ['AUTHORIZED', 'CAPTURE_PENDING', 'CAPTURED', 'VOID_PENDING', 'VOIDED'];
      const agrees =
        input.outcome === 'SUCCEEDED'
          ? heldMoney.includes(row.payment_state)
          : row.payment_state === 'FAILED' || row.payment_state === 'CANCELLED';
      if (!agrees)
        await client.query(
          `INSERT INTO marketplace.finance_exceptions
             (finance_exception_id,exception_kind,operation_reference,amount_at_risk_minor,
              owner_reference,next_action_code,created_at,updated_at)
           VALUES ($1,'STATUS_MISMATCH',$2,$3,'FINANCE_RECONCILIATION','REVIEW_PROVIDER_CONFLICT',$4,$4)`,
          [createUuidV7(), row.provider_operation_reference, row.amount_minor, now],
        );
    }
    if (checkoutEvent)
      await client.query(
        `INSERT INTO marketplace.checkout_events
           (checkout_event_id,checkout_group_id,checkout_quote_id,event_type,actor_id,request_id,correlation_id,occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          createUuidV7(),
          row.checkout_group_id,
          row.checkout_quote_id,
          checkoutEvent,
          row.customer_user_id,
          contextIds.request,
          contextIds.correlation,
          now,
        ],
      );
  }

  async #resolveException(client: PoolClient, operationReference: string, now: Date) {
    await client.query(
      `UPDATE marketplace.finance_exceptions SET exception_state='RESOLVED',updated_at=$2
        WHERE operation_reference=$1 AND exception_kind='PAYMENT_UNKNOWN' AND exception_state<>'RESOLVED'`,
      [operationReference, now],
    );
  }

  async #finalize(
    client: PoolClient,
    input: {
      readonly checkout_id: string;
      readonly context: RequestContext;
      readonly now: Date;
      readonly payment_id: string;
      readonly quote: Pick<
        CheckoutQuoteRow,
        'cart_id' | 'checkout_quote_id' | 'customer_user_id' | 'policy_version_reference'
      >;
    },
  ) {
    const groups = await client.query<FinalizeGroupRow>(
      `SELECT qg.*,cg.fulfilment_method
         FROM marketplace.checkout_quote_groups qg
         JOIN marketplace.cart_vendor_groups cg USING (cart_vendor_group_id)
        WHERE checkout_quote_id=$1 ORDER BY vendor_location_id`,
      [input.quote.checkout_quote_id],
    );
    // The shop's response deadline starts now, with the placement itself.
    // Nothing set it before: the fulfilment service had a method to issue
    // deadlines that only the verifier called, so every real order sat PLACED
    // with no countdown and the worker's expiry sweep never found a row.
    // How long, from `vendor.accept_deadline_seconds` (11.6: a versioned
    // setting, 60-1800), else the default three minutes.
    const configured = await resolveConfiguration(client, {
      configuration_key: 'vendor.accept_deadline_seconds',
      configuration_kind: 'SETTING',
      at: input.now,
    });
    const acceptSeconds =
      typeof configured?.configuration_value === 'number' &&
      Number.isSafeInteger(configured.configuration_value) &&
      configured.configuration_value >= 60 &&
      configured.configuration_value <= 1800
        ? configured.configuration_value
        : DEFAULT_ACCEPT_DEADLINE_SECONDS;
    const acceptBy = new Date(input.now.getTime() + acceptSeconds * 1000);
    for (const group of groups.rows) {
      const orderId = createUuidV7();
      const orderRef = reference('ORDER', orderId);
      await client.query(
        `INSERT INTO marketplace.vendor_orders
           (vendor_order_id,order_reference,checkout_group_id,vendor_location_id,total_minor,
            accept_by,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
        [
          orderId,
          orderRef,
          input.checkout_id,
          group.vendor_location_id,
          group.total_minor,
          acceptBy,
          input.now,
        ],
      );
      await this.#createAggregate(client, {
        aggregate_id: orderId,
        aggregate_type: 'vendor_order',
        context: input.context,
        event_type: 'order.placed',
        now: input.now,
        payload: {
          fulfilment_method: group.fulfilment_method,
          order_reference: orderRef,
          vendor_location_id: group.vendor_location_id,
          vendor_order_id: orderId,
        },
        state: 'PLACED',
      });
      const lines = await client.query<FinalizeLineRow>(
        `SELECT ql.*,r.inventory_item_id,r.version AS reservation_version,i.version AS item_version,i.exact_available_quantity
           FROM marketplace.checkout_quote_lines ql
           JOIN marketplace.inventory_reservations r ON r.reservation_id=ql.inventory_reservation_id
           JOIN marketplace.inventory_items i ON i.inventory_item_id=r.inventory_item_id
          WHERE ql.checkout_quote_group_id=$1 FOR UPDATE OF r,i`,
        [group.checkout_quote_group_id],
      );
      for (const line of lines.rows) {
        const updated = await client.query(
          `UPDATE marketplace.inventory_reservations
              SET reservation_state='PROVISIONAL',expires_at=$3,version=version+1,updated_at=$2
            WHERE reservation_id=$1 AND reservation_state='SOFT_HELD'`,
          [
            line.inventory_reservation_id,
            input.now,
            new Date(input.now.getTime() + PLACED_ORDER_HOLD_MS),
          ],
        );
        if (updated.rowCount !== 1)
          throw new CheckoutConflictError('Inventory hold is unavailable');
        await client.query(
          `UPDATE marketplace.inventory_items SET version=version+1,updated_at=$2 WHERE inventory_item_id=$1`,
          [line.inventory_item_id, input.now],
        );
        await this.#inventoryEvent(client, {
          context: input.context,
          event_type: 'PROVISIONAL',
          exact_available_quantity: line.exact_available_quantity,
          inventory_item_id: line.inventory_item_id,
          item_version: Number(line.item_version) + 1,
          now: input.now,
          quantity: Number(line.quantity),
          reservation_id: line.inventory_reservation_id,
          reservation_version: Number(line.reservation_version) + 1,
          resulting_state: 'PROVISIONAL',
        });
        await client.query(
          `INSERT INTO marketplace.vendor_order_lines (vendor_order_line_id,vendor_order_id,catalogue_variant_id,inventory_reservation_id,product_title_snapshot,variant_title_snapshot,quantity,unit_price_minor,line_total_minor,substitution_preference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            createUuidV7(),
            orderId,
            line.catalogue_variant_id,
            line.inventory_reservation_id,
            line.product_title_snapshot,
            line.variant_title_snapshot,
            line.quantity,
            line.unit_price_minor,
            line.line_total_minor,
            line.substitution_preference,
          ],
        );
      }
      await client.query(
        `INSERT INTO marketplace.payment_allocations (payment_allocation_id,payment_transaction_id,source_order_reference,vendor_location_id,item_minor,tax_minor,delivery_minor,tip_minor,discount_minor,policy_version_reference) VALUES ($1,$2,$3,$4,$5,0,$6,$7,0,$8)`,
        [
          createUuidV7(),
          input.payment_id,
          orderRef,
          group.vendor_location_id,
          group.item_minor,
          group.delivery_minor,
          group.tip_minor,
          input.quote.policy_version_reference,
        ],
      );
    }
    await client.query(
      `UPDATE marketplace.checkout_quotes SET lifecycle_state='CONSUMED',updated_at=$2 WHERE checkout_quote_id=$1`,
      [input.quote.checkout_quote_id, input.now],
    );
    await client.query(
      `UPDATE marketplace.carts SET lifecycle_state='CHECKED_OUT',version=version+1,updated_at=$2 WHERE cart_id=$1`,
      [input.quote.cart_id, input.now],
    );
  }

  async get(input: { readonly context: RequestContext; readonly checkout_group_id: UuidV7 }) {
    return this.#projectOwned(input.context, input.checkout_group_id);
  }
  async history(input: {
    readonly context: RequestContext;
    readonly checkout_group_id: UuidV7;
    readonly cursor?: UuidV7;
    readonly limit?: number;
  }) {
    const userId = customer(input.context);
    const owner = await this.#pool.query(
      `SELECT 1 FROM marketplace.checkout_groups WHERE checkout_group_id=$1 AND customer_user_id=$2`,
      [input.checkout_group_id, userId],
    );
    if (!owner.rows[0]) throw new CheckoutNotFoundError();
    const limit = Math.min(50, Math.max(1, input.limit ?? 20));
    const events = await this.#pool.query<CheckoutEventRow>(
      `SELECT checkout_event_id,event_type,request_id,correlation_id,occurred_at
         FROM marketplace.checkout_events
        WHERE checkout_group_id=$1 AND ($2::uuid IS NULL OR checkout_event_id<$2)
        ORDER BY checkout_event_id DESC LIMIT $3`,
      [input.checkout_group_id, input.cursor ?? null, limit + 1],
    );
    return {
      items: events.rows.slice(0, limit),
      next_cursor: events.rows.length > limit ? events.rows[limit - 1]?.checkout_event_id : null,
    };
  }
  async #projectOwned(context: RequestContext, id: UuidV7) {
    const userId = customer(context);
    const result = await this.#pool.query(
      `SELECT 1 FROM marketplace.checkout_groups WHERE checkout_group_id=$1 AND customer_user_id=$2`,
      [id, userId],
    );
    if (!result.rows[0]) throw new CheckoutNotFoundError();
    return this.#projectCheckout(this.#pool, id);
  }
  async #projectQuote(client: Pick<PoolClient, 'query'>, id: string) {
    const q = await client.query<CheckoutQuoteRow>(
      `SELECT * FROM marketplace.checkout_quotes WHERE checkout_quote_id=$1`,
      [id],
    );
    const groups = await client.query<QuoteGroupProjection>(
      `SELECT quote_group.*, cart_group.fulfilment_method, location.location_name,
              (SELECT array_agg(DISTINCT line.substitution_preference)
                 FROM marketplace.checkout_quote_lines line
                WHERE line.checkout_quote_group_id = quote_group.checkout_quote_group_id) AS substitution_preferences
         FROM marketplace.checkout_quote_groups quote_group
         JOIN marketplace.cart_vendor_groups cart_group USING (cart_vendor_group_id)
         JOIN marketplace.vendor_locations location
           ON location.vendor_location_id = quote_group.vendor_location_id
        WHERE quote_group.checkout_quote_id=$1
        ORDER BY location.location_name, quote_group.vendor_location_id`,
      [id],
    );
    const blocked = await client.query<BlockedGroupProjection>(
      `SELECT cart_vendor_group_id,vendor_location_id,reason_code
         FROM marketplace.checkout_quote_blocked_groups
        WHERE checkout_quote_id=$1 ORDER BY vendor_location_id`,
      [id],
    );
    const quote = q.rows[0];
    if (!quote) throw new CheckoutNotFoundError();
    return {
      ...quote,
      cart_id: parseUuidV7(quote.cart_id),
      checkout_quote_id: parseUuidV7(quote.checkout_quote_id),
      customer_user_id: parseUuidV7(quote.customer_user_id),
      total_minor: Number(quote.total_minor),
      authorization_buffer_minor: 0,
      groups: groups.rows.map((g) => ({
        ...g,
        item_minor: Number(g.item_minor),
        delivery_minor: Number(g.delivery_minor),
        tip_minor: Number(g.tip_minor),
        total_minor: Number(g.total_minor),
        route_metres: g.route_metres === null ? null : Number(g.route_metres),
        route_seconds: g.route_seconds === null ? null : Number(g.route_seconds),
        route_source: g.route_source,
        ready_after_seconds: Number(g.ready_after_seconds),
        arrives_after_seconds:
          g.arrives_after_seconds === null ? null : Number(g.arrives_after_seconds),
        promise: promiseSentence({
          fulfilment_method: g.fulfilment_method,
          ready_after_seconds: Number(g.ready_after_seconds),
          arrives_after_seconds:
            g.arrives_after_seconds === null ? null : Number(g.arrives_after_seconds),
          route_source: g.route_source,
        }),
        decision_rule: decisionRule(g.substitution_preferences),
      })),
      blocked_groups: blocked.rows,
    };
  }
  /**
   * The group as its customer sees it: what it is (derived from its orders,
   * see `deriveCheckoutGroupState`), what it cost, and each shop's order by
   * name, reference and state. Every field is named. This used to spread the
   * whole group row and every column of every order row -- the idempotency
   * key, request ids, the shop's decline note, the staff member who delivered,
   * and the pickup and delivery code hashes, which are plain sha256 of six
   * digits and so are the codes themselves.
   */
  async #projectCheckout(client: Pick<PoolClient, 'query'>, id: string) {
    const c = await client.query<CheckoutGroupProjection>(
      `SELECT checkout_group_id, checkout_reference, checkout_quote_id, created_at,
              lifecycle_state, payment_transaction_id, total_minor, version
         FROM marketplace.checkout_groups WHERE checkout_group_id=$1`,
      [id],
    );
    const orders = await client.query<VendorOrderProjection>(
      `SELECT vendor_order.vendor_order_id, vendor_order.checkout_group_id,
              vendor_order.vendor_location_id, vendor_order.order_reference,
              vendor_order.lifecycle_state, vendor_order.total_minor, vendor_order.accept_by,
              vendor_order.version, location.location_name, cart_group.fulfilment_method
         FROM marketplace.vendor_orders vendor_order
         JOIN marketplace.vendor_locations location
           ON location.vendor_location_id = vendor_order.vendor_location_id
         JOIN marketplace.checkout_groups grouping
           ON grouping.checkout_group_id = vendor_order.checkout_group_id
         LEFT JOIN marketplace.checkout_quote_groups quote_group
           ON quote_group.checkout_quote_id = grouping.checkout_quote_id
          AND quote_group.vendor_location_id = vendor_order.vendor_location_id
         LEFT JOIN marketplace.cart_vendor_groups cart_group
           ON cart_group.cart_vendor_group_id = quote_group.cart_vendor_group_id
        WHERE vendor_order.checkout_group_id=$1
        ORDER BY location.location_name, vendor_order.vendor_location_id`,
      [id],
    );
    const checkout = c.rows[0];
    if (!checkout) throw new CheckoutNotFoundError();
    const derivedState = deriveCheckoutGroupState({
      payment_state: checkout.lifecycle_state,
      orders: orders.rows,
    });
    return {
      checkout_group_id: parseUuidV7(checkout.checkout_group_id),
      checkout_reference: checkout.checkout_reference,
      checkout_quote_id: parseUuidV7(checkout.checkout_quote_id),
      created_at: checkout.created_at,
      lifecycle_state: derivedState,
      payment_lifecycle_state: checkout.lifecycle_state,
      derived_lifecycle_state: derivedState,
      payment_transaction_id: parseUuidV7(checkout.payment_transaction_id),
      total_minor: Number(checkout.total_minor),
      version: checkout.version,
      orders: orders.rows.map((order) => ({
        vendor_order_id: parseUuidV7(order.vendor_order_id),
        checkout_group_id: parseUuidV7(order.checkout_group_id),
        vendor_location_id: parseUuidV7(order.vendor_location_id),
        location_name: order.location_name,
        order_reference: order.order_reference,
        lifecycle_state: order.lifecycle_state,
        fulfilment_method: order.fulfilment_method,
        total_minor: Number(order.total_minor),
        accept_by: order.accept_by,
        version: order.version,
      })),
    };
  }
  async #createAggregate(
    client: PoolClient,
    input: {
      readonly aggregate_id: string;
      readonly aggregate_type: string;
      readonly context: RequestContext;
      readonly event_type: string;
      readonly now: Date;
      readonly payload?: Readonly<Record<string, unknown>>;
      readonly state: string;
    },
  ) {
    const contextIds = ids(input.context);
    const actor = input.context.actor;
    const actorId = actor?.actor_id ?? createUuidV7();
    const actorKind = actor?.actor_kind ?? 'system';
    await client.query(
      `INSERT INTO marketplace.aggregate_heads
         (aggregate_type,aggregate_id,version,state,created_at,updated_at) VALUES ($1,$2,1,$3,$4,$4)`,
      [input.aggregate_type, input.aggregate_id, input.state, input.now],
    );
    await client.query(
      `INSERT INTO marketplace.aggregate_transitions
         (transition_id,aggregate_type,aggregate_id,previous_version,resulting_version,from_state,to_state,
          actor_id,actor_kind,reason_code,evidence,request_id,correlation_id,causation_id,occurred_at)
       VALUES ($1,$2,$3,0,1,NULL,$4,$5,$6,'CHECKOUT_CREATED',$7,$8,$9,$10,$11)`,
      [
        createUuidV7(),
        input.aggregate_type,
        input.aggregate_id,
        input.state,
        actorId,
        actorKind,
        JSON.stringify({ source: 'grouped_checkout' }),
        contextIds.request,
        contextIds.correlation,
        input.context.causation_id,
        input.now,
      ],
    );
    await client.query(
      `INSERT INTO marketplace.outbox_events
         (event_id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,request_id,
          correlation_id,causation_id,max_attempts,available_at,created_at,updated_at)
       VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,8,$9,$9,$9)`,
      [
        createUuidV7(),
        input.aggregate_type,
        input.aggregate_id,
        input.event_type,
        JSON.stringify({
          aggregate_id: input.aggregate_id,
          state: input.state,
          ...input.payload,
        }),
        contextIds.request,
        contextIds.correlation,
        input.context.causation_id,
        input.now,
      ],
    );
  }

  async #transitionAggregate(
    client: PoolClient,
    input: {
      readonly aggregate_id: string;
      readonly aggregate_type: string;
      readonly context: RequestContext;
      readonly event_type: string;
      readonly evidence?: Readonly<Record<string, unknown>>;
      readonly from_state: string;
      readonly now: Date;
      readonly reason_code?: string;
      readonly state: string;
    },
  ) {
    const contextIds = ids(input.context);
    const actor = input.context.actor;
    // The head's real version, under lock. This used to write 1 -> 2
    // unconditionally, which was true only while a group had exactly one
    // transition in its life; a group now has two or three.
    const head = await client.query<{ version: number; state: string }>(
      `SELECT version, state FROM marketplace.aggregate_heads
        WHERE aggregate_type=$1 AND aggregate_id=$2 FOR UPDATE`,
      [input.aggregate_type, input.aggregate_id],
    );
    const current = head.rows[0];
    if (!current || current.state !== input.from_state)
      throw new CheckoutConflictError(
        `Checkout group is ${current?.state ?? 'missing'}, not ${input.from_state}`,
      );
    const resultingVersion = current.version + 1;
    await client.query(
      `UPDATE marketplace.aggregate_heads SET version=$3,state=$4,updated_at=$5
        WHERE aggregate_type=$1 AND aggregate_id=$2 AND version=$6`,
      [
        input.aggregate_type,
        input.aggregate_id,
        resultingVersion,
        input.state,
        input.now,
        current.version,
      ],
    );
    await client.query(
      `INSERT INTO marketplace.aggregate_transitions
         (transition_id,aggregate_type,aggregate_id,previous_version,resulting_version,from_state,to_state,
          actor_id,actor_kind,reason_code,evidence,request_id,correlation_id,causation_id,occurred_at)
       VALUES ($1,$2,$3,$14,$15,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        createUuidV7(),
        input.aggregate_type,
        input.aggregate_id,
        input.from_state,
        input.state,
        actor?.actor_id ?? createUuidV7(),
        actor?.actor_kind ?? 'system',
        input.reason_code ?? 'WEBHOOK_RESOLVED',
        JSON.stringify(input.evidence ?? { source: 'verified_webhook' }),
        contextIds.request,
        contextIds.correlation,
        input.context.causation_id,
        input.now,
        current.version,
        resultingVersion,
      ],
    );
    await client.query(
      `INSERT INTO marketplace.outbox_events
         (event_id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,request_id,
          correlation_id,causation_id,max_attempts,available_at,created_at,updated_at)
       VALUES ($1,$2,$3,$10,$4,$5,$6,$7,$8,8,$9,$9,$9)`,
      [
        createUuidV7(),
        input.aggregate_type,
        input.aggregate_id,
        input.event_type,
        JSON.stringify({ aggregate_id: input.aggregate_id, state: input.state }),
        contextIds.request,
        contextIds.correlation,
        input.context.causation_id,
        input.now,
        resultingVersion,
      ],
    );
  }
  async #inventoryEvent(
    client: PoolClient,
    input: {
      readonly context: RequestContext;
      readonly event_type: 'SOFT_HELD' | 'PROVISIONAL';
      readonly exact_available_quantity: number | string | null;
      readonly inventory_item_id: string;
      readonly item_version: number;
      readonly now: Date;
      readonly quantity: number;
      readonly reservation_id: string;
      readonly reservation_version: number;
      readonly resulting_state: 'SOFT_HELD' | 'PROVISIONAL';
    },
  ) {
    const contextIds = ids(input.context);
    const actor = input.context.actor;
    await client.query(
      `INSERT INTO marketplace.inventory_events
         (inventory_event_id,inventory_item_id,item_version,reservation_id,reservation_version,event_type,
          previous_state,resulting_state,actor_id,actor_kind,reason_code,quantity,exact_available_quantity,
          counted_stock_applied,request_id,correlation_id,causation_id,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'CUSTOMER_CHECKOUT',$11,$12,true,$13,$14,$15,$16)`,
      [
        createUuidV7(),
        input.inventory_item_id,
        input.item_version,
        input.reservation_id,
        input.reservation_version,
        input.event_type,
        input.event_type === 'PROVISIONAL' ? 'SOFT_HELD' : null,
        input.resulting_state,
        actor?.actor_id ?? createUuidV7(),
        actor?.actor_kind ?? 'system',
        input.quantity,
        input.exact_available_quantity,
        contextIds.request,
        contextIds.correlation,
        input.context.causation_id,
        input.now,
      ],
    );
  }
  async #paymentEvent(
    client: PoolClient,
    input: {
      readonly context: RequestContext;
      readonly event_type: string;
      readonly now: Date;
      readonly payment_id: string;
      readonly payment_version: number;
      readonly previous_state?: string | null;
      readonly provider_result: string;
      readonly reason_code?: string;
      readonly resulting_state: string;
    },
  ) {
    const contextIds = ids(input.context);
    const actor = input.context.actor;
    await client.query(
      `INSERT INTO marketplace.payment_events
         (payment_event_id,payment_transaction_id,payment_version,event_type,previous_state,resulting_state,
          provider_result,command_reference,actor_id,actor_kind,reason_code,request_id,correlation_id,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        createUuidV7(),
        input.payment_id,
        input.payment_version,
        input.event_type,
        input.previous_state === undefined
          ? input.payment_version === 1
            ? null
            : 'UNKNOWN_REQUIRES_RECONCILIATION'
          : input.previous_state,
        input.resulting_state,
        input.provider_result,
        reference('CMD', createUuidV7()),
        actor?.actor_id ?? createUuidV7(),
        actor?.actor_kind ?? 'system',
        input.reason_code ?? 'CUSTOMER_CHECKOUT',
        contextIds.request,
        contextIds.correlation,
        input.now,
      ],
    );
  }
  /**
   * Whether placement would refuse this quote: a product, variant or price
   * changed or withdrawn, the store closed or unpublished, or a trust
   * restriction in force since on the customer, the store, or a category.
   */
  async #quoteStale(
    client: Pick<PoolClient, 'query'>,
    quoteId: UuidV7,
    userId: UuidV7,
    now: Date,
  ): Promise<boolean> {
    const changed = await client.query(
      `SELECT 1 FROM marketplace.checkout_quote_lines ql
          JOIN marketplace.checkout_quote_groups qg USING (checkout_quote_group_id)
          JOIN marketplace.catalogue_product_variants v ON v.catalogue_variant_id=ql.catalogue_variant_id
          JOIN marketplace.catalogue_products p ON p.catalogue_product_id=v.catalogue_product_id
          JOIN marketplace.catalogue_prices cp ON cp.catalogue_variant_id=v.catalogue_variant_id AND cp.effective_until IS NULL
          JOIN marketplace.vendor_locations vl ON vl.vendor_location_id=qg.vendor_location_id
         WHERE qg.checkout_quote_id=$1 AND
          (p.version<>ql.product_version OR v.version<>ql.variant_version OR cp.price_minor<>ql.unit_price_minor
           OR p.lifecycle_state<>'ACTIVE' OR v.lifecycle_state<>'ACTIVE' OR vl.lifecycle_state<>'ACTIVE'
           -- A store paused since the quote is as gone as one closed: the quote
           -- checked publication, and placement used to check only the location.
           OR NOT EXISTS (SELECT 1 FROM marketplace.vendor_publication_cases pub
                           WHERE pub.vendor_location_id=vl.vendor_location_id AND pub.lifecycle_state='PUBLISHED')
           -- A restriction that took force after the quote: the quote is for
           -- what was allowed then; quoting again says why (11.4).
           OR marketplace.trust_restricts('CUSTOMER',$2::text,vl.vendor_location_id,NULL,$3)
           OR marketplace.trust_restricts('VENDOR_LOCATION',vl.vendor_location_id::text,vl.vendor_location_id,NULL,$3)
           OR marketplace.trust_restricts('VENDOR_LOCATION',vl.vendor_location_id::text,vl.vendor_location_id,p.category,$3)
           OR marketplace.trust_restricts('CATEGORY',p.category,vl.vendor_location_id,NULL,$3)) LIMIT 1`,
      [quoteId, userId, now],
    );
    return changed.rows.length > 0;
  }

  /**
   * Every active group of the cart with every active line, whatever state the
   * store, catalogue or shelf is in. Inner joins used to drop a closed or
   * unpublished store, an out-of-zone address, and any line without a
   * current price or stock record, so a group could vanish from the quote or
   * be quoted short without a word. Each condition is now a flag the
   * classification turns into a blocked reason.
   */
  async #loadCartGroups(
    client: Pick<PoolClient, 'query'>,
    userId: UuidV7,
    cartId: UuidV7,
    now: Date,
  ) {
    return client.query<GroupRow>(
      `SELECT g.cart_vendor_group_id,g.vendor_location_id,g.fulfilment_method,g.tip_minor::text,
              l.minimum_order_minor::text,
              ST_Distance(l.coordinates,a.coordinates)::bigint::text straight_line_metres,
              ST_Y(l.coordinates::geometry)::float8 store_latitude, ST_X(l.coordinates::geometry)::float8 store_longitude,
              ST_Y(a.coordinates::geometry)::float8 address_latitude, ST_X(a.coordinates::geometry)::float8 address_longitude,
              l.preparation_seconds,
              (l.lifecycle_state='ACTIVE' AND vendor.lifecycle_state='ACTIVE'
               AND EXISTS (SELECT 1 FROM marketplace.vendor_publication_cases pub
                            WHERE pub.vendor_location_id=l.vendor_location_id AND pub.lifecycle_state='PUBLISHED')
               AND EXISTS (SELECT 1 FROM marketplace.vendor_service_zones z
                            WHERE z.vendor_location_id=l.vendor_location_id AND z.lifecycle_state='ACTIVE'
                              AND ST_Covers(z.boundary,a.coordinates))
               -- A shop restricted for new orders is as unavailable as a closed one (11.4).
               AND NOT marketplace.trust_restricts('VENDOR_LOCATION',l.vendor_location_id::text,
                                                   l.vendor_location_id,NULL,$3)) store_available,
              marketplace.trust_restricts('CUSTOMER',$2::uuid::text,l.vendor_location_id,NULL,$3) customer_restricted,
              EXISTS (SELECT 1 FROM marketplace.vendor_location_fulfilment_modes m
                       WHERE m.vendor_location_id=g.vendor_location_id
                         AND m.fulfilment_mode=g.fulfilment_method
                         AND m.approval_state='APPROVED') method_offered,
              json_agg(json_build_object('cart_line_id',cl.cart_line_id,'catalogue_variant_id',cl.catalogue_variant_id,
                'substitution_preference',cl.substitution_preference,
                'supplied',(v.catalogue_variant_id IS NOT NULL AND p.catalogue_product_id IS NOT NULL
                            AND price.price_minor IS NOT NULL AND i.inventory_item_id IS NOT NULL
                            -- Nor a category restricted here, or for this shop.
                            AND NOT marketplace.trust_restricts('CATEGORY',p.category,g.vendor_location_id,NULL,$3)
                            AND NOT marketplace.trust_restricts('VENDOR_LOCATION',g.vendor_location_id::text,
                                                                g.vendor_location_id,p.category,$3)),
                'inventory_item_id',i.inventory_item_id,'product_title',p.title,'variant_title',v.variant_title,
                'quantity',cl.quantity,'unit_price_minor',price.price_minor,'product_version',p.version,
                'variant_version',v.version,'exact_available_quantity',i.exact_available_quantity,
                'quantity_basis',i.quantity_basis,'inventory_version',i.version) ORDER BY cl.created_at, cl.cart_line_id) lines
         FROM marketplace.cart_vendor_groups g
         JOIN marketplace.carts c ON c.cart_id=g.cart_id
         JOIN marketplace.customer_addresses a ON a.customer_address_id=c.customer_address_id
         JOIN marketplace.vendor_locations l ON l.vendor_location_id=g.vendor_location_id
         JOIN marketplace.vendors vendor ON vendor.vendor_id=l.vendor_id
         JOIN marketplace.cart_lines cl ON cl.cart_vendor_group_id=g.cart_vendor_group_id AND cl.lifecycle_state='ACTIVE'
         LEFT JOIN marketplace.catalogue_product_variants v ON v.catalogue_variant_id=cl.catalogue_variant_id AND v.lifecycle_state='ACTIVE'
         LEFT JOIN marketplace.catalogue_products p ON p.catalogue_product_id=v.catalogue_product_id AND p.lifecycle_state='ACTIVE'
         LEFT JOIN marketplace.catalogue_prices price ON price.catalogue_variant_id=v.catalogue_variant_id AND price.effective_until IS NULL
         LEFT JOIN marketplace.inventory_items i ON i.vendor_location_id=g.vendor_location_id AND i.product_reference=p.product_reference
        WHERE c.cart_id=$1 AND c.user_id=$2 AND g.lifecycle_state='ACTIVE'
        GROUP BY g.cart_vendor_group_id,g.vendor_location_id,g.fulfilment_method,g.tip_minor,
                 l.vendor_location_id,l.minimum_order_minor,l.coordinates,a.coordinates,l.preparation_seconds,
                 l.lifecycle_state,vendor.lifecycle_state
        ORDER BY g.vendor_location_id`,
      [cartId, userId, now],
    );
  }

  /**
   * Gives back what a quote still holds. Restoring the units, recomputing the
   * shelf state and recording the event are the inventory module's job; this
   * used to do the first alone, so a declined payment that had taken the last
   * units left the item saying OUT_OF_STOCK with stock on it.
   */
  async #releaseQuote(
    client: PoolClient,
    context: RequestContext,
    id: UuidV7,
    now: Date,
    reasonCode: string,
  ) {
    const rows = await client.query<{ reservation_id: string }>(
      `SELECT l.inventory_reservation_id AS reservation_id
         FROM marketplace.checkout_quote_lines l
         JOIN marketplace.checkout_quote_groups g ON g.checkout_quote_group_id=l.checkout_quote_group_id
        WHERE g.checkout_quote_id=$1`,
      [id],
    );
    await releaseReservationsLocked(client, {
      context,
      now,
      reason_code: reasonCode,
      reservation_ids: rows.rows.map((row) => parseUuidV7(row.reservation_id)),
      states: ['SOFT_HELD'],
    });
  }
}
