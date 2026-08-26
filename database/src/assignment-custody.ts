import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type ActorKind,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';

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
  readonly approximate_pickup_area: string;
  readonly assignment_state: AssignmentState;
  readonly custody_state: CustodyState;
  readonly delivery_assignment_id: UuidV7;
  readonly handling_flags: readonly string[];
  readonly offer_expires_at: string | null;
  readonly package_count: number;
  readonly partner_user_id: UuidV7 | null;
  readonly source_order_reference: string;
  readonly vendor_location_id: UuidV7;
  readonly version: number;
}

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

interface AssignmentRow {
  approximate_drop_area: string;
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
  version: number;
}

const ORDER_REFERENCE = /^SYNTH-ORDER-[A-Z0-9-]{4,64}$/;
const COMMAND_REFERENCE = /^SYNTH-CMD-[A-Z0-9-]{4,64}$/;
const PROOF_REFERENCE = /^SYNTH-PROOF-[A-Z0-9-]{4,64}$/;
const RETURN_REFERENCE = /^SYNTH-RETURN-[A-Z0-9-]{4,64}$/;
const AREA = /^SYNTH [A-Za-z0-9 .,&'()-]{2,95}$/;
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;
const HANDLING = /^[A-Z][A-Z0-9_]{2,31}$/;

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
    throw new AssignmentInputError('Command reference must be explicitly synthetic');
  }
  return value;
}
function proof(value: string): string {
  if (!PROOF_REFERENCE.test(value)) {
    throw new AssignmentInputError('Proof reference must be explicitly synthetic');
  }
  return value;
}
function orderReference(value: string): string {
  if (!ORDER_REFERENCE.test(value)) {
    throw new AssignmentInputError('Order reference must be explicitly synthetic');
  }
  return value;
}
function returnReference(value: string): string {
  if (!RETURN_REFERENCE.test(value)) {
    throw new AssignmentInputError('Return destination must be explicitly synthetic');
  }
  return value;
}
function area(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!AREA.test(normalized)) throw new AssignmentInputError('Area must be explicitly synthetic');
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

async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
       package_count, request_id, correlation_id, causation_id, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
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
    this.#pool = new Pool({
      application_name: 'neighbourhood-store-assignment-custody',
      connectionString: input.connection_string,
      connectionTimeoutMillis: 5_000,
      max: 12,
    });
  }

  async close() {
    await this.#pool.end();
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
    readonly now?: Date;
  }): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['admin']);
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
           correlation_id, created_at, updated_at)
         VALUES ($1,$2,$3,'UNASSIGNED','NONE',$4,$5,$6,$7,$8,$9,$10,$10)
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

  async deliver(
    input: TransitionInput & { readonly proof_reference: string },
  ): Promise<DeliveryAssignmentRecord> {
    const who = actor(input.context, ['delivery_partner']);
    const now = input.now ?? new Date();
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
      await this.#custodyClosure(client, assignment, who.id, 'DELIVERED', proofRef, input, now);
      await endMembership(client, assignment, now, 'DELIVERY_COMPLETED');
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
    const result = await this.#pool.query<AssignmentRow>(
      'SELECT * FROM marketplace.delivery_assignments WHERE delivery_assignment_id=$1',
      [input.delivery_assignment_id],
    );
    const assignment = requiredRow(result.rows, 'Delivery assignment was not found');
    if (who.kind === 'delivery_partner' && assignment.partner_user_id !== who.id) {
      throw new AssignmentNotFoundError('Delivery assignment was not found');
    }
    return assignmentRecord(assignment);
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
