import { releaseServicePool, resolveServicePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import { transaction } from './transaction.js';

export type CustomerLanguage = 'EN' | 'HI';
export type ConsentDecision = 'GRANTED' | 'WITHDRAWN';
export type ConsentKind = 'LOCATION' | 'MARKETING' | 'PRIVACY' | 'TERMS';
export type ConsentSource = 'ANDROID' | 'CUSTOMER_API' | 'CUSTOMER_PWA';
// IN_APP has been a deliverable channel since 0037 and gained its channel
// policy in 0056; it was missing here, so the settings surface could not
// describe a preference the delivery path was already writing.
export type NotificationChannel = 'IN_APP' | 'PUSH' | 'SMS';
export type NotificationKind = 'MARKETING' | 'ORDER_STATUS' | 'SECURITY' | 'SUPPORT';

export interface CustomerProfile {
  readonly display_name: string | null;
  readonly language: CustomerLanguage;
  readonly user_id: UuidV7;
  readonly version: number;
}

export interface ConsentRecord {
  readonly consent_kind: ConsentKind;
  readonly consent_record_id: UuidV7;
  readonly consent_version: number;
  readonly decision: ConsentDecision;
  readonly occurred_at: string;
  readonly policy_version: string;
  readonly source: ConsentSource;
}

export interface NotificationPreference {
  readonly channel: NotificationChannel;
  readonly default_enabled: boolean;
  readonly effective_enabled: boolean;
  readonly notification_kind: NotificationKind;
  readonly preference_enabled: boolean | null;
  readonly requires_consent_kind: ConsentKind | null;
  readonly user_controllable: boolean;
  readonly version: number;
}

export class PreferenceInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}
export class PreferenceVersionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT';
}
export class RequiredNotificationError extends Error {
  readonly code = 'BUSINESS_RULE_VIOLATION';
}
export class PreferenceIdentityError extends Error {
  readonly code = 'FORBIDDEN';
}

const POLICY_VERSION_PATTERN = /^[a-z][a-z0-9_.-]{2,63}$/;
const LANGUAGES = new Set<CustomerLanguage>(['EN', 'HI']);
const CONSENT_KINDS = new Set<ConsentKind>(['LOCATION', 'MARKETING', 'PRIVACY', 'TERMS']);
const CONSENT_DECISIONS = new Set<ConsentDecision>(['GRANTED', 'WITHDRAWN']);
const CONSENT_SOURCES = new Set<ConsentSource>(['ANDROID', 'CUSTOMER_API', 'CUSTOMER_PWA']);
const NOTIFICATION_KINDS = new Set<NotificationKind>([
  'MARKETING',
  'ORDER_STATUS',
  'SECURITY',
  'SUPPORT',
]);
const NOTIFICATION_CHANNELS = new Set<NotificationChannel>(['PUSH', 'SMS']);

function safeDisplayName(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  const normalized = value.trim();
  const hasControl = Array.from(normalized).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (normalized.length > 80 || hasControl) {
    throw new PreferenceInputError('Display name is invalid');
  }
  return normalized;
}

function requireLanguage(value: string): CustomerLanguage {
  if (!LANGUAGES.has(value as CustomerLanguage)) {
    throw new PreferenceInputError('Language is invalid');
  }
  return value as CustomerLanguage;
}

function requireConsentKind(value: string): ConsentKind {
  if (!CONSENT_KINDS.has(value as ConsentKind)) {
    throw new PreferenceInputError('Consent kind is invalid');
  }
  return value as ConsentKind;
}

function requireConsentDecision(value: string): ConsentDecision {
  if (!CONSENT_DECISIONS.has(value as ConsentDecision)) {
    throw new PreferenceInputError('Consent decision is invalid');
  }
  return value as ConsentDecision;
}

function requireConsentSource(value: string): ConsentSource {
  if (!CONSENT_SOURCES.has(value as ConsentSource)) {
    throw new PreferenceInputError('Consent source is invalid');
  }
  return value as ConsentSource;
}

