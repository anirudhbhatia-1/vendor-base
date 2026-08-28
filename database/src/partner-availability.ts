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
export class PartnerAvailabilityConflictError extends Error {}
function partner(c: RequestContext) {
  if (c.actor?.actor_kind !== 'delivery_partner') throw new PartnerAvailabilityAuthorizationError();
  return c.actor.actor_id;
}
function admin(c: RequestContext) {
  if (c.actor?.actor_kind !== 'admin') throw new PartnerAvailabilityAuthorizationError();
}
export class PartnerAvailabilityService {
  readonly #pool: Pool;
  constructor(i: { connection_string: string }) {
    this.#pool = new Pool({
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
      const eligible = await client.query(
        `SELECT 1 FROM marketplace.partner_eligibilities WHERE user_id=$1 AND state='ELIGIBLE' AND (eligible_until IS NULL OR eligible_until>$2)`,
        [id, now],
      );
      if (input.state === 'ONLINE' && !eligible.rows[0])
        throw new PartnerAvailabilityConflictError('Partner is not eligible');
      const pending = await client.query(
        `SELECT 1 FROM marketplace.partner_offline_proofs WHERE partner_user_id=$1 AND sync_state='PENDING'`,
        [id],
      );
      if (input.state === 'ONLINE' && pending.rows[0])
        throw new PartnerAvailabilityConflictError('Sync offline proof before going online');
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
        `INSERT INTO marketplace.partner_availability(partner_user_id,availability_state,current_coordinates,location_accuracy_meters,battery_percent,online_since,accumulated_online_seconds,warning_codes,updated_at) VALUES($1,$2,CASE WHEN $3::float IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($4,$3),4326)::geography END,$5,$6,CASE WHEN $2='ONLINE' THEN $7::timestamptz ELSE NULL END,$8,$9,$7::timestamptz) ON CONFLICT(partner_user_id) DO UPDATE SET availability_state=$2,current_coordinates=COALESCE(EXCLUDED.current_coordinates,partner_availability.current_coordinates),location_accuracy_meters=$5,battery_percent=$6,online_since=CASE WHEN $2='ONLINE' THEN COALESCE(partner_availability.online_since,$7::timestamptz) ELSE NULL END,accumulated_online_seconds=$8,warning_codes=$9,version=partner_availability.version+1,updated_at=$7::timestamptz RETURNING *`,
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
  async eligible(input: {
    context: RequestContext;
    vendor_location_id: UuidV7;
    radius_meters?: number;
  }) {
    admin(input.context);
    const radius = Math.min(Math.max(input.radius_meters ?? 5000, 100), 50000);
    const r = await this.#pool.query(
      `SELECT a.partner_user_id,ST_Distance(a.current_coordinates,l.coordinates)::integer distance_meters,a.warning_codes FROM marketplace.partner_availability a JOIN marketplace.vendor_locations l ON l.vendor_location_id=$1 WHERE a.availability_state='ONLINE' AND ST_DWithin(a.current_coordinates,l.coordinates,$2) AND NOT EXISTS(SELECT 1 FROM marketplace.partner_assignment_memberships m WHERE m.user_id=a.partner_user_id AND m.state='ACTIVE') ORDER BY distance_meters LIMIT 50`,
      [input.vendor_location_id, radius],
    );
    return r.rows.map((x) => ({ ...x, partner_user_id: parseUuidV7(x.partner_user_id) }));
  }
}
