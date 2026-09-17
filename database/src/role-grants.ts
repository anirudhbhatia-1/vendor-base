import { createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import type { PoolClient } from 'pg';

/**
 * One way to grant a role.
 *
 * Five modules inserted into `role_assignments` themselves -- customer
 * enrolment, identity access, admin provisioning, partner approval and vendor
 * approval -- with five shapes. Batch 02 found that three of them took no lock
 * and closed the duplicate-grant race with a unique index; what it did not
 * close was the drift. Two of the five never wrote the `ROLE_GRANTED` access
 * event at all, so a partner approved through an application, or a vendor
 * owner created by approving their store, appeared in the role table with no
 * record in the access history of when or why they were granted anything.
 *
 * The grant and its event are one write here. The per-user advisory lock
 * orders concurrent grants to the same person, so the unique index is the
 * backstop and not the mechanism.
 */
export async function grantRoleAssignment(
  client: PoolClient,
  input: {
    readonly user_id: UuidV7;
    readonly role_key: string;
    readonly granted_by_user_id: UuidV7 | null;
    readonly reason_code: string;
    readonly now: Date;
    readonly request_id: string;
    readonly correlation_id: string;
    readonly valid_until?: Date | null;
  },
): Promise<UuidV7> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `role:${input.user_id}`,
  ]);
  const roleAssignmentId = createUuidV7({ now_ms: input.now.getTime() });
  await client.query(
    `INSERT INTO marketplace.role_assignments
       (role_assignment_id, user_id, role_key, valid_from, valid_until, granted_by_user_id,
        request_id, correlation_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $4, $4)`,
    [
      roleAssignmentId,
      input.user_id,
      input.role_key,
      input.now,
      input.valid_until ?? null,
      input.granted_by_user_id,
      input.request_id,
      input.correlation_id,
    ],
  );
  await client.query(
    `INSERT INTO marketplace.access_membership_events
       (event_id, user_id, role_assignment_id, event_type, reason_code,
        request_id, correlation_id, occurred_at)
     VALUES ($1, $2, $3, 'ROLE_GRANTED', $4, $5, $6, $7)`,
    [
      createUuidV7({ now_ms: input.now.getTime() }),
      input.user_id,
      roleAssignmentId,
      input.reason_code,
      input.request_id,
      input.correlation_id,
      input.now,
    ],
  );
  return roleAssignmentId;
}
