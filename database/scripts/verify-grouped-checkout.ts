import { createHmac } from 'node:crypto';
import { createUuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { CatalogueProductService } from '../src/catalogue-products.js';
import { CustomerCartService } from '../src/customer-cart.js';
import { CheckoutNotFoundError, GroupedCheckoutService } from '../src/grouped-checkout.js';
import { InventoryReservationService } from '../src/inventory-reservations.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';
import { check, customerContext, vendorContext } from './verify-support.js';

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
       VALUES ($1,$2,'SYNTH-ADDRESS-CHECKOUT','SYNTH Checkout Home','302020',
         ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,$3,$3)`,
      [addressId, customerId, createUuidV7()],
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
       VALUES ($1,$2,'SYNTH-ADDRESS-UNKNOWN','SYNTH Unknown Home','302020',ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,$3,$3)`,
      [unknownAddress, unknownCustomer, createUuidV7()],
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
       VALUES ($1,$2,'SYNTH-ADDRESS-CHECKOUT-METHOD','SYNTH Checkout Method Home','302020',
         ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,$3,$3)`,
      [collectorAddressId, collectorId, createUuidV7()],
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
  } finally {
    await Promise.all([checkout.close(), inventory.close(), catalogue.close(), carts.close()]);
    await pool.end();
  }
}
