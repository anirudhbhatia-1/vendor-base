import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { CatalogueProductService } from '../src/catalogue-products.js';
import {
  CustomerCartConflictError,
  CustomerCartFulfilmentMethodError,
  CustomerCartNotFoundError,
  CustomerCartService,
  DEFAULT_CART_GROUP_LIMIT,
} from '../src/customer-cart.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';
import { check, rejects, vendorContext } from './verify-support.js';

function context(userId: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: userId,
      actor_kind: 'customer',
      session_id: createUuidV7(),
    }),
  });
}
const jaipur = { latitude: 26.91, longitude: 75.81 };

async function makeProduct(
  catalogue: CatalogueProductService,
  ownerUserId: UuidV7,
  locationId: UuidV7,
  suffix: string,
  now: Date,
) {
  return catalogue.createProduct({
    context: vendorContext(ownerUserId),
    vendor_location_id: locationId,
    product_reference: `SYNTH-PROD-CART${suffix}`,
    title: `SYNTH Cart Product ${suffix}`,
    category: 'FRUIT_VEGETABLE',
    unit_label: 'CRATE',
    tax_basis: 'EXEMPT',
    variable_weight: false,
    sku: `SYNTH-SKU-CART${suffix}`,
    variant_title: `SYNTH Cart Product ${suffix} Variant`,
    price_minor: 10000,
    now,
  });
}

