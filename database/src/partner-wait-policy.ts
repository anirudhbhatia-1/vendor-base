import { releaseServicePool, resolveServicePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import { resolveFinancialPolicy } from './financial-policy.js';
import {
  appendWaitEvent,
  closeWaitTimer,
  openWaitTimer,
  waitCreditMinor,
  waitElapsedSeconds,
  waitLeaveSeconds,
  type WaitTimerRow,
} from './wait-timer.js';

export class PartnerWaitAuthorizationError extends Error {}
export class PartnerWaitConflictError extends Error {}
export class PartnerWaitNotFoundError extends Error {}
export class PartnerWaitInputError extends Error {}

type WaitRow = WaitTimerRow;

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
  return waitElapsedSeconds(row, now);
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
    // What the wait is owed so far, by the same arithmetic the handover and
    // the settlement use (9.5): the screen's number is the ledger's number.
    credit_minor: waitCreditMinor(row, now),
    wait_adjustment_minor: adjustmentMinor ?? null,
  };
}
/**
 * This partner's wait on this attempt -- or, for operations, the latest. An
 * attempt is re-offered after a partner leaves, so the wait is keyed by both.
 */
const WAIT_FOR_ACTOR_SQL = `SELECT * FROM marketplace.partner_wait_timers
  WHERE delivery_assignment_id=$1 AND ($2::uuid IS NULL OR partner_user_id=$2::uuid)
  ORDER BY started_at DESC LIMIT 1`;
function requiredRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message);
  return row;
}

export class PartnerWaitPolicyService {
  readonly #pool: Pool;
  constructor(input: { connection_string: string; pool?: Pool }) {
    this.#pool = resolveServicePool(input, {
      application_name: 'partner-wait-policy',
      max: 6,
    });
  }
  async close() {
    await releaseServicePool(this.#pool);
  }

  /**
   * Starts a wait where the server has not already (9.5). At the store the
   * arrival opens the wait itself; this remains for the customer's door
   * (DLP-38) and for an attempt that reached the counter before that rule.
   * A wait already open is returned, not refused.
   */
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
    command(input.command_reference);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const assignment = await client.query<{
        partner_user_id: string;
        assignment_state: string;
        customer_arrival_kind: string | null;
      }>(
        'SELECT partner_user_id,assignment_state,customer_arrival_kind FROM marketplace.delivery_assignments WHERE delivery_assignment_id=$1 FOR UPDATE',
        [input.delivery_assignment_id],
      );
      const assigned = assignment.rows[0];
      if (!assigned) throw new PartnerWaitNotFoundError();
      if (assigned.partner_user_id !== who.actor_id) throw new PartnerWaitNotFoundError();
      // Waiting happens at two real points: the store (AT_VENDOR, DLP-23 and
      // DLP-36) and the customer's door (ARRIVED, DLP-38).
      if (!['AT_VENDOR', 'ARRIVED'].includes(assigned.assignment_state)) {
        throw new PartnerWaitConflictError(
          'Waiting can start once you are at the store or at the customer',
        );
      }
      // Paid waiting at the door needs the door (9.6): an arrival the device
      // could not place at the address is the partner's word, and the
      // unreachable-customer path is a report to support, not a timer.
      if (
        assigned.assignment_state === 'ARRIVED' &&
        assigned.customer_arrival_kind !== 'TRUSTED_LOCATION'
      ) {
        throw new PartnerWaitConflictError(
          'Waiting pay at the door needs your location at the address; report the customer as unreachable instead',
        );
      }
      const { policy } = await resolveFinancialPolicy(client, { at: now });
      const row = await openWaitTimer(client, {
        context: input.context,
        delivery_assignment_id: input.delivery_assignment_id,
        partner_user_id: parseUuidV7(who.actor_id),
        policy,
        leave_threshold_seconds: await waitLeaveSeconds(client, now),
        reason_code: reason(input.reason_code),
        now,
      });
      await client.query('COMMIT');
      return project(row, now);
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
        WHERE timer.delivery_assignment_id=$1
          AND ($2::uuid IS NULL OR timer.partner_user_id=$2::uuid)
        ORDER BY timer.started_at DESC LIMIT 1`,
      [input.delivery_assignment_id, who.actor_kind === 'delivery_partner' ? who.actor_id : null],
    );
    const row = result.rows[0];
    if (!row) throw new PartnerWaitNotFoundError();
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
      const found = await client.query<WaitRow>(`${WAIT_FOR_ACTOR_SQL} FOR UPDATE`, [
        input.delivery_assignment_id,
        who.actor_kind === 'delivery_partner' ? who.actor_id : null,
      ]);
      const row = found.rows[0];
      if (!row) throw new PartnerWaitNotFoundError();
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
      const found = await client.query<WaitRow>(`${WAIT_FOR_ACTOR_SQL} FOR UPDATE`, [
        input.delivery_assignment_id,
        who.actor_id,
      ]);
      let row = found.rows[0];
      if (!row) throw new PartnerWaitNotFoundError();
      if (row.wait_state === 'LEFT_POLICY') {
        const owed = await client.query<{ amount_minor: string }>(
          `SELECT amount_minor::text FROM marketplace.partner_wait_earning_adjustments
            WHERE partner_wait_timer_id=$1`,
          [row.partner_wait_timer_id],
        );
        await client.query('COMMIT');
        return project(row, now, Number(owed.rows[0]?.amount_minor ?? '0'));
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
      // This is the customer's door (DLP-38). Leaving the *store* under the
      // policy returns the attempt to the pool and is the custody service's
      // (`leaveStoreAfterWait`, 9.5); the API routes by where the partner is.
      if (
        !assigned ||
        assigned.assignment_state !== 'ARRIVED' ||
        assigned.custody_state !== 'IN_CUSTODY'
      ) {
        throw new PartnerWaitConflictError('Assignment is no longer eligible for policy leave');
      }
      const contextIds = ids(input.context);
      const commandRef = command(input.command_reference);
      const closed = await closeWaitTimer(client, {
        context: input.context,
        delivery_assignment_id: input.delivery_assignment_id,
        partner_user_id: parseUuidV7(row.partner_user_id),
        outcome: 'LEFT_POLICY',
        command_reference: commandRef,
        reason_code: reason(input.reason_code),
        now,
      });
      if (!closed) throw new PartnerWaitNotFoundError();
      const amount = closed.amount_minor;
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
      row = closed.row;
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
    actor(context);
    await appendWaitEvent(client, row, context, {
      ...input,
      reason_code: reason(input.reason_code),
    });
  }
}
