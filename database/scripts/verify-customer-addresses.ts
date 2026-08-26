import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  CustomerAddressAuthorizationError,
  CustomerAddressConflictError,
  CustomerAddressInputError,
  CustomerAddressNotFoundError,
  CustomerAddressService,
  DEFAULT_SAVED_ADDRESS_LIMIT,
} from '../src/customer-addresses.js';

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
async function rejects(work: () => Promise<unknown>, kind: new () => Error, message: string) {
  try {
    await work();
  } catch (error) {
    check(error instanceof kind, `${message} (raised ${String(error)})`);
    return;
  }
  throw new Error(message);
}

// Inside the zone below; the far point sits outside it.
const inside = { latitude: 26.91, longitude: 75.81 };
const outside = { latitude: 19.076, longitude: 72.8777 };

export async function verifyCustomerAddresses(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const addresses = new CustomerAddressService({ connection_string: connectionString });
  const customerA = createUuidV7();
  const customerB = createUuidV7();
  const vendorId = createUuidV7();
  const locationId = createUuidV7();
  const now = new Date('2026-08-26T09:00:00.000Z');
  try {
    for (const userId of [customerA, customerB]) {
      await pool.query(
        `INSERT INTO marketplace.users (user_id, state, data_classification)
         VALUES ($1,'ACTIVE','RESTRICTED')`,
        [userId],
      );
    }
    await pool.query(
      `INSERT INTO marketplace.vendors
        (vendor_id,business_name,profile_description,lifecycle_state,request_id,correlation_id)
       VALUES ($1,'SYNTH Address Vendor','Synthetic address test vendor','ACTIVE',$2,$2)`,
      [vendorId, createUuidV7()],
    );
    await pool.query(
      `INSERT INTO marketplace.vendor_locations
        (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
         coordinates,category,lifecycle_state,request_id,correlation_id)
       VALUES ($1,$2,'SYNTH Address Store','Synthetic address location','Asia/Kolkata',
         ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,
         'FRUIT_VEGETABLE','ACTIVE',$3,$3)`,
      [locationId, vendorId, createUuidV7()],
    );
    await pool.query(
      `INSERT INTO marketplace.vendor_service_zones
        (service_zone_id,vendor_location_id,zone_name,operating_timezone,boundary,
         lifecycle_state,request_id,correlation_id)
       VALUES ($1,$2,'SYNTH Jaipur Central Zone','Asia/Kolkata',
         ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((75.70 26.80, 75.95 26.80, 75.95 27.00, 75.70 27.00, 75.70 26.80)))'),4326)::geography,
         'ACTIVE',$3,$3)`,
      [createUuidV7(), locationId, createUuidV7()],
    );

    // 1. The first saved address is created and auto-selected.
    const first = await addresses.createAddress({
      context: context(customerA),
      address_reference: 'SYNTH-ADDRESS-HOME',
      label: 'SYNTH Home',
      pin_code: '302001',
      ...inside,
      landmark: 'Near the synthetic park',
      delivery_instructions: 'Ring the synthetic bell twice',
      now,
    });
    check(first.is_selected, 'The first saved address was not auto-selected');
    check(first.version === 1, 'A new address did not start at version one');
    check(
      first.latitude > 26.9 && first.latitude < 26.92,
      'Stored coordinates did not round-trip through the geography column',
    );

    // 2. Both creation and auto-selection leave audit evidence.
    const created = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM marketplace.customer_address_events
        WHERE customer_address_id=$1 ORDER BY occurred_at, event_type`,
      [first.customer_address_id],
    );
    check(
      created.rows.map((row) => row.event_type).join(',') === 'CREATED,SELECTED',
      'Address creation did not record both creation and selection evidence',
    );

    // 3. The configurable ceiling defaults to four and is enforced.
    const limit = await addresses.savedAddressLimit(now);
    check(limit === DEFAULT_SAVED_ADDRESS_LIMIT, 'The default saved-address limit is not four');
    for (const suffix of ['WORK', 'GYMX', 'CLUB']) {
      await addresses.createAddress({
        context: context(customerA),
        address_reference: `SYNTH-ADDRESS-${suffix}`,
        label: `SYNTH ${suffix} Address`,
        pin_code: '302001',
        ...inside,
        now,
      });
    }
    await rejects(
      () =>
        addresses.createAddress({
          context: context(customerA),
          address_reference: 'SYNTH-ADDRESS-EXTRA',
          label: 'SYNTH Extra Address',
          pin_code: '302001',
          ...inside,
          now,
        }),
      CustomerAddressConflictError,
      'A fifth saved address was accepted past the configured ceiling',
    );

    // 4. Exactly one address stays selected as the choice moves.
    const list = await addresses.listAddresses({ context: context(customerA) });
    check(list.length === 4, 'The customer did not keep four active addresses');
    const work = list.find((row) => row.address_reference === 'SYNTH-ADDRESS-WORK');
    check(work !== undefined, 'The work address was not listed');
    await addresses.selectAddress({
      context: context(customerA),
      customer_address_id: work.customer_address_id,
      now,
    });
    const selected = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.customer_addresses
        WHERE user_id=$1 AND is_selected`,
      [customerA],
    );
    check(selected.rows[0]?.count === '1', 'A customer ended with more than one selected address');
    const deselected = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.customer_address_events
        WHERE customer_address_id=$1 AND event_type='DESELECTED'`,
      [first.customer_address_id],
    );
    check(deselected.rows[0]?.count === '1', 'Changing the selection left no deselection evidence');

    // 5. Editing is optimistic; a stale version cannot win.
    const edited = await addresses.updateAddress({
      context: context(customerA),
      customer_address_id: first.customer_address_id,
      expected_version: first.version,
      label: 'SYNTH Home Renamed',
      pin_code: '302002',
      ...inside,
      landmark: 'Near the synthetic park',
      delivery_instructions: 'Ring the synthetic bell twice',
      now,
    });
    check(edited.version === 2, 'Editing an address did not advance its version');
    await rejects(
      () =>
        addresses.updateAddress({
          context: context(customerA),
          customer_address_id: first.customer_address_id,
          expected_version: first.version,
          label: 'SYNTH Home Stale',
          pin_code: '302003',
          ...inside,
          now,
        }),
      CustomerAddressNotFoundError,
      'A stale expected version was allowed to edit an address',
    );

    // 6. Removing archives rather than deletes, and releases the selection.
    const archived = await addresses.archiveAddress({
      context: context(customerA),
      customer_address_id: work.customer_address_id,
      now,
    });
    check(
      archived.lifecycle_state === 'ARCHIVED' && !archived.is_selected,
      'Archiving did not release the selection',
    );
    const surviving = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.customer_addresses
        WHERE customer_address_id=$1`,
      [work.customer_address_id],
    );
    check(surviving.rows[0]?.count === '1', 'Archiving deleted the address row');
    const activeAfter = await addresses.listAddresses({ context: context(customerA) });
    check(activeAfter.length === 3, 'An archived address stayed in the active list');
    const withArchived = await addresses.listAddresses({
      context: context(customerA),
      include_archived: true,
    });
    check(withArchived.length === 4, 'The archived address became unreachable');

    // 7. Archiving frees a slot under the ceiling.
    const replacement = await addresses.createAddress({
      context: context(customerA),
      address_reference: 'SYNTH-ADDRESS-NEWX',
      label: 'SYNTH Replacement Address',
      pin_code: '302001',
      ...inside,
      now,
    });
    check(!replacement.is_selected, 'A later address was auto-selected over an existing choice');

    // 8. Serviceability is derived from active zones.
    const eligible = await addresses.eligibleVendorLocations({
      context: context(customerA),
      customer_address_id: first.customer_address_id,
    });
    check(
      eligible.length === 1 && eligible[0] === locationId,
      'An in-zone address did not resolve its eligible vendor location',
    );
    const far = await addresses.createAddress({
      context: context(customerB),
      address_reference: 'SYNTH-ADDRESS-FARX',
      label: 'SYNTH Far Address',
      pin_code: '400001',
      ...outside,
      now,
    });
    const farEligible = await addresses.eligibleVendorLocations({
      context: context(customerB),
      customer_address_id: far.customer_address_id,
    });
    check(farEligible.length === 0, 'An out-of-zone address resolved an eligible vendor location');

    // 9. A deactivated zone stops being serviceable without touching the address.
    await pool.query(
      `UPDATE marketplace.vendor_service_zones SET lifecycle_state='INACTIVE'
        WHERE vendor_location_id=$1`,
      [locationId],
    );
    const afterRetire = await addresses.eligibleVendorLocations({
      context: context(customerA),
      customer_address_id: first.customer_address_id,
    });
    check(
      afterRetire.length === 0,
      'A deactivated zone still reported the location as serviceable',
    );
    await pool.query(
      `UPDATE marketplace.vendor_service_zones SET lifecycle_state='ACTIVE'
        WHERE vendor_location_id=$1`,
      [locationId],
    );

    // 10. One customer can never read or change another customer's address.
    await rejects(
      () =>
        addresses.updateAddress({
          context: context(customerB),
          customer_address_id: first.customer_address_id,
          expected_version: 2,
          label: 'SYNTH Stolen Address',
          pin_code: '302001',
          ...inside,
          now,
        }),
      CustomerAddressNotFoundError,
      'A customer edited another customer address',
    );
    await rejects(
      () =>
        addresses.archiveAddress({
          context: context(customerB),
          customer_address_id: first.customer_address_id,
          now,
        }),
      CustomerAddressNotFoundError,
      'A customer archived another customer address',
    );
    await rejects(
      () =>
        addresses
          .eligibleVendorLocations({
            context: context(customerB),
            customer_address_id: first.customer_address_id,
          })
          .then((rows) => {
            if (rows.length > 0) return rows;
            throw new CustomerAddressNotFoundError();
          }),
      CustomerAddressNotFoundError,
      'A customer resolved serviceability for another customer address',
    );

    // 11. Fulfilment actors only see a precise address while carrying the order.
    const unassigned = await addresses.fulfilmentProjection({
      customer_address_id: first.customer_address_id,
      stage: 'UNASSIGNED',
    });
    check(
      unassigned.latitude === null &&
        unassigned.landmark === null &&
        unassigned.delivery_instructions === null &&
        unassigned.pin_code === '302002',
      'An unassigned stage exposed a precise address',
    );
    const assigned = await addresses.fulfilmentProjection({
      customer_address_id: first.customer_address_id,
      stage: 'ASSIGNED',
    });
    check(assigned.latitude === null, 'An assigned-but-not-carrying stage exposed coordinates');
    const carrying = await addresses.fulfilmentProjection({
      customer_address_id: first.customer_address_id,
      stage: 'CARRYING',
    });
    check(
      carrying.latitude !== null && carrying.delivery_instructions !== null,
      'A carrying partner could not read the address it must deliver to',
    );

    // 12. Input and actor boundaries are enforced.
    await rejects(
      () =>
        addresses.createAddress({
          context: context(customerB),
          address_reference: 'not-a-synthetic-reference',
          label: 'SYNTH Bad Address',
          pin_code: '302001',
          ...inside,
          now,
        }),
      CustomerAddressInputError,
      'A non-synthetic address reference was accepted',
    );
    await rejects(
      () =>
        addresses.createAddress({
          context: context(customerB),
          address_reference: 'SYNTH-ADDRESS-BADPIN',
          label: 'SYNTH Bad Pin Address',
          pin_code: '02001',
          ...inside,
          now,
        }),
      CustomerAddressInputError,
      'An invalid pin code was accepted',
    );
    await rejects(
      () => addresses.listAddresses({ context: createRequestContext({}) }),
      CustomerAddressAuthorizationError,
      'An unauthenticated caller listed saved addresses',
    );
  } finally {
    await addresses.close();
    await pool.end();
  }
}
