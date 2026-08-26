import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestId,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import type { Pool, PoolClient } from 'pg';
import { canonicalRequestJson, type JsonObject } from './idempotency.js';

export type OutboxStatus = 'DEAD_LETTER' | 'PENDING' | 'PUBLISHED' | 'PUBLISHING';

export interface OutboxEvent {
  readonly aggregate_id: UuidV7;
  readonly aggregate_type: string;
  readonly aggregate_version: number;
  readonly attempt_count: number;
  readonly causation_id: UuidV7 | null;
  readonly correlation_id: UuidV7;
  readonly event_id: UuidV7;
  readonly event_type: string;
  readonly max_attempts: number;
  readonly payload: JsonObject;
  readonly request_id: RequestId;
  readonly status: OutboxStatus;
}

export interface OutboxDispatchSummary {
  readonly claimed: number;
  readonly dead_lettered: number;
  readonly lost_claim: number;
  readonly published: number;
  readonly scheduled_for_retry: number;
}

export class OutboxRecoveryConflictError extends Error {
  readonly code = 'BUSINESS_RULE_VIOLATION';

  constructor() {
    super('Only a dead-lettered outbox event can be recovered');
    this.name = 'OutboxRecoveryConflictError';
  }
}

interface OutboxEventRow {
  readonly aggregate_id: string;
  readonly aggregate_type: string;
  readonly aggregate_version: number;
  readonly attempt_count: number;
  readonly causation_id: string | null;
  readonly correlation_id: string;
  readonly event_id: string;
  readonly event_type: string;
  readonly last_error_code: string | null;
  readonly max_attempts: number;
  readonly payload: JsonObject;
  readonly request_id: string;
  readonly status: OutboxStatus;
}

const AGGREGATE_TYPE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const DOTTED_SCOPE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CLAIM_LEASE_MS = 30_000;
const DEFAULT_BACKOFF_BASE_MS = 1_000;
const DEFAULT_BACKOFF_MAX_MS = 5 * 60 * 1_000;

function requireAggregateType(value: string): string {
  if (!AGGREGATE_TYPE_PATTERN.test(value)) throw new TypeError('Outbox aggregate type is invalid');
  return value;
}

function requireDottedScope(value: string, label: string): string {
  if (!DOTTED_SCOPE_PATTERN.test(value) || value.length > 120) {
    throw new TypeError(`${label} must use stable lowercase dotted notation`);
  }
  return value;
}

function requirePositiveInteger(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function requirePayload(value: unknown): string {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError('Outbox payload must be a JSON object');
  }
  return canonicalRequestJson(value);
}

function safeErrorCode(value: string): string {
  return ERROR_CODE_PATTERN.test(value) ? value : 'PUBLISH_FAILED';
}

function fromRow(row: OutboxEventRow): OutboxEvent {
  return Object.freeze({
    aggregate_id: parseUuidV7(row.aggregate_id),
    aggregate_type: row.aggregate_type,
    aggregate_version: row.aggregate_version,
    attempt_count: row.attempt_count,
    causation_id: row.causation_id ? parseUuidV7(row.causation_id) : null,
    correlation_id: parseUuidV7(row.correlation_id),
    event_id: parseUuidV7(row.event_id),
    event_type: row.event_type,
    max_attempts: row.max_attempts,
    payload: Object.freeze(row.payload),
    request_id: parseRequestId(row.request_id),
    status: row.status,
  });
}

export function outboxBackoffMs(
  attemptCount: number,
  baseMs = DEFAULT_BACKOFF_BASE_MS,
  maximumMs = DEFAULT_BACKOFF_MAX_MS,
): number {
  requirePositiveInteger(attemptCount, 'Attempt count', 25);
  requirePositiveInteger(baseMs, 'Backoff base', 60_000);
  requirePositiveInteger(maximumMs, 'Backoff maximum', 24 * 60 * 60 * 1_000);
  if (baseMs > maximumMs) throw new RangeError('Backoff base cannot exceed its maximum');
  return Math.min(maximumMs, baseMs * 2 ** Math.min(attemptCount - 1, 20));
}

