import { createHmac } from 'node:crypto';
import { createRequestId, createUuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { CatalogueProductService } from '../src/catalogue-products.js';
import { CustomerCartService } from '../src/customer-cart.js';
import { resolveFinancialPolicy } from '../src/financial-policy.js';
import {
  CheckoutConflictError,
  CheckoutNotFoundError,
  CheckoutPaymentDeclinedError,
  GroupedCheckoutService,
} from '../src/grouped-checkout.js';
import { InventoryReservationService } from '../src/inventory-reservations.js';
import { calculateDistanceAmount } from '../src/money-policy.js';
import {
  activateConfigurationVersion,
  approveConfigurationVersion,
  createConfigurationDraft,
  scheduleConfigurationVersion,
  validateConfigurationVersion,
} from '../src/versioned-configuration.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';
import { check, customerContext, rejects, vendorContext } from './verify-support.js';

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
      check(
        group.item_minor === 10_000 &&
          group.delivery_minor === calculateDistanceAmount(metres) &&
          group.delivery_minor === 1_500 &&
          group.tip_minor === 0 &&
          group.total_minor === 11_500,
        `A quoted group's amounts are not the pricing module's for its route (${JSON.stringify({ item: group.item_minor, delivery: group.delivery_minor, tip: group.tip_minor, total: group.total_minor, metres })})`,
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
  } finally {
    await Promise.all([checkout.close(), inventory.close(), catalogue.close(), carts.close()]);
    await pool.end();
  }
}
