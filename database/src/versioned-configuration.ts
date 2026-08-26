import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestId,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import type { Pool, PoolClient } from 'pg';
import { canonicalRequestJson, type JsonObject, type JsonValue } from './idempotency.js';

export type ConfigurationKind = 'FEATURE_FLAG' | 'SETTING';
export type ConfigurationScopeKind =
  'CATEGORY' | 'COHORT' | 'GLOBAL' | 'INTERNAL_USER' | 'VENDOR' | 'ZONE';
export type ConfigurationStatus =
  'ACTIVE' | 'APPROVED' | 'DRAFT' | 'SCHEDULED' | 'SUPERSEDED' | 'VALIDATED';
export type ConfigurationValue = boolean | number | string | readonly JsonValue[] | JsonObject;
export type ConfigurationValueType = 'BOOLEAN' | 'INTEGER' | 'JSON' | 'STRING';

export interface ConfigurationScope {
  readonly kind: ConfigurationScopeKind;
  readonly reference: string;
}

export interface ConfigurationVersion {
  readonly configuration_key: string;
  readonly configuration_kind: ConfigurationKind;
  readonly configuration_value: ConfigurationValue;
  readonly configuration_version_id: UuidV7;
  readonly effective_from: Date | null;
  readonly effective_until: Date | null;
  readonly rollback_of_version_id: UuidV7 | null;
  readonly scope: ConfigurationScope;
  readonly status: ConfigurationStatus;
  readonly value_type: ConfigurationValueType;
  readonly version_number: number;
}

export type ResolvedConfiguration = ConfigurationVersion;

export interface FeatureFlagSubject {
  readonly category?: string;
  readonly cohort?: string;
  readonly internal_user?: string;
  readonly vendor?: string;
  readonly zone?: string;
}

export interface FeatureFlagEvaluation {
  readonly configuration_version_id: UuidV7 | null;
  readonly enabled: boolean;
  readonly matched_scope: ConfigurationScope | null;
}

export class ConfigurationTransitionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT';

  constructor() {
    super('Configuration version is not in the required lifecycle state');
    this.name = 'ConfigurationTransitionConflictError';
  }
}

export class ConfigurationApprovalConflictError extends Error {
  readonly code = 'BUSINESS_RULE_VIOLATION';

  constructor() {
    super('Configuration proposer cannot approve their own version');
    this.name = 'ConfigurationApprovalConflictError';
  }
}

export class ConfigurationOverlapError extends Error {
  readonly code = 'BUSINESS_RULE_VIOLATION';

  constructor() {
    super('Configuration key and scope already have a scheduled or active version');
    this.name = 'ConfigurationOverlapError';
  }
}

export class ConfigurationNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';

  constructor() {
    super('Configuration version was not found');
    this.name = 'ConfigurationNotFoundError';
  }
}

interface Queryable {
  query: Pool['query'];
}

interface ConfigurationRow {
  readonly configuration_key: string;
  readonly configuration_kind: ConfigurationKind;
  readonly configuration_value: ConfigurationValue;
  readonly configuration_version_id: string;
  readonly effective_from: Date | null;
  readonly effective_until: Date | null;
  readonly rollback_of_version_id: string | null;
  readonly scope_kind: ConfigurationScopeKind;
  readonly scope_reference: string;
  readonly status: ConfigurationStatus;
  readonly value_type: ConfigurationValueType;
  readonly version_number: number;
}

const KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~:-]{0,119}$/;
const RECORD_TYPE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const REASON_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const SCOPE_KINDS = new Set<ConfigurationScopeKind>([
  'CATEGORY',
  'COHORT',
  'GLOBAL',
  'INTERNAL_USER',
  'VENDOR',
  'ZONE',
]);
const CONFIGURATION_KINDS = new Set<ConfigurationKind>(['FEATURE_FLAG', 'SETTING']);
const MAX_VALUE_BYTES = 65_536;
const DEFAULT_ACTIVATION_BATCH_SIZE = 25;

export const featureFlagScopePrecedence: readonly ConfigurationScopeKind[] = Object.freeze([
  'INTERNAL_USER',
  'VENDOR',
  'CATEGORY',
  'ZONE',
  'COHORT',
  'GLOBAL',
]);

