import { createHash, randomInt } from 'node:crypto';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import { InventoryReservationService } from './inventory-reservations.js';

export class FulfilmentInputError extends Error {}
export class FulfilmentNotFoundError extends Error {}
export class FulfilmentConflictError extends Error {}
export class FulfilmentAuthorizationError extends Error {}
export class PickupOtpMismatchError extends Error {}
export class PickupOtpExhaustedError extends Error {}
export class PickupOtpExpiredError extends Error {}

/**
 * How long a customer has to answer a substitution/weight proposal before the
 * system auto-times it out. Kept as a policy default here rather than a
 * versioned configuration because a decision timeout is a mechanical safety
 * rail (never leave a picker blocked), not a merchant-tunable rule.
 */
export const DEFAULT_DECISION_DEADLINE_SECONDS = 300;

/**
 * Pickup OTP lifetime and attempt ceiling. Both are safety rails, not policy;
 * a longer window would let a stale slip walk in, and more attempts would
 * approach brute-force distance on a six-digit space.
 */
export const PICKUP_OTP_LIFETIME_SECONDS = 15 * 60;
export const PICKUP_OTP_MAX_ATTEMPTS = 5;

/** Default vendor response deadline if the caller does not override it. */
export const DEFAULT_ACCEPT_DEADLINE_SECONDS = 3 * 60;

export type VendorOrderState =
  'PLACED' | 'ACCEPTED' | 'PICKING' | 'READY' | 'PICKED_UP' | 'CANCELLED' | 'EXPIRED';

export type PickState =
  | 'FOUND'
  | 'MISSING'
  | 'PROPOSED_SUBSTITUTION'
  | 'PROPOSED_WEIGHT'
  | 'SUBSTITUTION_APPROVED'
  | 'SUBSTITUTION_REJECTED'
  | 'WEIGHT_APPROVED'
  | 'WEIGHT_REJECTED';

export type DecisionAnswer = 'PENDING' | 'APPROVED' | 'REJECTED' | 'TIMED_OUT';

export interface VendorOrderSummary {
  readonly vendor_order_id: UuidV7;
  readonly order_reference: string;
  readonly lifecycle_state: VendorOrderState;
  readonly total_minor: number;
  readonly version: number;
  readonly accept_by: Date | null;
  readonly accepted_at: Date | null;
  readonly ready_at: Date | null;
  readonly picked_up_at: Date | null;
  readonly package_count: number | null;
  readonly package_condition_note: string | null;
  readonly preparation_estimate_seconds: number | null;
  readonly pickup_otp_expires_at: Date | null;
  readonly pickup_otp_attempts: number;
  readonly decline_reason_code: string | null;
}

export interface PickRecord {
  readonly pick_id: UuidV7;
  readonly vendor_order_line_id: UuidV7;
  readonly pick_state: PickState;
  readonly actual_quantity: number | null;
  readonly actual_unit_price_minor: number | null;
  readonly substitution_variant_id: UuidV7 | null;
  readonly version: number;
}

export interface DecisionRecord {
  readonly decision_id: UuidV7;
  readonly vendor_order_id: UuidV7;
  readonly pick_id: UuidV7;
  readonly proposal_kind: 'SUBSTITUTION' | 'WEIGHT';
  readonly proposed_variant_id: UuidV7 | null;
  readonly proposed_quantity: number;
  readonly proposed_unit_price_minor: number;
  readonly authorization_delta_minor: number;
  readonly reason_note: string;
  readonly decision_deadline_at: Date;
  readonly answer: DecisionAnswer;
  readonly answered_at: Date | null;
}

interface Ids {
  readonly request: string;
  readonly correlation: string;
}

const reasonCode = /^[A-Z][A-Z0-9_]{2,63}$/;

async function tx<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function contextIds(context: RequestContext): Ids {
  return {
    request: parseRequestId(context.request_id),
    correlation: parseUuidV7(context.correlation_id),
  };
}

/**
 * Vendor staff at this order's location resolve to a `staff_memberships` row.
 * Locking their own membership row inside the transaction gives a stable
 * (userId, role) for the whole call.
 */
async function requireVendorMember(
  client: PoolClient,
  context: RequestContext,
  vendorLocationId: UuidV7,
): Promise<{ readonly userId: UuidV7 }> {
  if (context.actor?.actor_kind !== 'vendor_staff') throw new FulfilmentAuthorizationError();
  const userId = context.actor.actor_id;
  const result = await client.query<{ role_key: string }>(
    `SELECT ra.role_key
       FROM marketplace.role_assignments ra
       JOIN marketplace.staff_memberships sm USING (role_assignment_id)
      WHERE ra.user_id=$1 AND sm.vendor_location_id=$2 AND ra.state='ACTIVE'
        AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
      LIMIT 1`,
    [userId, vendorLocationId],
  );
  if (!result.rows[0]) throw new FulfilmentAuthorizationError();
  return { userId };
}

function requireCustomer(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'customer') throw new FulfilmentAuthorizationError();
  return context.actor.actor_id;
}

function requireSystemOrVendor(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'system' && context.actor?.actor_kind !== 'vendor_staff') {
    throw new FulfilmentAuthorizationError();
  }
  return context.actor.actor_id;
}

async function lockOrder(
  client: PoolClient,
  vendorOrderId: UuidV7,
): Promise<{
  readonly vendor_order_id: string;
  readonly vendor_location_id: string;
  readonly checkout_group_id: string;
  readonly lifecycle_state: VendorOrderState;
  readonly version: number;
  readonly accept_by: Date | null;
  readonly pickup_otp_hash: string | null;
  readonly pickup_otp_expires_at: Date | null;
  readonly pickup_otp_attempts: number;
  readonly total_minor: string;
}> {
  const result = await client.query(
    `SELECT vendor_order_id, vendor_location_id, checkout_group_id, lifecycle_state, version,
            accept_by, pickup_otp_hash, pickup_otp_expires_at, pickup_otp_attempts,
            total_minor::text AS total_minor
       FROM marketplace.vendor_orders WHERE vendor_order_id=$1 FOR UPDATE`,
    [vendorOrderId],
  );
  const row = result.rows[0];
  if (!row) throw new FulfilmentNotFoundError();
  return row;
}

async function appendEvent(
  client: PoolClient,
  input: {
    readonly vendor_order_id: UuidV7;
    readonly event_type: string;
    readonly actor_id: UuidV7;
    readonly actor_kind: 'customer' | 'vendor_staff' | 'system';
    readonly previous_state: VendorOrderState | null;
    readonly resulting_state: VendorOrderState | null;
    readonly reason_code: string;
    readonly note?: string | null;
    readonly ids: Ids;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO marketplace.vendor_order_events
       (event_id, vendor_order_id, event_type, actor_id, actor_kind, previous_state,
        resulting_state, reason_code, note, request_id, correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      createUuidV7(),
      input.vendor_order_id,
      input.event_type,
      input.actor_id,
      input.actor_kind,
      input.previous_state,
      input.resulting_state,
      input.reason_code,
      input.note ?? null,
      input.ids.request,
      input.ids.correlation,
    ],
  );
}

