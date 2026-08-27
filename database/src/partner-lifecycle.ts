import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';

export class PartnerLifecycleInputError extends Error {}
export class PartnerLifecycleNotFoundError extends Error {}
export class PartnerLifecycleConflictError extends Error {}
export class PartnerLifecycleAuthorizationError extends Error {}

export type ApplicationState =
  'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'CHANGES_REQUIRED' | 'APPROVED' | 'REJECTED';

export type VehicleKind = 'BICYCLE' | 'MOTORCYCLE' | 'SCOOTER' | 'SMALL_VEHICLE';

export type EarningsOutcome = 'DELIVERED' | 'RETURNED' | 'CANCELLED_POST_PICKUP';

export type DisputeComponent =
  'BASE' | 'DISTANCE' | 'TIME' | 'WAIT' | 'RETURN' | 'INCENTIVE' | 'TIP' | 'ADJUSTMENT';

export type DisputeState = 'OPEN' | 'RESOLVED' | 'WITHDRAWN';

export interface PartnerApplication {
  readonly partner_application_id: UuidV7;
  readonly applicant_user_id: UuidV7;
  readonly lifecycle_state: ApplicationState;
  readonly identity_reference: string;
  readonly vehicle_reference: string;
  readonly vehicle_kind: VehicleKind;
  readonly bank_account_reference: string;
  readonly insurance_reference: string;
  readonly emergency_contact_reference: string;
  readonly training_reference: string;
  readonly home_zone_name: string;
  readonly reason_code: string | null;
  readonly reason_note: string | null;
  readonly reviewer_user_id: UuidV7 | null;
  readonly submitted_at: Date | null;
  readonly decided_at: Date | null;
  readonly version: number;
}

export interface EarningsRecord {
  readonly partner_earnings_record_id: UuidV7;
  readonly delivery_assignment_id: UuidV7;
  readonly partner_user_id: UuidV7;
  readonly outcome: EarningsOutcome;
  readonly base_minor: number;
  readonly distance_minor: number;
  readonly time_minor: number;
  readonly wait_minor: number;
  readonly return_minor: number;
  readonly incentive_minor: number;
  readonly tip_minor: number;
  readonly adjustment_minor: number;
  readonly net_minor: number;
}

export interface DisputeCase {
  readonly partner_dispute_case_id: UuidV7;
  readonly partner_earnings_record_id: UuidV7;
  readonly partner_user_id: UuidV7;
  readonly disputed_component: DisputeComponent;
  readonly disputed_amount_minor: number;
  readonly proposed_amount_minor: number;
  readonly evidence_note: string;
  readonly lifecycle_state: DisputeState;
  readonly resolver_user_id: UuidV7 | null;
  readonly resolution_reason_code: string | null;
  readonly resolved_amount_minor: number | null;
  readonly deadline_at: Date;
  readonly resolved_at: Date | null;
}

const referencePatterns = {
  identity: /^SYNTH-PARTNER-IDENTITY-[A-Z0-9-]{4,64}$/,
  vehicle: /^SYNTH-PARTNER-VEHICLE-[A-Z0-9-]{4,64}$/,
  bank: /^SYNTH-PARTNER-BANK-[A-Z0-9-]{4,64}$/,
  insurance: /^SYNTH-PARTNER-INSURANCE-[A-Z0-9-]{4,64}$/,
  emergency: /^SYNTH-PARTNER-EMERGENCY-[A-Z0-9-]{4,64}$/,
  training: /^SYNTH-PARTNER-TRAINING-[A-Z0-9-]{4,64}$/,
};
const zoneName = /^SYNTH [A-Za-z0-9 &'().,-]{2,95}$/;
const reasonCode = /^[A-Z][A-Z0-9_]{2,63}$/;
const vehicleKinds: ReadonlySet<VehicleKind> = new Set([
  'BICYCLE',
  'MOTORCYCLE',
  'SCOOTER',
  'SMALL_VEHICLE',
]);
const disputeComponents: ReadonlySet<DisputeComponent> = new Set([
  'BASE',
  'DISTANCE',
  'TIME',
  'WAIT',
  'RETURN',
  'INCENTIVE',
  'TIP',
  'ADJUSTMENT',
]);

interface Ids {
  readonly request: string;
  readonly correlation: string;
}
function contextIds(context: RequestContext): Ids {
  return {
    request: parseRequestId(context.request_id),
    correlation: parseUuidV7(context.correlation_id),
  };
}
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
function requirePartner(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'delivery_partner')
    throw new PartnerLifecycleAuthorizationError();
  return context.actor.actor_id;
}
function requireAdmin(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'admin') throw new PartnerLifecycleAuthorizationError();
  return context.actor.actor_id;
}

