import { createDatabasePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';

export class GatedCapabilityInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}
export class GatedCapabilityAuthorizationError extends Error {
  readonly code = 'PERMISSION_DENIED';
}
export class GatedCapabilityNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';
}
/**
 * Raised when code reaches for a capability FEATURES.md marks Gated before its
 * named approval exists. This is the enforcement point for section 17: gated
 * capabilities must remain unavailable, not merely undocumented.
 */
export class GatedCapabilityUnavailableError extends Error {
  readonly code = 'PERMISSION_DENIED';
}

export interface GatedCapabilityRecord {
  readonly capability_key: string;
  readonly catalogue_id: string;
  readonly description: string;
  readonly required_gate: string;
  readonly state: 'UNAVAILABLE' | 'AVAILABLE';
  readonly approval: {
    readonly approval_reference: string;
    readonly approver_role: string;
    readonly recorded_at: string;
  } | null;
}

const APPROVAL_REFERENCE = /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/;
const ROLE = /^[A-Z][A-Z0-9_]{2,63}$/;

function admin(context: RequestContext): UuidV7 {
  const actor = context.actor;
  if (!actor || (actor.actor_kind !== 'admin' && actor.actor_kind !== 'system')) {
    throw new GatedCapabilityAuthorizationError('Named approval authority is required');
  }
  return actor.actor_id;
}

export class GatedCapabilityService {
  readonly #pool: Pool;

  constructor(input: { readonly connection_string: string }) {
    this.#pool = createDatabasePool({
      application_name: 'neighbourhood-store-gated-capabilities',
      connectionString: input.connection_string,
      max: 4,
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async list(input: {
    readonly context: RequestContext;
  }): Promise<readonly GatedCapabilityRecord[]> {
    admin(input.context);
    const rows = await this.#pool.query<{
      capability_key: string;
      catalogue_id: string;
      description: string;
      required_gate: string;
      state: 'UNAVAILABLE' | 'AVAILABLE';
      approval_reference: string | null;
      approver_role: string | null;
      recorded_at: Date | null;
    }>(
      `SELECT capability.capability_key, capability.catalogue_id, capability.description,
              capability.required_gate, capability.state,
              approval.approval_reference, approval.approver_role, approval.recorded_at
         FROM marketplace.gated_capabilities capability
         LEFT JOIN LATERAL (
           SELECT approval_reference, approver_role, recorded_at
             FROM marketplace.gated_capability_approvals
            WHERE capability_key = capability.capability_key AND decision = 'APPROVED'
            ORDER BY recorded_at DESC LIMIT 1
         ) approval ON true
        ORDER BY capability.catalogue_id`,
    );
    return rows.rows.map((row) =>
      Object.freeze({
        capability_key: row.capability_key,
        catalogue_id: row.catalogue_id,
        description: row.description,
        required_gate: row.required_gate,
        state: row.state,
        approval: row.approval_reference
          ? Object.freeze({
              approval_reference: row.approval_reference,
              approver_role: row.approver_role ?? 'UNKNOWN',
              recorded_at: (row.recorded_at ?? new Date()).toISOString(),
            })
          : null,
      }),
    );
  }

  /**
   * The check every gated code path must make before doing anything.
   *
   * Availability is derived from the register, never from a build flag or an
   * environment variable, so enabling one of these capabilities always leaves a
   * named, auditable decision behind.
   */
  async assertAvailable(capabilityKey: string): Promise<void> {
    const row = await this.#pool.query<{ state: string }>(
      'SELECT state FROM marketplace.gated_capabilities WHERE capability_key=$1',
      [capabilityKey],
    );
    const state = row.rows[0]?.state;
    if (!state) throw new GatedCapabilityNotFoundError('Unknown gated capability');
    if (state !== 'AVAILABLE') {
      throw new GatedCapabilityUnavailableError(
        `${capabilityKey} requires its named approval before it may be used`,
      );
    }
  }

  /**
   * Records a named approval and turns the capability on in one transaction.
   *
   * Recording and enabling are deliberately the same operation: a capability
   * cannot be switched on without the approval that justifies it, and an
   * approval that does not name an approver, a reference and evidence is
   * rejected outright.
   */
  async approve(input: {
    readonly context: RequestContext;
    readonly capability_key: string;
    readonly approval_reference: string;
    readonly approver_role: string;
    readonly evidence_note: string;
    readonly now?: Date;
  }): Promise<GatedCapabilityRecord> {
    const approver = admin(input.context);
    if (!APPROVAL_REFERENCE.test(input.approval_reference)) {
      throw new GatedCapabilityInputError('A durable approval reference is required');
    }
    if (!ROLE.test(input.approver_role)) {
      throw new GatedCapabilityInputError('The approving role must be named');
    }
    if (input.evidence_note.trim().length < 12) {
      throw new GatedCapabilityInputError('Approval evidence must be recorded');
    }
    return this.#transition(input.context, input.capability_key, 'APPROVED', 'AVAILABLE', {
      approval_reference: input.approval_reference,
      approver_role: input.approver_role,
      approver_user_id: approver,
      evidence_note: input.evidence_note,
      now: input.now ?? new Date(),
    });
  }

  /** Withdraws an approval, returning the capability to unavailable. */
  async withdraw(input: {
    readonly context: RequestContext;
    readonly capability_key: string;
    readonly approval_reference: string;
    readonly approver_role: string;
    readonly evidence_note: string;
    readonly now?: Date;
  }): Promise<GatedCapabilityRecord> {
    const approver = admin(input.context);
    if (input.evidence_note.trim().length < 12) {
      throw new GatedCapabilityInputError('Withdrawal evidence must be recorded');
    }
    return this.#transition(input.context, input.capability_key, 'WITHDRAWN', 'UNAVAILABLE', {
      approval_reference: input.approval_reference,
      approver_role: input.approver_role,
      approver_user_id: approver,
      evidence_note: input.evidence_note,
      now: input.now ?? new Date(),
    });
  }

  async #transition(
    context: RequestContext,
    capabilityKey: string,
    decision: 'APPROVED' | 'WITHDRAWN',
    state: 'AVAILABLE' | 'UNAVAILABLE',
    details: {
      readonly approval_reference: string;
      readonly approver_role: string;
      readonly approver_user_id: UuidV7;
      readonly evidence_note: string;
      readonly now: Date;
    },
  ): Promise<GatedCapabilityRecord> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        'SELECT 1 FROM marketplace.gated_capabilities WHERE capability_key=$1 FOR UPDATE',
        [capabilityKey],
      );
      if (!existing.rows[0]) throw new GatedCapabilityNotFoundError('Unknown gated capability');
      await client.query(
        `INSERT INTO marketplace.gated_capability_approvals
           (approval_id, capability_key, decision, approver_user_id, approver_role,
            approval_reference, evidence_note, request_id, correlation_id, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          createUuidV7({ now_ms: details.now.getTime() }),
          capabilityKey,
          decision,
          details.approver_user_id,
          details.approver_role,
          details.approval_reference,
          details.evidence_note,
          parseRequestId(context.request_id),
          parseUuidV7(context.correlation_id),
          details.now,
        ],
      );
      await client.query(
        'UPDATE marketplace.gated_capabilities SET state=$2, updated_at=$3 WHERE capability_key=$1',
        [capabilityKey, state, details.now],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const all = await this.list({ context });
    const record = all.find((candidate) => candidate.capability_key === capabilityKey);
    if (!record) throw new GatedCapabilityNotFoundError('Unknown gated capability');
    return record;
  }
}
