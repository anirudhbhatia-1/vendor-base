import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { IdentityAccessService } from '../src/identity-access.js';
import {
  VendorPublicationConflictError,
  VendorPublicationService,
} from '../src/vendor-publication.js';
import {
  VendorStaffAuthorizationError,
  VendorStaffInputError,
  VendorStaffNotFoundError,
  VendorStaffService,
} from '../src/vendor-staff.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function context(userId: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: userId,
      actor_kind: 'vendor_staff',
      session_id: createUuidV7(),
    }),
  });
}
function adminContext(userId: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: userId,
      actor_kind: 'admin',
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

export async function verifyVendorStaff(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const access = new IdentityAccessService({ connection_string: connectionString });
  const staff = new VendorStaffService({ connection_string: connectionString, access });
  const publication = new VendorPublicationService({ connection_string: connectionString });
  const now = new Date();
  try {
    const store = await createDiscoverableStoreFixture(pool, {
      location_name: 'SYNTH Staff Store',
      ...jaipur,
    });
    const managerId = createUuidV7();
    const pickerId = createUuidV7();
    const strangerId = createUuidV7();
    for (const userId of [managerId, pickerId, strangerId]) {
      await pool.query(
        "INSERT INTO marketplace.users (user_id, state, data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
        [userId],
      );
    }

    // 1. The owner invites a manager and a picker.
    await staff.inviteStaff({
      context: context(store.ownerUserId),
      vendor_location_id: store.locationId,
      invitee_user_id: managerId,
      role: 'VENDOR_MANAGER',
      now,
    });
    await staff.inviteStaff({
      context: context(store.ownerUserId),
      vendor_location_id: store.locationId,
      invitee_user_id: pickerId,
      role: 'VENDOR_PICKER',
      now,
    });
    const roster = await staff.listStaff({
      context: context(store.ownerUserId),
      vendor_location_id: store.locationId,
    });
    check(
      roster.some((row) => row.user_id === managerId && row.role === 'VENDOR_MANAGER') &&
        roster.some((row) => row.user_id === pickerId && row.role === 'VENDOR_PICKER') &&
        roster.some((row) => row.user_id === store.ownerUserId && row.role === 'VENDOR_OWNER'),
      'The staff roster did not contain the owner, manager, and picker',
    );

    // 2. A manager cannot invite staff; only the owner can.
    await rejects(
      () =>
        staff.inviteStaff({
          context: context(managerId),
          vendor_location_id: store.locationId,
          invitee_user_id: strangerId,
          role: 'VENDOR_PICKER',
          now,
        }),
      VendorStaffAuthorizationError,
      'A manager was allowed to invite staff',
    );

    // 3. A picker cannot manage settings; a manager can.
    await rejects(
      () =>
        staff.updateProfile({
          context: context(pickerId),
          vendor_location_id: store.locationId,
          expected_version: 1,
          profile_description: 'A picker should not reach settings.',
        }),
      VendorStaffAuthorizationError,
      'A picker was allowed to update store settings',
    );
    const location = await pool.query<{ version: number }>(
      'SELECT version FROM marketplace.vendor_locations WHERE vendor_location_id=$1',
      [store.locationId],
    );
    const startVersion = location.rows[0]?.version;
    check(typeof startVersion === 'number', 'Fixture location version missing');
    const updated = await staff.updateProfile({
      context: context(managerId),
      vendor_location_id: store.locationId,
      expected_version: startVersion,
      profile_description: 'Synthetic manager-updated storefront description.',
    });
    check(
      updated.version === startVersion + 1,
      'A manager profile update did not advance the version',
    );

    // 4. Ordering settings stay within their bounds; nothing here reaches a
    // platform fee, tax, or commission field.
    const ordered = await staff.updateOrderingSettings({
      context: context(store.ownerUserId),
      vendor_location_id: store.locationId,
      expected_version: updated.version,
      minimum_order_minor: 9000,
      preparation_seconds: 1800,
    });
    check(
      ordered.minimum_order_minor === 9000 && ordered.preparation_seconds === 1800,
      'Ordering settings did not persist',
    );
    await rejects(
      () =>
        staff.updateOrderingSettings({
          context: context(store.ownerUserId),
          vendor_location_id: store.locationId,
          expected_version: ordered.version,
          minimum_order_minor: -1,
          preparation_seconds: 1800,
        }),
      VendorStaffInputError,
      'A negative minimum order was accepted',
    );

    // 5. Hours, a closure, and a zone can be managed by owner/manager.
    await staff.replaceOperatingHours({
      context: context(managerId),
      vendor_location_id: store.locationId,
      hours: [{ weekday: 2, opens_at: '09:00', closes_at: '18:00' }],
      now,
    });
    const hours = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM marketplace.vendor_location_operating_hours WHERE vendor_location_id=$1',
      [store.locationId],
    );
    check(
      hours.rows[0]?.count === '1',
      'Replacing operating hours did not leave exactly one window',
    );

    await staff.addTemporaryClosure({
      context: context(store.ownerUserId),
      vendor_location_id: store.locationId,
      starts_at: new Date('2026-09-01T00:00:00.000Z'),
      ends_at: new Date('2026-09-02T00:00:00.000Z'),
      reason_code: 'SYNTH_FESTIVAL_CLOSURE',
      now,
    });

    const zoneCountBefore = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM marketplace.vendor_service_zones WHERE vendor_location_id=$1 AND lifecycle_state='ACTIVE'",
      [store.locationId],
    );
    await staff.addServiceZone({
      context: context(store.ownerUserId),
      vendor_location_id: store.locationId,
      zone_name: 'SYNTH Staff Extension Zone',
      boundary_wkt: `MULTIPOLYGON(((${jaipur.longitude - 0.5} ${jaipur.latitude - 0.5}, ${jaipur.longitude - 0.3} ${jaipur.latitude - 0.5}, ${jaipur.longitude - 0.3} ${jaipur.latitude - 0.3}, ${jaipur.longitude - 0.5} ${jaipur.latitude - 0.3}, ${jaipur.longitude - 0.5} ${jaipur.latitude - 0.5})))`,
      now,
    });
    const newZone = await pool.query<{ service_zone_id: string; count: string }>(
      "SELECT service_zone_id, count(*) OVER ()::text AS count FROM marketplace.vendor_service_zones WHERE vendor_location_id=$1 AND lifecycle_state='ACTIVE' AND zone_name='SYNTH Staff Extension Zone'",
      [store.locationId],
    );
    const zoneId = newZone.rows[0]?.service_zone_id;
    check(typeof zoneId === 'string', 'Adding a service zone did not create it');
    const zoneCountAfter = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM marketplace.vendor_service_zones WHERE vendor_location_id=$1 AND lifecycle_state='ACTIVE'",
      [store.locationId],
    );
    check(
      Number(zoneCountAfter.rows[0]?.count) === Number(zoneCountBefore.rows[0]?.count) + 1,
      'The active zone count did not increase by exactly one',
    );
    await staff.deactivateServiceZone({
      context: context(store.ownerUserId),
      vendor_location_id: store.locationId,
      service_zone_id: zoneId as UuidV7,
      now,
    });
    const zoneCountFinal = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM marketplace.vendor_service_zones WHERE vendor_location_id=$1 AND lifecycle_state='ACTIVE'",
      [store.locationId],
    );
    check(
      Number(zoneCountFinal.rows[0]?.count) === Number(zoneCountBefore.rows[0]?.count),
      'Deactivating a zone did not restore the original active count',
    );

    // 6. Fulfilment modes are readable by any staff role but never writable
    // through this service — they remain admin-approved.
    const modes = await staff.listFulfilmentModes({
      context: context(pickerId),
      vendor_location_id: store.locationId,
    });
    check(modes.includes('PLATFORM_DELIVERY'), 'A picker could not read fulfilment modes');
    check(
      !('addFulfilmentMode' in staff) && !('setFulfilmentMode' in staff),
      'Vendor staff service unexpectedly exposes a fulfilment-mode write path',
    );

    // 7. Every settings change and staff action left activity history.
    const activity = await staff.activityHistory({
      context: context(store.ownerUserId),
      vendor_location_id: store.locationId,
    });
    check(
      activity.some((e) => e.event_type === 'STAFF_INVITED') &&
        activity.some((e) => e.event_type === 'SETTINGS_UPDATED'),
      'Activity history did not record both staff invitation and settings changes',
    );

    // 8. A stranger with no membership at this location is refused everywhere.
    await rejects(
      () =>
        staff.myAccess({
          context: context(strangerId),
          vendor_location_id: store.locationId,
        }),
      VendorStaffAuthorizationError,
      'A stranger with no membership read an access summary',
    );

    // 9. Only manager/picker are revocable through this route; the owner
    // role can never be revoked here.
    await staff.revokeStaff({
      context: context(store.ownerUserId),
      vendor_location_id: store.locationId,
      target_user_id: pickerId,
      role: 'VENDOR_PICKER',
      reason_code: 'SYNTH_PICKER_OFFBOARDED',
      now,
    });
    await rejects(
      () =>
        staff.revokeStaff({
          context: context(store.ownerUserId),
          vendor_location_id: store.locationId,
          target_user_id: pickerId,
          role: 'VENDOR_PICKER',
          reason_code: 'SYNTH_PICKER_OFFBOARDED_AGAIN',
          now,
        }),
      VendorStaffNotFoundError,
      'Revoking an already-revoked membership was accepted',
    );
    const rosterAfterRevoke = await staff.listStaff({
      context: context(store.ownerUserId),
      vendor_location_id: store.locationId,
    });
    check(
      !rosterAfterRevoke.some((row) => row.user_id === pickerId),
      'A revoked picker still appeared on the active staff roster',
    );

    // 10. Publication restore and impact: pause the store, confirm the
    // impact preview surfaces the affected carts, unpublish, then restore.
    const admin = createUuidV7();
    await pool.query(
      "INSERT INTO marketplace.users (user_id, state, data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
      [admin],
    );
    const cartCustomer = createUuidV7();
    await pool.query(
      "INSERT INTO marketplace.users (user_id, state, data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
      [cartCustomer],
    );
    await pool.query(
      `INSERT INTO marketplace.carts (cart_id, user_id, request_id, correlation_id)
       VALUES ($1,$2,$3,$3)`,
      [createUuidV7(), cartCustomer, createUuidV7()],
    );
    await pool.query(
      `INSERT INTO marketplace.cart_vendor_groups (cart_vendor_group_id, cart_id, vendor_location_id)
       VALUES ($1,(SELECT cart_id FROM marketplace.carts WHERE user_id=$2),$3)`,
      [createUuidV7(), cartCustomer, store.locationId],
    );

    let caseRow = await publication.get({
      context: adminContext(admin),
      publication_case_id: store.publicationCaseId,
    });
    check(caseRow.lifecycle_state === 'PUBLISHED', 'Fixture publication case was not PUBLISHED');

    const impactBeforePause = await publication.impact({
      context: adminContext(admin),
      publication_case_id: store.publicationCaseId,
    });
    check(
      impactBeforePause.active_cart_groups === 1,
      'Impact preview did not count the one active cart group referencing this store',
    );

    const pausedVersion = await publication.pause({
      context: adminContext(admin),
      expected_version: caseRow.version,
      note: 'Synthetic pause for staff/settings verification.',
      publication_case_id: store.publicationCaseId,
      reason_code: 'SYNTH_STAFF_VERIFY_PAUSE',
    });
    const unpublishedVersion = await publication.unpublish({
      context: adminContext(admin),
      expected_version: pausedVersion,
      note: 'Synthetic unpublish for staff/settings verification.',
      publication_case_id: store.publicationCaseId,
      reason_code: 'SYNTH_STAFF_VERIFY_UNPUBLISH',
    });

    // A first publish() cannot resurrect an UNPUBLISHED case; only restore() can.
    await rejects(
      () =>
        publication.publish({
          context: adminContext(admin),
          expected_version: unpublishedVersion,
          note: 'publish() must not resurrect an unpublished case.',
          publication_case_id: store.publicationCaseId,
          reason_code: 'SYNTH_WRONG_ACTION',
        }),
      VendorPublicationConflictError,
      'publish() was allowed to transition an UNPUBLISHED case',
    );

    const restoredVersion = await publication.restore({
      context: adminContext(admin),
      expected_version: unpublishedVersion,
      note: 'Synthetic restore for staff/settings verification.',
      publication_case_id: store.publicationCaseId,
      reason_code: 'SYNTH_STAFF_VERIFY_RESTORE',
    });
    caseRow = await publication.get({
      context: adminContext(admin),
      publication_case_id: store.publicationCaseId,
    });
    check(
      caseRow.lifecycle_state === 'PUBLISHED' && caseRow.version === restoredVersion,
      'restore() did not bring the case back to PUBLISHED',
    );
    const restoreEvent = await pool.query<{ previous_state: string; event_type: string }>(
      `SELECT previous_state, event_type FROM marketplace.vendor_publication_events
        WHERE publication_case_id=$1 ORDER BY occurred_at DESC LIMIT 1`,
      [store.publicationCaseId],
    );
    check(
      restoreEvent.rows[0]?.event_type === 'PUBLISHED' &&
        restoreEvent.rows[0].previous_state === 'UNPUBLISHED',
      'The restore audit event did not record its true origin state',
    );
  } finally {
    await staff.close();
    await publication.close();
    await access.close();
    await pool.end();
  }
}
