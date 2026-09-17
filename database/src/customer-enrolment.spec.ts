import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { createRequestContext, createUuidV7 } from '@neighbourhood-store/domain-types';
import { OtpIdentityService } from './otp-identity.js';
import { IdentitySessionService } from './identity-sessions.js';
import { CustomerEnrolmentDeniedError, enrolCustomerInTransaction } from './customer-enrolment.js';

// Transaction-boundary unit tests. No socket, migration, provider or shared DB.
function fixture(
  t: TestContext,
  options: {
    role?: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'FUTURE';
    failGrant?: boolean;
    consumed?: boolean;
    disabled?: boolean;
    existing?: boolean;
  } = {},
) {
  const now = new Date('2026-09-07T10:00:00Z');
  const userId = createUuidV7();
  const roleId = createUuidV7();
  const challengeId = createUuidV7();
  const deviceId = createUuidV7();
  const statements: string[] = [];
  const values: unknown[][] = [];
  const hashKey = 'unit-only-hash-key-material-not-an-account-key';
  const client = {
    release: () => undefined,
    query: async (sql: string, parameters: unknown[] = []) => {
      statements.push(sql);
      values.push(parameters);
      if (sql.includes('FROM marketplace.otp_challenges'))
        return {
          rows: [
            {
              challenge_id: challengeId,
              device_id: deviceId,
              status: options.consumed ? 'CONSUMED' : 'DELIVERED',
              code_hash: createHmac('sha256', hashKey)
                .update(`code:${challengeId}:123456`)
                .digest('hex'),
              attempt_count: 0,
              max_attempts: 5,
              expires_at: new Date(now.getTime() + 600_000),
              phone_lookup_hash: 'phone-hash',
            },
          ],
        };
      if (sql.includes('SELECT user_id FROM marketplace.phone_identities'))
        return { rows: options.existing === false ? [] : [{ user_id: userId }] };
      if (sql.includes("SELECT state = 'ACTIVE'")) return { rows: [{ active: !options.disabled }] };
      if (sql.includes('SELECT state FROM marketplace.users'))
        return { rows: [{ state: options.disabled ? 'DISABLED' : 'ACTIVE' }] };
      if (sql.includes('FROM marketplace.role_assignments'))
        return {
          rows: options.role
            ? [
                {
                  role_assignment_id: roleId,
                  state: options.role === 'REVOKED' ? 'REVOKED' : 'ACTIVE',
                  valid_from: new Date(now.getTime() + (options.role === 'FUTURE' ? 1000 : -1000)),
                  valid_until: options.role === 'EXPIRED' ? new Date(now.getTime() - 1) : null,
                },
              ]
            : [],
        };
      if (sql.includes('INSERT INTO marketplace.role_assignments') && options.failGrant)
        throw new Error('Injected membership persistence outage');
      return { rows: [] };
    },
  } as unknown as PoolClient;
  const connect = t.mock.method(Pool.prototype, 'connect', async () => client);
  const otp = new OtpIdentityService({
    connection_string: 'postgresql://unused.invalid/never-connected',
    hash_key: hashKey,
  });
  const sessions = new IdentitySessionService({
    connection_string: 'postgresql://unused.invalid/never-connected',
    otp_service: otp,
    token_hash_key: 'unit-only-session-key-not-an-account-key',
  });
  t.after(async () => {
    await sessions.close();
    await otp.close();
  });
  const input = {
    challenge_id: challengeId,
    device_id: deviceId,
    context: createRequestContext(),
    code: '123456',
    now,
    platform: 'WEB' as const,
    customer_enrolment: true,
  };
  return { client, connect, input, roleId, sessions, statements, userId, values };
}

test('first-time customer session, role/audit and OTP consumption share one transaction', async (t) => {
  const f = fixture(t, { existing: false });
  const result = await f.sessions.completeOtpSignIn(f.input);
  assert.equal(result.outcome, 'verified');
  assert.ok('customer_enrolled' in result && result.customer_enrolled);
  assert.equal(f.connect.mock.callCount(), 1);
  assert.equal(f.statements[0], 'BEGIN');
  assert.equal(f.statements.at(-1), 'COMMIT');
  const grant = f.statements.findIndex((sql) =>
    sql.includes('INSERT INTO marketplace.role_assignments'),
  );
  const consumed = f.statements.findIndex((sql) => sql.includes("SET status = 'CONSUMED'"));
  assert.ok(grant > 0 && consumed > grant);
  assert.ok(
    f.statements.some((sql) => sql.includes('INSERT INTO marketplace.access_membership_events')),
  );
  assert.ok(!JSON.stringify(f.values).includes(result.tokens?.access_token ?? 'unreachable'));
  assert.ok(!JSON.stringify(f.values).includes(result.tokens?.refresh_token ?? 'unreachable'));
});

test('membership failure rolls back instead of consuming the challenge or returning tokens', async (t) => {
  const f = fixture(t, { failGrant: true });
  await assert.rejects(f.sessions.completeOtpSignIn(f.input), /persistence outage/);
  assert.equal(f.statements.at(-1), 'ROLLBACK');
  assert.ok(!f.statements.includes('COMMIT'));
  assert.ok(!f.statements.some((sql) => sql.includes("SET status = 'CONSUMED'")));
});

test('an existing active customer is idempotently enrolled without another grant', async (t) => {
  const f = fixture(t, { role: 'ACTIVE' });
  const id = await enrolCustomerInTransaction(f.client, {
    context: f.input.context,
    user_id: f.userId,
    now: f.input.now,
  });
  assert.equal(id, f.roleId);
  assert.ok(!f.statements.some((sql) => sql.startsWith('INSERT')));
});

for (const role of ['REVOKED', 'EXPIRED', 'FUTURE'] as const) {
  test(`${role} customer membership is not restored by a valid OTP`, async (t) => {
    const f = fixture(t, { role });
    await assert.rejects(f.sessions.completeOtpSignIn(f.input), CustomerEnrolmentDeniedError);
    assert.equal(f.statements.at(-1), 'ROLLBACK');
    assert.ok(
      !f.statements.some((sql) => sql.includes('INSERT INTO marketplace.role_assignments')),
    );
  });
}

test('disabled identities cannot self-enrol', async (t) => {
  const f = fixture(t, { disabled: true });
  await assert.rejects(
    enrolCustomerInTransaction(f.client, {
      context: f.input.context,
      user_id: f.userId,
      now: f.input.now,
    }),
    CustomerEnrolmentDeniedError,
  );
});

test('a consumed OTP never replays bearer tokens or enrols again, including lost-response retries', async (t) => {
  const f = fixture(t, { consumed: true });
  assert.deepEqual(await f.sessions.completeOtpSignIn(f.input), {
    outcome: 'already_verified',
    replayed: true,
    tokens: null,
  });
  assert.ok(!f.statements.some((sql) => sql.startsWith('INSERT')));
});

test('generic role sign-in does not implicitly enrol a customer', async (t) => {
  const f = fixture(t);
  const result = await f.sessions.completeOtpSignIn({ ...f.input, customer_enrolment: false });
  assert.ok('customer_enrolled' in result && !result.customer_enrolled);
  assert.ok(!f.statements.some((sql) => sql.includes('marketplace.role_assignments')));
});
