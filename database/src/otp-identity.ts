import { createDatabasePool } from './database-pool.js';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import { transaction as withTransaction } from './transaction.js';

export type OtpProviderScenario = 'delay' | 'duplicate_callback' | 'failure' | 'success';
export type OtpChallengeStatus =
  'CONSUMED' | 'DELAYED' | 'DELIVERED' | 'EXPIRED' | 'FAILED' | 'LOCKED';

export interface OtpRequestResult {
  readonly challenge_id: UuidV7;
  readonly expires_at: string;
  readonly replayed: boolean;
  readonly status: OtpChallengeStatus;
}

export interface OtpVerifyResult {
  readonly challenge_id: UuidV7;
  readonly outcome: 'already_verified' | 'verified';
  readonly replayed: boolean;
}

export interface OtpVerificationInput {
  readonly challenge_id: string;
  readonly code: string;
  readonly context: RequestContext;
  readonly device_id: string;
  readonly now?: Date;
}

export interface OtpVerifiedIdentity {
  readonly challenge_id: UuidV7;
  readonly client: PoolClient;
  readonly device_id: UuidV7;
  readonly phone_lookup_hash: string;
  readonly verified_at: Date;
}

export class OtpRateLimitedError extends Error {
  readonly code = 'RATE_LIMITED';
}
export class OtpInvalidError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}
export class OtpUnavailableError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE';
}
export class OtpVerificationRejectedError extends Error {
  readonly code = 'UNAUTHENTICATED';
}

interface ChallengeRow {
  readonly challenge_id: string;
  readonly code_hash: string;
  readonly status: OtpChallengeStatus;
  readonly attempt_count: number;
  readonly max_attempts: number;
  readonly expires_at: Date;
  readonly phone_lookup_hash: string;
}

const PHONE_PATTERN = /^(?:\+[1-9][0-9]{7,14}|SYNTH-PHONE-[A-Z0-9][A-Z0-9-]{2,47})$/;
const REQUEST_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const CODE_PATTERN = /^[0-9]{6}$/;
const MAX_PHONE_REQUESTS = 3;
const MAX_DEVICE_REQUESTS = 5;
const RATE_WINDOW_MS = 15 * 60 * 1_000;
const RESEND_COOLDOWN_MS = 30_000;
const CHALLENGE_TTL_MS = 10 * 60 * 1_000;
const MAX_ATTEMPTS = 5;

