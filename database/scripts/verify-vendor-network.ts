import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  VendorNetworkAuthorizationError,
  VendorNetworkInputError,
  VendorNetworkService,
  VendorNetworkTransitionError,
  VendorNetworkVersionConflictError,
} from '../src/vendor-network.js';

async function expectError(
  operation: () => Promise<unknown>,
  expected: new (...arguments_: never[]) => Error,
) {
  try {
    await operation();
  } catch (error) {
    if (error instanceof expected) return;
    throw error;
  }
  throw new Error(`Expected ${expected.name}`);
}

const TABLES = `marketplace.finance_exceptions, marketplace.provider_statement_rows,
  marketplace.payouts, marketplace.settlements, marketplace.ledger_entries,
  marketplace.ledger_transactions, marketplace.refund_events, marketplace.refunds,
  marketplace.payment_events, marketplace.payment_allocations, marketplace.payment_transactions,
  marketplace.return_tasks, marketplace.custody_events,
  marketplace.assignment_events, marketplace.delivery_assignments,
  marketplace.vendor_network_events,
  marketplace.catalogue_moderation_events, marketplace.catalogue_moderation_cases,
  marketplace.catalogue_product_substitutions, marketplace.catalogue_product_images,
  marketplace.catalogue_prices, marketplace.catalogue_product_variants,
  marketplace.catalogue_import_rows, marketplace.catalogue_imports, marketplace.catalogue_products,
  marketplace.inventory_events, marketplace.inventory_reservations, marketplace.inventory_items,
  marketplace.vendor_publication_events, marketplace.vendor_publication_cases,
  marketplace.vendor_onboarding_events,
  marketplace.vendor_onboarding_appeals,
  marketplace.vendor_document_reviews,
  marketplace.vendor_verification_documents,
  marketplace.vendor_onboarding_cases,
  marketplace.vendor_location_fulfilment_modes,
  marketplace.vendor_service_zones,
  marketplace.vendor_location_temporary_closures,
  marketplace.vendor_location_calendar_exceptions,
  marketplace.vendor_location_operating_hours,
  marketplace.staff_memberships,
  marketplace.vendor_locations,
  marketplace.vendors`;

