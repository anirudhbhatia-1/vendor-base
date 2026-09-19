import { createDatabasePool } from './database-pool.js';
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
import {
  LocalFakeMoneyProvider,
  type FakeProviderScenario,
  type MoneyProviderAdapter,
} from './money-policy.js';
import { transaction as tx } from './transaction.js';
import { DEFAULT_ACCEPT_DEADLINE_SECONDS } from './vendor-fulfilment.js';

/**
 * Prepaid methods the platform accepts.
 *
 * Cash on delivery is a gated capability (GAT-01): it is absent from this union
 * and from the database constraint, not merely hidden in a UI.
 */
export type PaymentMethod = 'UPI' | 'CARD' | 'WALLET';

export class CheckoutInputError extends Error {}
export class CheckoutNotFoundError extends Error {}
export class CheckoutConflictError extends Error {}
export class CheckoutPaymentDeclinedError extends Error {}

type QuoteLineRow = {
  cart_line_id: string;
  catalogue_variant_id: string;
  inventory_item_id: string;
  product_title: string;
  variant_title: string;
  quantity: number;
  unit_price_minor: string;
  product_version: number;
  variant_version: number;
  exact_available_quantity: string | null;
  quantity_basis: 'COUNTED' | 'VENDOR_CONFIRMS';
  inventory_version: number;
};
type GroupRow = {
  cart_vendor_group_id: string;
  vendor_location_id: string;
  fulfilment_method: 'CUSTOMER_PICKUP' | 'PLATFORM_DELIVERY' | 'VENDOR_DELIVERY';
  /** Whether the store still offers `fulfilment_method`; false blocks the group. */
  method_offered: boolean;
  tip_minor: string;
  minimum_order_minor: string;
  route_metres: string;
  lines: QuoteLineRow[];
};
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
  readonly policy_version_reference: string;
  readonly total_minor: string | number;
};
type WebhookPaymentRow = CheckoutQuoteRow & {
  readonly checkout_group_id: UuidV7;
  readonly checkout_state: string;
  readonly payment_transaction_id: UuidV7;
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
};
type BlockedGroupProjection = {
  readonly cart_vendor_group_id: string;
  readonly reason_code: string;
  readonly vendor_location_id: string;
};
type CheckoutGroupProjection = Record<string, unknown> & {
  readonly checkout_group_id: string;
  readonly checkout_quote_id: string;
  readonly lifecycle_state: string;
  readonly payment_transaction_id: string;
  readonly total_minor: string | number;
  readonly version: number;
};
type VendorOrderProjection = Record<string, unknown> & {
  readonly accept_by: Date | null;
  readonly checkout_group_id: string;
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
  constructor(input: {
    readonly connection_string: string;
    readonly provider?: MoneyProviderAdapter;
    readonly webhook_key?: string;
  }) {
    this.#pool = createDatabasePool({
      connectionString: input.connection_string,
      application_name: 'neighbourhood-store-grouped-checkout',
      max: 12,
    });
    this.#provider =
      input.provider ??
      new LocalFakeMoneyProvider({
        ...(input.webhook_key === undefined ? {} : { webhook_key: input.webhook_key }),
      });
  }
  async close() {
    await this.#pool.end();
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
      const activeQuote = await client.query<{ checkout_quote_id: string }>(
        `SELECT checkout_quote_id FROM marketplace.checkout_quotes
          WHERE cart_id=$1 AND customer_user_id=$2 AND lifecycle_state='ACTIVE' AND expires_at>$3
          ORDER BY created_at DESC LIMIT 1`,
        [input.cart_id, userId, now],
      );
      if (activeQuote.rows[0])
        return this.#projectQuote(client, activeQuote.rows[0].checkout_quote_id);
      // This cart's earlier quotes that have lapsed still hold their units
      // until the sweep reaches them, and the stock read below would count
      // those units as gone -- so a customer re-quoting the last units on the
      // shelf was blocked by their own dead hold. Give them back first.
      const lapsed = await client.query<{ checkout_quote_id: UuidV7 }>(
        `SELECT checkout_quote_id FROM marketplace.checkout_quotes
          WHERE cart_id=$1 AND customer_user_id=$2 AND lifecycle_state='ACTIVE' AND expires_at<=$3
          FOR UPDATE`,
        [input.cart_id, userId, now],
      );
      for (const quote of lapsed.rows) {
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
      const groups = await client.query<GroupRow>(
        `SELECT g.cart_vendor_group_id,g.vendor_location_id,g.fulfilment_method,g.tip_minor::text,l.minimum_order_minor::text,
          ST_Distance(l.coordinates,a.coordinates)::bigint::text route_metres,
          EXISTS (SELECT 1 FROM marketplace.vendor_location_fulfilment_modes m
                   WHERE m.vendor_location_id=g.vendor_location_id
                     AND m.fulfilment_mode=g.fulfilment_method
                     AND m.approval_state='APPROVED') method_offered,
          json_agg(json_build_object('cart_line_id',cl.cart_line_id,'catalogue_variant_id',v.catalogue_variant_id,
            'inventory_item_id',i.inventory_item_id,'product_title',p.title,'variant_title',v.variant_title,
            'quantity',cl.quantity,'unit_price_minor',price.price_minor,'product_version',p.version,
            'variant_version',v.version,'exact_available_quantity',i.exact_available_quantity,
            'quantity_basis',i.quantity_basis,'inventory_version',i.version)) lines
        FROM marketplace.cart_vendor_groups g JOIN marketplace.carts c ON c.cart_id=g.cart_id
        JOIN marketplace.customer_addresses a ON a.customer_address_id=c.customer_address_id
        JOIN marketplace.vendor_locations l ON l.vendor_location_id=g.vendor_location_id
        JOIN marketplace.vendors vendor ON vendor.vendor_id=l.vendor_id
        JOIN marketplace.cart_lines cl ON cl.cart_vendor_group_id=g.cart_vendor_group_id AND cl.lifecycle_state='ACTIVE'
        JOIN marketplace.catalogue_product_variants v ON v.catalogue_variant_id=cl.catalogue_variant_id AND v.lifecycle_state='ACTIVE'
        JOIN marketplace.catalogue_products p ON p.catalogue_product_id=v.catalogue_product_id AND p.lifecycle_state='ACTIVE'
        JOIN marketplace.catalogue_prices price ON price.catalogue_variant_id=v.catalogue_variant_id AND price.effective_until IS NULL
        JOIN marketplace.inventory_items i ON i.vendor_location_id=g.vendor_location_id AND i.product_reference=p.product_reference
        WHERE c.cart_id=$1 AND c.user_id=$2 AND g.lifecycle_state='ACTIVE' AND l.lifecycle_state='ACTIVE' AND vendor.lifecycle_state='ACTIVE'
          AND EXISTS (SELECT 1 FROM marketplace.vendor_service_zones z WHERE z.vendor_location_id=l.vendor_location_id AND z.lifecycle_state='ACTIVE' AND ST_Covers(z.boundary,a.coordinates))
        GROUP BY g.cart_vendor_group_id,g.fulfilment_method,l.minimum_order_minor,l.coordinates,a.coordinates ORDER BY g.vendor_location_id`,
        [input.cart_id, userId],
      );
      if (!groups.rows.length) throw new CheckoutConflictError('No cart group can be quoted');
      const classified = groups.rows.map((group) => {
        const subtotal = group.lines.reduce(
          (sum, line) => sum + Number(line.unit_price_minor) * line.quantity,
          0,
        );
        // CUS-33: a group asking for a method the store does not offer is blocked
        // with a stable reason, ahead of minimum and stock, because it is the one
        // the customer can repair without changing what they are buying.
        const reason = !group.method_offered
          ? 'FULFILMENT_METHOD_UNAVAILABLE'
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
      const valid = classified.filter((entry) => entry.reason === null).map((entry) => entry.group);
      if (!valid.length) throw new CheckoutConflictError('Every cart group is blocked');
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
          route_metres: Number(group.route_metres),
          tip_minor: Number(group.tip_minor),
        })),
        financialPolicy,
      );
      const digest = createHash('sha256')
        .update(
          JSON.stringify({
            userId,
            cart: input.cart_id,
            address: cart.rows[0].customer_address_id,
            groups: valid,
            pricing,
          }),
        )
        .digest('hex');
      const replay = await client.query(
        `SELECT * FROM marketplace.checkout_quotes WHERE quote_digest=$1 AND lifecycle_state='ACTIVE' AND expires_at>$2`,
        [digest, now],
      );
      if (replay.rows[0]) return this.#projectQuote(client, replay.rows[0].checkout_quote_id);
      const quoteId = createUuidV7({ now_ms: now.getTime() });
      const contextIds = ids(input.context);
      await client.query(
        `INSERT INTO marketplace.checkout_quotes (checkout_quote_id,customer_user_id,cart_id,customer_address_id,quote_digest,total_minor,policy_version_reference,expires_at,request_id,correlation_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
        [
          quoteId,
          userId,
          input.cart_id,
          cart.rows[0].customer_address_id,
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
        await client.query(
          `INSERT INTO marketplace.checkout_quote_groups (checkout_quote_group_id,checkout_quote_id,cart_vendor_group_id,vendor_location_id,item_minor,delivery_minor,tip_minor,total_minor,reservation_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
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
            `INSERT INTO marketplace.checkout_quote_lines (checkout_quote_line_id,checkout_quote_group_id,cart_line_id,catalogue_variant_id,inventory_reservation_id,product_title_snapshot,variant_title_snapshot,quantity,unit_price_minor,line_total_minor,product_version,variant_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
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
    const result = await tx(this.#pool, async (client) => {
      const existing = await client.query(
        `SELECT * FROM marketplace.checkout_groups
          WHERE customer_user_id=$2 AND (checkout_quote_id=$1 OR ($3::text IS NOT NULL AND idempotency_key=$3))`,
        [input.checkout_quote_id, userId, input.idempotency_key ?? null],
      );
      if (existing.rows[0])
        return this.#projectCheckout(client, existing.rows[0].checkout_group_id);
      const quote = await client.query<CheckoutQuoteRow>(
        `SELECT * FROM marketplace.checkout_quotes WHERE checkout_quote_id=$1 AND customer_user_id=$2 AND lifecycle_state='ACTIVE' FOR UPDATE`,
        [input.checkout_quote_id, userId],
      );
      const q = quote.rows[0];
      if (!q) throw new CheckoutNotFoundError();
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
        throw new CheckoutConflictError('Quote expired');
      }
      const changed = await client.query(
        `SELECT 1 FROM marketplace.checkout_quote_lines ql
          JOIN marketplace.checkout_quote_groups qg USING (checkout_quote_group_id)
          JOIN marketplace.catalogue_product_variants v ON v.catalogue_variant_id=ql.catalogue_variant_id
          JOIN marketplace.catalogue_products p ON p.catalogue_product_id=v.catalogue_product_id
          JOIN marketplace.catalogue_prices cp ON cp.catalogue_variant_id=v.catalogue_variant_id AND cp.effective_until IS NULL
          JOIN marketplace.vendor_locations vl ON vl.vendor_location_id=qg.vendor_location_id
         WHERE qg.checkout_quote_id=$1 AND
          (p.version<>ql.product_version OR v.version<>ql.variant_version OR cp.price_minor<>ql.unit_price_minor
           OR p.lifecycle_state<>'ACTIVE' OR v.lifecycle_state<>'ACTIVE' OR vl.lifecycle_state<>'ACTIVE') LIMIT 1`,
        [input.checkout_quote_id],
      );
      if (changed.rows[0]) throw new CheckoutConflictError('Quote contents changed');
      const checkoutId = createUuidV7();
      const paymentId = createUuidV7();
      const checkoutRef = reference('CHECKOUT', checkoutId);
      const operation = reference('PAY', paymentId);
      let outcome: 'SUCCEEDED' | 'DECLINED' | 'UNKNOWN';
      try {
        outcome = this.#provider.authorize({
          amount_minor: Number(q.total_minor),
          operation_reference: operation,
          scenario: input.provider_scenario ?? 'SUCCESS',
        });
      } catch {
        outcome = 'UNKNOWN';
      }
      const contextIds = ids(input.context);
      const paymentState =
        outcome === 'SUCCEEDED'
          ? 'AUTHORIZED'
          : outcome === 'DECLINED'
            ? 'FAILED'
            : 'UNKNOWN_REQUIRES_RECONCILIATION';
      await client.query(
        `INSERT INTO marketplace.payment_transactions (payment_transaction_id,source_checkout_reference,provider_operation_reference,payment_state,amount_minor,provider_scenario,payment_method,request_id,correlation_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
        [
          paymentId,
          checkoutRef,
          operation,
          paymentState,
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
        event_type: 'AUTHORIZATION_RESULT',
        now,
        payment_id: paymentId,
        payment_version: 1,
        provider_result: outcome,
        resulting_state: paymentState,
      });
      if (outcome === 'DECLINED') {
        await this.#releaseQuote(
          client,
          input.context,
          input.checkout_quote_id,
          now,
          'PAYMENT_DECLINED',
        );
        await client.query(
          `UPDATE marketplace.checkout_quotes SET lifecycle_state='INVALID',updated_at=$2 WHERE checkout_quote_id=$1`,
          [input.checkout_quote_id, now],
        );
        return { payment_declined: true as const };
      }
      await client.query(
        `INSERT INTO marketplace.checkout_groups (checkout_group_id,checkout_reference,checkout_quote_id,customer_user_id,payment_transaction_id,lifecycle_state,total_minor,idempotency_key,request_id,correlation_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
        [
          checkoutId,
          checkoutRef,
          input.checkout_quote_id,
          userId,
          paymentId,
          outcome === 'UNKNOWN' ? 'PAYMENT_UNKNOWN' : 'ACTIVE',
          q.total_minor,
          input.idempotency_key ?? null,
          contextIds.request,
          contextIds.correlation,
          now,
        ],
      );
      await this.#createAggregate(client, {
        aggregate_id: checkoutId,
        aggregate_type: 'checkout_group',
        context: input.context,
        event_type: outcome === 'UNKNOWN' ? 'checkout.payment_unknown' : 'checkout.placed',
        now,
        state: outcome === 'UNKNOWN' ? 'PAYMENT_UNKNOWN' : 'ACTIVE',
      });
      if (outcome === 'UNKNOWN') {
        await client.query(
          `INSERT INTO marketplace.checkout_events (checkout_event_id,checkout_group_id,checkout_quote_id,event_type,actor_id,request_id,correlation_id,occurred_at) VALUES ($1,$2,$3,'PAYMENT_UNKNOWN',$4,$5,$6,$7)`,
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
        return this.#projectCheckout(client, checkoutId);
      }
      await this.#finalize(client, {
        checkout_id: checkoutId,
        context: input.context,
        now,
        payment_id: paymentId,
        quote: q,
      });
      await client.query(
        `INSERT INTO marketplace.checkout_events (checkout_event_id,checkout_group_id,checkout_quote_id,event_type,actor_id,request_id,correlation_id,occurred_at) VALUES ($1,$2,$3,'CHECKOUT_PLACED',$4,$5,$6,$7)`,
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
      return this.#projectCheckout(client, checkoutId);
    });
    if ('payment_declined' in result) throw new CheckoutPaymentDeclinedError();
    return result;
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
      const duplicate = await client.query(
        `SELECT provider_receipt_id FROM marketplace.provider_webhook_receipts WHERE provider_event_id=$1`,
        [input.provider_event_id],
      );
      if (duplicate.rows[0]) return { replayed: true };
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
      await client.query(
        `INSERT INTO marketplace.provider_webhook_receipts
           (provider_receipt_id,provider_event_id,provider_operation_reference,payload_digest,received_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          createUuidV7(),
          input.provider_event_id,
          input.provider_operation_reference,
          createHash('sha256').update(body).digest('hex'),
          now,
        ],
      );
      if (row.checkout_state !== 'PAYMENT_UNKNOWN')
        return {
          replayed: false,
          checkout: await this.#projectCheckout(client, row.checkout_group_id),
        };
      if (input.outcome === 'FAILED') {
        await this.#releaseQuote(
          client,
          input.context,
          row.checkout_quote_id,
          now,
          'PAYMENT_FAILED',
        );
        await client.query(
          `UPDATE marketplace.payment_transactions SET payment_state='FAILED',version=version+1,updated_at=$2 WHERE payment_transaction_id=$1`,
          [row.payment_transaction_id, now],
        );
        await this.#paymentEvent(client, {
          context: input.context,
          event_type: 'WEBHOOK_RESULT',
          now,
          payment_id: row.payment_transaction_id,
          payment_version: Number(row.version) + 1,
          provider_result: 'FAILED',
          resulting_state: 'FAILED',
        });
        await client.query(
          `UPDATE marketplace.checkout_groups SET lifecycle_state='CANCELLED',version=version+1,updated_at=$2 WHERE checkout_group_id=$1`,
          [row.checkout_group_id, now],
        );
        await this.#transitionAggregate(client, {
          aggregate_id: row.checkout_group_id,
          aggregate_type: 'checkout_group',
          context: input.context,
          event_type: 'checkout.payment_failed',
          from_state: 'PAYMENT_UNKNOWN',
          now,
          state: 'CANCELLED',
        });
      } else {
        await client.query(
          `UPDATE marketplace.payment_transactions SET payment_state='AUTHORIZED',version=version+1,updated_at=$2 WHERE payment_transaction_id=$1`,
          [row.payment_transaction_id, now],
        );
        await this.#paymentEvent(client, {
          context: input.context,
          event_type: 'WEBHOOK_RESULT',
          now,
          payment_id: row.payment_transaction_id,
          payment_version: Number(row.version) + 1,
          provider_result: 'SUCCEEDED',
          resulting_state: 'AUTHORIZED',
        });
        await this.#transitionAggregate(client, {
          aggregate_id: row.checkout_group_id,
          aggregate_type: 'checkout_group',
          context: input.context,
          event_type: 'checkout.webhook_authorized',
          from_state: 'PAYMENT_UNKNOWN',
          now,
          state: 'ACTIVE',
        });
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
        await client.query(
          `UPDATE marketplace.checkout_groups SET lifecycle_state='ACTIVE',version=version+1,updated_at=$2 WHERE checkout_group_id=$1`,
          [row.checkout_group_id, now],
        );
      }
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
      const quotes = await client.query<{ checkout_quote_id: UuidV7 }>(
        `SELECT checkout_quote_id FROM marketplace.checkout_quotes
          WHERE lifecycle_state='ACTIVE' AND expires_at<=$1
            AND ($2::uuid IS NULL OR customer_user_id=$2)
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
    const acceptBy = new Date(input.now.getTime() + DEFAULT_ACCEPT_DEADLINE_SECONDS * 1000);
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
          `UPDATE marketplace.inventory_reservations SET reservation_state='PROVISIONAL',version=version+1,updated_at=$2
            WHERE reservation_id=$1 AND reservation_state='SOFT_HELD'`,
          [line.inventory_reservation_id, input.now],
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
          `INSERT INTO marketplace.vendor_order_lines (vendor_order_line_id,vendor_order_id,catalogue_variant_id,inventory_reservation_id,product_title_snapshot,variant_title_snapshot,quantity,unit_price_minor,line_total_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
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
      `SELECT quote_group.*, cart_group.fulfilment_method, location.location_name
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
        promise:
          g.fulfilment_method === 'CUSTOMER_PICKUP'
            ? 'Ready in 30–45 minutes'
            : 'Arrives in 45–75 minutes',
        decision_rule: 'Quoted only when store, minimum, service area, price and stock validate',
      })),
      blocked_groups: blocked.rows,
    };
  }
  async #projectCheckout(client: Pick<PoolClient, 'query'>, id: string) {
    const c = await client.query<CheckoutGroupProjection>(
      `SELECT * FROM marketplace.checkout_groups WHERE checkout_group_id=$1`,
      [id],
    );
    const orders = await client.query<VendorOrderProjection>(
      `SELECT vendor_order.*, location.location_name
         FROM marketplace.vendor_orders vendor_order
         JOIN marketplace.vendor_locations location
           ON location.vendor_location_id = vendor_order.vendor_location_id
        WHERE vendor_order.checkout_group_id=$1
        ORDER BY location.location_name, vendor_order.vendor_location_id`,
      [id],
    );
    const checkout = c.rows[0];
    if (!checkout) throw new CheckoutNotFoundError();
    const states = orders.rows.map((order) => order.lifecycle_state);
    const derivedState =
      states.length > 0 && states.every((state: string) => state === 'CANCELLED')
        ? 'CANCELLED'
        : states.some((state: string) => state === 'CANCELLED')
          ? 'PARTIALLY_CANCELLED'
          : checkout.lifecycle_state;
    return {
      ...checkout,
      checkout_group_id: parseUuidV7(checkout.checkout_group_id),
      checkout_quote_id: parseUuidV7(checkout.checkout_quote_id),
      derived_lifecycle_state: derivedState,
      payment_transaction_id: parseUuidV7(checkout.payment_transaction_id),
      total_minor: Number(checkout.total_minor),
      orders: orders.rows.map((order) => ({
        ...order,
        checkout_group_id: parseUuidV7(order.checkout_group_id),
        total_minor: Number(order.total_minor),
        vendor_location_id: parseUuidV7(order.vendor_location_id),
        vendor_order_id: parseUuidV7(order.vendor_order_id),
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
      readonly from_state: string;
      readonly now: Date;
      readonly state: string;
    },
  ) {
    const contextIds = ids(input.context);
    const actor = input.context.actor;
    await client.query(
      `UPDATE marketplace.aggregate_heads SET version=2,state=$3,updated_at=$4
        WHERE aggregate_type=$1 AND aggregate_id=$2 AND version=1`,
      [input.aggregate_type, input.aggregate_id, input.state, input.now],
    );
    await client.query(
      `INSERT INTO marketplace.aggregate_transitions
         (transition_id,aggregate_type,aggregate_id,previous_version,resulting_version,from_state,to_state,
          actor_id,actor_kind,reason_code,evidence,request_id,correlation_id,causation_id,occurred_at)
       VALUES ($1,$2,$3,1,2,$4,$5,$6,$7,'WEBHOOK_RESOLVED',$8,$9,$10,$11,$12)`,
      [
        createUuidV7(),
        input.aggregate_type,
        input.aggregate_id,
        input.from_state,
        input.state,
        actor?.actor_id ?? createUuidV7(),
        actor?.actor_kind ?? 'system',
        JSON.stringify({ source: 'verified_webhook' }),
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
       VALUES ($1,$2,$3,2,$4,$5,$6,$7,$8,8,$9,$9,$9)`,
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
      readonly provider_result: string;
      readonly resulting_state: string;
    },
  ) {
    const contextIds = ids(input.context);
    const actor = input.context.actor;
    await client.query(
      `INSERT INTO marketplace.payment_events
         (payment_event_id,payment_transaction_id,payment_version,event_type,previous_state,resulting_state,
          provider_result,command_reference,actor_id,actor_kind,reason_code,request_id,correlation_id,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'CUSTOMER_CHECKOUT',$11,$12,$13)`,
      [
        createUuidV7(),
        input.payment_id,
        input.payment_version,
        input.event_type,
        input.payment_version === 1 ? null : 'UNKNOWN_REQUIRES_RECONCILIATION',
        input.resulting_state,
        input.provider_result,
        reference('CMD', createUuidV7()),
        actor?.actor_id ?? createUuidV7(),
        actor?.actor_kind ?? 'system',
        contextIds.request,
        contextIds.correlation,
        input.now,
      ],
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
