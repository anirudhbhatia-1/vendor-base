/**
 * Bootstrap a first admin so the admin PWA can be used after a fresh `db:reset:data`.
 *
 * Reads:
 *   ADMIN_PHONE     required, must match /^SYNTH-PHONE-[A-Z0-9-]{4,50}$/
 *   ADMIN_PASSWORD  optional, sets a scrypt password credential (>= 8 chars)
 *   DATABASE_URL    optional, defaults to the local Postgres URL
 *   OTP_HASH_KEY    optional, defaults to the shared local key so the phone
 *                   hash matches what the OTP flow expects
 *
 * Grants: SUPPORT_AGENT + CONFIG_APPROVER at global scope. Idempotent.
 *
 * Example:
 *   ADMIN_PHONE=SYNTH-PHONE-ADMIN-001 ADMIN_PASSWORD=change-me pnpm db:seed:admin
 */
import { createHmac, randomBytes, scrypt as scryptSync } from 'node:crypto';
import { promisify } from 'node:util';
import { Client } from 'pg';
import {
  createUuidV7,
  createRequestContext,
  createAuthenticatedActor,
} from '@neighbourhood-store/domain-types';

const scrypt = promisify(scryptSync) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options?: { N?: number; r?: number; p?: number },
) => Promise<Buffer>;

const SYNTH_PHONE = /^SYNTH-PHONE-[A-Z0-9][A-Z0-9-]{2,47}$/;
const HASH_KEY_MIN = 32;
const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 64 } as const;

const phone = process.env['ADMIN_PHONE'];
if (!phone || !SYNTH_PHONE.test(phone)) {
  console.error('ADMIN_PHONE must match SYNTH-PHONE-* (e.g. SYNTH-PHONE-ADMIN-001)');
  process.exit(1);
}
const password = process.env['ADMIN_PASSWORD'];
if (password !== undefined && password.length < 8) {
  console.error('ADMIN_PASSWORD, when set, must be at least 8 characters');
  process.exit(1);
}

const databaseUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://marketplace_local:marketplace_local_only@127.0.0.1:5432/neighbourhood_store_local';
const hashKey =
  process.env['OTP_HASH_KEY'] ??
  ['local', 'synthetic', 'otp', 'hash', 'material', 'only'].join('-');
if (hashKey.length < HASH_KEY_MIN) {
  console.error(`OTP_HASH_KEY must be at least ${HASH_KEY_MIN} characters`);
  process.exit(1);
}

const phoneHash = createHmac('sha256', hashKey).update(`phone:${phone}`).digest('hex');
const now = new Date();
const oneYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000);

