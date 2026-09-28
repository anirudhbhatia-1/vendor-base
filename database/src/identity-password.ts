import { releaseServicePool, resolveServicePool } from './database-pool.js';
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import { transaction } from './transaction.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options?: { N?: number; r?: number; p?: number; maxmem?: number },
) => Promise<Buffer>;

const SCRYPT_PARAMETERS = Object.freeze({ N: 16_384, r: 8, p: 1, keylen: 64 });
const SALT_BYTES = 32;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const MAX_ATTEMPTS_PER_WINDOW = 5;
const RATE_WINDOW_MS = 15 * 60 * 1_000;

export class PasswordInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}

export class PasswordAuthenticationError extends Error {
  readonly code = 'UNAUTHENTICATED';
}

export class PasswordRateLimitedError extends Error {
  readonly code = 'RATE_LIMITED';
}

export type PasswordAttemptOutcome =
  'SUCCESS' | 'INVALID_PASSWORD' | 'USER_NOT_FOUND' | 'RATE_LIMITED';

interface StoredCredential {
  readonly hash: Buffer;
  readonly salt: Buffer;
  readonly parameters: { N: number; r: number; p: number; keylen: number };
  readonly version: number;
}

function requirePassword(value: string): string {
  if (typeof value !== 'string') throw new PasswordInputError('Password must be a string');
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordInputError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordInputError(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }
  return value;
}

function digest(hashKey: string, value: string): string {
  return createHmac('sha256', hashKey).update(value).digest('hex');
}

export class IdentityPasswordService {
  readonly #pool: Pool;
  readonly #hashKey: string;

  constructor(input: {
    readonly connection_string: string;
    readonly pool?: Pool;
    readonly hash_key: string;
  }) {
    if (input.hash_key.length < 32) {
      throw new PasswordInputError('Password hash key must contain at least 32 characters');
    }
    this.#hashKey = input.hash_key;
    this.#pool = resolveServicePool(input, {
      application_name: 'neighbourhood-store-identity-password',
      connectionTimeoutMillis: 5_000,
      max: 8,
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
  }

