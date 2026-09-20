import { createHmac } from 'node:crypto';
import { createRequestId, createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { CatalogueProductService } from '../src/catalogue-products.js';
import { CustomerCartService } from '../src/customer-cart.js';
import { resolveFinancialPolicy } from '../src/financial-policy.js';
import {
  CheckoutConflictError,
  CheckoutInputError,
  CheckoutNotFoundError,
  CheckoutPaymentDeclinedError,
  GroupedCheckoutService,
  PAYMENT_UNKNOWN_DEADLINE_MS,
  PLACED_ORDER_HOLD_MS,
  PROCESSING_DEADLINE_MS,
} from '../src/grouped-checkout.js';
import { InventoryReservationService } from '../src/inventory-reservations.js';
import {
  LocalFakeMoneyProvider,
  calculateDistanceAmount,
  type FakeProviderOutcome,
  type FakeProviderScenario,
  type ProviderOperationInput,
} from '../src/money-policy.js';
import { ESTIMATE_ROAD_FACTOR, RoutingService, type RoutingProvider } from '../src/routing.js';
import {
  activateConfigurationVersion,
  approveConfigurationVersion,
  createConfigurationDraft,
  scheduleConfigurationVersion,
  validateConfigurationVersion,
} from '../src/versioned-configuration.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';
import { check, customerContext, rejects, systemContext, vendorContext } from './verify-support.js';

async function rejectsNotFound(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    check(error instanceof CheckoutNotFoundError, 'Ownership failure did not conceal the resource');
    return;
  }
  throw new Error('Another customer could read the checkout');
}

