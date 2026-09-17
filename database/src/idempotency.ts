import { createHash } from 'node:crypto';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestId,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import type { Pool, PoolClient } from 'pg';

export type JsonValue = boolean | number | string | null | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type IdempotencyStatus = 'FAILED' | 'IN_PROGRESS' | 'SUCCEEDED' | 'UNCERTAIN';

export interface CompletedCommandOutcome {
  readonly kind: 'completed';
  readonly http_status: number;
  readonly response_body: JsonValue;
}

export interface UncertainCommandOutcome {
  readonly kind: 'uncertain';
  readonly reconciliation_due_at: Date;
  readonly response_body: JsonValue;
}

export type CommandOutcome = CompletedCommandOutcome | UncertainCommandOutcome;

export interface IdempotencyExecutionResult {
  readonly record_id: UuidV7;
  readonly status: IdempotencyStatus;
  readonly http_status: number;
  readonly response_body: JsonValue;
  readonly replayed: boolean;
  readonly request_hash: string;
}

export class IdempotencyKeyReusedError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';

  constructor() {
    super('Idempotency key was already used with a different request');
    this.name = 'IdempotencyKeyReusedError';
  }
}

interface IdempotencyRecordRow {
  readonly record_id: string;
  readonly request_hash: string;
  readonly request_id: string;
  readonly status: IdempotencyStatus;
  readonly http_status: number | null;
  readonly response_body: JsonValue | null;
  readonly lease_expired: boolean;
}

const COMMAND_SCOPE_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9_]+)+$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:-]{8,200}$/;
const NORMAL_RETENTION_MS = 25 * 60 * 60 * 1000;
const UNCERTAIN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * How long to wait before an abandoned command is due for reconciliation.
 *
 * Retention and reconciliation timing are different questions and were the same
 * number. A lease expires when the process running a command died mid-flight, so its
 * outcome is genuinely unknown -- exactly the case D-15 says must enter reconciliation
 * rather than be retried. Setting the due date to the seven-day retention window meant
 * a crashed payment authorization would not be looked at for a week. The record is
 * still kept for seven days; it simply becomes due promptly, leaving the provider a
 * moment to settle first.
 */
const UNCERTAIN_RECONCILIATION_DELAY_MS = 60 * 1000;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_WAIT_MS = 5_000;
const DEFAULT_POLL_MS = 20;

function canonicalize(value: unknown, seen: WeakSet<object>): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON numbers must be finite');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object')
    throw new TypeError('Command bodies must contain only JSON values');
  if (seen.has(value)) throw new TypeError('Command bodies must not contain cycles');
  seen.add(value);

  if (Array.isArray(value)) {
    const output = value.map((entry) => canonicalize(entry, seen));
    seen.delete(value);
    return output;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError('Command bodies must contain plain JSON objects');
  }
  const output: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    output[key] = canonicalize((value as Record<string, unknown>)[key], seen);
  }
  seen.delete(value);
  return output;
}

export function canonicalRequestJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new WeakSet<object>()));
}

export function canonicalRequestHash(value: unknown): string {
  return createHash('sha256').update(canonicalRequestJson(value)).digest('hex');
}

function serializeResponseBody(value: JsonValue): string {
  const canonical = canonicalize(value, new WeakSet<object>());
  if (canonical === null) {
    throw new TypeError('Command response bodies must not be top-level null');
  }
  return JSON.stringify(canonical);
}

function validateCommandScope(value: string): string {
  if (!COMMAND_SCOPE_PATTERN.test(value) || value.length > 120) {
    throw new TypeError('Command scope must use stable lowercase dotted notation');
  }
  return value;
}

function validateIdempotencyKey(value: string): string {
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new TypeError('Idempotency key must be 8-200 safe opaque characters');
  }
  return value;
}

function validateHttpStatus(value: number): number {
  if (!Number.isInteger(value) || value < 100 || value > 599) {
    throw new RangeError('Command HTTP status must be an integer from 100 to 599');
  }
  return value;
}

function resultFromRow(
  row: IdempotencyRecordRow,
  requestHash: string,
  replayed: boolean,
): IdempotencyExecutionResult | null {
  if (row.status === 'IN_PROGRESS' || row.http_status === null || row.response_body === null) {
    return null;
  }
  return Object.freeze({
    record_id: parseUuidV7(row.record_id),
    status: row.status,
    http_status: row.http_status,
    response_body: row.response_body,
    replayed,
    request_hash: requestHash,
  });
}