function digest(key: string, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

/**
 * Normalises a phone identifier to its canonical stored form.
 *
 * Exported so the separator rule is directly testable: it is the difference
 * between every synthetic identity being able to sign in and none of them.
 */
export function normalisePhoneIdentifier(value: string): string {
  const trimmed = value.trim().toUpperCase();
  return trimmed.startsWith('SYNTH-PHONE-')
    ? trimmed.replace(/[\s()]/g, '')
    : trimmed.replace(/[\s()-]/g, '');
}

/**
 * Normalises and validates a phone identifier, or throws.
 *
 * Exported because more than sign-in needs to turn something a person typed
 * into the canonical identifier: staff invitations are addressed by phone,
 * since a shopkeeper knows their picker's number and cannot possibly know
 * their internal user id.
 */
export function parsePhoneIdentifier(value: string): string {
  return requirePhone(value);
}

function requirePhone(value: string): string {
  // Separator stripping is for E.164 only. Applied to everything it also
  // removed the hyphens from `SYNTH-PHONE-ADMIN-001`, producing
  // `SYNTHPHONEADMIN001`, which then failed the very pattern that admits the
  // synthetic form — so no seeded synthetic identity could ever request an OTP,
  // and the whole local sign-in path was unreachable.
  const normalized = normalisePhoneIdentifier(value);
  if (!PHONE_PATTERN.test(normalized)) {
    throw new OtpInvalidError('Phone number must use international E.164 format');
  }
  return normalized;
}

function requireRequestKey(value: string): string {
  if (!REQUEST_KEY_PATTERN.test(value)) throw new OtpInvalidError('OTP request key is invalid');
  return value;
}

function requireCode(value: string): string {
  if (!CODE_PATTERN.test(value)) throw new OtpInvalidError('OTP must contain exactly six digits');
  return value;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'hex');
  const rightBytes = Buffer.from(right, 'hex');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export class OtpIdentityService {
  readonly #pool: Pool;
  readonly #hashKey: string;
  readonly #codeGenerator: () => string;

  constructor(input: {
    readonly connection_string: string;
    readonly hash_key: string;
    readonly code_generator?: () => string;
  }) {
    if (input.hash_key.length < 32)
      throw new Error('OTP hash key must contain at least 32 characters');
    this.#hashKey = input.hash_key;
    this.#codeGenerator =
      input.code_generator ?? (() => randomInt(0, 1_000_000).toString().padStart(6, '0'));
    this.#pool = createDatabasePool({
      application_name: 'neighbourhood-store-otp-identity',
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

  async requestChallenge(input: {
    readonly context: RequestContext;
    readonly device_id: string;
    readonly phone_identifier: string;
    readonly request_key: string;
    readonly scenario?: OtpProviderScenario;
    readonly now?: Date;
  }): Promise<OtpRequestResult> {
    const phone = requirePhone(input.phone_identifier);
    const deviceId = parseUuidV7(input.device_id);
    const requestKey = requireRequestKey(input.request_key);
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    const scenario = input.scenario ?? 'success';
    const now = input.now ?? new Date();
    const phoneHash = digest(this.#hashKey, `phone:${phone}`);

    return withTransaction(this.#pool, async (client) => {
      for (const lock of [`device:${deviceId}`, `phone:${phoneHash}`].sort()) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lock]);
      }

      const replay = await client.query<ChallengeRow>(
        `SELECT challenge_id, code_hash, status, attempt_count, max_attempts, expires_at
           FROM marketplace.otp_challenges
          WHERE phone_lookup_hash = $1 AND purpose = 'SIGN_IN' AND request_key = $2`,
        [phoneHash, requestKey],
      );
      if (replay.rows[0]) {
        return Object.freeze({
          challenge_id: parseUuidV7(replay.rows[0].challenge_id),
          expires_at: replay.rows[0].expires_at.toISOString(),
          replayed: true,
          status: replay.rows[0].status,
        });
      }

      const limits = await client.query<{
        device_count: string;
        last_phone_at: Date | null;
        phone_count: string;
      }>(
        `SELECT
           count(*) FILTER (WHERE phone_lookup_hash = $1 AND created_at >= $3) AS phone_count,
           count(*) FILTER (WHERE device_id = $2 AND created_at >= $3) AS device_count,
           max(created_at) FILTER (WHERE phone_lookup_hash = $1) AS last_phone_at
         FROM marketplace.otp_challenges`,
        [phoneHash, deviceId, new Date(now.getTime() - RATE_WINDOW_MS)],
      );
      const limit = limits.rows[0];
      if (
        Number(limit?.phone_count ?? 0) >= MAX_PHONE_REQUESTS ||
        Number(limit?.device_count ?? 0) >= MAX_DEVICE_REQUESTS ||
        (limit?.last_phone_at && now.getTime() - limit.last_phone_at.getTime() < RESEND_COOLDOWN_MS)
      ) {
        throw new OtpRateLimitedError('OTP request rate limit reached');
      }

      const challengeId = createUuidV7({ now_ms: now.getTime() });
      const code = requireCode(this.#codeGenerator());
      const codeHash = digest(this.#hashKey, `code:${challengeId}:${code}`);
      const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
      const status: OtpChallengeStatus =
        scenario === 'failure' ? 'FAILED' : scenario === 'delay' ? 'DELAYED' : 'DELIVERED';
      const providerReference = `otp_fake_${challengeId.replaceAll('-', '')}`;

      await client.query(
        `INSERT INTO marketplace.otp_challenges
           (challenge_id, phone_lookup_hash, device_id, purpose, request_key, code_hash,
            status, provider_scenario, provider_reference, max_attempts, expires_at,
            request_id, correlation_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'SIGN_IN', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
        [
          challengeId,
          phoneHash,
          deviceId,
          requestKey,
          codeHash,
          status,
          scenario,
          providerReference,
          MAX_ATTEMPTS,
          expiresAt,
          requestId,
          correlationId,
          now,
        ],
      );

      if (status !== 'FAILED') {
        await client.query(
          `INSERT INTO marketplace.otp_protected_test_outbox
             (challenge_id, otp_code, expires_at, created_at)
           VALUES ($1, $2, $3, $4)`,
          [challengeId, code, expiresAt, now],
        );
      }

      const outcome =
        status === 'FAILED' ? 'failed' : status === 'DELAYED' ? 'delayed' : 'delivered';
      const providerEventId = `otp_evt_${challengeId.replaceAll('-', '')}`;
      const callbackCount = scenario === 'duplicate_callback' ? 2 : 1;
      for (let index = 0; index < callbackCount; index += 1) {
        await client.query(
          `INSERT INTO marketplace.otp_provider_events
             (provider_event_id, challenge_id, outcome, request_id, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (provider_event_id) DO NOTHING`,
          [providerEventId, challengeId, outcome, requestId, now],
        );
      }

      return Object.freeze({
        challenge_id: challengeId,
        expires_at: expiresAt.toISOString(),
        replayed: false,
        status,
      });
    });
  }

  async verifyChallenge(input: OtpVerificationInput): Promise<OtpVerifyResult> {
    const result = await this.verifyChallengeWithEffect(input, async () => undefined);
    return result.verification;
  }

  async verifyChallengeWithEffect<Effect>(
    input: OtpVerificationInput,
    effect: (identity: OtpVerifiedIdentity) => Promise<Effect>,
  ): Promise<{
    readonly effect: Effect | null;
    readonly verification: OtpVerifyResult;
  }> {
    const challengeId = parseUuidV7(input.challenge_id);
    const deviceId = parseUuidV7(input.device_id);
    const code = requireCode(input.code);
    const now = input.now ?? new Date();
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);

    const verification = await withTransaction<
      | { readonly effect: Effect | null; readonly verification: OtpVerifyResult }
      | { readonly rejected: 'expired' | 'incorrect' }
    >(this.#pool, async (client) => {
      const result = await client.query<ChallengeRow & { device_id: string }>(
        `SELECT challenge_id, code_hash, status, attempt_count, max_attempts, expires_at,
                device_id, phone_lookup_hash
           FROM marketplace.otp_challenges WHERE challenge_id = $1 FOR UPDATE`,
        [challengeId],
      );
      const challenge = result.rows[0];
      if (!challenge || challenge.device_id !== deviceId) {
        throw new OtpVerificationRejectedError('OTP challenge is invalid');
      }
      if (challenge.status === 'CONSUMED') {
        return Object.freeze({
          effect: null,
          verification: Object.freeze({
            challenge_id: challengeId,
            outcome: 'already_verified' as const,
            replayed: true,
          }),
        });
      }
      if (challenge.status === 'FAILED' || challenge.status === 'DELAYED') {
        throw new OtpUnavailableError('OTP delivery is not available');
      }
      if (challenge.status === 'LOCKED' || challenge.status === 'EXPIRED') {
        throw new OtpVerificationRejectedError('OTP challenge is no longer valid');
      }
      if (now.getTime() >= challenge.expires_at.getTime()) {
        await client.query(
          `UPDATE marketplace.otp_challenges SET status = 'EXPIRED', updated_at = $2
            WHERE challenge_id = $1`,
          [challengeId, now],
        );
        await client.query(
          'DELETE FROM marketplace.otp_protected_test_outbox WHERE challenge_id = $1',
          [challengeId],
        );
        await client.query(
          `INSERT INTO marketplace.otp_verification_attempts
             (attempt_id, challenge_id, attempt_number, outcome, request_id, correlation_id, occurred_at)
           VALUES ($1, $2, $3, 'EXPIRED', $4, $5, $6)`,
          [
            createUuidV7({ now_ms: now.getTime() }),
            challengeId,
            challenge.attempt_count + 1,
            requestId,
            correlationId,
            now,
          ],
        );
        return { rejected: 'expired' as const };
      }

      const submittedHash = digest(this.#hashKey, `code:${challengeId}:${code}`);
      if (!constantTimeEqual(challenge.code_hash, submittedHash)) {
        const attempts = challenge.attempt_count + 1;
        const locked = attempts >= challenge.max_attempts;
        await client.query(
          `UPDATE marketplace.otp_challenges
              SET attempt_count = $2, status = CASE WHEN $3 THEN 'LOCKED' ELSE status END,
                  updated_at = $4
            WHERE challenge_id = $1`,
          [challengeId, attempts, locked, now],
        );
        await client.query(
          `INSERT INTO marketplace.otp_verification_attempts
             (attempt_id, challenge_id, attempt_number, outcome, request_id, correlation_id, occurred_at)
           VALUES ($1, $2, $3, 'WRONG', $4, $5, $6)`,
          [
            createUuidV7({ now_ms: now.getTime() }),
            challengeId,
            attempts,
            requestId,
            correlationId,
            now,
          ],
        );
        if (locked) {
          await client.query(
            'DELETE FROM marketplace.otp_protected_test_outbox WHERE challenge_id = $1',
            [challengeId],
          );
        }
        return { rejected: 'incorrect' as const };
      }

      const effectResult = await effect(
        Object.freeze({
          challenge_id: challengeId,
          client,
          device_id: deviceId,
          phone_lookup_hash: challenge.phone_lookup_hash,
          verified_at: now,
        }),
      );

      await client.query(
        `UPDATE marketplace.otp_challenges
            SET status = 'CONSUMED', consumed_at = $2, updated_at = $2
          WHERE challenge_id = $1`,
        [challengeId, now],
      );
      await client.query(
        `INSERT INTO marketplace.otp_verification_attempts
           (attempt_id, challenge_id, attempt_number, outcome, request_id, correlation_id, occurred_at)
         VALUES ($1, $2, $3, 'VERIFIED', $4, $5, $6)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          challengeId,
          challenge.attempt_count + 1,
          requestId,
          correlationId,
          now,
        ],
      );
      await client.query(
        'DELETE FROM marketplace.otp_protected_test_outbox WHERE challenge_id = $1',
        [challengeId],
      );
      return Object.freeze({
        effect: effectResult,
        verification: Object.freeze({
          challenge_id: challengeId,
          outcome: 'verified' as const,
          replayed: false,
        }),
      });
    });
    if ('rejected' in verification) {
      throw new OtpVerificationRejectedError(
        verification.rejected === 'expired'
          ? 'OTP challenge has expired'
          : 'OTP verification failed',
      );
    }
    return verification;
  }

  async readSyntheticOtpForTest(challengeId: string): Promise<string> {
    const result = await this.#pool.query<{ otp_code: string }>(
      `SELECT otp_code FROM marketplace.otp_protected_test_outbox
        WHERE challenge_id = $1 AND expires_at > clock_timestamp()`,
      [parseUuidV7(challengeId)],
    );
    if (!result.rows[0]) throw new Error('Synthetic OTP is unavailable');
    return result.rows[0].otp_code;
  }

  async metrics(): Promise<Readonly<Record<string, number>>> {
    const result = await this.#pool.query<{
      delivered: string;
      failed: string;
      locked: string;
      verified: string;
      wrong_attempts: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE status = 'DELIVERED') AS delivered,
         count(*) FILTER (WHERE status = 'FAILED') AS failed,
         count(*) FILTER (WHERE status = 'LOCKED') AS locked,
         count(*) FILTER (WHERE status = 'CONSUMED') AS verified,
         (SELECT count(*) FROM marketplace.otp_verification_attempts WHERE outcome = 'WRONG') AS wrong_attempts
       FROM marketplace.otp_challenges`,
    );
    const row = result.rows[0];
    return Object.freeze({
      delivered: Number(row?.delivered ?? 0),
      failed: Number(row?.failed ?? 0),
      locked: Number(row?.locked ?? 0),
      verified: Number(row?.verified ?? 0),
      wrong_attempts: Number(row?.wrong_attempts ?? 0),
    });
  }
}
