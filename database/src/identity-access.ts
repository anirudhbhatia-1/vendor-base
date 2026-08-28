import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';

export type ActorKind = 'admin' | 'customer' | 'partner' | 'vendor_staff';
export type AdminScopeKind = 'GLOBAL' | 'VENDOR_LOCATION' | 'ZONE';
export type VendorRole = 'VENDOR_MANAGER' | 'VENDOR_OWNER' | 'VENDOR_PICKER';
export type AdminRole =
  | 'CONFIG_APPROVER'
  | 'CONFIG_OPERATOR'
  | 'DELIVERY_OPERATOR'
  | 'FINANCE_APPROVER'
  | 'FINANCE_OPERATOR'
  | 'INCIDENT_COMMANDER'
  | 'SUPPORT_AGENT'
  | 'TRUST_APPROVER'
  | 'TRUST_OPERATOR'
  | 'VENDOR_ONBOARDING_OPERATOR'
  | 'VENDOR_ONBOARDING_REVIEWER'
  | 'CATALOGUE_MODERATOR'
  | 'VENDOR_PUBLICATION_OPERATOR'
  | 'VENDOR_PUBLICATION_REVIEWER';
export type PartnerEligibilityState = 'ELIGIBLE' | 'PENDING' | 'RESTRICTED' | 'SUSPENDED';

export interface AccessEvaluationInput {
  readonly admin_scope?: { readonly kind: AdminScopeKind; readonly scope_id?: UuidV7 };
  readonly capability: string;
  readonly delivery_assignment_id?: UuidV7;
  readonly now?: Date;
  readonly user_id: UuidV7;
  readonly vendor_location_id?: UuidV7;
}

export type AccessDecision =
  | {
      readonly actor_kind: ActorKind;
      readonly allowed: true;
      readonly capability: string;
      readonly role_assignment_id: UuidV7;
      readonly role_key: string;
    }
  | {
      readonly allowed: false;
      readonly capability: string;
      readonly reason: 'DENY_BY_DEFAULT';
    };

export class AccessInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}

export class AccessConflictError extends Error {
  readonly code = 'CONFLICT';
}

const CAPABILITY_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*){2,5}$/;
const REASON_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
const VENDOR_ROLES = new Set<VendorRole>(['VENDOR_MANAGER', 'VENDOR_OWNER', 'VENDOR_PICKER']);
const ADMIN_ROLES = new Set<AdminRole>([
  'CONFIG_APPROVER',
  'CONFIG_OPERATOR',
  'DELIVERY_OPERATOR',
  'FINANCE_APPROVER',
  'FINANCE_OPERATOR',
  'INCIDENT_COMMANDER',
  'SUPPORT_AGENT',
  'TRUST_APPROVER',
  'TRUST_OPERATOR',
  'VENDOR_ONBOARDING_OPERATOR',
  'VENDOR_ONBOARDING_REVIEWER',
  'CATALOGUE_MODERATOR',
  'VENDOR_PUBLICATION_OPERATOR',
  'VENDOR_PUBLICATION_REVIEWER',
]);

function requireReason(reason: string): string {
  if (!REASON_PATTERN.test(reason)) throw new AccessInputError('Reason code is invalid');
  return reason;
}

function requireCapability(capability: string): string {
  if (!CAPABILITY_PATTERN.test(capability)) {
    throw new AccessInputError('Capability key is invalid');
  }
  return capability;
}