async function readRecord(
  client: PoolClient,
  actorId: UuidV7,
  commandScope: string,
  idempotencyKey: string,
): Promise<IdempotencyRecordRow> {
  const result = await client.query<IdempotencyRecordRow>(
    `SELECT record_id, request_hash, request_id, status, http_status, response_body,
            lease_expires_at <= clock_timestamp() AS lease_expired
       FROM marketplace.idempotency_records
      WHERE actor_id = $1 AND command_scope = $2 AND idempotency_key = $3`,
    [actorId, commandScope, idempotencyKey],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Idempotency record disappeared after claim');
  return row;
}

async function markExpiredLeaseUncertain(
  client: PoolClient,
  row: IdempotencyRecordRow,
): Promise<IdempotencyRecordRow> {
  const reconciliationDueAt = new Date(Date.now() + UNCERTAIN_RECONCILIATION_DELAY_MS);
  const responseBody: JsonObject = {
    status: 'outcome_unknown',
    request_id: row.request_id,
  };
  const result = await client.query<IdempotencyRecordRow>(
    `UPDATE marketplace.idempotency_records
        SET status = 'UNCERTAIN', http_status = 202, response_body = $2::jsonb,
            reconciliation_due_at = $3,
            expires_at = greatest($3, created_at + interval '7 days'),
            updated_at = clock_timestamp()
      WHERE record_id = $1 AND status = 'IN_PROGRESS' AND lease_expires_at <= clock_timestamp()
      RETURNING record_id, request_hash, request_id, status, http_status, response_body,
                false AS lease_expired`,
    [row.record_id, JSON.stringify(responseBody), reconciliationDueAt],
  );
  return result.rows[0] ?? row;
}

async function waitForTerminalRecord(
  pool: Pool,
  input: {
    readonly actor_id: UuidV7;
    readonly command_scope: string;
    readonly idempotency_key: string;
    readonly request_hash: string;
    readonly request_id: RequestId;
    readonly wait_timeout_ms: number;
    readonly poll_interval_ms: number;
  },
): Promise<IdempotencyExecutionResult> {
  const deadline = Date.now() + input.wait_timeout_ms;
  const client = await pool.connect();
  try {
    while (Date.now() <= deadline) {
      let row = await readRecord(
        client,
        input.actor_id,
        input.command_scope,
        input.idempotency_key,
      );
      if (row.request_hash !== input.request_hash) throw new IdempotencyKeyReusedError();
      if (row.status === 'IN_PROGRESS' && row.lease_expired) {
        row = await markExpiredLeaseUncertain(client, row);
      }
      const replay = resultFromRow(row, input.request_hash, true);
      if (replay) return replay;
      await new Promise((resolve) => setTimeout(resolve, input.poll_interval_ms));
    }
    return Object.freeze({
      record_id: parseUuidV7(
        (await readRecord(client, input.actor_id, input.command_scope, input.idempotency_key))
          .record_id,
      ),
      status: 'IN_PROGRESS',
      http_status: 202,
      response_body: { status: 'in_progress', request_id: input.request_id },
      replayed: true,
      request_hash: input.request_hash,
    });
  } finally {
    client.release();
  }
}

async function finalizeRecord(
  pool: Pool,
  recordId: UuidV7,
  requestHash: string,
  outcome: CommandOutcome,
): Promise<IdempotencyExecutionResult> {
  const uncertain = outcome.kind === 'uncertain';
  const status: IdempotencyStatus = uncertain
    ? 'UNCERTAIN'
    : outcome.http_status >= 400
      ? 'FAILED'
      : 'SUCCEEDED';
  const httpStatus = uncertain ? 202 : validateHttpStatus(outcome.http_status);
  const reconciliationDueAt = uncertain ? outcome.reconciliation_due_at : null;
  if (reconciliationDueAt && reconciliationDueAt.getTime() <= Date.now()) {
    throw new RangeError('Uncertain outcomes require a future reconciliation deadline');
  }
  const minimumExpiry = new Date(
    Date.now() + (uncertain ? UNCERTAIN_RETENTION_MS : NORMAL_RETENTION_MS),
  );
  const expiresAt =
    reconciliationDueAt && reconciliationDueAt > minimumExpiry
      ? reconciliationDueAt
      : minimumExpiry;
  const responseBody = serializeResponseBody(outcome.response_body);
  const client = await pool.connect();
  try {
    const result = await client.query<IdempotencyRecordRow>(
      `UPDATE marketplace.idempotency_records
          SET status = $2, http_status = $3, response_body = $4::jsonb,
              reconciliation_due_at = $5,
              expires_at = CASE
                WHEN $2 = 'UNCERTAIN'
                  THEN greatest($6, created_at + interval '7 days')
                ELSE $6
              END,
              updated_at = clock_timestamp()
        WHERE record_id = $1 AND status = 'IN_PROGRESS'
        RETURNING record_id, request_hash, request_id, status, http_status, response_body,
                  false AS lease_expired`,
      [recordId, status, httpStatus, responseBody, reconciliationDueAt, expiresAt],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Idempotency claim was no longer owned during finalization');
    const finalized = resultFromRow(row, requestHash, false);
    if (!finalized) throw new Error('Idempotency finalization did not create a terminal result');
    return finalized;
  } finally {
    client.release();
  }
}

export async function reconcileUncertainCommand(
  pool: Pool,
  input: {
    readonly record_id: string;
    readonly outcome: CompletedCommandOutcome;
  },
): Promise<IdempotencyExecutionResult> {
  const recordId = parseUuidV7(input.record_id);
  const httpStatus = validateHttpStatus(input.outcome.http_status);
  const status: IdempotencyStatus = httpStatus >= 400 ? 'FAILED' : 'SUCCEEDED';
  const responseBody = serializeResponseBody(input.outcome.response_body);
  const client = await pool.connect();
  try {
    const result = await client.query<IdempotencyRecordRow>(
      `UPDATE marketplace.idempotency_records
          SET status = $2, http_status = $3, response_body = $4::jsonb,
              reconciliation_due_at = NULL,
              expires_at = greatest(expires_at, clock_timestamp() + interval '24 hours'),
              updated_at = clock_timestamp()
        WHERE record_id = $1 AND status = 'UNCERTAIN'
        RETURNING record_id, request_hash, request_id, status, http_status, response_body,
                  false AS lease_expired`,
      [recordId, status, httpStatus, responseBody],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Only an uncertain idempotency record can be reconciled');
    const reconciled = resultFromRow(row, row.request_hash, false);
    if (!reconciled) throw new Error('Reconciliation did not create a terminal result');
    return reconciled;
  } finally {
    client.release();
  }
}

export async function executeIdempotentCommand(
  pool: Pool,
  input: {
    readonly actor_id: string;
    readonly command_scope: string;
    readonly idempotency_key: string;
    readonly request_body: unknown;
    readonly request_id: string;
  },
  handler: () => Promise<CommandOutcome>,
  options: {
    readonly lease_ms?: number;
    readonly poll_interval_ms?: number;
    readonly wait_timeout_ms?: number;
  } = {},
): Promise<IdempotencyExecutionResult> {
  const actorId = parseUuidV7(input.actor_id);
  const requestId = parseRequestId(input.request_id);
  const commandScope = validateCommandScope(input.command_scope);
  const idempotencyKey = validateIdempotencyKey(input.idempotency_key);
  const requestHash = canonicalRequestHash(input.request_body);
  const leaseMs = options.lease_ms ?? DEFAULT_LEASE_MS;
  const waitTimeoutMs = options.wait_timeout_ms ?? DEFAULT_WAIT_MS;
  const pollIntervalMs = options.poll_interval_ms ?? DEFAULT_POLL_MS;
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000)
    throw new RangeError('Lease must be at least one second');
  if (!Number.isInteger(waitTimeoutMs) || waitTimeoutMs < 0)
    throw new RangeError('Wait timeout is invalid');
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 5)
    throw new RangeError('Poll interval is invalid');

  const recordId = createUuidV7();
  const now = Date.now();
  const client = await pool.connect();
  let claimed: boolean;
  try {
    await client.query('BEGIN');
    const inserted = await client.query<{ record_id: string }>(
      `INSERT INTO marketplace.idempotency_records
         (record_id, actor_id, command_scope, idempotency_key, request_hash, request_id,
          status, lease_expires_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'IN_PROGRESS', $7, $8)
       ON CONFLICT (actor_id, command_scope, idempotency_key) DO NOTHING
       RETURNING record_id`,
      [
        recordId,
        actorId,
        commandScope,
        idempotencyKey,
        requestHash,
        requestId,
        new Date(now + leaseMs),
        new Date(now + NORMAL_RETENTION_MS),
      ],
    );
    claimed = inserted.rowCount === 1;
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (!claimed) {
    return waitForTerminalRecord(pool, {
      actor_id: actorId,
      command_scope: commandScope,
      idempotency_key: idempotencyKey,
      request_hash: requestHash,
      request_id: requestId,
      wait_timeout_ms: waitTimeoutMs,
      poll_interval_ms: pollIntervalMs,
    });
  }

  let outcome: CommandOutcome;
  try {
    outcome = await handler();
  } catch {
    outcome = {
      kind: 'uncertain',
      reconciliation_due_at: new Date(Date.now() + UNCERTAIN_RETENTION_MS),
      response_body: { status: 'outcome_unknown', request_id: requestId },
    };
  }
  return finalizeRecord(pool, recordId, requestHash, outcome);
}
