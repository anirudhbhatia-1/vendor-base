import { createDatabasePool } from './database-pool.js';
import { enrolCustomerInTransaction } from './customer-enrolment.js';
import { createHmac, randomBytes } from 'node:crypto';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import {
  OtpIdentityService,
  type OtpVerificationInput,
  type OtpVerifiedIdentity,
} from './otp-identity.js';
import { transaction } from './transaction.js';

export type DevicePlatform = 'ANDROID' | 'WEB';

export interface SessionTokens {
  readonly access_expires_at: string;
  readonly access_token: string;
  readonly refresh_expires_at: string;
  readonly refresh_token: string;
  readonly session_id: UuidV7;
  readonly user_id: UuidV7;
}

export interface SessionPrincipal {
  readonly client_device_id: UuidV7;
  readonly device_registration_id: UuidV7;
  readonly session_id: UuidV7;
  readonly user_id: UuidV7;
}

export interface SessionSummary extends SessionPrincipal {
  readonly access_expires_at: string | null;
  readonly created_at: string;
  readonly current: boolean;
  readonly device_label: string | null;
  readonly platform: DevicePlatform;
  readonly state: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
}

export class SessionInvalidError extends Error {
  readonly code = 'UNAUTHENTICATED';
}
export class SessionReplayDetectedError extends Error {
  readonly code = 'UNAUTHENTICATED';
}
export class SessionForbiddenError extends Error {
  readonly code = 'FORBIDDEN';
}
export class SessionInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}

interface SessionRow {
  readonly access_expires_at: Date | null;
  readonly client_device_id: string;
  readonly device_registration_id: string;
  readonly refresh_expires_at: Date | null;
  readonly session_id: string;
  readonly state: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  readonly user_id: string;
  readonly version: number;
}

interface RefreshRow extends SessionRow {
  readonly refresh_status: 'ACTIVE' | 'REVOKED' | 'ROTATED';
  readonly refresh_token_id: string;
  readonly token_expires_at: Date;
}

const ACCESS_TOKEN_PATTERN = /^nsa_[A-Za-z0-9_-]{43}$/;
const REFRESH_TOKEN_PATTERN = /^nsr_[A-Za-z0-9_-]{43}$/;
const NOTIFICATION_TOKEN_PATTERN = /^[A-Za-z0-9._~:-]{16,512}$/;
const ACCESS_TTL_MS = 15 * 60 * 1_000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function tokenDigest(key: string, token: string): string {
  return createHmac('sha256', key).update(token).digest('hex');
}

function requireAccessToken(value: string): string {
  if (!ACCESS_TOKEN_PATTERN.test(value)) throw new SessionInvalidError('Access token is invalid');
  return value;
}

function requireRefreshToken(value: string): string {
  if (!REFRESH_TOKEN_PATTERN.test(value)) throw new SessionInvalidError('Refresh token is invalid');
  return value;
}

function requirePlatform(value: string): DevicePlatform {
  if (value !== 'WEB' && value !== 'ANDROID') throw new SessionInputError('Platform is invalid');
  return value;
}

function safeLabel(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim() === '') return null;
  const normalized = value.trim();
  const containsControl = Array.from(normalized).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (normalized.length > 80 || containsControl) {
    throw new SessionInputError('Device label is invalid');
  }
  return normalized;
}

function requireNotificationToken(value: string): string {
  if (!NOTIFICATION_TOKEN_PATTERN.test(value)) {
    throw new SessionInputError('Notification token is invalid');
  }
  return value;
}

function principal(row: SessionRow): SessionPrincipal {
  return Object.freeze({
    client_device_id: parseUuidV7(row.client_device_id),
    device_registration_id: parseUuidV7(row.device_registration_id),
    session_id: parseUuidV7(row.session_id),
    user_id: parseUuidV7(row.user_id),
  });
}

export class IdentitySessionService {
  readonly #otp: OtpIdentityService;
  readonly #pool: Pool;
  readonly #tokenHashKey: string;
  readonly #tokenGenerator: () => string;