function projectApplication(row: Record<string, unknown>): PartnerApplication {
  return Object.freeze({
    partner_application_id: parseUuidV7(row['partner_application_id'] as string),
    applicant_user_id: parseUuidV7(row['applicant_user_id'] as string),
    lifecycle_state: row['lifecycle_state'] as ApplicationState,
    identity_reference: row['identity_reference'] as string,
    vehicle_reference: row['vehicle_reference'] as string,
    vehicle_kind: row['vehicle_kind'] as VehicleKind,
    bank_account_reference: row['bank_account_reference'] as string,
    insurance_reference: row['insurance_reference'] as string,
    emergency_contact_reference: row['emergency_contact_reference'] as string,
    training_reference: row['training_reference'] as string,
    home_zone_name: row['home_zone_name'] as string,
    reason_code: (row['reason_code'] as string | null) ?? null,
    reason_note: (row['reason_note'] as string | null) ?? null,
    reviewer_user_id: row['reviewer_user_id']
      ? parseUuidV7(row['reviewer_user_id'] as string)
      : null,
    submitted_at: (row['submitted_at'] as Date | null) ?? null,
    decided_at: (row['decided_at'] as Date | null) ?? null,
    version: row['version'] as number,
  });
}
function projectEarnings(row: Record<string, unknown>): EarningsRecord {
  return Object.freeze({
    partner_earnings_record_id: parseUuidV7(row['partner_earnings_record_id'] as string),
    delivery_assignment_id: parseUuidV7(row['delivery_assignment_id'] as string),
    partner_user_id: parseUuidV7(row['partner_user_id'] as string),
    outcome: row['outcome'] as EarningsOutcome,
    base_minor: Number(row['base_minor']),
    distance_minor: Number(row['distance_minor']),
    time_minor: Number(row['time_minor']),
    wait_minor: Number(row['wait_minor']),
    return_minor: Number(row['return_minor']),
    incentive_minor: Number(row['incentive_minor']),
    tip_minor: Number(row['tip_minor']),
    adjustment_minor: Number(row['adjustment_minor']),
    net_minor: Number(row['net_minor']),
  });
}
function projectDispute(row: Record<string, unknown>): DisputeCase {
  return Object.freeze({
    partner_dispute_case_id: parseUuidV7(row['partner_dispute_case_id'] as string),
    partner_earnings_record_id: parseUuidV7(row['partner_earnings_record_id'] as string),
    partner_user_id: parseUuidV7(row['partner_user_id'] as string),
    disputed_component: row['disputed_component'] as DisputeComponent,
    disputed_amount_minor: Number(row['disputed_amount_minor']),
    proposed_amount_minor: Number(row['proposed_amount_minor']),
    evidence_note: row['evidence_note'] as string,
    lifecycle_state: row['lifecycle_state'] as DisputeState,
    resolver_user_id: row['resolver_user_id']
      ? parseUuidV7(row['resolver_user_id'] as string)
      : null,
    resolution_reason_code: (row['resolution_reason_code'] as string | null) ?? null,
    resolved_amount_minor:
      row['resolved_amount_minor'] === null || row['resolved_amount_minor'] === undefined
        ? null
        : Number(row['resolved_amount_minor']),
    deadline_at: row['deadline_at'] as Date,
    resolved_at: (row['resolved_at'] as Date | null) ?? null,
  });
}

