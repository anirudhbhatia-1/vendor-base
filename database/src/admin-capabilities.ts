import type { UuidV7 } from '@neighbourhood-store/domain-types';
import type { Pool, PoolClient } from 'pg';

/**
 * The capabilities an admin holds everywhere (11.1, 11.2): from their live
 * role assignments, where a scoped capability counts only under a global
 * scope. The dashboard filters its queues by it, and an intervention is
 * refused without the capability its kind needs.
 */
export async function globalAdminCapabilities(
  queryable: Pick<Pool | PoolClient, 'query'>,
  actor: UuidV7,
  now: Date,
): Promise<ReadonlySet<string>> {
  const rows = await queryable.query<{ capability_key: string }>(
    `SELECT DISTINCT capability.capability_key
       FROM marketplace.users person
       JOIN marketplace.role_assignments assignment ON assignment.user_id = person.user_id
       JOIN marketplace.role_capabilities granted USING (role_key)
       JOIN marketplace.capabilities capability USING (capability_key)
       LEFT JOIN marketplace.admin_membership_scopes scope USING (role_assignment_id)
      WHERE person.user_id = $1 AND person.state = 'ACTIVE'
        AND assignment.state = 'ACTIVE' AND assignment.valid_from <= $2
        AND (assignment.valid_until IS NULL OR assignment.valid_until > $2)
        AND (capability.resource_rule <> 'ADMIN_SCOPE' OR scope.scope_kind = 'GLOBAL')`,
    [actor, now],
  );
  return new Set(rows.rows.map((row) => row.capability_key));
}

/**
 * The capabilities an admin holds for one zone (11.8): what they hold
 * everywhere, and what a membership scoped to that zone grants.
 */
export async function zoneAdminCapabilities(
  queryable: Pick<Pool | PoolClient, 'query'>,
  actor: UuidV7,
  zoneId: string,
  now: Date,
): Promise<ReadonlySet<string>> {
  const rows = await queryable.query<{ capability_key: string }>(
    `SELECT DISTINCT capability.capability_key
       FROM marketplace.users person
       JOIN marketplace.role_assignments assignment ON assignment.user_id = person.user_id
       JOIN marketplace.role_capabilities granted USING (role_key)
       JOIN marketplace.capabilities capability USING (capability_key)
       LEFT JOIN marketplace.admin_membership_scopes scope USING (role_assignment_id)
      WHERE person.user_id = $1 AND person.state = 'ACTIVE'
        AND assignment.state = 'ACTIVE' AND assignment.valid_from <= $2
        AND (assignment.valid_until IS NULL OR assignment.valid_until > $2)
        AND (capability.resource_rule <> 'ADMIN_SCOPE' OR scope.scope_kind = 'GLOBAL'
             OR (scope.scope_kind = 'ZONE' AND scope.scope_id::text = $3))`,
    [actor, now, zoneId],
  );
  return new Set(rows.rows.map((row) => row.capability_key));
}
