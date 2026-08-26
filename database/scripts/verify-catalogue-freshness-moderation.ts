import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { CatalogueFreshnessModerationService } from '../src/catalogue-freshness-moderation.js';
import { InventoryReservationService } from '../src/inventory-reservations.js';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function context(kind: 'admin' | 'vendor_staff') {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: createUuidV7(),
      actor_kind: kind,
      session_id: createUuidV7(),
    }),
  });
}

export async function verifyCatalogueFreshnessModeration(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const inventory = new InventoryReservationService({ connection_string: connectionString });
  const catalogue = new CatalogueFreshnessModerationService({
    connection_string: connectionString,
  });
  const vendorId = createUuidV7();
  const locationA = createUuidV7();
  const locationB = createUuidV7();
  const freshId = createUuidV7();
  const staleId = createUuidV7();
  const now = new Date('2026-08-24T12:00:00.000Z');
  try {
    await pool.query(
      `INSERT INTO marketplace.vendors
        (vendor_id,business_name,profile_description,lifecycle_state,request_id,correlation_id)
       VALUES ($1,'SYNTH Freshness Vendor','Synthetic moderation test vendor','ACTIVE',$2,$2)`,
      [vendorId, createUuidV7()],
    );
    for (const [locationId, name] of [
      [locationA, 'SYNTH Freshness Store'],
      [locationB, 'SYNTH Isolated Store'],
    ] as const) {
      await pool.query(
        `INSERT INTO marketplace.vendor_locations
          (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
           coordinates,category,lifecycle_state,request_id,correlation_id)
         VALUES ($1,$2,$3,'Synthetic availability location','Asia/Kolkata',
           ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,
           'FRUIT_VEGETABLE','ACTIVE',$4,$4)`,
        [locationId, vendorId, name, createUuidV7()],
      );
    }
    const vendor = context('vendor_staff');
    await inventory.createItem({
      context: vendor,
      display_name: 'SYNTH Fresh Tomato',
      exact_available_quantity: 12,
      inventory_item_id: freshId,
      low_stock_threshold: 2,
      now: new Date(now.getTime() - 5 * 60_000),
      product_reference: 'SYNTH-PROD-FRESH-0001',
      quantity_basis: 'COUNTED',
      reason_code: 'SYNTH_STOCK_CREATED',
      vendor_location_id: locationA,
    });
    await inventory.createItem({
      context: vendor,
      display_name: 'SYNTH Stale Coriander',
      inventory_item_id: staleId,
      now: new Date(now.getTime() - 90 * 60_000),
      product_reference: 'SYNTH-PROD-STALE-0001',
      quantity_basis: 'VENDOR_CONFIRMS',
      reason_code: 'SYNTH_STOCK_CREATED',
      vendor_location_id: locationA,
    });
    await inventory.createItem({
      context: vendor,
      display_name: 'SYNTH Other Vendor Product',
      exact_available_quantity: 7,
      low_stock_threshold: 1,
      product_reference: 'SYNTH-PROD-OTHER-0001',
      quantity_basis: 'COUNTED',
      reason_code: 'SYNTH_STOCK_CREATED',
      vendor_location_id: locationB,
    });

    const availability = await catalogue.listCustomerAvailability({
      vendor_location_id: locationA,
      now,
    });
    check(
      availability.length === 2,
      'Customer availability included another vendor or omitted a sellable item',
    );
    check(
      availability.find((item) => item.inventory_item_id === freshId)?.freshness === 'FRESH',
      'Fresh inventory was not labelled fresh',
    );
    check(
      availability.find((item) => item.inventory_item_id === staleId)?.freshness === 'EXPIRED',
      'Old vendor-confirm inventory was not labelled expired',
    );
    check(
      availability.every((item) => !('exact_available_quantity' in item)),
      'Customer availability exposed exact stock',
    );

    const admin = context('admin');
    const opened = await catalogue.openCase({
      context: admin,
      inventory_item_id: freshId,
      reason_code: 'RESTRICTED_CATEGORY',
      now,
    });
    check(opened.moderation_state === 'PENDING', 'Moderation case did not start pending');
    const queued = await catalogue.listQueue({ context: admin, state: 'PENDING' });
    check(
      queued.some((item) => item.moderation_case_id === opened.moderation_case_id),
      'Open case missing from moderation queue',
    );
    await catalogue.decideCase({
      context: admin,
      correction_reason: 'Remove the restricted catalogue claim and resubmit.',
      expected_version: opened.version,
      moderation_case_id: opened.moderation_case_id,
      moderation_state: 'CORRECTION_REQUIRED',
      reason_code: 'INVALID_PRODUCT_CLAIM',
      now,
    });
    const afterCorrection = await catalogue.listCustomerAvailability({
      vendor_location_id: locationA,
      now,
    });
    check(
      !afterCorrection.some((item) => item.inventory_item_id === freshId),
      'Correction-required item remained customer-visible',
    );
    check(
      afterCorrection.some((item) => item.inventory_item_id === staleId),
      'Moderation hid an unrelated item',
    );
    const events = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM marketplace.catalogue_moderation_events WHERE moderation_case_id=$1',
      [opened.moderation_case_id],
    );
    check(
      events.rows[0]?.count === '2',
      'Moderation decision did not preserve opening and decision evidence',
    );
  } finally {
    await catalogue.close();
    await inventory.close();
    await pool.end();
  }
}