export async function verifyCustomerCart(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const cart = new CustomerCartService({ connection_string: connectionString });
  const catalogue = new CatalogueProductService({ connection_string: connectionString });
  const customerId = createUuidV7();
  const now = new Date('2026-08-26T11:00:00.000Z');
  try {
    await pool.query(
      "INSERT INTO marketplace.users (user_id, state, data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
      [customerId],
    );
    const stores = await Promise.all(
      ['A', 'B', 'C', 'D'].map((suffix) =>
        createDiscoverableStoreFixture(pool, {
          location_name: `SYNTH Cart Store ${suffix}`,
          latitude: jaipur.latitude + Number(`0.0${suffix.charCodeAt(0) - 65}`),
          longitude: jaipur.longitude,
        }),
      ),
    );
    const products = await Promise.all(
      stores.map((store, index) =>
        makeProduct(catalogue, store.ownerUserId, store.locationId, String(index), now),
      ),
    );
    const [stores0, stores1] = stores;
    check(stores0 !== undefined && stores1 !== undefined, 'Fixture stores missing');

    const address = await pool.query<{ customer_address_id: string }>(
      `INSERT INTO marketplace.customer_addresses
         (customer_address_id,user_id,address_reference,label,pin_code,coordinates,request_id,correlation_id)
       VALUES ($1,$2,'SYNTH-ADDRESS-CART','SYNTH Cart Home','302001',
         ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,$5,$5)
       RETURNING customer_address_id`,
      [createUuidV7(), customerId, jaipur.longitude, jaipur.latitude, createUuidV7()],
    );
    const addressId = address.rows[0]?.customer_address_id as UuidV7;
    check(typeof addressId === 'string', 'Fixture address was not created');

    // 1. The customer has exactly one active cart, created on first access.
    const initial = await cart.currentCart({ context: context(customerId), now });
    check(
      initial.lifecycle_state === 'ACTIVE' && initial.groups.length === 0,
      'A new cart was not empty and active',
    );
    const again = await cart.currentCart({ context: context(customerId), now });
    check(again.cart_id === initial.cart_id, 'A second lookup created a new cart');

    // 2. Adding lines from two stores creates two vendor groups.
    await cart.setCartAddress({
      context: context(customerId),
      customer_address_id: addressId,
      now,
    });
    const [productA, productB] = products;
    check(productA !== undefined && productB !== undefined, 'Fixture products missing');
    await cart.addLine({
      context: context(customerId),
      vendor_location_id: stores0.locationId,
      catalogue_variant_id: productA.catalogue_variant_id,
      quantity: 2,
      now,
    });
    const afterSecondStore = await cart.addLine({
      context: context(customerId),
      vendor_location_id: stores1.locationId,
      catalogue_variant_id: productB.catalogue_variant_id,
      quantity: 1,
      now,
    });
    check(
      afterSecondStore.groups.length === 2,
      'Adding a second store did not create a second group',
    );

    // 3. Adding the same variant again to the same group merges quantity
    // rather than creating a duplicate line.
    const merged = await cart.addLine({
      context: context(customerId),
      vendor_location_id: stores0.locationId,
      catalogue_variant_id: productA.catalogue_variant_id,
      quantity: 3,
      now,
    });
    const groupA = merged.groups.find((g) => g.vendor_location_id === stores0.locationId);
    check(
      groupA?.lines.length === 1 && groupA.lines[0]?.quantity === 5,
      'Re-adding a variant did not merge quantity',
    );

    // 4. The configured group ceiling (default three) is enforced against
    // distinct vendor locations.
    const [, , storeC, storeD] = stores;
    const [, , productC, productD] = products;
    check(storeC && storeD && productC && productD, 'Fixture stores/products missing');
    const limit = await cart.cartGroupLimit();
    check(limit === DEFAULT_CART_GROUP_LIMIT, 'The default cart group limit is not three');
    await cart.addLine({
      context: context(customerId),
      vendor_location_id: storeC.locationId,
      catalogue_variant_id: productC.catalogue_variant_id,
      quantity: 1,
      now,
    });
    await rejects(
      () =>
        cart.addLine({
          context: context(customerId),
          vendor_location_id: storeD.locationId,
          catalogue_variant_id: productD.catalogue_variant_id,
          quantity: 1,
          now,
        }),
      CustomerCartConflictError,
      'A fourth vendor group was accepted past the configured ceiling',
    );

    // 5. Quantity change is optimistic; removing the last line removes the group.
    const beforeRemoval = await cart.currentCart({ context: context(customerId), now });
    const lineB = beforeRemoval.groups.find((g) => g.vendor_location_id === stores1.locationId)
      ?.lines[0];
    check(lineB !== undefined, 'The second-store line was not found');
    const updated = await cart.setLineQuantity({
      context: context(customerId),
      cart_line_id: lineB.cart_line_id,
      expected_version: lineB.version,
      quantity: 4,
      now,
    });
    const groupBAfterUpdate = updated.groups.find(
      (g) => g.vendor_location_id === stores1.locationId,
    );
    check(groupBAfterUpdate?.lines[0]?.quantity === 4, 'Quantity change did not apply');
    await rejects(
      () =>
        cart.setLineQuantity({
          context: context(customerId),
          cart_line_id: lineB.cart_line_id,
          expected_version: lineB.version,
          quantity: 9,
          now,
        }),
      CustomerCartNotFoundError,
      'A stale expected version was allowed to change quantity',
    );
    const afterRemoval = await cart.removeLine({
      context: context(customerId),
      cart_line_id: lineB.cart_line_id,
      now,
    });
    check(
      !afterRemoval.groups.some((g) => g.vendor_location_id === stores1.locationId),
      'Removing the only line in a group left an empty group behind',
    );
    check(afterRemoval.groups.length === 2, 'Removing one group changed sibling groups');

    // 5b. The removed store can be added back. Its group row survives removal as
    // REMOVED under the (cart, location) unique key, so re-adding revives it -- this
    // was a duplicate-key failure -- and the quantity starts over rather than
    // adding to the removed line's last count (4).
    const readded = await cart.addLine({
      context: context(customerId),
      vendor_location_id: stores1.locationId,
      catalogue_variant_id: lineB.catalogue_variant_id,
      quantity: 1,
      now,
    });
    const revivedGroup = readded.groups.find((g) => g.vendor_location_id === stores1.locationId);
    check(revivedGroup !== undefined, 'A removed store could not be added back to the cart');
    check(revivedGroup.lifecycle_state === 'ACTIVE', 'A re-added store is not ACTIVE');
    check(revivedGroup.lines.length === 1, 'A re-added store did not start with one line');
    check(
      revivedGroup.lines[0]?.quantity === 1,
      `A re-added line kept the removed quantity (got ${revivedGroup.lines[0]?.quantity})`,
    );
    const afterRemovalAgain = await cart.removeLine({
      context: context(customerId),
      cart_line_id: revivedGroup.lines[0].cart_line_id,
      now,
    });
    check(
      afterRemovalAgain.groups.length === 2,
      'Removing the re-added store changed sibling groups',
    );

    // 6. A stranger cannot act on this customer's lines.
    const strangerId = createUuidV7();
    await pool.query(
      "INSERT INTO marketplace.users (user_id, state, data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
      [strangerId],
    );
    const strangerCart = await cart.currentCart({ context: context(strangerId), now });
    check(strangerCart.cart_id !== afterRemoval.cart_id, 'Two customers shared one cart');
    const survivingLine = afterRemoval.groups[0]?.lines[0];
    check(survivingLine !== undefined, 'No surviving line to test isolation against');
    await rejects(
      () =>
        cart.setLineQuantity({
          context: context(strangerId),
          cart_line_id: survivingLine.cart_line_id,
          expected_version: survivingLine.version,
          quantity: 1,
          now,
        }),
      CustomerCartNotFoundError,
      'A stranger changed another customer cart line',
    );

    // 7. Revalidation isolates one closed store; sibling groups survive.
    await pool.query(
      "UPDATE marketplace.vendor_locations SET lifecycle_state='CLOSED' WHERE vendor_location_id=$1",
      [stores0.locationId],
    );
    const outcomes = await cart.revalidate({ context: context(customerId), now });
    const closedOutcome = outcomes.find((o) => o.vendor_location_id === stores0.locationId);
    check(
      closedOutcome?.invalidated === true,
      'Revalidation did not invalidate the closed store group',
    );
    const cleanOutcome = outcomes.find((o) => o.vendor_location_id === storeC.locationId);
    check(
      cleanOutcome?.invalidated === false,
      'Revalidation invalidated an unrelated healthy group',
    );
    const revalidated = await cart.currentCart({ context: context(customerId), now });
    const invalidGroup = revalidated.groups.find(
      (g) => g.vendor_location_id === stores0.locationId,
    );
    const healthyGroup = revalidated.groups.find((g) => g.vendor_location_id === storeC.locationId);
    check(
      invalidGroup?.lifecycle_state === 'INVALID',
      'The closed-store group was not marked invalid',
    );
    check(
      healthyGroup?.lifecycle_state === 'ACTIVE',
      'A closed store invalidated a valid sibling group',
    );
    check(
      healthyGroup.lines.every((line) => line.lifecycle_state === 'ACTIVE'),
      'A closed store marked a sibling group line stale',
    );
    await pool.query(
      "UPDATE marketplace.vendor_locations SET lifecycle_state='ACTIVE' WHERE vendor_location_id=$1",
      [stores0.locationId],
    );

    // 8. Cart items are never represented as reserved inventory: adding and
    // removing lines never touches inventory_items or its reservations.
    const inventoryBefore = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM marketplace.inventory_reservations',
    );
    check(inventoryBefore.rows[0]?.count === '0', 'Cart activity created an inventory reservation');

    // 9. Every mutation left append-only audit evidence.
    const events = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM marketplace.cart_events WHERE cart_id=$1',
      [afterRemoval.cart_id],
    );
    check(
      Number(events.rows[0]?.count ?? '0') >= 6,
      'Cart mutations did not leave sufficient audit evidence',
    );

    // 10. CUS-33: a group receives its order in a way the store offers. A
    // fresh customer, so the group limit and the invalidated store above cannot
    // interfere. Store E collects only; store D (index 3) delivers only.
    const collectorId = createUuidV7();
    await pool.query(
      "INSERT INTO marketplace.users (user_id, state, data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
      [collectorId],
    );
    const pickupOnly = await createDiscoverableStoreFixture(pool, {
      location_name: 'SYNTH Cart Store E Pickup Only',
      latitude: jaipur.latitude + 0.004,
      longitude: jaipur.longitude,
      fulfilment_modes: ['CUSTOMER_PICKUP'],
    });
    const pickupProduct = await makeProduct(
      catalogue,
      pickupOnly.ownerUserId,
      pickupOnly.locationId,
      'E',
      now,
    );
    const deliveryOnly = stores[3];
    const deliveryProduct = products[3];
    check(
      deliveryOnly !== undefined && deliveryProduct !== undefined,
      'Delivery-only fixture store missing',
    );

    // a. No method asked for: the group starts with one the store offers, not
    // PLATFORM_DELIVERY regardless.
    const collected = await cart.addLine({
      context: context(collectorId),
      vendor_location_id: pickupOnly.locationId,
      catalogue_variant_id: pickupProduct.catalogue_variant_id,
      quantity: 1,
      now,
    });
    const pickupGroup = collected.groups.find(
      (g) => g.vendor_location_id === pickupOnly.locationId,
    );
    check(
      pickupGroup?.fulfilment_method === 'CUSTOMER_PICKUP' &&
        pickupGroup.fulfilment_method_offered === true,
      `A pickup-only store's group did not default to collection (got ${String(pickupGroup?.fulfilment_method)})`,
    );

    // b. Asking that store for delivery is refused, with the modes it does offer,
    // and the group is left exactly as it was.
    let refusal: unknown;
    try {
      await cart.setGroupFulfilmentMethod({
        context: context(collectorId),
        cart_vendor_group_id: pickupGroup.cart_vendor_group_id,
        expected_version: pickupGroup.version,
        fulfilment_method: 'PLATFORM_DELIVERY',
        now,
      });
    } catch (error) {
      refusal = error;
    }
    check(
      refusal instanceof CustomerCartFulfilmentMethodError &&
        refusal.code === 'FULFILMENT_METHOD_UNAVAILABLE' &&
        refusal.offered_modes.length === 1 &&
        refusal.offered_modes[0] === 'CUSTOMER_PICKUP',
      `Delivery from a pickup-only store was not refused as FULFILMENT_METHOD_UNAVAILABLE (raised ${String(refusal)})`,
    );
    const unchanged = (await cart.currentCart({ context: context(collectorId), now })).groups.find(
      (g) => g.vendor_location_id === pickupOnly.locationId,
    );
    check(
      unchanged?.fulfilment_method === 'CUSTOMER_PICKUP' &&
        unchanged.version === pickupGroup.version,
      'A refused fulfilment method still changed the group',
    );

    // c. Asking for collection while creating a group at a delivery-only store
    // is refused before any group exists.
    await rejects(
      () =>
        cart.addLine({
          context: context(collectorId),
          vendor_location_id: deliveryOnly.locationId,
          catalogue_variant_id: deliveryProduct.catalogue_variant_id,
          quantity: 1,
          fulfilment_method: 'CUSTOMER_PICKUP',
          now,
        }),
      CustomerCartFulfilmentMethodError,
      'Collection from a delivery-only store was accepted at group creation',
    );
    const afterRefusedAdd = await cart.currentCart({ context: context(collectorId), now });
    check(
      afterRefusedAdd.groups.every((g) => g.vendor_location_id !== deliveryOnly.locationId),
      'A refused add still created a vendor group',
    );

    // d. A mode withdrawn after the group chose it is reported, not hidden: the
    // projection says the method is no longer offered so the customer can repair
    // it, and the quote (verify-grouped-checkout) blocks the group meanwhile.
    await pool.query(
      `DELETE FROM marketplace.vendor_location_fulfilment_modes
        WHERE vendor_location_id=$1 AND fulfilment_mode='CUSTOMER_PICKUP'`,
      [pickupOnly.locationId],
    );
    const withdrawn = (await cart.currentCart({ context: context(collectorId), now })).groups.find(
      (g) => g.vendor_location_id === pickupOnly.locationId,
    );
    check(
      withdrawn?.fulfilment_method_offered === false &&
        !withdrawn.fulfilment_modes.includes('CUSTOMER_PICKUP'),
      'A withdrawn fulfilment mode was still reported as offered',
    );
  } finally {
    await cart.close();
    await catalogue.close();
    await pool.end();
  }
}
