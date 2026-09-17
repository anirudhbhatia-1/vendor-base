import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  type ActorKind,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  PRESENCE_WINDOW_SECONDS,
  PartnerAvailabilityConflictError,
  PartnerAvailabilityService,
} from '../src/partner-availability.js';
import { check, rejects } from './verify-support.js';

function context(kind: ActorKind, actorId: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: actorId,
      actor_kind: kind,
      session_id: createUuidV7(),
    }),
  });
}

export async function verifyPartnerAvailability(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const service = new PartnerAvailabilityService({ connection_string: connectionString });
  const partnerId = createUuidV7();
  const ineligiblePartnerId = createUuidV7();
  const adminId = createUuidV7();
  const vendorId = createUuidV7();
  const locationId = createUuidV7();
  const now = new Date('2026-08-27T09:00:00.000Z');
  try {
    for (const userId of [partnerId, ineligiblePartnerId, adminId]) {
      await pool.query('INSERT INTO marketplace.users (user_id) VALUES ($1)', [userId]);
    }
    const roleId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.role_assignments
        (role_assignment_id,user_id,role_key,state,valid_from,granted_by_user_id,
         request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,'DELIVERY_PARTNER','ACTIVE',$3,$4,$5,$5,$3,$3)`,
      [roleId, partnerId, now, adminId, createUuidV7()],
    );
    await pool.query(
      `INSERT INTO marketplace.partner_eligibilities
        (partner_eligibility_id,role_assignment_id,user_id,state,eligible_from,
         reason_code,updated_at)
       VALUES ($1,$2,$3,'ELIGIBLE',$4,'SYNTH_AVAILABILITY_VERIFIED',$4)`,
      [createUuidV7(), roleId, partnerId, now],
    );
    await pool.query(
      `INSERT INTO marketplace.vendors
        (vendor_id,business_name,profile_description,lifecycle_state,request_id,correlation_id)
       VALUES ($1,'SYNTH Availability Store','Dispatch verifier','ACTIVE',$2,$2)`,
      [vendorId, createUuidV7()],
    );
    await pool.query(
      `INSERT INTO marketplace.vendor_locations
        (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
         coordinates,category,lifecycle_state,request_id,correlation_id)
       VALUES ($1,$2,'SYNTH Availability Location','Dispatch verifier','Asia/Kolkata',
         ST_SetSRID(ST_MakePoint(75.8100,26.9100),4326)::geography,
         'FRUIT_VEGETABLE','ACTIVE',$3,$3)`,
      [locationId, vendorId, createUuidV7()],
    );

    await rejects(
      () =>
        service.set({
          context: context('delivery_partner', ineligiblePartnerId),
          state: 'ONLINE',
          latitude: 26.91,
          longitude: 75.81,
          reason_code: 'PARTNER_STARTED_SHIFT',
          now,
        }),
      PartnerAvailabilityConflictError,
      'Ineligible partner was allowed online',
    );

    const online = await service.set({
      context: context('delivery_partner', partnerId),
      state: 'ONLINE',
      latitude: 26.9102,
      longitude: 75.8102,
      accuracy_meters: 125,
      battery_percent: 15,
      reason_code: 'PARTNER_STARTED_SHIFT',
      now,
    });
    check(online.availability_state === 'ONLINE', 'Partner did not go online');
    check(
      online.warning_codes.includes('LOW_BATTERY') &&
        online.warning_codes.includes('LOW_LOCATION_ACCURACY'),
      'Device-health warnings were not recorded',
    );

    const eligible = await service.eligible({
      context: context('admin', adminId),
      vendor_location_id: locationId,
      radius_meters: 2_000,
      now,
    });
    check(
      eligible.some((candidate) => candidate.partner_user_id === partnerId),
      'Online eligible partner was absent from dispatch search',
    );

    // Presence lapses. ONLINE is a state the partner set once; whether they are
    // still there is a fact their device has to keep confirming. Ten partners
    // from an acceptance run two weeks earlier were still "online" at a store
    // on the reporting environment and outranked the one real partner nearby.
    const lapsed = new Date(now.getTime() + (PRESENCE_WINDOW_SECONDS + 60) * 1000);
    const unseen = await service.eligible({
      context: context('admin', adminId),
      vendor_location_id: locationId,
      radius_meters: 2_000,
      now: lapsed,
    });
    check(
      !unseen.some((candidate) => candidate.partner_user_id === partnerId),
      'A partner whose presence had lapsed was still offered to dispatch',
    );
    const beat = await service.heartbeat({
      context: context('delivery_partner', partnerId),
      latitude: 26.9103,
      longitude: 75.8103,
      accuracy_meters: 20,
      now: lapsed,
    });
    check(
      beat.availability_state === 'ONLINE' && beat.last_seen_at.getTime() === lapsed.getTime(),
      'Heartbeat did not record presence',
    );
    const seenAgain = await service.eligible({
      context: context('admin', adminId),
      vendor_location_id: locationId,
      radius_meters: 2_000,
      now: lapsed,
    });
    check(
      seenAgain.some((candidate) => candidate.partner_user_id === partnerId),
      'A heartbeat did not restore the partner to dispatch',
    );
    const moved = await pool.query<{ metres: number }>(
      `SELECT ST_Distance(current_coordinates, ST_SetSRID(ST_MakePoint(75.8103,26.9103),4326)::geography)::integer AS metres
         FROM marketplace.partner_availability WHERE partner_user_id=$1`,
      [partnerId],
    );
    check(moved.rows[0]?.metres === 0, 'Heartbeat did not carry the device position');
    const beatsWithoutEvents = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM marketplace.partner_availability_events WHERE partner_user_id=$1',
      [partnerId],
    );
    check(
      beatsWithoutEvents.rows[0]?.count === '1',
      'A heartbeat wrote an availability event; only state changes are events',
    );

    const offlineAt = new Date(now.getTime() + 3_600_000);
    const offline = await service.set({
      context: context('delivery_partner', partnerId),
      state: 'OFFLINE',
      reason_code: 'PARTNER_ENDED_SHIFT',
      now: offlineAt,
    });
    check(
      Number(offline.accumulated_online_seconds) === 3_600,
      'Online duration was not accumulated server-side',
    );
    const summary = await service.summary({
      context: context('delivery_partner', partnerId),
      now: offlineAt,
    });
    check(summary.availability_state === 'OFFLINE', 'Availability summary is stale');
    await rejects(
      () =>
        service.heartbeat({
          context: context('delivery_partner', partnerId),
          now: new Date(offlineAt.getTime() + 60_000),
        }),
      PartnerAvailabilityConflictError,
      'An offline partner was allowed to heartbeat as present',
    );
    check(summary.trips_today === '0', 'Unexpected trip count in fresh availability fixture');

    const events = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM marketplace.partner_availability_events WHERE partner_user_id=$1',
      [partnerId],
    );
    check(events.rows[0]?.count === '2', 'Availability event history is incomplete');
  } finally {
    await service.close();
    await pool.end();
  }
}