  constructor(input: {
    readonly connection_string: string;
    readonly otp_service: OtpIdentityService;
    readonly token_hash_key: string;
    readonly token_generator?: () => string;
  }) {
    if (input.token_hash_key.length < 32) {
      throw new Error('Session token hash key must contain at least 32 characters');
    }
    this.#otp = input.otp_service;
    this.#tokenHashKey = input.token_hash_key;
    this.#tokenGenerator = input.token_generator ?? (() => randomBytes(32).toString('base64url'));
    this.#pool = createDatabasePool({
      application_name: 'neighbourhood-store-identity-sessions',
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

  #newToken(prefix: 'nsa' | 'nsr'): string {
    const material = this.#tokenGenerator();
    if (!/^[A-Za-z0-9_-]{43}$/.test(material)) {
      throw new Error('Session token generator returned invalid material');
    }
    return `${prefix}_${material}`;
  }

  async bindSupabaseSession(input: {
    readonly context: RequestContext;
    readonly external_session_id: string;
    readonly user_id: UuidV7;
    readonly now?: Date;
  }): Promise<SessionPrincipal> {
    if (!UUID_PATTERN.test(input.external_session_id)) {
      throw new SessionInvalidError('Supabase session identifier is invalid');
    }
    const userId = parseUuidV7(input.user_id);
    const now = input.now ?? new Date();
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    return transaction(this.#pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `supabase-session:${input.external_session_id}`,
      ]);
      const found = await client.query<SessionRow & { readonly user_state: string }>(
        `SELECT s.session_id, s.user_id, s.device_registration_id, d.client_device_id,
                s.state, s.version, s.access_expires_at, s.refresh_expires_at,
                u.state AS user_state
           FROM marketplace.sessions s
           JOIN marketplace.devices d USING (device_registration_id)
           JOIN marketplace.users u ON u.user_id=s.user_id
          WHERE s.external_supabase_session_id = $1
          FOR UPDATE OF s`,
        [input.external_session_id],
      );
      const existing = found.rows[0];
      if (existing) {
        if (
          existing.user_id !== userId ||
          existing.state !== 'ACTIVE' ||
          existing.user_state !== 'ACTIVE'
        ) {
          throw new SessionForbiddenError('Supabase session is not active for this identity');
        }
        await client.query(
          `UPDATE marketplace.devices
              SET last_seen_at = $2, updated_at = $2
            WHERE device_registration_id = $1`,
          [existing.device_registration_id, now],
        );
        return principal(existing);
      }

      const active = await client.query<{ active: boolean }>(
        `SELECT state = 'ACTIVE' AS active FROM marketplace.users WHERE user_id = $1`,
        [userId],
      );
      if (!active.rows[0]?.active) throw new SessionForbiddenError('Identity is disabled');