async function appendApplicationEvent(
  client: PoolClient,
  input: {
    readonly partner_application_id: UuidV7;
    readonly event_type:
      | 'CREATED'
      | 'SUBMITTED'
      | 'REVIEW_STARTED'
      | 'CHANGES_REQUESTED'
      | 'APPROVED'
      | 'REJECTED'
      | 'APPEAL_OPENED';
    readonly actor_id: UuidV7;
    readonly previous_state: ApplicationState | null;
    readonly resulting_state: ApplicationState | null;
    readonly reason_code: string;
    readonly note?: string | null;
    readonly ids: Ids;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO marketplace.partner_application_events
       (event_id, partner_application_id, event_type, actor_id, previous_state,
        resulting_state, reason_code, note, request_id, correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      createUuidV7(),
      input.partner_application_id,
      input.event_type,
      input.actor_id,
      input.previous_state,
      input.resulting_state,
      input.reason_code,
      input.note ?? null,
      input.ids.request,
      input.ids.correlation,
    ],
  );
}

/**
 * PartnerLifecycleService owns three related pieces that share a partner
 * identity but are independently versioned:
 *   1. partner_applications - onboarding (9.1)
 *   2. partner_earnings_records - one row per completed delivery (9.10)
 *   3. partner_dispute_cases - dispute on an earnings component (9.10)
 * Offer, custody, offline-proof, and exception handling stay with
 * AssignmentCustodyService because they are tied to the active assignment
 * aggregate.
 */
export class PartnerLifecycleService {
  readonly #pool: Pool;

