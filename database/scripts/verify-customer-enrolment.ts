import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import {
  CustomerEnrolmentDeniedError,
  enrolCustomerInTransaction,
} from '../src/customer-enrolment.js';
import { check } from './verify-support.js';

function context() {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: createUuidV7(),
      actor_kind: 'customer',
      session_id: createUuidV7(),
    }),
  });
}

async function createUser(pool: Pool, state: 'ACTIVE' | 'DISABLED'): Promise<UuidV7> {
  const userId = createUuidV7();
  await pool.query(
    'INSERT INTO marketplace.users (user_id, state, data_classification) VALUES ($1,$2,$3)',
    [userId, state, 'RESTRICTED'],
  );
  return userId;
}

/**
 * Every row, whatever its state. `state = 'ACTIVE'` is not the same question as
 * "is this assignment currently valid": an expired or not-yet-valid assignment
 * still carries state ACTIVE, so counting active rows cannot tell a refused
 * enrolment apart from the seeded row it refused over. Counting all rows can.
 */
async function totalAssignments(pool: Pool, userId: UuidV7): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM marketplace.role_assignments
      WHERE user_id = $1 AND role_key = 'CUSTOMER'`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? '-1');
}

async function activeAssignments(pool: Pool, userId: UuidV7): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM marketplace.role_assignments
      WHERE user_id = $1 AND role_key = 'CUSTOMER' AND state = 'ACTIVE'`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? '-1');
}

/**
 * The enrolment transaction against a real PostgreSQL instance.
 *
 * `customer-enrolment.spec.ts` covers the same module with a `PoolClient` test
 * double, which is the right tool for branch coverage but cannot observe the
 * two properties that actually matter here: that a rollback really discards the
 * role grant and its audit event, and that two concurrent first-time
 * enrolments cannot both insert. A stub answers whatever it was told to answer,
 * so it can never fail the way a race fails.
 */