export async function verifyVendorNetwork(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, application_name: 'vendor-network-verifier' });
  const network = new VendorNetworkService({ connection_string: connectionString });
  const base = new Date('2026-08-24T04:30:00.000Z'); // Monday, 10:00 in Jaipur.
  const adminId = createUuidV7({ now_ms: base.getTime() });
  const actor = createAuthenticatedActor({
    actor_id: adminId,
    actor_kind: 'admin',
    session_id: createUuidV7({ now_ms: base.getTime() }),
  });
  const context = () => createRequestContext({ actor });
  const vendorId = createUuidV7({ now_ms: base.getTime() });
  const locationId = createUuidV7({ now_ms: base.getTime() });

  try {
    await pool.query(`TRUNCATE ${TABLES}`);
    await pool.query(
      `INSERT INTO marketplace.users (user_id, created_at, updated_at)
       VALUES ($1,$2,$2) ON CONFLICT (user_id) DO NOTHING`,
      [adminId, base],
    );

    await expectError(
      () =>
        network.createVendor({
          business_name: 'Real-looking vendor',
          context: context(),
          vendor_id: createUuidV7(),
        }),
      VendorNetworkInputError,
    );

    const vendor = await network.createVendor({
      business_name: 'SYNTH Jaipur Produce Cooperative',
      context: context(),
      now: base,
      profile_description: 'Synthetic fruit and vegetable marketplace test vendor.',
      vendor_id: vendorId,
    });
    if (vendor.lifecycle_state !== 'DRAFT' || vendor.version !== 1) {
      throw new Error('Vendor aggregate was not created in a versioned draft state');
    }

    const activeVendor = await network.transitionVendor({
      context: context(),
      expected_version: 1,
      now: base,
      reason_code: 'SYNTHETIC_APPROVAL',
      to_state: 'ACTIVE',
      vendor_id: vendorId,
    });
    if (activeVendor.version !== 2 || activeVendor.lifecycle_state !== 'ACTIVE') {
      throw new Error('Vendor lifecycle transition was not versioned');
    }
    await expectError(
      () =>
        network.transitionVendor({
          context: context(),
          expected_version: 2,
          reason_code: 'INVALID_REOPEN',
          to_state: 'DRAFT',
          vendor_id: vendorId,
        }),
      VendorNetworkTransitionError,
    );

    const location = await network.createLocation({
      category: 'FRUIT_VEGETABLE',
      context: context(),
      latitude: 26.9124,
      location_name: 'SYNTH Vaishali Nagar Fruit Hub',
      longitude: 75.7873,
      minimum_order_minor: 15_000,
      now: base,
      operating_timezone: 'Asia/Kolkata',
      preparation_seconds: 1_200,
      profile_description: 'Synthetic location serving Jaipur test postcodes.',
      vendor_id: vendorId,
      vendor_location_id: locationId,
    });
    if (
      location.currency !== 'INR' ||
      location.minimum_order_minor !== 15_000 ||
      location.preparation_seconds !== 1_200 ||
      location.operating_timezone !== 'Asia/Kolkata'
    ) {
      throw new Error(
        'Vendor location profile, money, timezone, or preparation settings were lost',
      );
    }

    let version = await network.replaceOperatingHours({
      context: context(),
      expected_version: 1,
      now: base,
      vendor_location_id: locationId,
      windows: [
        { weekday: 1, opens_at: '09:00', closes_at: '13:00' },
        { weekday: 1, opens_at: '16:00', closes_at: '20:00' },
        { weekday: 2, opens_at: '09:00', closes_at: '20:00' },
        { weekday: 3, opens_at: '09:00', closes_at: '20:00' },
      ],
    });
    if (version !== 2) throw new Error('Operating-hour replacement did not advance the aggregate');
    let directOverlapRejected = false;
    try {
      await pool.query(
        `INSERT INTO marketplace.vendor_location_operating_hours
        (operating_hour_id, vendor_location_id, weekday, opens_at, closes_at)
        VALUES ($1,$2,1,'12:00','14:00')`,
        [createUuidV7(), locationId],
      );
    } catch (error: unknown) {
      directOverlapRejected =
        typeof error === 'object' && error !== null && 'code' in error && error.code === '23514';
    }
    if (!directOverlapRejected) throw new Error('Database accepted overlapping operating hours');

    version = await network.setCalendarException({
      context: context(),
      exception_kind: 'CLOSED',
      expected_version: version,
      local_date: '2026-08-25',
      now: base,
      reason_code: 'SYNTHETIC_HOLIDAY',
      vendor_location_id: locationId,
    });
    version = await network.addTemporaryClosure({
      context: context(),
      ends_at: new Date('2026-08-26T07:00:00.000Z'),
      expected_version: version,
      now: base,
      reason_code: 'SYNTHETIC_MAINTENANCE',
      starts_at: new Date('2026-08-26T03:30:00.000Z'),
      temporary_closure_id: createUuidV7(),
      vendor_location_id: locationId,
    });

    version = await network.addServiceZone({
      boundary: {
        type: 'Polygon',
        coordinates: [
          [
            [75.7, 26.84],
            [75.88, 26.84],
            [75.88, 27.0],
            [75.7, 27.0],
            [75.7, 26.84],
          ],
        ],
      },
      context: context(),
      expected_version: version,
      now: base,
      operating_timezone: 'Asia/Kolkata',
      service_zone_id: createUuidV7(),
      vendor_location_id: locationId,
      zone_name: 'SYNTH Jaipur Core Zone',
    });

    await expectError(
      () =>
        network.replaceApprovedFulfilmentModes({
          context: createRequestContext(),
          expected_version: version,
          modes: ['CUSTOMER_PICKUP'],
          vendor_location_id: locationId,
        }),
      VendorNetworkAuthorizationError,
    );
    version = await network.replaceApprovedFulfilmentModes({
      context: context(),
      expected_version: version,
      modes: ['CUSTOMER_PICKUP', 'PLATFORM_DELIVERY'],
      now: base,
      vendor_location_id: locationId,
    });
    const activeLocation = await network.transitionLocation({
      context: context(),
      expected_version: version,
      now: base,
      reason_code: 'SYNTHETIC_APPROVAL',
      to_state: 'ACTIVE',
      vendor_location_id: locationId,
    });
    version = activeLocation.version;

    const open = await network.getOperationalStatus({
      at: new Date('2026-08-24T04:30:00.000Z'),
      latitude: 26.92,
      longitude: 75.8,
      vendor_location_id: locationId,
    });
    if (!open.open || open.reason !== 'OPEN' || open.approved_fulfilment_modes.length !== 2) {
      throw new Error('Active location did not report honest open status and approved modes');
    }
    const holiday = await network.getOperationalStatus({
      at: new Date('2026-08-25T04:30:00.000Z'),
      vendor_location_id: locationId,
    });
    if (holiday.reason !== 'CALENDAR_CLOSED')
      throw new Error('Holiday closure did not override hours');
    const temporary = await network.getOperationalStatus({
      at: new Date('2026-08-26T04:30:00.000Z'),
      vendor_location_id: locationId,
    });
    if (temporary.reason !== 'TEMPORARILY_CLOSED')
      throw new Error('Temporary closure did not override hours');
    const outside = await network.getOperationalStatus({
      at: new Date('2026-08-24T04:30:00.000Z'),
      latitude: 28.61,
      longitude: 77.2,
      vendor_location_id: locationId,
    });
    if (outside.reason !== 'OUTSIDE_SERVICE_ZONE')
      throw new Error('Out-of-zone customer was serviceable');

    await expectError(
      () =>
        network.updateLocationProfile({
          context: context(),
          expected_version: version - 1,
          location_name: 'SYNTH Stale Location',
          minimum_order_minor: 1,
          preparation_seconds: 300,
          vendor_location_id: locationId,
        }),
      VendorNetworkVersionConflictError,
    );

    let appendOnlyRejected = false;
    try {
      await pool.query(
        `UPDATE marketplace.vendor_network_events SET reason_code='TAMPERED'
        WHERE aggregate_id=$1`,
        [locationId],
      );
    } catch (error: unknown) {
      appendOnlyRejected =
        typeof error === 'object' && error !== null && 'code' in error && error.code === '55000';
    }
    if (!appendOnlyRejected) throw new Error('Vendor-network history was mutable');

    const evidence = await pool.query<{ events: string; zones: string }>(
      `SELECT
      (SELECT count(*)::text FROM marketplace.vendor_network_events WHERE aggregate_id=$1) AS events,
      (SELECT count(*)::text FROM marketplace.vendor_service_zones WHERE vendor_location_id=$1) AS zones`,
      [locationId],
    );
    if (Number(evidence.rows[0]?.events) !== version || evidence.rows[0]?.zones !== '1') {
      throw new Error('Vendor-location event history or zone evidence is incomplete');
    }
  } finally {
    await pool.query(`TRUNCATE ${TABLES}`).catch(() => undefined);
    await network.close();
    await pool.end();
  }
}
