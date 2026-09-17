import { createDatabasePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';

export class PartnerWaitAuthorizationError extends Error {}
export class PartnerWaitConflictError extends Error {}
export class PartnerWaitNotFoundError extends Error {}
export class PartnerWaitInputError extends Error {}

type WaitState = 'RUNNING' | 'THRESHOLD_ONE' | 'THRESHOLD_TWO' | 'LEFT_POLICY' | 'RESOLVED';
type WaitRow = {
  partner_wait_timer_id: string;
  delivery_assignment_id: string;
  partner_user_id: string;
  wait_state: WaitState;
  started_at: Date;
  first_threshold_seconds: number;
  leave_threshold_seconds: number;
  max_credit_seconds: number;
  rate_minor_per_minute: number;
  ended_at: Date | null;
  version: number;
};

function actor(context: RequestContext) {
  const found = context.actor;
  if (!found || !['delivery_partner', 'system', 'admin'].includes(found.actor_kind)) {
    throw new PartnerWaitAuthorizationError();
  }
  return found;
}
function reason(value: string) {
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(value)) throw new PartnerWaitInputError();
  return value;
}
function command(value: string) {
  // The shape `assignment_event_command_shape` (0014) enforces, so a reference
  // the schema refuses is a 400 here and not a 500 from the database.
  if (!/^SYNTH-CMD-[A-Z0-9-]{4,64}$/.test(value)) throw new PartnerWaitInputError();
  return value;
}
function ids(context: RequestContext) {
  return {
    request: parseRequestId(context.request_id),
    correlation: parseUuidV7(context.correlation_id),
  };
}
/**
 * How long the wait ran.
 *
 * A finished timer is measured to the moment it ended, not to now. Measuring
 * against the clock regardless meant a wait that closed days ago kept counting:
 * the partner's screen showed a number that grew forever, and the credit shown
 * beside it grew with it.
 */
function elapsed(row: WaitRow, now: Date) {
  const until = row.ended_at ?? now;
  return Math.max(0, Math.floor((until.getTime() - row.started_at.getTime()) / 1000));
}
function project(row: WaitRow, now: Date, adjustmentMinor?: number) {
  return {
    ...row,
    partner_wait_timer_id: parseUuidV7(row.partner_wait_timer_id),
    delivery_assignment_id: parseUuidV7(row.delivery_assignment_id),
    partner_user_id: parseUuidV7(row.partner_user_id),
    started_at: row.started_at.toISOString(),
    ended_at: row.ended_at?.toISOString() ?? null,
    elapsed_seconds: elapsed(row, now),
    wait_adjustment_minor: adjustmentMinor ?? null,
  };
}
function requiredRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message);
  return row;
}

