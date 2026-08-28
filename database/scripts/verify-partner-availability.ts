import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  type ActorKind,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  PartnerAvailabilityConflictError,
  PartnerAvailabilityService,
} from '../src/partner-availability.js';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function context(kind: ActorKind, actorId: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: actorId,
      actor_kind: kind,
      session_id: createUuidV7(),
    }),
  });
}

async function rejects(work: () => Promise<unknown>, message: string) {
  try {
    await work();
  } catch (error) {
    check(error instanceof PartnerAvailabilityConflictError, `${message}: ${String(error)}`);
    return;
  }
  throw new Error(message);
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
    });
    check(
      eligible.some((candidate) => candidate.partner_user_id === partnerId),
      'Online eligible partner was absent from dispatch search',
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