function requireNotificationKind(value: string): NotificationKind {
  if (!NOTIFICATION_KINDS.has(value as NotificationKind)) {
    throw new PreferenceInputError('Notification kind is invalid');
  }
  return value as NotificationKind;
}

function requireNotificationChannel(value: string): NotificationChannel {
  if (!NOTIFICATION_CHANNELS.has(value as NotificationChannel)) {
    throw new PreferenceInputError('Notification channel is invalid');
  }
  return value as NotificationChannel;
}

function requireExpectedVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PreferenceInputError('Expected version is invalid');
  }
  return value;
}

function contextIds(context: RequestContext) {
  return {
    correlationId: parseUuidV7(context.correlation_id),
    requestId: parseRequestId(context.request_id),
  };
}

async function requireActiveUser(client: PoolClient, userId: UuidV7): Promise<void> {
  const result = await client.query<{ active: boolean }>(
    `SELECT state = 'ACTIVE' AS active FROM marketplace.users WHERE user_id = $1`,
    [parseUuidV7(userId)],
  );
  if (!result.rows[0]?.active) throw new PreferenceIdentityError('User is unavailable');
}

interface ProfileRow {
  readonly display_name: string | null;
  readonly language: CustomerLanguage;
  readonly user_id: string;
  readonly version: number;
}

function profile(row: ProfileRow): CustomerProfile {
  return Object.freeze({
    display_name: row.display_name,
    language: row.language,
    user_id: parseUuidV7(row.user_id),
    version: row.version,
  });
}

export class IdentityPreferencesService {
  readonly #pool: Pool;

  constructor(input: { readonly connection_string: string; readonly pool?: Pool }) {
    this.#pool = resolveServicePool(input, {
      application_name: 'neighbourhood-store-identity-preferences',
      connectionTimeoutMillis: 5_000,
      max: 8,
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
  }

  async close(): Promise<void> {
    await releaseServicePool(this.#pool);
  }

  async getProfile(userId: UuidV7): Promise<CustomerProfile> {
    const result = await this.#pool.query<ProfileRow>(
      `SELECT user_id, display_name, language, version
         FROM marketplace.customer_profiles WHERE user_id = $1`,
      [parseUuidV7(userId)],
    );
    if (result.rows[0]) return profile(result.rows[0]);
    return Object.freeze({ display_name: null, language: 'EN', user_id: userId, version: 0 });
  }