function projectSummary(row: Record<string, unknown>): VendorOrderSummary {
  return Object.freeze({
    vendor_order_id: parseUuidV7(row['vendor_order_id'] as string),
    order_reference: row['order_reference'] as string,
    lifecycle_state: row['lifecycle_state'] as VendorOrderState,
    total_minor: Number(row['total_minor']),
    version: row['version'] as number,
    accept_by: (row['accept_by'] as Date | null) ?? null,
    accepted_at: (row['accepted_at'] as Date | null) ?? null,
    ready_at: (row['ready_at'] as Date | null) ?? null,
    picked_up_at: (row['picked_up_at'] as Date | null) ?? null,
    package_count: (row['package_count'] as number | null) ?? null,
    package_condition_note: (row['package_condition_note'] as string | null) ?? null,
    preparation_estimate_seconds: (row['preparation_estimate_seconds'] as number | null) ?? null,
    pickup_otp_expires_at: (row['pickup_otp_expires_at'] as Date | null) ?? null,
    pickup_otp_attempts: row['pickup_otp_attempts'] as number,
    decline_reason_code: (row['decline_reason_code'] as string | null) ?? null,
  });
}

function projectPick(row: Record<string, unknown>): PickRecord {
  return Object.freeze({
    pick_id: parseUuidV7(row['pick_id'] as string),
    vendor_order_line_id: parseUuidV7(row['vendor_order_line_id'] as string),
    pick_state: row['pick_state'] as PickState,
    actual_quantity: (row['actual_quantity'] as number | null) ?? null,
    actual_unit_price_minor: row['actual_unit_price_minor']
      ? Number(row['actual_unit_price_minor'])
      : null,
    substitution_variant_id: row['substitution_variant_id']
      ? parseUuidV7(row['substitution_variant_id'] as string)
      : null,
    version: row['version'] as number,
  });
}

function projectDecision(row: Record<string, unknown>): DecisionRecord {
  return Object.freeze({
    decision_id: parseUuidV7(row['decision_id'] as string),
    vendor_order_id: parseUuidV7(row['vendor_order_id'] as string),
    pick_id: parseUuidV7(row['pick_id'] as string),
    proposal_kind: row['proposal_kind'] as 'SUBSTITUTION' | 'WEIGHT',
    proposed_variant_id: row['proposed_variant_id']
      ? parseUuidV7(row['proposed_variant_id'] as string)
      : null,
    proposed_quantity: row['proposed_quantity'] as number,
    proposed_unit_price_minor: Number(row['proposed_unit_price_minor']),
    authorization_delta_minor: Number(row['authorization_delta_minor']),
    reason_note: row['reason_note'] as string,
    decision_deadline_at: row['decision_deadline_at'] as Date,
    answer: row['answer'] as DecisionAnswer,
    answered_at: (row['answered_at'] as Date | null) ?? null,
  });
}

/**
 * Every route in this service converges on the vendor_order aggregate,
 * consuming inventory holds committed by Phase 7 checkout and producing
 * customer-facing state changes. Payment capture and ledger posting stay in
 * MoneyLifecycleService; this service triggers them via an outbox event on
 * pickup.
 */
export class VendorFulfilmentService {
  readonly #pool: Pool;
  readonly #inventory: InventoryReservationService;