  async close(): Promise<void> {
    await releaseServicePool(this.#pool);
  }

  /**
   * Called from within another transaction (e.g. admin provisioning) to set a
   * user's initial password. When client is supplied the caller owns the
   * transaction; otherwise this opens its own.
   */
  async setInitialPassword(
    input: {
      readonly context: RequestContext;
      readonly user_id: UuidV7;
      readonly actor_user_id: UuidV7;
      readonly password: string;
      readonly reason_code?: string;
      readonly now?: Date;
    },
    client?: PoolClient,
  ): Promise<void> {
    const password = requirePassword(input.password);
    const now = input.now ?? new Date();
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    const salt = randomBytes(SALT_BYTES);
    const hash = await scryptAsync(password, salt, SCRYPT_PARAMETERS.keylen, {
      N: SCRYPT_PARAMETERS.N,
      r: SCRYPT_PARAMETERS.r,
      p: SCRYPT_PARAMETERS.p,
    });
    const parameters = JSON.stringify(SCRYPT_PARAMETERS);
    const retentionReviewAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000);
    const run = async (c: PoolClient) => {
      await c.query(
        `INSERT INTO marketplace.password_credentials
           (user_id, algorithm, parameters, hash, salt, version, set_by_user_id,
            request_id, correlation_id, retention_review_at, created_at, updated_at)
         VALUES ($1, 'scrypt', $2::jsonb, $3, $4, 1, $5, $6, $7, $8, $9, $9)
         ON CONFLICT (user_id) DO UPDATE SET
           parameters = EXCLUDED.parameters,
           hash = EXCLUDED.hash,
           salt = EXCLUDED.salt,
           version = marketplace.password_credentials.version + 1,
           set_by_user_id = EXCLUDED.set_by_user_id,
           request_id = EXCLUDED.request_id,
           correlation_id = EXCLUDED.correlation_id,
           updated_at = EXCLUDED.updated_at`,
        [
          parseUuidV7(input.user_id),
          parameters,
          hash,
          salt,
          parseUuidV7(input.actor_user_id),
          requestId,
          correlationId,
          retentionReviewAt,
          now,
        ],
      );
      const versionRow = await c.query<{ version: number }>(
        'SELECT version FROM marketplace.password_credentials WHERE user_id = $1',
        [parseUuidV7(input.user_id)],
      );
      const version = versionRow.rows[0]?.version ?? 1;
      await c.query(
        `INSERT INTO marketplace.password_credential_events
           (event_id, user_id, event_type, resulting_version, actor_user_id, reason_code,
            request_id, correlation_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          parseUuidV7(input.user_id),
          version === 1 ? 'SET' : 'ROTATED',
          version,
          parseUuidV7(input.actor_user_id),
          input.reason_code ?? (version === 1 ? 'INITIAL_SET' : 'ROTATION'),
          requestId,
          correlationId,
          now,
        ],
      );
    };
    if (client) {
      await run(client);
    } else {
      await transaction(this.#pool, run);
    }
  }

  /**
   * Verify a phone+password pair. Returns the user_id on success. Applies a
   * short rolling rate limit per phone_lookup_hash.
   */
  async verify(input: {
    readonly context: RequestContext;
    readonly phone_identifier: string;
    readonly password: string;
    readonly now?: Date;
  }): Promise<UuidV7> {
    const phoneHash = digest(this.#hashKey, `phone:${input.phone_identifier}`);
    const now = input.now ?? new Date();
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    return transaction(this.#pool, async (client) => {
      const attempts = await client.query<{ recent: number }>(
        `SELECT count(*)::int AS recent FROM marketplace.password_verification_attempts
          WHERE phone_lookup_hash = $1 AND attempted_at >= $2
            AND outcome IN ('INVALID_PASSWORD','USER_NOT_FOUND')`,
        [phoneHash, new Date(now.getTime() - RATE_WINDOW_MS)],
      );
      if ((attempts.rows[0]?.recent ?? 0) >= MAX_ATTEMPTS_PER_WINDOW) {
        await this.#record(client, phoneHash, 'RATE_LIMITED', requestId, correlationId, now);
        throw new PasswordRateLimitedError('Too many recent password attempts');
      }
      const lookup = await client.query<{ user_id: string }>(
        `SELECT pi.user_id FROM marketplace.phone_identities pi
          WHERE pi.phone_lookup_hash = $1`,
        [phoneHash],
      );
      if (!lookup.rows[0]) {
        await this.#record(client, phoneHash, 'USER_NOT_FOUND', requestId, correlationId, now);
        throw new PasswordAuthenticationError('Invalid credentials');
      }
      const userId = parseUuidV7(lookup.rows[0].user_id);
      const credential = await client.query<{
        hash: Buffer;
        salt: Buffer;
        parameters: StoredCredential['parameters'];
      }>(`SELECT hash, salt, parameters FROM marketplace.password_credentials WHERE user_id = $1`, [
        userId,
      ]);
      const row = credential.rows[0];
      if (!row) {
        await this.#record(client, phoneHash, 'USER_NOT_FOUND', requestId, correlationId, now);
        throw new PasswordAuthenticationError('Invalid credentials');
      }
      const submitted = await scryptAsync(
        input.password,
        Buffer.from(row.salt),
        row.parameters.keylen,
        {
          N: row.parameters.N,
          r: row.parameters.r,
          p: row.parameters.p,
        },
      );
      const stored = Buffer.from(row.hash);
      const matches = submitted.length === stored.length && timingSafeEqual(submitted, stored);
      if (!matches) {
        await this.#record(client, phoneHash, 'INVALID_PASSWORD', requestId, correlationId, now);
        throw new PasswordAuthenticationError('Invalid credentials');
      }
      await this.#record(client, phoneHash, 'SUCCESS', requestId, correlationId, now);
      return userId;
    });
  }

  async #record(
    client: PoolClient,
    phoneHash: string,
    outcome: PasswordAttemptOutcome,
    requestId: string,
    correlationId: string,
    now: Date,
  ) {
    await client.query(
      `INSERT INTO marketplace.password_verification_attempts
         (attempt_id, phone_lookup_hash, outcome, request_id, correlation_id, attempted_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [createUuidV7({ now_ms: now.getTime() }), phoneHash, outcome, requestId, correlationId, now],
    );
  }
}