  constructor(input: { readonly connection_string: string }) {
    this.#pool = new Pool({
      connectionString: input.connection_string,
      application_name: 'neighbourhood-store-partner-lifecycle',
      max: 8,
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  // -----------------------------------------------------------------------
  // 9.1 -- application
  // -----------------------------------------------------------------------

  async createApplication(input: {
    readonly context: RequestContext;
    readonly identity_reference: string;
    readonly vehicle_reference: string;
    readonly vehicle_kind: VehicleKind;
    readonly bank_account_reference: string;
    readonly insurance_reference: string;
    readonly emergency_contact_reference: string;
    readonly training_reference: string;
    readonly home_zone_name: string;
    readonly now?: Date;
  }): Promise<PartnerApplication> {
    const applicantId = requirePartner(input.context);
    if (!referencePatterns.identity.test(input.identity_reference))
      throw new PartnerLifecycleInputError('identity_reference is not a synthetic reference');
    if (!referencePatterns.vehicle.test(input.vehicle_reference))
      throw new PartnerLifecycleInputError('vehicle_reference is not a synthetic reference');
    if (!vehicleKinds.has(input.vehicle_kind))
      throw new PartnerLifecycleInputError('vehicle_kind is not allowed');
    if (!referencePatterns.bank.test(input.bank_account_reference))
      throw new PartnerLifecycleInputError('bank_account_reference is not a synthetic reference');
    if (!referencePatterns.insurance.test(input.insurance_reference))
      throw new PartnerLifecycleInputError('insurance_reference is not a synthetic reference');
    if (!referencePatterns.emergency.test(input.emergency_contact_reference))
      throw new PartnerLifecycleInputError(
        'emergency_contact_reference is not a synthetic reference',
      );
    if (!referencePatterns.training.test(input.training_reference))
      throw new PartnerLifecycleInputError('training_reference is not a synthetic reference');
    if (!zoneName.test(input.home_zone_name))
      throw new PartnerLifecycleInputError('home_zone_name is not a synthetic zone name');
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    return tx(this.#pool, async (client) => {
      const applicationId = createUuidV7({ now_ms: now.getTime() });
      let created;
      try {
        created = await client.query(
          `INSERT INTO marketplace.partner_applications
             (partner_application_id, applicant_user_id, identity_reference, vehicle_reference,
              vehicle_kind, bank_account_reference, insurance_reference, emergency_contact_reference,
              training_reference, home_zone_name, lifecycle_state, request_id, correlation_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DRAFT',$11,$12)
           RETURNING *`,
          [
            applicationId,
            applicantId,
            input.identity_reference,
            input.vehicle_reference,
            input.vehicle_kind,
            input.bank_account_reference,
            input.insurance_reference,
            input.emergency_contact_reference,
            input.training_reference,
            input.home_zone_name,
            ids.request,
            ids.correlation,
          ],
        );
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: unknown }).code === '23505'
        ) {
          throw new PartnerLifecycleConflictError('Partner already has an application');
        }
        throw error;
      }
      await appendApplicationEvent(client, {
        partner_application_id: applicationId,
        event_type: 'CREATED',
        actor_id: applicantId,
        previous_state: null,
        resulting_state: 'DRAFT',
        reason_code: 'APPLICATION_CREATED',
        ids,
      });
      return projectApplication(created.rows[0] as Record<string, unknown>);
    });
  }

  async submitApplication(input: {
    readonly context: RequestContext;
    readonly partner_application_id: UuidV7;
    readonly expected_version: number;
    readonly now?: Date;
  }): Promise<PartnerApplication> {
    return this.#transitionApplication({
      ...input,
      from: ['DRAFT', 'CHANGES_REQUIRED'],
      to: 'SUBMITTED',
      event_type: 'SUBMITTED',
      reason_code: 'APPLICATION_SUBMITTED',
      required_actor: 'partner',
      touch_submitted_at: true,
    });
  }

  async startReview(input: {
    readonly context: RequestContext;
    readonly partner_application_id: UuidV7;
    readonly expected_version: number;
    readonly now?: Date;
  }): Promise<PartnerApplication> {
    return this.#transitionApplication({
      ...input,
      from: ['SUBMITTED'],
      to: 'UNDER_REVIEW',
      event_type: 'REVIEW_STARTED',
      reason_code: 'REVIEW_STARTED',
      required_actor: 'admin',
      set_reviewer: true,
    });
  }

  async requestChanges(input: {
    readonly context: RequestContext;
    readonly partner_application_id: UuidV7;
    readonly expected_version: number;
    readonly reason_code: string;
    readonly note?: string;
    readonly now?: Date;
  }): Promise<PartnerApplication> {
    if (!reasonCode.test(input.reason_code))
      throw new PartnerLifecycleInputError('reason_code must be shouting-snake-case');
    return this.#transitionApplication({
      ...input,
      from: ['UNDER_REVIEW'],
      to: 'CHANGES_REQUIRED',
      event_type: 'CHANGES_REQUESTED',
      reason_code: input.reason_code,
      note: input.note ?? null,
      required_actor: 'admin',
      set_reviewer: true,
    });
  }

  async approve(input: {
    readonly context: RequestContext;
    readonly partner_application_id: UuidV7;
    readonly expected_version: number;
    readonly reason_code: string;
    readonly note?: string;
    readonly now?: Date;
  }): Promise<PartnerApplication> {
    if (!reasonCode.test(input.reason_code))
      throw new PartnerLifecycleInputError('reason_code must be shouting-snake-case');
    return this.#transitionApplication({
      ...input,
      from: ['UNDER_REVIEW'],
      to: 'APPROVED',
      event_type: 'APPROVED',
      reason_code: input.reason_code,
      note: input.note ?? null,
      required_actor: 'admin',
      set_reviewer: true,
      touch_decided_at: true,
    });
  }

  async reject(input: {
    readonly context: RequestContext;
    readonly partner_application_id: UuidV7;
    readonly expected_version: number;
    readonly reason_code: string;
    readonly note?: string;
    readonly now?: Date;
  }): Promise<PartnerApplication> {
    if (!reasonCode.test(input.reason_code))
      throw new PartnerLifecycleInputError('reason_code must be shouting-snake-case');
    return this.#transitionApplication({
      ...input,
      from: ['UNDER_REVIEW'],
      to: 'REJECTED',
      event_type: 'REJECTED',
      reason_code: input.reason_code,
      note: input.note ?? null,
      required_actor: 'admin',
      set_reviewer: true,
      touch_decided_at: true,
    });
  }

  async getApplication(input: {
    readonly context: RequestContext;
    readonly partner_application_id: UuidV7;
  }): Promise<PartnerApplication> {
    // Applicants see only their own; admins may read any.
    const result = await this.#pool.query(
      `SELECT * FROM marketplace.partner_applications WHERE partner_application_id=$1`,
      [input.partner_application_id],
    );
    const row = result.rows[0];
    if (!row) throw new PartnerLifecycleNotFoundError();
    if (input.context.actor?.actor_kind === 'admin') return projectApplication(row);
    if (
      input.context.actor?.actor_kind === 'delivery_partner' &&
      row['applicant_user_id'] === input.context.actor.actor_id
    ) {
      return projectApplication(row);
    }
    throw new PartnerLifecycleNotFoundError();
  }

  // -----------------------------------------------------------------------
  // 9.10 -- earnings
  // -----------------------------------------------------------------------

  async recordEarnings(input: {
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
    readonly partner_user_id: UuidV7;
    readonly outcome: EarningsOutcome;
    readonly base_minor: number;
    readonly distance_minor?: number;
    readonly time_minor?: number;
    readonly wait_minor?: number;
    readonly return_minor?: number;
    readonly incentive_minor?: number;
    readonly tip_minor?: number;
    readonly adjustment_minor?: number;
    readonly now?: Date;
  }): Promise<EarningsRecord> {
    // System-only ingestion path -- called from a job after an assignment
    // reaches a terminal outcome. An admin can also record (for corrections).
    if (
      input.context.actor?.actor_kind !== 'system' &&
      input.context.actor?.actor_kind !== 'admin'
    ) {
      throw new PartnerLifecycleAuthorizationError();
    }
    const base = require_positive_minor(input.base_minor, 'base_minor');
    const distance = require_non_negative_minor(input.distance_minor ?? 0, 'distance_minor');
    const timeMinor = require_non_negative_minor(input.time_minor ?? 0, 'time_minor');
    const wait = require_non_negative_minor(input.wait_minor ?? 0, 'wait_minor');
    const returnMinor = require_non_negative_minor(input.return_minor ?? 0, 'return_minor');
    const incentive = require_non_negative_minor(input.incentive_minor ?? 0, 'incentive_minor');
    const tip = require_non_negative_minor(input.tip_minor ?? 0, 'tip_minor');
    const adjustment = require_bounded_minor(input.adjustment_minor ?? 0, 'adjustment_minor');
    const net = base + distance + timeMinor + wait + returnMinor + incentive + tip + adjustment;
    if (net < 0) throw new PartnerLifecycleInputError('net_minor cannot be negative');
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    const recordId = createUuidV7({ now_ms: now.getTime() });
    let inserted;
    try {
      inserted = await this.#pool.query(
        `INSERT INTO marketplace.partner_earnings_records
           (partner_earnings_record_id, delivery_assignment_id, partner_user_id, outcome,
            base_minor, distance_minor, time_minor, wait_minor, return_minor,
            incentive_minor, tip_minor, adjustment_minor, net_minor,
            request_id, correlation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          recordId,
          input.delivery_assignment_id,
          input.partner_user_id,
          input.outcome,
          base,
          distance,
          timeMinor,
          wait,
          returnMinor,
          incentive,
          tip,
          adjustment,
          net,
          ids.request,
          ids.correlation,
        ],
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === '23505'
      ) {
        throw new PartnerLifecycleConflictError('Earnings already recorded for this assignment');
      }
      throw error;
    }
    return projectEarnings(inserted.rows[0] as Record<string, unknown>);
  }

  async listEarnings(input: {
    readonly context: RequestContext;
    readonly limit?: number;
  }): Promise<readonly EarningsRecord[]> {
    const partnerId = requirePartner(input.context);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const result = await this.#pool.query(
      `SELECT * FROM marketplace.partner_earnings_records
        WHERE partner_user_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [partnerId, limit],
    );
    return Object.freeze(result.rows.map((row) => projectEarnings(row as Record<string, unknown>)));
  }

  // -----------------------------------------------------------------------
  // 9.10 -- disputes
  // -----------------------------------------------------------------------

  async openDispute(input: {
    readonly context: RequestContext;
    readonly partner_earnings_record_id: UuidV7;
    readonly disputed_component: DisputeComponent;
    readonly proposed_amount_minor: number;
    readonly evidence_note: string;
    readonly deadline_seconds?: number;
    readonly now?: Date;
  }): Promise<DisputeCase> {
    const partnerId = requirePartner(input.context);
    if (!disputeComponents.has(input.disputed_component))
      throw new PartnerLifecycleInputError('disputed_component is not allowed');
    if (input.evidence_note.length < 1 || input.evidence_note.length > 500)
      throw new PartnerLifecycleInputError('evidence_note must be between 1 and 500 characters');
    require_bounded_minor(input.proposed_amount_minor, 'proposed_amount_minor');
    const deadlineSeconds = input.deadline_seconds ?? 7 * 24 * 60 * 60;
    if (deadlineSeconds < 60 * 60 || deadlineSeconds > 30 * 24 * 60 * 60) {
      throw new PartnerLifecycleInputError('deadline_seconds must be between 1 hour and 30 days');
    }
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    return tx(this.#pool, async (client) => {
      const record = await client.query<Record<string, unknown>>(
        `SELECT * FROM marketplace.partner_earnings_records WHERE partner_earnings_record_id=$1 FOR UPDATE`,
        [input.partner_earnings_record_id],
      );
      const row = record.rows[0];
      if (!row) throw new PartnerLifecycleNotFoundError();
      if ((row['partner_user_id'] as string) !== partnerId)
        throw new PartnerLifecycleNotFoundError();
      const column = disputeColumn(input.disputed_component);
      const disputedAmount = Number(row[column]);
      const disputeId = createUuidV7({ now_ms: now.getTime() });
      const deadline = new Date(now.getTime() + deadlineSeconds * 1000);
      let inserted;
      try {
        inserted = await client.query(
          `INSERT INTO marketplace.partner_dispute_cases
             (partner_dispute_case_id, partner_earnings_record_id, partner_user_id,
              disputed_component, disputed_amount_minor, proposed_amount_minor,
              evidence_note, deadline_at, request_id, correlation_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [
            disputeId,
            input.partner_earnings_record_id,
            partnerId,
            input.disputed_component,
            disputedAmount,
            input.proposed_amount_minor,
            input.evidence_note,
            deadline,
            ids.request,
            ids.correlation,
          ],
        );
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: unknown }).code === '23505'
        ) {
          throw new PartnerLifecycleConflictError(
            'An open dispute already exists for this component',
          );
        }
        throw error;
      }
      return projectDispute(inserted.rows[0] as Record<string, unknown>);
    });
  }

  async resolveDispute(input: {
    readonly context: RequestContext;
    readonly partner_dispute_case_id: UuidV7;
    readonly resolution: 'RESOLVED' | 'WITHDRAWN';
    readonly resolution_reason_code?: string;
    readonly resolved_amount_minor?: number;
    readonly now?: Date;
  }): Promise<DisputeCase> {
    const now = input.now ?? new Date();
    if (input.resolution === 'RESOLVED') {
      if (!input.resolution_reason_code || !reasonCode.test(input.resolution_reason_code))
        throw new PartnerLifecycleInputError('resolution_reason_code is required for RESOLVED');
      if (input.resolved_amount_minor === undefined)
        throw new PartnerLifecycleInputError('resolved_amount_minor is required for RESOLVED');
      require_bounded_minor(input.resolved_amount_minor, 'resolved_amount_minor');
    }
    return tx(this.#pool, async (client) => {
      // Admins resolve any dispute; a partner may withdraw their own.
      const dispute = await client.query<Record<string, unknown>>(
        `SELECT * FROM marketplace.partner_dispute_cases WHERE partner_dispute_case_id=$1 FOR UPDATE`,
        [input.partner_dispute_case_id],
      );
      const row = dispute.rows[0];
      if (!row) throw new PartnerLifecycleNotFoundError();
      if (row['lifecycle_state'] !== 'OPEN')
        throw new PartnerLifecycleConflictError('Dispute is not open');
      let resolverId: UuidV7;
      if (input.resolution === 'RESOLVED') {
        resolverId = requireAdmin(input.context);
      } else {
        if (
          input.context.actor?.actor_kind === 'delivery_partner' &&
          (row['partner_user_id'] as string) === input.context.actor.actor_id
        ) {
          resolverId = input.context.actor.actor_id;
        } else if (input.context.actor?.actor_kind === 'admin') {
          resolverId = input.context.actor.actor_id;
        } else {
          throw new PartnerLifecycleAuthorizationError();
        }
      }
      const updated = await client.query(
        `UPDATE marketplace.partner_dispute_cases
            SET lifecycle_state=$2, resolver_user_id=$3, resolution_reason_code=$4,
                resolved_amount_minor=$5, resolved_at=$6, updated_at=$6
          WHERE partner_dispute_case_id=$1
        RETURNING *`,
        [
          input.partner_dispute_case_id,
          input.resolution,
          resolverId,
          input.resolution === 'RESOLVED' ? (input.resolution_reason_code ?? null) : null,
          input.resolution === 'RESOLVED' ? (input.resolved_amount_minor ?? null) : null,
          now,
        ],
      );
      return projectDispute(updated.rows[0] as Record<string, unknown>);
    });
  }

  async listDisputes(input: {
    readonly context: RequestContext;
    readonly partner_earnings_record_id?: UuidV7;
  }): Promise<readonly DisputeCase[]> {
    const partnerId = requirePartner(input.context);
    const filter = input.partner_earnings_record_id ? 'AND partner_earnings_record_id=$2' : '';
    const values: unknown[] = [partnerId];
    if (input.partner_earnings_record_id) values.push(input.partner_earnings_record_id);
    const result = await this.#pool.query(
      `SELECT * FROM marketplace.partner_dispute_cases
        WHERE partner_user_id=$1 ${filter}
        ORDER BY created_at DESC`,
      values,
    );
    return Object.freeze(result.rows.map((row) => projectDispute(row as Record<string, unknown>)));
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  async #transitionApplication(input: {
    readonly context: RequestContext;
    readonly partner_application_id: UuidV7;
    readonly expected_version: number;
    readonly from: readonly ApplicationState[];
    readonly to: ApplicationState;
    readonly event_type:
      | 'CREATED'
      | 'SUBMITTED'
      | 'REVIEW_STARTED'
      | 'CHANGES_REQUESTED'
      | 'APPROVED'
      | 'REJECTED'
      | 'APPEAL_OPENED';
    readonly reason_code: string;
    readonly note?: string | null;
    readonly required_actor: 'partner' | 'admin';
    readonly set_reviewer?: boolean;
    readonly touch_submitted_at?: boolean;
    readonly touch_decided_at?: boolean;
    readonly now?: Date;
  }): Promise<PartnerApplication> {
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    return tx(this.#pool, async (client) => {
      const actorId =
        input.required_actor === 'partner'
          ? requirePartner(input.context)
          : requireAdmin(input.context);
      const application = await client.query<Record<string, unknown>>(
        `SELECT * FROM marketplace.partner_applications WHERE partner_application_id=$1 FOR UPDATE`,
        [input.partner_application_id],
      );
      const row = application.rows[0];
      if (!row) throw new PartnerLifecycleNotFoundError();
      if (input.required_actor === 'partner' && (row['applicant_user_id'] as string) !== actorId)
        throw new PartnerLifecycleNotFoundError();
      if (!input.from.includes(row['lifecycle_state'] as ApplicationState))
        throw new PartnerLifecycleConflictError(
          `Cannot transition from ${row['lifecycle_state'] as string} to ${input.to}`,
        );
      if ((row['version'] as number) !== input.expected_version)
        throw new PartnerLifecycleConflictError('Application version has advanced');
      const updated = await client.query(
        `UPDATE marketplace.partner_applications
            SET lifecycle_state=$2,
                reason_code=$3,
                reason_note=$4,
                reviewer_user_id=CASE WHEN $5::boolean THEN $6::uuid ELSE reviewer_user_id END,
                submitted_at=CASE WHEN $7::boolean THEN $8::timestamptz ELSE submitted_at END,
                decided_at=CASE WHEN $9::boolean THEN $10::timestamptz ELSE decided_at END,
                version=version+1,
                updated_at=$10
          WHERE partner_application_id=$1
        RETURNING *`,
        [
          input.partner_application_id,
          input.to,
          input.reason_code,
          input.note ?? null,
          input.set_reviewer ?? false,
          actorId,
          input.touch_submitted_at ?? false,
          now,
          input.touch_decided_at ?? false,
          now,
        ],
      );
      // Close the onboarding -> access loop: on approval, grant the applicant
      // the DELIVERY_PARTNER role and mark them ELIGIBLE, inline in this
      // transaction so an approved partner can actually go online and receive
      // offers. Mirrors IdentityAccessService.setPartnerEligibility. Approval
      // is a one-shot terminal transition (UNDER_REVIEW -> APPROVED) guarded by
      // the state machine, so a plain insert cannot double-grant.
      if (input.to === 'APPROVED') {
        const applicantUserId = row['applicant_user_id'] as string;
        const partnerRoleAssignmentId = createUuidV7({ now_ms: now.getTime() });
        await client.query(
          `INSERT INTO marketplace.role_assignments
             (role_assignment_id, user_id, role_key, valid_from, granted_by_user_id,
              request_id, correlation_id)
           VALUES ($1,$2,'DELIVERY_PARTNER',$3,$4,$5,$6)`,
          [partnerRoleAssignmentId, applicantUserId, now, actorId, ids.request, ids.correlation],
        );
        await client.query(
          `INSERT INTO marketplace.partner_eligibilities
             (partner_eligibility_id, role_assignment_id, user_id, state, eligible_from, reason_code)
           VALUES ($1,$2,$3,'ELIGIBLE',$4,$5)`,
          [
            createUuidV7({ now_ms: now.getTime() }),
            partnerRoleAssignmentId,
            applicantUserId,
            now,
            input.reason_code,
          ],
        );
      }
      await appendApplicationEvent(client, {
        partner_application_id: input.partner_application_id,
        event_type: input.event_type,
        actor_id: actorId,
        previous_state: row['lifecycle_state'] as ApplicationState,
        resulting_state: input.to,
        reason_code: input.reason_code,
        note: input.note ?? null,
        ids,
      });
      return projectApplication(updated.rows[0] as Record<string, unknown>);
    });
  }
}

// snake_case helpers used inline. Local closures over the input names keep
// the error messages precise; extracting to top-level functions avoids
// duplication across recordEarnings and its variants.
function require_positive_minor(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 10_000_000_000)
    throw new PartnerLifecycleInputError(`${field} must be a positive integer in bounds`);
  return value;
}
function require_non_negative_minor(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000_000_000)
    throw new PartnerLifecycleInputError(`${field} must be a non-negative integer in bounds`);
  return value;
}
function require_bounded_minor(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < -10_000_000_000 || value > 10_000_000_000)
    throw new PartnerLifecycleInputError(`${field} is out of bounds`);
  return value;
}

function disputeColumn(component: DisputeComponent): string {
  switch (component) {
    case 'BASE':
      return 'base_minor';
    case 'DISTANCE':
      return 'distance_minor';
    case 'TIME':
      return 'time_minor';
    case 'WAIT':
      return 'wait_minor';
    case 'RETURN':
      return 'return_minor';
    case 'INCENTIVE':
      return 'incentive_minor';
    case 'TIP':
      return 'tip_minor';
    case 'ADJUSTMENT':
      return 'adjustment_minor';
  }
}