export async function verifyGroupedCheckout(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 5 });
  const carts = new CustomerCartService({ connection_string: connectionString });
  const catalogue = new CatalogueProductService({ connection_string: connectionString });
  const inventory = new InventoryReservationService({ connection_string: connectionString });
  // The fixture signs its own provider webhook, so it has to hold the same key
  // the service verifies with. It previously signed with a 23-character literal
  // while the service used its default — a signature that could never verify,
  // because the provider rejects any key under 32 characters.
  const webhookKey = 'SYNTH-LOCAL-WEBHOOK-KEY-MATERIAL-0001';
  const checkout = new GroupedCheckoutService({
    connection_string: connectionString,
    webhook_key: webhookKey,
  });
  const now = new Date('2026-08-26T12:00:00.000Z');
  const customerId = createUuidV7();
  const otherCustomerId = createUuidV7();
  try {
    for (const userId of [customerId, otherCustomerId]) {
      await pool.query(
        "INSERT INTO marketplace.users (user_id,state,data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
        [userId],
      );
    }
    const stores = await Promise.all(
      ['A', 'B', 'C'].map((suffix, index) =>
        createDiscoverableStoreFixture(pool, {
          location_name: `SYNTH Checkout Store ${suffix}`,
          latitude: 26.91 + index * 0.001,
          longitude: 75.81,
        }),
      ),
    );
    const products = [];
    for (const [index, store] of stores.entries()) {
      const suffix = `${Date.now()}${index}`;
      const product = await catalogue.createProduct({
        context: vendorContext(store.ownerUserId),
        vendor_location_id: store.locationId,
        product_reference: `SYNTH-PROD-CO${suffix}`,
        title: `SYNTH Checkout Product ${index}`,
        category: 'FRUIT_VEGETABLE',
        unit_label: 'EACH',
        tax_basis: 'EXEMPT',
        variable_weight: false,
        sku: `SYNTH-SKU-CO${suffix}`,
        variant_title: `SYNTH Checkout Variant ${index}`,
        price_minor: 10_000,
        // `createProduct` provisions the inventory_items row itself, keyed by
        // (vendor_location_id, product_reference), so the stock has to be
        // supplied here. Calling createItem afterwards collided on that unique
        // key and failed the whole verification chain before it began.
        initial_stock_quantity: index === 2 ? 0 : 5,
        low_stock_threshold: 1,
        now,
      });
      products.push(product);
    }
    const addressId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.customer_addresses
        (customer_address_id,user_id,address_reference,label,pin_code,coordinates,request_id,correlation_id)
       VALUES ($1,$2,$4,'SYNTH Checkout Home','302020',
         ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,$3,$3)`,
      [
        addressId,
        customerId,
        createUuidV7(),
        `SYNTH-ADDRESS-CHECKOUT-${customerId.replaceAll('-', '').slice(-10).toUpperCase()}`,
      ],
    );
    const cart = await carts.currentCart({ context: customerContext(customerId), now });
    await carts.setCartAddress({
      context: customerContext(customerId),
      customer_address_id: addressId,
      now,
    });
    for (const [index, store] of stores.entries()) {
      const product = products[index];
      check(product !== undefined, 'Checkout fixture product missing');
      await carts.addLine({
        context: customerContext(customerId),
        vendor_location_id: store.locationId,
        catalogue_variant_id: product.catalogue_variant_id,
        quantity: 1,
        now,
      });
    }
    const quote = await checkout.createQuote({
      context: customerContext(customerId),
      cart_id: cart.cart_id,
      now,
    });
    check(quote.groups.length === 2, 'The two valid store groups were not quoted');
    // 7.1 at the connected layer: the amounts the quote stores are the pricing
    // module's, fed the store's real route distance and the active policy, and
    // the policy version that priced it is stamped on the quote. Every line is
    // one unit at ₹100; the address sits on store A and about 111 m from store
    // B, both inside the 2 km the base fee includes.
    const { version_reference: policyAtQuote } = await resolveFinancialPolicy(pool, { at: now });
    check(
      /^SYNTH-POLICY-FIN-V\d+-[0-9A-F]{8}$/.test(quote.policy_version_reference) &&
        quote.policy_version_reference === policyAtQuote,
      `The quote does not carry the policy version in force when it was priced (${quote.policy_version_reference})`,
    );
    for (const group of quote.groups) {
      const route = await pool.query<{ metres: string }>(
        `SELECT ST_Distance(l.coordinates, a.coordinates)::bigint::text AS metres
           FROM marketplace.vendor_locations l, marketplace.customer_addresses a
          WHERE l.vendor_location_id=$1 AND a.customer_address_id=$2`,
        [group.vendor_location_id, addressId],
      );
      const metres = Number(route.rows[0]?.metres);
      // No maps provider is configured here, so the road is the labelled
      // estimate: the straight line times the road factor (D-17). The fee is
      // priced on that road, and the promise is the shop's preparation time
      // plus the road's travel time.
      const road = Math.round(metres * ESTIMATE_ROAD_FACTOR);
      check(
        group.item_minor === 10_000 &&
          group.delivery_minor === calculateDistanceAmount(road) &&
          group.delivery_minor === 1_500 &&
          group.tip_minor === 0 &&
          group.total_minor === 11_500,
        `A quoted group's amounts are not the pricing module's for its route (${JSON.stringify({ item: group.item_minor, delivery: group.delivery_minor, tip: group.tip_minor, total: group.total_minor, metres })})`,
      );
      check(
        group.route_source === 'ESTIMATE' &&
          group.route_metres !== null &&
          Math.abs(group.route_metres - road) <= 2 &&
          group.route_seconds === Math.max(60, Math.round((group.route_metres ?? 0) / 5)) &&
          group.ready_after_seconds === 1_200 &&
          group.arrives_after_seconds === 1_200 + (group.route_seconds ?? 0) &&
          /^Arrives in about \d+–\d+ minutes$/.test(String(group.promise)),
        `A quoted group does not carry the road it was priced on and the promise made from it (${JSON.stringify({ route_metres: group.route_metres, route_seconds: group.route_seconds, route_source: group.route_source, ready: group.ready_after_seconds, arrives: group.arrives_after_seconds, promise: group.promise })})`,
      );
    }
    check(quote.total_minor === 23_000, 'The quote total is not the sum of its groups');
    // 7.2: the blocked store consumed nothing; each quoted line holds exactly
    // its quantity against its own store's item, expiring with the quote.
    const blockedStore = stores[2];
    check(blockedStore !== undefined, 'The out-of-stock fixture store is missing');
    const holds = await pool.query<{
      vendor_location_id: string;
      reservation_state: string;
      quantity: string;
      expires_at: Date;
    }>(
      `SELECT ir.vendor_location_id, ir.reservation_state, ir.quantity::text, ir.expires_at
         FROM marketplace.inventory_reservations ir
         JOIN marketplace.checkout_quote_lines ql ON ql.inventory_reservation_id=ir.reservation_id
         JOIN marketplace.checkout_quote_groups qg USING (checkout_quote_group_id)
        WHERE qg.checkout_quote_id=$1`,
      [quote.checkout_quote_id],
    );
    check(
      holds.rows.length === 2 &&
        holds.rows.every(
          (row) =>
            row.reservation_state === 'SOFT_HELD' &&
            row.quantity === '1' &&
            row.expires_at.getTime() === quote.expires_at.getTime() &&
            row.vendor_location_id !== blockedStore.locationId,
        ),
      `The quote's holds are not one soft hold per quoted line, expiring with the quote (${JSON.stringify(holds.rows)})`,
    );
    const blockedHolds = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM marketplace.inventory_reservations WHERE vendor_location_id=$1',
      [blockedStore.locationId],
    );
    check(blockedHolds.rows[0]?.count === '0', 'A blocked store group consumed stock');
    check(
      quote.blocked_groups.length === 1 &&
        quote.blocked_groups[0]?.reason_code === 'INVENTORY_UNAVAILABLE',
      'The unavailable sibling store was not reported independently',
    );
    const quoteReplay = await checkout.createQuote({
      context: customerContext(customerId),
      cart_id: cart.cart_id,
      now: new Date(now.getTime() + 1_000),
    });
    check(
      quoteReplay.checkout_quote_id === quote.checkout_quote_id,
      'Quote retry was not idempotent',
    );
    const placed = await checkout.place({
      context: customerContext(customerId),
      checkout_quote_id: quote.checkout_quote_id,
      provider_scenario: 'SUCCESS',
      idempotency_key: 'phase7-success-001',
      now: new Date(now.getTime() + 2_000),
    });
    check(placed.orders.length === 2, 'Checkout did not create exactly one order per valid store');
    const replay = await checkout.place({
      context: customerContext(customerId),
      checkout_quote_id: quote.checkout_quote_id,
      provider_scenario: 'SUCCESS',
      idempotency_key: 'phase7-success-001',
      now: new Date(now.getTime() + 3_000),
    });
    check(
      replay.checkout_group_id === placed.checkout_group_id,
      'Checkout retry duplicated the group',
    );
    const counts = await pool.query<{ orders: string; allocations: string }>(
      `SELECT
        (SELECT count(*) FROM marketplace.vendor_orders WHERE checkout_group_id=$1)::text orders,
        (SELECT count(*) FROM marketplace.payment_allocations pa JOIN marketplace.checkout_groups cg ON cg.payment_transaction_id=pa.payment_transaction_id WHERE cg.checkout_group_id=$1)::text allocations`,
      [placed.checkout_group_id],
    );
    check(
      counts.rows[0]?.orders === '2' && counts.rows[0]?.allocations === '2',
      'Replay duplicated orders or allocations',
    );
    const stamped = await pool.query<{ policy_version_reference: string; item_minor: string }>(
      `SELECT pa.policy_version_reference, pa.item_minor::text AS item_minor
         FROM marketplace.payment_allocations pa
         JOIN marketplace.checkout_groups cg ON cg.payment_transaction_id=pa.payment_transaction_id
        WHERE cg.checkout_group_id=$1`,
      [placed.checkout_group_id],
    );
    check(
      stamped.rows.length === 2 &&
        stamped.rows.every(
          (row) =>
            row.policy_version_reference === quote.policy_version_reference &&
            row.item_minor === '10000',
        ),
      'The allocations do not carry the policy version and amounts the quote was priced with',
    );
    await rejectsNotFound(() =>
      checkout.get({
        context: customerContext(otherCustomerId),
        checkout_group_id: placed.checkout_group_id,
      }),
    );

    // Provider timeout/malformed response remains unknown until a verified webhook resolves it.
    const unknownCustomer = createUuidV7();
    await pool.query(
      "INSERT INTO marketplace.users (user_id,state,data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
      [unknownCustomer],
    );
    const unknownAddress = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.customer_addresses
        (customer_address_id,user_id,address_reference,label,pin_code,coordinates,request_id,correlation_id)
       VALUES ($1,$2,'SYNTH-ADDRESS-UNKNOWN-' || $4,'SYNTH Unknown Home','302020',ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,$3,$3)`,
      [
        unknownAddress,
        unknownCustomer,
        createUuidV7(),
        unknownCustomer.replaceAll('-', '').slice(-10).toUpperCase(),
      ],
    );
    const unknownCart = await carts.currentCart({ context: customerContext(unknownCustomer), now });
    const store0 = stores[0];
    const product0 = products[0];
    check(store0 !== undefined && product0 !== undefined, 'Unknown-payment fixture missing');
    await carts.setCartAddress({
      context: customerContext(unknownCustomer),
      customer_address_id: unknownAddress,
      now,
    });
    await carts.addLine({
      context: customerContext(unknownCustomer),
      vendor_location_id: store0.locationId,
      catalogue_variant_id: product0.catalogue_variant_id,
      quantity: 1,
      now,
    });
    const unknownQuote = await checkout.createQuote({
      context: customerContext(unknownCustomer),
      cart_id: unknownCart.cart_id,
      now,
    });
    const unknown = await checkout.place({
      context: customerContext(unknownCustomer),
      checkout_quote_id: unknownQuote.checkout_quote_id,
      provider_scenario: 'MALFORMED',
      now: new Date(now.getTime() + 1_000),
    });
    check(
      unknown.lifecycle_state === 'PAYMENT_UNKNOWN' && unknown.orders.length === 0,
      'Malformed provider response was not held as unknown',
    );
    const payment = await pool.query<{ provider_operation_reference: string }>(
      `SELECT provider_operation_reference FROM marketplace.payment_transactions WHERE payment_transaction_id=$1`,
      [unknown.payment_transaction_id],
    );
    const paymentRow = payment.rows[0];
    check(paymentRow !== undefined, 'Unknown payment transaction missing');
    const payload = {
      provider_event_id: 'SYNTH-EVENT-PHASE7-SUCCESS',
      provider_operation_reference: paymentRow.provider_operation_reference,
      outcome: 'SUCCEEDED' as const,
      occurred_at: new Date(now.getTime() + 2_000).toISOString(),
    };
    const signature = createHmac('sha256', webhookKey)
      .update(JSON.stringify(payload))
      .digest('hex');
    const resolved = await checkout.receiveWebhook({
      context: customerContext(unknownCustomer),
      ...payload,
      signature,
      now: new Date(now.getTime() + 2_000),
    });
    check(
      'checkout' in resolved && resolved.checkout.orders.length === 1,
      'Verified webhook did not finalize the unknown payment',
    );
    const webhookReplay = await checkout.receiveWebhook({
      context: customerContext(unknownCustomer),
      ...payload,
      signature,
      now: new Date(now.getTime() + 2_000),
    });
    check(webhookReplay.replayed === true, 'Webhook replay was not suppressed');
    // 7.4: finance saw the unknown money from the moment of placement, and
    // the verified webhook closed what it opened.
    const unknownException = await pool.query<{ states: string[] }>(
      `SELECT array_agg(exception_state ORDER BY created_at) AS states
         FROM marketplace.finance_exceptions
        WHERE operation_reference=$1 AND exception_kind='PAYMENT_UNKNOWN'`,
      [paymentRow.provider_operation_reference],
    );
    check(
      JSON.stringify(unknownException.rows[0]?.states) === '["RESOLVED"]',
      `An unknown authorisation did not open one finance exception that the webhook resolved (${JSON.stringify(unknownException.rows[0])})`,
    );

    // The same event, redelivered with different content, is not a replay.
    await rejects(
      () =>
        checkout.receiveWebhook({
          context: customerContext(unknownCustomer),
          ...payload,
          outcome: 'FAILED',
          signature: createHmac('sha256', webhookKey)
            .update(JSON.stringify({ ...payload, outcome: 'FAILED' }))
            .digest('hex'),
          now: new Date(now.getTime() + 2_000),
        }),
      CheckoutInputError,
      'A reused event id carrying a different payload was accepted as a replay',
    );

    // 7.4: what happens to a placement the provider never answers. Every
    // walk below starts from its own unknown placement.
    const unknownPlacement = async (
      label: string,
      placedAt: Date,
      through: { service?: GroupedCheckoutService; scenario?: FakeProviderScenario } = {},
    ) => {
      const service = through.service ?? checkout;
      const scenario = through.scenario ?? 'MALFORMED';
      const userId = createUuidV7();
      await pool.query(
        "INSERT INTO marketplace.users (user_id,state,data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
        [userId],
      );
      const addressId = createUuidV7();
      await pool.query(
        `INSERT INTO marketplace.customer_addresses
          (customer_address_id,user_id,address_reference,label,pin_code,coordinates,request_id,correlation_id)
         VALUES ($1,$2,'SYNTH-ADDRESS-' || $4,'SYNTH ' || $4,'302020',ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,$3,$3)`,
        [
          addressId,
          userId,
          createUuidV7(),
          `${label}-${userId.replaceAll('-', '').slice(-8).toUpperCase()}`,
        ],
      );
      const context = customerContext(userId);
      // Each walk takes one unit and, by design, never gives it back, so
      // each has a shelf of its own rather than starving the next.
      const own = `${label}${userId.replaceAll('-', '').slice(-6).toUpperCase()}`;
      const product = await catalogue.createProduct({
        context: vendorContext(store0.ownerUserId),
        vendor_location_id: store0.locationId,
        product_reference: `SYNTH-PROD-${own}`,
        title: `SYNTH ${label} Product`,
        category: 'FRUIT_VEGETABLE',
        unit_label: 'EACH',
        tax_basis: 'EXEMPT',
        variable_weight: false,
        sku: `SYNTH-SKU-${own}`,
        variant_title: `SYNTH ${label} Variant`,
        price_minor: 10_000,
        initial_stock_quantity: 1,
        low_stock_threshold: 0,
        now: placedAt,
      });
      const cart = await carts.currentCart({ context, now: placedAt });
      await carts.setCartAddress({ context, customer_address_id: addressId, now: placedAt });
      await carts.addLine({
        context,
        vendor_location_id: store0.locationId,
        catalogue_variant_id: product.catalogue_variant_id,
        quantity: 1,
        now: placedAt,
      });
      const quote = await checkout.createQuote({ context, cart_id: cart.cart_id, now: placedAt });
      const placed = await service.place({
        context,
        checkout_quote_id: quote.checkout_quote_id,
        provider_scenario: scenario,
        idempotency_key: `phase7-${label}-${userId}`,
        now: placedAt,
      });
      if (scenario === 'MALFORMED')
        check(
          placed.lifecycle_state === 'PAYMENT_UNKNOWN',
          `${label}: placement was not held unknown`,
        );
      const operation = await pool.query<{ provider_operation_reference: string }>(
        `SELECT provider_operation_reference FROM marketplace.payment_transactions WHERE payment_transaction_id=$1`,
        [placed.payment_transaction_id],
      );
      const evidence = async () => {
        const found = await pool.query<{
          checkout_state: string;
          quote_state: string;
          payment_state: string;
          holds: string;
          orders: string;
          next_action: string | null;
          exception_state: string | null;
          conflicts: string;
          events: string[] | null;
        }>(
          `SELECT g.lifecycle_state AS checkout_state, q.lifecycle_state AS quote_state,
                  p.payment_state,
                  (SELECT count(*)::text FROM marketplace.checkout_quote_lines ql
                     JOIN marketplace.inventory_reservations r ON r.reservation_id=ql.inventory_reservation_id
                     JOIN marketplace.checkout_quote_groups qg ON qg.checkout_quote_group_id=ql.checkout_quote_group_id
                    WHERE qg.checkout_quote_id=q.checkout_quote_id AND r.reservation_state='SOFT_HELD') AS holds,
                  (SELECT count(*)::text FROM marketplace.vendor_orders o WHERE o.checkout_group_id=g.checkout_group_id) AS orders,
                  x.next_action_code AS next_action, x.exception_state,
                  (SELECT count(*)::text FROM marketplace.finance_exceptions c
                    WHERE c.operation_reference=p.provider_operation_reference AND c.exception_kind='STATUS_MISMATCH') AS conflicts,
                  (SELECT array_agg(e.event_type || ':' || e.resulting_state ORDER BY e.payment_version)
                     FROM marketplace.payment_events e WHERE e.payment_transaction_id=p.payment_transaction_id) AS events
             FROM marketplace.checkout_groups g
             JOIN marketplace.checkout_quotes q ON q.checkout_quote_id=g.checkout_quote_id
             JOIN marketplace.payment_transactions p ON p.payment_transaction_id=g.payment_transaction_id
             LEFT JOIN marketplace.finance_exceptions x
               ON x.operation_reference=p.provider_operation_reference AND x.exception_kind='PAYMENT_UNKNOWN'
            WHERE g.checkout_group_id=$1`,
          [placed.checkout_group_id],
        );
        const row = found.rows[0];
        check(row !== undefined, `${label}: placement vanished`);
        return row;
      };
      const webhook = (outcome: 'SUCCEEDED' | 'FAILED', at: Date, service = checkout) => {
        const body = {
          provider_event_id: `SYNTH-EVENT-${label}-${outcome}`,
          provider_operation_reference: operation.rows[0]?.provider_operation_reference ?? '',
          outcome,
          occurred_at: at.toISOString(),
        };
        return service.receiveWebhook({
          context,
          ...body,
          signature: createHmac('sha256', webhookKey).update(JSON.stringify(body)).digest('hex'),
          now: at,
        });
      };
      return { context, evidence, placed, quote, userId, webhook };
    };
    const sweeper = systemContext(createUuidV7());
    const sixMinutes = new Date(now.getTime() + 6 * 60_000);
    const beforeDeadline = new Date(now.getTime() + PAYMENT_UNKNOWN_DEADLINE_MS - 1_000);
    const afterDeadline = new Date(now.getTime() + PAYMENT_UNKNOWN_DEADLINE_MS + 1_000);

    // Placement: opened for finance at once, holds kept past the quote's own
    // life, and not abandoned before the deadline.
    const waiting = await unknownPlacement('WAIT', now);
    const opened = await waiting.evidence();
    check(
      opened.next_action === 'AWAIT_PROVIDER_WEBHOOK' && opened.exception_state === 'OPEN',
      `An unknown placement did not open a finance exception (${JSON.stringify(opened)})`,
    );
    await checkout.expireQuotes({ context: sweeper, now: sixMinutes });
    const early = await checkout.abandonUnknownPayments({ context: sweeper, now: beforeDeadline });
    const kept = await waiting.evidence();
    check(
      early === 0 &&
        kept.checkout_state === 'PAYMENT_UNKNOWN' &&
        kept.quote_state === 'ACTIVE' &&
        kept.holds === '1',
      `The holds of a placement awaiting the provider were not kept past the quote's life (${JSON.stringify(
        { early, kept },
      )})`,
    );

    // Abandonment: stock back, quote retired, group cancelled, the money
    // still unknown and the exception now asking for it to be found.
    const abandonedCount = await checkout.abandonUnknownPayments({
      context: sweeper,
      now: afterDeadline,
    });
    const abandoned = await waiting.evidence();
    const abandonedTrail = await pool.query<{ events: string; outbox: string }>(
      `SELECT (SELECT count(*)::text FROM marketplace.checkout_events
                WHERE checkout_group_id=$1 AND event_type='PAYMENT_ABANDONED') AS events,
              (SELECT count(*)::text FROM marketplace.outbox_events
                WHERE aggregate_id=$1 AND event_type='checkout.payment_abandoned') AS outbox`,
      [waiting.placed.checkout_group_id],
    );
    check(
      abandonedCount === 1 &&
        abandoned.checkout_state === 'CANCELLED' &&
        abandoned.quote_state === 'EXPIRED' &&
        abandoned.holds === '0' &&
        abandoned.payment_state === 'UNKNOWN_REQUIRES_RECONCILIATION' &&
        abandoned.next_action === 'RECONCILE_ABANDONED_AUTHORIZATION' &&
        abandoned.exception_state === 'OPEN' &&
        abandonedTrail.rows[0]?.events === '1' &&
        abandonedTrail.rows[0].outbox === '1',
      `A placement past the deadline was not abandoned with its stock given back (${JSON.stringify({
        abandonedCount,
        abandoned,
        trail: abandonedTrail.rows[0],
      })})`,
    );

    // Late success after abandonment, provider void answered: the money is
    // released through the provider and the exception closed. No order.
    const releasing = new GroupedCheckoutService({
      connection_string: connectionString,
      provider: new (class extends LocalFakeMoneyProvider {
        override async void(): Promise<FakeProviderOutcome> {
          return 'SUCCEEDED';
        }
      })({ webhook_key: webhookKey }),
    });
    try {
      const lateVoided = await waiting.webhook('SUCCEEDED', afterDeadline, releasing);
      const voided = await waiting.evidence();
      check(
        'checkout' in lateVoided &&
          lateVoided.checkout.lifecycle_state === 'CANCELLED' &&
          voided.orders === '0' &&
          voided.payment_state === 'VOIDED' &&
          voided.exception_state === 'RESOLVED' &&
          JSON.stringify(voided.events) ===
            '["AUTHORIZATION_STARTED:AUTHORIZING","AUTHORIZATION_RESULT:UNKNOWN_REQUIRES_RECONCILIATION","WEBHOOK_RESULT:AUTHORIZED","PAYMENT_VOIDED:VOIDED"]',
        `A late success after abandonment was not voided through the provider (${JSON.stringify(voided)})`,
      );
    } finally {
      await releasing.close();
    }

    // Late success, provider void unanswered: the money is known to be held
    // and the exception says so; nothing is invented.
    const unreleased = await unknownPlacement('HELD', now);
    await checkout.abandonUnknownPayments({ context: sweeper, now: afterDeadline });
    await unreleased.webhook('SUCCEEDED', afterDeadline);
    const held = await unreleased.evidence();
    check(
      held.checkout_state === 'CANCELLED' &&
        held.payment_state === 'AUTHORIZED' &&
        held.next_action === 'VOID_LATE_AUTHORIZATION' &&
        held.exception_state === 'OPEN' &&
        held.orders === '0',
      `A late success whose void went unanswered was not left authorised with an exception (${JSON.stringify(held)})`,
    );

    // Late failure after abandonment closes the question.
    const failing = await unknownPlacement('FAIL', now);
    await checkout.abandonUnknownPayments({ context: sweeper, now: afterDeadline });
    await failing.webhook('FAILED', afterDeadline);
    const failed = await failing.evidence();
    check(
      failed.payment_state === 'FAILED' && failed.exception_state === 'RESOLVED',
      `A late failure after abandonment did not close the payment (${JSON.stringify(failed)})`,
    );

    // A provider answer that contradicts a settled payment is a conflict for
    // a person, not a change made on its own: the placed order stands.
    const settledPayment = await pool.query<{ provider_operation_reference: string }>(
      `SELECT provider_operation_reference FROM marketplace.payment_transactions WHERE payment_transaction_id=$1`,
      [placed.payment_transaction_id],
    );
    const contradiction = {
      provider_event_id: 'SYNTH-EVENT-PHASE7-CONTRADICTION',
      provider_operation_reference: settledPayment.rows[0]?.provider_operation_reference ?? '',
      outcome: 'FAILED' as const,
      occurred_at: new Date(now.getTime() + 3_000).toISOString(),
    };
    const contradicted = await checkout.receiveWebhook({
      context: customerContext(customerId),
      ...contradiction,
      signature: createHmac('sha256', webhookKey)
        .update(JSON.stringify(contradiction))
        .digest('hex'),
      now: new Date(now.getTime() + 3_000),
    });
    const conflict = await pool.query<{
      checkout_state: string;
      payment_state: string;
      conflicts: string;
    }>(
      `SELECT g.lifecycle_state AS checkout_state, p.payment_state,
              (SELECT count(*)::text FROM marketplace.finance_exceptions x
                WHERE x.operation_reference=p.provider_operation_reference
                  AND x.exception_kind='STATUS_MISMATCH' AND x.exception_state='OPEN') AS conflicts
         FROM marketplace.checkout_groups g
         JOIN marketplace.payment_transactions p USING (payment_transaction_id)
        WHERE g.checkout_group_id=$1`,
      [placed.checkout_group_id],
    );
    check(
      'checkout' in contradicted &&
        conflict.rows[0]?.checkout_state === 'ACTIVE' &&
        conflict.rows[0].payment_state === 'AUTHORIZED' &&
        conflict.rows[0].conflicts === '1',
      `A provider answer contradicting a settled payment did not open a conflict for review (${JSON.stringify(conflict.rows[0])})`,
    );

    // Two deliveries of one event at once: one is received, one is a replay,
    // neither is an error.
    const redelivered = await unknownPlacement('RACE', now);
    const raceBody = {
      provider_event_id: 'SYNTH-EVENT-PHASE7-RACE',
      provider_operation_reference:
        (
          await pool.query<{ provider_operation_reference: string }>(
            `SELECT provider_operation_reference FROM marketplace.payment_transactions WHERE payment_transaction_id=$1`,
            [redelivered.placed.payment_transaction_id],
          )
        ).rows[0]?.provider_operation_reference ?? '',
      outcome: 'SUCCEEDED' as const,
      occurred_at: new Date(now.getTime() + 2_000).toISOString(),
    };
    const raceSignature = createHmac('sha256', webhookKey)
      .update(JSON.stringify(raceBody))
      .digest('hex');
    // Forced to interleave: a third connection holds the payment row while
    // both deliveries are issued, so each has begun before either can take
    // the lock. Left to chance, the first delivery usually finishes before
    // the second starts, and a guard that reads before locking looks sound.
    const holder = await pool.connect();
    await holder.query('BEGIN');
    await holder.query(
      `SELECT 1 FROM marketplace.payment_transactions WHERE payment_transaction_id=$1 FOR UPDATE`,
      [redelivered.placed.payment_transaction_id],
    );
    const inFlight = Promise.all(
      [0, 1].map(() =>
        checkout.receiveWebhook({
          context: redelivered.context,
          ...raceBody,
          signature: raceSignature,
          now: new Date(now.getTime() + 2_000),
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    await holder.query('COMMIT');
    holder.release();
    const deliveries = await inFlight;
    const raced = await redelivered.evidence();
    check(
      deliveries.filter((delivery) => delivery.replayed).length === 1 &&
        raced.checkout_state === 'ACTIVE' &&
        raced.orders === '1',
      `Concurrent deliveries of one event were not received once and replayed once (${JSON.stringify(
        { deliveries: deliveries.map((delivery) => delivery.replayed), raced },
      )})`,
    );

    // 7.5: the submission is recorded, and committed, before the provider is
    // asked. The provider here looks at the database from another
    // connection while it is being asked: what it can see has been committed,
    // and no row it needs is locked.
    const seenByProvider: Record<string, unknown>[] = [];
    const witness = new (class extends LocalFakeMoneyProvider {
      override async authorize(input: ProviderOperationInput): Promise<FakeProviderOutcome> {
        const seen = await pool.query<Record<string, unknown>>(
          `SELECT g.lifecycle_state AS checkout_state, p.payment_state,
                  (SELECT count(*)::text FROM marketplace.outbox_events o
                    WHERE o.aggregate_id=g.checkout_group_id AND o.event_type='checkout.submitted') AS outbox,
                  (SELECT count(*)::text FROM marketplace.checkout_events e
                    WHERE e.checkout_group_id=g.checkout_group_id AND e.event_type='CHECKOUT_SUBMITTED') AS submitted,
                  (SELECT min(r.expires_at)::text FROM marketplace.checkout_quote_lines l
                     JOIN marketplace.checkout_quote_groups qg ON qg.checkout_quote_group_id=l.checkout_quote_group_id
                     JOIN marketplace.inventory_reservations r ON r.reservation_id=l.inventory_reservation_id
                    WHERE qg.checkout_quote_id=g.checkout_quote_id) AS hold_expires_at,
                  (SELECT count(*)::text FROM pg_locks k
                     JOIN pg_class c ON c.oid=k.relation
                    WHERE c.relname='checkout_groups' AND k.mode LIKE 'Row%' AND k.granted) AS row_locks
             FROM marketplace.checkout_groups g
             JOIN marketplace.payment_transactions p USING (payment_transaction_id)
            WHERE p.provider_operation_reference=$1`,
          [input.operation_reference],
        );
        seenByProvider.push(seen.rows[0] ?? {});
        return super.authorize(input);
      }
    })({ webhook_key: webhookKey });
    const witnessed = new GroupedCheckoutService({
      connection_string: connectionString,
      provider: witness,
    });
    try {
      const recorded = await unknownPlacement('RECORDED', now, {
        service: witnessed,
        scenario: 'SUCCESS',
      });
      const seen = seenByProvider[0];
      const placedHoldFloor = new Date(now.getTime() + PAYMENT_UNKNOWN_DEADLINE_MS - 1_000);
      check(
        seen?.checkout_state === 'PROCESSING' &&
          seen.payment_state === 'AUTHORIZING' &&
          seen.outbox === '1' &&
          seen.submitted === '1' &&
          new Date(String(seen.hold_expires_at)) >= placedHoldFloor &&
          seen.row_locks === '0' &&
          recorded.placed.lifecycle_state === 'ACTIVE' &&
          recorded.placed.orders.length === 1,
        `The submission was not committed before the provider was asked, or a row was held while asking (${JSON.stringify(seen)})`,
      );
      const recordedTrail = await pool.query<{ events: string[]; versions: string[] }>(
        `SELECT (SELECT array_agg(e.event_type || ':' || e.resulting_state ORDER BY e.payment_version)
                   FROM marketplace.payment_events e WHERE e.payment_transaction_id=$2) AS events,
                (SELECT array_agg(t.previous_version || '>' || t.resulting_version || ':' || t.to_state ORDER BY t.resulting_version)
                   FROM marketplace.aggregate_transitions t WHERE t.aggregate_id=$1) AS versions`,
        [recorded.placed.checkout_group_id, recorded.placed.payment_transaction_id],
      );
      check(
        JSON.stringify(recordedTrail.rows[0]?.events) ===
          '["AUTHORIZATION_STARTED:AUTHORIZING","AUTHORIZATION_RESULT:AUTHORIZED"]' &&
          JSON.stringify(recordedTrail.rows[0]?.versions) === '["0>1:PROCESSING","1>2:ACTIVE"]',
        `The submission and its answer were not recorded as two steps with real versions (${JSON.stringify(recordedTrail.rows[0])})`,
      );

      // The placed order's holds outlive the quote: the inventory sweep,
      // run after the quote's own life, leaves them PROVISIONAL and the
      // shelf as the order left it.
      await inventory.expireDue({ context: sweeper, now: sixMinutes });
      const placedHolds = await pool.query<{ states: string[]; expires: string[] }>(
        `SELECT array_agg(r.reservation_state) AS states,
                array_agg((r.expires_at > $2)::text) AS expires
           FROM marketplace.vendor_order_lines l
           JOIN marketplace.vendor_orders o ON o.vendor_order_id=l.vendor_order_id
           JOIN marketplace.inventory_reservations r ON r.reservation_id=l.inventory_reservation_id
          WHERE o.checkout_group_id=$1`,
        [
          recorded.placed.checkout_group_id,
          new Date(now.getTime() + PLACED_ORDER_HOLD_MS - 60_000),
        ],
      );
      check(
        JSON.stringify(placedHolds.rows[0]) === '{"states":["PROVISIONAL"],"expires":["true"]}',
        `A placed order's hold did not outlive the quote (${JSON.stringify(placedHolds.rows[0])})`,
      );

      // A submission still waiting on the provider survives the inventory
      // sweep too: its soft hold was carried to the submission's deadline.
      const awaiting = await unknownPlacement('AWAITING', now);
      await inventory.expireDue({ context: sweeper, now: sixMinutes });
      const awaitingEvidence = await awaiting.evidence();
      check(
        awaitingEvidence.checkout_state === 'PAYMENT_UNKNOWN' && awaitingEvidence.holds === '1',
        `The inventory sweep took the holds of a submission awaiting its provider (${JSON.stringify(awaitingEvidence)})`,
      );

      // Duplicate submission: the same result. The same key on another
      // quote is a different submission and is refused; a declined
      // submission retried is declined again, not "quote invalid".
      await rejects(
        () =>
          witnessed.place({
            context: recorded.context,
            checkout_quote_id: awaiting.quote.checkout_quote_id,
            idempotency_key: `phase7-RECORDED-${recorded.userId}`,
            now,
          }),
        CheckoutConflictError,
        'An idempotency key reused for a different quote returned the earlier checkout',
      );
      const replayed = await witnessed.place({
        context: recorded.context,
        checkout_quote_id: recorded.quote.checkout_quote_id,
        idempotency_key: `phase7-RECORDED-${recorded.userId}`,
        now: sixMinutes,
      });
      check(
        replayed.checkout_group_id === recorded.placed.checkout_group_id &&
          replayed.orders.length === 1 &&
          seenByProvider.length === 1,
        'A duplicate submission was not answered with the same checkout without asking the provider again',
      );
      const declinedTwice = await unknownPlacement('DECLINED', now, {
        service: witnessed,
        scenario: 'DECLINE',
      }).catch((error: unknown) => error);
      check(
        declinedTwice instanceof CheckoutPaymentDeclinedError,
        `A declined submission did not surface as a decline (${String(declinedTwice instanceof Error ? declinedTwice.stack : JSON.stringify(declinedTwice))})`,
      );
      const declinedGroup = await pool.query<{
        checkout_group_id: UuidV7;
        checkout_quote_id: UuidV7;
        customer_user_id: UuidV7;
        idempotency_key: string;
      }>(
        `SELECT g.checkout_group_id, g.checkout_quote_id, g.customer_user_id, g.idempotency_key
           FROM marketplace.checkout_groups g
          WHERE g.idempotency_key LIKE 'phase7-DECLINED-%' ORDER BY g.created_at DESC LIMIT 1`,
      );
      const declined = declinedGroup.rows[0];
      check(declined !== undefined, 'A declined submission left no record of itself');
      await rejects(
        () =>
          witnessed.place({
            context: customerContext(declined.customer_user_id),
            checkout_quote_id: declined.checkout_quote_id,
            idempotency_key: declined.idempotency_key,
            now: sixMinutes,
          }),
        CheckoutPaymentDeclinedError,
        'A duplicate of a declined submission did not answer the same decline',
      );
    } finally {
      await witnessed.close();
    }

    // The process that died between the two transactions. While the
    // provider is being asked -- exactly the window -- the sweep runs with
    // the provider's status answer and settles the group; the call's own
    // return then finds the group settled and, disagreeing, opens a conflict
    // rather than changing anything.
    const revived = new (class extends LocalFakeMoneyProvider {
      sweep: (() => Promise<number>) | null = null;
      override async authorize(): Promise<FakeProviderOutcome> {
        const settled = await this.sweep?.();
        check(settled === 1, `The sweep did not settle the stale submission (${settled})`);
        return 'DECLINED';
      }
      override async status(): Promise<FakeProviderOutcome | undefined> {
        return 'SUCCEEDED';
      }
    })({ webhook_key: webhookKey });
    const reviving = new GroupedCheckoutService({
      connection_string: connectionString,
      provider: revived,
    });
    try {
      const afterProcessingDeadline = new Date(now.getTime() + PROCESSING_DEADLINE_MS + 1_000);
      revived.sweep = () =>
        reviving.reconcileProcessingPlacements({ context: sweeper, now: afterProcessingDeadline });
      const earlySweep = await reviving.reconcileProcessingPlacements({
        context: sweeper,
        now: new Date(now.getTime() + PROCESSING_DEADLINE_MS - 1_000),
      });
      const recovered = await unknownPlacement('RECOVERED', now, {
        service: reviving,
        scenario: 'SUCCESS',
      });
      const recoveredEvidence = await recovered.evidence();
      const recoveredTrail = await pool.query<{ events: string[] }>(
        `SELECT array_agg(e.event_type || ':' || e.resulting_state ORDER BY e.payment_version) AS events
           FROM marketplace.payment_events e WHERE e.payment_transaction_id=$1`,
        [recovered.placed.payment_transaction_id],
      );
      check(
        earlySweep === 0 &&
          recovered.placed.lifecycle_state === 'ACTIVE' &&
          recovered.placed.orders.length === 1 &&
          recoveredEvidence.payment_state === 'AUTHORIZED' &&
          recoveredEvidence.conflicts === '1' &&
          JSON.stringify(recoveredTrail.rows[0]?.events) ===
            '["AUTHORIZATION_STARTED:AUTHORIZING","RECONCILIATION_RESULT:AUTHORIZED"]',
        `A submission settled by the sweep was not left standing against the call's late, contradicting answer (${JSON.stringify(
          { earlySweep, recoveredEvidence, trail: recoveredTrail.rows[0] },
        )})`,
      );
    } finally {
      await reviving.close();
    }

    // The same window, no status answer: the sweep holds the submission as
    // unknown, and the call's own definitive answer then settles it.
    const silent = new (class extends LocalFakeMoneyProvider {
      sweep: (() => Promise<number>) | null = null;
      override async authorize(): Promise<FakeProviderOutcome> {
        await this.sweep?.();
        return 'SUCCEEDED';
      }
      override async status(): Promise<FakeProviderOutcome | undefined> {
        return undefined;
      }
    })({ webhook_key: webhookKey });
    const silently = new GroupedCheckoutService({
      connection_string: connectionString,
      provider: silent,
    });
    try {
      silent.sweep = () =>
        silently.reconcileProcessingPlacements({
          context: sweeper,
          now: new Date(now.getTime() + PROCESSING_DEADLINE_MS + 1_000),
        });
      const lateCall = await unknownPlacement('LATECALL', now, {
        service: silently,
        scenario: 'SUCCESS',
      });
      const lateCallTrail = await pool.query<{ events: string[]; states: string[] }>(
        `SELECT (SELECT array_agg(e.event_type || ':' || e.resulting_state ORDER BY e.payment_version)
                   FROM marketplace.payment_events e WHERE e.payment_transaction_id=$2) AS events,
                (SELECT array_agg(t.to_state ORDER BY t.resulting_version)
                   FROM marketplace.aggregate_transitions t WHERE t.aggregate_id=$1) AS states`,
        [lateCall.placed.checkout_group_id, lateCall.placed.payment_transaction_id],
      );
      check(
        lateCall.placed.lifecycle_state === 'ACTIVE' &&
          lateCall.placed.orders.length === 1 &&
          JSON.stringify(lateCallTrail.rows[0]?.events) ===
            '["AUTHORIZATION_STARTED:AUTHORIZING","RECONCILIATION_RESULT:UNKNOWN_REQUIRES_RECONCILIATION","AUTHORIZATION_RESULT:AUTHORIZED"]' &&
          JSON.stringify(lateCallTrail.rows[0]?.states) ===
            '["PROCESSING","PAYMENT_UNKNOWN","ACTIVE"]',
        `A call's answer arriving after the sweep held the submission unknown did not settle it (${JSON.stringify(lateCallTrail.rows[0])})`,
      );
    } finally {
      await silently.close();
    }

    // CUS-33 at the quote. A collected group carries no delivery fee, and a
    // group whose store no longer offers its method is blocked with a stable
    // reason rather than quoted into an order the store cannot fulfil.
    const collectorId = createUuidV7();
    await pool.query(
      "INSERT INTO marketplace.users (user_id,state,data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
      [collectorId],
    );
    const methodStores = await Promise.all(
      (
        [
          ['P', ['PLATFORM_DELIVERY', 'CUSTOMER_PICKUP']],
          ['W', ['CUSTOMER_PICKUP']],
        ] as const
      ).map(([suffix, modes], index) =>
        createDiscoverableStoreFixture(pool, {
          location_name: `SYNTH Checkout Method Store ${suffix}`,
          latitude: 26.91 + index * 0.001,
          longitude: 75.81,
          fulfilment_modes: modes,
        }),
      ),
    );
    const [deliveringStore, collectingStore] = methodStores;
    check(
      deliveringStore !== undefined && collectingStore !== undefined,
      'Fulfilment-method fixture stores missing',
    );
    const methodProducts = [];
    for (const [index, store] of methodStores.entries()) {
      const suffix = `${Date.now()}M${index}`;
      methodProducts.push(
        await catalogue.createProduct({
          context: vendorContext(store.ownerUserId),
          vendor_location_id: store.locationId,
          product_reference: `SYNTH-PROD-COM${suffix}`,
          title: `SYNTH Checkout Method Product ${index}`,
          category: 'FRUIT_VEGETABLE',
          unit_label: 'EACH',
          tax_basis: 'EXEMPT',
          variable_weight: false,
          sku: `SYNTH-SKU-COM${suffix}`,
          variant_title: `SYNTH Checkout Method Variant ${index}`,
          price_minor: 10_000,
          initial_stock_quantity: 5,
          low_stock_threshold: 1,
          now,
        }),
      );
    }
    const [deliveringProduct, collectingProduct] = methodProducts;
    check(
      deliveringProduct !== undefined && collectingProduct !== undefined,
      'Fulfilment-method fixture products missing',
    );
    const collectorAddressId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.customer_addresses
        (customer_address_id,user_id,address_reference,label,pin_code,coordinates,request_id,correlation_id)
       VALUES ($1,$2,'SYNTH-ADDRESS-CHECKOUT-METHOD-' || $4,'SYNTH Checkout Method Home','302020',
         ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,$3,$3)`,
      [
        collectorAddressId,
        collectorId,
        createUuidV7(),
        collectorId.replaceAll('-', '').slice(-10).toUpperCase(),
      ],
    );
    const methodCart = await carts.currentCart({ context: customerContext(collectorId), now });
    await carts.setCartAddress({
      context: customerContext(collectorId),
      customer_address_id: collectorAddressId,
      now,
    });
    await carts.addLine({
      context: customerContext(collectorId),
      vendor_location_id: deliveringStore.locationId,
      catalogue_variant_id: deliveringProduct.catalogue_variant_id,
      quantity: 1,
      now,
    });
    await carts.addLine({
      context: customerContext(collectorId),
      vendor_location_id: collectingStore.locationId,
      catalogue_variant_id: collectingProduct.catalogue_variant_id,
      quantity: 1,
      now,
    });
    const methodQuote = await checkout.createQuote({
      context: customerContext(collectorId),
      cart_id: methodCart.cart_id,
      now,
    });
    const quotedDelivery = methodQuote.groups.find(
      (group) => group.vendor_location_id === deliveringStore.locationId,
    );
    const quotedCollection = methodQuote.groups.find(
      (group) => group.vendor_location_id === collectingStore.locationId,
    );
    check(
      quotedCollection?.fulfilment_method === 'CUSTOMER_PICKUP' &&
        quotedCollection.delivery_minor === 0 &&
        quotedCollection.total_minor === quotedCollection.item_minor + quotedCollection.tip_minor,
      `A collected group was charged a delivery fee (delivery ${String(quotedCollection?.delivery_minor)})`,
    );
    check(
      quotedDelivery?.fulfilment_method === 'PLATFORM_DELIVERY' &&
        quotedDelivery.delivery_minor > 0,
      'A delivered group at the same distance carried no delivery fee',
    );
    check(methodQuote.blocked_groups.length === 0, 'A group with an offered method was blocked');
    const collectedGroup = methodQuote.groups.find(
      (group) => group.vendor_location_id === collectingStore.locationId,
    );
    check(
      collectedGroup?.route_metres === null &&
        collectedGroup.route_source === null &&
        collectedGroup.arrives_after_seconds === null &&
        collectedGroup.ready_after_seconds === 1_200 &&
        String(collectedGroup.promise) === 'Ready in about 20 minutes',
      `A collected group travels no route and promises the shop's preparation time (${JSON.stringify(collectedGroup)})`,
    );

    // The store withdraws collection after the group chose it. The next quote
    // (after the first expires) blocks that group and only that group.
    await pool.query(
      `DELETE FROM marketplace.vendor_location_fulfilment_modes
        WHERE vendor_location_id=$1 AND fulfilment_mode='CUSTOMER_PICKUP'`,
      [collectingStore.locationId],
    );
    const afterExpiry = new Date(now.getTime() + 301_000);
    const withdrawnQuote = await checkout.createQuote({
      context: customerContext(collectorId),
      cart_id: methodCart.cart_id,
      now: afterExpiry,
    });
    check(
      withdrawnQuote.checkout_quote_id !== methodQuote.checkout_quote_id,
      'The expired quote was replayed instead of re-quoting',
    );
    check(
      withdrawnQuote.blocked_groups.length === 1 &&
        withdrawnQuote.blocked_groups[0]?.vendor_location_id === collectingStore.locationId &&
        withdrawnQuote.blocked_groups[0].reason_code === 'FULFILMENT_METHOD_UNAVAILABLE',
      `A group whose method the store withdrew was not blocked as FULFILMENT_METHOD_UNAVAILABLE (got ${JSON.stringify(withdrawnQuote.blocked_groups)})`,
    );
    check(
      withdrawnQuote.groups.length === 1 &&
        withdrawnQuote.groups[0]?.vendor_location_id === deliveringStore.locationId,
      'Blocking the withdrawn group also dropped its healthy sibling',
    );

    // 7.2, the release paths. A store with three units; one customer takes
    // them all at the quote.
    async function customerWithCart(label: string) {
      const userId = createUuidV7();
      await pool.query(
        "INSERT INTO marketplace.users (user_id,state,data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
        [userId],
      );
      const holdAddressId = createUuidV7();
      await pool.query(
        `INSERT INTO marketplace.customer_addresses
          (customer_address_id,user_id,address_reference,label,pin_code,coordinates,request_id,correlation_id)
         VALUES ($1,$2,'SYNTH-ADDRESS-HOLD-' || $4,'SYNTH Hold Home','302020',ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,$3,$3)`,
        [
          holdAddressId,
          userId,
          createUuidV7(),
          `${label}-${userId.replaceAll('-', '').slice(-10).toUpperCase()}`,
        ],
      );
      const holdCart = await carts.currentCart({ context: customerContext(userId), now });
      await carts.setCartAddress({
        context: customerContext(userId),
        customer_address_id: holdAddressId,
        now,
      });
      return { userId, cartId: holdCart.cart_id };
    }
    const shelfStore = await createDiscoverableStoreFixture(pool, {
      location_name: 'SYNTH Checkout Shelf Store',
      latitude: 26.91,
      longitude: 75.81,
    });
    const shelfReference = `SYNTH-PROD-SHELF-${Date.now()}`;
    const shelfProduct = await catalogue.createProduct({
      context: vendorContext(shelfStore.ownerUserId),
      vendor_location_id: shelfStore.locationId,
      product_reference: shelfReference,
      title: 'SYNTH Shelf Product',
      category: 'FRUIT_VEGETABLE',
      unit_label: 'EACH',
      tax_basis: 'EXEMPT',
      variable_weight: false,
      sku: `SYNTH-SKU-SHELF-${Date.now()}`,
      variant_title: 'SYNTH Shelf Variant',
      price_minor: 10_000,
      initial_stock_quantity: 3,
      low_stock_threshold: 1,
      now,
    });
    const shelf = async () => {
      const row = await pool.query<{ quantity: string; state: string; holds: string }>(
        `SELECT i.exact_available_quantity::text AS quantity, i.availability_state AS state,
                (SELECT count(*) FROM marketplace.inventory_reservations r
                  WHERE r.inventory_item_id=i.inventory_item_id AND r.reservation_state='SOFT_HELD')::text AS holds
           FROM marketplace.inventory_items i
          WHERE i.vendor_location_id=$1 AND i.product_reference=$2`,
        [shelfStore.locationId, shelfReference],
      );
      return row.rows[0];
    };
    const taker = await customerWithCart('TAKER');
    await carts.addLine({
      context: customerContext(taker.userId),
      vendor_location_id: shelfStore.locationId,
      catalogue_variant_id: shelfProduct.catalogue_variant_id,
      quantity: 3,
      now,
    });
    const takeAll = await checkout.createQuote({
      context: customerContext(taker.userId),
      cart_id: taker.cartId,
      now,
    });
    const heldShelf = await shelf();
    check(
      takeAll.groups.length === 1 &&
        heldShelf?.quantity === '0' &&
        heldShelf.state === 'OUT_OF_STOCK' &&
        heldShelf.holds === '1',
      `Taking the whole shelf at the quote did not hold it (${JSON.stringify(heldShelf)})`,
    );

    // Declined payment: the units come back, and so does the shelf state.
    // The release used to give the units back and leave OUT_OF_STOCK on the
    // item, so the shop's page said sold out with three on the shelf.
    await rejects(
      () =>
        checkout.place({
          context: customerContext(taker.userId),
          checkout_quote_id: takeAll.checkout_quote_id,
          provider_scenario: 'DECLINE',
          idempotency_key: `phase7-decline-${taker.userId}`,
          now: new Date(now.getTime() + 1_000),
        }),
      CheckoutPaymentDeclinedError,
      'A declined authorization did not surface as a decline',
    );
    const declinedShelf = await shelf();
    check(
      declinedShelf?.quantity === '3' &&
        declinedShelf.state === 'AVAILABLE' &&
        declinedShelf.holds === '0',
      `A declined payment did not give the shelf back with its state recomputed (${JSON.stringify(declinedShelf)})`,
    );
    const declinedEvents = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.inventory_events e
         JOIN marketplace.checkout_quote_lines ql ON ql.inventory_reservation_id=e.reservation_id
         JOIN marketplace.checkout_quote_groups qg USING (checkout_quote_group_id)
        WHERE qg.checkout_quote_id=$1 AND e.event_type='RELEASED' AND e.reason_code='PAYMENT_DECLINED'`,
      [takeAll.checkout_quote_id],
    );
    check(
      declinedEvents.rows[0]?.count === '1',
      'The release after a declined payment left no inventory event',
    );

    // A lapsed quote of one's own is not a competitor. The customer quotes the
    // whole shelf again, lets the quote lapse, and re-quotes before the sweep
    // has run: the new quote must not be blocked by the dead hold.
    const secondTake = await checkout.createQuote({
      context: customerContext(taker.userId),
      cart_id: taker.cartId,
      now: new Date(now.getTime() + 2_000),
    });
    check(
      secondTake.checkout_quote_id !== takeAll.checkout_quote_id && (await shelf())?.holds === '1',
      'The second quote did not take a fresh hold',
    );
    const afterLapse = new Date(secondTake.expires_at.getTime() + 1_000);
    const requote = await checkout
      .createQuote({
        context: customerContext(taker.userId),
        cart_id: taker.cartId,
        now: afterLapse,
      })
      .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
    const requotedShelf = await shelf();
    check(
      !(requote instanceof Error) &&
        requote.checkout_quote_id !== secondTake.checkout_quote_id &&
        requote.groups.length === 1 &&
        requote.blocked_groups.length === 0 &&
        requotedShelf?.quantity === '0' &&
        requotedShelf.holds === '1',
      `Re-quoting after one's own quote lapsed was blocked by the dead hold (${String(requote instanceof Error ? requote : requote.blocked_groups.map((b) => b.reason_code))}; shelf ${JSON.stringify(requotedShelf)})`,
    );
    const lapsedQuote = await pool.query<{ lifecycle_state: string }>(
      'SELECT lifecycle_state FROM marketplace.checkout_quotes WHERE checkout_quote_id=$1',
      [secondTake.checkout_quote_id],
    );
    check(
      lapsedQuote.rows[0]?.lifecycle_state === 'EXPIRED',
      'The lapsed quote was not marked expired when its holds were given back',
    );

    // Sibling reservations are independent. Another customer wanting one of
    // the held units and one of store A's is blocked on the shelf store only,
    // and takes nothing from it.
    const sibling = await customerWithCart('SIBLING');
    const storeA = stores[0];
    const productA = products[0];
    check(storeA !== undefined && productA !== undefined, 'Store A fixture missing');
    await carts.addLine({
      context: customerContext(sibling.userId),
      vendor_location_id: shelfStore.locationId,
      catalogue_variant_id: shelfProduct.catalogue_variant_id,
      quantity: 1,
      now: afterLapse,
    });
    await carts.addLine({
      context: customerContext(sibling.userId),
      vendor_location_id: storeA.locationId,
      catalogue_variant_id: productA.catalogue_variant_id,
      quantity: 1,
      now: afterLapse,
    });
    const siblingQuote = await checkout.createQuote({
      context: customerContext(sibling.userId),
      cart_id: sibling.cartId,
      now: afterLapse,
    });
    check(
      siblingQuote.groups.length === 1 &&
        siblingQuote.groups[0]?.vendor_location_id === storeA.locationId &&
        siblingQuote.blocked_groups.length === 1 &&
        siblingQuote.blocked_groups[0]?.vendor_location_id === shelfStore.locationId &&
        siblingQuote.blocked_groups[0].reason_code === 'INVENTORY_UNAVAILABLE' &&
        (await shelf())?.holds === '1',
      'A competing customer was not blocked on the held shelf alone, or took stock from it',
    );

    // Over-reservation under concurrency, through the checkout path: one unit,
    // two customers, both quoting at once. Exactly one gets it.
    const lastStore = await createDiscoverableStoreFixture(pool, {
      location_name: 'SYNTH Checkout Last Unit Store',
      latitude: 26.91,
      longitude: 75.81,
    });
    const lastReference = `SYNTH-PROD-LAST-${Date.now()}`;
    const lastProduct = await catalogue.createProduct({
      context: vendorContext(lastStore.ownerUserId),
      vendor_location_id: lastStore.locationId,
      product_reference: lastReference,
      title: 'SYNTH Last Unit Product',
      category: 'FRUIT_VEGETABLE',
      unit_label: 'EACH',
      tax_basis: 'EXEMPT',
      variable_weight: false,
      sku: `SYNTH-SKU-LAST-${Date.now()}`,
      variant_title: 'SYNTH Last Unit Variant',
      price_minor: 10_000,
      initial_stock_quantity: 1,
      low_stock_threshold: 1,
      now,
    });
    const racers = await Promise.all([customerWithCart('RACER1'), customerWithCart('RACER2')]);
    for (const racer of racers) {
      await carts.addLine({
        context: customerContext(racer.userId),
        vendor_location_id: lastStore.locationId,
        catalogue_variant_id: lastProduct.catalogue_variant_id,
        quantity: 1,
        now,
      });
    }
    // Force the interleaving rather than hope for it: hold the item's row
    // lock while both quotes start, so each reads one unit on the shelf before
    // either can take it, then let go. The correct path re-reads under the
    // lock and the second quote finds nothing; a path that trusts its first
    // read holds the unit twice.
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query(
      'SELECT 1 FROM marketplace.inventory_items WHERE vendor_location_id=$1 AND product_reference=$2 FOR UPDATE',
      [lastStore.locationId, lastReference],
    );
    const racing = Promise.allSettled(
      racers.map((racer) =>
        checkout.createQuote({
          context: customerContext(racer.userId),
          cart_id: racer.cartId,
          now,
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    await blocker.query('COMMIT');
    blocker.release();
    const race = await racing;
    const winners = race.filter((r) => r.status === 'fulfilled');
    const losers = race.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    const lastShelf = await pool.query<{ quantity: string; holds: string }>(
      `SELECT i.exact_available_quantity::text AS quantity,
              (SELECT count(*) FROM marketplace.inventory_reservations r
                WHERE r.inventory_item_id=i.inventory_item_id AND r.reservation_state='SOFT_HELD')::text AS holds
         FROM marketplace.inventory_items i
        WHERE i.vendor_location_id=$1 AND i.product_reference=$2`,
      [lastStore.locationId, lastReference],
    );
    check(
      winners.length === 1 &&
        losers.length === 1 &&
        losers[0]?.reason instanceof CheckoutConflictError &&
        lastShelf.rows[0]?.quantity === '0' &&
        lastShelf.rows[0].holds === '1',
      `Two customers quoting the last unit at once did not produce exactly one hold (${JSON.stringify({ winners: winners.length, loser: String(losers[0]?.reason), shelf: lastShelf.rows[0] })})`,
    );

    // 7.1 requirement 2, the other half: a policy version is attached so the
    // order can be priced and settled under it later. A new policy version
    // comes into force an hour after these quotes; the earlier quote keeps its
    // version, a later quote takes the new one, and resolving the policy "as
    // of" the earlier instant still finds the version then in force. The
    // resolver used to consider ACTIVE rows only, so the first policy change
    // made every earlier order unsettleable. The new version carries the same
    // amounts, so nothing else in the ladder prices differently after it.
    const proposerId = createUuidV7();
    const approverId = createUuidV7();
    for (const actorId of [proposerId, approverId]) {
      await pool.query(
        `INSERT INTO marketplace.users (user_id, created_at, updated_at)
         VALUES ($1,$2,$2) ON CONFLICT (user_id) DO NOTHING`,
        [actorId, now],
      );
    }
    const before = await resolveFinancialPolicy(pool, { at: now });
    const successorFrom = new Date(now.getTime() + 60 * 60_000);
    const successor = await createConfigurationDraft(pool, {
      actor_id: proposerId,
      configuration_key: 'finance.financial_policy',
      configuration_kind: 'SETTING',
      configuration_value: { ...before.policy },
      correlation_id: createUuidV7(),
      request_id: createRequestId(),
      scope: { kind: 'GLOBAL', reference: 'global' },
    });
    await validateConfigurationVersion(pool, {
      actor_id: proposerId,
      configuration_version_id: successor.configuration_version_id,
      request_id: createRequestId(),
    });
    await approveConfigurationVersion(pool, {
      actor_id: approverId,
      configuration_version_id: successor.configuration_version_id,
      request_id: createRequestId(),
    });
    await scheduleConfigurationVersion(pool, {
      actor_id: approverId,
      configuration_version_id: successor.configuration_version_id,
      effective_from: successorFrom,
      request_id: createRequestId(),
    });
    await activateConfigurationVersion(pool, {
      actor_id: approverId,
      at: successorFrom,
      configuration_version_id: successor.configuration_version_id,
      request_id: createRequestId(),
    });
    const afterAtQuote = await resolveFinancialPolicy(pool, { at: now });
    check(
      afterAtQuote.version_reference === before.version_reference &&
        afterAtQuote.version_reference === quote.policy_version_reference,
      'After a policy change, the version in force when the order was quoted no longer resolves',
    );
    const afterLater = await resolveFinancialPolicy(pool, {
      at: new Date(successorFrom.getTime() + 1_000),
    });
    check(
      afterLater.version_reference !== before.version_reference &&
        /^SYNTH-POLICY-FIN-V\d+-[0-9A-F]{8}$/.test(afterLater.version_reference),
      'The successor policy does not resolve once in force',
    );
    // A quote priced *after* the change but *for* an instant before it is the
    // case that separates "the policy as of the quote" from "the policy now":
    // the wall clock is long past the successor, and only the quote's own
    // instant can pick the predecessor.
    const beforeSuccessorQuote = await checkout.createQuote({
      context: customerContext(collectorId),
      cart_id: methodCart.cart_id,
      now: new Date(now.getTime() + 12 * 60_000),
    });
    check(
      beforeSuccessorQuote.checkout_quote_id !== withdrawnQuote.checkout_quote_id &&
        beforeSuccessorQuote.policy_version_reference === before.version_reference,
      `A quote for an instant before the policy change was priced under the successor (${beforeSuccessorQuote.policy_version_reference})`,
    );
    const laterQuote = await checkout.createQuote({
      context: customerContext(collectorId),
      cart_id: methodCart.cart_id,
      now: new Date(successorFrom.getTime() + 2_000),
    });
    check(
      laterQuote.policy_version_reference === afterLater.version_reference &&
        laterQuote.checkout_quote_id !== withdrawnQuote.checkout_quote_id,
      'A quote priced after the policy change did not carry the successor version',
    );

    // 7.3: the quote is bound to the cart's content. A retry replays it; a
    // change re-quotes and retires the earlier one; placing a quote the cart
    // has moved on from is refused; and a store or a line the quote cannot
    // carry is returned as a blocked group, never silently left out.
    const changer = await customerWithCart('CHANGER');
    const storeB = stores[1];
    const productB = products[1];
    check(storeB !== undefined && productB !== undefined, 'Store B fixture missing');
    const t0 = new Date(successorFrom.getTime() + 10 * 60_000);
    await carts.addLine({
      context: customerContext(changer.userId),
      vendor_location_id: storeA.locationId,
      catalogue_variant_id: productA.catalogue_variant_id,
      quantity: 1,
      now: t0,
    });
    const first = await checkout.createQuote({
      context: customerContext(changer.userId),
      cart_id: changer.cartId,
      now: t0,
    });
    const firstRetry = await checkout.createQuote({
      context: customerContext(changer.userId),
      cart_id: changer.cartId,
      now: new Date(t0.getTime() + 1_000),
    });
    check(
      firstRetry.checkout_quote_id === first.checkout_quote_id,
      'A retry with the same content, after the first quote had held its stock, did not replay',
    );
    // Add a second store. The live quote no longer describes the cart.
    await carts.addLine({
      context: customerContext(changer.userId),
      vendor_location_id: storeB.locationId,
      catalogue_variant_id: productB.catalogue_variant_id,
      quantity: 1,
      now: new Date(t0.getTime() + 2_000),
    });
    const second = await checkout.createQuote({
      context: customerContext(changer.userId),
      cart_id: changer.cartId,
      now: new Date(t0.getTime() + 3_000),
    });
    check(
      second.checkout_quote_id !== first.checkout_quote_id && second.groups.length === 2,
      `Re-quoting a changed cart returned the earlier quote, or not both stores (${second.groups.length} groups)`,
    );
    const retired = await pool.query<{ lifecycle_state: string; holds: string; events: string }>(
      `SELECT q.lifecycle_state,
              (SELECT count(*) FROM marketplace.checkout_quote_lines ql
                JOIN marketplace.checkout_quote_groups qg USING (checkout_quote_group_id)
                JOIN marketplace.inventory_reservations r ON r.reservation_id=ql.inventory_reservation_id
                WHERE qg.checkout_quote_id=q.checkout_quote_id AND r.reservation_state='SOFT_HELD')::text AS holds,
              (SELECT count(*) FROM marketplace.inventory_events e
                JOIN marketplace.checkout_quote_lines ql ON ql.inventory_reservation_id=e.reservation_id
                JOIN marketplace.checkout_quote_groups qg USING (checkout_quote_group_id)
                WHERE qg.checkout_quote_id=q.checkout_quote_id AND e.event_type='RELEASED'
                  AND e.reason_code='QUOTE_SUPERSEDED')::text AS events
         FROM marketplace.checkout_quotes q WHERE q.checkout_quote_id=$1`,
      [first.checkout_quote_id],
    );
    check(
      retired.rows[0]?.lifecycle_state === 'INVALID' &&
        retired.rows[0].holds === '0' &&
        retired.rows[0].events === '1',
      `The superseded quote was not retired with its hold given back (${JSON.stringify(retired.rows[0])})`,
    );
    // The cart moves on again after the second quote; placing that quote is
    // refused, because the order would not be the basket.
    const changerCart = await carts.currentCart({
      context: customerContext(changer.userId),
      now: t0,
    });
    const lineB = changerCart.groups
      .find((g) => g.vendor_location_id === storeB.locationId)
      ?.lines.find((l) => l.catalogue_variant_id === productB.catalogue_variant_id);
    check(lineB !== undefined, 'The changer cart has no store B line');
    await carts.setLineQuantity({
      context: customerContext(changer.userId),
      cart_line_id: lineB.cart_line_id,
      expected_version: lineB.version,
      quantity: 2,
      now: new Date(t0.getTime() + 4_000),
    });
    await rejects(
      () =>
        checkout.place({
          context: customerContext(changer.userId),
          checkout_quote_id: second.checkout_quote_id,
          provider_scenario: 'SUCCESS',
          idempotency_key: `phase7-changed-${changer.userId}`,
          now: new Date(t0.getTime() + 5_000),
        }),
      CheckoutConflictError,
      'A quote whose cart had changed was placed anyway',
    );
    // A store that cannot take the order is a blocked group with a reason,
    // not a group missing from the quote. Pause store B's storefront.
    await pool.query(
      "UPDATE marketplace.vendor_publication_cases SET lifecycle_state='PAUSED' WHERE vendor_location_id=$1",
      [storeB.locationId],
    );
    const pausedQuote = await checkout.createQuote({
      context: customerContext(changer.userId),
      cart_id: changer.cartId,
      now: new Date(t0.getTime() + 6_000),
    });
    check(
      pausedQuote.groups.length === 1 &&
        pausedQuote.groups[0]?.vendor_location_id === storeA.locationId &&
        pausedQuote.blocked_groups.length === 1 &&
        pausedQuote.blocked_groups[0]?.vendor_location_id === storeB.locationId &&
        pausedQuote.blocked_groups[0].reason_code === 'STORE_UNAVAILABLE',
      `A paused store was not returned as a blocked group with STORE_UNAVAILABLE (${JSON.stringify(pausedQuote.blocked_groups)})`,
    );
    await pool.query(
      "UPDATE marketplace.vendor_publication_cases SET lifecycle_state='PUBLISHED' WHERE vendor_location_id=$1",
      [storeB.locationId],
    );
    // A line the store can no longer supply blocks its group rather than
    // being left out of it: the basket said two items, the order had one.
    const extraReference = `SYNTH-PROD-EXTRA-${Date.now()}`;
    const extra = await catalogue.createProduct({
      context: vendorContext(storeA.ownerUserId),
      vendor_location_id: storeA.locationId,
      product_reference: extraReference,
      title: 'SYNTH Extra Product',
      category: 'FRUIT_VEGETABLE',
      unit_label: 'EACH',
      tax_basis: 'EXEMPT',
      variable_weight: false,
      sku: `SYNTH-SKU-EXTRA-${Date.now()}`,
      variant_title: 'SYNTH Extra Variant',
      price_minor: 5_000,
      initial_stock_quantity: 5,
      low_stock_threshold: 1,
      now: t0,
    });
    await carts.addLine({
      context: customerContext(changer.userId),
      vendor_location_id: storeA.locationId,
      catalogue_variant_id: extra.catalogue_variant_id,
      quantity: 1,
      now: new Date(t0.getTime() + 7_000),
    });
    await pool.query(
      'UPDATE marketplace.catalogue_prices SET effective_until=$2 WHERE catalogue_variant_id=$1 AND effective_until IS NULL',
      [extra.catalogue_variant_id, new Date(t0.getTime() + 8_000)],
    );
    const shortQuote = await checkout.createQuote({
      context: customerContext(changer.userId),
      cart_id: changer.cartId,
      now: new Date(t0.getTime() + 9_000),
    });
    check(
      shortQuote.groups.length === 1 &&
        shortQuote.groups[0]?.vendor_location_id === storeB.locationId &&
        shortQuote.blocked_groups.length === 1 &&
        shortQuote.blocked_groups[0]?.vendor_location_id === storeA.locationId &&
        shortQuote.blocked_groups[0].reason_code === 'LINE_UNAVAILABLE',
      `A group with an unpriced line was quoted short, or blocked for the wrong reason (${JSON.stringify({ groups: shortQuote.groups.map((g) => g.vendor_location_id), blocked: shortQuote.blocked_groups })})`,
    );
    await catalogue.setVariantPrice({
      context: vendorContext(storeA.ownerUserId),
      vendor_location_id: storeA.locationId,
      catalogue_variant_id: extra.catalogue_variant_id,
      price_minor: 5_000,
      now: new Date(t0.getTime() + 10_000),
    });

    // D-17: with a maps provider answering, the fee is priced on the road it
    // returns, the road and its source are stored on the quote group, and the
    // provider is asked once per pair -- a second quote of the same pair is
    // served from the cache.
    let providerCalls = 0;
    const roads: RoutingProvider = {
      source: 'MAPBOX',
      profile: 'driving',
      route: async () => ({ distance_metres: 3_500, duration_seconds: 700 }),
      routeMany: async (_origin, destinations) => {
        providerCalls += 1;
        return destinations.map(() => ({ distance_metres: 3_500, duration_seconds: 700 }));
      },
    };
    const routedCheckout = new GroupedCheckoutService({
      connection_string: connectionString,
      webhook_key: webhookKey,
      routing: new RoutingService({ provider: roads, pool }),
    });
    try {
      const roadCustomer = await customerWithCart('ROAD');
      await carts.addLine({
        context: customerContext(roadCustomer.userId),
        vendor_location_id: storeA.locationId,
        catalogue_variant_id: productA.catalogue_variant_id,
        quantity: 1,
        now: t0,
      });
      const routedQuote = await routedCheckout.createQuote({
        context: customerContext(roadCustomer.userId),
        cart_id: roadCustomer.cartId,
        now: new Date(t0.getTime() + 20_000),
      });
      const routedGroup = routedQuote.groups[0];
      check(
        routedQuote.groups.length === 1 &&
          routedGroup?.route_metres === 3_500 &&
          routedGroup.route_seconds === 700 &&
          routedGroup.route_source === 'MAPBOX' &&
          routedGroup.delivery_minor === calculateDistanceAmount(3_500) &&
          routedGroup.delivery_minor === 2_700 &&
          routedGroup.arrives_after_seconds === 1_900 &&
          String(routedGroup.promise) === 'Arrives in about 32–47 minutes',
        `A quote with a maps provider was not priced and promised on the road it returned (${JSON.stringify(routedGroup)})`,
      );
      const stored = await pool.query<{ route_metres: string; route_source: string }>(
        'SELECT route_metres::text, route_source FROM marketplace.checkout_quote_groups WHERE checkout_quote_id=$1',
        [routedQuote.checkout_quote_id],
      );
      check(
        stored.rows[0]?.route_metres === '3500' && stored.rows[0].route_source === 'MAPBOX',
        'The road the quote was priced on is not stored on the quote group',
      );
      check(providerCalls === 1, `The provider was asked ${providerCalls} times for one pair`);
      // Change the cart so a fresh quote is made for the same store and door.
      await carts.addLine({
        context: customerContext(roadCustomer.userId),
        vendor_location_id: storeA.locationId,
        catalogue_variant_id: extra.catalogue_variant_id,
        quantity: 1,
        now: new Date(t0.getTime() + 21_000),
      });
      const cachedQuote = await routedCheckout.createQuote({
        context: customerContext(roadCustomer.userId),
        cart_id: roadCustomer.cartId,
        now: new Date(t0.getTime() + 22_000),
      });
      check(
        cachedQuote.checkout_quote_id !== routedQuote.checkout_quote_id &&
          cachedQuote.groups[0]?.route_metres === 3_500 &&
          cachedQuote.groups[0].route_source === 'MAPBOX' &&
          providerCalls === 1,
        `A second quote for the same pair asked the provider again (${providerCalls} calls)`,
      );
    } finally {
      await routedCheckout.close();
    }
  } finally {
    await Promise.all([checkout.close(), inventory.close(), catalogue.close(), carts.close()]);
    await pool.end();
  }
}