const context = createRequestContext();
const requestId = context.request_id;
const correlationId = context.correlation_id;

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query('BEGIN');

  // 1. User + phone identity (idempotent lookup by phone hash).
  const existingIdentity = await client.query<{ user_id: string }>(
    'SELECT user_id FROM marketplace.phone_identities WHERE phone_lookup_hash = $1',
    [phoneHash],
  );
  let userId: string;
  if (existingIdentity.rows[0]) {
    userId = existingIdentity.rows[0].user_id;
    console.log(`Found existing user ${userId} for ${phone}`);
  } else {
    userId = createUuidV7({ now_ms: now.getTime() });
    await client.query(
      `INSERT INTO marketplace.users (user_id, retention_review_at, created_at, updated_at)
       VALUES ($1, $2, $3, $3)`,
      [userId, oneYear, now],
    );
    await client.query(
      `INSERT INTO marketplace.phone_identities
         (phone_identity_id, user_id, phone_lookup_hash, retention_review_at,
          verified_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5, $5)`,
      [createUuidV7({ now_ms: now.getTime() }), userId, phoneHash, oneYear, now],
    );
    console.log(`Created user ${userId} for ${phone}`);
  }

  // 2. Optional password credential.
  if (password) {
    const salt = randomBytes(32);
    const hash = await scrypt(password, salt, SCRYPT.keylen, {
      N: SCRYPT.N,
      r: SCRYPT.r,
      p: SCRYPT.p,
    });
    const parameters = JSON.stringify(SCRYPT);
    await client.query(
      `INSERT INTO marketplace.password_credentials
         (user_id, algorithm, parameters, hash, salt, version, set_by_user_id,
          request_id, correlation_id, retention_review_at, created_at, updated_at)
       VALUES ($1, 'scrypt', $2::jsonb, $3, $4, 1, $1, $5, $6, $7, $8, $8)
       ON CONFLICT (user_id) DO UPDATE SET
         parameters = EXCLUDED.parameters,
         hash = EXCLUDED.hash,
         salt = EXCLUDED.salt,
         version = marketplace.password_credentials.version + 1,
         updated_at = EXCLUDED.updated_at`,
      [userId, parameters, hash, salt, requestId, correlationId, oneYear, now],
    );
    // Fetch resulting version to emit the credential event.
    const versionRow = await client.query<{ version: number }>(
      'SELECT version FROM marketplace.password_credentials WHERE user_id = $1',
      [userId],
    );
    const version = versionRow.rows[0]?.version ?? 1;
    await client.query(
      `INSERT INTO marketplace.password_credential_events
         (event_id, user_id, event_type, resulting_version, actor_user_id, reason_code,
          request_id, correlation_id, occurred_at)
       VALUES ($1, $2, $3, $4, $2, 'BOOTSTRAP_ADMIN', $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [
        createUuidV7({ now_ms: now.getTime() }),
        userId,
        version === 1 ? 'SET' : 'ROTATED',
        version,
        requestId,
        correlationId,
        now,
      ],
    );
    console.log(`Password credential written (version ${version})`);
  }

  // 3. Admin role assignments — SUPPORT_AGENT + CONFIG_APPROVER at global scope.
  //    granted_by_user_id is left NULL because this is the bootstrap admin;
  //    subsequent grants must go through IdentityAccessService.grantAdminMembership.
  for (const role of ['SUPPORT_AGENT', 'CONFIG_APPROVER'] as const) {
    const existing = await client.query<{ role_assignment_id: string }>(
      `SELECT role_assignment_id FROM marketplace.role_assignments
        WHERE user_id = $1 AND role_key = $2 AND state = 'ACTIVE'`,
      [userId, role],
    );
    if (existing.rows[0]) {
      console.log(
        `Role ${role} already granted (assignment ${existing.rows[0].role_assignment_id})`,
      );
      continue;
    }
    const roleAssignmentId = createUuidV7({ now_ms: now.getTime() });
    await client.query(
      `INSERT INTO marketplace.role_assignments
         (role_assignment_id, user_id, role_key, valid_from, granted_by_user_id,
          request_id, correlation_id, retention_review_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $4, $4)`,
      [roleAssignmentId, userId, role, now, requestId, correlationId, oneYear],
    );
    await client.query(
      `INSERT INTO marketplace.admin_membership_scopes
         (admin_membership_scope_id, role_assignment_id, user_id, scope_kind, scope_id, created_at)
       VALUES ($1, $2, $3, 'GLOBAL', NULL, $4)`,
      [createUuidV7({ now_ms: now.getTime() }), roleAssignmentId, userId, now],
    );
    await client.query(
      `INSERT INTO marketplace.access_membership_events
         (event_id, user_id, role_assignment_id, event_type, reason_code,
          request_id, correlation_id, occurred_at)
       VALUES ($1, $2, $3, 'ROLE_GRANTED', 'BOOTSTRAP_ADMIN', $4, $5, $6)`,
      [
        createUuidV7({ now_ms: now.getTime() }),
        userId,
        roleAssignmentId,
        requestId,
        correlationId,
        now,
      ],
    );
    console.log(`Granted ${role} (assignment ${roleAssignmentId})`);
  }

  await client.query('COMMIT');
  console.log(`\nBootstrap complete. Sign in as:`);
  console.log(`  Phone:    ${phone}`);
  console.log(`  User ID:  ${userId}`);
  console.log(`  Roles:    SUPPORT_AGENT, CONFIG_APPROVER (both global)`);
  console.log(
    `  Login:    OTP always works; ${password ? 'password login is also armed' : 'no password (OTP-only)'}.`,
  );
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error('Bootstrap failed:', error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await client.end();
}

// Reference-only shim so unused import warnings never mask a real issue.
void createAuthenticatedActor;
