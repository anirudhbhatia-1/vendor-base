import { createDatabasePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type ActorKind,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { randomInt } from 'node:crypto';
import { calculatePartnerOfferEarning } from './money-policy.js';
import { completeVendorOrder } from './vendor-order-completion.js';
import { Pool, type PoolClient } from 'pg';
import { transaction } from './transaction.js';
import { handoverCodeDigest, handoverDigestsMatch } from './handover-code.js';
import { resolveConfiguration } from './versioned-configuration.js';
import { resolveFinancialPolicy } from './financial-policy.js';
import { closeWaitTimer, openWaitTimer, waitStage, waitLeaveSeconds } from './wait-timer.js';

export type AssignmentState =
  | 'ARRIVED'
  | 'ASSIGNED'
  | 'AT_VENDOR'
  | 'CANCELLED'
  | 'DECLINED'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'EN_ROUTE_TO_CUSTOMER'
  | 'FAILED_PICKUP'
  | 'OFFERED'
  | 'OFFER_EXPIRED'
  | 'PICKED_UP'
  | 'REASSIGNED'
  | 'RETURN_AUTHORIZED'
  | 'RETURN_REQUIRED'
  | 'RETURNED'
  | 'RETURNING'
  | 'UNASSIGNED';
export type CustodyState =
  'DELIVERED' | 'IN_CUSTODY' | 'NONE' | 'PICKUP_VERIFIED' | 'RETURNED' | 'TRANSFERRED';

export interface DeliveryAssignmentRecord {
  readonly approximate_drop_area: string;
  /**
   * Route distance and expected earning, present on an offer (DLP-11, DLP-48).
   *
   * Null on an assignment read that does not compute them. An offer card showed
   * only a package count and two approximate areas, so a partner was asked to
   * accept work without being told how far it was or what it paid.
   */
  readonly route_metres?: number | null;
  /** Travel time on that route and where the route came from, when the quote stored one (0085). */
  readonly route_seconds?: number | null;
  readonly route_source?: 'ESTIMATE' | 'MAPBOX' | null;
  readonly expected_earning_minor?: number | null;
  /**
   * When the bag is, or is expected to be, ready at the store (9.3): the
   * shop's ready time, or its acceptance plus the estimate it gave. Null on
   * an assignment read that does not compute it.
   */
  readonly expected_ready_at?: Date | null;
  /** When the order is promised to the customer, once the shop has made the promise. */
  readonly promise_at?: Date | null;
  /** Why the store said it is running late, while the partner is heading there or waiting (9.5). */
  readonly delay_reason_code?: string | null;
  /** The waiting policy the partner is paid under, from the financial policy in force. */
  readonly wait_policy?: {
    readonly included_seconds: number;
    readonly per_completed_minute_minor: number;
    readonly cap_minor: number;
  } | null;
  readonly approximate_pickup_area: string;
  /**
   * Where the goods are actually going, present only while the partner is
   * holding them.
   *
   * The assignment table stores approximate areas and nothing else, which is
   * the right posture — nothing personal is persisted against a delivery job.
   * But a rider with only "SYNTH Vaishali Nagar Jaipur" cannot complete a
   * delivery, so the address is joined at read time and returned for the states
   * between taking custody and handing it over. Before pickup and after
   * completion this is absent, and the server decides that, not the client.
   */
  readonly drop_address?: DropAddress | null;
  /**
   * True while a safety report on this job is still open.
   *
   * A partner who has had an accident was still being offered "pick up",
   * "begin the route" and "record the delivery": the app kept asking them to
   * carry the job forward while the thing they had reported was unresolved.
   * The server decides this, so no client can route around it.
   */
  readonly open_emergency?: boolean;
  /**
   * Where to collect from, present for the assigned partner between
   * acceptance and pickup (9.4). The store is a business at a public address;
   * the offer names only its area, and the address is the accepted partner's.
   */
  readonly pickup_location?: PickupLocation | null;
  /** How the arrival at the store was trusted, once it has been (9.4). */
  readonly arrival_kind: ArrivalKind | null;
  readonly arrived_at: string | null;
  readonly arrival_distance_metres: number | null;
  /** A claim the position could not support, waiting for the store to confirm. */
  readonly arrival_claim: {
    readonly claimed_at: string;
    readonly reason: ArrivalClaimReason;
  } | null;
  /**
   * Where a return goes (9.9), for the partner carrying it: the store by
   * default (then `pickup_location` is on the record too), or an alternate
   * safe point operations named in words.
   */
  readonly return_destination?: {
    readonly reference: string;
    readonly note: string | null;
    readonly is_store: boolean;
  } | null;
  /** How the arrival at the customer's door was trusted (9.6), once recorded. */
  readonly customer_arrival_kind: CustomerArrivalKind | null;
  readonly customer_arrived_at: string | null;
  readonly customer_arrival_distance_metres: number | null;
  readonly customer_arrival_claim_reason: CustomerArrivalClaimReason | null;
  readonly assignment_state: AssignmentState;
  readonly custody_state: CustodyState;
  readonly delivery_assignment_id: UuidV7;
  readonly handling_flags: readonly string[];
  readonly offer_expires_at: string | null;
  readonly package_count: number;
  readonly partner_user_id: UuidV7 | null;
  readonly source_order_reference: string;
  readonly vendor_location_id: UuidV7;
  readonly vendor_order_id: UuidV7 | null;
  readonly version: number;
}

export type ArrivalKind = 'TRUSTED_LOCATION' | 'VENDOR_CONFIRMED';
export type ArrivalClaimReason = 'NO_LOCATION' | 'POOR_ACCURACY' | 'OUT_OF_RANGE';
/**
 * How the arrival at the customer's door is trusted (9.6): the device's fix at
 * the address, or -- failing that -- the customer's own code read to the
 * partner at the handover. An UNVERIFIED arrival says why the fix fell short.
 */
export type CustomerArrivalKind = 'TRUSTED_LOCATION' | 'UNVERIFIED' | 'CUSTOMER_CONFIRMED';
export type CustomerArrivalClaimReason = ArrivalClaimReason | 'NO_DESTINATION';
/** What the partner may say to the customer without a number (9.6, DLP-28). */
export const CUSTOMER_NUDGE_KINDS = Object.freeze([
  'AT_DOOR',
  'CANNOT_FIND',
  'WAITING_OUTSIDE',
] as const);
export type CustomerNudgeKind = (typeof CUSTOMER_NUDGE_KINDS)[number];
/** One nudge of each kind per this many seconds: a doorbell, not a siren. */
export const CUSTOMER_NUDGE_INTERVAL_SECONDS = 120;

/** The store the assigned partner is heading for: its name, its landmark and its point. */
export interface PickupLocation {
  readonly name: string;
  readonly landmark: string | null;
  readonly description: string | null;
  readonly latitude: number;
  readonly longitude: number;
}

/** A device position as the partner's app reports it. */
export interface DevicePosition {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy_meters: number;
}

/**
 * The arrival geofence (9.4). A position within this many metres of the
 * store, with a fix at least this good, is a trusted arrival; anything else
 * is a claim the store confirms at the counter. The radius is a SETTING
 * (`assignment.arrival_radius_metres`, 25–1000); the accuracy bar is fixed,
 * since a fix worse than a city block cannot place anyone at a counter.
 */
export const DEFAULT_ARRIVAL_RADIUS_METRES = 150;
export const MAX_TRUSTED_ACCURACY_METRES = 100;

/** The delivery destination, disclosed for the length of custody only. */
export interface DropAddress {
  readonly label: string;
  readonly pin_code: string;
  readonly landmark: string | null;
  readonly delivery_instructions: string | null;
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * The states in which the partner is holding the customer's goods.
 *
 * Custody begins at PICKED_UP and ends when the assignment reaches a terminal
 * state, so these are exactly the states in which knowing the address is part
 * of doing the job.
 */
/**
 * Reports that stop the job until somebody clears them.
 *
 * Mirrors the emergency set the field-ops service already ranks first in the
 * operations queue: an accident, a medical emergency or a threat.
 */
const SAFETY_EXCEPTION_KINDS: readonly string[] = Object.freeze([
  'ACCIDENT',
  'MEDICAL_EMERGENCY',
  'THREAT',
]);

/**
 * Whether a safety report on this job is still open.
 *
 * Written once and used by every read of an assignment, because two surfaces
 * disagreeing about whether a job is on hold is worse than neither holding it.
 * The exception table is append-only, so a row that still says OPEN may have
 * been closed by a later event — that is what the inner NOT EXISTS checks.
 * Expects the safety kinds as `$2`.
 */
const OPEN_EMERGENCY_SQL = `EXISTS (
                SELECT 1 FROM marketplace.partner_exception_events raised
                 WHERE raised.delivery_assignment_id = assignment.delivery_assignment_id
                   AND raised.exception_kind = ANY($2::text[])
                   AND raised.resolution_state = 'OPEN'
                   AND NOT EXISTS (
                     SELECT 1 FROM marketplace.partner_exception_events closed
                      WHERE closed.delivery_assignment_id = raised.delivery_assignment_id
                        AND closed.exception_kind = raised.exception_kind
                        AND closed.resolution_state <> 'OPEN'
                        AND closed.occurred_at > raised.occurred_at
                   )
              )`;

const CUSTODY_STATES: readonly AssignmentState[] = Object.freeze([
  'PICKED_UP',
  'EN_ROUTE_TO_CUSTOMER',
  'ARRIVED',
  'DELIVERY_FAILED',
]);

export class AssignmentInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}
export class AssignmentNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';
}
export class AssignmentConflictError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
}
export class AssignmentVersionError extends Error {
  readonly code = 'VERSION_CONFLICT';
}
export class AssignmentAuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
}
export class DeliveryOtpMismatchError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}
export class DeliveryOtpExpiredError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
}
export class DeliveryOtpExhaustedError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
}

interface AssignmentRow {
  approximate_drop_area: string;
  delivery_otp_hash: string | null;
  delivery_otp_expires_at: Date | null;
  delivery_otp_attempts: number;
  approximate_pickup_area: string;
  assignment_state: AssignmentState;
  custody_state: CustodyState;
  delivery_assignment_id: string;
  handling_flags: string[];
  offer_expires_at: Date | null;
  arrival_kind: ArrivalKind | null;
  arrival_distance_metres: number | null;
  arrived_at: Date | null;
  arrival_claimed_at: Date | null;
  arrival_claim_reason: ArrivalClaimReason | null;
  customer_arrival_kind: CustomerArrivalKind | null;
  customer_arrived_at: Date | null;
  customer_arrival_distance_metres: number | null;
  customer_arrival_claim_reason: CustomerArrivalClaimReason | null;
  package_count: number;
  partner_user_id: string | null;
  correlation_id: string;
  request_id: string;
  source_order_reference: string;
  vendor_location_id: string;
  vendor_order_id: string | null;
  version: number;
}

const ORDER_REFERENCE = /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/;
/**
 * The shape `assignment_event_command_shape` (0014) enforces. This was wider
 * than the constraint -- it allowed `_ . : /` and any prefix -- so a reference
 * the schema would refuse passed here and surfaced as a 500 from the database
 * instead of a 400 from the API. The partner console's `arrive-vendor` became
 * `SYNTH-CMD-ARRIVE_VENDOR-…`, and no partner could mark arrival from it.
 */
const COMMAND_REFERENCE = /^SYNTH-CMD-[A-Z0-9-]{4,64}$/;
const PROOF_REFERENCE = /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/;
const RETURN_REFERENCE = /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/;
const AREA = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} .,&'()/-]{2,95}$/u;
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;
const HANDLING = /^[A-Z][A-Z0-9_]{2,31}$/;

/**
 * Delivery-completion OTP controls (DLP-30).
 *
 * Deliberately the same shape as the vendor pickup OTP added in 0026 — one
 * mechanism for "prove the right person is standing here", not two that drift.
 */
const DELIVERY_OTP_LIFETIME_SECONDS = 900;
const DELIVERY_OTP_MAX_ATTEMPTS = 5;
/**
 * How long a completion captured without signal stays good (9.7): the code
 * was current when the customer read it, the device held it, and signal came
 * back within this window. A SETTING (`assignment.offline_proof_grace_seconds`,
 * 10 minutes to 48 hours); the worker expires unsynced proofs on the same clock.
 */
export const OFFLINE_PROOF_GRACE_SETTING = 'assignment.offline_proof_grace_seconds';
export const DEFAULT_OFFLINE_PROOF_GRACE_SECONDS = 24 * 60 * 60;

