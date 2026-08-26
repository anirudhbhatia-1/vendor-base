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
  CustomerCartNotFoundError,
  CustomerCartService,
  DEFAULT_CART_GROUP_LIMIT,
} from '../src/customer-cart.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function context(userId: UuidV7) {
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
async function rejects(work: () => Promise<unknown>, kind: new () => Error, message: string) {
  try {
    await work();
  } catch (error) {
    check(error instanceof kind, `${message} (raised ${String(error)})`);
    return;
  }
  throw new Error(message);
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
  } finally {
    await cart.close();
    await catalogue.close();
    await pool.end();
  }
}
