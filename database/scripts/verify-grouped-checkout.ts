import { createHmac } from 'node:crypto';
import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { CatalogueProductService } from '../src/catalogue-products.js';
import { CustomerCartService } from '../src/customer-cart.js';
import { CheckoutNotFoundError, GroupedCheckoutService } from '../src/grouped-checkout.js';
import { InventoryReservationService } from '../src/inventory-reservations.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function customerContext(userId: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: userId,
      actor_kind: 'customer',
      session_id: createUuidV7(),
    }),
  });
}
function vendorContext(userId: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: userId,
      actor_kind: 'vendor_staff',
      session_id: createUuidV7(),
    }),
  });
}
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
  const checkout = new GroupedCheckoutService({ connection_string: connectionString });
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
        now,
      });
      products.push(product);
      await inventory.createItem({
        context: vendorContext(store.ownerUserId),
        display_name: `SYNTH Checkout Stock ${index}`,
        exact_available_quantity: index === 2 ? 0 : 5,
        low_stock_threshold: 1,
        now,
        product_reference: `SYNTH-PROD-CO${suffix}`,
        quantity_basis: 'COUNTED',
        reason_code: 'CHECKOUT_FIXTURE',
        vendor_location_id: store.locationId,
      });
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
    const signature = createHmac('sha256', 'SYNTH-LOCAL-WEBHOOK-KEY')
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
  } finally {
    await Promise.all([checkout.close(), inventory.close(), catalogue.close(), carts.close()]);
    await pool.end();
  }
}
