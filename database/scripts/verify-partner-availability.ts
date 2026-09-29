import {
  createAuthenticatedActor,
  createRequestContext,
  createRequestId,
  createUuidV7,
  type ActorKind,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  BICYCLE_PACKAGE_LIMIT,
  PRESENCE_WINDOW_SECONDS,
  PartnerAvailabilityConflictError,
  PartnerAvailabilityService,
} from '../src/partner-availability.js';
import { check, rejects } from './verify-support.js';
import {
  activateConfigurationVersion,
  approveConfigurationVersion,
  createConfigurationDraft,
  scheduleConfigurationVersion,
  validateConfigurationVersion,
} from '../src/versioned-configuration.js';

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
    // 9.2 -- privacy: going offline clears the position; the summary carries
    // the zones the position fell in, never the position itself.
    const cleared = await pool.query<{ has_position: boolean; accuracy: number | null }>(
      `SELECT current_coordinates IS NOT NULL AS has_position, location_accuracy_meters AS accuracy
         FROM marketplace.partner_availability WHERE partner_user_id=$1`,
      [partnerId],
    );
    check(
      cleared.rows[0]?.has_position === false && cleared.rows[0]?.accuracy === null,
      `Going offline left the last position on record (${JSON.stringify(cleared.rows)})`,
    );
    check(!('current_coordinates' in summary), 'The availability summary carries the raw position');
    // 9.2 -- online time today: one hour on shift, from the history, in the
    // partner's day.
    check(
      summary.online_seconds_today === 3_600,
      `Online time today was ${String(summary.online_seconds_today)}, not 3600`,
    );

    const events = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM marketplace.partner_availability_events WHERE partner_user_id=$1',
      [partnerId],
    );
    check(events.rows[0]?.count === '2', 'Availability event history is incomplete');

    // 9.2 -- the active zone: the summary names the service zones the
    // partner's position falls in, by name. Back online inside a zone.
    await pool.query(
      `INSERT INTO marketplace.vendor_service_zones
         (service_zone_id,vendor_location_id,zone_name,operating_timezone,boundary,
          lifecycle_state,request_id,correlation_id)
       VALUES ($1,$2,'SYNTH Availability Zone','Asia/Kolkata',
         ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((75.80 26.90,75.82 26.90,75.82 26.92,75.80 26.92,75.80 26.90)))'),4326)::geography,
         'ACTIVE',$3,$3)`,
      [createUuidV7(), locationId, createUuidV7()],
    );
    const dayTwo = new Date(offlineAt.getTime() + 86_400_000);
    await service.set({
      context: context('delivery_partner', partnerId),
      state: 'ONLINE',
      latitude: 26.9102,
      longitude: 75.8102,
      accuracy_meters: 20,
      battery_percent: 80,
      reason_code: 'PARTNER_STARTED_SHIFT',
      now: dayTwo,
    });
    const zoned = await service.summary({
      context: context('delivery_partner', partnerId),
      now: new Date(dayTwo.getTime() + 600_000),
    });
    check(
      Array.isArray(zoned.active_zones) &&
        zoned.active_zones.includes('SYNTH Availability Zone') &&
        zoned.online_seconds_today === 600,
      `The summary does not name the active zone with today's online time (${JSON.stringify({ zones: zoned.active_zones, online: zoned.online_seconds_today })})`,
    );

    // 9.2 -- trips and earnings are counted in the partner's day. A delivery
    // at 23:30 IST belongs to that day, though it is the next day's date in
    // UTC -- as `::date` had it. Now is 00:15 IST the day after.
    const assignmentId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.delivery_assignments
        (delivery_assignment_id, source_order_reference, vendor_location_id, partner_user_id,
         assignment_state, custody_state, package_count, approximate_pickup_area,
         approximate_drop_area, request_id, correlation_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'DELIVERED','DELIVERED',1,'SYNTH Pickup','SYNTH Drop',$5,$5,$6,$6)`,
      [
        assignmentId,
        `SYNTH-ORDER-AV-${Date.now()}`,
        locationId,
        partnerId,
        createUuidV7(),
        new Date('2026-08-28T18:00:00.000Z'),
      ],
    );
    const nextDayIst = await service.summary({
      context: context('delivery_partner', partnerId),
      now: new Date('2026-08-28T18:45:00.000Z'),
    });
    const sameDayIst = await service.summary({
      context: context('delivery_partner', partnerId),
      now: new Date('2026-08-28T18:10:00.000Z'),
    });
    check(
      nextDayIst.trips_today === '0' && sameDayIst.trips_today === '1',
      `Trips are not counted in the partner's day (${nextDayIst.trips_today} after midnight IST, ${sameDayIst.trips_today} before)`,
    );
    // And a delivery at 00:30 IST is that day's too, though it is the previous
    // day's date in UTC: read at 08:30 IST the same day, both count.
    await pool.query(
      `INSERT INTO marketplace.delivery_assignments
        (delivery_assignment_id, source_order_reference, vendor_location_id, partner_user_id,
         assignment_state, custody_state, package_count, approximate_pickup_area,
         approximate_drop_area, request_id, correlation_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'DELIVERED','DELIVERED',1,'SYNTH Pickup','SYNTH Drop',$5,$5,$6,$6)`,
      [
        createUuidV7(),
        `SYNTH-ORDER-AV2-${Date.now()}`,
        locationId,
        partnerId,
        createUuidV7(),
        new Date('2026-08-27T19:00:00.000Z'),
      ],
    );
    const morningIst = await service.summary({
      context: context('delivery_partner', partnerId),
      now: new Date('2026-08-28T03:00:00.000Z'),
    });
    check(
      morningIst.trips_today === '2',
      `A delivery just after midnight IST was not counted in its day (${morningIst.trips_today})`,
    );

    // 9.2 -- who is offered: by configured radius, by vehicle for the load,
    // by account, and under no incident control. Until audit run 57 the
    // radius was a constant, the load and the account were not looked at, and
    // a paused delivery network still offered work.
    const later = new Date(dayTwo.getTime() + 60_000);
    const byDefaultRadius = await service.eligible({
      context: context('admin', adminId),
      vendor_location_id: locationId,
      now: later,
    });
    check(
      byDefaultRadius.some((candidate) => candidate.partner_user_id === partnerId),
      'A partner within the default radius was not offered',
    );
    // A tighter configured radius leaves them out (they are ~30 m away; the
    // configured floor is 100 m, so move them first).
    await service.heartbeat({
      context: context('delivery_partner', partnerId),
      latitude: 26.925,
      longitude: 75.81,
      now: later,
    });
    const proposerId = createUuidV7();
    const approverId = createUuidV7();
    for (const actorId of [proposerId, approverId]) {
      await pool.query('INSERT INTO marketplace.users (user_id) VALUES ($1)', [actorId]);
    }
    const radiusDraft = await createConfigurationDraft(pool, {
      actor_id: proposerId,
      configuration_key: 'dispatch.offer_radius_metres',
      configuration_kind: 'SETTING',
      configuration_value: 1_000,
      correlation_id: createUuidV7(),
      request_id: createRequestId(),
      scope: { kind: 'GLOBAL', reference: 'global' },
    });
    await validateConfigurationVersion(pool, {
      actor_id: proposerId,
      configuration_version_id: radiusDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    await approveConfigurationVersion(pool, {
      actor_id: approverId,
      configuration_version_id: radiusDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    await scheduleConfigurationVersion(pool, {
      actor_id: approverId,
      configuration_version_id: radiusDraft.configuration_version_id,
      effective_from: new Date(now.getTime() - 1_000),
      request_id: createRequestId(),
    });
    await activateConfigurationVersion(pool, {
      actor_id: approverId,
      at: now,
      configuration_version_id: radiusDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    const byConfiguredRadius = await service.eligible({
      context: context('admin', adminId),
      vendor_location_id: locationId,
      now: later,
    });
    const byWiderRadius = await service.eligible({
      context: context('admin', adminId),
      vendor_location_id: locationId,
      radius_meters: 5_000,
      now: later,
    });
    check(
      !byConfiguredRadius.some((candidate) => candidate.partner_user_id === partnerId) &&
        byWiderRadius.some((candidate) => candidate.partner_user_id === partnerId),
      'The configured offer radius was not applied',
    );
    // Vehicle: this partner applied on a bicycle; a heavy or large load goes
    // past them.
    await pool.query(
      `INSERT INTO marketplace.partner_applications
         (partner_application_id, applicant_user_id, identity_reference, vehicle_reference,
          vehicle_kind, bank_account_reference, insurance_reference, emergency_contact_reference,
          training_reference, home_zone_name, lifecycle_state, request_id, correlation_id,
          identity_expires_at, vehicle_expires_at, insurance_expires_at,
          reviewer_user_id, decided_at, submitted_at)
       VALUES ($1,$2,'SYNTH-PARTNER-IDENTITY-AV01','SYNTH-PARTNER-VEHICLE-AV01','BICYCLE',
               'SYNTH-PARTNER-BANK-AV01','SYNTH-PARTNER-INSURANCE-AV01',
               'SYNTH-PARTNER-EMERGENCY-AV01','SYNTH-PARTNER-TRAINING-AV01','SYNTH Jaipur',
               'APPROVED',$3,$3,$4,$4,$4,$5,$6,$6)`,
      [
        createUuidV7(),
        partnerId,
        createUuidV7(),
        new Date(now.getTime() + 365 * 86_400_000),
        adminId,
        now,
      ],
    );
    const lightLoad = await service.eligible({
      context: context('admin', adminId),
      vendor_location_id: locationId,
      radius_meters: 5_000,
      package_count: 2,
      handling_flags: ['FRAGILE'],
      now: later,
    });
    const heavyLoad = await service.eligible({
      context: context('admin', adminId),
      vendor_location_id: locationId,
      radius_meters: 5_000,
      package_count: 1,
      handling_flags: ['HEAVY'],
      now: later,
    });
    const bigLoad = await service.eligible({
      context: context('admin', adminId),
      vendor_location_id: locationId,
      radius_meters: 5_000,
      package_count: BICYCLE_PACKAGE_LIMIT + 1,
      now: later,
    });
    check(
      lightLoad.some((candidate) => candidate.partner_user_id === partnerId) &&
        !heavyLoad.some((candidate) => candidate.partner_user_id === partnerId) &&
        !bigLoad.some((candidate) => candidate.partner_user_id === partnerId),
      'A bicycle was offered a load it cannot carry, or refused one it can',
    );
    // Incident controls (11.7): a paused partner assignment offers nobody;
    // paused platform delivery stops new orders at checkout, not the offers
    // for orders already placed; lifted, the pause offers them again.
    const pause = async (key: string) => {
      const id = createUuidV7();
      await pool.query(
        `INSERT INTO marketplace.incident_controls
           (incident_control_id, control_key, scope_kind, scope_reference, lifecycle_state,
            reason_code, owner_user_id, proposed_by, activated_at, expires_at, review_at,
            obligations, request_id, correlation_id)
         VALUES ($1,$2,'VENDOR_LOCATION',$3,'ACTIVE','WEATHER',$4,$4,$5,$6,$6,'{}'::jsonb,$7,$7)`,
        // The row's own check compares against the database's clock, so the
        // control expires an hour from real now; it took force before the
        // walk's synthetic instant.
        [
          id,
          key,
          locationId,
          adminId,
          new Date(later.getTime() - 60_000),
          new Date(Date.now() + 3_600_000),
          createUuidV7(),
        ],
      );
      return id;
    };
    const deliveryPause = await pause('DELIVERY_PAUSE');
    const underDeliveryPause = await service.eligible({
      context: context('admin', adminId),
      vendor_location_id: locationId,
      radius_meters: 5_000,
      now: later,
    });
    const controlId = await pause('PARTNER_ASSIGNMENT_PAUSE');
    const underPause = await service.eligible({
      context: context('admin', adminId),
      vendor_location_id: locationId,
      radius_meters: 5_000,
      now: later,
    });
    await pool.query(
      `UPDATE marketplace.incident_controls
          SET lifecycle_state='REVOKED', closed_by=owner_user_id, closed_at=clock_timestamp(),
              closing_reason_code='WEATHER_CLEARED'
        WHERE incident_control_id = ANY($1::uuid[])`,
      [[controlId, deliveryPause]],
    );
    const afterPause = await service.eligible({
      context: context('admin', adminId),
      vendor_location_id: locationId,
      radius_meters: 5_000,
      now: later,
    });
    check(
      underPause.length === 0 &&
        underDeliveryPause.some((candidate) => candidate.partner_user_id === partnerId) &&
        afterPause.some((candidate) => candidate.partner_user_id === partnerId),
      `A paused partner assignment still offered work, paused delivery stranded a placed order, or a lifted pause kept blocking (${underPause.length}/${underDeliveryPause.length}/${afterPause.length})`,
    );
    // 9.3 -- one offer at a time: a partner holding a live offer is not
    // offered a second attempt; once that offer has lapsed they are.
    const openOfferId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.delivery_assignments
        (delivery_assignment_id, source_order_reference, vendor_location_id, partner_user_id,
         assignment_state, custody_state, package_count, approximate_pickup_area,
         approximate_drop_area, offer_expires_at, request_id, correlation_id,
         created_at, updated_at)
       VALUES ($1,$2,$3,$4,'OFFERED','NONE',1,'SYNTH Pickup','SYNTH Drop',$5,$6,$6,$7,$7)`,
      [
        openOfferId,
        `SYNTH-ORDER-AV3-${Date.now()}`,
        locationId,
        partnerId,
        new Date(later.getTime() + 30_000),
        createUuidV7(),
        later,
      ],
    );
    const whileOffered = await service.eligible({
      context: context('admin', adminId),
      vendor_location_id: locationId,
      radius_meters: 5_000,
      now: later,
    });
    const afterOfferLapsed = await service.eligible({
      context: context('admin', adminId),
      vendor_location_id: locationId,
      radius_meters: 5_000,
      now: new Date(later.getTime() + 31_000),
    });
    check(
      !whileOffered.some((candidate) => candidate.partner_user_id === partnerId) &&
        afterOfferLapsed.some((candidate) => candidate.partner_user_id === partnerId),
      `A partner with a live offer was offered a second attempt, or stayed excluded after it lapsed (${whileOffered.length}/${afterOfferLapsed.length})`,
    );
    await pool.query(
      'DELETE FROM marketplace.delivery_assignments WHERE delivery_assignment_id=$1',
      [openOfferId],
    );
    // Account: a disabled user is offered nothing.
    await pool.query(`UPDATE marketplace.users SET state='DISABLED' WHERE user_id=$1`, [partnerId]);
    const disabled = await service.eligible({
      context: context('admin', adminId),
      vendor_location_id: locationId,
      radius_meters: 5_000,
      now: later,
    });
    check(
      !disabled.some((candidate) => candidate.partner_user_id === partnerId),
      'A disabled account was still offered work',
    );
  } finally {
    await service.close();
    await pool.end();
  }
}
