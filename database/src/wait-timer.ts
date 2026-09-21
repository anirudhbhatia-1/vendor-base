/**
 * The vendor wait, as the server keeps it (9.5).
 *
 * Shared by the custody service, which opens a wait when an arrival is
 * trusted or confirmed and closes it at the handover, and by the wait policy
 * service, which reads, advances and (at the customer's door) closes it. Both
 * work inside the caller's transaction, so the wait and the step it belongs to
 * are one commit.
 *
 * Money: the waiting pay is the financial policy's -- the included minutes,
 * the rate per completed minute after them, the cap -- and is computed here
 * once, from the timer's own recorded parameters, so the number on the
 * partner's screen, the adjustment written at the handover and the earning
 * settled at the door are the same number.
 */
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import type { PoolClient } from 'pg';
import type { FinancialPolicy } from './money-policy.js';
import { resolveConfiguration } from './versioned-configuration.js';

export type WaitState = 'RUNNING' | 'THRESHOLD_ONE' | 'THRESHOLD_TWO' | 'LEFT_POLICY' | 'RESOLVED';

export interface WaitTimerRow {
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
}

/** When a partner may leave the store under the policy: a SETTING, 5–60 minutes. */
export const WAIT_LEAVE_SETTING = 'assignment.wait_leave_seconds';
export const DEFAULT_WAIT_LEAVE_SECONDS = 600;

export async function waitLeaveSeconds(
  queryable: Parameters<typeof resolveConfiguration>[0],
  at?: Date,
): Promise<number> {
  const resolved = await resolveConfiguration(queryable, {
    configuration_key: WAIT_LEAVE_SETTING,
    configuration_kind: 'SETTING',
    ...(at ? { at } : {}),
  });
  const value = resolved?.configuration_value;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 300 && value <= 3600
    ? value
    : DEFAULT_WAIT_LEAVE_SECONDS;
}

/** How long the wait has run, to its end if it has one. */
export function waitElapsedSeconds(row: WaitTimerRow, now: Date): number {
  const until = row.ended_at ?? now;
  return Math.max(0, Math.floor((until.getTime() - row.started_at.getTime()) / 1000));
}

/** The stage a running wait is at, from its thresholds. */
export function waitStage(row: WaitTimerRow, now: Date): WaitState {
  if (row.wait_state === 'LEFT_POLICY' || row.wait_state === 'RESOLVED') return row.wait_state;
  const seconds = waitElapsedSeconds(row, now);
  if (seconds >= row.leave_threshold_seconds) return 'THRESHOLD_TWO';
  if (seconds >= row.first_threshold_seconds) return 'THRESHOLD_ONE';
  return 'RUNNING';
}

/**
 * What the wait is owed so far: completed minutes past the included ones, at
 * the rate, up to the cap the timer was opened with (`max_credit_seconds`
 * carries the cap as time: included plus the minutes the cap buys).
 */
export function waitCreditMinor(row: WaitTimerRow, now: Date): number {
  const seconds = waitElapsedSeconds(row, now);
  const paidSeconds = Math.min(
    Math.max(0, seconds - row.first_threshold_seconds),
    Math.max(0, row.max_credit_seconds - row.first_threshold_seconds),
  );
  return Math.floor(paidSeconds / 60) * row.rate_minor_per_minute;
}

function ids(context: RequestContext) {
  return {
    request: parseRequestId(context.request_id),
    correlation: parseUuidV7(context.correlation_id),
  };
}

export async function appendWaitEvent(
  client: PoolClient,
  row: WaitTimerRow,
  context: RequestContext,
  input: {
    readonly event_type: 'STARTED' | 'THRESHOLD_ONE' | 'THRESHOLD_TWO' | 'LEFT_POLICY' | 'RESOLVED';
    readonly elapsed_seconds: number;
    readonly command_reference: string | null;
    readonly reason_code: string;
    readonly now: Date;
  },
): Promise<void> {
  const who = context.actor;
  if (!who) throw new Error('A wait event needs an actor');
  const contextIds = ids(context);
  // Untargeted DO NOTHING covers every unique constraint on the table, so a
  // replayed command is a no-op rather than a crash.
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
      input.reason_code,
      contextIds.request,
      contextIds.correlation,
      input.now,
    ],
  );
}

/**
 * Opens the wait for this partner on this attempt, under the policy in force,
 * unless one is already open. Returns the row either way.
 */