function requireFutureWindow(now: Date, validUntil?: Date): Date | null {
  if (validUntil && validUntil <= now) throw new AccessInputError('Validity window is invalid');
  return validUntil ?? null;
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

function contextIds(context: RequestContext) {
  return {
    correlationId: parseUuidV7(context.correlation_id),
    requestId: parseRequestId(context.request_id),
  };
}

interface EvaluationRow {
  readonly actor_kind: 'ADMIN' | 'CUSTOMER' | 'PARTNER' | 'VENDOR_STAFF';
  readonly admin_scope_id: string | null;
  readonly admin_scope_kind: AdminScopeKind | null;
  readonly delivery_assignment_id: string | null;
  readonly partner_eligible_from: Date | null;
  readonly partner_eligible_until: Date | null;
  readonly partner_state: PartnerEligibilityState | null;
  readonly resource_rule:
    'ACCOUNT' | 'ACTIVE_ASSIGNMENT' | 'ADMIN_SCOPE' | 'PARTNER_SELF' | 'VENDOR_LOCATION';
  readonly role_assignment_id: string;
  readonly role_key: string;
  readonly vendor_location_id: string | null;
}

function actorKind(value: EvaluationRow['actor_kind']): ActorKind {
  if (value === 'VENDOR_STAFF') return 'vendor_staff';
  return value.toLowerCase() as Exclude<ActorKind, 'vendor_staff'>;
}

export class IdentityAccessService {
  readonly #pool: Pool;

  constructor(input: { readonly connection_string: string }) {
    this.#pool = new Pool({
      application_name: 'neighbourhood-store-identity-access',
      connectionString: input.connection_string,
      connectionTimeoutMillis: 5_000,
      max: 8,
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async #insertAssignment(
    client: PoolClient,
    input: {
      readonly context: RequestContext;
      readonly granted_by_user_id?: UuidV7;
      readonly now: Date;
      readonly role_key: string;
      readonly user_id: UuidV7;
      readonly valid_until?: Date;
    },
  ): Promise<UuidV7> {
    const roleAssignmentId = createUuidV7({ now_ms: input.now.getTime() });
    const { correlationId, requestId } = contextIds(input.context);
    await client.query(
      `INSERT INTO marketplace.role_assignments
         (role_assignment_id, user_id, role_key, valid_from, valid_until,
          granted_by_user_id, request_id, correlation_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $4, $4)`,
      [
        roleAssignmentId,
        parseUuidV7(input.user_id),
        input.role_key,
        input.now,
        requireFutureWindow(input.now, input.valid_until),
        input.granted_by_user_id ? parseUuidV7(input.granted_by_user_id) : null,
        requestId,
        correlationId,
      ],
    );
    await this.#event(client, {
      context: input.context,
      event_type: 'ROLE_GRANTED',
      now: input.now,
      reason_code: 'AUTHORIZED_GRANT',
      role_assignment_id: roleAssignmentId,
      user_id: input.user_id,
    });
    return roleAssignmentId;
  }

  async #event(
    client: PoolClient,
    input: {
      readonly context: RequestContext;
      readonly event_type:
        | 'PARTNER_ASSIGNMENT_ACTIVATED'
        | 'PARTNER_ASSIGNMENT_ENDED'
        | 'PARTNER_ELIGIBILITY_CHANGED'
        | 'ROLE_GRANTED'
        | 'ROLE_REVOKED';
      readonly now: Date;
      readonly reason_code: string;
      readonly role_assignment_id?: UuidV7;
      readonly user_id: UuidV7;
    },
  ) {
    const { correlationId, requestId } = contextIds(input.context);
    await client.query(
      `INSERT INTO marketplace.access_membership_events
         (event_id, user_id, role_assignment_id, event_type, reason_code,
          request_id, correlation_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        createUuidV7({ now_ms: input.now.getTime() }),
        parseUuidV7(input.user_id),
        input.role_assignment_id ?? null,
        input.event_type,
        requireReason(input.reason_code),
        requestId,
        correlationId,
        input.now,
      ],
    );
  }

  async grantCustomer(input: {
    readonly context: RequestContext;
    readonly granted_by_user_id?: UuidV7;
    readonly now?: Date;
    readonly user_id: UuidV7;
  }): Promise<UuidV7> {
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `role:${input.user_id}:CUSTOMER`,
      ]);
      const existing = await client.query<{ role_assignment_id: string }>(
        `SELECT role_assignment_id FROM marketplace.role_assignments
          WHERE user_id = $1 AND role_key = 'CUSTOMER' AND state = 'ACTIVE'
            AND valid_from <= $2 AND (valid_until IS NULL OR valid_until > $2)`,
        [parseUuidV7(input.user_id), now],
      );
      if (existing.rows[0]) return parseUuidV7(existing.rows[0].role_assignment_id);
      return this.#insertAssignment(client, { ...input, now, role_key: 'CUSTOMER' });
    });
  }

  async grantVendorMembership(input: {
    readonly context: RequestContext;
    readonly granted_by_user_id: UuidV7;
    readonly now?: Date;
    readonly role: VendorRole;
    readonly user_id: UuidV7;
    readonly valid_until?: Date;
    readonly vendor_location_id: UuidV7;
  }): Promise<UuidV7> {
    if (!VENDOR_ROLES.has(input.role)) throw new AccessInputError('Vendor role is invalid');
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `vendor-role:${input.user_id}:${input.vendor_location_id}:${input.role}`,
      ]);
      const existing = await client.query<{ role_assignment_id: string }>(
        `SELECT ra.role_assignment_id
           FROM marketplace.role_assignments ra
           JOIN marketplace.staff_memberships sm USING (role_assignment_id)
          WHERE ra.user_id = $1 AND ra.role_key = $2 AND ra.state = 'ACTIVE'
            AND sm.vendor_location_id = $3
            AND ra.valid_from <= $4 AND (ra.valid_until IS NULL OR ra.valid_until > $4)`,
        [input.user_id, input.role, input.vendor_location_id, now],
      );
      if (existing.rows[0]) return parseUuidV7(existing.rows[0].role_assignment_id);
      const roleAssignmentId = await this.#insertAssignment(client, {
        ...input,
        now,
        role_key: input.role,
      });
      await client.query(
        `INSERT INTO marketplace.staff_memberships
           (staff_membership_id, role_assignment_id, user_id, vendor_location_id, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          roleAssignmentId,
          input.user_id,
          input.vendor_location_id,
          now,
        ],
      );
      return roleAssignmentId;
    });
  }

  async setPartnerEligibility(input: {
    readonly context: RequestContext;
    readonly granted_by_user_id: UuidV7;
    readonly now?: Date;
    readonly reason_code: string;
    readonly state: PartnerEligibilityState;
    readonly user_id: UuidV7;
    readonly valid_until?: Date;
  }): Promise<UuidV7> {
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `partner:${input.user_id}`,
      ]);
      const existing = await client.query<{ role_assignment_id: string }>(
        `SELECT role_assignment_id FROM marketplace.partner_eligibilities WHERE user_id = $1`,
        [parseUuidV7(input.user_id)],
      );
      let roleAssignmentId: UuidV7;
      if (existing.rows[0]) {
        roleAssignmentId = parseUuidV7(existing.rows[0].role_assignment_id);
        await client.query(
          `UPDATE marketplace.partner_eligibilities
              SET state = $2::text,
                  eligible_from = CASE WHEN $2::text = 'ELIGIBLE' THEN $3::timestamptz ELSE NULL END,
                  eligible_until = CASE WHEN $2::text = 'ELIGIBLE' THEN $4::timestamptz ELSE NULL END,
                  reason_code = $5, version = version + 1, updated_at = $3::timestamptz
            WHERE user_id = $1`,
          [
            input.user_id,
            input.state,
            now,
            input.state === 'ELIGIBLE' ? requireFutureWindow(now, input.valid_until) : null,
            requireReason(input.reason_code),
          ],
        );
      } else {
        roleAssignmentId = await this.#insertAssignment(client, {
          ...input,
          now,
          role_key: 'DELIVERY_PARTNER',
        });
        await client.query(
          `INSERT INTO marketplace.partner_eligibilities
             (partner_eligibility_id, role_assignment_id, user_id, state,
              eligible_from, eligible_until, reason_code, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            createUuidV7({ now_ms: now.getTime() }),
            roleAssignmentId,
            input.user_id,
            input.state,
            input.state === 'ELIGIBLE' ? now : null,
            input.state === 'ELIGIBLE' ? requireFutureWindow(now, input.valid_until) : null,
            requireReason(input.reason_code),
            now,
          ],
        );
      }
      await this.#event(client, {
        context: input.context,
        event_type: 'PARTNER_ELIGIBILITY_CHANGED',
        now,
        reason_code: input.reason_code,
        role_assignment_id: roleAssignmentId,
        user_id: input.user_id,
      });
      return roleAssignmentId;
    });
  }

  async activatePartnerAssignment(input: {
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
    readonly now?: Date;
    readonly user_id: UuidV7;
  }): Promise<UuidV7> {
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `partner-assignment:${input.user_id}`,
      ]);
      const eligibility = await client.query<{ eligible: boolean; role_assignment_id: string }>(
        `SELECT state = 'ELIGIBLE' AND eligible_from <= $2
                AND (eligible_until IS NULL OR eligible_until > $2) AS eligible,
                role_assignment_id
           FROM marketplace.partner_eligibilities WHERE user_id = $1 FOR UPDATE`,
        [parseUuidV7(input.user_id), now],
      );
      if (!eligibility.rows[0]?.eligible) {
        throw new AccessConflictError('Partner is not eligible for an assignment');
      }
      const membershipId = createUuidV7({ now_ms: now.getTime() });
      try {
        await client.query(
          `INSERT INTO marketplace.partner_assignment_memberships
             (partner_assignment_membership_id, user_id, delivery_assignment_id,
              activated_at, reason_code, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'ASSIGNMENT_ACCEPTED', $4, $4)`,
          [membershipId, input.user_id, input.delivery_assignment_id, now],
        );
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === '23505'
        ) {
          throw new AccessConflictError('Partner or assignment already has active work');
        }
        throw error;
      }
      await this.#event(client, {
        context: input.context,
        event_type: 'PARTNER_ASSIGNMENT_ACTIVATED',
        now,
        reason_code: 'ASSIGNMENT_ACCEPTED',
        role_assignment_id: parseUuidV7(eligibility.rows[0].role_assignment_id),
        user_id: input.user_id,
      });
      return membershipId;
    });
  }

  async endPartnerAssignment(input: {
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
    readonly now?: Date;
    readonly reason_code: string;
    readonly user_id: UuidV7;
  }): Promise<void> {
    const now = input.now ?? new Date();
    await transaction(this.#pool, async (client) => {
      const ended = await client.query<{ role_assignment_id: string }>(
        `WITH ended AS (
           UPDATE marketplace.partner_assignment_memberships
              SET state = 'ENDED', ended_at = $3, reason_code = $4, updated_at = $3
            WHERE user_id = $1 AND delivery_assignment_id = $2 AND state = 'ACTIVE'
          RETURNING user_id
         )
         SELECT pe.role_assignment_id FROM ended
           JOIN marketplace.partner_eligibilities pe USING (user_id)`,
        [input.user_id, input.delivery_assignment_id, now, requireReason(input.reason_code)],
      );
      if (!ended.rows[0]) throw new AccessConflictError('Active assignment was not found');
      await this.#event(client, {
        context: input.context,
        event_type: 'PARTNER_ASSIGNMENT_ENDED',
        now,
        reason_code: input.reason_code,
        role_assignment_id: parseUuidV7(ended.rows[0].role_assignment_id),
        user_id: input.user_id,
      });
    });
  }

  async grantAdminMembership(input: {
    readonly context: RequestContext;
    readonly granted_by_user_id: UuidV7;
    readonly now?: Date;
    readonly role: AdminRole;
    readonly scope: { readonly kind: AdminScopeKind; readonly scope_id?: UuidV7 };
    readonly user_id: UuidV7;
    readonly valid_until?: Date;
  }): Promise<UuidV7> {
    if (!ADMIN_ROLES.has(input.role)) throw new AccessInputError('Admin role is invalid');
    if (input.granted_by_user_id === input.user_id) {
      throw new AccessConflictError('Admin membership cannot be self-granted');
    }
    if ((input.scope.kind === 'GLOBAL') === Boolean(input.scope.scope_id)) {
      throw new AccessInputError('Admin scope is invalid');
    }
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `admin-role:${input.user_id}`,
      ]);
      const conflict = await client.query<{ conflict: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM marketplace.role_assignments existing
           JOIN marketplace.role_separation_rules rule
             ON rule.first_role_key = LEAST(existing.role_key, $2)
            AND rule.second_role_key = GREATEST(existing.role_key, $2)
          WHERE existing.user_id = $1 AND existing.state = 'ACTIVE'
            AND existing.valid_from < COALESCE($4::timestamptz, 'infinity'::timestamptz)
            AND $3 < COALESCE(existing.valid_until, 'infinity'::timestamptz)
         ) AS conflict`,
        [input.user_id, input.role, now, input.valid_until ?? null],
      );
      if (conflict.rows[0]?.conflict) {
        throw new AccessConflictError('Admin role violates separation of duties');
      }
      const roleAssignmentId = await this.#insertAssignment(client, {
        ...input,
        now,
        role_key: input.role,
      });
      await client.query(
        `INSERT INTO marketplace.admin_membership_scopes
           (admin_membership_scope_id, role_assignment_id, user_id, scope_kind, scope_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          roleAssignmentId,
          input.user_id,
          input.scope.kind,
          input.scope.scope_id ?? null,
          now,
        ],
      );
      return roleAssignmentId;
    });
  }

  async revokeRole(input: {
    readonly context: RequestContext;
    readonly now?: Date;
    readonly reason_code: string;
    readonly role_assignment_id: UuidV7;
    readonly user_id: UuidV7;
  }): Promise<void> {
    const now = input.now ?? new Date();
    await transaction(this.#pool, async (client) => {
      const revoked = await client.query(
        `UPDATE marketplace.role_assignments
            SET state = 'REVOKED', revoked_at = $3, revoke_reason = $4, updated_at = $3
          WHERE role_assignment_id = $1 AND user_id = $2 AND state = 'ACTIVE'
          RETURNING role_assignment_id`,
        [input.role_assignment_id, input.user_id, now, requireReason(input.reason_code)],
      );
      if (revoked.rowCount !== 1) throw new AccessConflictError('Active role was not found');
      await this.#event(client, {
        context: input.context,
        event_type: 'ROLE_REVOKED',
        now,
        reason_code: input.reason_code,
        role_assignment_id: input.role_assignment_id,
        user_id: input.user_id,
      });
    });
  }

  async evaluate(input: AccessEvaluationInput): Promise<AccessDecision> {
    const capability = requireCapability(input.capability);
    const now = input.now ?? new Date();
    const rows = await this.#pool.query<EvaluationRow>(
      `SELECT ra.role_assignment_id, ra.role_key, r.actor_kind, c.resource_rule,
              sm.vendor_location_id, pe.state AS partner_state,
              pe.eligible_from AS partner_eligible_from,
              pe.eligible_until AS partner_eligible_until,
              pam.delivery_assignment_id, ams.scope_kind AS admin_scope_kind,
              ams.scope_id AS admin_scope_id
         FROM marketplace.users u
         JOIN marketplace.role_assignments ra ON ra.user_id = u.user_id
         JOIN marketplace.roles r USING (role_key)
         JOIN marketplace.role_capabilities rc USING (role_key)
         JOIN marketplace.capabilities c USING (capability_key)
         LEFT JOIN marketplace.staff_memberships sm USING (role_assignment_id)
         LEFT JOIN marketplace.partner_eligibilities pe USING (role_assignment_id)
         LEFT JOIN marketplace.partner_assignment_memberships pam
           ON pam.user_id = ra.user_id AND pam.state = 'ACTIVE'
         LEFT JOIN marketplace.admin_membership_scopes ams USING (role_assignment_id)
        WHERE u.user_id = $1 AND u.state = 'ACTIVE' AND c.capability_key = $2
          AND ra.state = 'ACTIVE' AND ra.valid_from <= $3
          AND (ra.valid_until IS NULL OR ra.valid_until > $3)
        ORDER BY ra.created_at, ra.role_assignment_id`,
      [parseUuidV7(input.user_id), capability, now],
    );

    for (const row of rows.rows) {
      let allowed = row.resource_rule === 'ACCOUNT';
      if (row.resource_rule === 'VENDOR_LOCATION') {
        allowed = Boolean(
          input.vendor_location_id && row.vendor_location_id === input.vendor_location_id,
        );
      } else if (row.resource_rule === 'PARTNER_SELF') {
        allowed =
          row.partner_state === 'ELIGIBLE' &&
          Boolean(row.partner_eligible_from && row.partner_eligible_from <= now) &&
          (!row.partner_eligible_until || row.partner_eligible_until > now);
      } else if (row.resource_rule === 'ACTIVE_ASSIGNMENT') {
        allowed =
          row.partner_state === 'ELIGIBLE' &&
          Boolean(row.partner_eligible_from && row.partner_eligible_from <= now) &&
          (!row.partner_eligible_until || row.partner_eligible_until > now) &&
          Boolean(
            input.delivery_assignment_id &&
            row.delivery_assignment_id === input.delivery_assignment_id,
          );
      } else if (row.resource_rule === 'ADMIN_SCOPE') {
        allowed = Boolean(
          input.admin_scope &&
          (row.admin_scope_kind === 'GLOBAL' ||
            (row.admin_scope_kind === input.admin_scope.kind &&
              row.admin_scope_id === input.admin_scope.scope_id)),
        );
      }
      if (allowed) {
        return Object.freeze({
          actor_kind: actorKind(row.actor_kind),
          allowed: true,
          capability,
          role_assignment_id: parseUuidV7(row.role_assignment_id),
          role_key: row.role_key,
        });
      }
    }
    return Object.freeze({ allowed: false, capability, reason: 'DENY_BY_DEFAULT' });
  }
}
