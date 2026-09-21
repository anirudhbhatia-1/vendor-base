import { createDatabasePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { transaction as tx } from './transaction.js';

export class FieldOpsInputError extends Error {}
export class FieldOpsNotFoundError extends Error {}
export class FieldOpsConflictError extends Error {}
export class FieldOpsAuthorizationError extends Error {}

/**
 * Offline-proof recovery states a partner can be in:
 *  - PENDING: proof saved locally, still needs to reach the server
 *  - SYNCED: server-confirmed sync; the local proof may be discarded
 *  - EXPIRED: sync window elapsed without confirmation; support intervention
 */
export type OfflineProofState = 'PENDING' | 'SYNCED' | 'EXPIRED';

export type OfflineProofKind = 'PICKUP' | 'DELIVERY' | 'RETURN';

export type ExceptionKind =
  | 'VENDOR_DELAY'
  | 'MISSING_PACKAGE'
  | 'DAMAGED_PACKAGE'
  | 'UNREACHABLE_CUSTOMER'
  | 'WRONG_ADDRESS'
  | 'UNSAFE_LOCATION'
  | 'ACCIDENT'
  | 'MEDICAL_EMERGENCY'
  | 'THREAT'
  | 'VEHICLE_FAILURE'
  | 'PROHIBITED_GOODS'
  /** A completion held offline that the server refused on replay (9.7, DLP-34). */
  | 'PROOF_SYNC_FAILED';

/**
 * Each guided exception ends in a named resolution rather than a free-text
 * field, so operations can enumerate what happened without reading prose.
 * OPEN means the partner needs guidance next.
 */
export type ExceptionResolution =
  'OPEN' | 'RETRY' | 'CONTINUE' | 'RETURN_TO_VENDOR' | 'CANCEL' | 'REASSIGN' | 'SUPPORT';

/**
 * Emergencies stay separate from generic support so an incident does not
 * blend into a routine "call support" bucket.
 */
export const EMERGENCY_KINDS: ReadonlySet<ExceptionKind> = new Set([
  'ACCIDENT',
  'MEDICAL_EMERGENCY',
  'THREAT',
]);

export interface OfflineProof {
  readonly partner_offline_proof_id: UuidV7;
  readonly delivery_assignment_id: UuidV7;
  readonly partner_user_id: UuidV7;
  readonly proof_kind: OfflineProofKind;
  readonly encrypted_payload_digest: string;
  readonly encryption_key_reference: string;
  readonly captured_at: Date;
  readonly sync_state: OfflineProofState;
  readonly synced_at: Date | null;
  readonly reason_code: string;
}

export interface ExceptionEvent {
  readonly partner_exception_event_id: UuidV7;
  readonly delivery_assignment_id: UuidV7;
  readonly partner_user_id: UuidV7;
  readonly exception_kind: ExceptionKind;
  readonly resolution_state: ExceptionResolution;
  readonly evidence_note: string | null;
  /** Who wrote this row (9.8): the partner reporting, or operations directing. */
  readonly actor_kind: 'delivery_partner' | 'admin' | 'system' | null;
  /** What operations told the partner to do, in words, on a directed row. */
  readonly instruction: string | null;
  readonly reason_code: string;
  readonly occurred_at: Date;
}

const digest = /^[a-f0-9]{64}$/;
// The column's own CHECK is narrower than this used to be, so a key the
// service accepted was rejected by the database — surfacing as a 500 on every
// offline capture rather than a 400 the caller could act on. Kept identical to
// `partner_offline_proof_key_shape`.
const keyReference = /^SYNTH-PARTNER-KEY-[A-Z0-9-]{4,64}$/;
const reasonCode = /^[A-Z][A-Z0-9_]{2,63}$/;

const exceptionKinds: ReadonlySet<ExceptionKind> = new Set([
  'VENDOR_DELAY',
  'MISSING_PACKAGE',
  'DAMAGED_PACKAGE',
  'UNREACHABLE_CUSTOMER',
  'WRONG_ADDRESS',
  'UNSAFE_LOCATION',
  'ACCIDENT',
  'MEDICAL_EMERGENCY',
  'THREAT',
  'VEHICLE_FAILURE',
  'PROHIBITED_GOODS',
  'PROOF_SYNC_FAILED',
]);
/**
 * Resolutions a partner may record themselves.
 *
 * These are accounts of what the partner did — they tried again, they carried
 * on, they escalated. Everything else *directs* the delivery, and the workflow
 * places that with operations: support authorises a return destination and its
 * proof rules (§8.2.2), and cancelling or reassigning has customer, custody and
 * money consequences the partner is not the one to weigh (§11).
 *
 * The UI previously offered all six to the partner, so someone standing at an
 * unsafe address could close their own exception as CANCEL — ending an order
 * with no operations decision anywhere in the record.
 */
export const PARTNER_SELF_RESOLUTIONS: ReadonlySet<ExceptionResolution> = new Set([
  'RETRY',
  'CONTINUE',
  'SUPPORT',
]);

const resolutions: ReadonlySet<ExceptionResolution> = new Set([
  'OPEN',
  'RETRY',
  'CONTINUE',
  'RETURN_TO_VENDOR',
  'CANCEL',
  'REASSIGN',
  'SUPPORT',
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
  if (context.actor?.actor_kind !== 'delivery_partner') throw new FieldOpsAuthorizationError();
  return context.actor.actor_id;
}

function requireSystemOrAdmin(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'system' && context.actor?.actor_kind !== 'admin')
    throw new FieldOpsAuthorizationError();
  return context.actor.actor_id;
}

function projectOfflineProof(row: Record<string, unknown>): OfflineProof {
  return Object.freeze({
    partner_offline_proof_id: parseUuidV7(row['partner_offline_proof_id'] as string),
    delivery_assignment_id: parseUuidV7(row['delivery_assignment_id'] as string),
    partner_user_id: parseUuidV7(row['partner_user_id'] as string),
    proof_kind: row['proof_kind'] as OfflineProofKind,
    encrypted_payload_digest: row['encrypted_payload_digest'] as string,
    encryption_key_reference: row['encryption_key_reference'] as string,
    captured_at: row['captured_at'] as Date,
    sync_state: row['sync_state'] as OfflineProofState,
    synced_at: (row['synced_at'] as Date | null) ?? null,
    reason_code: row['reason_code'] as string,
  });
}

function projectException(row: Record<string, unknown>): ExceptionEvent {
  return Object.freeze({
    partner_exception_event_id: parseUuidV7(row['partner_exception_event_id'] as string),
    delivery_assignment_id: parseUuidV7(row['delivery_assignment_id'] as string),
    partner_user_id: parseUuidV7(row['partner_user_id'] as string),
    exception_kind: row['exception_kind'] as ExceptionKind,
    resolution_state: row['resolution_state'] as ExceptionResolution,
    evidence_note: (row['evidence_note'] as string | null) ?? null,
    actor_kind: (row['actor_kind'] as ExceptionEvent['actor_kind'] | null) ?? null,
    instruction: (row['instruction'] as string | null) ?? null,
    reason_code: row['reason_code'] as string,
    occurred_at: row['occurred_at'] as Date,
  });
}

/**
 * Field-ops surface for a delivery partner while they hold an active
 * assignment. Everything here is scoped by (delivery_assignment_id,
 * partner_user_id) and enforced against the delivery_assignments aggregate
 * owned by AssignmentCustodyService.
 */
export class PartnerFieldOpsService {
  readonly #pool: Pool;

  constructor(input: { readonly connection_string: string }) {
    this.#pool = createDatabasePool({
      connectionString: input.connection_string,
      application_name: 'neighbourhood-store-partner-field-ops',
      max: 8,
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  // -----------------------------------------------------------------------
  // 9.7 -- offline proof recovery
  // -----------------------------------------------------------------------

  /**
   * Records a proof the partner captured while offline. Only the SHA-256 of
   * the encrypted payload and the key reference are persisted here: the
   * plaintext proof stays on the device until the SYNCED transition, and
   * the caller is responsible for uploading it to protected object storage
   * separately. The unique partial index on (partner_user_id) where
   * sync_state='PENDING' means the partner cannot save a second offline
   * proof while one is still pending.
   */
  async saveOfflineProof(input: {
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
    readonly proof_kind: OfflineProofKind;
    readonly encrypted_payload_digest: string;
    readonly encryption_key_reference: string;
    readonly captured_at: Date;
    readonly reason_code: string;
    readonly now?: Date;
  }): Promise<OfflineProof> {
    const partnerId = requirePartner(input.context);
    if (!digest.test(input.encrypted_payload_digest))
      throw new FieldOpsInputError('encrypted_payload_digest must be a SHA-256 hex string');
    if (!keyReference.test(input.encryption_key_reference))
      throw new FieldOpsInputError('encryption_key_reference is invalid');
    if (!reasonCode.test(input.reason_code))
      throw new FieldOpsInputError('reason_code must be shouting-snake-case');
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    return tx(this.#pool, async (client) => {
      const assignment = await client.query<{ partner_user_id: string; assignment_state: string }>(
        `SELECT partner_user_id, assignment_state FROM marketplace.delivery_assignments
          WHERE delivery_assignment_id=$1 FOR UPDATE`,
        [input.delivery_assignment_id],
      );
      const row = assignment.rows[0];
      if (!row || row.partner_user_id !== partnerId) throw new FieldOpsNotFoundError();
      const proofId = createUuidV7({ now_ms: now.getTime() });
      let inserted;
      try {
        inserted = await client.query(
          `INSERT INTO marketplace.partner_offline_proofs
             (partner_offline_proof_id, delivery_assignment_id, partner_user_id, proof_kind,
              encrypted_payload_digest, encryption_key_reference, captured_at, reason_code,
              request_id, correlation_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [
            proofId,
            input.delivery_assignment_id,
            partnerId,
            input.proof_kind,
            input.encrypted_payload_digest,
            input.encryption_key_reference,
            input.captured_at,
            input.reason_code,
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
          throw new FieldOpsConflictError(
            'Partner already has an unsynchronised offline proof outstanding',
          );
        }
        throw error;
      }
      return projectOfflineProof(inserted.rows[0] as Record<string, unknown>);
    });
  }

  /**
   * Marks a pending offline proof as SYNCED. Idempotent: replaying with the
   * same digest against an already-SYNCED proof returns the current row
   * without transitioning it a second time.
   */
  async syncOfflineProof(input: {
    readonly context: RequestContext;
    readonly partner_offline_proof_id: UuidV7;
    readonly encrypted_payload_digest: string;
    readonly now?: Date;
  }): Promise<OfflineProof> {
    const partnerId = requirePartner(input.context);
    if (!digest.test(input.encrypted_payload_digest))
      throw new FieldOpsInputError('encrypted_payload_digest must be a SHA-256 hex string');
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const proof = await client.query<Record<string, unknown>>(
        `SELECT * FROM marketplace.partner_offline_proofs
          WHERE partner_offline_proof_id=$1 FOR UPDATE`,
        [input.partner_offline_proof_id],
      );
      const row = proof.rows[0];
      if (!row || (row['partner_user_id'] as string) !== partnerId)
        throw new FieldOpsNotFoundError();
      if ((row['encrypted_payload_digest'] as string) !== input.encrypted_payload_digest)
        throw new FieldOpsConflictError('Digest does not match the pending proof');
      if (row['sync_state'] === 'EXPIRED')
        throw new FieldOpsConflictError('Proof has expired; support intervention required');
      if (row['sync_state'] === 'SYNCED') return projectOfflineProof(row);
      const updated = await client.query(
        `UPDATE marketplace.partner_offline_proofs
            SET sync_state='SYNCED', synced_at=$2, updated_at=$2
          WHERE partner_offline_proof_id=$1
        RETURNING *`,
        [input.partner_offline_proof_id, now],
      );
      return projectOfflineProof(updated.rows[0] as Record<string, unknown>);
    });
  }

  /**
   * Called by a maintenance worker or admin to expire proofs that never
   * synced. Uses FOR UPDATE SKIP LOCKED so parallel workers do not collide.
   */
  async expireOfflineProofs(input: {
    readonly context: RequestContext;
    readonly older_than: Date;
    readonly now?: Date;
  }): Promise<readonly UuidV7[]> {
    requireSystemOrAdmin(input.context);
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const overdue = await client.query<{ partner_offline_proof_id: string }>(
        `SELECT partner_offline_proof_id FROM marketplace.partner_offline_proofs
          WHERE sync_state='PENDING' AND captured_at <= $1 FOR UPDATE SKIP LOCKED`,
        [input.older_than],
      );
      const expired: UuidV7[] = [];
      for (const row of overdue.rows) {
        await client.query(
          `UPDATE marketplace.partner_offline_proofs
              SET sync_state='EXPIRED', updated_at=$2
            WHERE partner_offline_proof_id=$1`,
          [row.partner_offline_proof_id, now],
        );
        expired.push(parseUuidV7(row.partner_offline_proof_id));
      }
      return Object.freeze(expired);
    });
  }

  async listPending(input: { readonly context: RequestContext }): Promise<readonly OfflineProof[]> {
    const partnerId = requirePartner(input.context);
    const result = await this.#pool.query(
      `SELECT * FROM marketplace.partner_offline_proofs
        WHERE partner_user_id=$1 AND sync_state='PENDING'
        ORDER BY captured_at`,
      [partnerId],
    );
    return Object.freeze(
      result.rows.map((row) => projectOfflineProof(row as Record<string, unknown>)),
    );
  }

  // -----------------------------------------------------------------------
  // 9.8 -- guided exceptions and safety
  // -----------------------------------------------------------------------

  /**
   * Records a guided exception. The initial resolution is OPEN; the partner
   * or support then narrows it to a named end state via `resolveException`.
   * Emergencies (ACCIDENT/MEDICAL_EMERGENCY/THREAT) are recorded with the
   * same shape but flagged separately by EMERGENCY_KINDS for downstream
   * routing.
   */
  async raiseException(input: {
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
    readonly exception_kind: ExceptionKind;
    readonly evidence_note?: string;
    readonly reason_code: string;
    readonly now?: Date;
  }): Promise<ExceptionEvent> {
    const partnerId = requirePartner(input.context);
    if (!exceptionKinds.has(input.exception_kind))
      throw new FieldOpsInputError('exception_kind is not allowed');
    if (
      input.evidence_note !== undefined &&
      (input.evidence_note.length < 1 || input.evidence_note.length > 500)
    ) {
      throw new FieldOpsInputError('evidence_note must be between 1 and 500 characters');
    }
    if (!reasonCode.test(input.reason_code))
      throw new FieldOpsInputError('reason_code must be shouting-snake-case');
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    return tx(this.#pool, async (client) => {
      const assignment = await client.query<{ partner_user_id: string }>(
        `SELECT partner_user_id FROM marketplace.delivery_assignments
          WHERE delivery_assignment_id=$1`,
        [input.delivery_assignment_id],
      );
      if (assignment.rows[0]?.partner_user_id !== partnerId) throw new FieldOpsNotFoundError();
      const eventId = createUuidV7({ now_ms: now.getTime() });
      const inserted = await client.query(
        `INSERT INTO marketplace.partner_exception_events
           (partner_exception_event_id, delivery_assignment_id, partner_user_id,
            exception_kind, resolution_state, evidence_note, reason_code,
            request_id, correlation_id, occurred_at, actor_kind, actor_id)
         VALUES ($1,$2,$3,$4,'OPEN',$5,$6,$7,$8,$9,'delivery_partner',$3)
         RETURNING *`,
        [
          eventId,
          input.delivery_assignment_id,
          partnerId,
          input.exception_kind,
          input.evidence_note ?? null,
          input.reason_code,
          ids.request,
          ids.correlation,
          now,
        ],
      );
      return projectException(inserted.rows[0] as Record<string, unknown>);
    });
  }

  /**
   * Records a follow-up event that narrows the exception's resolution to a
   * named end state. The exception table is append-only, so a resolution is
   * itself an event row; the "latest" resolution is derived at read time.
   */
  async resolveException(input: {
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
    readonly exception_kind: ExceptionKind;
    readonly resolution_state: Exclude<ExceptionResolution, 'OPEN'>;
    readonly reason_code: string;
    readonly evidence_note?: string;
    /** Operations' words to the partner (9.8); a partner's own resolution carries none. */
    readonly instruction?: string;
    readonly now?: Date;
  }): Promise<ExceptionEvent> {
    if (!resolutions.has(input.resolution_state))
      throw new FieldOpsInputError('resolution_state must be a terminal resolution');
    if (
      input.instruction !== undefined &&
      (input.instruction.length < 1 || input.instruction.length > 500)
    ) {
      throw new FieldOpsInputError('instruction must be between 1 and 500 characters');
    }
    if (!reasonCode.test(input.reason_code))
      throw new FieldOpsInputError('reason_code must be shouting-snake-case');
    if (
      input.evidence_note !== undefined &&
      (input.evidence_note.length < 1 || input.evidence_note.length > 500)
    ) {
      throw new FieldOpsInputError('evidence_note must be between 1 and 500 characters');
    }
    const actor = input.context.actor;
    if (!actor) throw new FieldOpsAuthorizationError();
    const actorKind = actor.actor_kind;
    if (actorKind !== 'delivery_partner' && actorKind !== 'admin' && actorKind !== 'system') {
      throw new FieldOpsAuthorizationError();
    }
    // A partner reports; operations direct. Returning, cancelling and
    // reassigning move custody and money, so they are not the reporter's to
    // record even on their own assignment.
    if (actorKind === 'delivery_partner' && !PARTNER_SELF_RESOLUTIONS.has(input.resolution_state)) {
      throw new FieldOpsAuthorizationError(
        'Operations decide a return, a cancellation or a reassignment',
      );
    }
    if (actorKind === 'delivery_partner' && input.instruction !== undefined) {
      throw new FieldOpsAuthorizationError('An instruction is operations’ to give');
    }
    const actorId = actor.actor_id;
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    return tx(this.#pool, async (client) => {
      const assignment = await client.query<{ partner_user_id: string }>(
        `SELECT partner_user_id FROM marketplace.delivery_assignments
          WHERE delivery_assignment_id=$1`,
        [input.delivery_assignment_id],
      );
      const rowPartner = assignment.rows[0]?.partner_user_id;
      if (!rowPartner) throw new FieldOpsNotFoundError();
      if (actorKind === 'delivery_partner' && rowPartner !== actorId)
        throw new FieldOpsNotFoundError();
      // Every open exception of this kind on this assignment resolves.
      // If nothing is open, this is a no-op that raises NotFound so callers
      // do not silently accumulate closures against a missing open event.
      const open = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM marketplace.partner_exception_events
          WHERE delivery_assignment_id=$1 AND exception_kind=$2 AND resolution_state='OPEN'`,
        [input.delivery_assignment_id, input.exception_kind],
      );
      if (open.rows[0]?.count === '0') throw new FieldOpsNotFoundError();
      const eventId = createUuidV7({ now_ms: now.getTime() });
      const inserted = await client.query(
        `INSERT INTO marketplace.partner_exception_events
           (partner_exception_event_id, delivery_assignment_id, partner_user_id,
            exception_kind, resolution_state, evidence_note, reason_code,
            request_id, correlation_id, occurred_at, actor_kind, actor_id, instruction)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          eventId,
          input.delivery_assignment_id,
          rowPartner,
          input.exception_kind,
          input.resolution_state,
          input.evidence_note ?? null,
          input.reason_code,
          ids.request,
          ids.correlation,
          now,
          actorKind,
          actorId,
          input.instruction ?? null,
        ],
      );
      return projectException(inserted.rows[0] as Record<string, unknown>);
    });
  }

  /**
   * Every partner exception still waiting on an instruction (DLP-37 – DLP-42, ADM-05).
   *
   * The partner surface tells someone reporting an unsafe address or a missing
   * package that operations have it and will send guidance. Nothing on the
   * operations side could read it: exceptions were listable only per assignment,
   * behind a capability whose resource rule grants to the partner working that
   * assignment. So the report went nowhere, and the person waiting in the field
   * was told to wait for a reply that could not be composed.
   *
   * Ordered with emergencies first and oldest first within that, which is the
   * ranking §19 asks for: safety before everything, then age.
   */
  async listOpenExceptions(input: {
    readonly context: RequestContext;
    readonly limit?: number;
  }): Promise<
    readonly (ExceptionEvent & {
      readonly is_emergency: boolean;
      readonly source_order_reference: string;
      readonly assignment_state: string;
    })[]
  > {
    const actor = input.context.actor;
    if (!actor || (actor.actor_kind !== 'admin' && actor.actor_kind !== 'system')) {
      throw new FieldOpsAuthorizationError();
    }
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const result = await this.#pool.query(
      `SELECT event.*, assignment.source_order_reference, assignment.assignment_state
         FROM marketplace.partner_exception_events event
         JOIN marketplace.delivery_assignments assignment USING (delivery_assignment_id)
        WHERE event.resolution_state = 'OPEN'
          -- An exception a later event already closed is not open work, even
          -- though its own row still says OPEN: this table is append-only.
          AND NOT EXISTS (
            SELECT 1 FROM marketplace.partner_exception_events closed
             WHERE closed.delivery_assignment_id = event.delivery_assignment_id
               AND closed.exception_kind = event.exception_kind
               AND closed.resolution_state <> 'OPEN'
               AND closed.occurred_at > event.occurred_at
          )
        ORDER BY (event.exception_kind = ANY($1::text[])) DESC, event.occurred_at ASC
        LIMIT $2`,
      [[...EMERGENCY_KINDS], limit],
    );
    return Object.freeze(
      result.rows.map((row) => {
        const projected = projectException(row as Record<string, unknown>);
        return Object.freeze({
          ...projected,
          is_emergency: EMERGENCY_KINDS.has(projected.exception_kind),
          source_order_reference: (row as Record<string, unknown>)[
            'source_order_reference'
          ] as string,
          assignment_state: (row as Record<string, unknown>)['assignment_state'] as string,
        });
      }),
    );
  }

  async listExceptions(input: {
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
  }): Promise<readonly ExceptionEvent[]> {
    // Any authorised actor for the assignment can read; we only enforce
    // partner-ownership when the caller is a partner.
    const actor = input.context.actor;
    if (!actor) throw new FieldOpsAuthorizationError();
    const actorKind = actor.actor_kind;
    if (actorKind !== 'delivery_partner' && actorKind !== 'admin' && actorKind !== 'system') {
      throw new FieldOpsAuthorizationError();
    }
    if (actorKind === 'delivery_partner') {
      const partnerId = actor.actor_id;
      const assignment = await this.#pool.query<{ partner_user_id: string }>(
        `SELECT partner_user_id FROM marketplace.delivery_assignments
          WHERE delivery_assignment_id=$1`,
        [input.delivery_assignment_id],
      );
      if (assignment.rows[0]?.partner_user_id !== partnerId) throw new FieldOpsNotFoundError();
    }
    const result = await this.#pool.query(
      `SELECT * FROM marketplace.partner_exception_events
        WHERE delivery_assignment_id=$1 ORDER BY occurred_at`,
      [input.delivery_assignment_id],
    );
    return Object.freeze(
      result.rows.map((row) => projectException(row as Record<string, unknown>)),
    );
  }
}