export class PartnerWaitPolicyService {
  readonly #pool: Pool;
  constructor(input: { connection_string: string }) {
    this.#pool = createDatabasePool({
      application_name: 'partner-wait-policy',
      connectionString: input.connection_string,
      max: 6,
    });
  }
  async close() {
    await this.#pool.end();
  }

  async start(input: {
    context: RequestContext;
    delivery_assignment_id: UuidV7;
    command_reference: string;
    reason_code: string;
    now?: Date;
  }) {
    const who = actor(input.context);
    if (who.actor_kind !== 'delivery_partner') throw new PartnerWaitAuthorizationError();
    const now = input.now ?? new Date();
    const contextIds = ids(input.context);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const assignment = await client.query<{ partner_user_id: string; assignment_state: string }>(
        'SELECT partner_user_id,assignment_state FROM marketplace.delivery_assignments WHERE delivery_assignment_id=$1 FOR UPDATE',
        [input.delivery_assignment_id],
      );
      const assigned = assignment.rows[0];
      if (!assigned) throw new PartnerWaitNotFoundError();
      if (assigned.partner_user_id !== who.actor_id) throw new PartnerWaitNotFoundError();
      // Waiting happens at two real points, and this only ever admitted the
      // second one. DLP-23 and DLP-36 are the *vendor* wait — architecture
      // §10.1 puts WAITING between AT_VENDOR and PICKUP_VERIFIED — so a partner
      // standing in a shop that is not ready could never start their timer and
      // never accrued waiting pay. ARRIVED stays valid because a customer who
      // cannot be reached is also a wait the partner is owed for (DLP-38).
      if (!['AT_VENDOR', 'ARRIVED'].includes(assigned.assignment_state)) {
        throw new PartnerWaitConflictError(
          'Waiting can start once you are at the store or at the customer',
        );
      }
      const timerId = createUuidV7({ now_ms: now.getTime() });
      let inserted;
      try {
        inserted = await client.query<WaitRow>(
          `INSERT INTO marketplace.partner_wait_timers
            (partner_wait_timer_id,delivery_assignment_id,partner_user_id,started_at,
             first_threshold_seconds,leave_threshold_seconds,max_credit_seconds,
             rate_minor_per_minute,request_id,correlation_id,created_at,updated_at)
           VALUES($1,$2,$3,$4,300,600,3600,100,$5,$6,$4,$4) RETURNING *`,
          [
            timerId,
            input.delivery_assignment_id,
            who.actor_id,
            now,
            contextIds.request,
            contextIds.correlation,
          ],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new PartnerWaitConflictError('A wait timer already exists for this assignment');
        }
        throw error;
      }
      const created = requiredRow(inserted.rows[0], 'Wait timer insert returned no row');
      await this.#event(client, created, input.context, {
        event_type: 'STARTED',
        elapsed_seconds: 0,
        command_reference: command(input.command_reference),
        reason_code: reason(input.reason_code),
        now,
      });
      await client.query('COMMIT');
      return project(created, now);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(input: { context: RequestContext; delivery_assignment_id: UuidV7; now?: Date }) {
    const who = actor(input.context);
    const result = await this.#pool.query<WaitRow & { amount_minor: string | null }>(
      `SELECT timer.*,adjustment.amount_minor::text
         FROM marketplace.partner_wait_timers timer
         LEFT JOIN marketplace.partner_wait_earning_adjustments adjustment USING(partner_wait_timer_id)
        WHERE timer.delivery_assignment_id=$1`,
      [input.delivery_assignment_id],
    );
    const row = result.rows[0];
    if (!row) throw new PartnerWaitNotFoundError();
    if (who.actor_kind === 'delivery_partner' && row.partner_user_id !== who.actor_id) {
      throw new PartnerWaitNotFoundError();
    }
    return project(
      row,
      input.now ?? new Date(),
      row.amount_minor === null ? undefined : Number(row.amount_minor),
    );
  }

  async advanceDue(input: { context: RequestContext; now?: Date; limit?: number }) {
    const who = actor(input.context);
    if (!['system', 'admin'].includes(who.actor_kind)) throw new PartnerWaitAuthorizationError();
    const now = input.now ?? new Date();
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const due = await client.query<WaitRow>(
        `SELECT * FROM marketplace.partner_wait_timers
          WHERE wait_state IN ('RUNNING','THRESHOLD_ONE')
            AND started_at + make_interval(secs => first_threshold_seconds) <= $1
          ORDER BY started_at,partner_wait_timer_id FOR UPDATE SKIP LOCKED LIMIT $2`,
        [now, limit],
      );
      for (const row of due.rows) await this.#advanceLocked(client, row, input.context, now);
      await client.query('COMMIT');
      return due.rows.length;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async refresh(input: { context: RequestContext; delivery_assignment_id: UuidV7; now?: Date }) {
    const who = actor(input.context);
    const now = input.now ?? new Date();
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query<WaitRow>(
        'SELECT * FROM marketplace.partner_wait_timers WHERE delivery_assignment_id=$1 FOR UPDATE',
        [input.delivery_assignment_id],
      );
      const row = found.rows[0];
      if (!row) throw new PartnerWaitNotFoundError();
      if (who.actor_kind === 'delivery_partner' && row.partner_user_id !== who.actor_id) {
        throw new PartnerWaitNotFoundError();
      }
      const updated = await this.#advanceLocked(client, row, input.context, now);
      await client.query('COMMIT');
      return project(updated, now);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async leave(input: {
    context: RequestContext;
    delivery_assignment_id: UuidV7;
    command_reference: string;
    reason_code: string;
    now?: Date;
  }) {
    const who = actor(input.context);
    if (who.actor_kind !== 'delivery_partner') throw new PartnerWaitAuthorizationError();
    const now = input.now ?? new Date();
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query<WaitRow>(
        'SELECT * FROM marketplace.partner_wait_timers WHERE delivery_assignment_id=$1 FOR UPDATE',
        [input.delivery_assignment_id],
      );
      let row = found.rows[0];
      if (!row || row.partner_user_id !== who.actor_id) throw new PartnerWaitNotFoundError();
      if (row.wait_state === 'LEFT_POLICY') {
        await client.query('COMMIT');
        return project(row, now);
      }
      row = await this.#advanceLocked(client, row, input.context, now);
      if (row.wait_state !== 'THRESHOLD_TWO') {
        throw new PartnerWaitConflictError('Leave policy threshold has not been reached');
      }
      const assignment = await client.query<{
        version: number;
        assignment_state: string;
        custody_state: string;
      }>(
        'SELECT version,assignment_state,custody_state FROM marketplace.delivery_assignments WHERE delivery_assignment_id=$1 FOR UPDATE',
        [input.delivery_assignment_id],
      );
      const assigned = assignment.rows[0];
      if (
        !assigned ||
        assigned.assignment_state !== 'ARRIVED' ||
        assigned.custody_state !== 'IN_CUSTODY'
      ) {
        throw new PartnerWaitConflictError('Assignment is no longer eligible for policy leave');
      }
      const seconds = Math.min(
        row.max_credit_seconds,
        Math.max(0, elapsed(row, now) - row.first_threshold_seconds),
      );
      const amount = Math.ceil(seconds / 60) * row.rate_minor_per_minute;
      const contextIds = ids(input.context);
      await client.query(
        `INSERT INTO marketplace.partner_wait_earning_adjustments
          (partner_wait_earning_adjustment_id,partner_wait_timer_id,delivery_assignment_id,
           partner_user_id,eligible_wait_seconds,amount_minor,reason_code,request_id,correlation_id,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(delivery_assignment_id) DO NOTHING`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          row.partner_wait_timer_id,
          row.delivery_assignment_id,
          row.partner_user_id,
          seconds,
          amount,
          reason(input.reason_code),
          contextIds.request,
          contextIds.correlation,
          now,
        ],
      );
      const commandRef = command(input.command_reference);
      await client.query(
        `INSERT INTO marketplace.assignment_events
          (assignment_event_id,delivery_assignment_id,assignment_version,event_type,
           previous_state,resulting_state,previous_custody_state,resulting_custody_state,
           actor_id,actor_kind,reason_code,command_reference,request_id,correlation_id,occurred_at,
           partner_user_id)
         VALUES($1,$2,$3,'DELIVERY_FAILED','ARRIVED','DELIVERY_FAILED','IN_CUSTODY','IN_CUSTODY',
           $4,'delivery_partner',$5,$6,$7,$8,$9,$10)`,
        [
          createUuidV7({ now_ms: now.getTime() + 1 }),
          row.delivery_assignment_id,
          assigned.version + 1,
          who.actor_id,
          reason(input.reason_code),
          commandRef,
          contextIds.request,
          contextIds.correlation,
          now,
          row.partner_user_id,
        ],
      );
      await client.query(
        `UPDATE marketplace.delivery_assignments SET assignment_state='DELIVERY_FAILED',
          version=version+1,updated_at=$2 WHERE delivery_assignment_id=$1`,
        [row.delivery_assignment_id, now],
      );
      const closed = await client.query<WaitRow>(
        `UPDATE marketplace.partner_wait_timers SET wait_state='LEFT_POLICY',ended_at=$2,
          version=version+1,updated_at=$2 WHERE partner_wait_timer_id=$1 RETURNING *`,
        [row.partner_wait_timer_id, now],
      );
      row = requiredRow(closed.rows[0], 'Wait timer close returned no row');
      await this.#event(client, row, input.context, {
        event_type: 'LEFT_POLICY',
        elapsed_seconds: elapsed(row, now),
        command_reference: commandRef,
        reason_code: input.reason_code,
        now,
      });
      await client.query('COMMIT');
      return project(row, now, amount);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async #advanceLocked(client: PoolClient, row: WaitRow, context: RequestContext, now: Date) {
    const seconds = elapsed(row, now);
    let next = row.wait_state;
    if (seconds >= row.leave_threshold_seconds) next = 'THRESHOLD_TWO';
    else if (seconds >= row.first_threshold_seconds) next = 'THRESHOLD_ONE';
    if (next === row.wait_state) return row;
    const stages: Array<'THRESHOLD_ONE' | 'THRESHOLD_TWO'> = [];
    if (row.wait_state === 'RUNNING' && seconds >= row.first_threshold_seconds)
      stages.push('THRESHOLD_ONE');
    if (seconds >= row.leave_threshold_seconds) stages.push('THRESHOLD_TWO');
    for (const stage of stages) {
      await this.#event(client, row, context, {
        event_type: stage,
        elapsed_seconds:
          stage === 'THRESHOLD_ONE' ? row.first_threshold_seconds : row.leave_threshold_seconds,
        command_reference: null,
        reason_code:
          stage === 'THRESHOLD_ONE' ? 'WAIT_THRESHOLD_ONE_REACHED' : 'WAIT_LEAVE_ALLOWED',
        now,
      });
    }
    const updated = await client.query<WaitRow>(
      `UPDATE marketplace.partner_wait_timers SET wait_state=$2,version=version+1,updated_at=$3
        WHERE partner_wait_timer_id=$1 RETURNING *`,
      [row.partner_wait_timer_id, next, now],
    );
    return requiredRow(updated.rows[0], 'Wait timer advance returned no row');
  }

  /**
   * Appends one wait event, idempotently.
   *
   * The conflict target used to name only (timer, event type), which left the
   * separate unique index on `command_reference` uncovered: replaying a command
   * — the exact thing a command reference exists to make safe (§15) — raised an
   * unhandled duplicate-key error and surfaced to the partner as a server
   * fault. Untargeted `DO NOTHING` covers every unique constraint on the table,
   * so a repeat is a no-op rather than a crash.
   */
  async #event(
    client: PoolClient,
    row: WaitRow,
    context: RequestContext,
    input: {
      event_type: 'STARTED' | 'THRESHOLD_ONE' | 'THRESHOLD_TWO' | 'LEFT_POLICY';
      elapsed_seconds: number;
      command_reference: string | null;
      reason_code: string;
      now: Date;
    },
  ) {
    const who = actor(context);
    const contextIds = ids(context);
    await client.query(
      `INSERT INTO marketplace.partner_wait_timer_events
        (partner_wait_timer_event_id,partner_wait_timer_id,event_type,elapsed_seconds,
         actor_id,actor_kind,command_reference,reason_code,request_id,correlation_id,occurred_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
      [
        createUuidV7({ now_ms: input.now.getTime() }),
        row.partner_wait_timer_id,
        input.event_type,
        input.elapsed_seconds,
        who.actor_id,
        who.actor_kind,
        input.command_reference,
        reason(input.reason_code),
        contextIds.request,
        contextIds.correlation,
        input.now,
      ],
    );
  }
}
