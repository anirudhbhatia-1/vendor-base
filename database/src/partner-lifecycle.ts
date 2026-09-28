import { releaseServicePool, resolveServicePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import { transaction as tx } from './transaction.js';
import { grantRoleAssignment } from './role-grants.js';

export class PartnerLifecycleInputError extends Error {}
export class PartnerLifecycleNotFoundError extends Error {}
/**
 * Carries which kind of conflict it is: a stale version is fixed by reloading,
 * and every other refusal here is not. One bare 409 covered both, and clients
 * render that as "Refresh and try again".
 */
export class PartnerLifecycleConflictError extends Error {
  readonly code: 'ORDER_STATE_CONFLICT' | 'VERSION_CONFLICT';

  constructor(
    message: string,
    code: 'ORDER_STATE_CONFLICT' | 'VERSION_CONFLICT' = 'ORDER_STATE_CONFLICT',
  ) {
    super(message);
    this.code = code;
  }
}
export class PartnerLifecycleAuthorizationError extends Error {}

export type ApplicationState =
  'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'CHANGES_REQUIRED' | 'APPROVED' | 'REJECTED';

export type VehicleKind = 'BICYCLE' | 'MOTORCYCLE' | 'SCOOTER' | 'SMALL_VEHICLE';

export type EarningsOutcome = 'DELIVERED' | 'RETURNED' | 'CANCELLED_POST_PICKUP';

export type DisputeComponent =
  'BASE' | 'DISTANCE' | 'TIME' | 'WAIT' | 'RETURN' | 'INCENTIVE' | 'TIP' | 'ADJUSTMENT';

export type DisputeState = 'OPEN' | 'RESOLVED' | 'WITHDRAWN';

export type DocumentKind = 'IDENTITY' | 'VEHICLE' | 'INSURANCE';
export const DOCUMENT_KINDS: readonly DocumentKind[] = Object.freeze([
  'IDENTITY',
  'VEHICLE',
  'INSURANCE',
]);
/** How long before a document's expiry the partner is warned (9.1). */
export const DOCUMENT_EXPIRY_WARNING_DAYS = 30;

/** One document's standing: its reference, when it lapses, and whether it has. */
export interface DocumentStanding {
  readonly document_kind: DocumentKind;
  readonly document_reference: string;
  readonly expires_at: string | null;
  readonly state: 'VALID' | 'EXPIRING' | 'EXPIRED' | 'UNDATED';
  /** A renewal awaiting review, if any. */
  readonly renewal_pending: boolean;
}

/** Why a partner cannot go online, in codes the profile turns into words (9.1). */
export interface EligibilityBlocker {
  readonly code:
    | 'NO_APPLICATION'
    | 'APPLICATION_NOT_APPROVED'
    | 'DOCUMENT_EXPIRED'
    | 'ELIGIBILITY_RESTRICTED'
    | 'ELIGIBILITY_SUSPENDED'
    | 'ELIGIBILITY_PENDING'
    | 'RESTRICTION_ACTIVE'
    | 'OFFLINE_PROOF_PENDING';
  /** The document, the application state, the restriction's scope, the reason. */
  readonly detail: string | null;
  readonly until: string | null;
}

export interface OnlineEligibility {
  readonly can_go_online: boolean;
  readonly blockers: readonly EligibilityBlocker[];
  /** Not blockers yet: a document about to expire. */
  readonly warnings: readonly {
    readonly code: 'DOCUMENT_EXPIRING';
    readonly detail: string;
    readonly until: string;
  }[];
  readonly documents: readonly DocumentStanding[];
}

export interface DocumentRenewal {
  readonly partner_document_renewal_id: UuidV7;
  readonly partner_user_id: UuidV7;
  readonly document_kind: DocumentKind;
  readonly document_reference: string;
  readonly expires_at: Date;
  readonly lifecycle_state: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  readonly reviewer_user_id: UuidV7 | null;
  readonly reason_code: string | null;
  readonly note: string | null;
  readonly created_at: Date;
  readonly decided_at: Date | null;
}

export interface PartnerApplication {
  readonly partner_application_id: UuidV7;
  readonly applicant_user_id: UuidV7;
  readonly lifecycle_state: ApplicationState;
  readonly identity_reference: string;
  readonly identity_expires_at: Date | null;
  readonly vehicle_reference: string;
  readonly vehicle_expires_at: Date | null;
  readonly vehicle_kind: VehicleKind;
  readonly bank_account_reference: string;
  readonly insurance_reference: string;
  readonly insurance_expires_at: Date | null;
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

// The shapes the schema enforces (0027): every reference is a synthetic
// one in this environment. The service used to accept any reference-looking
// string and let the database refuse it as a 500 (audit run 57).
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
    identity_expires_at: (row['identity_expires_at'] as Date | null) ?? null,
    vehicle_reference: row['vehicle_reference'] as string,
    vehicle_expires_at: (row['vehicle_expires_at'] as Date | null) ?? null,
    vehicle_kind: row['vehicle_kind'] as VehicleKind,
    bank_account_reference: row['bank_account_reference'] as string,
    insurance_reference: row['insurance_reference'] as string,
    insurance_expires_at: (row['insurance_expires_at'] as Date | null) ?? null,
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
function projectRenewal(row: Record<string, unknown>): DocumentRenewal {
  return Object.freeze({
    partner_document_renewal_id: parseUuidV7(row['partner_document_renewal_id'] as string),
    partner_user_id: parseUuidV7(row['partner_user_id'] as string),
    document_kind: row['document_kind'] as DocumentKind,
    document_reference: row['document_reference'] as string,
    expires_at: row['expires_at'] as Date,
    lifecycle_state: row['lifecycle_state'] as 'SUBMITTED' | 'APPROVED' | 'REJECTED',
    reviewer_user_id: row['reviewer_user_id']
      ? parseUuidV7(row['reviewer_user_id'] as string)
      : null,
    reason_code: (row['reason_code'] as string | null) ?? null,
    note: (row['note'] as string | null) ?? null,
    created_at: row['created_at'] as Date,
    decided_at: (row['decided_at'] as Date | null) ?? null,
  });
}

/** Where each expiring document's date and reference live on the application. */
const DOCUMENT_COLUMNS: Readonly<
  Record<DocumentKind, { readonly reference: string; readonly expires: string }>
> = Object.freeze({
  IDENTITY: { reference: 'identity_reference', expires: 'identity_expires_at' },
  VEHICLE: { reference: 'vehicle_reference', expires: 'vehicle_expires_at' },
  INSURANCE: { reference: 'insurance_reference', expires: 'insurance_expires_at' },
});

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
      | 'APPEAL_OPENED'
      | 'DOCUMENT_EXPIRED'
      | 'DOCUMENT_RENEWAL_SUBMITTED'
      | 'DOCUMENT_RENEWED'
      | 'DOCUMENT_RENEWAL_REJECTED';
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

  constructor(input: { readonly connection_string: string; readonly pool?: Pool }) {
    this.#pool = resolveServicePool(input, {
      application_name: 'neighbourhood-store-partner-lifecycle',
      max: 8,
    });
  }

  async close(): Promise<void> {
    await releaseServicePool(this.#pool);
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
    /** When each expiring document lapses (9.1); each must be in the future. */
    readonly identity_expires_at: Date;
    readonly vehicle_expires_at: Date;
    readonly insurance_expires_at: Date;
    readonly now?: Date;
  }): Promise<PartnerApplication> {
    const applicantId = requirePartner(input.context);
    if (!referencePatterns.identity.test(input.identity_reference))
      throw new PartnerLifecycleInputError('identity_reference is invalid');
    if (!referencePatterns.vehicle.test(input.vehicle_reference))
      throw new PartnerLifecycleInputError('vehicle_reference is invalid');
    if (!vehicleKinds.has(input.vehicle_kind))
      throw new PartnerLifecycleInputError('vehicle_kind is not allowed');
    if (!referencePatterns.bank.test(input.bank_account_reference))
      throw new PartnerLifecycleInputError('bank_account_reference is invalid');
    if (!referencePatterns.insurance.test(input.insurance_reference))
      throw new PartnerLifecycleInputError('insurance_reference is invalid');
    if (!referencePatterns.emergency.test(input.emergency_contact_reference))
      throw new PartnerLifecycleInputError('emergency_contact_reference is invalid');
    if (!referencePatterns.training.test(input.training_reference))
      throw new PartnerLifecycleInputError('training_reference is invalid');
    if (!zoneName.test(input.home_zone_name))
      throw new PartnerLifecycleInputError('home_zone_name contains unsupported characters');
    const now = input.now ?? new Date();
    for (const [field, value] of [
      ['identity_expires_at', input.identity_expires_at],
      ['vehicle_expires_at', input.vehicle_expires_at],
      ['insurance_expires_at', input.insurance_expires_at],
    ] as const) {
      if (!(value instanceof Date) || Number.isNaN(value.getTime()) || value <= now)
        throw new PartnerLifecycleInputError(`${field} must be a date in the future`);
    }
    const ids = contextIds(input.context);
    return tx(this.#pool, async (client) => {
      const applicationId = createUuidV7({ now_ms: now.getTime() });
      let created;
      try {
        created = await client.query(
          `INSERT INTO marketplace.partner_applications
             (partner_application_id, applicant_user_id, identity_reference, vehicle_reference,
              vehicle_kind, bank_account_reference, insurance_reference, emergency_contact_reference,
              training_reference, home_zone_name, lifecycle_state, request_id, correlation_id,
              identity_expires_at, vehicle_expires_at, insurance_expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DRAFT',$11,$12,$13,$14,$15)
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
            input.identity_expires_at,
            input.vehicle_expires_at,
            input.insurance_expires_at,
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

  /**
   * The partner review queue.
   *
   * Same gap as the vendor side: an admin could open an application by id and
   * had no way to discover one, so a partner who submitted through the app
   * waited on a review nobody could find. Submitted work comes first; a draft
   * is the applicant's own and is not a reviewer's business yet.
   */
  async listApplicationsForAdmin(input: {
    readonly context: RequestContext;
    readonly limit?: number;
  }): Promise<
    readonly {
      readonly partner_application_id: UuidV7;
      readonly lifecycle_state: string;
      readonly awaiting_review: boolean;
      readonly submitted_at: Date | null;
      readonly updated_at: Date;
      readonly reason_code: string | null;
    }[]
  > {
    if (input.context.actor?.actor_kind !== 'admin') throw new PartnerLifecycleAuthorizationError();
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const result = await this.#pool.query<{
      partner_application_id: string;
      lifecycle_state: string;
      awaiting_review: boolean;
      submitted_at: Date | null;
      updated_at: Date;
      reason_code: string | null;
    }>(
      `SELECT partner_application_id, lifecycle_state, submitted_at, updated_at, reason_code,
              lifecycle_state IN ('SUBMITTED', 'UNDER_REVIEW') AS awaiting_review
         FROM marketplace.partner_applications
        WHERE lifecycle_state <> 'DRAFT'
        ORDER BY (lifecycle_state IN ('SUBMITTED', 'UNDER_REVIEW')) DESC, updated_at DESC
        LIMIT $1`,
      [limit],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          awaiting_review: row.awaiting_review,
          lifecycle_state: row.lifecycle_state,
          partner_application_id: parseUuidV7(row.partner_application_id),
          reason_code: row.reason_code,
          submitted_at: row.submitted_at,
          updated_at: row.updated_at,
        }),
      ),
    );
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

  /**
   * What a partner is allowed to do, and why not, in their own words (DLP-47, DLP-56).
   *
   * Restrictions and trust reviews were readable only from the admin console,
   * so a partner who suddenly could not go online had no way to learn that a
   * restriction existed, what it covered, when it would be reviewed, or that an
   * appeal was possible. SEC-14 and DLP-56 both require the reason, the basis,
   * the review date and the appeal route to reach the person restricted.
   *
   * Deliberately narrow: a partner sees their own cases and only the fields
   * that explain the decision. The evidence itself stays behind the admin
   * evidence viewer (ADM-38) — a reason is owed to them, another party's
   * evidence is not.
   */
  /**
   * This partner's own application, resolved from their session.
   *
   * `applicant_user_id` is UNIQUE, so the session already identifies the
   * application — yet the profile screen asked the partner to type its UUID
   * into a text box before it would show their verification state. Nobody
   * knows their own application id, so in practice the state was unreachable
   * (DLP-03) and so were the document expiries hanging off it (DLP-04).
   */
  async getOwnApplication(input: {
    readonly context: RequestContext;
  }): Promise<PartnerApplication | null> {
    const actor = input.context.actor;
    if (actor?.actor_kind !== 'delivery_partner') {
      throw new PartnerLifecycleAuthorizationError();
    }
    const found = await this.#pool.query<Record<string, unknown>>(
      `SELECT * FROM marketplace.partner_applications WHERE applicant_user_id = $1`,
      [String(actor.actor_id)],
    );
    const row = found.rows[0];
    return row ? projectApplication(row) : null;
  }

  // -----------------------------------------------------------------------
  // 9.1 -- documents, expiry, reverification, and what blocks going online
  // -----------------------------------------------------------------------

  /**
   * Each expiring document's standing for a partner, read off the approved
   * application (or, before approval, the application as it stands): VALID,
   * EXPIRING within `DOCUMENT_EXPIRY_WARNING_DAYS`, EXPIRED, or UNDATED for
   * an application made before 0099. A renewal in review is noted.
   */
  async documentStanding(
    partnerUserId: UuidV7,
    now: Date,
    client?: PoolClient,
  ): Promise<readonly DocumentStanding[]> {
    const queryable = client ?? this.#pool;
    const application = await queryable.query<Record<string, unknown>>(
      `SELECT identity_reference, identity_expires_at, vehicle_reference, vehicle_expires_at,
              insurance_reference, insurance_expires_at
         FROM marketplace.partner_applications WHERE applicant_user_id=$1`,
      [partnerUserId],
    );
    const row = application.rows[0];
    if (!row) return [];
    const pending = await queryable.query<{ document_kind: DocumentKind }>(
      `SELECT document_kind FROM marketplace.partner_document_renewals
        WHERE partner_user_id=$1 AND lifecycle_state='SUBMITTED'`,
      [partnerUserId],
    );
    const inReview = new Set(pending.rows.map((entry) => entry.document_kind));
    const warningMs = DOCUMENT_EXPIRY_WARNING_DAYS * 86_400_000;
    return Object.freeze(
      DOCUMENT_KINDS.map((kind) => {
        const columns = DOCUMENT_COLUMNS[kind];
        const expires = (row[columns.expires] as Date | null) ?? null;
        const state: DocumentStanding['state'] =
          expires === null
            ? 'UNDATED'
            : expires <= now
              ? 'EXPIRED'
              : expires.getTime() - now.getTime() <= warningMs
                ? 'EXPIRING'
                : 'VALID';
        return Object.freeze({
          document_kind: kind,
          document_reference: row[columns.reference] as string,
          expires_at: expires?.toISOString() ?? null,
          state,
          renewal_pending: inReview.has(kind),
        });
      }),
    );
  }

  /**
   * Exactly what stops this partner going online, and what is about to (9.1):
   * no application or one not yet approved; an expired document; an
   * eligibility that is not ELIGIBLE, with its reason; an active restriction
   * on the whole platform; an offline proof still to sync. Until audit run 56
   * going online failed with "Partner is not eligible" and nothing said why.
   */
  async onlineEligibility(input: {
    readonly context: RequestContext;
    readonly now?: Date;
  }): Promise<OnlineEligibility> {
    const partnerId = requirePartner(input.context);
    return this.eligibilityOf(partnerId, input.now ?? new Date());
  }

  async eligibilityOf(
    partnerId: UuidV7,
    now: Date,
    client?: PoolClient,
  ): Promise<OnlineEligibility> {
    const queryable = client ?? this.#pool;
    const blockers: EligibilityBlocker[] = [];
    const warnings: { code: 'DOCUMENT_EXPIRING'; detail: string; until: string }[] = [];
    const application = await queryable.query<{ lifecycle_state: ApplicationState }>(
      `SELECT lifecycle_state FROM marketplace.partner_applications WHERE applicant_user_id=$1`,
      [partnerId],
    );
    const state = application.rows[0]?.lifecycle_state;
    if (!state) blockers.push({ code: 'NO_APPLICATION', detail: null, until: null });
    else if (state !== 'APPROVED')
      blockers.push({ code: 'APPLICATION_NOT_APPROVED', detail: state, until: null });
    const documents = await this.documentStanding(partnerId, now, client);
    for (const document of documents) {
      if (document.state === 'EXPIRED')
        blockers.push({
          code: 'DOCUMENT_EXPIRED',
          detail: document.document_kind,
          until: document.expires_at,
        });
      else if (document.state === 'EXPIRING' && document.expires_at)
        warnings.push({
          code: 'DOCUMENT_EXPIRING',
          detail: document.document_kind,
          until: document.expires_at,
        });
    }
    const eligibility = await queryable.query<{
      state: string;
      reason_code: string | null;
      eligible_until: Date | null;
    }>(
      `SELECT state, reason_code, eligible_until FROM marketplace.partner_eligibilities
        WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1`,
      [partnerId],
    );
    const standing = eligibility.rows[0];
    if (state === 'APPROVED') {
      if (!standing || standing.state === 'PENDING')
        blockers.push({
          code: 'ELIGIBILITY_PENDING',
          detail: standing?.reason_code ?? null,
          until: null,
        });
      else if (standing.state === 'RESTRICTED')
        blockers.push({
          code: 'ELIGIBILITY_RESTRICTED',
          detail: standing.reason_code,
          until: standing.eligible_until?.toISOString() ?? null,
        });
      else if (standing.state === 'SUSPENDED')
        blockers.push({
          code: 'ELIGIBILITY_SUSPENDED',
          detail: standing.reason_code,
          until: standing.eligible_until?.toISOString() ?? null,
        });
      else if (standing.eligible_until && standing.eligible_until <= now)
        blockers.push({
          code: 'ELIGIBILITY_RESTRICTED',
          detail: 'ELIGIBILITY_LAPSED',
          until: standing.eligible_until.toISOString(),
        });
    }
    const restrictions = await queryable.query<{
      scope_kind: string;
      scope_reference: string;
      reason_code: string;
      effective_until: Date;
    }>(
      `SELECT scope_kind, scope_reference, reason_code, effective_until
         FROM marketplace.trust_restriction_cases
        WHERE subject_kind='PARTNER' AND subject_reference=$1 AND lifecycle_state='ACTIVE'
          AND effective_until > $2 AND scope_kind='GLOBAL'`,
      [String(partnerId), now],
    );
    for (const restriction of restrictions.rows)
      blockers.push({
        code: 'RESTRICTION_ACTIVE',
        detail: `${restriction.scope_kind}:${restriction.reason_code}`,
        until: restriction.effective_until.toISOString(),
      });
    const proofs = await queryable.query(
      `SELECT 1 FROM marketplace.partner_offline_proofs
        WHERE partner_user_id=$1 AND sync_state='PENDING' LIMIT 1`,
      [partnerId],
    );
    if (proofs.rows.length > 0)
      blockers.push({ code: 'OFFLINE_PROOF_PENDING', detail: null, until: null });
    return Object.freeze({
      can_go_online: blockers.length === 0,
      blockers: Object.freeze(blockers),
      warnings: Object.freeze(warnings),
      documents,
    });
  }

  /**
   * A renewed document, submitted for review (9.1): a new reference and a
   * new expiry, one renewal per document in review at a time. The application
   * it belongs to must exist; before approval the applicant edits by a
   * change request instead.
   */
  async submitDocumentRenewal(input: {
    readonly context: RequestContext;
    readonly document_kind: DocumentKind;
    readonly document_reference: string;
    readonly expires_at: Date;
    readonly now?: Date;
  }): Promise<DocumentRenewal> {
    const partnerId = requirePartner(input.context);
    if (!DOCUMENT_KINDS.includes(input.document_kind))
      throw new PartnerLifecycleInputError('document_kind is not allowed');
    const shape =
      input.document_kind === 'IDENTITY'
        ? referencePatterns.identity
        : input.document_kind === 'VEHICLE'
          ? referencePatterns.vehicle
          : referencePatterns.insurance;
    if (!shape.test(input.document_reference))
      throw new PartnerLifecycleInputError('document_reference is invalid for this document');
    const now = input.now ?? new Date();
    if (
      !(input.expires_at instanceof Date) ||
      Number.isNaN(input.expires_at.getTime()) ||
      input.expires_at <= now
    )
      throw new PartnerLifecycleInputError('expires_at must be a date in the future');
    const ids = contextIds(input.context);
    return tx(this.#pool, async (client) => {
      const application = await client.query<{
        partner_application_id: string;
        lifecycle_state: ApplicationState;
      }>(
        `SELECT partner_application_id, lifecycle_state FROM marketplace.partner_applications
          WHERE applicant_user_id=$1 FOR UPDATE`,
        [partnerId],
      );
      const row = application.rows[0];
      if (!row) throw new PartnerLifecycleNotFoundError();
      if (row.lifecycle_state !== 'APPROVED')
        throw new PartnerLifecycleConflictError(
          'A document is renewed once the application is approved; before that, resubmit it',
        );
      let inserted;
      try {
        inserted = await client.query<Record<string, unknown>>(
          `INSERT INTO marketplace.partner_document_renewals
             (partner_document_renewal_id, partner_user_id, document_kind, document_reference,
              expires_at, request_id, correlation_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            createUuidV7({ now_ms: now.getTime() }),
            partnerId,
            input.document_kind,
            input.document_reference,
            input.expires_at,
            ids.request,
            ids.correlation,
            now,
          ],
        );
      } catch (error) {
        if ((error as { code?: unknown }).code === '23505')
          throw new PartnerLifecycleConflictError(
            'A renewal of this document is already in review',
          );
        throw error;
      }
      await appendApplicationEvent(client, {
        partner_application_id: parseUuidV7(row.partner_application_id),
        event_type: 'DOCUMENT_RENEWAL_SUBMITTED',
        actor_id: partnerId,
        previous_state: null,
        resulting_state: null,
        reason_code: `${input.document_kind}_RENEWAL_SUBMITTED`,
        ids,
      });
      return projectRenewal(inserted.rows[0] as Record<string, unknown>);
    });
  }

  /** The renewals awaiting review, oldest first. */
  async listDocumentRenewalsForAdmin(input: {
    readonly context: RequestContext;
    readonly limit?: number;
  }): Promise<readonly DocumentRenewal[]> {
    requireAdmin(input.context);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const rows = await this.#pool.query<Record<string, unknown>>(
      `SELECT * FROM marketplace.partner_document_renewals
        WHERE lifecycle_state='SUBMITTED' ORDER BY created_at LIMIT $1`,
      [limit],
    );
    return Object.freeze(rows.rows.map(projectRenewal));
  }

  /**
   * The reviewer's decision on a renewal (9.1). Approval writes the new
   * reference and expiry onto the application and, if the partner had been
   * restricted for that document and no other document is expired, restores
   * their eligibility; a rejection leaves the old document and its standing.
   */
  async reviewDocumentRenewal(input: {
    readonly context: RequestContext;
    readonly partner_document_renewal_id: UuidV7;
    readonly decision: 'APPROVED' | 'REJECTED';
    readonly reason_code: string;
    readonly note?: string;
    readonly now?: Date;
  }): Promise<DocumentRenewal> {
    const reviewerId = requireAdmin(input.context);
    if (input.decision !== 'APPROVED' && input.decision !== 'REJECTED')
      throw new PartnerLifecycleInputError('decision must be APPROVED or REJECTED');
    if (!reasonCode.test(input.reason_code))
      throw new PartnerLifecycleInputError('reason_code must be shouting-snake-case');
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    return tx(this.#pool, async (client) => {
      const found = await client.query<Record<string, unknown>>(
        `SELECT * FROM marketplace.partner_document_renewals
          WHERE partner_document_renewal_id=$1 FOR UPDATE`,
        [input.partner_document_renewal_id],
      );
      const renewal = found.rows[0];
      if (!renewal) throw new PartnerLifecycleNotFoundError();
      if (renewal['lifecycle_state'] !== 'SUBMITTED')
        throw new PartnerLifecycleConflictError('This renewal has already been decided');
      const partnerId = parseUuidV7(renewal['partner_user_id'] as string);
      const kind = renewal['document_kind'] as DocumentKind;
      const updated = await client.query<Record<string, unknown>>(
        `UPDATE marketplace.partner_document_renewals
            SET lifecycle_state=$2, reviewer_user_id=$3, reason_code=$4, note=$5, decided_at=$6
          WHERE partner_document_renewal_id=$1 RETURNING *`,
        [
          input.partner_document_renewal_id,
          input.decision,
          reviewerId,
          input.reason_code,
          input.note ?? null,
          now,
        ],
      );
      const application = await client.query<{ partner_application_id: string }>(
        `SELECT partner_application_id FROM marketplace.partner_applications
          WHERE applicant_user_id=$1 FOR UPDATE`,
        [partnerId],
      );
      const applicationId = parseUuidV7(application.rows[0]?.partner_application_id as string);
      if (input.decision === 'APPROVED') {
        const columns = DOCUMENT_COLUMNS[kind];
        await client.query(
          `UPDATE marketplace.partner_applications
              SET ${columns.reference}=$2, ${columns.expires}=$3, version=version+1, updated_at=$4
            WHERE partner_application_id=$1`,
          [applicationId, renewal['document_reference'], renewal['expires_at'], now],
        );
        // Restored only when nothing else is expired: another lapsed document
        // keeps the partner off the road on its own account.
        const remaining = (await this.documentStanding(partnerId, now, client)).filter(
          (document) => document.state === 'EXPIRED',
        );
        if (remaining.length === 0) {
          await client.query(
            `UPDATE marketplace.partner_eligibilities
                SET state='ELIGIBLE', eligible_until=NULL, reason_code=$2,
                    version=version+1, updated_at=$3
              WHERE user_id=$1 AND state='RESTRICTED' AND reason_code='DOCUMENT_EXPIRED'`,
            [partnerId, `${kind}_RENEWED`, now],
          );
        }
      }
      await appendApplicationEvent(client, {
        partner_application_id: applicationId,
        event_type:
          input.decision === 'APPROVED' ? 'DOCUMENT_RENEWED' : 'DOCUMENT_RENEWAL_REJECTED',
        actor_id: reviewerId,
        previous_state: null,
        resulting_state: null,
        reason_code: input.reason_code,
        note: input.note ?? null,
        ids,
      });
      return projectRenewal(updated.rows[0] as Record<string, unknown>);
    });
  }

  /**
   * The expiry sweep (9.1): a partner whose identity, vehicle or insurance
   * document has lapsed is restricted from new work -- eligibility
   * RESTRICTED with the reason DOCUMENT_EXPIRED, recorded on the application
   * -- until a renewal is approved. A delivery already in their custody is
   * not touched: the restriction is on offers, and custody obligations stand.
   */
  async sweepExpiredDocuments(input: {
    readonly context: RequestContext;
    readonly now?: Date;
  }): Promise<readonly UuidV7[]> {
    const actor = input.context.actor;
    if (actor?.actor_kind !== 'system' && actor?.actor_kind !== 'admin')
      throw new PartnerLifecycleAuthorizationError();
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    return tx(this.#pool, async (client) => {
      const lapsed = await client.query<{
        partner_application_id: string;
        applicant_user_id: string;
        kinds: string[];
      }>(
        `SELECT a.partner_application_id, a.applicant_user_id,
                array_remove(ARRAY[
                  CASE WHEN a.identity_expires_at <= $1 THEN 'IDENTITY' END,
                  CASE WHEN a.vehicle_expires_at <= $1 THEN 'VEHICLE' END,
                  CASE WHEN a.insurance_expires_at <= $1 THEN 'INSURANCE' END], NULL) AS kinds
           FROM marketplace.partner_applications a
           JOIN marketplace.partner_eligibilities e
             ON e.user_id = a.applicant_user_id AND e.state='ELIGIBLE'
          WHERE a.lifecycle_state='APPROVED'
            AND (a.identity_expires_at <= $1 OR a.vehicle_expires_at <= $1
                 OR a.insurance_expires_at <= $1)
          FOR UPDATE OF e SKIP LOCKED`,
        [now],
      );
      const restricted: UuidV7[] = [];
      for (const row of lapsed.rows) {
        await client.query(
          `UPDATE marketplace.partner_eligibilities
              SET state='RESTRICTED', eligible_until=NULL, reason_code='DOCUMENT_EXPIRED',
                  version=version+1, updated_at=$2
            WHERE user_id=$1 AND state='ELIGIBLE'`,
          [row.applicant_user_id, now],
        );
        await appendApplicationEvent(client, {
          partner_application_id: parseUuidV7(row.partner_application_id),
          event_type: 'DOCUMENT_EXPIRED',
          actor_id: actor.actor_id,
          previous_state: null,
          resulting_state: null,
          reason_code: 'DOCUMENT_EXPIRED',
          note: row.kinds.join(', '),
          ids,
        });
        restricted.push(parseUuidV7(row.applicant_user_id));
      }
      return Object.freeze(restricted);
    });
  }

  async listOwnRestrictions(input: {
    readonly context: RequestContext;
    readonly now?: Date;
  }): Promise<
    readonly {
      readonly trust_restriction_case_id: UuidV7;
      readonly lifecycle_state: string;
      readonly scope_kind: string;
      readonly reason_code: string;
      readonly policy_reference: string;
      readonly effective_until: string;
      readonly review_at: string;
      readonly appealable: boolean;
    }[]
  > {
    const actor = input.context.actor;
    if (actor?.actor_kind !== 'delivery_partner') {
      throw new PartnerLifecycleAuthorizationError();
    }
    const rows = await this.#pool.query<{
      trust_restriction_case_id: string;
      lifecycle_state: string;
      scope_kind: string;
      reason_code: string;
      policy_reference: string;
      effective_until: Date;
      review_at: Date;
    }>(
      `SELECT trust_restriction_case_id, lifecycle_state, scope_kind, reason_code,
              policy_reference, effective_until, review_at
         FROM marketplace.trust_restriction_cases
        WHERE subject_kind = 'PARTNER' AND subject_reference = $1
          AND lifecycle_state IN ('PROPOSED', 'ACTIVE', 'EXPIRED', 'REVOKED')
        ORDER BY created_at DESC
        LIMIT 25`,
      [String(actor.actor_id)],
    );
    return Object.freeze(
      rows.rows.map((row) =>
        Object.freeze({
          trust_restriction_case_id: parseUuidV7(row.trust_restriction_case_id),
          lifecycle_state: row.lifecycle_state,
          scope_kind: row.scope_kind,
          reason_code: row.reason_code,
          policy_reference: row.policy_reference,
          effective_until: row.effective_until.toISOString(),
          review_at: row.review_at.toISOString(),
          // Only something currently in force is worth appealing; an expired or
          // revoked case is history, and offering an appeal against it would be
          // a dead end dressed up as a route.
          appealable: row.lifecycle_state === 'ACTIVE' || row.lifecycle_state === 'PROPOSED',
        }),
      ),
    );
  }

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
            request_id, correlation_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
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
          now,
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
      // The outcome is money (9.10): the difference between what the line
      // paid and what was decided lands on the earning as an adjustment
      // attributable to this dispute, and the net moves with it. The ledger
      // posting is the money service's, keyed to this row. Until audit run 65
      // the decided amount was written on the case and nothing else moved.
      if (input.resolution === 'RESOLVED') {
        const delta =
          (input.resolved_amount_minor ?? 0) - Number(row['disputed_amount_minor'] ?? 0);
        if (delta !== 0) {
          const ids = contextIds(input.context);
          await client.query(
            `INSERT INTO marketplace.partner_earning_adjustments
               (partner_earning_adjustment_id, partner_earnings_record_id, partner_user_id,
                partner_dispute_case_id, delta_minor, reason_code, decided_by_user_id,
                request_id, correlation_id, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              createUuidV7({ now_ms: now.getTime() }),
              row['partner_earnings_record_id'],
              row['partner_user_id'],
              input.partner_dispute_case_id,
              delta,
              input.resolution_reason_code,
              resolverId,
              ids.request,
              ids.correlation,
              now,
            ],
          );
          await client.query(
            `UPDATE marketplace.partner_earnings_records
                SET adjustment_minor = adjustment_minor + $2, net_minor = net_minor + $2, updated_at=$3
              WHERE partner_earnings_record_id=$1`,
            [row['partner_earnings_record_id'], delta, now],
          );
        }
      }
      return projectDispute(updated.rows[0] as Record<string, unknown>);
    });
  }

  /** What a partner's disputes have changed on their earnings (9.10). */
  async listEarningAdjustments(input: { readonly context: RequestContext }): Promise<
    readonly {
      readonly partner_earning_adjustment_id: UuidV7;
      readonly partner_earnings_record_id: UuidV7;
      readonly partner_dispute_case_id: UuidV7;
      readonly delta_minor: number;
      readonly reason_code: string;
      readonly posted: boolean;
      /** Where the payout that carries it stands (10.4); null until one does. */
      readonly payout_state: string | null;
      readonly created_at: Date;
    }[]
  > {
    const partnerId = requirePartner(input.context);
    const result = await this.#pool.query<{
      partner_earning_adjustment_id: string;
      partner_earnings_record_id: string;
      partner_dispute_case_id: string;
      delta_minor: string;
      reason_code: string;
      ledger_transaction_id: string | null;
      payout_state: string | null;
      created_at: Date;
    }>(
      `SELECT adjustment.partner_earning_adjustment_id, adjustment.partner_earnings_record_id,
              adjustment.partner_dispute_case_id, adjustment.delta_minor::text,
              adjustment.reason_code, adjustment.ledger_transaction_id, adjustment.created_at,
              (SELECT payout.payout_state
                 FROM marketplace.partner_payout_items item
                 JOIN marketplace.payouts payout ON payout.payout_id = item.payout_id
                WHERE item.partner_earning_adjustment_id = adjustment.partner_earning_adjustment_id
                  AND item.lifecycle_state <> 'RELEASED') AS payout_state
         FROM marketplace.partner_earning_adjustments adjustment
        WHERE adjustment.partner_user_id=$1 ORDER BY adjustment.created_at DESC LIMIT 100`,
      [partnerId],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          partner_earning_adjustment_id: parseUuidV7(row.partner_earning_adjustment_id),
          partner_earnings_record_id: parseUuidV7(row.partner_earnings_record_id),
          partner_dispute_case_id: parseUuidV7(row.partner_dispute_case_id),
          delta_minor: Number(row.delta_minor),
          reason_code: row.reason_code,
          posted: row.ledger_transaction_id !== null,
          payout_state: row.payout_state,
          created_at: row.created_at,
        }),
      ),
    );
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
        throw new PartnerLifecycleConflictError(
          'Application version has advanced',
          'VERSION_CONFLICT',
        );
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
        // Through the one grant path, so the access history records that the
        // approval is what granted the role -- this write used to skip that.
        const partnerRoleAssignmentId = await grantRoleAssignment(client, {
          user_id: parseUuidV7(applicantUserId),
          role_key: 'DELIVERY_PARTNER',
          granted_by_user_id: actorId,
          reason_code: input.reason_code,
          now,
          request_id: ids.request,
          correlation_id: ids.correlation,
        });
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