function requireKey(value: string): string {
  if (!KEY_PATTERN.test(value) || value.length > 120) {
    throw new TypeError('Configuration key must use stable lowercase dotted notation');
  }
  return value;
}

function requireScope(input: ConfigurationScope): ConfigurationScope {
  if (!SCOPE_KINDS.has(input.kind)) throw new TypeError('Configuration scope kind is invalid');
  if (
    (input.kind === 'GLOBAL' && input.reference !== 'global') ||
    (input.kind !== 'GLOBAL' && !REFERENCE_PATTERN.test(input.reference))
  ) {
    throw new TypeError('Configuration scope reference is invalid');
  }
  return Object.freeze({ kind: input.kind, reference: input.reference });
}

function requireKind(value: ConfigurationKind): ConfigurationKind {
  if (!CONFIGURATION_KINDS.has(value)) throw new TypeError('Configuration kind is invalid');
  return value;
}

function requireReason(value: string): string {
  if (!REASON_PATTERN.test(value)) throw new TypeError('Configuration reason code is invalid');
  return value;
}

function requireInstant(value: Date, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${label} must be a valid instant`);
  }
  return value;
}

function requireInteger(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

export function normalizeConfigurationValue(
  kind: ConfigurationKind,
  value: unknown,
): {
  readonly json: string;
  readonly type: ConfigurationValueType;
  readonly value: ConfigurationValue;
} {
  requireKind(kind);
  let type: ConfigurationValueType;
  if (typeof value === 'boolean') type = 'BOOLEAN';
  else if (typeof value === 'number' && Number.isSafeInteger(value)) type = 'INTEGER';
  else if (typeof value === 'string') type = 'STRING';
  else if (Array.isArray(value) || (value !== null && typeof value === 'object')) type = 'JSON';
  else
    throw new TypeError(
      'Configuration value must be a boolean, safe integer, string, object or array',
    );
  if (kind === 'FEATURE_FLAG' && type !== 'BOOLEAN') {
    throw new TypeError('Feature flags must contain a boolean value');
  }
  const json = canonicalRequestJson(value);
  if (Buffer.byteLength(json, 'utf8') > MAX_VALUE_BYTES) {
    throw new RangeError('Configuration value exceeds 65536 encoded bytes');
  }
  return Object.freeze({ json, type, value: JSON.parse(json) as ConfigurationValue });
}

function fromRow(row: ConfigurationRow): ConfigurationVersion {
  return Object.freeze({
    configuration_key: row.configuration_key,
    configuration_kind: row.configuration_kind,
    configuration_value: row.configuration_value,
    configuration_version_id: parseUuidV7(row.configuration_version_id),
    effective_from: row.effective_from,
    effective_until: row.effective_until,
    rollback_of_version_id: row.rollback_of_version_id
      ? parseUuidV7(row.rollback_of_version_id)
      : null,
    scope: Object.freeze({ kind: row.scope_kind, reference: row.scope_reference }),
    status: row.status,
    value_type: row.value_type,
    version_number: row.version_number,
  });
}

function isDatabaseConstraint(error: unknown, constraint: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'constraint' in error &&
    error.constraint === constraint
  );
}

async function appendLifecycleEvent(
  client: PoolClient,
  input: {
    readonly actor_id: UuidV7;
    readonly configuration_version_id: UuidV7;
    readonly from_status: ConfigurationStatus | null;
    readonly reason_code: string;
    readonly request_id: RequestId;
    readonly to_status: ConfigurationStatus;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO marketplace.configuration_lifecycle_events
       (event_id, configuration_version_id, from_status, to_status,
        actor_id, request_id, reason_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      createUuidV7(),
      input.configuration_version_id,
      input.from_status,
      input.to_status,
      input.actor_id,
      input.request_id,
      input.reason_code,
    ],
  );
}

async function insertDraft(
  pool: Pool,
  input: {
    readonly actor_id: string;
    readonly configuration_key: string;
    readonly configuration_kind: ConfigurationKind;
    readonly configuration_value: unknown;
    readonly correlation_id: string;
    readonly reason_code: string;
    readonly request_id: string;
    readonly rollback_of_version_id?: string;
    readonly scope: ConfigurationScope;
  },
): Promise<ConfigurationVersion> {
  const actorId = parseUuidV7(input.actor_id);
  const requestId = parseRequestId(input.request_id);
  const correlationId = parseUuidV7(input.correlation_id);
  const key = requireKey(input.configuration_key);
  const kind = requireKind(input.configuration_kind);
  const scope = requireScope(input.scope);
  const reason = requireReason(input.reason_code);
  const normalized = normalizeConfigurationValue(kind, input.configuration_value);
  const rollbackOf = input.rollback_of_version_id
    ? parseUuidV7(input.rollback_of_version_id)
    : null;
  const versionId = createUuidV7();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `${key}:${scope.kind}:${scope.reference}`,
    ]);
    if (rollbackOf) {
      const target = await client.query<ConfigurationRow>(
        `SELECT configuration_version_id, configuration_key, version_number,
                configuration_kind, value_type, configuration_value,
                scope_kind, scope_reference, status, rollback_of_version_id,
                effective_from, effective_until
           FROM marketplace.configuration_versions
          WHERE configuration_version_id = $1 AND activated_at IS NOT NULL`,
        [rollbackOf],
      );
      const row = target.rows[0];
      if (
        !row ||
        row.configuration_key !== key ||
        row.configuration_kind !== kind ||
        row.scope_kind !== scope.kind ||
        row.scope_reference !== scope.reference ||
        canonicalRequestJson(row.configuration_value) !== normalized.json
      ) {
        throw new ConfigurationTransitionConflictError();
      }
    }
    const next = await client.query<{ version_number: number }>(
      `SELECT COALESCE(max(version_number), 0)::int + 1 AS version_number
         FROM marketplace.configuration_versions
        WHERE configuration_key = $1 AND scope_kind = $2 AND scope_reference = $3`,
      [key, scope.kind, scope.reference],
    );
    const versionNumber = next.rows[0]?.version_number;
    if (!versionNumber) throw new Error('Could not allocate configuration version number');
    const inserted = await client.query<ConfigurationRow>(
      `INSERT INTO marketplace.configuration_versions
         (configuration_version_id, configuration_key, version_number,
          configuration_kind, value_type, configuration_value, scope_kind,
          scope_reference, proposed_by, request_id, correlation_id, rollback_of_version_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)
       RETURNING configuration_version_id, configuration_key, version_number,
                 configuration_kind, value_type, configuration_value, scope_kind,
                 scope_reference, status, rollback_of_version_id, effective_from, effective_until`,
      [
        versionId,
        key,
        versionNumber,
        kind,
        normalized.type,
        normalized.json,
        scope.kind,
        scope.reference,
        actorId,
        requestId,
        correlationId,
        rollbackOf,
      ],
    );
    await appendLifecycleEvent(client, {
      actor_id: actorId,
      configuration_version_id: versionId,
      from_status: null,
      reason_code: reason,
      request_id: requestId,
      to_status: 'DRAFT',
    });
    await client.query('COMMIT');
    return fromRow(inserted.rows[0] as ConfigurationRow);
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createConfigurationDraft(
  pool: Pool,
  input: {
    readonly actor_id: string;
    readonly configuration_key: string;
    readonly configuration_kind: ConfigurationKind;
    readonly configuration_value: unknown;
    readonly correlation_id: string;
    readonly reason_code?: string;
    readonly request_id: string;
    readonly scope: ConfigurationScope;
  },
): Promise<ConfigurationVersion> {
  return insertDraft(pool, {
    ...input,
    reason_code: input.reason_code ?? 'CONFIGURATION_PROPOSED',
  });
}

async function transitionConfiguration(
  pool: Pool,
  input: {
    readonly actor_id: string;
    readonly configuration_version_id: string;
    readonly from_status: 'DRAFT' | 'VALIDATED';
    readonly reason_code: string;
    readonly request_id: string;
    readonly to_status: 'APPROVED' | 'VALIDATED';
  },
): Promise<ConfigurationVersion> {
  const actorId = parseUuidV7(input.actor_id);
  const requestId = parseRequestId(input.request_id);
  const versionId = parseUuidV7(input.configuration_version_id);
  const reason = requireReason(input.reason_code);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (input.to_status === 'APPROVED') {
      const owner = await client.query<{ proposed_by: string }>(
        `SELECT proposed_by FROM marketplace.configuration_versions
          WHERE configuration_version_id = $1 FOR UPDATE`,
        [versionId],
      );
      if (owner.rows[0]?.proposed_by === actorId) throw new ConfigurationApprovalConflictError();
    }
    const actorColumn = input.to_status === 'VALIDATED' ? 'validated_by' : 'approved_by';
    const timeColumn = input.to_status === 'VALIDATED' ? 'validated_at' : 'approved_at';
    const result = await client.query<ConfigurationRow>(
      `UPDATE marketplace.configuration_versions
          SET status = $2, ${actorColumn} = $3, ${timeColumn} = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE configuration_version_id = $1 AND status = $4
      RETURNING configuration_version_id, configuration_key, version_number,
                configuration_kind, value_type, configuration_value, scope_kind,
                scope_reference, status, rollback_of_version_id, effective_from, effective_until`,
      [versionId, input.to_status, actorId, input.from_status],
    );
    if (result.rowCount !== 1) throw new ConfigurationTransitionConflictError();
    await appendLifecycleEvent(client, {
      actor_id: actorId,
      configuration_version_id: versionId,
      from_status: input.from_status,
      reason_code: reason,
      request_id: requestId,
      to_status: input.to_status,
    });
    await client.query('COMMIT');
    return fromRow(result.rows[0] as ConfigurationRow);
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function validateConfigurationVersion(
  pool: Pool,
  input: {
    readonly actor_id: string;
    readonly configuration_version_id: string;
    readonly reason_code?: string;
    readonly request_id: string;
  },
): Promise<ConfigurationVersion> {
  return transitionConfiguration(pool, {
    ...input,
    from_status: 'DRAFT',
    reason_code: input.reason_code ?? 'CONFIGURATION_VALIDATED',
    to_status: 'VALIDATED',
  });
}

export async function approveConfigurationVersion(
  pool: Pool,
  input: {
    readonly actor_id: string;
    readonly configuration_version_id: string;
    readonly reason_code?: string;
    readonly request_id: string;
  },
): Promise<ConfigurationVersion> {
  return transitionConfiguration(pool, {
    ...input,
    from_status: 'VALIDATED',
    reason_code: input.reason_code ?? 'CONFIGURATION_APPROVED',
    to_status: 'APPROVED',
  });
}

export async function scheduleConfigurationVersion(
  pool: Pool,
  input: {
    readonly actor_id: string;
    readonly configuration_version_id: string;
    readonly effective_from: Date;
    readonly effective_until?: Date | null;
    readonly reason_code?: string;
    readonly request_id: string;
  },
): Promise<ConfigurationVersion> {
  const actorId = parseUuidV7(input.actor_id);
  const requestId = parseRequestId(input.request_id);
  const versionId = parseUuidV7(input.configuration_version_id);
  const effectiveFrom = requireInstant(input.effective_from, 'Configuration effective_from');
  const effectiveUntil = input.effective_until
    ? requireInstant(input.effective_until, 'Configuration effective_until')
    : null;
  if (effectiveUntil && effectiveUntil <= effectiveFrom) {
    throw new RangeError('Configuration effective_until must be after effective_from');
  }
  const reason = requireReason(input.reason_code ?? 'CONFIGURATION_SCHEDULED');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<ConfigurationRow>(
      `UPDATE marketplace.configuration_versions
          SET status = 'SCHEDULED', effective_from = $2, effective_until = $3,
              updated_at = clock_timestamp()
        WHERE configuration_version_id = $1 AND status = 'APPROVED'
      RETURNING configuration_version_id, configuration_key, version_number,
                configuration_kind, value_type, configuration_value, scope_kind,
                scope_reference, status, rollback_of_version_id, effective_from, effective_until`,
      [versionId, effectiveFrom, effectiveUntil],
    );
    if (result.rowCount !== 1) throw new ConfigurationTransitionConflictError();
    await appendLifecycleEvent(client, {
      actor_id: actorId,
      configuration_version_id: versionId,
      from_status: 'APPROVED',
      reason_code: reason,
      request_id: requestId,
      to_status: 'SCHEDULED',
    });
    await client.query('COMMIT');
    return fromRow(result.rows[0] as ConfigurationRow);
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    if (isDatabaseConstraint(error, 'one_scheduled_configuration_per_scope')) {
      throw new ConfigurationOverlapError();
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function activateConfigurationVersion(
  pool: Pool,
  input: {
    readonly actor_id: string;
    readonly at?: Date;
    readonly configuration_version_id: string;
    readonly reason_code?: string;
    readonly request_id: string;
  },
): Promise<ConfigurationVersion> {
  const actorId = parseUuidV7(input.actor_id);
  const requestId = parseRequestId(input.request_id);
  const versionId = parseUuidV7(input.configuration_version_id);
  const at = requireInstant(input.at ?? new Date(), 'Configuration activation instant');
  const reason = requireReason(input.reason_code ?? 'CONFIGURATION_ACTIVATED');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const targetResult = await client.query<ConfigurationRow>(
      `SELECT configuration_version_id, configuration_key, version_number,
              configuration_kind, value_type, configuration_value, scope_kind,
              scope_reference, status, rollback_of_version_id, effective_from, effective_until
         FROM marketplace.configuration_versions
        WHERE configuration_version_id = $1 AND status = 'SCHEDULED'
        FOR UPDATE`,
      [versionId],
    );
    const target = targetResult.rows[0];
    if (
      !target ||
      !target.effective_from ||
      target.effective_from > at ||
      (target.effective_until !== null && target.effective_until <= at)
    ) {
      throw new ConfigurationTransitionConflictError();
    }
    const currentResult = await client.query<ConfigurationRow>(
      `SELECT configuration_version_id, configuration_key, version_number,
              configuration_kind, value_type, configuration_value, scope_kind,
              scope_reference, status, rollback_of_version_id, effective_from, effective_until
         FROM marketplace.configuration_versions
        WHERE configuration_key = $1 AND scope_kind = $2 AND scope_reference = $3
          AND status = 'ACTIVE'
        FOR UPDATE`,
      [target.configuration_key, target.scope_kind, target.scope_reference],
    );
    const current = currentResult.rows[0];
    if (current) {
      if (!current.effective_from || current.effective_from >= target.effective_from) {
        throw new ConfigurationOverlapError();
      }
      await client.query(
        `UPDATE marketplace.configuration_versions
            SET status = 'SUPERSEDED',
                effective_until = LEAST(COALESCE(effective_until, $2), $2),
                superseded_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE configuration_version_id = $1 AND status = 'ACTIVE'`,
        [current.configuration_version_id, target.effective_from],
      );
      await appendLifecycleEvent(client, {
        actor_id: actorId,
        configuration_version_id: parseUuidV7(current.configuration_version_id),
        from_status: 'ACTIVE',
        reason_code: 'CONFIGURATION_SUPERSEDED',
        request_id: requestId,
        to_status: 'SUPERSEDED',
      });
    }
    const activated = await client.query<ConfigurationRow>(
      `UPDATE marketplace.configuration_versions
          SET status = 'ACTIVE', activated_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE configuration_version_id = $1 AND status = 'SCHEDULED'
      RETURNING configuration_version_id, configuration_key, version_number,
                configuration_kind, value_type, configuration_value, scope_kind,
                scope_reference, status, rollback_of_version_id, effective_from, effective_until`,
      [versionId],
    );
    if (activated.rowCount !== 1) throw new ConfigurationTransitionConflictError();
    await appendLifecycleEvent(client, {
      actor_id: actorId,
      configuration_version_id: versionId,
      from_status: 'SCHEDULED',
      reason_code: reason,
      request_id: requestId,
      to_status: 'ACTIVE',
    });
    await client.query('COMMIT');
    return fromRow(activated.rows[0] as ConfigurationRow);
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    if (isDatabaseConstraint(error, 'one_active_configuration_per_scope')) {
      throw new ConfigurationOverlapError();
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function activateDueConfigurationVersions(
  pool: Pool,
  input: {
    readonly actor_id: string;
    readonly at?: Date;
    readonly batch_size?: number;
    readonly request_id: string;
  },
): Promise<readonly ConfigurationVersion[]> {
  const at = requireInstant(input.at ?? new Date(), 'Configuration activation instant');
  const batchSize = requireInteger(
    input.batch_size ?? DEFAULT_ACTIVATION_BATCH_SIZE,
    'Configuration activation batch size',
    1,
    100,
  );
  const due = await pool.query<{ configuration_version_id: string }>(
    `SELECT configuration_version_id
       FROM marketplace.configuration_versions
      WHERE status = 'SCHEDULED' AND effective_from <= $1
      ORDER BY effective_from, configuration_version_id
      LIMIT $2`,
    [at, batchSize],
  );
  const activated: ConfigurationVersion[] = [];
  for (const row of due.rows) {
    try {
      activated.push(
        await activateConfigurationVersion(pool, {
          actor_id: input.actor_id,
          at,
          configuration_version_id: row.configuration_version_id,
          request_id: input.request_id,
        }),
      );
    } catch (error: unknown) {
      if (!(error instanceof ConfigurationTransitionConflictError)) throw error;
    }
  }
  return Object.freeze(activated);
}

export async function createConfigurationRollbackDraft(
  pool: Pool,
  input: {
    readonly actor_id: string;
    readonly correlation_id: string;
    readonly reason_code: string;
    readonly request_id: string;
    readonly target_version_id: string;
  },
): Promise<ConfigurationVersion> {
  const targetId = parseUuidV7(input.target_version_id);
  const target = await pool.query<ConfigurationRow>(
    `SELECT configuration_version_id, configuration_key, version_number,
            configuration_kind, value_type, configuration_value, scope_kind,
            scope_reference, status, rollback_of_version_id, effective_from, effective_until
       FROM marketplace.configuration_versions
      WHERE configuration_version_id = $1 AND activated_at IS NOT NULL`,
    [targetId],
  );
  const row = target.rows[0];
  if (!row) throw new ConfigurationNotFoundError();
  return insertDraft(pool, {
    actor_id: input.actor_id,
    configuration_key: row.configuration_key,
    configuration_kind: row.configuration_kind,
    configuration_value: row.configuration_value,
    correlation_id: input.correlation_id,
    reason_code: input.reason_code,
    request_id: input.request_id,
    rollback_of_version_id: targetId,
    scope: { kind: row.scope_kind, reference: row.scope_reference },
  });
}

function normalizedSubject(subject: FeatureFlagSubject): Required<FeatureFlagSubject> {
  const normalize = (value: string | undefined): string => {
    if (value === undefined) return '';
    if (!REFERENCE_PATTERN.test(value))
      throw new TypeError('Feature flag subject reference is invalid');
    return value;
  };
  return Object.freeze({
    category: normalize(subject.category),
    cohort: normalize(subject.cohort),
    internal_user: normalize(subject.internal_user),
    vendor: normalize(subject.vendor),
    zone: normalize(subject.zone),
  });
}

export async function resolveConfiguration(
  queryable: Queryable,
  input: {
    readonly at?: Date;
    readonly configuration_key: string;
    readonly configuration_kind?: ConfigurationKind;
    readonly subject?: FeatureFlagSubject;
  },
): Promise<ResolvedConfiguration | null> {
  const key = requireKey(input.configuration_key);
  const kind = input.configuration_kind ? requireKind(input.configuration_kind) : null;
  const at = requireInstant(input.at ?? new Date(), 'Configuration evaluation instant');
  const subject = normalizedSubject(input.subject ?? {});
  const result = await queryable.query<ConfigurationRow>(
    `SELECT configuration_version_id, configuration_key, version_number,
            configuration_kind, value_type, configuration_value, scope_kind,
            scope_reference, status, rollback_of_version_id, effective_from, effective_until
       FROM marketplace.configuration_versions
      WHERE configuration_key = $1 AND status = 'ACTIVE'
        AND ($2::text IS NULL OR configuration_kind = $2)
        AND effective_from <= $3 AND (effective_until IS NULL OR effective_until > $3)
        AND (
          (scope_kind = 'INTERNAL_USER' AND scope_reference = $4)
          OR (scope_kind = 'VENDOR' AND scope_reference = $5)
          OR (scope_kind = 'CATEGORY' AND scope_reference = $6)
          OR (scope_kind = 'ZONE' AND scope_reference = $7)
          OR (scope_kind = 'COHORT' AND scope_reference = $8)
          OR (scope_kind = 'GLOBAL' AND scope_reference = 'global')
        )
      ORDER BY CASE scope_kind
        WHEN 'INTERNAL_USER' THEN 1
        WHEN 'VENDOR' THEN 2
        WHEN 'CATEGORY' THEN 3
        WHEN 'ZONE' THEN 4
        WHEN 'COHORT' THEN 5
        ELSE 6
      END
      LIMIT 1`,
    [
      key,
      kind,
      at,
      subject.internal_user,
      subject.vendor,
      subject.category,
      subject.zone,
      subject.cohort,
    ],
  );
  return result.rows[0] ? fromRow(result.rows[0]) : null;
}

export async function evaluateFeatureFlag(
  queryable: Queryable,
  input: {
    readonly at?: Date;
    readonly configuration_key: string;
    readonly subject?: FeatureFlagSubject;
  },
): Promise<FeatureFlagEvaluation> {
  const resolved = await resolveConfiguration(queryable, {
    ...(input.at ? { at: input.at } : {}),
    configuration_key: input.configuration_key,
    configuration_kind: 'FEATURE_FLAG',
    ...(input.subject ? { subject: input.subject } : {}),
  });
  if (!resolved) {
    return Object.freeze({ configuration_version_id: null, enabled: false, matched_scope: null });
  }
  if (typeof resolved.configuration_value !== 'boolean') {
    throw new Error('Resolved feature flag did not contain a boolean');
  }
  return Object.freeze({
    configuration_version_id: resolved.configuration_version_id,
    enabled: resolved.configuration_value,
    matched_scope: resolved.scope,
  });
}

export async function snapshotConfigurationVersions(
  client: PoolClient,
  input: {
    readonly business_record_id: string;
    readonly business_record_type: string;
    readonly versions: readonly {
      readonly configuration_key: string;
      readonly configuration_version_id: string;
    }[];
  },
): Promise<void> {
  const recordId = parseUuidV7(input.business_record_id);
  if (!RECORD_TYPE_PATTERN.test(input.business_record_type)) {
    throw new TypeError('Business record type is invalid');
  }
  if (input.versions.length < 1 || input.versions.length > 50) {
    throw new RangeError('Business configuration snapshot must contain 1 to 50 versions');
  }
  const keys = input.versions.map((entry) => requireKey(entry.configuration_key));
  if (new Set(keys).size !== keys.length) {
    throw new TypeError('Business configuration snapshot keys must be unique');
  }
  const versionIds = input.versions.map((entry) => parseUuidV7(entry.configuration_version_id));
  await client.query(
    `INSERT INTO marketplace.business_configuration_snapshots
       (business_record_type, business_record_id, configuration_key, configuration_version_id)
     SELECT $1, $2, input.configuration_key, version.configuration_version_id
       FROM unnest($3::text[], $4::uuid[]) AS input(configuration_key, configuration_version_id)
       JOIN marketplace.configuration_versions version
         ON version.configuration_version_id = input.configuration_version_id
        AND version.configuration_key = input.configuration_key
        AND version.activated_at IS NOT NULL
     ON CONFLICT (business_record_type, business_record_id, configuration_key) DO NOTHING`,
    [input.business_record_type, recordId, keys, versionIds],
  );
  const stored = await client.query<{
    configuration_key: string;
    configuration_version_id: string;
  }>(
    `SELECT configuration_key, configuration_version_id
       FROM marketplace.business_configuration_snapshots
      WHERE business_record_type = $1 AND business_record_id = $2
        AND configuration_key = ANY($3::text[])`,
    [input.business_record_type, recordId, keys],
  );
  const expected = new Map(keys.map((key, index) => [key, versionIds[index]]));
  if (
    stored.rowCount !== keys.length ||
    stored.rows.some((row) => expected.get(row.configuration_key) !== row.configuration_version_id)
  ) {
    throw new ConfigurationTransitionConflictError();
  }
}
