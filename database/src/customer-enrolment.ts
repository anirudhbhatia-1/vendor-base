import {
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import type { PoolClient } from 'pg';
import { grantRoleAssignment } from './role-grants.js';

export class CustomerEnrolmentDeniedError extends Error {
  readonly code = 'FORBIDDEN';
}

/** Caller owns BEGIN/COMMIT. Identity, membership and OTP/session can commit together. */
export async function enrolCustomerInTransaction(
  client: PoolClient,
  input: {
    readonly context: RequestContext;
    readonly user_id: UuidV7;
    readonly granted_by_user_id?: UuidV7;
    readonly now: Date;
  },
): Promise<UuidV7> {
  const userId = parseUuidV7(input.user_id);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `role:${userId}:CUSTOMER`,
  ]);
  const user = await client.query<{ state: string }>(
    'SELECT state FROM marketplace.users WHERE user_id = $1 FOR UPDATE',
    [userId],
  );
  if (user.rows[0]?.state !== 'ACTIVE')
    throw new CustomerEnrolmentDeniedError('Customer identity is disabled or unavailable');
  const roles = await client.query<{
    role_assignment_id: string;
    state: string;
    valid_from: Date;
    valid_until: Date | null;
  }>(
    `SELECT role_assignment_id, state, valid_from, valid_until FROM marketplace.role_assignments
     WHERE user_id = $1 AND role_key = 'CUSTOMER' FOR UPDATE`,
    [userId],
  );
  const active = roles.rows.find(
    (role) =>
      role.state === 'ACTIVE' &&
      role.valid_from <= input.now &&
      (!role.valid_until || role.valid_until > input.now),
  );
  if (active) return parseUuidV7(active.role_assignment_id);
  // Re-enrolment is not an access-restoration authority. A controlled admin
  // restoration workflow must explicitly resolve expired/revoked assignments.
  if (roles.rows.length > 0)
    throw new CustomerEnrolmentDeniedError('Customer access requires an authorized review');
  return grantRoleAssignment(client, {
    user_id: userId,
    role_key: 'CUSTOMER',
    granted_by_user_id: input.granted_by_user_id ? parseUuidV7(input.granted_by_user_id) : null,
    reason_code: 'AUTHORIZED_GRANT',
    now: input.now,
    request_id: parseRequestId(input.context.request_id),
    correlation_id: parseUuidV7(input.context.correlation_id),
  });
}