export async function enqueueOutboxEvent(
  client: PoolClient,
  input: {
    readonly aggregate_id: string;
    readonly aggregate_type: string;
    readonly aggregate_version: number;
    readonly causation_id?: string | null;
    readonly correlation_id: string;
    readonly event_id?: string;
    readonly event_type: string;
    readonly max_attempts?: number;
    readonly payload: JsonObject;
    readonly request_id: string;
  },
): Promise<UuidV7> {
  const eventId = input.event_id ? parseUuidV7(input.event_id) : createUuidV7();
  const aggregateType = requireAggregateType(input.aggregate_type);
  const aggregateId = parseUuidV7(input.aggregate_id);
  const aggregateVersion = requirePositiveInteger(
    input.aggregate_version,
    'Aggregate version',
    Number.MAX_SAFE_INTEGER,
  );
  const eventType = requireDottedScope(input.event_type, 'Event type');
  const maxAttempts = requirePositiveInteger(
    input.max_attempts ?? DEFAULT_MAX_ATTEMPTS,
    'Maximum attempts',
    25,
  );
  const requestId = parseRequestId(input.request_id);
  const correlationId = parseUuidV7(input.correlation_id);
  const causationId = input.causation_id ? parseUuidV7(input.causation_id) : null;
  const payload = requirePayload(input.payload);
  await client.query(
    `INSERT INTO marketplace.outbox_events
       (event_id, aggregate_type, aggregate_id, aggregate_version, event_type, payload,
        request_id, correlation_id, causation_id, max_attempts)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
    [
      eventId,
      aggregateType,
      aggregateId,
      aggregateVersion,
      eventType,
      payload,
      requestId,
      correlationId,
      causationId,
      maxAttempts,
    ],
  );
  return eventId;
}

export async function claimOutboxBatch(
  pool: Pool,
  input: {
    readonly batch_size?: number;
    readonly claim_lease_ms?: number;
    readonly worker_id: string;
  },
): Promise<readonly OutboxEvent[]> {
  const batchSize = requirePositiveInteger(
    input.batch_size ?? DEFAULT_BATCH_SIZE,
    'Outbox batch size',
    100,
  );
  const leaseMs = requirePositiveInteger(
    input.claim_lease_ms ?? DEFAULT_CLAIM_LEASE_MS,
    'Claim lease',
    5 * 60 * 1_000,
  );
  if (leaseMs < 1_000) throw new RangeError('Claim lease must be at least one second');
  const workerId = parseUuidV7(input.worker_id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE marketplace.outbox_events
          SET status = 'DEAD_LETTER', claimed_by = NULL, claim_until = NULL,
              last_error_code = 'CLAIM_LEASE_EXHAUSTED', updated_at = clock_timestamp()
        WHERE status = 'PUBLISHING' AND claim_until <= clock_timestamp()
          AND attempt_count >= max_attempts`,
    );
    const result = await client.query<OutboxEventRow>(
      `WITH candidates AS (
         SELECT event_id
           FROM marketplace.outbox_events
          WHERE
            (status = 'PENDING' AND available_at <= clock_timestamp())
            OR
            (status = 'PUBLISHING' AND claim_until <= clock_timestamp()
              AND attempt_count < max_attempts)
          ORDER BY available_at, created_at, event_id
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE marketplace.outbox_events event
          SET status = 'PUBLISHING', claimed_by = $2,
              claim_until = clock_timestamp() + ($3 * interval '1 millisecond'),
              attempt_count = event.attempt_count + 1,
              updated_at = clock_timestamp()
         FROM candidates
        WHERE event.event_id = candidates.event_id
       RETURNING event.event_id, event.aggregate_type, event.aggregate_id,
                 event.aggregate_version, event.event_type, event.payload, event.request_id,
                 event.correlation_id, event.causation_id, event.status, event.attempt_count,
                 event.max_attempts, event.last_error_code`,
      [batchSize, workerId, leaseMs],
    );
    await client.query('COMMIT');
    return Object.freeze(result.rows.map(fromRow));
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function dispatchOutboxBatch(
  pool: Pool,
  input: {
    readonly backoff_base_ms?: number;
    readonly backoff_max_ms?: number;
    readonly batch_size?: number;
    readonly claim_lease_ms?: number;
    readonly classify_error?: (error: unknown) => string;
    readonly publish: (event: OutboxEvent) => Promise<void>;
    readonly worker_id: string;
  },
): Promise<OutboxDispatchSummary> {
  const events = await claimOutboxBatch(pool, input);
  let deadLettered = 0;
  let lostClaim = 0;
  let published = 0;
  let scheduledForRetry = 0;
  for (const event of events) {
    try {
      await input.publish(event);
      const result = await pool.query(
        `UPDATE marketplace.outbox_events
            SET status = 'PUBLISHED', claimed_by = NULL, claim_until = NULL,
                published_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE event_id = $1 AND status = 'PUBLISHING' AND claimed_by = $2`,
        [event.event_id, input.worker_id],
      );
      if (result.rowCount === 1) published += 1;
      else lostClaim += 1;
    } catch (error: unknown) {
      const terminal = event.attempt_count >= event.max_attempts;
      const errorCode = safeErrorCode(input.classify_error?.(error) ?? 'PUBLISH_FAILED');
      const delayMs = terminal
        ? 0
        : outboxBackoffMs(event.attempt_count, input.backoff_base_ms, input.backoff_max_ms);
      const result = await pool.query(
        `UPDATE marketplace.outbox_events
            SET status = $3, claimed_by = NULL, claim_until = NULL,
                available_at = CASE
                  WHEN $3 = 'PENDING'
                    THEN clock_timestamp() + ($4 * interval '1 millisecond')
                  ELSE available_at
                END,
                last_error_code = $5, updated_at = clock_timestamp()
          WHERE event_id = $1 AND status = 'PUBLISHING' AND claimed_by = $2`,
        [event.event_id, input.worker_id, terminal ? 'DEAD_LETTER' : 'PENDING', delayMs, errorCode],
      );
      if (result.rowCount !== 1) lostClaim += 1;
      else if (terminal) deadLettered += 1;
      else scheduledForRetry += 1;
    }
  }
  return Object.freeze({
    claimed: events.length,
    dead_lettered: deadLettered,
    lost_claim: lostClaim,
    published,
    scheduled_for_retry: scheduledForRetry,
  });
}

export async function processInboxEvent<T>(
  pool: Pool,
  input: {
    readonly consumer_scope: string;
    readonly correlation_id: string;
    readonly event_id: string;
    readonly request_id: string;
  },
  handler: (client: PoolClient, event: OutboxEvent) => Promise<T>,
): Promise<{ readonly processed: boolean; readonly result: T | null }> {
  const consumerScope = requireDottedScope(input.consumer_scope, 'Consumer scope');
  const eventId = parseUuidV7(input.event_id);
  const requestId = parseRequestId(input.request_id);
  const correlationId = parseUuidV7(input.correlation_id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const eventResult = await client.query<OutboxEventRow>(
      `SELECT event_id, aggregate_type, aggregate_id, aggregate_version, event_type, payload,
              request_id, correlation_id, causation_id, status, attempt_count, max_attempts,
              last_error_code
         FROM marketplace.outbox_events
        WHERE event_id = $1`,
      [eventId],
    );
    const eventRow = eventResult.rows[0];
    if (!eventRow) throw new Error('Inbox event does not exist in the outbox');
    if (eventRow.status !== 'PUBLISHING' && eventRow.status !== 'PUBLISHED') {
      throw new Error('Inbox event is not currently dispatchable');
    }
    const inserted = await client.query(
      `INSERT INTO marketplace.inbox_receipts
         (consumer_scope, event_id, status, request_id, correlation_id)
       VALUES ($1, $2, 'PROCESSING', $3, $4)
       ON CONFLICT (consumer_scope, event_id) DO NOTHING`,
      [consumerScope, eventId, requestId, correlationId],
    );
    if (inserted.rowCount !== 1) {
      await client.query('COMMIT');
      return Object.freeze({ processed: false, result: null });
    }
    const result = await handler(client, fromRow(eventRow));
    await client.query(
      `UPDATE marketplace.inbox_receipts
          SET status = 'PROCESSED', processed_at = clock_timestamp()
        WHERE consumer_scope = $1 AND event_id = $2 AND status = 'PROCESSING'`,
      [consumerScope, eventId],
    );
    await client.query('COMMIT');
    return Object.freeze({ processed: true, result });
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listDeadLetterEvents(
  pool: Pool,
  limit = DEFAULT_BATCH_SIZE,
): Promise<readonly (OutboxEvent & { readonly last_error_code: string })[]> {
  const boundedLimit = requirePositiveInteger(limit, 'Dead-letter list limit', 100);
  const result = await pool.query<OutboxEventRow>(
    `SELECT event_id, aggregate_type, aggregate_id, aggregate_version, event_type, payload,
            request_id, correlation_id, causation_id, status, attempt_count, max_attempts,
            last_error_code
       FROM marketplace.outbox_events
      WHERE status = 'DEAD_LETTER'
      ORDER BY updated_at, event_id
      LIMIT $1`,
    [boundedLimit],
  );
  return Object.freeze(
    result.rows.map((row) =>
      Object.freeze({ ...fromRow(row), last_error_code: row.last_error_code ?? 'UNKNOWN' }),
    ),
  );
}

export async function recoverDeadLetterEvent(
  pool: Pool,
  input: {
    readonly actor_id: string;
    readonly event_id: string;
    readonly reason_code: string;
    readonly request_id: string;
  },
): Promise<UuidV7> {
  const actorId = parseUuidV7(input.actor_id);
  const eventId = parseUuidV7(input.event_id);
  const requestId = parseRequestId(input.request_id);
  if (!ERROR_CODE_PATTERN.test(input.reason_code)) {
    throw new TypeError('Recovery reason code is invalid');
  }
  const recoveryId = createUuidV7();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const recovered = await client.query<{ attempt_count: number }>(
      `WITH target AS (
         SELECT event_id, attempt_count
           FROM marketplace.outbox_events
          WHERE event_id = $1 AND status = 'DEAD_LETTER'
          FOR UPDATE
       )
       UPDATE marketplace.outbox_events event
          SET status = 'PENDING', attempt_count = 0, available_at = clock_timestamp(),
              claimed_by = NULL, claim_until = NULL, last_error_code = NULL,
              updated_at = clock_timestamp()
         FROM target
        WHERE event.event_id = target.event_id
       RETURNING target.attempt_count`,
      [eventId],
    );
    const previousAttemptCount = recovered.rows[0]?.attempt_count;
    if (previousAttemptCount === undefined) throw new OutboxRecoveryConflictError();
    await client.query(
      `INSERT INTO marketplace.outbox_recoveries
         (recovery_id, event_id, actor_id, request_id, reason_code, previous_attempt_count)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [recoveryId, eventId, actorId, requestId, input.reason_code, previousAttemptCount],
    );
    await client.query('COMMIT');
    return recoveryId;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
