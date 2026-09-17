import { createDatabasePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type ActorKind,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { createHash, randomInt } from 'node:crypto';
import { calculatePartnerOfferEarning } from './money-policy.js';
import { completeVendorOrder } from './vendor-order-completion.js';
import { Pool, type PoolClient } from 'pg';
import { transaction } from './transaction.js';

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
  readonly expected_earning_minor?: number | null;
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

function assignmentRecord(row: AssignmentRow): DeliveryAssignmentRecord {
  return Object.freeze({
    approximate_drop_area: row.approximate_drop_area,
    approximate_pickup_area: row.approximate_pickup_area,
    assignment_state: row.assignment_state,
    custody_state: row.custody_state,
    delivery_assignment_id: parseUuidV7(row.delivery_assignment_id),
    handling_flags: Object.freeze([...row.handling_flags]),
    offer_expires_at: row.offer_expires_at?.toISOString() ?? null,
    package_count: row.package_count,
    partner_user_id: row.partner_user_id ? parseUuidV7(row.partner_user_id) : null,
    source_order_reference: row.source_order_reference,
    vendor_location_id: parseUuidV7(row.vendor_location_id),
    vendor_order_id: row.vendor_order_id ? parseUuidV7(row.vendor_order_id) : null,
    version: row.version,
  });
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
    readonly event_type: string;
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
  if (
    row.event_type !== input.event_type ||
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
  constructor(input: { readonly connection_string: string }) {
    this.#pool = createDatabasePool({
      application_name: 'neighbourhood-store-assignment-custody',
      connectionString: input.connection_string,
      connectionTimeoutMillis: 5_000,
      max: 12,
    });
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
    }>(
      // The route is measured from the vendor to the customer's address, the
      // same pair the delivery fee was quoted against, so the distance a
      // partner is shown is the distance the order was actually priced on.
      `SELECT a.delivery_assignment_id, a.source_order_reference, a.vendor_location_id,
              a.partner_user_id, a.assignment_state, a.custody_state, a.package_count,
              a.handling_flags, a.approximate_pickup_area, a.approximate_drop_area,
              a.offer_expires_at, a.vendor_order_id, a.version,
              ST_Distance(location.coordinates, address.coordinates)::bigint::text AS route_metres
         FROM marketplace.delivery_assignments a
         JOIN marketplace.vendor_locations location
           ON location.vendor_location_id = a.vendor_location_id
         LEFT JOIN marketplace.vendor_orders o ON o.vendor_order_id = a.vendor_order_id
         LEFT JOIN marketplace.checkout_groups g ON g.checkout_group_id = o.checkout_group_id
         LEFT JOIN marketplace.checkout_quotes quote
                ON quote.checkout_quote_id = g.checkout_quote_id
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
        expected_earning_minor: expectedEarning,
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
      }
    >(
      `SELECT assignment.*,
              ${OPEN_EMERGENCY_SQL.replaceAll('$2', '$3')} AS open_emergency,
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
      [parseUuidV7(input.partner_user_id), [...CUSTODY_STATES], [...SAFETY_EXCEPTION_KINDS]],
    );
    return result.rows.map((row) => {
      const record = Object.freeze({
        ...assignmentRecord(row),
        open_emergency: row.open_emergency,
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
      `SELECT event_type, actor_id, partner_user_id FROM marketplace.assignment_events
        WHERE delivery_assignment_id=$1
          AND ((event_type='DECLINED' AND actor_kind='delivery_partner')
               OR (event_type='OFFER_EXPIRED' AND partner_user_id IS NOT NULL))`,
      [input.delivery_assignment_id],
    );
    const declined = new Set<UuidV7>();
    const passes = new Map<UuidV7, number>();
    for (const row of rows.rows) {
      if (row.event_type === 'DECLINED') {
        declined.add(parseUuidV7(row.actor_id));
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

  async arriveAtVendor(input: TransitionInput): Promise<DeliveryAssignmentRecord> {
    return this.#partnerTransition(input, 'ASSIGNED', 'AT_VENDOR', 'AT_VENDOR');
  }
  async beginRoute(input: TransitionInput): Promise<DeliveryAssignmentRecord> {
    return this.#partnerTransition(input, 'PICKED_UP', 'EN_ROUTE_TO_CUSTOMER', 'EN_ROUTE');
  }
  async arriveAtCustomer(input: TransitionInput): Promise<DeliveryAssignmentRecord> {
    return this.#partnerTransition(input, 'EN_ROUTE_TO_CUSTOMER', 'ARRIVED', 'ARRIVED');
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
      const hash = createHash('sha256').update(otp).digest('hex');
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
  async deliver(
    input: TransitionInput & { readonly proof_reference: string; readonly otp: string },
  ): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['delivery_partner']);
    const now = input.now ?? new Date();
    if (!/^[0-9]{6}$/.test(input.otp)) {
      throw new AssignmentInputError('The delivery code must be exactly six digits');
    }

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
        throw new DeliveryOtpExpiredError('That code has expired; ask the customer to refresh it');
      }
      const attempted = createHash('sha256').update(input.otp).digest('hex');
      if (attempted !== assignment.delivery_otp_hash) {
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
      // The code is spent on success, so it cannot be replayed against a later
      // assignment or a re-opened handoff.
      await client.query(
        `UPDATE marketplace.delivery_assignments
            SET delivery_otp_hash = NULL, delivery_otp_expires_at = NULL, updated_at = $2
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
    },
  ): Promise<DeliveryAssignmentRecord> {
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
            SET return_state='AUTHORIZED', destination_reference=$2,
                authorized_by_user_id=$3, version=version+1, updated_at=$4
          WHERE delivery_assignment_id=$1 AND return_state='REQUIRED' RETURNING return_task_id`,
        [
          assignment.delivery_assignment_id,
          returnReference(input.destination_reference),
          who.id,
          now,
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

  async completeReturn(
    input: TransitionInput & { readonly proof_reference: string },
  ): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['delivery_partner']);
    const now = input.now ?? new Date();
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
      await this.#custodyClosure(client, assignment, who.id, 'RETURNED', proofRef, input, now);
      await client.query(
        `UPDATE marketplace.return_tasks
            SET return_state='RETURNED', proof_reference=$2, version=version+1, updated_at=$3
          WHERE delivery_assignment_id=$1 AND return_state='RETURNING'`,
        [assignment.delivery_assignment_id, proofRef, now],
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
        package_count: assignment.package_count,
        proof_reference: proofRef,
        reason_code: input.reason_code,
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
        assignment.package_count,
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
