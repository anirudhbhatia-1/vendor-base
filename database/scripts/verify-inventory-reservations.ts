import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  InventoryConflictError,
  InventoryReservationService,
  InventoryUnavailableError,
} from '../src/inventory-reservations.js';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function context(kind: 'customer' | 'system' | 'vendor_staff') {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: createUuidV7(),
      actor_kind: kind,
      session_id: createUuidV7(),
    }),
  });
}

export async function verifyInventoryReservations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const service = new InventoryReservationService({ connection_string: connectionString });
  const vendorId = createUuidV7();
  const locationId = createUuidV7();
  const siblingLocationId = createUuidV7();
  const countedId = createUuidV7();
  const confirmsId = createUuidV7();
  const now = new Date('2026-08-24T08:00:00.000Z');
  try {
    await pool.query(
      `INSERT INTO marketplace.vendors
        (vendor_id,business_name,profile_description,lifecycle_state,request_id,correlation_id)
       VALUES ($1,'SYNTH Inventory Verification','Synthetic inventory test vendor','ACTIVE',$2,$2)`,
      [vendorId, createUuidV7()],
    );
    for (const [id, name] of [
      [locationId, 'SYNTH Inventory Store'],
      [siblingLocationId, 'SYNTH Sibling Store'],
    ] as const) {
      await pool.query(
        `INSERT INTO marketplace.vendor_locations
          (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
           coordinates,category,lifecycle_state,request_id,correlation_id)
         VALUES ($1,$2,$3,'Synthetic inventory location','Asia/Kolkata',
           ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,
           'FRUIT_VEGETABLE','ACTIVE',$4,$4)`,
        [id, vendorId, name, createUuidV7()],
      );
    }

    const staffContext = context('vendor_staff');
    const counted = await service.createItem({
      context: staffContext,
      display_name: 'SYNTH Jaipur Tomato',
      exact_available_quantity: 5,
      inventory_item_id: countedId,
      low_stock_threshold: 2,
      now,
      product_reference: 'SYNTH-PROD-TOMATO-0001',
      quantity_basis: 'COUNTED',
      reason_code: 'SYNTH_STOCK_CREATED',
      vendor_location_id: locationId,
    });
    check(counted.availability_state === 'AVAILABLE', 'Counted stock did not start available');

    const customerContext = context('customer');
    const concurrent = await Promise.allSettled([
      service.softHold({
        context: customerContext,
        expires_at: new Date(now.getTime() + 5 * 60_000),
        inventory_item_id: countedId,
        now,
        quantity: 4,
        reason_code: 'CHECKOUT_SOFT_HOLD',
        source_reference: 'SYNTH-CHECKOUT-CONCURRENT-A001',
      }),
      service.softHold({
        context: customerContext,
        expires_at: new Date(now.getTime() + 5 * 60_000),
        inventory_item_id: countedId,
        now,
        quantity: 4,
        reason_code: 'CHECKOUT_SOFT_HOLD',
        source_reference: 'SYNTH-CHECKOUT-CONCURRENT-B001',
      }),
    ]);
    const successful = concurrent.find(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof service.softHold>>> =>
        result.status === 'fulfilled',
    );
    const rejected = concurrent.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    check(successful, 'Concurrent counted hold did not produce one winner');
    check(
      rejected?.reason instanceof InventoryUnavailableError,
      'Concurrent counted hold did not reject over-reservation',
    );
    const afterHold = await service.listLocation({
      context: staffContext,
      vendor_location_id: locationId,
    });
    check(
      afterHold.find((item) => item.inventory_item_id === countedId)?.exact_available_quantity ===
        1,
      'Counted hold did not atomically reduce exact availability',
    );

    const replay = await service.softHold({
      context: customerContext,
      expires_at: new Date(now.getTime() + 5 * 60_000),
      inventory_item_id: countedId,
      now,
      quantity: 4,
      reason_code: 'CHECKOUT_SOFT_HOLD',
      source_reference: successful.value.source_reference,
    });
    check(
      replay.reservation_id === successful.value.reservation_id,
      'Hold retry was not idempotent',
    );

    const provisional = await service.provisional({
      context: customerContext,
      expected_version: successful.value.version,
      expires_at: new Date(now.getTime() + 20 * 60_000),
      now: new Date(now.getTime() + 60_000),
      reason_code: 'ORDER_PLACED',
      reservation_id: successful.value.reservation_id,
    });
    const committed = await service.commit({
      context: staffContext,
      expected_version: provisional.version,
      now: new Date(now.getTime() + 2 * 60_000),
      reason_code: 'VENDOR_ACCEPTED',
      reservation_id: provisional.reservation_id,
    });
    check(committed.reservation_state === 'COMMITTED', 'Provisional stock did not commit');
    const released = await service.release({
      context: staffContext,
      expected_version: committed.version,
      now: new Date(now.getTime() + 3 * 60_000),
      reason_code: 'ORDER_CANCELLED',
      reservation_id: committed.reservation_id,
    });
    check(released.reservation_state === 'RELEASED', 'Committed stock did not release');
    const afterRelease = await service.listLocation({
      context: staffContext,
      vendor_location_id: locationId,
    });
    check(
      afterRelease.find((item) => item.inventory_item_id === countedId)
        ?.exact_available_quantity === 5,
      'Release did not restore counted availability exactly once',
    );

    const expiring = await service.softHold({
      context: customerContext,
      expires_at: new Date(now.getTime() + 60_000),
      inventory_item_id: countedId,
      now,
      quantity: 2,
      reason_code: 'CHECKOUT_SOFT_HOLD',
      source_reference: 'SYNTH-CHECKOUT-EXPIRY-A001',
    });
    const expired = await service.expireDue({
      context: context('system'),
      now: new Date(now.getTime() + 2 * 60_000),
    });
    check(
      expired.some((reservation) => reservation.reservation_id === expiring.reservation_id),
      'Server-time expiry did not close the due hold',
    );
    const afterExpiry = await service.listLocation({
      context: staffContext,
      vendor_location_id: locationId,
    });
    check(
      afterExpiry.find((item) => item.inventory_item_id === countedId)?.exact_available_quantity ===
        5,
      'Expiry did not restore counted availability',
    );

    const confirms = await service.createItem({
      context: staffContext,
      display_name: 'SYNTH Seasonal Coriander',
      inventory_item_id: confirmsId,
      now,
      product_reference: 'SYNTH-PROD-CORIANDER-0001',
      quantity_basis: 'VENDOR_CONFIRMS',
      reason_code: 'SYNTH_STOCK_CREATED',
      vendor_location_id: locationId,
    });
    const confirmsHold = await service.softHold({
      context: customerContext,
      expires_at: new Date(now.getTime() + 5 * 60_000),
      inventory_item_id: confirmsId,
      now,
      quantity: 3,
      reason_code: 'CHECKOUT_INTENT_RECORDED',
      source_reference: 'SYNTH-CHECKOUT-CONFIRMS-A001',
    });
    check(
      !confirmsHold.counted_stock_applied && confirms.exact_available_quantity === null,
      'Vendor-confirms intent pretended to reserve exact stock',
    );
    let exactResetRejected = false;
    try {
      await service.setCountedStock({
        context: staffContext,
        exact_available_quantity: 10,
        expected_version: confirms.version + 1,
        inventory_item_id: confirmsId,
        low_stock_threshold: 2,
        now,
        reason_code: 'MANUAL_COUNT',
        vendor_location_id: locationId,
      });
    } catch (error) {
      exactResetRejected = error instanceof InventoryConflictError;
    }
    check(exactResetRejected, 'Vendor-confirms inventory accepted an exact count');

    const sibling = await service.listLocation({
      context: staffContext,
      vendor_location_id: siblingLocationId,
    });
    check(sibling.length === 0, 'Sibling-location inventory was not contained');

    let historyProtected = false;
    try {
      await pool.query("UPDATE marketplace.inventory_events SET reason_code='TAMPERED'");
    } catch {
      historyProtected = true;
    }
    check(historyProtected, 'Inventory history was not append-only');
  } finally {
    await service.close();
    await pool
      .query(
        'TRUNCATE marketplace.catalogue_moderation_events, marketplace.catalogue_moderation_cases, marketplace.inventory_events, marketplace.inventory_reservations, marketplace.inventory_items',
      )
      .catch(() => undefined);
    await pool
      .query('DELETE FROM marketplace.vendor_locations WHERE vendor_id=$1', [vendorId])
      .catch(() => undefined);
    await pool
      .query('DELETE FROM marketplace.vendors WHERE vendor_id=$1', [vendorId])
      .catch(() => undefined);
    await pool.end();
  }
}