function assignmentRecord(row: AssignmentRow): DeliveryAssignmentRecord {
  return Object.freeze({
    approximate_drop_area: row.approximate_drop_area,
    approximate_pickup_area: row.approximate_pickup_area,
    assignment_state: row.assignment_state,
    custody_state: row.custody_state,
    delivery_assignment_id: parseUuidV7(row.delivery_assignment_id),
    handling_flags: Object.freeze([...row.handling_flags]),
    offer_expires_at: row.offer_expires_at?.toISOString() ?? null,
    arrival_kind: row.arrival_kind ?? null,
    arrived_at: row.arrived_at?.toISOString() ?? null,
    arrival_distance_metres: row.arrival_distance_metres ?? null,
    arrival_claim:
      row.arrival_claimed_at && row.arrival_claim_reason
        ? Object.freeze({
            claimed_at: row.arrival_claimed_at.toISOString(),
            reason: row.arrival_claim_reason,
          })
        : null,
    customer_arrival_kind: row.customer_arrival_kind ?? null,
    customer_arrived_at: row.customer_arrived_at?.toISOString() ?? null,
    customer_arrival_distance_metres: row.customer_arrival_distance_metres ?? null,
    customer_arrival_claim_reason: row.customer_arrival_claim_reason ?? null,
    package_count: row.package_count,
    partner_user_id: row.partner_user_id ? parseUuidV7(row.partner_user_id) : null,
    source_order_reference: row.source_order_reference,
    vendor_location_id: parseUuidV7(row.vendor_location_id),
    vendor_order_id: row.vendor_order_id ? parseUuidV7(row.vendor_order_id) : null,
    version: row.version,
  });
}

function displaced_partner(assignment: AssignmentRow): UuidV7 {
  if (!assignment.partner_user_id) throw new AssignmentConflictError('The attempt has no partner');
  return parseUuidV7(assignment.partner_user_id);
}

/** The states in which the assigned partner is on their way to, or at, the store. */
const HEADING_TO_STORE_STATES: readonly AssignmentState[] = Object.freeze([
  'ASSIGNED',
  'AT_VENDOR',
]);

function position(value: DevicePosition | undefined): DevicePosition | null {
  if (value === undefined) return null;
  if (
    !Number.isFinite(value.latitude) ||
    !Number.isFinite(value.longitude) ||
    Math.abs(value.latitude) > 90 ||
    Math.abs(value.longitude) > 180 ||
    !Number.isFinite(value.accuracy_meters) ||
    value.accuracy_meters < 0
  ) {
    throw new AssignmentInputError('A position needs a latitude, a longitude and an accuracy');
  }
  return value;
}

function requiredRow<T>(rows: readonly T[], message: string): T {
  const row = rows[0];
  if (!row) throw new AssignmentNotFoundError(message);
  return row;
}

function actor(
  context: RequestContext,
  allowed: readonly ActorKind[],
): { readonly id: UuidV7; readonly kind: ActorKind } {
  if (!context.actor || !allowed.includes(context.actor.actor_kind)) {
    throw new AssignmentAuthorizationError('The authenticated actor cannot perform this command');
  }
  return { id: context.actor.actor_id, kind: context.actor.actor_kind };
}

function reason(value: string): string {
  if (!REASON.test(value)) throw new AssignmentInputError('Reason code is invalid');
  return value;
}
function command(value: string): string {
  if (!COMMAND_REFERENCE.test(value)) {
    throw new AssignmentInputError('Command reference is invalid');
  }
  return value;
}
function proof(value: string): string {
  if (!PROOF_REFERENCE.test(value)) {
    throw new AssignmentInputError('Proof reference is invalid');
  }
  return value;
}
function orderReference(value: string): string {
  if (!ORDER_REFERENCE.test(value)) {
    throw new AssignmentInputError('Order reference is invalid');
  }
  return value;
}
function destinationNote(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 240) {
    throw new AssignmentInputError('A destination note is between 2 and 240 characters');
  }
  return trimmed;
}

function returnReference(value: string): string {
  if (!RETURN_REFERENCE.test(value)) {
    throw new AssignmentInputError('Return destination reference is invalid');
  }
  return value;
}
function area(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!AREA.test(normalized))
    throw new AssignmentInputError('Area contains unsupported characters');
  return normalized;
}
function packages(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new AssignmentInputError('Package count must be an integer from 1 to 100');
  }
  return value;
}
function flags(values: readonly string[]): readonly string[] {
  if (
    values.length > 10 ||
    new Set(values).size !== values.length ||
    values.some((v) => !HANDLING.test(v))
  ) {
    throw new AssignmentInputError('Handling flags are invalid');
  }
  return Object.freeze([...values]);
}
function offerExpiry(value: Date, now: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new AssignmentInputError('Offer expiry is invalid');
  const duration = value.getTime() - now.getTime();
  if (duration < 5_000 || duration > 300_000) {
    throw new AssignmentInputError('Offer expiry is outside the server-time policy boundary');
  }
  return value;
}
function ids(context: RequestContext) {
  return {
    causationId: context.causation_id ? parseUuidV7(context.causation_id) : null,
    correlationId: parseUuidV7(context.correlation_id),
    requestId: parseRequestId(context.request_id),
  };
}

async function lockAssignment(
  client: PoolClient,
  assignmentId: UuidV7,
  expectedVersion: number,
): Promise<AssignmentRow> {
  const result = await client.query<AssignmentRow>(
    'SELECT * FROM marketplace.delivery_assignments WHERE delivery_assignment_id=$1 FOR UPDATE',
    [assignmentId],
  );
  const row = requiredRow(result.rows, 'Delivery assignment was not found');
  if (!Number.isSafeInteger(expectedVersion) || row.version !== expectedVersion) {
    throw new AssignmentVersionError('Delivery assignment version is stale');
  }
  return row;
}

async function replay(
  client: PoolClient,
  input: {
    readonly command_reference: string;
    readonly delivery_assignment_id?: UuidV7;
    /** The intent(s) this command may have recorded; an arrival is one of two. */
    readonly event_type: string | readonly string[];
  },
): Promise<DeliveryAssignmentRecord | null> {
  const result = await client.query<AssignmentRow & { event_type: string }>(
    `SELECT assignment.*, event.event_type
       FROM marketplace.assignment_events event
       JOIN marketplace.delivery_assignments assignment USING (delivery_assignment_id)
      WHERE event.command_reference=$1`,
    [command(input.command_reference)],
  );
  const row = result.rows[0];
  if (!row) return null;
  const intents = typeof input.event_type === 'string' ? [input.event_type] : input.event_type;
  if (
    !intents.includes(row.event_type) ||
    (input.delivery_assignment_id !== undefined &&
      row.delivery_assignment_id !== input.delivery_assignment_id)
  ) {
    throw new AssignmentConflictError('Command reference was already used for another intent');
  }
  return assignmentRecord(row);
}