export async function verifyCustomerEnrolment(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 6 });
  const now = new Date('2026-09-07T09:00:00.000Z');
  try {
    // 1. First enrolment grants the role and writes its membership audit event
    //    in the same transaction as the caller's own work.
    const firstUser = await createUser(pool, 'ACTIVE');
    const client = await pool.connect();
    let grantedId: UuidV7;
    try {
      await client.query('BEGIN');
      grantedId = await enrolCustomerInTransaction(client, {
        context: context(),
        now,
        user_id: firstUser,
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    check(
      (await activeAssignments(pool, firstUser)) === 1,
      'First enrolment did not grant CUSTOMER',
    );
    const events = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.access_membership_events
        WHERE user_id = $1 AND role_assignment_id = $2 AND event_type = 'ROLE_GRANTED'`,
      [firstUser, grantedId],
    );
    check(events.rows[0]?.count === '1', 'Enrolment left no membership audit event');

    // 2. Re-enrolling an already active customer returns the same assignment and
    //    inserts nothing. This is the ordinary repeat-login path.
    const repeatClient = await pool.connect();
    try {
      await repeatClient.query('BEGIN');
      const again = await enrolCustomerInTransaction(repeatClient, {
        context: context(),
        now,
        user_id: firstUser,
      });
      await repeatClient.query('COMMIT');
      check(again === grantedId, 'Re-enrolment issued a second assignment id');
    } finally {
      repeatClient.release();
    }
    check((await activeAssignments(pool, firstUser)) === 1, 'Re-enrolment duplicated the role');

    // 3. Rollback really discards the grant. The whole point of moving enrolment
    //    into the OTP transaction is that a later failure cannot leave a
    //    half-finished identity, and only a real database can show that.
    const rollbackUser = await createUser(pool, 'ACTIVE');
    const rollbackClient = await pool.connect();
    try {
      await rollbackClient.query('BEGIN');
      await enrolCustomerInTransaction(rollbackClient, {
        context: context(),
        now,
        user_id: rollbackUser,
      });
      await rollbackClient.query('ROLLBACK');
    } finally {
      rollbackClient.release();
    }
    check(
      (await activeAssignments(pool, rollbackUser)) === 0,
      'A rolled-back enrolment still granted the customer role',
    );
    const orphanEvents = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.access_membership_events WHERE user_id = $1`,
      [rollbackUser],
    );
    check(
      orphanEvents.rows[0]?.count === '0',
      'A rolled-back enrolment left an orphaned membership event',
    );

    // 4. Two concurrent first-time enrolments must produce exactly one active
    //    assignment. `role_assignments_user_active` is a plain index, not a
    //    unique one, so nothing in the schema forbids a duplicate -- serialization
    //    inside the transaction is the only thing standing between a double login
    //    and two active CUSTOMER grants for one person.
    //
    //    This races three pre-warmed connections, but it is recorded as a
    //    smoke check rather than proof. Measured against this database, the race
    //    is only sensitive in isolation: run standalone with all serialization
    //    removed it produces three duplicate grants, and run in this verifier's
    //    sequence with the same code it produces one, because the transactions
    //    no longer overlap tightly enough. A test whose sensitivity depends on
    //    what ran before it cannot carry an invariant. Assertion 4b does.
    const racedUser = await createUser(pool, 'ACTIVE');
    const enrolOnce = async (raceClient: PoolClient): Promise<void> => {
      try {
        await raceClient.query('BEGIN');
        await enrolCustomerInTransaction(raceClient, {
          context: context(),
          now,
          user_id: racedUser,
        });
        await raceClient.query('COMMIT');
      } catch (error: unknown) {
        await raceClient.query('ROLLBACK');
        throw error;
      } finally {
        raceClient.release();
      }
    };
    const raceClients = await Promise.all([pool.connect(), pool.connect(), pool.connect()]);
    const raced = await Promise.allSettled(raceClients.map((client) => enrolOnce(client)));
    check(
      raced.some((outcome) => outcome.status === 'fulfilled'),
      'Every concurrent enrolment attempt failed',
    );
    check(
      (await activeAssignments(pool, racedUser)) === 1,
      'Concurrent enrolment granted the customer role more than once',
    );

    // 4b. The invariant, enforced where timing cannot reach it. Migration 0070
    //     adds a partial unique index over (user_id, role_key) WHERE state =
    //     'ACTIVE'. Before it, nothing in the schema forbade a duplicate active
    //     grant -- only application serialization did, and the vendor, partner
    //     and admin role-granting paths take no lock at all. This asserts the
    //     database itself refuses, whichever path writes and whether or not it
    //     remembered to lock.
    const constrainedUser = await createUser(pool, 'ACTIVE');
    await pool.query(
      `INSERT INTO marketplace.role_assignments
       (role_assignment_id, user_id, role_key, valid_from, request_id, correlation_id)
       VALUES ($1,$2,'CUSTOMER',$3,$4,$4)`,
      [createUuidV7(), constrainedUser, now, createUuidV7()],
    );
    let duplicateRefused = '';
    try {
      await pool.query(
        `INSERT INTO marketplace.role_assignments
         (role_assignment_id, user_id, role_key, valid_from, request_id, correlation_id)
         VALUES ($1,$2,'CUSTOMER',$3,$4,$4)`,
        [createUuidV7(), constrainedUser, now, createUuidV7()],
      );
    } catch (error: unknown) {
      duplicateRefused = (error as { code?: string }).code ?? '';
    }
    check(
      duplicateRefused === '23505',
      'The schema accepted a second active CUSTOMER assignment for one identity',
    );
    check(
      (await activeAssignments(pool, constrainedUser)) === 1,
      'A duplicate active role assignment was stored',
    );

    // 5. Enrolment is not an access-restoration authority. A revoked, expired or
    //    not-yet-valid assignment is refused rather than replaced with a fresh
    //    grant -- retrying login must never undo an administrative revocation.
    const denied = async (
      seed: (userId: UuidV7) => Promise<void>,
      message: string,
    ): Promise<void> => {
      const userId = await createUser(pool, 'ACTIVE');
      await seed(userId);
      const deniedClient = await pool.connect();
      let refused = false;
      try {
        await deniedClient.query('BEGIN');
        await enrolCustomerInTransaction(deniedClient, {
          context: context(),
          now,
          user_id: userId,
        });
        await deniedClient.query('COMMIT');
      } catch (error: unknown) {
        await deniedClient.query('ROLLBACK');
        refused = error instanceof CustomerEnrolmentDeniedError;
      } finally {
        deniedClient.release();
      }
      check(refused, message);
      check(
        (await totalAssignments(pool, userId)) === 1,
        `${message} (a second assignment row was written)`,
      );
    };
    const seedAssignment = async (
      userId: UuidV7,
      state: string,
      validFrom: Date,
      validUntil: Date | null,
    ): Promise<void> => {
      const requestId = createUuidV7();
      // `role_assignment_revocation_shape` requires a revoked row to carry both a
      // revocation time and an uppercase reason code, so a REVOKED fixture has to
      // be shaped the way a real revocation is.
      const revoked = state === 'REVOKED';
      await pool.query(
        `INSERT INTO marketplace.role_assignments
         (role_assignment_id, user_id, role_key, state, valid_from, valid_until,
          revoked_at, revoke_reason, request_id, correlation_id)
         VALUES ($1,$2,'CUSTOMER',$3,$4,$5,$6,$7,$8,$8)`,
        [
          createUuidV7(),
          userId,
          state,
          validFrom,
          validUntil,
          revoked ? new Date(validFrom.getTime() + 3_600_000) : null,
          revoked ? 'SYNTH_ADMIN_REVOCATION' : null,
          requestId,
        ],
      );
    };
    await denied(
      (userId) => seedAssignment(userId, 'REVOKED', new Date(now.getTime() - 86_400_000), null),
      'A revoked customer role was restored by signing in again',
    );
    await denied(
      (userId) =>
        seedAssignment(
          userId,
          'ACTIVE',
          new Date(now.getTime() - 172_800_000),
          new Date(now.getTime() - 86_400_000),
        ),
      'An expired customer role was renewed by signing in again',
    );
    await denied(
      (userId) => seedAssignment(userId, 'ACTIVE', new Date(now.getTime() + 86_400_000), null),
      'A not-yet-valid customer role was activated early by signing in',
    );

    // 6. A disabled identity cannot enrol at all.
    const disabledUser = await createUser(pool, 'DISABLED');
    const disabledClient = await pool.connect();
    let disabledRefused = false;
    try {
      await disabledClient.query('BEGIN');
      await enrolCustomerInTransaction(disabledClient, {
        context: context(),
        now,
        user_id: disabledUser,
      });
      await disabledClient.query('COMMIT');
    } catch (error: unknown) {
      await disabledClient.query('ROLLBACK');
      disabledRefused = error instanceof CustomerEnrolmentDeniedError;
    } finally {
      disabledClient.release();
    }
    check(disabledRefused, 'A disabled identity was enrolled as a customer');
    check(
      (await activeAssignments(pool, disabledUser)) === 0,
      'A disabled identity received a customer role',
    );

    // 7. Enrolment grants CUSTOMER and nothing else. The privilege-escalation
    //    check: no vendor, partner or admin authority may appear from this path.
    const otherRoles = await pool.query<{ role_key: string }>(
      `SELECT DISTINCT role_key FROM marketplace.role_assignments
        WHERE user_id = ANY($1::uuid[]) AND role_key <> 'CUSTOMER'`,
      [[firstUser, racedUser, rollbackUser, disabledUser]],
    );
    check(otherRoles.rows.length === 0, 'Customer enrolment granted a role other than CUSTOMER');
  } finally {
    await pool.end();
  }
}
