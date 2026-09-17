import { createHmac } from 'node:crypto';
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
  VendorStaffConflictError,
  VendorStaffInputError,
  VendorStaffNotFoundError,
  VendorStaffService,
} from '../src/vendor-staff.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';
import { check, rejects, adminContext } from './verify-support.js';

function context(userId: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: userId,
      actor_kind: 'vendor_staff',
      session_id: createUuidV7(),
    }),
  });
}
const jaipur = { latitude: 26.91, longitude: 75.81 };
const STAFF_HASH_KEY = 'SYNTH-VENDOR-STAFF-VERIFY-KEY';
const phoneLookupHash = (phone: string) =>
  createHmac('sha256', STAFF_HASH_KEY).update(`phone:${phone}`).digest('hex');

export async function verifyVendorStaff(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const access = new IdentityAccessService({ connection_string: connectionString });
  const staff = new VendorStaffService({
    access,
    connection_string: connectionString,
    hash_key: STAFF_HASH_KEY,
  });
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

    // 1b. An owner invites by phone number, which is the only identifier they
    // can actually know. Requiring a UUID here made the route unreachable from
    // the console: every value a person could type was rejected as malformed.
    const phonePickerId = createUuidV7();
    // Unique per run: the identity table is globally unique on the lookup hash,
    // so a fixed number would only be insertable once.
    const phoneNumber = `SYNTH-PHONE-STAFF-${phonePickerId.replaceAll('-', '').slice(-10).toUpperCase()}`;
    await pool.query(
      "INSERT INTO marketplace.users (user_id, state, data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
      [phonePickerId],
    );
    await pool.query(
      `INSERT INTO marketplace.phone_identities
         (phone_identity_id, user_id, phone_lookup_hash, retention_review_at,
          verified_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$5,$5)`,
      [
        createUuidV7(),
        phonePickerId,
        phoneLookupHash(phoneNumber),
        new Date(now.getTime() + 86_400_000),
        now,
      ],
    );
    const invited = await staff.inviteStaff({
      context: context(store.ownerUserId),
      vendor_location_id: store.locationId,
      invitee_phone: phoneNumber.toLowerCase(),
      role: 'VENDOR_PICKER',
      now,
    });
    check(
      invited.invitee_user_id === phonePickerId,
      'A phone-addressed invitation did not resolve to the right account',
    );

    // An unknown number is refused rather than silently creating an account:
    // an owner must not be able to bring a user into existence.
    await rejects(
      () =>
        staff.inviteStaff({
          context: context(store.ownerUserId),
          vendor_location_id: store.locationId,
          invitee_phone: 'SYNTH-PHONE-STAFF-VERIFY-NOBODY',
          role: 'VENDOR_PICKER',
          now,
        }),
      VendorStaffNotFoundError,
      'An invitation to an unknown number was accepted',
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
      boundary_wkt: `POLYGON((${jaipur.longitude - 0.5} ${jaipur.latitude - 0.5}, ${jaipur.longitude - 0.3} ${jaipur.latitude - 0.5}, ${jaipur.longitude - 0.3} ${jaipur.latitude - 0.3}, ${jaipur.longitude - 0.5} ${jaipur.latitude - 0.3}, ${jaipur.longitude - 0.5} ${jaipur.latitude - 0.5}))`,
      now,
    });
    const newZone = await pool.query<{ service_zone_id: string; count: string }>(
      "SELECT service_zone_id, count(*) OVER ()::text AS count FROM marketplace.vendor_service_zones WHERE vendor_location_id=$1 AND lifecycle_state='ACTIVE' AND zone_name='SYNTH Staff Extension Zone'",
      [store.locationId],
    );
    const zoneId = newZone.rows[0]?.service_zone_id;
    check(typeof zoneId === 'string', 'Adding a service zone did not create it');

    // A name that is already taken must say so, and must not read as a conflict
    // the vendor can wait out.
    //
    // Reported from a live session: two POSTs to the zones endpoint, both 409.
    // The duplicate name arrived at the browser as VERSION_CONFLICT -- the only
    // 409 code any controller could reach -- which clients render as "Something
    // changed while you were working. Refresh and try again." So the vendor
    // refreshed, retyped the same name, and hit the same wall.
    let duplicateCode: string | undefined;
    try {
      await staff.addServiceZone({
        context: context(store.ownerUserId),
        vendor_location_id: store.locationId,
        zone_name: 'SYNTH Staff Extension Zone',
        boundary_wkt: `POLYGON((${jaipur.longitude - 0.6} ${jaipur.latitude - 0.6}, ${jaipur.longitude - 0.4} ${jaipur.latitude - 0.6}, ${jaipur.longitude - 0.4} ${jaipur.latitude - 0.4}, ${jaipur.longitude - 0.6} ${jaipur.latitude - 0.4}, ${jaipur.longitude - 0.6} ${jaipur.latitude - 0.6}))`,
        now,
      });
    } catch (error: unknown) {
      duplicateCode =
        error instanceof VendorStaffConflictError ? error.code : `unexpected:${String(error)}`;
    }
    check(
      duplicateCode === 'RESOURCE_ALREADY_EXISTS',
      `A duplicate zone name did not report itself as an existing resource (got ${duplicateCode})`,
    );
    const afterDuplicate = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM marketplace.vendor_service_zones WHERE vendor_location_id=$1 AND zone_name='SYNTH Staff Extension Zone'",
      [store.locationId],
    );
    check(
      afterDuplicate.rows[0]?.count === '1',
      'The refused duplicate still wrote a second zone row',
    );

    // The console could add a zone and deactivate one by id, but never list
    // them — so the only way to remove a zone was to already know a UUID the
    // product never displays anywhere.
    const listedZones = await staff.listServiceZones({
      context: context(store.ownerUserId),
      vendor_location_id: store.locationId,
    });
    const listedZone = listedZones.find((zone) => zone.service_zone_id === zoneId);
    check(listedZone !== undefined, 'A zone that exists was not listed');
    check(
      listedZone?.lifecycle_state === 'ACTIVE' && (listedZone?.area_square_metres ?? 0) > 0,
      'A listed zone carried no usable state or area',
    );
    const listedClosures = await staff.listTemporaryClosures({
      context: context(store.ownerUserId),
      vendor_location_id: store.locationId,
      now: new Date('2026-08-31T00:00:00.000Z'),
    });
    check(
      listedClosures.some((closure) => closure.reason_code === 'SYNTH_FESTIVAL_CLOSURE'),
      'A scheduled closure was not listed back to the store that set it',
    );
    // A closure that has already finished is history, not something to act on.
    const pastClosures = await staff.listTemporaryClosures({
      context: context(store.ownerUserId),
      vendor_location_id: store.locationId,
      now: new Date('2026-09-03T00:00:00.000Z'),
    });
    check(
      !pastClosures.some((closure) => closure.reason_code === 'SYNTH_FESTIVAL_CLOSURE'),
      'A finished closure was still offered as current',
    );
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
    // Requirement 4 -- vendors must not override platform-owned fee policy -- is a
    // statement about the whole write surface, not about two method names. Checking for
    // `addFulfilmentMode` and `setFulfilmentMode` specifically would pass a method
    // called `updateFulfilmentModes`, and said nothing about fees at all.
    //
    // An allowlist inverts that: any new mutating method on the vendor-facing service
    // fails until it is reviewed and named here, whether it writes fulfilment modes,
    // commission, delivery fees or anything else the platform owns.
    const vendorWritableMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(staff) as object)
      .filter((name) =>
        /^(add|set|update|invite|revoke|replace|deactivate|delete|remove|create)/.test(name),
      )
      .sort();
    const approvedWrites = [
      'addServiceZone',
      'addTemporaryClosure',
      'deactivateServiceZone',
      'inviteStaff',
      'replaceOperatingHours',
      'revokeStaff',
      'updateOrderingSettings',
      'updateProfile',
    ];
    check(
      JSON.stringify(vendorWritableMethods) === JSON.stringify(approvedWrites),
      `Vendor staff write surface changed: ${JSON.stringify(vendorWritableMethods)}`,
    );
    check(
      !vendorWritableMethods.some((name) => /fee|commission|payout|policy|fulfilment/i.test(name)),
      'A vendor-facing write path reaches platform-owned fee or fulfilment policy',
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