  constructor(input: {
    readonly connection_string: string;
    readonly inventory: InventoryReservationService;
  }) {
    this.#pool = new Pool({
      connectionString: input.connection_string,
      application_name: 'neighbourhood-store-vendor-fulfilment',
      max: 8,
    });
    this.#inventory = input.inventory;
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  // -----------------------------------------------------------------------
  // 8.1 -- issue an accept-by deadline (system, at checkout completion time)
  // -----------------------------------------------------------------------

  /**
   * Called by the checkout finalizer (or a maintenance backfill) to attach a
   * response deadline to every freshly-PLACED vendor_order in a checkout
   * group. Idempotent: rows that already carry an accept_by are untouched.
   */
  async issueAcceptDeadlines(input: {
    readonly context: RequestContext;
    readonly checkout_group_id: UuidV7;
    readonly deadline_seconds?: number;
    readonly now?: Date;
  }): Promise<readonly UuidV7[]> {
    requireSystemOrVendor(input.context);
    const seconds = input.deadline_seconds ?? DEFAULT_ACCEPT_DEADLINE_SECONDS;
    if (seconds < 30 || seconds > 30 * 60) {
      throw new FulfilmentInputError('Response deadline must be between 30s and 30 minutes');
    }
    const now = input.now ?? new Date();
    const deadline = new Date(now.getTime() + seconds * 1000);
    return tx(this.#pool, async (client) => {
      const updated = await client.query<{ vendor_order_id: string }>(
        `UPDATE marketplace.vendor_orders SET accept_by=$2, updated_at=$3
          WHERE checkout_group_id=$1 AND lifecycle_state='PLACED' AND accept_by IS NULL
          RETURNING vendor_order_id`,
        [input.checkout_group_id, deadline, now],
      );
      return Object.freeze(updated.rows.map((row) => parseUuidV7(row.vendor_order_id)));
    });
  }

  // -----------------------------------------------------------------------
  // 8.2 -- accept and decline
  // -----------------------------------------------------------------------

  async accept(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly expected_version: number;
    readonly preparation_estimate_seconds: number;
    readonly now?: Date;
  }): Promise<VendorOrderSummary> {
    if (
      !Number.isSafeInteger(input.preparation_estimate_seconds) ||
      input.preparation_estimate_seconds < 60 ||
      input.preparation_estimate_seconds > 14400
    ) {
      throw new FulfilmentInputError('Preparation estimate must be between 60 and 14400 seconds');
    }
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'PLACED')
        throw new FulfilmentConflictError('Only a placed order can be accepted');
      if (order.version !== input.expected_version)
        throw new FulfilmentConflictError('Vendor order version has advanced');
      if (order.accept_by && order.accept_by <= now)
        throw new FulfilmentConflictError('The response deadline has passed');
      const version = order.version + 1;
      const ids = contextIds(input.context);
      const updated = await client.query(
        `UPDATE marketplace.vendor_orders
            SET lifecycle_state='ACCEPTED', accepted_at=$2, preparation_estimate_seconds=$3,
                version=$4, updated_at=$2
          WHERE vendor_order_id=$1
        RETURNING vendor_order_id, order_reference, lifecycle_state, total_minor::text AS total_minor,
                  version, accept_by, accepted_at, ready_at, picked_up_at, package_count,
                  package_condition_note, preparation_estimate_seconds, pickup_otp_expires_at,
                  pickup_otp_attempts, decline_reason_code`,
        [input.vendor_order_id, now, input.preparation_estimate_seconds, version],
      );
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'ACCEPTED',
        actor_id: userId,
        actor_kind: 'vendor_staff',
        previous_state: 'PLACED',
        resulting_state: 'ACCEPTED',
        reason_code: 'VENDOR_ACCEPTED',
        ids,
      });
      return projectSummary(updated.rows[0] as Record<string, unknown>);
    });
  }

  /**
   * Decline moves the order to CANCELLED and releases its inventory holds so
   * a sibling order in the same checkout group is not blocked. The customer
   * refund path is triggered by the outbox event this appends, not by this
   * service directly - MoneyLifecycleService owns the ledger.
   */
  async decline(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly expected_version: number;
    readonly reason_code: string;
    readonly note?: string;
    readonly now?: Date;
  }): Promise<VendorOrderSummary> {
    if (!reasonCode.test(input.reason_code))
      throw new FulfilmentInputError('Reason code must be shouting-snake-case');
    if (input.note !== undefined && (input.note.length < 1 || input.note.length > 240))
      throw new FulfilmentInputError('Note must be between 1 and 240 characters');
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'PLACED')
        throw new FulfilmentConflictError('Only a placed order can be declined');
      if (order.version !== input.expected_version)
        throw new FulfilmentConflictError('Vendor order version has advanced');
      const version = order.version + 1;
      const ids = contextIds(input.context);
      const updated = await client.query(
        `UPDATE marketplace.vendor_orders
            SET lifecycle_state='CANCELLED', decline_reason_code=$2, decline_note=$3,
                version=$4, updated_at=$5
          WHERE vendor_order_id=$1
        RETURNING vendor_order_id, order_reference, lifecycle_state, total_minor::text AS total_minor,
                  version, accept_by, accepted_at, ready_at, picked_up_at, package_count,
                  package_condition_note, preparation_estimate_seconds, pickup_otp_expires_at,
                  pickup_otp_attempts, decline_reason_code`,
        [input.vendor_order_id, input.reason_code, input.note ?? null, version, now],
      );
      await this.#releaseHolds(client, input.vendor_order_id);
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'DECLINED',
        actor_id: userId,
        actor_kind: 'vendor_staff',
        previous_state: 'PLACED',
        resulting_state: 'CANCELLED',
        reason_code: input.reason_code,
        note: input.note ?? null,
        ids,
      });
      return projectSummary(updated.rows[0] as Record<string, unknown>);
    });
  }

  /**
   * Cron/worker entry point: any PLACED order whose accept_by has passed is
   * cancelled with reason ACCEPT_DEADLINE_TIMEOUT and its holds are released.
   */
  async timeoutOverdueAccepts(input: {
    readonly context: RequestContext;
    readonly now?: Date;
  }): Promise<readonly UuidV7[]> {
    const systemActorId = requireSystemOrVendor(input.context);
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const overdue = await client.query<{ vendor_order_id: string; version: number }>(
        `SELECT vendor_order_id, version FROM marketplace.vendor_orders
          WHERE lifecycle_state='PLACED' AND accept_by IS NOT NULL AND accept_by <= $1
          FOR UPDATE SKIP LOCKED`,
        [now],
      );
      const ids = contextIds(input.context);
      const timedOut: UuidV7[] = [];
      for (const row of overdue.rows) {
        const orderId = parseUuidV7(row.vendor_order_id);
        await client.query(
          `UPDATE marketplace.vendor_orders
              SET lifecycle_state='EXPIRED', decline_reason_code='ACCEPT_DEADLINE_TIMEOUT',
                  version=$2, updated_at=$3
            WHERE vendor_order_id=$1`,
          [orderId, row.version + 1, now],
        );
        await this.#releaseHolds(client, orderId);
        await appendEvent(client, {
          vendor_order_id: orderId,
          event_type: 'TIMED_OUT',
          actor_id: systemActorId,
          actor_kind: 'system',
          previous_state: 'PLACED',
          resulting_state: 'EXPIRED',
          reason_code: 'ACCEPT_DEADLINE_TIMEOUT',
          ids,
        });
        timedOut.push(orderId);
      }
      return Object.freeze(timedOut);
    });
  }

  // -----------------------------------------------------------------------
  // 8.3 -- picking workflow
  // -----------------------------------------------------------------------

  async startPicking(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly expected_version: number;
    readonly now?: Date;
  }): Promise<VendorOrderSummary> {
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'ACCEPTED')
        throw new FulfilmentConflictError('Only an accepted order can start picking');
      if (order.version !== input.expected_version)
        throw new FulfilmentConflictError('Vendor order version has advanced');
      const version = order.version + 1;
      const ids = contextIds(input.context);
      const updated = await client.query(
        `UPDATE marketplace.vendor_orders
            SET lifecycle_state='PICKING', picking_started_at=$2, version=$3, updated_at=$2
          WHERE vendor_order_id=$1
        RETURNING vendor_order_id, order_reference, lifecycle_state, total_minor::text AS total_minor,
                  version, accept_by, accepted_at, ready_at, picked_up_at, package_count,
                  package_condition_note, preparation_estimate_seconds, pickup_otp_expires_at,
                  pickup_otp_attempts, decline_reason_code`,
        [input.vendor_order_id, now, version],
      );
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'PICKING_STARTED',
        actor_id: userId,
        actor_kind: 'vendor_staff',
        previous_state: 'ACCEPTED',
        resulting_state: 'PICKING',
        reason_code: 'PICKER_STARTED',
        ids,
      });
      return projectSummary(updated.rows[0] as Record<string, unknown>);
    });
  }

  async markLineFound(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly vendor_order_line_id: UuidV7;
    readonly actual_quantity: number;
    readonly actual_unit_price_minor: number;
    readonly now?: Date;
  }): Promise<PickRecord> {
    return this.#recordPick({
      ...input,
      pick_state: 'FOUND',
      actual_quantity: input.actual_quantity,
      actual_unit_price_minor: input.actual_unit_price_minor,
      substitution_variant_id: null,
      reason_code: 'LINE_PICKED_FOUND',
      event_type: 'LINE_PICKED',
    });
  }

  async markLineMissing(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly vendor_order_line_id: UuidV7;
    readonly now?: Date;
  }): Promise<PickRecord> {
    return this.#recordPick({
      ...input,
      pick_state: 'MISSING',
      actual_quantity: null,
      actual_unit_price_minor: null,
      substitution_variant_id: null,
      reason_code: 'LINE_UNAVAILABLE',
      event_type: 'LINE_MISSING',
    });
  }

  async proposeSubstitution(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly vendor_order_line_id: UuidV7;
    readonly substitution_variant_id: UuidV7;
    readonly proposed_quantity: number;
    readonly proposed_unit_price_minor: number;
    readonly reason_note: string;
    readonly decision_deadline_seconds?: number;
    readonly now?: Date;
  }): Promise<{ readonly pick: PickRecord; readonly decision: DecisionRecord }> {
    if (input.reason_note.length < 1 || input.reason_note.length > 240)
      throw new FulfilmentInputError('Reason note must be between 1 and 240 characters');
    const deadlineSeconds = input.decision_deadline_seconds ?? DEFAULT_DECISION_DEADLINE_SECONDS;
    if (deadlineSeconds < 60 || deadlineSeconds > 3600)
      throw new FulfilmentInputError('Decision deadline must be between 60s and 60 minutes');
    return this.#recordPickAndProposal({
      ...input,
      pick_state: 'PROPOSED_SUBSTITUTION',
      proposal_kind: 'SUBSTITUTION',
      substitution_variant_id: input.substitution_variant_id,
      proposed_variant_id: input.substitution_variant_id,
      decision_deadline_seconds: deadlineSeconds,
      reason_code: 'SUBSTITUTION_PROPOSED',
      event_type: 'SUBSTITUTION_PROPOSED',
    });
  }

  async proposeWeight(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly vendor_order_line_id: UuidV7;
    readonly proposed_quantity: number;
    readonly proposed_unit_price_minor: number;
    readonly reason_note: string;
    readonly decision_deadline_seconds?: number;
    readonly now?: Date;
  }): Promise<{ readonly pick: PickRecord; readonly decision: DecisionRecord }> {
    if (input.reason_note.length < 1 || input.reason_note.length > 240)
      throw new FulfilmentInputError('Reason note must be between 1 and 240 characters');
    const deadlineSeconds = input.decision_deadline_seconds ?? DEFAULT_DECISION_DEADLINE_SECONDS;
    if (deadlineSeconds < 60 || deadlineSeconds > 3600)
      throw new FulfilmentInputError('Decision deadline must be between 60s and 60 minutes');
    return this.#recordPickAndProposal({
      ...input,
      pick_state: 'PROPOSED_WEIGHT',
      proposal_kind: 'WEIGHT',
      substitution_variant_id: null,
      proposed_variant_id: null,
      decision_deadline_seconds: deadlineSeconds,
      reason_code: 'WEIGHT_PROPOSED',
      event_type: 'WEIGHT_PROPOSED',
    });
  }

  // -----------------------------------------------------------------------
  // 8.4 -- customer decision
  // -----------------------------------------------------------------------

  async answerDecision(input: {
    readonly context: RequestContext;
    readonly decision_id: UuidV7;
    readonly answer: 'APPROVED' | 'REJECTED';
    readonly now?: Date;
  }): Promise<DecisionRecord> {
    if (input.answer !== 'APPROVED' && input.answer !== 'REJECTED')
      throw new FulfilmentInputError('Answer must be APPROVED or REJECTED');
    const customerId = requireCustomer(input.context);
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const found = await client.query<{
        decision_id: string;
        vendor_order_id: string;
        pick_id: string;
        proposal_kind: 'SUBSTITUTION' | 'WEIGHT';
        proposed_variant_id: string | null;
        proposed_quantity: number;
        proposed_unit_price_minor: string;
        answer: DecisionAnswer;
        decision_deadline_at: Date;
        customer_user_id: string;
      }>(
        `SELECT d.decision_id, d.vendor_order_id, d.pick_id, d.proposal_kind, d.proposed_variant_id,
                d.proposed_quantity, d.proposed_unit_price_minor::text AS proposed_unit_price_minor,
                d.answer, d.decision_deadline_at, cg.customer_user_id
           FROM marketplace.vendor_order_customer_decisions d
           JOIN marketplace.vendor_orders o USING (vendor_order_id)
           JOIN marketplace.checkout_groups cg ON cg.checkout_group_id=o.checkout_group_id
          WHERE d.decision_id=$1 FOR UPDATE OF d`,
        [input.decision_id],
      );
      const row = found.rows[0];
      if (!row) throw new FulfilmentNotFoundError();
      if (row.customer_user_id !== customerId) throw new FulfilmentNotFoundError();
      if (row.answer !== 'PENDING')
        throw new FulfilmentConflictError('Decision has already been answered');
      if (row.decision_deadline_at <= now)
        throw new FulfilmentConflictError('Decision deadline has passed');
      await client.query(
        `UPDATE marketplace.vendor_order_customer_decisions
            SET answer=$2, answered_at=$3, updated_at=$3
          WHERE decision_id=$1`,
        [input.decision_id, input.answer, now],
      );
      const updated = await client.query<Record<string, unknown>>(
        `SELECT * FROM marketplace.vendor_order_customer_decisions WHERE decision_id=$1`,
        [input.decision_id],
      );
      // Roll the pick row forward to match the customer's decision.
      const nextPickState: PickState =
        row.proposal_kind === 'SUBSTITUTION'
          ? input.answer === 'APPROVED'
            ? 'SUBSTITUTION_APPROVED'
            : 'SUBSTITUTION_REJECTED'
          : input.answer === 'APPROVED'
            ? 'WEIGHT_APPROVED'
            : 'WEIGHT_REJECTED';
      await client.query(
        `UPDATE marketplace.vendor_order_line_picks
            SET pick_state=$2,
                actual_quantity=CASE WHEN $3='APPROVED' THEN $4 ELSE NULL END,
                actual_unit_price_minor=CASE WHEN $3='APPROVED' THEN $5::bigint ELSE NULL END,
                substitution_variant_id=CASE WHEN $3='APPROVED' THEN $6::uuid ELSE NULL END,
                version=version+1, updated_at=$7
          WHERE pick_id=$1`,
        [
          row.pick_id,
          nextPickState,
          input.answer,
          row.proposed_quantity,
          row.proposed_unit_price_minor,
          row.proposed_variant_id,
          now,
        ],
      );
      const ids = contextIds(input.context);
      await appendEvent(client, {
        vendor_order_id: parseUuidV7(row.vendor_order_id),
        event_type:
          row.proposal_kind === 'SUBSTITUTION'
            ? input.answer === 'APPROVED'
              ? 'SUBSTITUTION_APPROVED'
              : 'SUBSTITUTION_REJECTED'
            : input.answer === 'APPROVED'
              ? 'WEIGHT_APPROVED'
              : 'WEIGHT_REJECTED',
        actor_id: customerId,
        actor_kind: 'customer',
        previous_state: null,
        resulting_state: null,
        reason_code: input.answer === 'APPROVED' ? 'CUSTOMER_APPROVED' : 'CUSTOMER_REJECTED',
        ids,
      });
      return projectDecision(updated.rows[0] as Record<string, unknown>);
    });
  }

  /**
   * Any decision whose deadline has passed is auto-answered TIMED_OUT with
   * the same effect as REJECTED (safer default: never charge for a
   * substitution the customer never saw).
   */
  async timeoutOverdueDecisions(input: {
    readonly context: RequestContext;
    readonly now?: Date;
  }): Promise<readonly UuidV7[]> {
    const systemActorId = requireSystemOrVendor(input.context);
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const overdue = await client.query<{
        decision_id: string;
        vendor_order_id: string;
        pick_id: string;
        proposal_kind: 'SUBSTITUTION' | 'WEIGHT';
      }>(
        `SELECT decision_id, vendor_order_id, pick_id, proposal_kind
           FROM marketplace.vendor_order_customer_decisions
          WHERE answer='PENDING' AND decision_deadline_at <= $1 FOR UPDATE SKIP LOCKED`,
        [now],
      );
      const ids = contextIds(input.context);
      const timedOut: UuidV7[] = [];
      for (const row of overdue.rows) {
        await client.query(
          `UPDATE marketplace.vendor_order_customer_decisions
              SET answer='TIMED_OUT', answered_at=$2, updated_at=$2
            WHERE decision_id=$1`,
          [row.decision_id, now],
        );
        const rejectedState: PickState =
          row.proposal_kind === 'SUBSTITUTION' ? 'SUBSTITUTION_REJECTED' : 'WEIGHT_REJECTED';
        await client.query(
          `UPDATE marketplace.vendor_order_line_picks
              SET pick_state=$2, actual_quantity=NULL, actual_unit_price_minor=NULL,
                  substitution_variant_id=NULL, version=version+1, updated_at=$3
            WHERE pick_id=$1`,
          [row.pick_id, rejectedState, now],
        );
        await appendEvent(client, {
          vendor_order_id: parseUuidV7(row.vendor_order_id),
          event_type:
            row.proposal_kind === 'SUBSTITUTION' ? 'SUBSTITUTION_REJECTED' : 'WEIGHT_REJECTED',
          actor_id: systemActorId,
          actor_kind: 'system',
          previous_state: null,
          resulting_state: null,
          reason_code: 'DECISION_DEADLINE_TIMEOUT',
          ids,
        });
        timedOut.push(parseUuidV7(row.decision_id));
      }
      return Object.freeze(timedOut);
    });
  }

  // -----------------------------------------------------------------------
  // 8.5 -- ready
  // -----------------------------------------------------------------------

  async markReady(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly expected_version: number;
    readonly package_count: number;
    readonly package_condition_note?: string;
    readonly pickup_promise_at?: Date;
    readonly now?: Date;
  }): Promise<VendorOrderSummary> {
    if (
      !Number.isSafeInteger(input.package_count) ||
      input.package_count < 1 ||
      input.package_count > 40
    ) {
      throw new FulfilmentInputError('Package count must be between 1 and 40');
    }
    if (
      input.package_condition_note !== undefined &&
      (input.package_condition_note.length < 1 || input.package_condition_note.length > 240)
    ) {
      throw new FulfilmentInputError('Condition note must be between 1 and 240 characters');
    }
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'PICKING')
        throw new FulfilmentConflictError('Only an order in picking can be marked ready');
      if (order.version !== input.expected_version)
        throw new FulfilmentConflictError('Vendor order version has advanced');
      // Every line must be resolved (FOUND, MISSING, or a decided proposal)
      // and no proposal may still be PENDING before ready succeeds.
      const unresolved = await client.query<{ count: string }>(
        `SELECT (
           (SELECT count(*) FROM marketplace.vendor_order_lines l
             WHERE l.vendor_order_id=$1
               AND NOT EXISTS (SELECT 1 FROM marketplace.vendor_order_line_picks p
                                 WHERE p.vendor_order_line_id=l.vendor_order_line_id))
           +
           (SELECT count(*) FROM marketplace.vendor_order_line_picks p
             WHERE p.vendor_order_id=$1
               AND p.pick_state IN ('PROPOSED_SUBSTITUTION','PROPOSED_WEIGHT'))
         )::text AS count`,
        [input.vendor_order_id],
      );
      if (unresolved.rows[0]?.count !== '0')
        throw new FulfilmentConflictError('Unresolved lines cannot reach ready');
      const version = order.version + 1;
      const ids = contextIds(input.context);
      const updated = await client.query(
        `UPDATE marketplace.vendor_orders
            SET lifecycle_state='READY', ready_at=$2, package_count=$3,
                package_condition_note=$4, pickup_promise_at=$5,
                version=$6, updated_at=$2
          WHERE vendor_order_id=$1
        RETURNING vendor_order_id, order_reference, lifecycle_state, total_minor::text AS total_minor,
                  version, accept_by, accepted_at, ready_at, picked_up_at, package_count,
                  package_condition_note, preparation_estimate_seconds, pickup_otp_expires_at,
                  pickup_otp_attempts, decline_reason_code`,
        [
          input.vendor_order_id,
          now,
          input.package_count,
          input.package_condition_note ?? null,
          input.pickup_promise_at ?? null,
          version,
        ],
      );
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'READY',
        actor_id: userId,
        actor_kind: 'vendor_staff',
        previous_state: 'PICKING',
        resulting_state: 'READY',
        reason_code: 'ORDER_READY',
        ids,
      });
      return projectSummary(updated.rows[0] as Record<string, unknown>);
    });
  }

  // -----------------------------------------------------------------------
  // 8.6 -- pickup OTP + completion
  // -----------------------------------------------------------------------

  /**
   * Issues a fresh six-digit pickup OTP for a READY order. The plaintext is
   * returned to the caller once (customer notification path); only its SHA-256
   * hash is stored. Issuing again before the current OTP expires rotates it.
   */
  async issuePickupOtp(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly now?: Date;
  }): Promise<{ readonly plaintext_otp: string; readonly expires_at: Date }> {
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'READY')
        throw new FulfilmentConflictError('Only a ready order can receive a pickup OTP');
      const otp = String(randomInt(100000, 1000000));
      const hash = createHash('sha256').update(otp).digest('hex');
      const expiresAt = new Date(now.getTime() + PICKUP_OTP_LIFETIME_SECONDS * 1000);
      await client.query(
        `UPDATE marketplace.vendor_orders
            SET pickup_otp_hash=$2, pickup_otp_expires_at=$3, pickup_otp_attempts=0, updated_at=$4
          WHERE vendor_order_id=$1`,
        [input.vendor_order_id, hash, expiresAt, now],
      );
      const ids = contextIds(input.context);
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'PICKUP_OTP_ISSUED',
        actor_id: userId,
        actor_kind: 'vendor_staff',
        previous_state: 'READY',
        resulting_state: 'READY',
        reason_code: 'PICKUP_OTP_ISSUED',
        ids,
      });
      return { plaintext_otp: otp, expires_at: expiresAt };
    });
  }

  /**
   * Redeems a pickup OTP and transitions the order to PICKED_UP. Attempt
   * counter and expiry are checked first: an expired OTP raises
   * PickupOtpExpiredError, exhausting attempts locks the OTP until it is
   * re-issued. On success, inventory holds are committed and a
   * `vendor_order.picked_up` outbox event is appended for money capture.
   */
  async completePickup(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly otp: string;
    readonly proof_note?: string;
    readonly now?: Date;
  }): Promise<VendorOrderSummary> {
    if (!/^[0-9]{6}$/.test(input.otp))
      throw new FulfilmentInputError('OTP must be exactly six digits');
    const now = input.now ?? new Date();
    // OTP validation runs in its own committed transaction so that a failed
    // attempt persists (attempts_counter++, audit event) even though the
    // caller-facing error rolls back the caller. This is what keeps
    // PICKUP_OTP_MAX_ATTEMPTS enforceable.
    const validation = await tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'READY')
        throw new FulfilmentConflictError('Only a ready order can complete pickup');
      if (!order.pickup_otp_hash || !order.pickup_otp_expires_at)
        throw new FulfilmentConflictError('No pickup OTP has been issued');
      if (order.pickup_otp_attempts >= PICKUP_OTP_MAX_ATTEMPTS) throw new PickupOtpExhaustedError();
      if (order.pickup_otp_expires_at <= now) throw new PickupOtpExpiredError();
      const attempted = createHash('sha256').update(input.otp).digest('hex');
      const ids = contextIds(input.context);
      if (attempted !== order.pickup_otp_hash) {
        await client.query(
          `UPDATE marketplace.vendor_orders SET pickup_otp_attempts=pickup_otp_attempts+1, updated_at=$2
            WHERE vendor_order_id=$1`,
          [input.vendor_order_id, now],
        );
        await appendEvent(client, {
          vendor_order_id: input.vendor_order_id,
          event_type: 'PICKUP_OTP_ATTEMPTED',
          actor_id: userId,
          actor_kind: 'vendor_staff',
          previous_state: 'READY',
          resulting_state: 'READY',
          reason_code: 'PICKUP_OTP_MISMATCH',
          ids,
        });
        return { mismatched: true as const };
      }
      return { mismatched: false as const };
    });
    if (validation.mismatched) throw new PickupOtpMismatchError();
    return tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'READY')
        throw new FulfilmentConflictError('Only a ready order can complete pickup');
      const ids = contextIds(input.context);
      const version = order.version + 1;
      const updated = await client.query(
        `UPDATE marketplace.vendor_orders
            SET lifecycle_state='PICKED_UP', picked_up_at=$2, version=$3, updated_at=$2,
                pickup_otp_hash=NULL, pickup_otp_expires_at=NULL
          WHERE vendor_order_id=$1
        RETURNING vendor_order_id, order_reference, lifecycle_state, total_minor::text AS total_minor,
                  version, accept_by, accepted_at, ready_at, picked_up_at, package_count,
                  package_condition_note, preparation_estimate_seconds, pickup_otp_expires_at,
                  pickup_otp_attempts, decline_reason_code`,
        [input.vendor_order_id, now, version],
      );
      // Inventory commit is delegated to settleInventoryOnPickup, called
      // directly by tests and (later) an outbox worker. Registering
      // vendor_order as a versioned aggregate (to satisfy the outbox FK
      // outbox_transition_fk) is a Phase 10 concern coupled to ledger and
      // settlement; Phase 8's exit gate is satisfied by the direct call
      // path and does not depend on the async orchestration.
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'PICKED_UP',
        actor_id: userId,
        actor_kind: 'vendor_staff',
        previous_state: 'READY',
        resulting_state: 'PICKED_UP',
        reason_code: 'CUSTOMER_PICKUP_COMPLETED',
        note: input.proof_note ?? null,
        ids,
      });
      return projectSummary(updated.rows[0] as Record<string, unknown>);
    });
  }

  /**
   * Called by an outbox worker for a `vendor_order.picked_up` event: commits
   * every PROVISIONAL reservation attached to the order. Idempotent through
   * InventoryReservationService.commit's own version guard.
   */
  async settleInventoryOnPickup(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly now?: Date;
  }): Promise<number> {
    requireSystemOrVendor(input.context);
    const now = input.now ?? new Date();
    const reservations = await this.#pool.query<{
      reservation_id: string;
      version: number;
      reservation_state: string;
    }>(
      `SELECT ir.reservation_id, ir.version, ir.reservation_state
         FROM marketplace.vendor_order_lines l
         JOIN marketplace.inventory_reservations ir ON ir.reservation_id=l.inventory_reservation_id
        WHERE l.vendor_order_id=$1`,
      [input.vendor_order_id],
    );
    let committed = 0;
    for (const row of reservations.rows) {
      if (row.reservation_state === 'COMMITTED') continue;
      if (row.reservation_state !== 'PROVISIONAL') continue;
      await this.#inventory.commit({
        context: input.context,
        reservation_id: parseUuidV7(row.reservation_id),
        expected_version: row.version,
        reason_code: 'CUSTOMER_PICKUP_COMPLETED',
        now,
      });
      committed += 1;
    }
    return committed;
  }

  // -----------------------------------------------------------------------
  // 8.7 -- history, receipt, rating, support
  // -----------------------------------------------------------------------

  async listCustomerOrders(input: {
    readonly context: RequestContext;
    readonly limit?: number;
  }): Promise<
    readonly {
      readonly checkout_group_id: UuidV7;
      readonly checkout_reference: string;
      readonly created_at: Date;
      readonly vendor_orders: readonly VendorOrderSummary[];
    }[]
  > {
    const customerId = requireCustomer(input.context);
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const groups = await this.#pool.query<{
      checkout_group_id: string;
      checkout_reference: string;
      created_at: Date;
    }>(
      `SELECT checkout_group_id, checkout_reference, created_at
         FROM marketplace.checkout_groups
        WHERE customer_user_id=$1
        ORDER BY created_at DESC LIMIT $2`,
      [customerId, limit],
    );
    const result: {
      readonly checkout_group_id: UuidV7;
      readonly checkout_reference: string;
      readonly created_at: Date;
      readonly vendor_orders: readonly VendorOrderSummary[];
    }[] = [];
    for (const group of groups.rows) {
      const orders = await this.#pool.query(
        `SELECT vendor_order_id, order_reference, lifecycle_state, total_minor::text AS total_minor,
                version, accept_by, accepted_at, ready_at, picked_up_at, package_count,
                package_condition_note, preparation_estimate_seconds, pickup_otp_expires_at,
                pickup_otp_attempts, decline_reason_code
           FROM marketplace.vendor_orders WHERE checkout_group_id=$1 ORDER BY created_at ASC`,
        [group.checkout_group_id],
      );
      result.push({
        checkout_group_id: parseUuidV7(group.checkout_group_id),
        checkout_reference: group.checkout_reference,
        created_at: group.created_at,
        vendor_orders: Object.freeze(
          orders.rows.map((row) => projectSummary(row as Record<string, unknown>)),
        ),
      });
    }
    return Object.freeze(result);
  }

  async getReceipt(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
  }): Promise<{
    readonly order: VendorOrderSummary;
    readonly lines: readonly {
      readonly title: string;
      readonly variant_title: string;
      readonly quantity: number;
      readonly unit_price_minor: number;
      readonly line_total_minor: number;
      readonly pick_state: PickState | 'PENDING';
      readonly actual_quantity: number | null;
      readonly actual_unit_price_minor: number | null;
    }[];
  }> {
    const customerId = requireCustomer(input.context);
    const order = await this.#pool.query(
      `SELECT o.vendor_order_id, o.order_reference, o.lifecycle_state,
              o.total_minor::text AS total_minor, o.version, o.accept_by, o.accepted_at,
              o.ready_at, o.picked_up_at, o.package_count, o.package_condition_note,
              o.preparation_estimate_seconds, o.pickup_otp_expires_at, o.pickup_otp_attempts,
              o.decline_reason_code, cg.customer_user_id
         FROM marketplace.vendor_orders o
         JOIN marketplace.checkout_groups cg USING (checkout_group_id)
        WHERE o.vendor_order_id=$1`,
      [input.vendor_order_id],
    );
    const orderRow = order.rows[0];
    if (!orderRow) throw new FulfilmentNotFoundError();
    if (orderRow['customer_user_id'] !== customerId) throw new FulfilmentNotFoundError();
    const lines = await this.#pool.query(
      `SELECT l.product_title_snapshot AS title, l.variant_title_snapshot AS variant_title,
              l.quantity, l.unit_price_minor::text AS unit_price_minor,
              l.line_total_minor::text AS line_total_minor,
              COALESCE(p.pick_state, 'PENDING') AS pick_state,
              p.actual_quantity,
              p.actual_unit_price_minor::text AS actual_unit_price_minor
         FROM marketplace.vendor_order_lines l
         LEFT JOIN marketplace.vendor_order_line_picks p
           ON p.vendor_order_line_id=l.vendor_order_line_id
        WHERE l.vendor_order_id=$1 ORDER BY l.vendor_order_line_id`,
      [input.vendor_order_id],
    );
    return {
      order: projectSummary(orderRow as Record<string, unknown>),
      lines: lines.rows.map((row) => ({
        title: row['title'],
        variant_title: row['variant_title'],
        quantity: Number(row['quantity']),
        unit_price_minor: Number(row['unit_price_minor']),
        line_total_minor: Number(row['line_total_minor']),
        pick_state: row['pick_state'],
        actual_quantity: row['actual_quantity'] ?? null,
        actual_unit_price_minor: row['actual_unit_price_minor']
          ? Number(row['actual_unit_price_minor'])
          : null,
      })),
    };
  }

  async submitRating(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly stars: number;
    readonly review_note?: string;
    readonly now?: Date;
  }): Promise<void> {
    if (!Number.isSafeInteger(input.stars) || input.stars < 1 || input.stars > 5)
      throw new FulfilmentInputError('Stars must be between 1 and 5');
    if (
      input.review_note !== undefined &&
      (input.review_note.length < 1 || input.review_note.length > 500)
    ) {
      throw new FulfilmentInputError('Review note must be between 1 and 500 characters');
    }
    const customerId = requireCustomer(input.context);
    const now = input.now ?? new Date();
    await tx(this.#pool, async (client) => {
      const order = await client.query<{ lifecycle_state: string; customer_user_id: string }>(
        `SELECT o.lifecycle_state, cg.customer_user_id
           FROM marketplace.vendor_orders o
           JOIN marketplace.checkout_groups cg USING (checkout_group_id)
          WHERE o.vendor_order_id=$1`,
        [input.vendor_order_id],
      );
      const row = order.rows[0];
      if (!row) throw new FulfilmentNotFoundError();
      if (row.customer_user_id !== customerId) throw new FulfilmentNotFoundError();
      if (row.lifecycle_state !== 'PICKED_UP')
        throw new FulfilmentConflictError('Only a completed order can be rated');
      const ids = contextIds(input.context);
      const inserted = await client.query(
        `INSERT INTO marketplace.vendor_order_ratings
           (vendor_order_id, customer_user_id, stars, review_note, request_id, correlation_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (vendor_order_id) DO NOTHING RETURNING vendor_order_id`,
        [
          input.vendor_order_id,
          customerId,
          input.stars,
          input.review_note ?? null,
          ids.request,
          ids.correlation,
          now,
        ],
      );
      if (inserted.rowCount !== 1)
        throw new FulfilmentConflictError('Order has already been rated');
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'RATING_SUBMITTED',
        actor_id: customerId,
        actor_kind: 'customer',
        previous_state: null,
        resulting_state: null,
        reason_code: 'CUSTOMER_RATED_ORDER',
        ids,
      });
    });
  }

  async openSupportCase(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly category: string;
    readonly description: string;
    readonly now?: Date;
  }): Promise<UuidV7> {
    if (!reasonCode.test(input.category))
      throw new FulfilmentInputError('Category must be shouting-snake-case');
    if (input.description.length < 1 || input.description.length > 1000)
      throw new FulfilmentInputError('Description must be between 1 and 1000 characters');
    const customerId = requireCustomer(input.context);
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const order = await client.query<{ customer_user_id: string }>(
        `SELECT cg.customer_user_id FROM marketplace.vendor_orders o
           JOIN marketplace.checkout_groups cg USING (checkout_group_id)
          WHERE o.vendor_order_id=$1`,
        [input.vendor_order_id],
      );
      if (order.rows[0]?.customer_user_id !== customerId) throw new FulfilmentNotFoundError();
      const caseId = createUuidV7({ now_ms: now.getTime() });
      const ids = contextIds(input.context);
      await client.query(
        `INSERT INTO marketplace.support_cases
           (support_case_id, vendor_order_id, opened_by_user_id, category, description,
            request_id, correlation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          caseId,
          input.vendor_order_id,
          customerId,
          input.category,
          input.description,
          ids.request,
          ids.correlation,
        ],
      );
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'SUPPORT_CASE_OPENED',
        actor_id: customerId,
        actor_kind: 'customer',
        previous_state: null,
        resulting_state: null,
        reason_code: input.category,
        ids,
      });
      return caseId;
    });
  }

  // -----------------------------------------------------------------------
  // Read-only projections used by tests and controllers.
  // -----------------------------------------------------------------------

  async getOrder(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
  }): Promise<VendorOrderSummary> {
    const result = await this.#pool.query(
      `SELECT vendor_order_id, order_reference, lifecycle_state, total_minor::text AS total_minor,
              version, accept_by, accepted_at, ready_at, picked_up_at, package_count,
              package_condition_note, preparation_estimate_seconds, pickup_otp_expires_at,
              pickup_otp_attempts, decline_reason_code
         FROM marketplace.vendor_orders WHERE vendor_order_id=$1`,
      [input.vendor_order_id],
    );
    const row = result.rows[0];
    if (!row) throw new FulfilmentNotFoundError();
    return projectSummary(row as Record<string, unknown>);
  }

  async listPicks(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
  }): Promise<readonly PickRecord[]> {
    const result = await this.#pool.query(
      `SELECT pick_id, vendor_order_line_id, pick_state, actual_quantity,
              actual_unit_price_minor::text AS actual_unit_price_minor,
              substitution_variant_id, version
         FROM marketplace.vendor_order_line_picks WHERE vendor_order_id=$1
         ORDER BY updated_at`,
      [input.vendor_order_id],
    );
    return Object.freeze(result.rows.map((row) => projectPick(row as Record<string, unknown>)));
  }

  async listDecisions(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
  }): Promise<readonly DecisionRecord[]> {
    const result = await this.#pool.query(
      `SELECT decision_id, vendor_order_id, pick_id, proposal_kind, proposed_variant_id,
              proposed_quantity, proposed_unit_price_minor::text AS proposed_unit_price_minor,
              authorization_delta_minor::text AS authorization_delta_minor, reason_note,
              decision_deadline_at, answer, answered_at
         FROM marketplace.vendor_order_customer_decisions WHERE vendor_order_id=$1
         ORDER BY created_at`,
      [input.vendor_order_id],
    );
    return Object.freeze(result.rows.map((row) => projectDecision(row as Record<string, unknown>)));
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  async #releaseHolds(client: PoolClient, vendorOrderId: UuidV7): Promise<void> {
    // Cancel the vendor's SOFT_HELD/PROVISIONAL reservations so a sibling
    // vendor_order in the same checkout group is not starved.
    await client.query(
      `UPDATE marketplace.inventory_reservations ir
          SET reservation_state='RELEASED', version=version+1, updated_at=clock_timestamp()
         FROM marketplace.vendor_order_lines l
        WHERE l.vendor_order_id=$1 AND l.inventory_reservation_id=ir.reservation_id
          AND ir.reservation_state IN ('SOFT_HELD','PROVISIONAL')`,
      [vendorOrderId],
    );
  }

  async #recordPick(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly vendor_order_line_id: UuidV7;
    readonly pick_state: PickState;
    readonly actual_quantity: number | null;
    readonly actual_unit_price_minor: number | null;
    readonly substitution_variant_id: UuidV7 | null;
    readonly reason_code: string;
    readonly event_type: string;
    readonly now?: Date;
  }): Promise<PickRecord> {
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const line = await client.query<{ vendor_order_id: string }>(
        `SELECT vendor_order_id FROM marketplace.vendor_order_lines
          WHERE vendor_order_line_id=$1`,
        [input.vendor_order_line_id],
      );
      if (line.rows[0]?.vendor_order_id !== input.vendor_order_id)
        throw new FulfilmentNotFoundError();
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'PICKING')
        throw new FulfilmentConflictError('Picking edits require the order to be in PICKING');
      const pickId = createUuidV7({ now_ms: now.getTime() });
      const upserted = await client.query(
        `INSERT INTO marketplace.vendor_order_line_picks
           (pick_id, vendor_order_line_id, vendor_order_id, pick_state, actual_quantity,
            actual_unit_price_minor, substitution_variant_id, picker_user_id, version, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9)
         ON CONFLICT (vendor_order_line_id) DO UPDATE
           SET pick_state=EXCLUDED.pick_state,
               actual_quantity=EXCLUDED.actual_quantity,
               actual_unit_price_minor=EXCLUDED.actual_unit_price_minor,
               substitution_variant_id=EXCLUDED.substitution_variant_id,
               version=marketplace.vendor_order_line_picks.version + 1,
               updated_at=EXCLUDED.updated_at
         RETURNING pick_id, vendor_order_line_id, pick_state, actual_quantity,
                   actual_unit_price_minor::text AS actual_unit_price_minor,
                   substitution_variant_id, version`,
        [
          pickId,
          input.vendor_order_line_id,
          input.vendor_order_id,
          input.pick_state,
          input.actual_quantity,
          input.actual_unit_price_minor,
          input.substitution_variant_id,
          userId,
          now,
        ],
      );
      const ids = contextIds(input.context);
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: input.event_type,
        actor_id: userId,
        actor_kind: 'vendor_staff',
        previous_state: null,
        resulting_state: null,
        reason_code: input.reason_code,
        ids,
      });
      return projectPick(upserted.rows[0] as Record<string, unknown>);
    });
  }

  async #recordPickAndProposal(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly vendor_order_line_id: UuidV7;
    readonly pick_state: PickState;
    readonly proposal_kind: 'SUBSTITUTION' | 'WEIGHT';
    readonly proposed_variant_id: UuidV7 | null;
    readonly proposed_quantity: number;
    readonly proposed_unit_price_minor: number;
    readonly substitution_variant_id: UuidV7 | null;
    readonly reason_note: string;
    readonly decision_deadline_seconds: number;
    readonly reason_code: string;
    readonly event_type: string;
    readonly now?: Date;
  }): Promise<{ readonly pick: PickRecord; readonly decision: DecisionRecord }> {
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const line = await client.query<{
        vendor_order_id: string;
        quantity: number;
        unit_price_minor: string;
      }>(
        `SELECT vendor_order_id, quantity, unit_price_minor::text AS unit_price_minor
           FROM marketplace.vendor_order_lines WHERE vendor_order_line_id=$1`,
        [input.vendor_order_line_id],
      );
      const lineRow = line.rows[0];
      if (!lineRow || lineRow.vendor_order_id !== input.vendor_order_id)
        throw new FulfilmentNotFoundError();
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'PICKING')
        throw new FulfilmentConflictError('Picking edits require the order to be in PICKING');
      const originalTotal = Number(lineRow.unit_price_minor) * lineRow.quantity;
      const proposedTotal = input.proposed_unit_price_minor * input.proposed_quantity;
      const delta = proposedTotal - originalTotal;
      const pickId = createUuidV7({ now_ms: now.getTime() });
      const upserted = await client.query(
        `INSERT INTO marketplace.vendor_order_line_picks
           (pick_id, vendor_order_line_id, vendor_order_id, pick_state, actual_quantity,
            actual_unit_price_minor, substitution_variant_id, picker_user_id, version, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9)
         ON CONFLICT (vendor_order_line_id) DO UPDATE
           SET pick_state=EXCLUDED.pick_state,
               actual_quantity=EXCLUDED.actual_quantity,
               actual_unit_price_minor=EXCLUDED.actual_unit_price_minor,
               substitution_variant_id=EXCLUDED.substitution_variant_id,
               version=marketplace.vendor_order_line_picks.version + 1,
               updated_at=EXCLUDED.updated_at
         RETURNING pick_id, vendor_order_line_id, pick_state, actual_quantity,
                   actual_unit_price_minor::text AS actual_unit_price_minor,
                   substitution_variant_id, version`,
        [
          pickId,
          input.vendor_order_line_id,
          input.vendor_order_id,
          input.pick_state,
          input.proposed_quantity,
          input.proposed_unit_price_minor,
          input.substitution_variant_id,
          userId,
          now,
        ],
      );
      const pick = projectPick(upserted.rows[0] as Record<string, unknown>);
      const decisionId = createUuidV7({ now_ms: now.getTime() });
      const deadline = new Date(now.getTime() + input.decision_deadline_seconds * 1000);
      const inserted = await client.query(
        `INSERT INTO marketplace.vendor_order_customer_decisions
           (decision_id, vendor_order_id, pick_id, proposal_kind, proposed_variant_id,
            proposed_quantity, proposed_unit_price_minor, authorization_delta_minor,
            reason_note, decision_deadline_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING decision_id, vendor_order_id, pick_id, proposal_kind, proposed_variant_id,
                   proposed_quantity, proposed_unit_price_minor::text AS proposed_unit_price_minor,
                   authorization_delta_minor::text AS authorization_delta_minor, reason_note,
                   decision_deadline_at, answer, answered_at`,
        [
          decisionId,
          input.vendor_order_id,
          pick.pick_id,
          input.proposal_kind,
          input.proposed_variant_id,
          input.proposed_quantity,
          input.proposed_unit_price_minor,
          delta,
          input.reason_note,
          deadline,
        ],
      );
      const ids = contextIds(input.context);
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: input.event_type,
        actor_id: userId,
        actor_kind: 'vendor_staff',
        previous_state: null,
        resulting_state: null,
        reason_code: input.reason_code,
        ids,
      });
      return {
        pick,
        decision: projectDecision(inserted.rows[0] as Record<string, unknown>),
      };
    });
  }
}