  async updateProfile(input: {
    readonly context: RequestContext;
    readonly display_name: string | null;
    readonly expected_version: number;
    readonly language: CustomerLanguage;
    readonly now?: Date;
    readonly user_id: UuidV7;
  }): Promise<CustomerProfile> {
    const now = input.now ?? new Date();
    const displayName = safeDisplayName(input.display_name);
    const language = requireLanguage(input.language);
    const expectedVersion = requireExpectedVersion(input.expected_version);
    const { correlationId, requestId } = contextIds(input.context);
    return transaction(this.#pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `customer-profile:${input.user_id}`,
      ]);
      await requireActiveUser(client, input.user_id);
      const current = await client.query<ProfileRow & { request_id: string }>(
        `SELECT user_id, display_name, language, version, request_id
           FROM marketplace.customer_profiles WHERE user_id = $1 FOR UPDATE`,
        [input.user_id],
      );
      if (current.rows[0]?.request_id === requestId) return profile(current.rows[0]);
      if ((current.rows[0]?.version ?? 0) !== expectedVersion) {
        throw new PreferenceVersionConflictError('Profile version is stale');
      }
      if (!current.rows[0]) {
        const inserted = await client.query<ProfileRow>(
          `INSERT INTO marketplace.customer_profiles
             (user_id, display_name, language, request_id, correlation_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           RETURNING user_id, display_name, language, version`,
          [input.user_id, displayName, language, requestId, correlationId, now],
        );
        return profile(inserted.rows[0] as ProfileRow);
      }
      const updated = await client.query<ProfileRow>(
        `UPDATE marketplace.customer_profiles
            SET display_name = $2, language = $3, version = version + 1,
                request_id = $4, correlation_id = $5, updated_at = $6
          WHERE user_id = $1
          RETURNING user_id, display_name, language, version`,
        [input.user_id, displayName, language, requestId, correlationId, now],
      );
      return profile(updated.rows[0] as ProfileRow);
    });
  }

  async recordConsent(input: {
    readonly consent_kind: ConsentKind;
    readonly context: RequestContext;
    readonly decision: ConsentDecision;
    readonly now?: Date;
    readonly policy_version: string;
    readonly source: ConsentSource;
    readonly user_id: UuidV7;
  }): Promise<ConsentRecord> {
    const kind = requireConsentKind(input.consent_kind);
    const decision = requireConsentDecision(input.decision);
    const source = requireConsentSource(input.source);
    if (!POLICY_VERSION_PATTERN.test(input.policy_version)) {
      throw new PreferenceInputError('Policy version is invalid');
    }
    const now = input.now ?? new Date();
    const { correlationId, requestId } = contextIds(input.context);
    return transaction(this.#pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `consent:${input.user_id}:${kind}`,
      ]);
      await requireActiveUser(client, input.user_id);
      const replay = await client.query<{
        consent_kind: ConsentKind;
        consent_record_id: string;
        consent_version: number;
        decision: ConsentDecision;
        occurred_at: Date;
        policy_version: string;
        source: ConsentSource;
      }>(
        `SELECT consent_record_id, consent_kind, consent_version, policy_version,
                decision, source, occurred_at
           FROM marketplace.consents
          WHERE user_id = $1 AND consent_kind = $2 AND request_id = $3`,
        [input.user_id, kind, requestId],
      );
      if (replay.rows[0]) {
        return Object.freeze({
          ...replay.rows[0],
          consent_record_id: parseUuidV7(replay.rows[0].consent_record_id),
          occurred_at: replay.rows[0].occurred_at.toISOString(),
        });
      }
      const previous = await client.query<{ consent_record_id: string; consent_version: number }>(
        `SELECT consent_record_id, consent_version FROM marketplace.consents
          WHERE user_id = $1 AND consent_kind = $2
          ORDER BY consent_version DESC LIMIT 1 FOR UPDATE`,
        [input.user_id, kind],
      );
      const consentRecordId = createUuidV7({ now_ms: now.getTime() });
      const version = (previous.rows[0]?.consent_version ?? 0) + 1;
      const inserted = await client.query<{
        consent_kind: ConsentKind;
        consent_record_id: string;
        consent_version: number;
        decision: ConsentDecision;
        occurred_at: Date;
        policy_version: string;
        source: ConsentSource;
      }>(
        `INSERT INTO marketplace.consents
           (consent_record_id, user_id, consent_kind, consent_version, policy_version,
            decision, source, previous_consent_record_id, request_id, correlation_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING consent_record_id, consent_kind, consent_version, policy_version,
                   decision, source, occurred_at`,
        [
          consentRecordId,
          input.user_id,
          kind,
          version,
          input.policy_version,
          decision,
          source,
          previous.rows[0]?.consent_record_id ?? null,
          requestId,
          correlationId,
          now,
        ],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error('Consent insert returned no row');
      return Object.freeze({
        ...row,
        consent_record_id: parseUuidV7(row.consent_record_id),
        occurred_at: row.occurred_at.toISOString(),
      });
    });
  }

  async getCurrentConsents(userId: UuidV7): Promise<readonly ConsentRecord[]> {
    const result = await this.#pool.query<{
      consent_kind: ConsentKind;
      consent_record_id: string;
      consent_version: number;
      decision: ConsentDecision;
      occurred_at: Date;
      policy_version: string;
      source: ConsentSource;
    }>(
      `SELECT DISTINCT ON (consent_kind)
              consent_record_id, consent_kind, consent_version, policy_version,
              decision, source, occurred_at
         FROM marketplace.consents WHERE user_id = $1
        ORDER BY consent_kind, consent_version DESC`,
      [parseUuidV7(userId)],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          ...row,
          consent_record_id: parseUuidV7(row.consent_record_id),
          occurred_at: row.occurred_at.toISOString(),
        }),
      ),
    );
  }

  async setNotificationPreference(input: {
    readonly channel: NotificationChannel;
    readonly context: RequestContext;
    readonly enabled: boolean;
    readonly expected_version: number;
    readonly notification_kind: NotificationKind;
    readonly now?: Date;
    readonly user_id: UuidV7;
  }): Promise<NotificationPreference> {
    const kind = requireNotificationKind(input.notification_kind);
    const channel = requireNotificationChannel(input.channel);
    const expectedVersion = requireExpectedVersion(input.expected_version);
    const now = input.now ?? new Date();
    const { correlationId, requestId } = contextIds(input.context);
    return transaction(this.#pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `notification:${input.user_id}:${kind}:${channel}`,
      ]);
      await requireActiveUser(client, input.user_id);
      const policy = await client.query<{
        default_enabled: boolean;
        requires_consent_kind: ConsentKind | null;
        user_controllable: boolean;
      }>(
        `SELECT user_controllable, default_enabled, requires_consent_kind
           FROM marketplace.notification_channel_policies
          WHERE notification_kind = $1 AND channel = $2`,
        [kind, channel],
      );
      const rule = policy.rows[0];
      if (!rule) throw new PreferenceInputError('Notification policy is invalid');
      if (!rule.user_controllable && !input.enabled) {
        throw new RequiredNotificationError('Required notification cannot be disabled');
      }
      const current = await client.query<{
        enabled: boolean;
        request_id: string;
        version: number;
      }>(
        `SELECT enabled, version, request_id FROM marketplace.notification_preferences
          WHERE user_id = $1 AND notification_kind = $2 AND channel = $3 FOR UPDATE`,
        [input.user_id, kind, channel],
      );
      if (current.rows[0]?.request_id === requestId) {
        return this.#notificationPreference({
          channel,
          current_enabled: current.rows[0].enabled,
          current_version: current.rows[0].version,
          kind,
          policy: rule,
          user_id: input.user_id,
          client,
        });
      }
      if ((current.rows[0]?.version ?? 0) !== expectedVersion) {
        throw new PreferenceVersionConflictError('Notification preference version is stale');
      }
      const version = expectedVersion + 1;
      await client.query(
        `INSERT INTO marketplace.notification_preferences
           (user_id, notification_kind, channel, enabled, version,
            request_id, correlation_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         ON CONFLICT (user_id, notification_kind, channel) DO UPDATE SET
           enabled = EXCLUDED.enabled, version = EXCLUDED.version,
           request_id = EXCLUDED.request_id, correlation_id = EXCLUDED.correlation_id,
           updated_at = EXCLUDED.updated_at`,
        [input.user_id, kind, channel, input.enabled, version, requestId, correlationId, now],
      );
      await client.query(
        `INSERT INTO marketplace.notification_preference_events
           (event_id, user_id, notification_kind, channel, enabled,
            preference_version, request_id, correlation_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          input.user_id,
          kind,
          channel,
          input.enabled,
          version,
          requestId,
          correlationId,
          now,
        ],
      );
      return this.#notificationPreference({
        channel,
        client,
        current_enabled: input.enabled,
        current_version: version,
        kind,
        policy: rule,
        user_id: input.user_id,
      });
    });
  }

  async #notificationPreference(input: {
    readonly channel: NotificationChannel;
    readonly client: PoolClient;
    readonly current_enabled: boolean;
    readonly current_version: number;
    readonly kind: NotificationKind;
    readonly policy: {
      readonly default_enabled: boolean;
      readonly requires_consent_kind: ConsentKind | null;
      readonly user_controllable: boolean;
    };
    readonly user_id: UuidV7;
  }): Promise<NotificationPreference> {
    let consentGranted = true;
    if (input.policy.requires_consent_kind) {
      const consent = await input.client.query<{ granted: boolean }>(
        `SELECT decision = 'GRANTED' AS granted FROM marketplace.consents
          WHERE user_id = $1 AND consent_kind = $2
          ORDER BY consent_version DESC LIMIT 1`,
        [input.user_id, input.policy.requires_consent_kind],
      );
      consentGranted = consent.rows[0]?.granted ?? false;
    }
    return Object.freeze({
      channel: input.channel,
      default_enabled: input.policy.default_enabled,
      effective_enabled: input.current_enabled && consentGranted,
      notification_kind: input.kind,
      preference_enabled: input.current_enabled,
      requires_consent_kind: input.policy.requires_consent_kind,
      user_controllable: input.policy.user_controllable,
      version: input.current_version,
    });
  }

  async getNotificationPreferences(userId: UuidV7): Promise<readonly NotificationPreference[]> {
    const result = await this.#pool.query<{
      channel: NotificationChannel;
      default_enabled: boolean;
      effective_enabled: boolean;
      notification_kind: NotificationKind;
      preference_enabled: boolean | null;
      requires_consent_kind: ConsentKind | null;
      user_controllable: boolean;
      version: number;
    }>(
      `SELECT policy.notification_kind, policy.channel, policy.user_controllable,
              policy.default_enabled, policy.requires_consent_kind,
              preference.enabled AS preference_enabled,
              COALESCE(preference.version, 0) AS version,
              CASE
                WHEN policy.requires_consent_kind IS NOT NULL AND
                     COALESCE(consent.decision, 'WITHDRAWN') <> 'GRANTED' THEN false
                ELSE COALESCE(preference.enabled, policy.default_enabled)
              END AS effective_enabled
         FROM marketplace.notification_channel_policies policy
         LEFT JOIN marketplace.notification_preferences preference
           ON preference.user_id = $1
          AND preference.notification_kind = policy.notification_kind
          AND preference.channel = policy.channel
         LEFT JOIN LATERAL (
           SELECT decision FROM marketplace.consents
            WHERE user_id = $1 AND consent_kind = policy.requires_consent_kind
            ORDER BY consent_version DESC LIMIT 1
         ) consent ON true
        ORDER BY policy.notification_kind, policy.channel`,
      [parseUuidV7(userId)],
    );
    return Object.freeze(result.rows.map((row) => Object.freeze(row)));
  }

  async getSettings(userId: UuidV7) {
    const [currentProfile, consents, notifications] = await Promise.all([
      this.getProfile(userId),
      this.getCurrentConsents(userId),
      this.getNotificationPreferences(userId),
    ]);
    return Object.freeze({ consents, notifications, profile: currentProfile });
  }

  async listPrivacyRequests(userId: UuidV7): Promise<readonly Record<string, unknown>[]> {
    const result = await this.#pool.query(
      `SELECT customer_privacy_request_id,request_kind,lifecycle_state,requested_at,
              completed_at,export_expires_at
         FROM marketplace.customer_privacy_requests
        WHERE user_id=$1 ORDER BY requested_at DESC LIMIT 50`,
      [parseUuidV7(userId)],
    );
    return Object.freeze(result.rows);
  }

  async requestPrivacyAction(input: {
    readonly context: RequestContext;
    readonly request_kind: 'ACCOUNT_DELETION' | 'DATA_EXPORT';
    readonly user_id: UuidV7;
    readonly now?: Date;
  }): Promise<Record<string, unknown>> {
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    const requestId = createUuidV7({ now_ms: now.getTime() });
    try {
      const result = await this.#pool.query(
        `INSERT INTO marketplace.customer_privacy_requests
           (customer_privacy_request_id,user_id,request_kind,lifecycle_state,requested_at,
            request_id,correlation_id,created_at,updated_at)
         VALUES($1,$2,$3,'REQUESTED',$4,$5,$6,$4,$4)
         RETURNING customer_privacy_request_id,request_kind,lifecycle_state,requested_at`,
        [
          requestId,
          parseUuidV7(input.user_id),
          input.request_kind,
          now,
          ids.requestId,
          ids.correlationId,
        ],
      );
      return result.rows[0] as Record<string, unknown>;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === '23505'
      ) {
        throw new PreferenceVersionConflictError('A request of this type is already active');
      }
      throw error;
    }
  }
}
