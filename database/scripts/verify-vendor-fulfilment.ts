import { createHash } from 'node:crypto';
import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { CatalogueProductService } from '../src/catalogue-products.js';
import { CustomerCartService } from '../src/customer-cart.js';
import { GroupedCheckoutService } from '../src/grouped-checkout.js';
import { IdentityAccessService } from '../src/identity-access.js';
import { InventoryReservationService } from '../src/inventory-reservations.js';
import {
  FulfilmentAuthorizationError,
  FulfilmentConflictError,
  FulfilmentInputError,
  FulfilmentNotFoundError,
  PickupOtpMismatchError,
  VendorFulfilmentService,
} from '../src/vendor-fulfilment.js';
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
function systemContext(userId: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: userId,
      actor_kind: 'system',
      session_id: createUuidV7(),
    }),
  });
}
async function rejects(work: () => Promise<unknown>, kind: new () => Error, message: string) {
  try {
    await work();
  } catch (error) {
    check(error instanceof kind, `${message} (raised ${String(error)})`);
    return;
  }
  throw new Error(message);
}

export async function verifyVendorFulfilment(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const access = new IdentityAccessService({ connection_string: connectionString });
  const inventory = new InventoryReservationService({ connection_string: connectionString });
  const catalogue = new CatalogueProductService({ connection_string: connectionString });
  const carts = new CustomerCartService({ connection_string: connectionString });
  const checkout = new GroupedCheckoutService({ connection_string: connectionString });
  const fulfilment = new VendorFulfilmentService({
    connection_string: connectionString,
    inventory,
  });
  const now = new Date();
  const customerId = createUuidV7();
  const strangerCustomerId = createUuidV7();
  const systemActorId = createUuidV7();
  try {
    for (const userId of [customerId, strangerCustomerId, systemActorId]) {
      await pool.query(
        "INSERT INTO marketplace.users (user_id,state,data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
        [userId],
      );
    }

    // Build two stores, add stock, drop items into a cart, quote, and place.
    // This gives us two vendor_orders in a single checkout_group and lets
    // Phase 8 exercise its sibling-isolation invariants.
    const stores = await Promise.all(
      ['P', 'Q'].map((suffix, index) =>
        createDiscoverableStoreFixture(pool, {
          location_name: `SYNTH Fulfilment Store ${suffix}`,
          latitude: 26.911 + index * 0.001,
          longitude: 75.811,
        }),
      ),
    );
    const products = [];
    for (const [index, store] of stores.entries()) {
      const suffix = `${Date.now()}${index}`;
      const product = await catalogue.createProduct({
        context: vendorContext(store.ownerUserId),
        vendor_location_id: store.locationId,
        product_reference: `SYNTH-PROD-F${suffix}`,
        title: `SYNTH Fulfilment Product ${index}`,
        category: 'FRUIT_VEGETABLE',
        unit_label: 'EACH',
        tax_basis: 'EXEMPT',
        variable_weight: false,
        sku: `SYNTH-SKU-F${suffix}`,
        variant_title: `SYNTH Fulfilment Variant ${index}`,
        price_minor: 20_000,
        now,
      });
      products.push(product);
      await inventory.createItem({
        context: vendorContext(store.ownerUserId),
        display_name: `SYNTH Fulfilment Stock ${index}`,
        exact_available_quantity: 8,
        low_stock_threshold: 2,
        now,
        product_reference: `SYNTH-PROD-F${suffix}`,
        quantity_basis: 'COUNTED',
        reason_code: 'FULFILMENT_FIXTURE',
        vendor_location_id: store.locationId,
      });
    }
    const addressId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.customer_addresses
        (customer_address_id,user_id,address_reference,label,pin_code,coordinates,request_id,correlation_id)
       VALUES ($1,$2,'SYNTH-ADDRESS-FULFIL','SYNTH Fulfilment Home','302020',
         ST_SetSRID(ST_MakePoint(75.811,26.911),4326)::geography,$3,$3)`,
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
      check(product !== undefined, 'Fixture product missing');
      await carts.addLine({
        context: customerContext(customerId),
        vendor_location_id: store.locationId,
        catalogue_variant_id: product.catalogue_variant_id,
        quantity: 2,
        now,
      });
    }
    const quote = await checkout.createQuote({
      context: customerContext(customerId),
      cart_id: cart.cart_id,
      now,
    });
    const placed = await checkout.place({
      context: customerContext(customerId),
      checkout_quote_id: quote.checkout_quote_id,
      provider_scenario: 'SUCCESS',
      idempotency_key: 'phase8-place-001',
      now: new Date(now.getTime() + 1_000),
    });
    check(placed.orders.length === 2, 'Fixture must place two vendor_orders');
    const [orderA, orderB] = placed.orders;
    check(orderA !== undefined && orderB !== undefined, 'Placed orders missing');
    const storeA = stores.find((s) => s.locationId === orderA.vendor_location_id);
    const storeB = stores.find((s) => s.locationId === orderB.vendor_location_id);
    check(storeA !== undefined && storeB !== undefined, 'Store fixture lookup failed');

    // 8.1 -- issue accept-by deadlines for the whole checkout group.
    const deadlined = await fulfilment.issueAcceptDeadlines({
      context: systemContext(systemActorId),
      checkout_group_id: placed.checkout_group_id,
      deadline_seconds: 180,
      now: new Date(now.getTime() + 2_000),
    });
    check(deadlined.length === 2, 'Accept-by deadlines should apply to both vendor_orders');

    // 8.2 -- vendor B declines their order. Sibling A must stay PLACED with
    // its holds intact.
    const declined = await fulfilment.decline({
      context: vendorContext(storeB.ownerUserId),
      vendor_order_id: orderB.vendor_order_id,
      vendor_location_id: storeB.locationId,
      expected_version: orderB.version,
      reason_code: 'OUT_OF_STOCK',
      note: 'SYNTH decline for sibling-isolation test.',
      now: new Date(now.getTime() + 3_000),
    });
    check(declined.lifecycle_state === 'CANCELLED', 'Decline did not cancel the order');
    const siblingCheck = await fulfilment.getOrder({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderA.vendor_order_id,
    });
    check(
      siblingCheck.lifecycle_state === 'PLACED',
      'Sibling vendor order was affected by a decline elsewhere',
    );
    const siblingHold = await pool.query<{ state: string }>(
      `SELECT ir.reservation_state AS state FROM marketplace.vendor_order_lines l
         JOIN marketplace.inventory_reservations ir ON ir.reservation_id=l.inventory_reservation_id
        WHERE l.vendor_order_id=$1`,
      [orderA.vendor_order_id],
    );
    check(
      siblingHold.rows.every((row) => row.state === 'PROVISIONAL'),
      'Sibling reservations were released by an unrelated decline',
    );
    const declinedHold = await pool.query<{ state: string }>(
      `SELECT ir.reservation_state AS state FROM marketplace.vendor_order_lines l
         JOIN marketplace.inventory_reservations ir ON ir.reservation_id=l.inventory_reservation_id
        WHERE l.vendor_order_id=$1`,
      [orderB.vendor_order_id],
    );
    check(
      declinedHold.rows.every((row) => row.state === 'RELEASED'),
      'Declined order did not release its own reservations',
    );

    // 8.2 -- vendor A accepts. Version guard rejects stale expected_version.
    await rejects(
      () =>
        fulfilment.accept({
          context: vendorContext(storeA.ownerUserId),
          vendor_order_id: orderA.vendor_order_id,
          vendor_location_id: storeA.locationId,
          expected_version: orderA.version + 100,
          preparation_estimate_seconds: 900,
          now: new Date(now.getTime() + 4_000),
        }),
      FulfilmentConflictError,
      'A stale expected_version was allowed to accept',
    );
    const accepted = await fulfilment.accept({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: orderA.version,
      preparation_estimate_seconds: 900,
      now: new Date(now.getTime() + 5_000),
    });
    check(
      accepted.lifecycle_state === 'ACCEPTED' && accepted.preparation_estimate_seconds === 900,
      'Accept did not persist prep estimate',
    );

    // 8.2 -- another vendor cannot touch this order.
    await rejects(
      () =>
        fulfilment.startPicking({
          context: vendorContext(storeB.ownerUserId),
          vendor_order_id: orderA.vendor_order_id,
          vendor_location_id: storeB.locationId,
          expected_version: accepted.version,
        }),
      FulfilmentNotFoundError,
      'Cross-vendor access to an order was permitted',
    );

    // 8.3 -- picking. Line must be marked before ready succeeds.
    const picking = await fulfilment.startPicking({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: accepted.version,
      now: new Date(now.getTime() + 6_000),
    });
    const lineRow = await pool.query<{ id: string }>(
      `SELECT vendor_order_line_id AS id FROM marketplace.vendor_order_lines
        WHERE vendor_order_id=$1 LIMIT 1`,
      [orderA.vendor_order_id],
    );
    const vendorOrderLineId = lineRow.rows[0]?.id;
    check(typeof vendorOrderLineId === 'string', 'Fixture vendor_order_lines missing');

    // Attempting to mark ready before the line is picked must fail.
    await rejects(
      () =>
        fulfilment.markReady({
          context: vendorContext(storeA.ownerUserId),
          vendor_order_id: orderA.vendor_order_id,
          vendor_location_id: storeA.locationId,
          expected_version: picking.version,
          package_count: 1,
        }),
      FulfilmentConflictError,
      'Unresolved lines were allowed to reach ready',
    );

    const found = await fulfilment.markLineFound({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeA.locationId,
      vendor_order_line_id: vendorOrderLineId as UuidV7,
      actual_quantity: 2,
      actual_unit_price_minor: 20_000,
      now: new Date(now.getTime() + 7_000),
    });
    check(found.pick_state === 'FOUND', 'Line pick did not persist FOUND state');

    // 8.5 -- ready succeeds now that every line is resolved.
    const ready = await fulfilment.markReady({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: picking.version,
      package_count: 1,
      package_condition_note: 'One sealed synthetic crate.',
      now: new Date(now.getTime() + 8_000),
    });
    check(
      ready.lifecycle_state === 'READY' && ready.package_count === 1,
      'Ready did not persist package count',
    );

    // 8.6 -- issue OTP, exercise mismatch/expiry/exhaustion, then complete.
    const otp = await fulfilment.issuePickupOtp({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeA.locationId,
      now: new Date(now.getTime() + 9_000),
    });
    check(/^[0-9]{6}$/.test(otp.plaintext_otp), 'OTP shape wrong');
    const storedHash = await pool.query<{ hash: string }>(
      `SELECT pickup_otp_hash AS hash FROM marketplace.vendor_orders WHERE vendor_order_id=$1`,
      [orderA.vendor_order_id],
    );
    check(
      storedHash.rows[0]?.hash === createHash('sha256').update(otp.plaintext_otp).digest('hex'),
      'Stored OTP hash does not match the plaintext OTP',
    );

    await rejects(
      () =>
        fulfilment.completePickup({
          context: vendorContext(storeA.ownerUserId),
          vendor_order_id: orderA.vendor_order_id,
          vendor_location_id: storeA.locationId,
          otp: '000000',
          now: new Date(now.getTime() + 10_000),
        }),
      PickupOtpMismatchError,
      'A wrong OTP was accepted',
    );
    const attemptCheck = await pool.query<{ count: number }>(
      `SELECT pickup_otp_attempts::int AS count FROM marketplace.vendor_orders WHERE vendor_order_id=$1`,
      [orderA.vendor_order_id],
    );
    check(
      attemptCheck.rows[0]?.count === 1,
      'Failed OTP attempt did not increment the attempt counter',
    );

    const pickedUp = await fulfilment.completePickup({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeA.locationId,
      otp: otp.plaintext_otp,
      proof_note: 'Customer collected the synthetic crate in person.',
      now: new Date(now.getTime() + 11_000),
    });
    check(
      pickedUp.lifecycle_state === 'PICKED_UP' && pickedUp.picked_up_at !== null,
      'Pickup did not complete',
    );

    // 8.6 -- an already-completed order cannot pickup again, and its OTP is cleared.
    const cleared = await pool.query<{ hash: string | null }>(
      `SELECT pickup_otp_hash AS hash FROM marketplace.vendor_orders WHERE vendor_order_id=$1`,
      [orderA.vendor_order_id],
    );
    check(cleared.rows[0]?.hash === null, 'Pickup did not clear the OTP hash');
    await rejects(
      () =>
        fulfilment.completePickup({
          context: vendorContext(storeA.ownerUserId),
          vendor_order_id: orderA.vendor_order_id,
          vendor_location_id: storeA.locationId,
          otp: otp.plaintext_otp,
          now: new Date(now.getTime() + 12_000),
        }),
      FulfilmentConflictError,
      'A completed order accepted a second pickup',
    );

    // 8.6 -- inventory holds committed via the outbox-triggered path.
    const committed = await fulfilment.settleInventoryOnPickup({
      context: systemContext(systemActorId),
      vendor_order_id: orderA.vendor_order_id,
      now: new Date(now.getTime() + 13_000),
    });
    check(committed >= 1, 'Inventory commit for pickup did not run');
    const finalState = await pool.query<{ state: string }>(
      `SELECT ir.reservation_state AS state FROM marketplace.vendor_order_lines l
         JOIN marketplace.inventory_reservations ir ON ir.reservation_id=l.inventory_reservation_id
        WHERE l.vendor_order_id=$1`,
      [orderA.vendor_order_id],
    );
    check(
      finalState.rows.every((row) => row.state === 'COMMITTED'),
      'Reservations were not committed on pickup',
    );

    // 8.7 -- customer history and receipt.
    const history = await fulfilment.listCustomerOrders({
      context: customerContext(customerId),
    });
    check(
      history.length >= 1 && history[0]?.vendor_orders.length === 2,
      'Customer history did not list both orders under one checkout group',
    );
    const receipt = await fulfilment.getReceipt({
      context: customerContext(customerId),
      vendor_order_id: orderA.vendor_order_id,
    });
    check(
      receipt.lines.length === 1 && receipt.lines[0]?.pick_state === 'FOUND',
      'Receipt did not reflect picked state',
    );
    await rejects(
      () =>
        fulfilment.getReceipt({
          context: customerContext(strangerCustomerId),
          vendor_order_id: orderA.vendor_order_id,
        }),
      FulfilmentNotFoundError,
      'Another customer read a receipt they do not own',
    );

    // 8.7 -- rating (once) and support case.
    await fulfilment.submitRating({
      context: customerContext(customerId),
      vendor_order_id: orderA.vendor_order_id,
      stars: 5,
      review_note: 'SYNTH rating - crate arrived intact.',
    });
    await rejects(
      () =>
        fulfilment.submitRating({
          context: customerContext(customerId),
          vendor_order_id: orderA.vendor_order_id,
          stars: 4,
        }),
      FulfilmentConflictError,
      'A second rating was accepted for the same order',
    );
    await fulfilment.openSupportCase({
      context: customerContext(customerId),
      vendor_order_id: orderA.vendor_order_id,
      category: 'MISSING_ITEM',
      description: 'SYNTH support case for coverage.',
    });

    // 8.1 -- system-driven timeout: a fresh PLACED order whose accept_by has
    // passed transitions to EXPIRED. Build a third store fixture so we can
    // add a lightweight order to the existing checkout_group without hitting
    // the (checkout_group_id, vendor_location_id) uniqueness constraint.
    const storeC = await createDiscoverableStoreFixture(pool, {
      location_name: `SYNTH Fulfilment Store T${Date.now()}`,
      latitude: 26.912,
      longitude: 75.812,
    });
    const timeoutOrderId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.vendor_orders
         (vendor_order_id, order_reference, checkout_group_id, vendor_location_id,
          lifecycle_state, total_minor, accept_by)
       VALUES ($1,$2,$3,$4,'PLACED',10000,$5)`,
      [
        timeoutOrderId,
        `SYNTH-ORDER-TIMEOUT-${Date.now()}`,
        placed.checkout_group_id,
        storeC.locationId,
        new Date(now.getTime() + 22_000),
      ],
    );
    const expired = await fulfilment.timeoutOverdueAccepts({
      context: systemContext(systemActorId),
      now: new Date(now.getTime() + 30_000),
    });
    check(
      expired.some((id) => id === timeoutOrderId),
      'System timeout did not expire an overdue order',
    );
    const expiredState = await fulfilment.getOrder({
      context: vendorContext(systemActorId),
      vendor_order_id: timeoutOrderId,
    });
    check(
      expiredState.lifecycle_state === 'EXPIRED' &&
        expiredState.decline_reason_code === 'ACCEPT_DEADLINE_TIMEOUT',
      'Timed-out order did not record its EXPIRED state and reason',
    );

    // 8.2 -- authorization boundary: a customer cannot call vendor routes.
    await rejects(
      () =>
        fulfilment.accept({
          context: customerContext(customerId),
          vendor_order_id: orderA.vendor_order_id,
          vendor_location_id: storeA.locationId,
          expected_version: 1,
          preparation_estimate_seconds: 900,
        }),
      FulfilmentAuthorizationError,
      'A customer was allowed to call a vendor fulfilment route',
    );

    // 8.5 -- input validation on ready.
    await rejects(
      () =>
        fulfilment.markReady({
          context: vendorContext(storeA.ownerUserId),
          vendor_order_id: orderA.vendor_order_id,
          vendor_location_id: storeA.locationId,
          expected_version: 1,
          package_count: 0,
        }),
      FulfilmentInputError,
      'Zero package count was accepted',
    );

    // Confirm the immutable event trail was written.
    const events = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.vendor_order_events WHERE vendor_order_id=$1`,
      [orderA.vendor_order_id],
    );
    check(Number(events.rows[0]?.count) >= 6, 'Fulfilment event trail is too short');
  } finally {
    await fulfilment.close();
    await checkout.close();
    await carts.close();
    await catalogue.close();
    await inventory.close();
    await access.close();
    await pool.end();
  }
}
