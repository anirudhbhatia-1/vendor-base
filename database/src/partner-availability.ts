import { createDatabasePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
export class PartnerAvailabilityInputError extends Error {}
export class PartnerAvailabilityAuthorizationError extends Error {}
export class PartnerAvailabilityConflictError extends Error {
  readonly code: 'ORDER_STATE_CONFLICT' | 'PARTNER_NOT_ELIGIBLE';

  constructor(
    message?: string,
    code: 'ORDER_STATE_CONFLICT' | 'PARTNER_NOT_ELIGIBLE' = 'ORDER_STATE_CONFLICT',
  ) {
    super(message);
    this.code = code;
  }
}
function partner(c: RequestContext) {
  if (c.actor?.actor_kind !== 'delivery_partner') throw new PartnerAvailabilityAuthorizationError();
  return c.actor.actor_id;
}
function admin(c: RequestContext) {
  if (c.actor?.actor_kind !== 'admin' && c.actor?.actor_kind !== 'system')
    throw new PartnerAvailabilityAuthorizationError();
}
/**
 * How recently a partner's device must have confirmed presence for dispatch to
 * consider them. The apps heartbeat once a minute while online; five minutes
 * absorbs a backgrounded tab or a patchy connection without letting a session
 * that ended silently keep receiving offers. A partner whose presence has
 * lapsed is still ONLINE on their own screen -- they are simply not offered
 * work until the next heartbeat arrives.
 */
export const PRESENCE_WINDOW_SECONDS = 5 * 60;

export class PartnerAvailabilityService {
  readonly #pool: Pool;
  constructor(i: { connection_string: string }) {
    this.#pool = createDatabasePool({
      connectionString: i.connection_string,
      application_name: 'partner-availability',
      max: 6,
    });
  }
  async close() {
    await this.#pool.end();
  }
  async set(input: {
    context: RequestContext;
    state: 'OFFLINE' | 'ONLINE' | 'PAUSED';
    latitude?: number;
    longitude?: number;
    accuracy_meters?: number;
    battery_percent?: number;
    reason_code: string;
    now?: Date;
  }) {
    const id = partner(input.context);
    if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(input.reason_code))
      throw new PartnerAvailabilityInputError();
    if (
      input.state === 'ONLINE' &&
      (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude))
    )
      throw new PartnerAvailabilityInputError('Online requires coordinates');
    const now = input.now ?? new Date();
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      // Going online is refused for the same reasons the profile lists (9.1,
      // `PartnerLifecycleService.eligibilityOf`): eligibility, an expired
      // document, a platform-wide restriction, an unsynced proof. The code
      // sends the partner to the profile for the exact blockers.
      const eligible = await client.query(
        `SELECT 1 FROM marketplace.partner_eligibilities WHERE user_id=$1 AND state='ELIGIBLE' AND (eligible_until IS NULL OR eligible_until>$2)`,
        [id, now],
      );
      if (input.state === 'ONLINE' && !eligible.rows[0])
        throw new PartnerAvailabilityConflictError(
          'Partner is not eligible',
          'PARTNER_NOT_ELIGIBLE',
        );
      if (input.state === 'ONLINE') {
        const lapsed = await client.query(
          `SELECT 1 FROM marketplace.partner_applications
            WHERE applicant_user_id=$1 AND lifecycle_state='APPROVED'
              AND (identity_expires_at <= $2 OR vehicle_expires_at <= $2 OR insurance_expires_at <= $2)`,
          [id, now],
        );
        if (lapsed.rows[0])
          throw new PartnerAvailabilityConflictError(
            'A document has expired',
            'PARTNER_NOT_ELIGIBLE',
          );
        const restricted = await client.query(
          `SELECT 1 FROM marketplace.trust_restriction_cases
            WHERE subject_kind='PARTNER' AND subject_reference=$1 AND lifecycle_state='ACTIVE'
              AND scope_kind='GLOBAL' AND effective_until > $2`,
          [String(id), now],
        );
        if (restricted.rows[0])
          throw new PartnerAvailabilityConflictError(
            'Partner is restricted',
            'PARTNER_NOT_ELIGIBLE',
          );
      }
      const pending = await client.query(
        `SELECT 1 FROM marketplace.partner_offline_proofs WHERE partner_user_id=$1 AND sync_state='PENDING'`,
        [id],
      );
      if (input.state === 'ONLINE' && pending.rows[0])
        throw new PartnerAvailabilityConflictError(
          'Sync offline proof before going online',
          'PARTNER_NOT_ELIGIBLE',
        );
      const prior = await client.query<{
        availability_state: string;
        online_since: Date | null;
        accumulated_online_seconds: string;
      }>(`SELECT * FROM marketplace.partner_availability WHERE partner_user_id=$1 FOR UPDATE`, [
        id,
      ]);
      const old = prior.rows[0];
      const accumulated =
        Number(old?.accumulated_online_seconds ?? 0) +
        (old?.online_since
          ? Math.max(0, Math.floor((now.getTime() - old.online_since.getTime()) / 1000))
          : 0);
      const warnings: string[] = [];
      if ((input.battery_percent ?? 100) < 20) warnings.push('LOW_BATTERY');
      if ((input.accuracy_meters ?? 0) > 100) warnings.push('LOW_LOCATION_ACCURACY');
      const row = await client.query(
        `INSERT INTO marketplace.partner_availability(partner_user_id,availability_state,current_coordinates,location_accuracy_meters,battery_percent,online_since,accumulated_online_seconds,warning_codes,updated_at,last_seen_at) VALUES($1,$2,CASE WHEN $3::float IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($4,$3),4326)::geography END,$5,$6,CASE WHEN $2='ONLINE' THEN $7::timestamptz ELSE NULL END,$8,$9,$7::timestamptz,$7::timestamptz) ON CONFLICT(partner_user_id) DO UPDATE SET availability_state=$2,current_coordinates=COALESCE(EXCLUDED.current_coordinates,partner_availability.current_coordinates),location_accuracy_meters=$5,battery_percent=$6,online_since=CASE WHEN $2='ONLINE' THEN COALESCE(partner_availability.online_since,$7::timestamptz) ELSE NULL END,accumulated_online_seconds=$8,warning_codes=$9,version=partner_availability.version+1,updated_at=$7::timestamptz,last_seen_at=$7::timestamptz RETURNING *`,
        [
          id,
          input.state,
          input.latitude ?? null,
          input.longitude ?? null,
          input.accuracy_meters ?? null,
          input.battery_percent ?? null,
          now,
          accumulated,
          warnings,
        ],
      );
      await client.query(
        `INSERT INTO marketplace.partner_availability_events(event_id,partner_user_id,previous_state,resulting_state,warning_codes,actor_id,reason_code,request_id,correlation_id,occurred_at) VALUES($1,$2,$3,$4,$5,$2,$6,$7,$8,$9)`,
        [
          createUuidV7(),
          id,
          old?.availability_state ?? null,
          input.state,
          warnings,
          input.reason_code,
          parseRequestId(input.context.request_id),
          parseUuidV7(input.context.correlation_id),
          now,
        ],
      );
      await client.query('COMMIT');
      return row.rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  /**
   * The device saying "still here", once a minute while online.
   *
   * Refreshes presence and, when the device offers them, the coordinates
   * dispatch ranks by. Writes no availability event: a heartbeat is not a
   * decision, and sixty events an hour per partner would bury the ones that
   * are. Refused unless the partner is ONLINE, so a client that lost the state
   * change learns it here rather than heartbeating an offline row for ever.
   */
  async heartbeat(input: {
    context: RequestContext;
    latitude?: number;
    longitude?: number;
    accuracy_meters?: number;
    battery_percent?: number;
    now?: Date;
  }) {
    const id = partner(input.context);
    const now = input.now ?? new Date();
    const located = Number.isFinite(input.latitude) && Number.isFinite(input.longitude);
    const r = await this.#pool.query<{ availability_state: string; last_seen_at: Date }>(
      `UPDATE marketplace.partner_availability
          SET last_seen_at=$2::timestamptz,
              current_coordinates=CASE WHEN $3::boolean THEN ST_SetSRID(ST_MakePoint($5::float,$4::float),4326)::geography ELSE current_coordinates END,
              location_accuracy_meters=COALESCE($6,location_accuracy_meters),
              battery_percent=COALESCE($7,battery_percent)
        WHERE partner_user_id=$1 AND availability_state='ONLINE'
        RETURNING availability_state, last_seen_at`,
      [
        id,
        now,
        located,
        located ? input.latitude : null,
        located ? input.longitude : null,
        input.accuracy_meters ?? null,
        input.battery_percent ?? null,
      ],
    );
    const row = r.rows[0];
    if (!row) throw new PartnerAvailabilityConflictError('Heartbeat applies while online');
    return { availability_state: row.availability_state, last_seen_at: row.last_seen_at };
  }
  async summary(input: { context: RequestContext; now?: Date }) {
    const id = partner(input.context);
    const now = input.now ?? new Date();
    const r = await this.#pool.query(
      `SELECT a.*,COALESCE((SELECT count(*) FROM marketplace.delivery_assignments d WHERE d.partner_user_id=$1 AND d.assignment_state='DELIVERED' AND d.updated_at::date=$2::date),0)::text trips_today,COALESCE((SELECT sum(net_minor) FROM marketplace.partner_earnings_records e WHERE e.partner_user_id=$1 AND e.created_at::date=$2::date),0)::text earnings_today_minor FROM marketplace.partner_availability a WHERE a.partner_user_id=$1`,
      [id, now],
    );
    return (
      r.rows[0] ?? {
        partner_user_id: id,
        availability_state: 'OFFLINE',
        trips_today: '0',
        earnings_today_minor: '0',
        accumulated_online_seconds: '0',
        warning_codes: [],
      }
    );
  }
  /**
   * Clears a partner's availability from a system context.
   *
   * `set` is partner-authenticated by design, so an operational event such as a
   * suspension cannot go through it. Recording the availability event keeps the
   * partner's own history complete rather than mutating the row silently.
   */
  async forceOffline(input: {
    context: RequestContext;
    partner_user_id: UuidV7;
    reason_code: string;
    now?: Date;
  }) {
    admin(input.context);
    if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(input.reason_code))
      throw new PartnerAvailabilityInputError();
    const now = input.now ?? new Date();
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const prior = await client.query<{ availability_state: string }>(
        `SELECT availability_state FROM marketplace.partner_availability WHERE partner_user_id=$1 FOR UPDATE`,
        [input.partner_user_id],
      );
      const old = prior.rows[0];
      if (!old || old.availability_state === 'OFFLINE') {
        await client.query('COMMIT');
        return false;
      }
      await client.query(
        `UPDATE marketplace.partner_availability
            SET availability_state='OFFLINE',online_since=NULL,version=version+1,updated_at=$2
          WHERE partner_user_id=$1`,
        [input.partner_user_id, now],
      );
      await client.query(
        `INSERT INTO marketplace.partner_availability_events(event_id,partner_user_id,previous_state,resulting_state,warning_codes,actor_id,reason_code,request_id,correlation_id,occurred_at) VALUES($1,$2,$3,'OFFLINE',$4,$5,$6,$7,$8,$9)`,
        [
          createUuidV7(),
          input.partner_user_id,
          old.availability_state,
          [],
          input.context.actor?.actor_id ?? input.partner_user_id,
          input.reason_code,
          parseRequestId(input.context.request_id),
          parseUuidV7(input.context.correlation_id),
          now,
        ],
      );
      await client.query('COMMIT');
      return true;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Partners a vendor location may be offered work from.
   *
   * Availability alone is not enough: a suspended partner keeps whatever
   * availability row they last wrote, so eligibility is re-checked here rather
   * than trusted from the availability state.
   */
  async eligible(input: {
    context: RequestContext;
    vendor_location_id: UuidV7;
    radius_meters?: number;
    /** Partners who already declined the attempt being dispatched. */
    exclude_partner_user_ids?: readonly UuidV7[];
    now?: Date;
  }) {
    admin(input.context);
    const radius = Math.min(Math.max(input.radius_meters ?? 5000, 100), 50000);
    const excluded = input.exclude_partner_user_ids ?? [];
    const now = input.now ?? new Date();
    // ONLINE alone is not presence: a session that ended without going
    // offline stays ONLINE for ever, at the place it was. Only a partner whose
    // device has confirmed itself inside the window is offered work.
    const seenSince = new Date(now.getTime() - PRESENCE_WINDOW_SECONDS * 1000);
    const r = await this.#pool.query(
      // A restriction is capability-specific (9.1): GLOBAL keeps the partner
      // off every offer, VENDOR_LOCATION off this store's, ZONE off the stores
      // serving that zone by name. An expired document keeps them off until
      // the sweep or a renewal has spoken. Until audit run 56 none of these
      // touched who was offered work.
      `SELECT a.partner_user_id,ST_Distance(a.current_coordinates,l.coordinates)::integer distance_meters,a.warning_codes FROM marketplace.partner_availability a JOIN marketplace.vendor_locations l ON l.vendor_location_id=$1 WHERE a.availability_state='ONLINE' AND a.last_seen_at>$4::timestamptz AND EXISTS(SELECT 1 FROM marketplace.partner_eligibilities e WHERE e.user_id=a.partner_user_id AND e.state='ELIGIBLE' AND (e.eligible_until IS NULL OR e.eligible_until>$5::timestamptz)) AND NOT EXISTS(SELECT 1 FROM marketplace.partner_applications app WHERE app.applicant_user_id=a.partner_user_id AND app.lifecycle_state='APPROVED' AND (app.identity_expires_at<=$5::timestamptz OR app.vehicle_expires_at<=$5::timestamptz OR app.insurance_expires_at<=$5::timestamptz)) AND NOT EXISTS(SELECT 1 FROM marketplace.trust_restriction_cases r WHERE r.subject_kind='PARTNER' AND r.subject_reference=a.partner_user_id::text AND r.lifecycle_state='ACTIVE' AND r.effective_until>$5::timestamptz AND (r.scope_kind='GLOBAL' OR (r.scope_kind='VENDOR_LOCATION' AND r.scope_reference=l.vendor_location_id::text) OR (r.scope_kind='ZONE' AND EXISTS(SELECT 1 FROM marketplace.vendor_service_zones z WHERE z.vendor_location_id=l.vendor_location_id AND z.lifecycle_state='ACTIVE' AND z.zone_name=r.scope_reference)))) AND ST_DWithin(a.current_coordinates,l.coordinates,$2) AND NOT EXISTS(SELECT 1 FROM marketplace.partner_assignment_memberships m WHERE m.user_id=a.partner_user_id AND m.state='ACTIVE') AND NOT (a.partner_user_id = ANY($3::uuid[])) ORDER BY distance_meters LIMIT 50`,
      [input.vendor_location_id, radius, excluded, seenSince, now],
    );
    return r.rows.map((x) => ({ ...x, partner_user_id: parseUuidV7(x.partner_user_id) }));
  }
}