export async function openWaitTimer(
  client: PoolClient,
  input: {
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
    readonly partner_user_id: UuidV7;
    readonly policy: FinancialPolicy;
    readonly leave_threshold_seconds: number;
    readonly reason_code: string;
    readonly now: Date;
  },
): Promise<WaitTimerRow> {
  const existing = await client.query<WaitTimerRow>(
    `SELECT * FROM marketplace.partner_wait_timers
      WHERE delivery_assignment_id=$1 AND partner_user_id=$2 FOR UPDATE`,
    [input.delivery_assignment_id, input.partner_user_id],
  );
  if (existing.rows[0]) return existing.rows[0];
  const included = input.policy.wait_included_seconds;
  const capMinutes =
    input.policy.wait_per_completed_minute_minor > 0
      ? Math.floor(input.policy.wait_cap_minor / input.policy.wait_per_completed_minute_minor)
      : 0;
  // The leave threshold sits after the included minutes; the credit runs at
  // least until the partner may leave.
  const leave = Math.max(input.leave_threshold_seconds, included + 60);
  const maxCredit = Math.max(leave, included + capMinutes * 60);
  const contextIds = ids(input.context);
  const inserted = await client.query<WaitTimerRow>(
    `INSERT INTO marketplace.partner_wait_timers
      (partner_wait_timer_id,delivery_assignment_id,partner_user_id,started_at,
       first_threshold_seconds,leave_threshold_seconds,max_credit_seconds,
       rate_minor_per_minute,request_id,correlation_id,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$4,$4) RETURNING *`,
    [
      createUuidV7({ now_ms: input.now.getTime() }),
      input.delivery_assignment_id,
      input.partner_user_id,
      input.now,
      included,
      leave,
      maxCredit,
      input.policy.wait_per_completed_minute_minor,
      contextIds.request,
      contextIds.correlation,
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('Wait timer insert returned no row');
  await appendWaitEvent(client, row, input.context, {
    event_type: 'STARTED',
    elapsed_seconds: 0,
    command_reference: null,
    reason_code: input.reason_code,
    now: input.now,
  });
  return row;
}

/**
 * Closes this partner's wait on this attempt -- RESOLVED at the handover,
 * LEFT_POLICY when they leave under the policy -- and records what it is
 * owed, once. Returns the amount, or null when there was no open wait.
 */
export async function closeWaitTimer(
  client: PoolClient,
  input: {
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
    readonly partner_user_id: UuidV7;
    readonly outcome: 'RESOLVED' | 'LEFT_POLICY';
    readonly command_reference: string | null;
    readonly reason_code: string;
    readonly now: Date;
  },
): Promise<{ readonly row: WaitTimerRow; readonly amount_minor: number } | null> {
  const found = await client.query<WaitTimerRow>(
    `SELECT * FROM marketplace.partner_wait_timers
      WHERE delivery_assignment_id=$1 AND partner_user_id=$2 FOR UPDATE`,
    [input.delivery_assignment_id, input.partner_user_id],
  );
  const open = found.rows[0];
  if (!open) return null;
  if (open.wait_state === 'RESOLVED' || open.wait_state === 'LEFT_POLICY') {
    const owed = await client.query<{ amount_minor: string }>(
      `SELECT amount_minor::text FROM marketplace.partner_wait_earning_adjustments
        WHERE partner_wait_timer_id=$1`,
      [open.partner_wait_timer_id],
    );
    return { row: open, amount_minor: Number(owed.rows[0]?.amount_minor ?? '0') };
  }
  const elapsed = waitElapsedSeconds(open, input.now);
  const amount = waitCreditMinor(open, input.now);
  const closed = await client.query<WaitTimerRow>(
    `UPDATE marketplace.partner_wait_timers
        SET wait_state=$2, ended_at=$3, version=version+1, updated_at=$3
      WHERE partner_wait_timer_id=$1 RETURNING *`,
    [open.partner_wait_timer_id, input.outcome, input.now],
  );
  const row = closed.rows[0];
  if (!row) throw new Error('Wait timer close returned no row');
  const contextIds = ids(input.context);
  await client.query(
    `INSERT INTO marketplace.partner_wait_earning_adjustments
      (partner_wait_earning_adjustment_id,partner_wait_timer_id,delivery_assignment_id,
       partner_user_id,eligible_wait_seconds,amount_minor,reason_code,request_id,correlation_id,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (delivery_assignment_id, partner_user_id) DO NOTHING`,
    [
      createUuidV7({ now_ms: input.now.getTime() }),
      row.partner_wait_timer_id,
      row.delivery_assignment_id,
      row.partner_user_id,
      elapsed,
      amount,
      input.reason_code,
      contextIds.request,
      contextIds.correlation,
      input.now,
    ],
  );
  await appendWaitEvent(client, row, input.context, {
    event_type: input.outcome,
    elapsed_seconds: elapsed,
    command_reference: input.command_reference,
    reason_code: input.reason_code,
    now: input.now,
  });
  return { row, amount_minor: amount };
}