async function appendEvent(
  client: PoolClient,
  input: {
    readonly assignment: AssignmentRow;
    readonly command_reference: string;
    readonly context: RequestContext;
    readonly event_type: string;
    readonly next_custody_state: CustodyState;
    readonly next_state: AssignmentState;
    readonly now: Date;
    readonly package_count?: number;
    /**
     * The partner the event concerns. Defaults to the partner on the row being
     * transitioned; an offer names its offeree explicitly because the row does
     * not hold them yet. This is what lets dispatch see who let an offer lapse
     * -- the actor on that event is the system.
     */
    readonly partner_user_id?: UuidV7 | null;
    readonly proof_reference?: string;
    readonly reason_code: string;
    readonly who: { readonly id: UuidV7; readonly kind: ActorKind };
  },
) {
  const contextIds = ids(input.context);
  await client.query(
    `INSERT INTO marketplace.assignment_events
      (assignment_event_id, delivery_assignment_id, assignment_version, event_type,
       previous_state, resulting_state, previous_custody_state, resulting_custody_state,
       actor_id, actor_kind, reason_code, command_reference, proof_reference,
       package_count, request_id, correlation_id, causation_id, occurred_at, partner_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      createUuidV7({ now_ms: input.now.getTime() }),
      input.assignment.delivery_assignment_id,
      input.assignment.version + 1,
      input.event_type,
      input.assignment.assignment_state,
      input.next_state,
      input.assignment.custody_state,
      input.next_custody_state,
      input.who.id,
      input.who.kind,
      reason(input.reason_code),
      command(input.command_reference),
      input.proof_reference ? proof(input.proof_reference) : null,
      input.package_count ?? null,
      contextIds.requestId,
      contextIds.correlationId,
      contextIds.causationId,
      input.now,
      input.partner_user_id === undefined
        ? (input.assignment.partner_user_id ?? null)
        : input.partner_user_id,
    ],
  );
}

async function endMembership(
  client: PoolClient,
  assignment: AssignmentRow,
  now: Date,
  reasonCode: string,
) {
  if (!assignment.partner_user_id) return;
  const ended = await client.query<{ role_assignment_id: string }>(
    `WITH ended AS (
       UPDATE marketplace.partner_assignment_memberships
          SET state='ENDED', ended_at=$3, updated_at=$3, reason_code=$4
        WHERE user_id=$1 AND delivery_assignment_id=$2 AND state='ACTIVE'
        RETURNING user_id
     )
     SELECT eligibility.role_assignment_id
       FROM ended
       JOIN marketplace.partner_eligibilities eligibility USING (user_id)`,
    [assignment.partner_user_id, assignment.delivery_assignment_id, now, reason(reasonCode)],
  );
  const role = ended.rows[0];
  if (role) {
    await client.query(
      `INSERT INTO marketplace.access_membership_events
        (event_id, user_id, role_assignment_id, event_type, reason_code,
         request_id, correlation_id, occurred_at)
       VALUES ($1,$2,$3,'PARTNER_ASSIGNMENT_ENDED',$4,$5,$6,$7)`,
      [
        createUuidV7({ now_ms: now.getTime() }),
        assignment.partner_user_id,
        role.role_assignment_id,
        reason(reasonCode),
        assignment.request_id,
        assignment.correlation_id,
        now,
      ],
    );
  }
}

async function updateAssignment(
  client: PoolClient,
  input: {
    readonly assignment: AssignmentRow;
    readonly context: RequestContext;
    readonly command_reference: string;
    readonly event_type: string;
    readonly next_custody_state?: CustodyState;
    readonly next_state: AssignmentState;
    readonly now: Date;
    readonly package_count?: number;
    readonly proof_reference?: string;
    readonly reason_code: string;
    readonly who: { readonly id: UuidV7; readonly kind: ActorKind };
  },
): Promise<DeliveryAssignmentRecord> {
  const custody = input.next_custody_state ?? input.assignment.custody_state;
  await appendEvent(client, { ...input, next_custody_state: custody });
  const result = await client.query<AssignmentRow>(
    `UPDATE marketplace.delivery_assignments
        SET assignment_state=$2, custody_state=$3, version=version+1, updated_at=$4,
            offer_expires_at=CASE WHEN $2='OFFERED' THEN offer_expires_at ELSE NULL END
      WHERE delivery_assignment_id=$1 RETURNING *`,
    [input.assignment.delivery_assignment_id, input.next_state, custody, input.now],
  );
  return assignmentRecord(requiredRow(result.rows, 'Updated delivery assignment was not returned'));
}

export class AssignmentCustodyService {
  readonly #pool: Pool;
  readonly #hashKey: string | null;

  constructor(input: {
    readonly connection_string: string;
    /** Material the delivery codes are keyed with (8.6); absent, none can be minted or checked. */
    readonly hash_key?: string;
  }) {
    this.#pool = createDatabasePool({
      application_name: 'neighbourhood-store-assignment-custody',
      connectionString: input.connection_string,
      connectionTimeoutMillis: 5_000,
      max: 12,
    });
    this.#hashKey = input.hash_key ?? null;
  }

  #codeDigest(code: string): string {
    if (this.#hashKey === null) {
      throw new Error('A hash key is required to issue or check a delivery code');
    }
    return handoverCodeDigest(this.#hashKey, code);
  }

  async close() {
    await this.#pool.end();
  }

  /**
   * List delivery assignments currently offered to a specific partner. Used by
   * the partner PWA to render an incoming-offers list instead of asking the
   * partner to paste an assignment UUID by hand.
   */
  async listOffersForPartner(input: {
    readonly partner_user_id: UuidV7;
    readonly now?: Date;
  }): Promise<readonly DeliveryAssignmentRecord[]> {
    const now = input.now ?? new Date();
    // The waiting terms on the offer are the policy in force (9.3, 9.5): the
    // same terms the wait is opened under at the counter.
    const { policy } = await resolveFinancialPolicy(this.#pool, { at: now });
    const rows = await this.#pool.query<{
      delivery_assignment_id: string;
      source_order_reference: string;
      vendor_location_id: string;
      partner_user_id: string | null;
      assignment_state: string;
      custody_state: string;
      package_count: number;
      handling_flags: string[];
      approximate_pickup_area: string;
      approximate_drop_area: string;
      offer_expires_at: Date | null;
      vendor_order_id: string | null;
      version: number;
      route_metres: string | null;
      route_seconds: string | null;
      route_source: 'ESTIMATE' | 'MAPBOX' | null;
      expected_ready_at: Date | null;
      promise_at: Date | null;
    }>(
      // The route is the one the quote priced the order on -- the road from
      // the vendor to the customer's address (0085) -- so the distance a
      // partner is shown is the distance the order was actually priced on. A
      // quote older than routing carries none and falls back to the line.
      // The pickup deadline (9.3) is the shop's ready time, or its acceptance
      // plus the estimate it gave; the promise is the one made at ready.
      `SELECT a.delivery_assignment_id, a.source_order_reference, a.vendor_location_id,
              a.partner_user_id, a.assignment_state, a.custody_state, a.package_count,
              a.handling_flags, a.approximate_pickup_area, a.approximate_drop_area,
              a.offer_expires_at, a.vendor_order_id, a.version,
              COALESCE(quote_group.route_metres::bigint,
                       ST_Distance(location.coordinates, address.coordinates)::bigint)::text AS route_metres,
              quote_group.route_seconds::text AS route_seconds,
              quote_group.route_source,
              COALESCE(o.ready_at,
                       o.accepted_at + make_interval(secs => COALESCE(o.preparation_estimate_seconds, 0)))
                AS expected_ready_at,
              o.pickup_promise_at AS promise_at
         FROM marketplace.delivery_assignments a
         JOIN marketplace.vendor_locations location
           ON location.vendor_location_id = a.vendor_location_id
         LEFT JOIN marketplace.vendor_orders o ON o.vendor_order_id = a.vendor_order_id
         LEFT JOIN marketplace.checkout_groups g ON g.checkout_group_id = o.checkout_group_id
         LEFT JOIN marketplace.checkout_quotes quote
                ON quote.checkout_quote_id = g.checkout_quote_id
         LEFT JOIN marketplace.checkout_quote_groups quote_group
                ON quote_group.checkout_quote_id = quote.checkout_quote_id
               AND quote_group.vendor_location_id = a.vendor_location_id
         LEFT JOIN marketplace.customer_addresses address
                ON address.customer_address_id = quote.customer_address_id
        WHERE a.assignment_state = 'OFFERED'
          AND a.partner_user_id = $1
          AND (a.offer_expires_at IS NULL OR a.offer_expires_at > $2)
        ORDER BY a.offer_expires_at NULLS LAST, a.updated_at DESC
        LIMIT 25`,
      [parseUuidV7(input.partner_user_id), now],
    );
    return rows.rows.map((row) => {
      // An assignment whose address cannot be resolved reports no distance and
      // no earning rather than a plausible-looking guess: DLP-48 is about the
      // partner being able to trust the number.
      const routeMetres = row.route_metres === null ? null : Number(row.route_metres);
      let expectedEarning: number | null = null;
      if (routeMetres !== null && Number.isSafeInteger(routeMetres)) {
        try {
          expectedEarning = calculatePartnerOfferEarning({
            route_metres: routeMetres,
            package_count: row.package_count,
          }).total_minor;
        } catch {
          expectedEarning = null;
        }
      }
      return Object.freeze({
        route_metres: routeMetres,
        route_seconds: row.route_seconds === null ? null : Number(row.route_seconds),
        route_source: row.route_source,
        expected_earning_minor: expectedEarning,
        expected_ready_at: row.expected_ready_at ?? null,
        promise_at: row.promise_at ?? null,
        wait_policy: Object.freeze({
          included_seconds: policy.wait_included_seconds,
          per_completed_minute_minor: policy.wait_per_completed_minute_minor,
          cap_minor: policy.wait_cap_minor,
        }),
        delivery_assignment_id: parseUuidV7(row.delivery_assignment_id),
        source_order_reference: row.source_order_reference,
        vendor_location_id: parseUuidV7(row.vendor_location_id),
        partner_user_id: row.partner_user_id ? parseUuidV7(row.partner_user_id) : null,
        assignment_state: row.assignment_state as DeliveryAssignmentRecord['assignment_state'],
        custody_state: row.custody_state as DeliveryAssignmentRecord['custody_state'],
        package_count: row.package_count,
        handling_flags: row.handling_flags,
        approximate_pickup_area: row.approximate_pickup_area,
        approximate_drop_area: row.approximate_drop_area,
        offer_expires_at: row.offer_expires_at ? row.offer_expires_at.toISOString() : null,
        // An offer is before any arrival; the store's point is not on it.
        arrival_kind: null,
        arrived_at: null,
        arrival_distance_metres: null,
        arrival_claim: null,
        customer_arrival_kind: null,
        customer_arrived_at: null,
        customer_arrival_distance_metres: null,
        customer_arrival_claim_reason: null,
        vendor_order_id: row.vendor_order_id ? parseUuidV7(row.vendor_order_id) : null,
        version: row.version,
      });
    });
  }

  async listActiveForPartner(input: {
    readonly partner_user_id: UuidV7;
  }): Promise<readonly DeliveryAssignmentRecord[]> {
    // The address is joined at read time and gated in the query itself, so the
    // database never returns it outside custody. Deciding this in TypeScript
    // would leave the disclosure one refactor away from being wrong.
    const result = await this.#pool.query<
      AssignmentRow & {
        drop_label: string | null;
        drop_pin_code: string | null;
        drop_landmark: string | null;
        drop_delivery_instructions: string | null;
        drop_latitude: string | null;
        drop_longitude: string | null;
        open_emergency: boolean;
        store_name: string | null;
        store_landmark: string | null;
        store_description: string | null;
        store_latitude: string | null;
        store_longitude: string | null;
        expected_ready_at: Date | null;
        delay_reason_code: string | null;
        return_reference: string | null;
        return_note: string | null;
      }
    >(
      `SELECT assignment.*,
              ${OPEN_EMERGENCY_SQL.replaceAll('$2', '$3')} AS open_emergency,
              CASE WHEN assignment.assignment_state IN ('RETURN_AUTHORIZED', 'RETURNING')
                   THEN task.destination_reference END AS return_reference,
              CASE WHEN assignment.assignment_state IN ('RETURN_AUTHORIZED', 'RETURNING')
                   THEN task.destination_note END AS return_note,
              CASE WHEN assignment.assignment_state = ANY($4::text[])
                   THEN COALESCE(orders.ready_at,
                                 orders.accepted_at
                                   + make_interval(secs => COALESCE(orders.preparation_estimate_seconds, 0)))
                   END AS expected_ready_at,
              CASE WHEN assignment.assignment_state = ANY($4::text[])
                   THEN orders.delay_reason_code END AS delay_reason_code,
              CASE WHEN assignment.assignment_state = ANY($4::text[]) OR returning_to_store.yes
                   THEN store.location_name END AS store_name,
              CASE WHEN assignment.assignment_state = ANY($4::text[]) OR returning_to_store.yes
                   THEN store.landmark END AS store_landmark,
              CASE WHEN assignment.assignment_state = ANY($4::text[]) OR returning_to_store.yes
                   THEN store.profile_description END AS store_description,
              CASE WHEN assignment.assignment_state = ANY($4::text[]) OR returning_to_store.yes
                   THEN ST_Y(store.coordinates::geometry)::text END AS store_latitude,
              CASE WHEN assignment.assignment_state = ANY($4::text[]) OR returning_to_store.yes
                   THEN ST_X(store.coordinates::geometry)::text END AS store_longitude,
              CASE WHEN assignment.assignment_state = ANY($2::text[])
                   THEN address.label END AS drop_label,
              CASE WHEN assignment.assignment_state = ANY($2::text[])
                   THEN address.pin_code END AS drop_pin_code,
              CASE WHEN assignment.assignment_state = ANY($2::text[])
                   THEN address.landmark END AS drop_landmark,
              CASE WHEN assignment.assignment_state = ANY($2::text[])
                   THEN address.delivery_instructions END AS drop_delivery_instructions,
              CASE WHEN assignment.assignment_state = ANY($2::text[])
                   THEN ST_Y(address.coordinates::geometry)::text END AS drop_latitude,
              CASE WHEN assignment.assignment_state = ANY($2::text[])
                   THEN ST_X(address.coordinates::geometry)::text END AS drop_longitude
         FROM marketplace.delivery_assignments assignment
         JOIN marketplace.vendor_locations store
           ON store.vendor_location_id = assignment.vendor_location_id
         LEFT JOIN marketplace.return_tasks task
           ON task.delivery_assignment_id = assignment.delivery_assignment_id
         -- Returning to the store itself (9.9): the store's point is the
         -- destination unless operations named another safe point in words.
         LEFT JOIN LATERAL (
           SELECT assignment.assignment_state IN ('RETURN_AUTHORIZED', 'RETURNING')
                  AND task.destination_note IS NULL AS yes
         ) returning_to_store ON true
         LEFT JOIN marketplace.vendor_orders orders
           ON orders.vendor_order_id = assignment.vendor_order_id
         LEFT JOIN marketplace.checkout_groups grouping
           ON grouping.checkout_group_id = orders.checkout_group_id
         LEFT JOIN marketplace.checkout_quotes quote
           ON quote.checkout_quote_id = grouping.checkout_quote_id
         LEFT JOIN marketplace.customer_addresses address
           ON address.customer_address_id = quote.customer_address_id
        WHERE assignment.partner_user_id=$1
          AND assignment.assignment_state IN
            ('ASSIGNED','AT_VENDOR','PICKED_UP','EN_ROUTE_TO_CUSTOMER','ARRIVED',
             'DELIVERY_FAILED','RETURN_REQUIRED','RETURN_AUTHORIZED','RETURNING')
        ORDER BY assignment.updated_at DESC, assignment.delivery_assignment_id
        LIMIT 25`,
      [
        parseUuidV7(input.partner_user_id),
        [...CUSTODY_STATES],
        [...SAFETY_EXCEPTION_KINDS],
        [...HEADING_TO_STORE_STATES],
      ],
    );
    return result.rows.map((row) => {
      const record = Object.freeze({
        ...assignmentRecord(row),
        open_emergency: row.open_emergency,
        ...(row.expected_ready_at !== null
          ? { expected_ready_at: row.expected_ready_at, delay_reason_code: row.delay_reason_code }
          : {}),
        ...(row.return_reference !== null
          ? {
              return_destination: Object.freeze({
                reference: row.return_reference,
                note: row.return_note,
                is_store: row.return_note === null,
              }),
            }
          : {}),
        ...(row.store_name !== null && row.store_latitude !== null && row.store_longitude !== null
          ? {
              pickup_location: Object.freeze({
                name: row.store_name,
                landmark: row.store_landmark,
                description: row.store_description,
                latitude: Number(row.store_latitude),
                longitude: Number(row.store_longitude),
              }),
            }
          : {}),
      });
      if (row.drop_label === null || row.drop_latitude === null || row.drop_longitude === null) {
        return record;
      }
      return Object.freeze({
        ...record,
        drop_address: Object.freeze({
          delivery_instructions: row.drop_delivery_instructions,
          label: row.drop_label,
          landmark: row.drop_landmark,
          latitude: Number(row.drop_latitude),
          longitude: Number(row.drop_longitude),
          pin_code: row.drop_pin_code ?? '',
        }),
      });
    });
  }

  async create(input: {
    readonly approximate_drop_area: string;
    readonly approximate_pickup_area: string;
    readonly command_reference: string;
    readonly context: RequestContext;
    readonly delivery_assignment_id?: UuidV7;
    readonly handling_flags: readonly string[];
    readonly package_count: number;
    readonly reason_code: string;
    readonly source_order_reference: string;
    readonly vendor_location_id: UuidV7;
    /**
     * The vendor order this assignment carries. Automatic dispatch always knows
     * it; a manually created admin assignment may only have the reference.
     */
    readonly vendor_order_id?: UuidV7;
    readonly now?: Date;
  }): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['admin', 'system']);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        event_type: 'ASSIGNMENT_CREATED',
      });
      if (prior) return prior;
      const location = await client.query(
        'SELECT 1 FROM marketplace.vendor_locations WHERE vendor_location_id=$1',
        [input.vendor_location_id],
      );
      if (!location.rows[0]) throw new AssignmentNotFoundError('Vendor location was not found');
      const assignmentId = input.delivery_assignment_id ?? createUuidV7({ now_ms: now.getTime() });
      const contextIds = ids(input.context);
      const result = await client.query<AssignmentRow>(
        `INSERT INTO marketplace.delivery_assignments
          (delivery_assignment_id, source_order_reference, vendor_location_id,
           assignment_state, custody_state, package_count, handling_flags,
           approximate_pickup_area, approximate_drop_area, request_id,
           correlation_id, created_at, updated_at, vendor_order_id)
         VALUES ($1,$2,$3,'UNASSIGNED','NONE',$4,$5,$6,$7,$8,$9,$10,$10,$11)
         RETURNING *`,
        [
          assignmentId,
          orderReference(input.source_order_reference),
          input.vendor_location_id,
          packages(input.package_count),
          flags(input.handling_flags),
          area(input.approximate_pickup_area),
          area(input.approximate_drop_area),
          contextIds.requestId,
          contextIds.correlationId,
          now,
          input.vendor_order_id ?? null,
        ],
      );
      const created = requiredRow(result.rows, 'Created delivery assignment was not returned');
      await client.query(
        `INSERT INTO marketplace.assignment_events
          (assignment_event_id, delivery_assignment_id, assignment_version, event_type,
           previous_state, resulting_state, previous_custody_state, resulting_custody_state,
           actor_id, actor_kind, reason_code, command_reference, request_id,
           correlation_id, causation_id, occurred_at)
         VALUES ($1,$2,1,'ASSIGNMENT_CREATED',NULL,'UNASSIGNED',NULL,'NONE',
                 $3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          assignmentId,
          who.id,
          who.kind,
          reason(input.reason_code),
          command(input.command_reference),
          contextIds.requestId,
          contextIds.correlationId,
          contextIds.causationId,
          now,
        ],
      );
      return assignmentRecord(created);
    });
  }

  async offer(input: {
    readonly command_reference: string;
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
    readonly expected_version: number;
    readonly expires_at: Date;
    readonly partner_user_id: UuidV7;
    readonly reason_code: string;
    readonly now?: Date;
  }): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['admin', 'system']);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: 'OFFERED',
      });
      if (prior) return prior;
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      if (assignment.assignment_state !== 'UNASSIGNED') {
        throw new AssignmentConflictError('Only an unassigned attempt can be offered');
      }
      const eligibility = await client.query(
        `SELECT 1 FROM marketplace.partner_eligibilities eligibility
          JOIN marketplace.role_assignments role USING (role_assignment_id)
         WHERE eligibility.user_id=$1 AND eligibility.state='ELIGIBLE'
           AND role.state='ACTIVE' AND role.valid_from <= $2
           AND (role.valid_until IS NULL OR role.valid_until > $2)
           AND (eligibility.eligible_until IS NULL OR eligibility.eligible_until > $2)`,
        [input.partner_user_id, now],
      );
      if (!eligibility.rows[0]) throw new AssignmentConflictError('Partner is not eligible');
      const expiry = offerExpiry(input.expires_at, now);
      await appendEvent(client, {
        assignment,
        command_reference: input.command_reference,
        context: input.context,
        event_type: 'OFFERED',
        next_custody_state: 'NONE',
        next_state: 'OFFERED',
        now,
        partner_user_id: input.partner_user_id,
        reason_code: input.reason_code,
        who,
      });
      const result = await client.query<AssignmentRow>(
        `UPDATE marketplace.delivery_assignments
            SET assignment_state='OFFERED', partner_user_id=$2, offer_expires_at=$3,
                version=version+1, updated_at=$4
          WHERE delivery_assignment_id=$1 RETURNING *`,
        [assignment.delivery_assignment_id, input.partner_user_id, expiry, now],
      );
      return assignmentRecord(requiredRow(result.rows, 'Offered assignment was not returned'));
    });
  }

  /**
   * Returns a declined or expired attempt to the unassigned pool so it can be
   * offered to another partner.
   *
   * `DECLINED` and `OFFER_EXPIRED` used to be terminal, so a single decline or
   * a five-minute silence ended the order's only delivery attempt with nothing
   * to pick it back up. The partner is cleared from the row (an unassigned
   * attempt may not name one) while the assignment event keeps the record of
   * who declined.
   */
  async returnToPool(input: {
    readonly command_reference: string;
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
    readonly expected_version: number;
    readonly reason_code: string;
    readonly now?: Date;
  }): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['admin', 'system']);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: 'REASSIGNED',
      });
      if (prior) return prior;
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      if (
        assignment.assignment_state !== 'DECLINED' &&
        assignment.assignment_state !== 'OFFER_EXPIRED'
      ) {
        throw new AssignmentConflictError('Only a declined or expired attempt returns to the pool');
      }
      await appendEvent(client, {
        assignment,
        command_reference: input.command_reference,
        context: input.context,
        event_type: 'REASSIGNED',
        next_custody_state: 'NONE',
        next_state: 'UNASSIGNED',
        now,
        reason_code: input.reason_code,
        who,
      });
      const result = await client.query<AssignmentRow>(
        `UPDATE marketplace.delivery_assignments
            SET assignment_state='UNASSIGNED', partner_user_id=NULL, offer_expires_at=NULL,
                custody_state='NONE', version=version+1, updated_at=$2
          WHERE delivery_assignment_id=$1 RETURNING *`,
        [assignment.delivery_assignment_id, now],
      );
      return assignmentRecord(requiredRow(result.rows, 'Returned assignment was not returned'));
    });
  }

  /**
   * An operator takes the attempt from its partner and puts it back to the
   * pool (9.3): from OFFERED, ASSIGNED or AT_VENDOR, before custody. The
   * REASSIGNED event names the displaced partner (who is not offered it
   * again), the reason is theirs to read, and what they are owed for the road
   * already travelled is recorded -- zero is a decision too. Until audit run
   * 58 ending an attempt as REASSIGNED left the order with no attempt at all
   * and nothing on record for the partner.
   */
  async reassign(input: {
    readonly command_reference: string;
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
    readonly expected_version: number;
    readonly reason_code: string;
    readonly compensation_minor: number;
    readonly note?: string;
    readonly now?: Date;
  }): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['admin']);
    if (
      !Number.isSafeInteger(input.compensation_minor) ||
      input.compensation_minor < 0 ||
      input.compensation_minor > 100_000
    ) {
      throw new AssignmentInputError('Compensation must be a whole amount between 0 and 100000');
    }
    if (input.note !== undefined && (input.note.length < 1 || input.note.length > 500)) {
      throw new AssignmentInputError('A note must be between 1 and 500 characters');
    }
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: 'REASSIGNED',
      });
      if (prior) return prior;
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      if (
        !['OFFERED', 'ASSIGNED', 'AT_VENDOR'].includes(assignment.assignment_state) ||
        assignment.custody_state !== 'NONE' ||
        !assignment.partner_user_id
      ) {
        throw new AssignmentConflictError(
          'Only an attempt with a partner and no custody can be reassigned',
        );
      }
      const displaced = parseUuidV7(assignment.partner_user_id);
      await endMembership(client, assignment, now, input.reason_code);
      const contextIds = ids(input.context);
      await client.query(
        `INSERT INTO marketplace.partner_attempt_compensations
           (partner_attempt_compensation_id, delivery_assignment_id, partner_user_id,
            decided_by_user_id, displaced_from, amount_minor, reason_code, note,
            request_id, correlation_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          assignment.delivery_assignment_id,
          displaced,
          who.id,
          assignment.assignment_state,
          input.compensation_minor,
          reason(input.reason_code),
          input.note ?? null,
          contextIds.requestId,
          contextIds.correlationId,
          now,
        ],
      );
      await appendEvent(client, {
        assignment,
        command_reference: input.command_reference,
        context: input.context,
        event_type: 'REASSIGNED',
        next_custody_state: 'NONE',
        next_state: 'UNASSIGNED',
        now,
        partner_user_id: displaced,
        reason_code: input.reason_code,
        who,
      });
      const result = await client.query<AssignmentRow>(
        `UPDATE marketplace.delivery_assignments
            SET assignment_state='UNASSIGNED', partner_user_id=NULL, offer_expires_at=NULL,
                custody_state='NONE', version=version+1, updated_at=$2
          WHERE delivery_assignment_id=$1 RETURNING *`,
        [assignment.delivery_assignment_id, now],
      );
      return assignmentRecord(requiredRow(result.rows, 'Reassigned attempt was not returned'));
    });
  }

  /** What a partner has been recorded as owed for attempts taken from them (9.3). */
  async listCompensationsForPartner(input: {
    readonly context: RequestContext;
    readonly now?: Date;
  }): Promise<
    readonly {
      readonly partner_attempt_compensation_id: UuidV7;
      readonly delivery_assignment_id: UuidV7;
      readonly displaced_from: string;
      readonly amount_minor: number;
      readonly reason_code: string;
      readonly created_at: string;
    }[]
  > {
    const who = actor(input.context, ['delivery_partner']);
    const rows = await this.#pool.query<{
      partner_attempt_compensation_id: string;
      delivery_assignment_id: string;
      displaced_from: string;
      amount_minor: string;
      reason_code: string;
      created_at: Date;
    }>(
      `SELECT partner_attempt_compensation_id, delivery_assignment_id, displaced_from,
              amount_minor::text AS amount_minor, reason_code, created_at
         FROM marketplace.partner_attempt_compensations
        WHERE partner_user_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [who.id],
    );
    return Object.freeze(
      rows.rows.map((row) =>
        Object.freeze({
          partner_attempt_compensation_id: parseUuidV7(row.partner_attempt_compensation_id),
          delivery_assignment_id: parseUuidV7(row.delivery_assignment_id),
          displaced_from: row.displaced_from,
          amount_minor: Number(row.amount_minor),
          reason_code: row.reason_code,
          created_at: row.created_at.toISOString(),
        }),
      ),
    );
  }

  /**
   * What each partner has already done with this attempt.
   *
   * `declined` are excluded from re-offer outright: asking again is the
   * pressure DLP-11 rules out. `passes` counts the offers a partner let expire,
   * so dispatch can prefer whoever has had the fewest chances -- without it the
   * nearest online partner was re-offered every expired attempt, and a second
   * partner standing ready never saw the job. Read from the events, because the
   * assignment row forgets its partner when the attempt returns to the pool.
   */
  async offerHistory(input: { readonly delivery_assignment_id: UuidV7 }): Promise<{
    readonly declined: readonly UuidV7[];
    readonly passes: ReadonlyMap<UuidV7, number>;
  }> {
    const rows = await this.#pool.query<{
      event_type: string;
      actor_id: string;
      partner_user_id: string | null;
    }>(
      // A partner an operator took the attempt from (REASSIGNED by an admin,
      // 9.3) is not offered it again either.
      `SELECT event_type, actor_id, partner_user_id FROM marketplace.assignment_events
        WHERE delivery_assignment_id=$1
          AND ((event_type='DECLINED' AND actor_kind='delivery_partner')
               OR (event_type='OFFER_EXPIRED' AND partner_user_id IS NOT NULL)
               OR (event_type='REASSIGNED' AND actor_kind='admin' AND partner_user_id IS NOT NULL)
               OR (event_type='LEFT_AFTER_WAIT' AND partner_user_id IS NOT NULL))`,
      [input.delivery_assignment_id],
    );
    const declined = new Set<UuidV7>();
    const passes = new Map<UuidV7, number>();
    for (const row of rows.rows) {
      if (row.event_type === 'DECLINED') {
        declined.add(parseUuidV7(row.actor_id));
      } else if (
        (row.event_type === 'REASSIGNED' || row.event_type === 'LEFT_AFTER_WAIT') &&
        row.partner_user_id
      ) {
        declined.add(parseUuidV7(row.partner_user_id));
      } else if (row.partner_user_id) {
        const partner = parseUuidV7(row.partner_user_id);
        passes.set(partner, (passes.get(partner) ?? 0) + 1);
      }
    }
    return { declined: [...declined], passes };
  }

  async accept(input: {
    readonly command_reference: string;
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
    readonly expected_version: number;
    readonly reason_code: string;
    readonly now?: Date;
  }): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['delivery_partner']);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: 'ACCEPTED',
      });
      if (prior) return prior;
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      if (assignment.assignment_state !== 'OFFERED' || assignment.partner_user_id !== who.id) {
        throw new AssignmentConflictError('Offer is not available to this partner');
      }
      if (!assignment.offer_expires_at || assignment.offer_expires_at <= now) {
        throw new AssignmentConflictError('Offer has expired');
      }
      const eligibility = await client.query<{ role_assignment_id: string }>(
        `SELECT eligibility.role_assignment_id
           FROM marketplace.partner_eligibilities eligibility
           JOIN marketplace.role_assignments role USING (role_assignment_id)
          WHERE eligibility.user_id=$1 AND eligibility.state='ELIGIBLE'
            AND role.state='ACTIVE' AND role.valid_from <= $2
            AND (role.valid_until IS NULL OR role.valid_until > $2)
            AND (eligibility.eligible_until IS NULL OR eligibility.eligible_until > $2)
          FOR SHARE OF eligibility`,
        [who.id, now],
      );
      const role = requiredRow(eligibility.rows, 'Eligible partner role was not found');
      const membershipId = createUuidV7({ now_ms: now.getTime() });
      try {
        await client.query(
          `INSERT INTO marketplace.partner_assignment_memberships
            (partner_assignment_membership_id, user_id, delivery_assignment_id,
             state, activated_at, reason_code, created_at, updated_at)
           VALUES ($1,$2,$3,'ACTIVE',$4,$5,$4,$4)`,
          [membershipId, who.id, assignment.delivery_assignment_id, now, 'ASSIGNMENT_ACCEPTED'],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new AssignmentConflictError('Partner already has active work');
        }
        throw error;
      }
      const contextIds = ids(input.context);
      await client.query(
        `INSERT INTO marketplace.access_membership_events
          (event_id, user_id, role_assignment_id, event_type, reason_code,
           request_id, correlation_id, occurred_at)
         VALUES ($1,$2,$3,'PARTNER_ASSIGNMENT_ACTIVATED',$4,$5,$6,$7)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          who.id,
          role.role_assignment_id,
          'ASSIGNMENT_ACCEPTED',
          contextIds.requestId,
          contextIds.correlationId,
          now,
        ],
      );
      return updateAssignment(client, {
        assignment,
        command_reference: input.command_reference,
        context: input.context,
        event_type: 'ACCEPTED',
        next_state: 'ASSIGNED',
        now,
        reason_code: input.reason_code,
        who,
      });
    });
  }

  /** How long a completion held offline stays good, in force at `at` (9.7). */
  async offlineProofGraceSeconds(at?: Date): Promise<number> {
    const resolved = await resolveConfiguration(this.#pool, {
      configuration_key: OFFLINE_PROOF_GRACE_SETTING,
      configuration_kind: 'SETTING',
      ...(at ? { at } : {}),
    });
    const value = resolved?.configuration_value;
    return typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 600 &&
      value <= 48 * 60 * 60
      ? value
      : DEFAULT_OFFLINE_PROOF_GRACE_SECONDS;
  }

  /** The arrival geofence in force at `at` (9.4). */
  async arrivalRadiusMetres(at?: Date): Promise<number> {
    const resolved = await resolveConfiguration(this.#pool, {
      configuration_key: 'assignment.arrival_radius_metres',
      configuration_kind: 'SETTING',
      ...(at ? { at } : {}),
    });
    const value = resolved?.configuration_value;
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 25 && value <= 1000
      ? value
      : DEFAULT_ARRIVAL_RADIUS_METRES;
  }

  /**
   * Arrival at the store (9.4): trusted by position, or claimed for the store
   * to confirm.
   *
   * With a position within the arrival radius and a fix at least as good as
   * `MAX_TRUSTED_ACCURACY_METRES`, the attempt moves to AT_VENDOR as a
   * TRUSTED_LOCATION arrival and the distance is recorded. Without a usable
   * position -- none, a poor fix, or one out of range -- the attempt stays
   * ASSIGNED with a claim on it (when, and why), and `confirmPartnerArrival`
   * by the store's own staff completes it. Until audit run 59 the partner's
   * word alone moved the attempt to AT_VENDOR from anywhere.
   */
  async arriveAtVendor(
    input: TransitionInput & { readonly position?: DevicePosition },
  ): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['delivery_partner']);
    const fix = position(input.position);
    const now = input.now ?? new Date();
    const radius = await this.arrivalRadiusMetres(now);
    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: ['AT_VENDOR', 'ARRIVAL_CLAIMED'],
      });
      if (prior) return prior;
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      this.#assertPartner(assignment, who.id);
      if (assignment.assignment_state !== 'ASSIGNED') {
        throw new AssignmentConflictError('Assignment must be ASSIGNED');
      }
      let distance: number | null = null;
      if (fix) {
        const measured = await client.query<{ metres: string }>(
          `SELECT ST_Distance(coordinates, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)::integer::text AS metres
             FROM marketplace.vendor_locations WHERE vendor_location_id=$1`,
          [assignment.vendor_location_id, fix.longitude, fix.latitude],
        );
        distance = Number(requiredRow(measured.rows, 'The store was not found').metres);
      }
      const trusted =
        fix !== null &&
        fix.accuracy_meters <= MAX_TRUSTED_ACCURACY_METRES &&
        distance !== null &&
        distance <= radius;
      if (trusted) {
        await appendEvent(client, {
          assignment,
          command_reference: input.command_reference,
          context: input.context,
          event_type: 'AT_VENDOR',
          next_custody_state: assignment.custody_state,
          next_state: 'AT_VENDOR',
          now,
          reason_code: 'TRUSTED_VENDOR_ARRIVAL',
          who,
        });
        const result = await client.query<AssignmentRow>(
          `UPDATE marketplace.delivery_assignments
              SET assignment_state='AT_VENDOR', arrival_kind='TRUSTED_LOCATION',
                  arrived_at=$2, arrival_distance_metres=$3,
                  arrival_claimed_at=NULL, arrival_claim_reason=NULL,
                  version=version+1, updated_at=$2
            WHERE delivery_assignment_id=$1 RETURNING *`,
          [assignment.delivery_assignment_id, now, distance],
        );
        await this.#openWait(client, input.context, assignment, who.id, now);
        return assignmentRecord(requiredRow(result.rows, 'Arrived attempt was not returned'));
      }
      const reasonForClaim: ArrivalClaimReason =
        fix === null
          ? 'NO_LOCATION'
          : fix.accuracy_meters > MAX_TRUSTED_ACCURACY_METRES
            ? 'POOR_ACCURACY'
            : 'OUT_OF_RANGE';
      await appendEvent(client, {
        assignment,
        command_reference: input.command_reference,
        context: input.context,
        event_type: 'ARRIVAL_CLAIMED',
        next_custody_state: assignment.custody_state,
        next_state: 'ASSIGNED',
        now,
        reason_code: reasonForClaim,
        who,
      });
      const result = await client.query<AssignmentRow>(
        `UPDATE marketplace.delivery_assignments
            SET arrival_claimed_at=$2, arrival_claim_reason=$3, arrival_distance_metres=$4,
                version=version+1, updated_at=$2
          WHERE delivery_assignment_id=$1 RETURNING *`,
        [assignment.delivery_assignment_id, now, reasonForClaim, distance],
      );
      return assignmentRecord(requiredRow(result.rows, 'Claimed attempt was not returned'));
    });
  }

  /**
   * The store confirms the partner at its counter (9.4): the approved
   * fallback for an arrival the position could not support. Only staff of the
   * assignment's own store, only for a claimed arrival, never for an attempt
   * that is not ASSIGNED.
   */
  async confirmPartnerArrival(input: {
    readonly command_reference: string;
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly expected_version: number;
    readonly now?: Date;
  }): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['vendor_staff']);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: 'AT_VENDOR',
      });
      if (prior) return prior;
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      if (assignment.vendor_location_id !== input.vendor_location_id) {
        throw new AssignmentNotFoundError('Delivery assignment was not found');
      }
      const membership = await client.query(
        `SELECT 1
           FROM marketplace.role_assignments ra
           JOIN marketplace.staff_memberships sm USING (role_assignment_id)
          WHERE ra.user_id=$1 AND sm.vendor_location_id=$2 AND ra.state='ACTIVE'
            AND ra.valid_from <= $3 AND (ra.valid_until IS NULL OR ra.valid_until > $3)
          LIMIT 1`,
        [who.id, assignment.vendor_location_id, now],
      );
      if (membership.rows.length === 0) {
        throw new AssignmentAuthorizationError('Only the store’s own staff can confirm an arrival');
      }
      if (assignment.assignment_state !== 'ASSIGNED' || !assignment.arrival_claimed_at) {
        throw new AssignmentConflictError('Only a claimed arrival can be confirmed');
      }
      await appendEvent(client, {
        assignment,
        command_reference: input.command_reference,
        context: input.context,
        event_type: 'AT_VENDOR',
        next_custody_state: assignment.custody_state,
        next_state: 'AT_VENDOR',
        now,
        reason_code: 'VENDOR_CONFIRMED_ARRIVAL',
        who,
      });
      const result = await client.query<AssignmentRow>(
        `UPDATE marketplace.delivery_assignments
            SET assignment_state='AT_VENDOR', arrival_kind='VENDOR_CONFIRMED', arrived_at=$2,
                arrival_claimed_at=NULL, arrival_claim_reason=NULL,
                version=version+1, updated_at=$2
          WHERE delivery_assignment_id=$1 RETURNING *`,
        [assignment.delivery_assignment_id, now],
      );
      await this.#openWait(client, input.context, assignment, displaced_partner(assignment), now);
      return assignmentRecord(requiredRow(result.rows, 'Confirmed attempt was not returned'));
    });
  }

  /**
   * The vendor wait starts when the arrival is recorded (9.5): the server's
   * clock, under the policy in force, from the moment presence was trusted
   * or confirmed. Until audit run 60 it was the partner's to remember to
   * start, so a partner who did not press the button waited unpaid.
   */
  async #openWait(
    client: PoolClient,
    context: RequestContext,
    assignment: AssignmentRow,
    partnerUserId: UuidV7,
    now: Date,
  ): Promise<void> {
    const { policy } = await resolveFinancialPolicy(client, { at: now });
    await openWaitTimer(client, {
      context,
      delivery_assignment_id: parseUuidV7(assignment.delivery_assignment_id),
      partner_user_id: partnerUserId,
      policy,
      leave_threshold_seconds: await waitLeaveSeconds(client, now),
      reason_code: 'ARRIVAL_AT_STORE',
      now,
    });
  }

  /**
   * Leaving the store under the policy (9.5, DLP-36). Once the wait has
   * reached its leave threshold the partner may go: the wait closes with what
   * it is owed on record, the membership ends, the attempt returns to the
   * pool for another partner -- not this one -- and the store keeps its order.
   * Until audit run 60 the only "leave" was the customer's door, so at the
   * store the button the app showed was refused.
   */
  async leaveStoreAfterWait(input: TransitionInput): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['delivery_partner']);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: 'LEFT_AFTER_WAIT',
      });
      if (prior) return prior;
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      this.#assertPartner(assignment, who.id);
      if (assignment.assignment_state !== 'AT_VENDOR' || assignment.custody_state !== 'NONE') {
        throw new AssignmentConflictError('Leaving under the policy is for a partner at the store');
      }
      const wait = await client.query<Parameters<typeof waitStage>[0]>(
        `SELECT * FROM marketplace.partner_wait_timers
          WHERE delivery_assignment_id=$1 AND partner_user_id=$2 FOR UPDATE`,
        [assignment.delivery_assignment_id, who.id],
      );
      const open = wait.rows[0];
      if (!open || waitStage(open, now) !== 'THRESHOLD_TWO') {
        throw new AssignmentConflictError('Leave policy threshold has not been reached');
      }
      await closeWaitTimer(client, {
        context: input.context,
        delivery_assignment_id: input.delivery_assignment_id,
        partner_user_id: who.id,
        outcome: 'LEFT_POLICY',
        command_reference: input.command_reference,
        reason_code: input.reason_code,
        now,
      });
      await endMembership(client, assignment, now, input.reason_code);
      await appendEvent(client, {
        assignment,
        command_reference: input.command_reference,
        context: input.context,
        event_type: 'LEFT_AFTER_WAIT',
        next_custody_state: 'NONE',
        next_state: 'UNASSIGNED',
        now,
        reason_code: input.reason_code,
        who,
      });
      const result = await client.query<AssignmentRow>(
        `UPDATE marketplace.delivery_assignments
            SET assignment_state='UNASSIGNED', partner_user_id=NULL, offer_expires_at=NULL,
                custody_state='NONE', arrival_kind=NULL, arrived_at=NULL,
                arrival_distance_metres=NULL, arrival_claimed_at=NULL, arrival_claim_reason=NULL,
                version=version+1, updated_at=$2
          WHERE delivery_assignment_id=$1 RETURNING *`,
        [assignment.delivery_assignment_id, now],
      );
      return assignmentRecord(requiredRow(result.rows, 'Left attempt was not returned'));
    });
  }
  async beginRoute(input: TransitionInput): Promise<DeliveryAssignmentRecord> {
    return this.#partnerTransition(input, 'PICKED_UP', 'EN_ROUTE_TO_CUSTOMER', 'EN_ROUTE');
  }
  /**
   * Arrival at the customer's door (9.6). The device's fix is measured
   * against the delivery address: within the arrival radius with a usable
   * accuracy it is a TRUSTED_LOCATION arrival; otherwise the arrival stands
   * UNVERIFIED with its reason. Either way the partner proceeds -- the
   * customer reading their code is the proof of the door, and a delivery
   * against it makes the arrival CUSTOMER_CONFIRMED -- but only a trusted
   * arrival earns the customer-unreachable waiting pay. Until audit run 61
   * the partner's word from anywhere was the arrival.
   */
  async arriveAtCustomer(
    input: TransitionInput & { readonly position?: DevicePosition },
  ): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['delivery_partner']);
    const fix = position(input.position);
    const now = input.now ?? new Date();
    const radius = await this.arrivalRadiusMetres(now);
    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: 'ARRIVED',
      });
      if (prior) return prior;
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      this.#assertPartner(assignment, who.id);
      if (
        assignment.assignment_state !== 'EN_ROUTE_TO_CUSTOMER' ||
        assignment.custody_state !== 'IN_CUSTODY'
      ) {
        throw new AssignmentConflictError('Assignment must be EN_ROUTE_TO_CUSTOMER');
      }
      // The door, as the quote fixed it. An attempt with no order behind it
      // has no door to measure against.
      const destination = await client.query<{ metres: string | null }>(
        `SELECT CASE WHEN $2::double precision IS NULL THEN NULL
                     ELSE ST_Distance(address.coordinates,
                                      ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)::integer
                     END::text AS metres
           FROM marketplace.delivery_assignments assignment
           JOIN marketplace.vendor_orders orders ON orders.vendor_order_id = assignment.vendor_order_id
           JOIN marketplace.checkout_groups grouping ON grouping.checkout_group_id = orders.checkout_group_id
           JOIN marketplace.checkout_quotes quote ON quote.checkout_quote_id = grouping.checkout_quote_id
           JOIN marketplace.customer_addresses address
             ON address.customer_address_id = quote.customer_address_id
          WHERE assignment.delivery_assignment_id = $1`,
        [assignment.delivery_assignment_id, fix?.longitude ?? null, fix?.latitude ?? null],
      );
      const door = destination.rows[0];
      const distance = door?.metres == null ? null : Number(door.metres);
      let kind: CustomerArrivalKind = 'UNVERIFIED';
      let reasonForClaim: CustomerArrivalClaimReason | null = null;
      if (!door) reasonForClaim = 'NO_DESTINATION';
      else if (fix === null) reasonForClaim = 'NO_LOCATION';
      else if (fix.accuracy_meters > MAX_TRUSTED_ACCURACY_METRES) reasonForClaim = 'POOR_ACCURACY';
      else if (distance === null || distance > radius) reasonForClaim = 'OUT_OF_RANGE';
      else kind = 'TRUSTED_LOCATION';
      await appendEvent(client, {
        assignment,
        command_reference: input.command_reference,
        context: input.context,
        event_type: 'ARRIVED',
        next_custody_state: 'IN_CUSTODY',
        next_state: 'ARRIVED',
        now,
        reason_code:
          kind === 'TRUSTED_LOCATION' ? 'TRUSTED_CUSTOMER_ARRIVAL' : 'UNVERIFIED_CUSTOMER_ARRIVAL',
        who,
      });
      const result = await client.query<AssignmentRow>(
        `UPDATE marketplace.delivery_assignments
            SET assignment_state='ARRIVED', customer_arrival_kind=$2, customer_arrived_at=$3,
                customer_arrival_distance_metres=$4, customer_arrival_claim_reason=$5,
                version=version+1, updated_at=$3
          WHERE delivery_assignment_id=$1 RETURNING *`,
        [assignment.delivery_assignment_id, kind, now, distance, reasonForClaim],
      );
      return assignmentRecord(requiredRow(result.rows, 'Arrived attempt was not returned'));
    });
  }

  /**
   * What the partner may send the customer, and to whom (9.6, DLP-28). No
   * number and no name cross: the platform delivers a fixed message to the
   * order's customer, once per kind per `CUSTOMER_NUDGE_INTERVAL_SECONDS`,
   * only while the partner is holding the goods. The caller enqueues it; the
   * deduplication key makes the enqueue idempotent.
   */
  async customerNudge(input: {
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
    readonly kind: CustomerNudgeKind;
    readonly now?: Date;
  }): Promise<{
    readonly recipient_user_id: UuidV7;
    readonly order_reference: string;
    readonly deduplication_key: string;
    readonly template_key: string;
  }> {
    const who = actor(input.context, ['delivery_partner']);
    if (!CUSTOMER_NUDGE_KINDS.includes(input.kind)) {
      throw new AssignmentInputError('That is not a message the platform sends');
    }
    const now = input.now ?? new Date();
    const found = await this.#pool.query<{
      partner_user_id: string | null;
      assignment_state: AssignmentState;
      customer_user_id: string | null;
      order_reference: string | null;
      last_nudged_at: Date | null;
    }>(
      `SELECT assignment.partner_user_id, assignment.assignment_state,
              grouping.customer_user_id, orders.order_reference,
              (SELECT max(intent.created_at) FROM marketplace.notification_intents intent
                WHERE intent.source_kind='partner_nudge'
                  AND intent.deduplication_key LIKE $2) AS last_nudged_at
         FROM marketplace.delivery_assignments assignment
         LEFT JOIN marketplace.vendor_orders orders ON orders.vendor_order_id = assignment.vendor_order_id
         LEFT JOIN marketplace.checkout_groups grouping ON grouping.checkout_group_id = orders.checkout_group_id
        WHERE assignment.delivery_assignment_id=$1`,
      [
        input.delivery_assignment_id,
        `partner_nudge:${input.delivery_assignment_id}:${input.kind}:%`,
      ],
    );
    const row = requiredRow(found.rows, 'Delivery assignment was not found');
    if (row.partner_user_id !== who.id) {
      throw new AssignmentNotFoundError('Delivery assignment was not found');
    }
    if (!CUSTODY_STATES.includes(row.assignment_state)) {
      throw new AssignmentConflictError(
        'The customer can be reached while you are holding their order',
      );
    }
    if (!row.customer_user_id || !row.order_reference) {
      throw new AssignmentConflictError('This attempt has no customer to reach');
    }
    if (
      row.last_nudged_at &&
      now.getTime() - row.last_nudged_at.getTime() < CUSTOMER_NUDGE_INTERVAL_SECONDS * 1_000
    ) {
      throw new AssignmentConflictError(
        'Give the customer a couple of minutes before asking again',
      );
    }
    const bucket = Math.floor(now.getTime() / (CUSTOMER_NUDGE_INTERVAL_SECONDS * 1_000));
    return Object.freeze({
      recipient_user_id: parseUuidV7(row.customer_user_id),
      order_reference: row.order_reference,
      deduplication_key: `partner_nudge:${input.delivery_assignment_id}:${input.kind}:${bucket}`,
      template_key: `partner_nudge.${input.kind.toLowerCase()}`,
    });
  }

  async confirmPickup(
    input: TransitionInput & {
      readonly package_count: number;
      readonly proof_reference: string;
      readonly vendor_confirmed: boolean;
    },
  ): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['delivery_partner']);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: 'PICKUP_CONFIRMED',
      });
      if (prior) return prior;
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      this.#assertPartner(assignment, who.id);
      if (assignment.assignment_state !== 'AT_VENDOR') {
        throw new AssignmentConflictError('Pickup requires arrival at the vendor');
      }
      if (!input.vendor_confirmed || packages(input.package_count) !== assignment.package_count) {
        throw new AssignmentConflictError('Verified vendor and package count are required');
      }
      // `vendor_confirmed` is a partner-supplied claim. Where the assignment is
      // linked to a vendor order, the vendor's own handover is the authority:
      // the order must already have completed pickup on the vendor side.
      if (assignment.vendor_order_id) {
        const released = await client.query<{ lifecycle_state: string }>(
          'SELECT lifecycle_state FROM marketplace.vendor_orders WHERE vendor_order_id=$1',
          [assignment.vendor_order_id],
        );
        const lifecycle = released.rows[0]?.lifecycle_state;
        if (lifecycle !== 'PICKED_UP') {
          throw new AssignmentConflictError('The vendor has not completed handover for this order');
        }
      }
      const proofRef = proof(input.proof_reference);
      const contextIds = ids(input.context);
      for (const [sequence, custody] of [
        [1, 'PICKUP_VERIFIED'],
        [2, 'IN_CUSTODY'],
      ] as const) {
        await client.query(
          `INSERT INTO marketplace.custody_events
            (custody_event_id, delivery_assignment_id, sequence, custody_state,
             partner_user_id, package_count, proof_reference, reason_code,
             request_id, correlation_id, occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            createUuidV7({ now_ms: now.getTime() + sequence }),
            assignment.delivery_assignment_id,
            sequence,
            custody,
            who.id,
            assignment.package_count,
            proofRef,
            reason(input.reason_code),
            contextIds.requestId,
            contextIds.correlationId,
            now,
          ],
        );
      }
      // The vendor wait ends at the handover (9.5): closed by the server with
      // what it is owed on record, for the settlement to carry.
      await closeWaitTimer(client, {
        context: input.context,
        delivery_assignment_id: input.delivery_assignment_id,
        partner_user_id: who.id,
        outcome: 'RESOLVED',
        command_reference: null,
        reason_code: 'HANDOVER_COMPLETED',
        now,
      });
      return updateAssignment(client, {
        assignment,
        command_reference: input.command_reference,
        context: input.context,
        event_type: 'PICKUP_CONFIRMED',
        next_custody_state: 'IN_CUSTODY',
        next_state: 'PICKED_UP',
        now,
        package_count: assignment.package_count,
        proof_reference: proofRef,
        reason_code: input.reason_code,
        who,
      });
    });
  }

  /**
   * Issues the customer's delivery code (CUS-56).
   *
   * The customer asks for it, on their own order, and it is returned once in
   * plaintext to them alone: that is what makes it proof that the partner
   * reached the right person. The hash is what the assignment stores, so the
   * code exists nowhere else and never enters a log (SEC-09).
   */
  async issueDeliveryOtp(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly now?: Date;
  }): Promise<{ readonly plaintext_otp: string; readonly expires_at: Date }> {
    const customer = input.context.actor;
    if (customer?.actor_kind !== 'customer') {
      throw new AssignmentAuthorizationError('A customer session is required');
    }
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const owned = await client.query<{
        delivery_assignment_id: string;
        assignment_state: string;
      }>(
        `SELECT a.delivery_assignment_id, a.assignment_state
           FROM marketplace.delivery_assignments a
           JOIN marketplace.vendor_orders o ON o.vendor_order_id = a.vendor_order_id
           JOIN marketplace.checkout_groups g ON g.checkout_group_id = o.checkout_group_id
          WHERE a.vendor_order_id = $1 AND g.customer_user_id = $2
          ORDER BY a.created_at DESC
          LIMIT 1
          FOR UPDATE OF a`,
        [input.vendor_order_id, customer.actor_id],
      );
      const row = owned.rows[0];
      if (!row) throw new AssignmentNotFoundError('No delivery is in progress for that order');
      // Before custody the code would be meaningless, and after delivery it
      // would be a way to re-open a closed handoff.
      if (!['PICKED_UP', 'EN_ROUTE_TO_CUSTOMER', 'ARRIVED'].includes(row.assignment_state)) {
        throw new AssignmentConflictError(
          'A delivery code applies only while the order is on its way',
        );
      }
      const otp = String(randomInt(100000, 1000000));
      const hash = this.#codeDigest(otp);
      const expiresAt = new Date(now.getTime() + DELIVERY_OTP_LIFETIME_SECONDS * 1000);
      await client.query(
        `UPDATE marketplace.delivery_assignments
            SET delivery_otp_hash=$2, delivery_otp_expires_at=$3, delivery_otp_attempts=0,
                updated_at=$4
          WHERE delivery_assignment_id=$1`,
        [row.delivery_assignment_id, hash, expiresAt, now],
      );
      return { plaintext_otp: otp, expires_at: expiresAt };
    });
  }

  /**
   * Completes a delivery against the customer's code (DLP-30).
   *
   * The proof used to be a `proof_reference` string the partner's own client
   * invented from the clock, so completion involved the customer in no way at
   * all and an order could be marked delivered from anywhere. The code is the
   * default proof; DLP-31 gates every alternative behind approvals that have
   * not been granted, so there is deliberately no bypass here.
   */
  /**
   * Completion against the customer's code (DLP-30) -- entered live, or held
   * on the device without signal and replayed when it returned (9.7).
   *
   * A held completion carries `held_since`, when the code was captured, and
   * the id of the offline proof the device registered on reconnect. The code
   * must still match and the attempts still count; what changes is expiry:
   * a code that lapsed while the device was dark is accepted when it was
   * current at capture and signal returned within the grace window. The
   * proof row is consumed by the completion in the same commit, so a retry
   * -- automatic or by hand -- finds the command replayed and the proof
   * spent, never a second handover.
   */
  async deliver(
    input: TransitionInput & {
      readonly proof_reference: string;
      readonly otp: string;
      readonly held_since?: Date;
      readonly offline_proof_id?: UuidV7;
    },
  ): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['delivery_partner']);
    const now = input.now ?? new Date();
    if (!/^[0-9]{6}$/.test(input.otp)) {
      throw new AssignmentInputError('The delivery code must be exactly six digits');
    }
    if (input.held_since !== undefined && Number.isNaN(input.held_since.getTime())) {
      throw new AssignmentInputError('held_since must be an instant');
    }
    if (input.held_since !== undefined && input.held_since.getTime() > now.getTime()) {
      throw new AssignmentInputError('A proof cannot have been captured in the future');
    }
    const grace = input.held_since === undefined ? 0 : await this.offlineProofGraceSeconds(now);
    const heldOffline = input.held_since !== undefined;

    // Validation commits on its own so a wrong attempt is durably counted even
    // though the caller-facing error unwinds their transaction. Without this
    // the attempt limit could be defeated simply by trying again.
    const validation = await transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: 'DELIVERED',
      });
      if (prior) return { replayed: true as const };
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      this.#assertPartner(assignment, who.id);
      if (!assignment.delivery_otp_hash || !assignment.delivery_otp_expires_at) {
        throw new AssignmentConflictError('Ask the customer to show their delivery code');
      }
      if (assignment.delivery_otp_attempts >= DELIVERY_OTP_MAX_ATTEMPTS) {
        throw new DeliveryOtpExhaustedError(
          'Too many incorrect codes; the customer must refresh it',
        );
      }
      if (assignment.delivery_otp_expires_at <= now) {
        // Held offline: current at capture, and signal back within the grace.
        const heldInTime =
          input.held_since !== undefined &&
          input.held_since.getTime() < assignment.delivery_otp_expires_at.getTime() &&
          now.getTime() - input.held_since.getTime() <= grace * 1_000;
        if (!heldInTime) {
          throw new DeliveryOtpExpiredError(
            'That code has expired; ask the customer to refresh it',
          );
        }
      }
      const attempted = this.#codeDigest(input.otp);
      if (!handoverDigestsMatch(assignment.delivery_otp_hash, attempted)) {
        await client.query(
          `UPDATE marketplace.delivery_assignments
              SET delivery_otp_attempts = delivery_otp_attempts + 1, updated_at = $2
            WHERE delivery_assignment_id = $1`,
          [input.delivery_assignment_id, now],
        );
        return { mismatched: true as const };
      }
      return { mismatched: false as const };
    });
    if ('replayed' in validation) {
      const replayed = await transaction(this.#pool, (client) =>
        replay(client, {
          command_reference: input.command_reference,
          delivery_assignment_id: input.delivery_assignment_id,
          event_type: 'DELIVERED',
        }),
      );
      if (replayed) return replayed;
    }
    if ('mismatched' in validation && validation.mismatched) {
      throw new DeliveryOtpMismatchError('That code does not match');
    }

    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: 'DELIVERED',
      });
      if (prior) return prior;
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      this.#assertPartner(assignment, who.id);
      if (assignment.assignment_state !== 'ARRIVED' || assignment.custody_state !== 'IN_CUSTODY') {
        throw new AssignmentConflictError('Delivery requires arrival with active custody');
      }
      const proofRef = proof(input.proof_reference);
      // The held proof is this partner's, for this attempt, and still pending:
      // consumed here, in the same commit as the handover it stood for.
      if (input.offline_proof_id !== undefined) {
        const held = await client.query<{ sync_state: string }>(
          `UPDATE marketplace.partner_offline_proofs
              SET sync_state='SYNCED', synced_at=$4, consumed_by_command_reference=$5, updated_at=$4
            WHERE partner_offline_proof_id=$1 AND delivery_assignment_id=$2 AND partner_user_id=$3
              AND proof_kind='DELIVERY' AND sync_state='PENDING'
            RETURNING sync_state`,
          [
            input.offline_proof_id,
            assignment.delivery_assignment_id,
            who.id,
            now,
            command(input.command_reference),
          ],
        );
        if (held.rows.length === 0) {
          throw new AssignmentConflictError(
            'That held proof is not this attempt’s, or is no longer pending',
          );
        }
      }
      // The code is spent on success, so it cannot be replayed against a later
      // assignment or a re-opened handoff.
      // The customer read their code to the partner: that is the door. An
      // arrival the fix could not vouch for is confirmed by it (9.6).
      await client.query(
        `UPDATE marketplace.delivery_assignments
            SET delivery_otp_hash = NULL, delivery_otp_expires_at = NULL, updated_at = $2,
                customer_arrival_kind = CASE WHEN customer_arrival_kind = 'UNVERIFIED'
                                             THEN 'CUSTOMER_CONFIRMED' ELSE customer_arrival_kind END,
                customer_arrival_claim_reason = CASE WHEN customer_arrival_kind = 'UNVERIFIED'
                                                     THEN NULL ELSE customer_arrival_claim_reason END
          WHERE delivery_assignment_id = $1`,
        [input.delivery_assignment_id, now],
      );
      await this.#custodyClosure(client, assignment, who.id, 'DELIVERED', proofRef, input, now);
      await endMembership(client, assignment, now, 'DELIVERY_COMPLETED');
      // The order the customer placed ends here, in this transaction. Without
      // it the assignment reached DELIVERED while the order stayed at
      // PICKED_UP, no event was emitted, and nothing downstream — capture, the
      // vendor payable, the partner earning — ever fired.
      if (assignment.vendor_order_id) {
        await completeVendorOrder(client, {
          context: input.context,
          now,
          reason_code: 'DELIVERY_COMPLETED',
          state: 'DELIVERED',
          vendor_order_id: parseUuidV7(assignment.vendor_order_id),
        });
      }
      return updateAssignment(client, {
        assignment,
        command_reference: input.command_reference,
        context: input.context,
        event_type: 'DELIVERED',
        next_custody_state: 'DELIVERED',
        next_state: 'DELIVERED',
        now,
        package_count: assignment.package_count,
        proof_reference: proofRef,
        // The history says a completion was held offline; the server decides
        // that, not the client's reason.
        reason_code: heldOffline ? 'DELIVERY_PROOF_HELD_OFFLINE' : input.reason_code,
        who,
      });
    });
  }

  /**
   * Operations' instruction with its custody effect (9.8). A partner reports;
   * operations direct; and the direction is not a word in a queue but the
   * transition it names, in one commit:
   *
   * - RETURN_TO_VENDOR: goods in hand -> the delivery is failed if it was not
   *   already, the return required, and authorised to the destination given
   *   (the store's own reference by default). Already returning: a no-op.
   * - REASSIGN: nothing in hand -> the attempt is taken off its partner
   *   (`reassign`, with the compensation decided). Goods in hand: refused --
   *   direct a return.
   * - CANCEL: nothing in hand -> the attempt ends cancelled. Goods in hand:
   *   refused -- direct a return.
   *
   * Until audit run 63 the operator's "return it to the store", "reassign"
   * and "cancel" were resolution words on the exception and moved nothing.
   */
  async direct(input: {
    readonly command_reference: string;
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
    readonly direction: 'RETURN_TO_VENDOR' | 'REASSIGN' | 'CANCEL';
    readonly reason_code: string;
    readonly destination_reference?: string;
    /** An alternate safe point in words (9.9); given while returning, it redirects the return. */
    readonly destination_note?: string;
    readonly compensation_minor?: number;
    readonly now?: Date;
  }): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['admin']);
    const now = input.now ?? new Date();
    command(input.command_reference);
    const note = destinationNote(input.destination_note);
    const current = await this.get({
      context: input.context,
      delivery_assignment_id: input.delivery_assignment_id,
    });
    const inHand = (CUSTODY_STATES as readonly string[]).includes(current.assignment_state);
    if (input.direction === 'REASSIGN') {
      if (inHand) {
        throw new AssignmentConflictError(
          'The goods are with the partner: direct a return, not a reassignment',
        );
      }
      return this.reassign({
        command_reference: input.command_reference,
        compensation_minor: input.compensation_minor ?? 0,
        context: input.context,
        delivery_assignment_id: input.delivery_assignment_id,
        expected_version: current.version,
        now,
        reason_code: input.reason_code,
      });
    }
    if (input.direction === 'CANCEL') {
      if (inHand) {
        throw new AssignmentConflictError(
          'The goods are with the partner: direct a return, not a cancellation',
        );
      }
      if (current.assignment_state === 'CANCELLED') return current;
      if (current.assignment_state === 'UNASSIGNED') {
        throw new AssignmentConflictError(
          'Nobody holds this attempt: it is in the pool, and the order is cancelled with the order',
        );
      }
      return this.endBeforePickup({
        command_reference: input.command_reference,
        context: input.context,
        delivery_assignment_id: input.delivery_assignment_id,
        expected_version: current.version,
        now,
        reason_code: input.reason_code,
        resulting_state: 'CANCELLED',
      });
    }
    // RETURN_TO_VENDOR: fail, require and authorise, as far as it has not gone.
    return transaction(this.#pool, async (client) => {
      const lock = async () =>
        requiredRow(
          (
            await client.query<AssignmentRow>(
              'SELECT * FROM marketplace.delivery_assignments WHERE delivery_assignment_id=$1 FOR UPDATE',
              [input.delivery_assignment_id],
            )
          ).rows,
          'Delivery assignment was not found',
        );
      let assignment = await lock();
      if (assignment.assignment_state === 'RETURNED') return assignmentRecord(assignment);
      if (['RETURN_AUTHORIZED', 'RETURNING'].includes(assignment.assignment_state)) {
        // Already authorised: a new destination redirects the return (the
        // store closed, or refused it); nothing new is a no-op.
        if (input.destination_reference === undefined && note === null) {
          return assignmentRecord(assignment);
        }
        const redirected = await client.query(
          `UPDATE marketplace.return_tasks
              SET destination_reference=COALESCE($2, destination_reference), destination_note=$3,
                  authorized_by_user_id=$4, version=version+1, updated_at=$5
            WHERE delivery_assignment_id=$1 AND return_state IN ('AUTHORIZED','RETURNING')
            RETURNING return_task_id`,
          [
            assignment.delivery_assignment_id,
            input.destination_reference === undefined
              ? null
              : returnReference(input.destination_reference),
            note,
            who.id,
            now,
          ],
        );
        requiredRow(redirected.rows, 'Return task was not found');
        return updateAssignment(client, {
          assignment,
          command_reference: input.command_reference,
          context: input.context,
          event_type: 'RETURN_AUTHORIZED',
          next_state: assignment.assignment_state,
          now,
          reason_code: input.reason_code,
          who,
        });
      }
      if (
        ![
          'PICKED_UP',
          'EN_ROUTE_TO_CUSTOMER',
          'ARRIVED',
          'DELIVERY_FAILED',
          'RETURN_REQUIRED',
        ].includes(assignment.assignment_state)
      ) {
        throw new AssignmentConflictError('A return is for goods in the partner’s hands');
      }
      if (['PICKED_UP', 'EN_ROUTE_TO_CUSTOMER', 'ARRIVED'].includes(assignment.assignment_state)) {
        await updateAssignment(client, {
          assignment,
          command_reference: `${input.command_reference}-FAIL`,
          context: input.context,
          event_type: 'DELIVERY_FAILED',
          next_state: 'DELIVERY_FAILED',
          now,
          reason_code: input.reason_code,
          who,
        });
        assignment = await lock();
      }
      if (assignment.assignment_state === 'DELIVERY_FAILED') {
        await client.query(
          `INSERT INTO marketplace.return_tasks
            (return_task_id, delivery_assignment_id, return_state, return_reason_code,
             expected_package_count, created_at, updated_at)
           VALUES ($1,$2,'REQUIRED',$3,$4,$5,$5)`,
          [
            createUuidV7({ now_ms: now.getTime() + 1 }),
            assignment.delivery_assignment_id,
            reason(input.reason_code),
            assignment.package_count,
            now,
          ],
        );
        await updateAssignment(client, {
          assignment,
          command_reference: `${input.command_reference}-REQ`,
          context: input.context,
          event_type: 'RETURN_REQUIRED',
          next_state: 'RETURN_REQUIRED',
          now,
          reason_code: input.reason_code,
          who,
        });
        assignment = await lock();
      }
      const destination =
        input.destination_reference ??
        `SYNTH-RETURN-${assignment.vendor_location_id.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
      await client.query(
        `UPDATE marketplace.return_tasks
            SET return_state='AUTHORIZED', destination_reference=$2, destination_note=$5,
                authorized_by_user_id=$3, version=version+1, updated_at=$4
          WHERE delivery_assignment_id=$1 AND return_state='REQUIRED'`,
        [assignment.delivery_assignment_id, returnReference(destination), who.id, now, note],
      );
      return updateAssignment(client, {
        assignment,
        command_reference: `${input.command_reference}-AUTH`,
        context: input.context,
        event_type: 'RETURN_AUTHORIZED',
        next_state: 'RETURN_AUTHORIZED',
        now,
        reason_code: input.reason_code,
        who,
      });
    });
  }

  async failDelivery(input: TransitionInput): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['admin', 'delivery_partner']);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: 'DELIVERY_FAILED',
      });
      if (prior) return prior;
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      if (who.kind === 'delivery_partner') this.#assertPartner(assignment, who.id);
      if (!['PICKED_UP', 'EN_ROUTE_TO_CUSTOMER', 'ARRIVED'].includes(assignment.assignment_state)) {
        throw new AssignmentConflictError('Delivery failure requires active custody');
      }
      return updateAssignment(client, {
        assignment,
        command_reference: input.command_reference,
        context: input.context,
        event_type: 'DELIVERY_FAILED',
        next_state: 'DELIVERY_FAILED',
        now,
        reason_code: input.reason_code,
        who,
      });
    });
  }

  async requireReturn(input: TransitionInput): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['admin', 'delivery_partner']);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: 'RETURN_REQUIRED',
      });
      if (prior) return prior;
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      if (who.kind === 'delivery_partner') this.#assertPartner(assignment, who.id);
      if (assignment.assignment_state !== 'DELIVERY_FAILED') {
        throw new AssignmentConflictError('Return requires a recorded delivery failure');
      }
      await client.query(
        `INSERT INTO marketplace.return_tasks
          (return_task_id, delivery_assignment_id, return_state, return_reason_code,
           expected_package_count, created_at, updated_at)
         VALUES ($1,$2,'REQUIRED',$3,$4,$5,$5)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          assignment.delivery_assignment_id,
          reason(input.reason_code),
          assignment.package_count,
          now,
        ],
      );
      return updateAssignment(client, {
        assignment,
        command_reference: input.command_reference,
        context: input.context,
        event_type: 'RETURN_REQUIRED',
        next_state: 'RETURN_REQUIRED',
        now,
        reason_code: input.reason_code,
        who,
      });
    });
  }

  async authorizeReturn(
    input: TransitionInput & {
      readonly destination_reference: string;
      /** An alternate safe point, in words the partner can find (9.9). */
      readonly destination_note?: string;
    },
  ): Promise<DeliveryAssignmentRecord> {
    const note = destinationNote(input.destination_note);
    const who = actor(input.context, ['admin']);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: 'RETURN_AUTHORIZED',
      });
      if (prior) return prior;
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      if (assignment.assignment_state !== 'RETURN_REQUIRED') {
        throw new AssignmentConflictError('Only a required return can be authorized');
      }
      const result = await client.query(
        `UPDATE marketplace.return_tasks
            SET return_state='AUTHORIZED', destination_reference=$2, destination_note=$5,
                authorized_by_user_id=$3, version=version+1, updated_at=$4
          WHERE delivery_assignment_id=$1 AND return_state='REQUIRED' RETURNING return_task_id`,
        [
          assignment.delivery_assignment_id,
          returnReference(input.destination_reference),
          who.id,
          now,
          note,
        ],
      );
      requiredRow(result.rows, 'Return task was not found');
      return updateAssignment(client, {
        assignment,
        command_reference: input.command_reference,
        context: input.context,
        event_type: 'RETURN_AUTHORIZED',
        next_state: 'RETURN_AUTHORIZED',
        now,
        reason_code: input.reason_code,
        who,
      });
    });
  }

  async beginReturn(input: TransitionInput): Promise<DeliveryAssignmentRecord> {
    return this.#returnTransition(input, 'RETURN_AUTHORIZED', 'RETURNING', 'RETURNING');
  }

  /**
   * The goods are back (9.9): who received them, how many came back, in what
   * condition, and the proof. The count is recorded as handed over -- a
   * shortfall against what was carried is a fact on the return, not a
   * refusal at the counter -- and custody closes on it; the money is
   * operations' to divide from the case the return opens.
   */
  async completeReturn(
    input: TransitionInput & {
      readonly proof_reference: string;
      readonly received_by: string;
      readonly package_count: number;
      readonly condition_note?: string;
    },
  ): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['delivery_partner']);
    const now = input.now ?? new Date();
    const receivedBy = input.received_by.trim();
    if (receivedBy.length < 2 || receivedBy.length > 120) {
      throw new AssignmentInputError('Say who received the return, in 2 to 120 characters');
    }
    if (
      !Number.isSafeInteger(input.package_count) ||
      input.package_count < 0 ||
      input.package_count > 100
    ) {
      throw new AssignmentInputError('The returned package count must be between 0 and 100');
    }
    if (
      input.condition_note !== undefined &&
      (input.condition_note.length < 1 || input.condition_note.length > 240)
    ) {
      throw new AssignmentInputError('A condition note is between 1 and 240 characters');
    }
    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: 'RETURNED',
      });
      if (prior) return prior;
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      this.#assertPartner(assignment, who.id);
      if (
        assignment.assignment_state !== 'RETURNING' ||
        assignment.custody_state !== 'IN_CUSTODY'
      ) {
        throw new AssignmentConflictError('Return completion requires active return custody');
      }
      const proofRef = proof(input.proof_reference);
      await this.#custodyClosure(
        client,
        assignment,
        who.id,
        'RETURNED',
        proofRef,
        input,
        now,
        input.package_count,
      );
      await client.query(
        `UPDATE marketplace.return_tasks
            SET return_state='RETURNED', proof_reference=$2, received_by=$4,
                returned_package_count=$5, condition_note=$6, returned_at=$3,
                version=version+1, updated_at=$3
          WHERE delivery_assignment_id=$1 AND return_state='RETURNING'`,
        [
          assignment.delivery_assignment_id,
          proofRef,
          now,
          receivedBy,
          input.package_count,
          input.condition_note ?? null,
        ],
      );
      await endMembership(client, assignment, now, 'RETURN_COMPLETED');
      if (assignment.vendor_order_id) {
        await completeVendorOrder(client, {
          context: input.context,
          now,
          reason_code: 'RETURN_COMPLETED',
          state: 'RETURNED',
          vendor_order_id: parseUuidV7(assignment.vendor_order_id),
        });
      }
      return updateAssignment(client, {
        assignment,
        command_reference: input.command_reference,
        context: input.context,
        event_type: 'RETURNED',
        next_custody_state: 'RETURNED',
        next_state: 'RETURNED',
        now,
        package_count: input.package_count,
        proof_reference: proofRef,
        // A shortfall is said in the history, whatever the client's reason.
        reason_code:
          input.package_count < assignment.package_count
            ? 'RETURN_SHORT_OF_PACKAGES'
            : input.reason_code,
        who,
      });
    });
  }

  async endBeforePickup(
    input: TransitionInput & {
      readonly resulting_state: 'CANCELLED' | 'DECLINED' | 'FAILED_PICKUP' | 'REASSIGNED';
    },
  ): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['admin', 'delivery_partner', 'system']);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: input.resulting_state,
      });
      if (prior) return prior;
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      if (who.kind === 'delivery_partner') this.#assertPartner(assignment, who.id);
      const allowed =
        input.resulting_state === 'DECLINED'
          ? assignment.assignment_state === 'OFFERED'
          : ['OFFERED', 'ASSIGNED', 'AT_VENDOR'].includes(assignment.assignment_state);
      if (!allowed || assignment.custody_state !== 'NONE') {
        throw new AssignmentConflictError('Attempt cannot end through the pre-pickup path');
      }
      await endMembership(client, assignment, now, input.reason_code);
      return updateAssignment(client, {
        assignment,
        command_reference: input.command_reference,
        context: input.context,
        event_type: input.resulting_state,
        next_state: input.resulting_state,
        now,
        reason_code: input.reason_code,
        who,
      });
    });
  }

  /**
   * Rates the delivery, separately from the shop.
   *
   * Keyed to the attempt that completed, so it measures the trip that actually
   * happened. Only the customer whose order it was may rate it, and only once —
   * the primary key enforces the second, this query the first.
   */
  async submitDeliveryRating(input: {
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
    readonly stars: number;
    readonly review_note?: string;
    readonly now?: Date;
  }): Promise<void> {
    const who = actor(input.context, ['customer']);
    if (!Number.isSafeInteger(input.stars) || input.stars < 1 || input.stars > 5) {
      throw new AssignmentInputError('A delivery rating must be between one and five stars');
    }
    if (
      input.review_note !== undefined &&
      (input.review_note.length < 1 || input.review_note.length > 500)
    ) {
      throw new AssignmentInputError('A review note must be between 1 and 500 characters');
    }
    const now = input.now ?? new Date();
    const found = await this.#pool.query<{ partner_user_id: string | null }>(
      `SELECT assignment.partner_user_id
         FROM marketplace.delivery_assignments assignment
         JOIN marketplace.vendor_orders orders
           ON orders.vendor_order_id = assignment.vendor_order_id
         JOIN marketplace.checkout_groups grouping
           ON grouping.checkout_group_id = orders.checkout_group_id
        WHERE assignment.delivery_assignment_id = $1
          AND assignment.assignment_state = 'DELIVERED'
          AND grouping.customer_user_id = $2`,
      [input.delivery_assignment_id, who.id],
    );
    const assignment = found.rows[0];
    if (!assignment?.partner_user_id) {
      throw new AssignmentNotFoundError('No completed delivery of yours matches that reference');
    }
    const inserted = await this.#pool.query(
      `INSERT INTO marketplace.delivery_assignment_ratings
        (delivery_assignment_id,customer_user_id,partner_user_id,stars,review_note,
         request_id,correlation_id,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (delivery_assignment_id) DO NOTHING`,
      [
        input.delivery_assignment_id,
        who.id,
        assignment.partner_user_id,
        input.stars,
        input.review_note ?? null,
        parseRequestId(input.context.request_id),
        parseUuidV7(input.context.correlation_id),
        now,
      ],
    );
    if (inserted.rowCount === 0) {
      throw new AssignmentConflictError('This delivery has already been rated');
    }
  }

  /**
   * A partner's delivery ratings, as an average over a window.
   *
   * Never a list. A single rating traceable to one delivery is a rating
   * traceable to one customer at one door, and a partner should not be able to
   * work out who gave it.
   */
  async partnerRatingSummary(input: {
    readonly partner_user_id: UuidV7;
    readonly since?: Date;
  }): Promise<{ readonly rating_average: number | null; readonly rating_count: number }> {
    const since = input.since ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000);
    const result = await this.#pool.query<{ average: string | null; count: string }>(
      `SELECT avg(stars)::numeric(3,2)::text AS average, count(*)::text AS count
         FROM marketplace.delivery_assignment_ratings
        WHERE partner_user_id = $1 AND created_at >= $2`,
      [parseUuidV7(input.partner_user_id), since],
    );
    const row = result.rows[0];
    const count = Number(row?.count ?? '0');
    return Object.freeze({
      rating_average: count > 0 && row?.average ? Number(row.average) : null,
      rating_count: count,
    });
  }

  async expireOffers(input: {
    readonly command_prefix: string;
    readonly context: RequestContext;
    readonly limit?: number;
    readonly now?: Date;
  }): Promise<number> {
    const who = actor(input.context, ['system']);
    const now = input.now ?? new Date();
    const limit = input.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new AssignmentInputError('Expiry limit must be from 1 to 500');
    }
    return transaction(this.#pool, async (client) => {
      const due = await client.query<AssignmentRow>(
        `SELECT * FROM marketplace.delivery_assignments
          WHERE assignment_state='OFFERED' AND offer_expires_at <= $1
          ORDER BY offer_expires_at, delivery_assignment_id
          FOR UPDATE SKIP LOCKED LIMIT $2`,
        [now, limit],
      );
      for (const assignment of due.rows) {
        await updateAssignment(client, {
          assignment,
          command_reference: command(
            `${input.command_prefix}-${assignment.delivery_assignment_id}`.toUpperCase(),
          ),
          context: input.context,
          event_type: 'OFFER_EXPIRED',
          next_state: 'OFFER_EXPIRED',
          now,
          reason_code: 'OFFER_EXPIRED',
          who,
        });
      }
      return due.rowCount ?? 0;
    });
  }

  async get(input: {
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
  }): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['admin', 'delivery_partner', 'system', 'vendor_staff']);
    // The safety hold travels with every read of the job, not just the list.
    // The Android shell reads a single assignment, so leaving the flag off this
    // query would have let one surface keep offering the next step while the
    // other held it — the same job, two answers.
    const result = await this.#pool.query<AssignmentRow & { open_emergency: boolean }>(
      `SELECT assignment.*, ${OPEN_EMERGENCY_SQL} AS open_emergency
         FROM marketplace.delivery_assignments assignment
        WHERE assignment.delivery_assignment_id=$1`,
      [input.delivery_assignment_id, [...SAFETY_EXCEPTION_KINDS]],
    );
    const assignment = requiredRow(result.rows, 'Delivery assignment was not found');
    if (who.kind === 'delivery_partner' && assignment.partner_user_id !== who.id) {
      throw new AssignmentNotFoundError('Delivery assignment was not found');
    }
    return Object.freeze({
      ...assignmentRecord(assignment),
      open_emergency: assignment.open_emergency,
    });
  }

  async #partnerTransition(
    input: TransitionInput,
    expectedState: AssignmentState,
    nextState: AssignmentState,
    eventType: string,
  ) {
    const who = actor(input.context, ['delivery_partner']);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: eventType,
      });
      if (prior) return prior;
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      this.#assertPartner(assignment, who.id);
      if (assignment.assignment_state !== expectedState) {
        throw new AssignmentConflictError(`Assignment must be ${expectedState}`);
      }
      return updateAssignment(client, {
        assignment,
        command_reference: input.command_reference,
        context: input.context,
        event_type: eventType,
        next_state: nextState,
        now,
        reason_code: input.reason_code,
        who,
      });
    });
  }

  async #returnTransition(
    input: TransitionInput,
    expectedState: AssignmentState,
    nextState: AssignmentState,
    eventType: string,
  ) {
    const who = actor(input.context, ['delivery_partner']);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const prior = await replay(client, {
        command_reference: input.command_reference,
        delivery_assignment_id: input.delivery_assignment_id,
        event_type: eventType,
      });
      if (prior) return prior;
      const assignment = await lockAssignment(
        client,
        input.delivery_assignment_id,
        input.expected_version,
      );
      this.#assertPartner(assignment, who.id);
      if (assignment.assignment_state !== expectedState) {
        throw new AssignmentConflictError(`Assignment must be ${expectedState}`);
      }
      await client.query(
        `UPDATE marketplace.return_tasks
            SET return_state=$2, version=version+1, updated_at=$3
          WHERE delivery_assignment_id=$1`,
        [assignment.delivery_assignment_id, nextState, now],
      );
      return updateAssignment(client, {
        assignment,
        command_reference: input.command_reference,
        context: input.context,
        event_type: eventType,
        next_state: nextState,
        now,
        reason_code: input.reason_code,
        who,
      });
    });
  }

  async #custodyClosure(
    client: PoolClient,
    assignment: AssignmentRow,
    partnerId: UuidV7,
    state: 'DELIVERED' | 'RETURNED',
    proofReference: string,
    input: TransitionInput,
    now: Date,
    packageCount: number = assignment.package_count,
  ) {
    const contextIds = ids(input.context);
    await client.query(
      `INSERT INTO marketplace.custody_events
        (custody_event_id, delivery_assignment_id, sequence, custody_state,
         partner_user_id, package_count, proof_reference, reason_code,
         request_id, correlation_id, occurred_at)
       VALUES ($1,$2,3,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        createUuidV7({ now_ms: now.getTime() }),
        assignment.delivery_assignment_id,
        state,
        partnerId,
        packageCount,
        proofReference,
        reason(input.reason_code),
        contextIds.requestId,
        contextIds.correlationId,
        now,
      ],
    );
  }

  #assertPartner(assignment: AssignmentRow, partnerId: UuidV7) {
    if (assignment.partner_user_id !== partnerId) {
      throw new AssignmentNotFoundError('Delivery assignment was not found');
    }
  }
}

interface TransitionInput {
  readonly command_reference: string;
  readonly context: RequestContext;
  readonly delivery_assignment_id: UuidV7;
  readonly expected_version: number;
  readonly now?: Date;
  readonly reason_code: string;
}