      const clientDeviceId = createUuidV7({ now_ms: now.getTime() });
      const deviceRegistrationId = createUuidV7({ now_ms: now.getTime() });
      const sessionId = createUuidV7({ now_ms: now.getTime() });
      await client.query(
        `INSERT INTO marketplace.devices
           (device_registration_id, user_id, client_device_id, platform, device_label,
            notification_state, last_seen_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'WEB', 'Supabase web session', 'NONE', $4, $4, $4)`,
        [deviceRegistrationId, userId, clientDeviceId, now],
      );
      await client.query(
        `INSERT INTO marketplace.sessions
           (session_id, token_family_id, user_id, device_registration_id, otp_challenge_id,
            origin_kind, external_supabase_session_id, access_token_hash,
            access_expires_at, refresh_expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NULL, 'SUPABASE', $5, NULL, NULL, NULL, $6, $6)`,
        [
          sessionId,
          createUuidV7({ now_ms: now.getTime() }),
          userId,
          deviceRegistrationId,
          input.external_session_id,
          now,
        ],
      );
      await client.query(
        `INSERT INTO marketplace.session_events
           (event_id, session_id, session_version, event_type, request_id, correlation_id, occurred_at)
         VALUES ($1, $2, 1, 'CREATED', $3, $4, $5)`,
        [createUuidV7({ now_ms: now.getTime() }), sessionId, requestId, correlationId, now],
      );
      return Object.freeze({
        client_device_id: clientDeviceId,
        device_registration_id: deviceRegistrationId,
        session_id: sessionId,
        user_id: userId,
      });
    });
  }

  async completeOtpSignIn(
    input: OtpVerificationInput & {
      readonly customer_enrolment?: boolean;
      readonly device_label?: string | null;
      readonly notification_token?: string | null;
      readonly platform: DevicePlatform;
    },
  ): Promise<
    | { readonly outcome: 'already_verified'; readonly replayed: true; readonly tokens: null }
    | {
        readonly outcome: 'verified';
        readonly replayed: false;
        readonly tokens: SessionTokens;
        readonly customer_enrolled: boolean;
      }
  > {
    const platform = requirePlatform(input.platform);
    const deviceLabel = safeLabel(input.device_label);
    const notificationToken =
      input.notification_token === undefined || input.notification_token === null
        ? null
        : requireNotificationToken(input.notification_token);
    const result = await this.#otp.verifyChallengeWithEffect(input, async (identity) => {
      const tokens = await this.#issueSession(identity, {
        context: input.context,
        device_label: deviceLabel,
        notification_token: notificationToken,
        platform,
      });
      if (input.customer_enrolment === true) {
        await enrolCustomerInTransaction(identity.client, {
          context: input.context,
          user_id: tokens.user_id,
          now: identity.verified_at,
        });
      }
      return tokens;
    });
    if (result.verification.replayed || !result.effect) {
      return Object.freeze({ outcome: 'already_verified', replayed: true, tokens: null });
    }
    return Object.freeze({
      outcome: 'verified',
      replayed: false,
      tokens: result.effect,
      customer_enrolled: input.customer_enrolment === true,
    });
  }

  async #issueSession(
    identity: OtpVerifiedIdentity,
    input: {
      readonly context: RequestContext;
      readonly device_label: string | null;
      readonly notification_token: string | null;
      readonly platform: DevicePlatform;
    },
  ): Promise<SessionTokens> {
    const { client, phone_lookup_hash: phoneHash, verified_at: now } = identity;
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `identity:${phoneHash}`,
    ]);

    const existingIdentity = await client.query<{ user_id: string }>(
      'SELECT user_id FROM marketplace.phone_identities WHERE phone_lookup_hash = $1',
      [phoneHash],
    );
    let userId: UuidV7;
    if (existingIdentity.rows[0]) {
      userId = parseUuidV7(existingIdentity.rows[0].user_id);
      const active = await client.query<{ active: boolean }>(
        `SELECT state = 'ACTIVE' AS active FROM marketplace.users WHERE user_id = $1`,
        [userId],
      );
      if (!active.rows[0]?.active) throw new SessionForbiddenError('Identity is disabled');
      await client.query(
        'UPDATE marketplace.phone_identities SET verified_at = $2, updated_at = $2 WHERE phone_lookup_hash = $1',
        [phoneHash, now],
      );
    } else {
      userId = createUuidV7({ now_ms: now.getTime() });
      await client.query(
        `INSERT INTO marketplace.users (user_id, created_at, updated_at) VALUES ($1, $2, $2)`,
        [userId, now],
      );
      await client.query(
        `INSERT INTO marketplace.phone_identities
           (phone_identity_id, user_id, phone_lookup_hash, verified_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4, $4)`,
        [createUuidV7({ now_ms: now.getTime() }), userId, phoneHash, now],
      );
    }

    const notificationHash = input.notification_token
      ? tokenDigest(this.#tokenHashKey, `notification:${input.notification_token}`)
      : null;
    const existingDevice = await client.query<{ device_registration_id: string }>(
      `SELECT device_registration_id FROM marketplace.devices
        WHERE user_id = $1 AND client_device_id = $2 FOR UPDATE`,
      [userId, identity.device_id],
    );
    let deviceRegistrationId: UuidV7;
    if (existingDevice.rows[0]) {
      deviceRegistrationId = parseUuidV7(existingDevice.rows[0].device_registration_id);
      await client.query(
        `UPDATE marketplace.devices
            SET platform = $2, device_label = $3,
                notification_token_hash = COALESCE($4, notification_token_hash),
                notification_state = CASE WHEN $4 IS NULL THEN notification_state ELSE 'ACTIVE' END,
                last_seen_at = $5, updated_at = $5
          WHERE device_registration_id = $1`,
        [deviceRegistrationId, input.platform, input.device_label, notificationHash, now],
      );
    } else {
      deviceRegistrationId = createUuidV7({ now_ms: now.getTime() });
      await client.query(
        `INSERT INTO marketplace.devices
           (device_registration_id, user_id, client_device_id, platform, device_label,
            notification_token_hash, notification_state, last_seen_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $8)`,
        [
          deviceRegistrationId,
          userId,
          identity.device_id,
          input.platform,
          input.device_label,
          notificationHash,
          notificationHash ? 'ACTIVE' : 'NONE',
          now,
        ],
      );
    }

    const accessToken = this.#newToken('nsa');
    const refreshToken = this.#newToken('nsr');
    const sessionId = createUuidV7({ now_ms: now.getTime() });
    const tokenFamilyId = createUuidV7({ now_ms: now.getTime() });
    const accessExpiresAt = new Date(now.getTime() + ACCESS_TTL_MS);
    const refreshExpiresAt = new Date(now.getTime() + REFRESH_TTL_MS);
    await client.query(
      `INSERT INTO marketplace.sessions
         (session_id, token_family_id, user_id, device_registration_id, otp_challenge_id,
          access_token_hash, access_expires_at, refresh_expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [
        sessionId,
        tokenFamilyId,
        userId,
        deviceRegistrationId,
        identity.challenge_id,
        tokenDigest(this.#tokenHashKey, accessToken),
        accessExpiresAt,
        refreshExpiresAt,
        now,
      ],
    );
    await client.query(
      `INSERT INTO marketplace.session_refresh_tokens
         (refresh_token_id, session_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        createUuidV7({ now_ms: now.getTime() }),
        sessionId,
        tokenDigest(this.#tokenHashKey, refreshToken),
        refreshExpiresAt,
        now,
      ],
    );
    await client.query(
      `INSERT INTO marketplace.session_events
         (event_id, session_id, session_version, event_type, request_id, correlation_id, occurred_at)
       VALUES ($1, $2, 1, 'CREATED', $3, $4, $5)`,
      [createUuidV7({ now_ms: now.getTime() }), sessionId, requestId, correlationId, now],
    );
    return Object.freeze({
      access_expires_at: accessExpiresAt.toISOString(),
      access_token: accessToken,
      refresh_expires_at: refreshExpiresAt.toISOString(),
      refresh_token: refreshToken,
      session_id: sessionId,
      user_id: userId,
    });
  }

  /**
   * Issue a session for a user whose identity was already verified through a
   * non-OTP path (e.g. password login). The caller is responsible for
   * confirming credentials before calling this method.
   */
  async beginPasswordSession(input: {
    readonly context: RequestContext;
    readonly user_id: UuidV7;
    readonly device_id: string;
    readonly platform: DevicePlatform;
    readonly device_label?: string | null;
    readonly notification_token?: string | null;
    readonly now?: Date;
  }): Promise<SessionTokens> {
    const platform = requirePlatform(input.platform);
    const deviceLabel = safeLabel(input.device_label);
    const notificationToken =
      input.notification_token === undefined || input.notification_token === null
        ? null
        : requireNotificationToken(input.notification_token);
    const clientDeviceId = parseUuidV7(input.device_id);
    const now = input.now ?? new Date();
    const userId = parseUuidV7(input.user_id);
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    return transaction(this.#pool, async (client) => {
      const active = await client.query<{ active: boolean }>(
        `SELECT state = 'ACTIVE' AS active FROM marketplace.users WHERE user_id = $1`,
        [userId],
      );
      if (!active.rows[0]?.active) throw new SessionForbiddenError('Identity is disabled');
      const notificationHash = notificationToken
        ? tokenDigest(this.#tokenHashKey, `notification:${notificationToken}`)
        : null;
      const existingDevice = await client.query<{ device_registration_id: string }>(
        `SELECT device_registration_id FROM marketplace.devices
          WHERE user_id = $1 AND client_device_id = $2 FOR UPDATE`,
        [userId, clientDeviceId],
      );
      let deviceRegistrationId: UuidV7;
      if (existingDevice.rows[0]) {
        deviceRegistrationId = parseUuidV7(existingDevice.rows[0].device_registration_id);
        await client.query(
          `UPDATE marketplace.devices
              SET platform = $2, device_label = $3,
                  notification_token_hash = COALESCE($4, notification_token_hash),
                  notification_state = CASE WHEN $4 IS NULL THEN notification_state ELSE 'ACTIVE' END,
                  last_seen_at = $5, updated_at = $5
            WHERE device_registration_id = $1`,
          [deviceRegistrationId, platform, deviceLabel, notificationHash, now],
        );
      } else {
        deviceRegistrationId = createUuidV7({ now_ms: now.getTime() });
        await client.query(
          `INSERT INTO marketplace.devices
             (device_registration_id, user_id, client_device_id, platform, device_label,
              notification_token_hash, notification_state, last_seen_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $8)`,
          [
            deviceRegistrationId,
            userId,
            clientDeviceId,
            platform,
            deviceLabel,
            notificationHash,
            notificationHash ? 'ACTIVE' : 'NONE',
            now,
          ],
        );
      }
      const accessToken = this.#newToken('nsa');
      const refreshToken = this.#newToken('nsr');
      const sessionId = createUuidV7({ now_ms: now.getTime() });
      const tokenFamilyId = createUuidV7({ now_ms: now.getTime() });
      const accessExpiresAt = new Date(now.getTime() + ACCESS_TTL_MS);
      const refreshExpiresAt = new Date(now.getTime() + REFRESH_TTL_MS);
      await client.query(
        `INSERT INTO marketplace.sessions
           (session_id, token_family_id, user_id, device_registration_id, otp_challenge_id,
            origin_kind, access_token_hash, access_expires_at, refresh_expires_at,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, NULL, 'PASSWORD', $5, $6, $7, $8, $8)`,
        [
          sessionId,
          tokenFamilyId,
          userId,
          deviceRegistrationId,
          tokenDigest(this.#tokenHashKey, accessToken),
          accessExpiresAt,
          refreshExpiresAt,
          now,
        ],
      );
      await client.query(
        `INSERT INTO marketplace.session_refresh_tokens
           (refresh_token_id, session_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          sessionId,
          tokenDigest(this.#tokenHashKey, refreshToken),
          refreshExpiresAt,
          now,
        ],
      );
      await client.query(
        `INSERT INTO marketplace.session_events
           (event_id, session_id, session_version, event_type, request_id, correlation_id, occurred_at)
         VALUES ($1, $2, 1, 'CREATED', $3, $4, $5)`,
        [createUuidV7({ now_ms: now.getTime() }), sessionId, requestId, correlationId, now],
      );
      return Object.freeze({
        access_expires_at: accessExpiresAt.toISOString(),
        access_token: accessToken,
        refresh_expires_at: refreshExpiresAt.toISOString(),
        refresh_token: refreshToken,
        session_id: sessionId,
        user_id: userId,
      });
    });
  }

  async authenticateAccess(input: {
    readonly access_token: string;
    readonly context: RequestContext;
    readonly expected_user_id?: string;
    readonly now?: Date;
  }): Promise<SessionPrincipal> {
    const token = requireAccessToken(input.access_token);
    const now = input.now ?? new Date();
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    const expectedUserId = input.expected_user_id ? parseUuidV7(input.expected_user_id) : undefined;
    const result = await transaction<SessionPrincipal | { readonly rejected: true }>(
      this.#pool,
      async (client) => {
        const found = await client.query<SessionRow>(
          `SELECT s.session_id, s.user_id, s.device_registration_id, d.client_device_id,
                  s.state, s.version, s.access_expires_at, s.refresh_expires_at
             FROM marketplace.sessions s
             JOIN marketplace.devices d USING (device_registration_id)
            WHERE s.access_token_hash = $1
            FOR UPDATE OF s`,
          [tokenDigest(this.#tokenHashKey, token)],
        );
        const session = found.rows[0];
        if (!session || session.state !== 'ACTIVE')
          throw new SessionInvalidError('Session is invalid');
        if (expectedUserId && session.user_id !== expectedUserId) {
          throw new SessionForbiddenError('Session belongs to another identity');
        }
        if (!session.refresh_expires_at || !session.access_expires_at) {
          throw new SessionInvalidError('Session token material is invalid');
        }
        if (now.getTime() >= session.refresh_expires_at.getTime()) {
          await this.#expireSession(client, session, requestId, correlationId, now);
          return { rejected: true as const };
        }
        if (now.getTime() >= session.access_expires_at.getTime()) {
          return { rejected: true as const };
        }
        await client.query(
          'UPDATE marketplace.devices SET last_seen_at = $2, updated_at = $2 WHERE device_registration_id = $1',
          [session.device_registration_id, now],
        );
        return principal(session);
      },
    );
    if ('rejected' in result) throw new SessionInvalidError('Session has expired');
    return result;
  }

  async #expireSession(
    client: PoolClient,
    session: SessionRow,
    requestId: string,
    correlationId: string,
    now: Date,
  ): Promise<void> {
    const version = session.version + 1;
    await client.query(
      `UPDATE marketplace.sessions
          SET state = 'EXPIRED', version = $2, revoked_at = $3,
              revoke_reason = 'SESSION_EXPIRED', updated_at = $3
        WHERE session_id = $1 AND state = 'ACTIVE'`,
      [session.session_id, version, now],
    );
    await client.query(
      `UPDATE marketplace.session_refresh_tokens
          SET status = 'REVOKED', revoked_at = $2
        WHERE session_id = $1 AND status = 'ACTIVE'`,
      [session.session_id, now],
    );
    await this.#recordEvent(
      client,
      session.session_id,
      version,
      'EXPIRED',
      requestId,
      correlationId,
      now,
    );
  }

  async #recordEvent(
    client: PoolClient,
    sessionId: string,
    version: number,
    eventType: 'EXPIRED' | 'REFRESHED' | 'REPLAY_DETECTED' | 'REVOKED',
    requestId: string,
    correlationId: string,
    now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO marketplace.session_events
         (event_id, session_id, session_version, event_type, request_id, correlation_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        createUuidV7({ now_ms: now.getTime() }),
        sessionId,
        version,
        eventType,
        requestId,
        correlationId,
        now,
      ],
    );
  }

  async refresh(input: {
    readonly context: RequestContext;
    readonly now?: Date;
    readonly refresh_token: string;
  }): Promise<SessionTokens> {
    const token = requireRefreshToken(input.refresh_token);
    const now = input.now ?? new Date();
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    const outcome = await transaction<
      SessionTokens | { readonly rejected: 'expired' | 'invalid' | 'replay' }
    >(this.#pool, async (client) => {
      const result = await client.query<RefreshRow>(
        `SELECT r.refresh_token_id, r.status AS refresh_status, r.expires_at AS token_expires_at,
                s.session_id, s.user_id, s.device_registration_id, d.client_device_id,
                s.state, s.version, s.access_expires_at, s.refresh_expires_at
           FROM marketplace.session_refresh_tokens r
           JOIN marketplace.sessions s USING (session_id)
           JOIN marketplace.devices d USING (device_registration_id)
          WHERE r.token_hash = $1
          FOR UPDATE OF r, s`,
        [tokenDigest(this.#tokenHashKey, token)],
      );
      const session = result.rows[0];
      if (!session) return { rejected: 'invalid' as const };
      if (session.refresh_status === 'ROTATED') {
        if (session.state === 'ACTIVE') {
          const version = session.version + 1;
          await client.query(
            `UPDATE marketplace.sessions SET state = 'REVOKED', version = $2,
                    revoked_at = $3, revoke_reason = 'REFRESH_REPLAY', updated_at = $3
              WHERE session_id = $1`,
            [session.session_id, version, now],
          );
          await client.query(
            `UPDATE marketplace.session_refresh_tokens
                SET status = 'REVOKED', revoked_at = $2
              WHERE session_id = $1 AND status = 'ACTIVE'`,
            [session.session_id, now],
          );
          await this.#recordEvent(
            client,
            session.session_id,
            version,
            'REPLAY_DETECTED',
            requestId,
            correlationId,
            now,
          );
        }
        return { rejected: 'replay' as const };
      }
      if (session.refresh_status !== 'ACTIVE' || session.state !== 'ACTIVE') {
        return { rejected: 'invalid' as const };
      }
      if (!session.refresh_expires_at || !session.access_expires_at) {
        return { rejected: 'invalid' as const };
      }
      if (
        now.getTime() >= session.token_expires_at.getTime() ||
        now.getTime() >= session.refresh_expires_at.getTime()
      ) {
        await this.#expireSession(client, session, requestId, correlationId, now);
        return { rejected: 'expired' as const };
      }

      const accessToken = this.#newToken('nsa');
      const refreshToken = this.#newToken('nsr');
      const accessExpiresAt = new Date(
        Math.min(now.getTime() + ACCESS_TTL_MS, session.refresh_expires_at.getTime() - 1),
      );
      const version = session.version + 1;
      await client.query(
        `UPDATE marketplace.session_refresh_tokens
            SET status = 'ROTATED', rotated_at = $2
          WHERE refresh_token_id = $1`,
        [session.refresh_token_id, now],
      );
      await client.query(
        `UPDATE marketplace.sessions
            SET version = $2, access_token_hash = $3, access_expires_at = $4, updated_at = $5
          WHERE session_id = $1`,
        [
          session.session_id,
          version,
          tokenDigest(this.#tokenHashKey, accessToken),
          accessExpiresAt,
          now,
        ],
      );
      await client.query(
        `INSERT INTO marketplace.session_refresh_tokens
           (refresh_token_id, session_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          session.session_id,
          tokenDigest(this.#tokenHashKey, refreshToken),
          session.refresh_expires_at,
          now,
        ],
      );
      await this.#recordEvent(
        client,
        session.session_id,
        version,
        'REFRESHED',
        requestId,
        correlationId,
        now,
      );
      await client.query(
        'UPDATE marketplace.devices SET last_seen_at = $2, updated_at = $2 WHERE device_registration_id = $1',
        [session.device_registration_id, now],
      );
      return Object.freeze({
        access_expires_at: accessExpiresAt.toISOString(),
        access_token: accessToken,
        refresh_expires_at: session.refresh_expires_at.toISOString(),
        refresh_token: refreshToken,
        session_id: parseUuidV7(session.session_id),
        user_id: parseUuidV7(session.user_id),
      });
    });
    if ('rejected' in outcome) {
      if (outcome.rejected === 'replay') {
        throw new SessionReplayDetectedError('Refresh-token replay revoked the session');
      }
      throw new SessionInvalidError('Refresh token is invalid or expired');
    }
    return outcome;
  }

  async listSessions(input: {
    readonly access_token: string;
    readonly context: RequestContext;
    readonly now?: Date;
  }): Promise<readonly SessionSummary[]> {
    const current = await this.authenticateAccess(input);
    return this.listSessionsForPrincipal({ current });
  }

  async listSessionsForPrincipal(input: {
    readonly current: SessionPrincipal;
  }): Promise<readonly SessionSummary[]> {
    const result = await this.#pool.query<
      SessionRow & { created_at: Date; device_label: string | null; platform: DevicePlatform }
    >(
      `SELECT s.session_id, s.user_id, s.device_registration_id, d.client_device_id,
              s.state, s.version, s.access_expires_at, s.refresh_expires_at, s.created_at,
              d.device_label, d.platform
         FROM marketplace.sessions s
         JOIN marketplace.devices d USING (device_registration_id)
        WHERE s.user_id = $1
        ORDER BY s.created_at DESC, s.session_id DESC
        LIMIT 50`,
      [input.current.user_id],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          ...principal(row),
          access_expires_at: row.access_expires_at?.toISOString() ?? null,
          created_at: row.created_at.toISOString(),
          current: row.session_id === input.current.session_id,
          device_label: row.device_label,
          platform: row.platform,
          state: row.state,
        }),
      ),
    );
  }

  async revoke(input: {
    readonly access_token: string;
    readonly context: RequestContext;
    readonly now?: Date;
    readonly target_session_id?: string;
  }): Promise<{ readonly revoked_session_id: UuidV7 }> {
    const current = await this.authenticateAccess(input);
    return this.revokeForPrincipal({
      context: input.context,
      current,
      ...(input.now ? { now: input.now } : {}),
      ...(input.target_session_id ? { target_session_id: input.target_session_id } : {}),
    });
  }

  async revokeForPrincipal(input: {
    readonly context: RequestContext;
    readonly current: SessionPrincipal;
    readonly now?: Date;
    readonly target_session_id?: string;
  }): Promise<{ readonly revoked_session_id: UuidV7 }> {
    const targetSessionId = input.target_session_id
      ? parseUuidV7(input.target_session_id)
      : input.current.session_id;
    const now = input.now ?? new Date();
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    return transaction(this.#pool, async (client) => {
      const result = await client.query<SessionRow>(
        `SELECT s.session_id, s.user_id, s.device_registration_id, d.client_device_id,
                s.state, s.version, s.access_expires_at, s.refresh_expires_at
           FROM marketplace.sessions s JOIN marketplace.devices d USING (device_registration_id)
          WHERE s.session_id = $1 FOR UPDATE OF s`,
        [targetSessionId],
      );
      const target = result.rows[0];
      if (!target || target.user_id !== input.current.user_id) {
        throw new SessionForbiddenError('Session is outside the current identity');
      }
      if (target.state === 'ACTIVE') {
        const version = target.version + 1;
        await client.query(
          `UPDATE marketplace.sessions SET state = 'REVOKED', version = $2,
                  revoked_at = $3, revoke_reason = 'USER_SIGN_OUT', updated_at = $3
            WHERE session_id = $1`,
          [targetSessionId, version, now],
        );
        await client.query(
          `UPDATE marketplace.session_refresh_tokens
              SET status = 'REVOKED', revoked_at = $2
            WHERE session_id = $1 AND status = 'ACTIVE'`,
          [targetSessionId, now],
        );
        await this.#recordEvent(
          client,
          targetSessionId,
          version,
          'REVOKED',
          requestId,
          correlationId,
          now,
        );
        await client.query(
          `UPDATE marketplace.devices
              SET notification_token_hash = NULL, notification_state = 'REVOKED', updated_at = $2
            WHERE device_registration_id = $1
              AND NOT EXISTS (
                SELECT 1 FROM marketplace.sessions
                 WHERE device_registration_id = $1 AND state = 'ACTIVE'
              )`,
          [target.device_registration_id, now],
        );
      }
      return Object.freeze({ revoked_session_id: targetSessionId });
    });
  }

  async updateNotificationToken(input: {
    readonly access_token: string;
    readonly context: RequestContext;
    readonly notification_token: string | null;
    readonly now?: Date;
  }): Promise<{ readonly notification_state: 'ACTIVE' | 'NONE' }> {
    const current = await this.authenticateAccess(input);
    return this.updateNotificationTokenForPrincipal({
      current,
      notification_token: input.notification_token,
      ...(input.now ? { now: input.now } : {}),
    });
  }

  async updateNotificationTokenForPrincipal(input: {
    readonly current: SessionPrincipal;
    readonly notification_token: string | null;
    readonly now?: Date;
  }): Promise<{ readonly notification_state: 'ACTIVE' | 'NONE' }> {
    const now = input.now ?? new Date();
    const hash = input.notification_token
      ? tokenDigest(
          this.#tokenHashKey,
          `notification:${requireNotificationToken(input.notification_token)}`,
        )
      : null;
    await this.#pool.query(
      `UPDATE marketplace.devices
          SET notification_token_hash = $2::text,
              notification_state = CASE WHEN $2::text IS NULL THEN 'NONE' ELSE 'ACTIVE' END,
              last_seen_at = $3, updated_at = $3
        WHERE device_registration_id = $1`,
      [input.current.device_registration_id, hash, now],
    );
    return Object.freeze({ notification_state: hash ? 'ACTIVE' : 'NONE' });
  }
}
