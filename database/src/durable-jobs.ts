import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestId,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import type { Pool, PoolClient } from 'pg';
import { canonicalRequestJson, type JsonObject } from './idempotency.js';

export type DurableJobStatus = 'CANCELLED' | 'DEAD_LETTER' | 'RUNNING' | 'SCHEDULED' | 'SUCCEEDED';

export interface DurableJob {
  readonly attempt_count: number;
  readonly causation_id: UuidV7 | null;
  readonly correlation_id: UuidV7;
  readonly job_id: UuidV7;
  readonly job_type: string;
  readonly max_attempts: number;
  readonly payload: JsonObject;
  readonly priority: number;
  readonly queue_scope: string;
  readonly request_id: RequestId;
  readonly run_at: Date;
  readonly status: DurableJobStatus;
}

export interface DurableJobRunSummary {
  readonly claimed: number;
  readonly dead_lettered: number;
  readonly lost_claim: number;
  readonly retried: number;
  readonly succeeded: number;
}

export interface JobQueueMetrics {
  readonly completed_last_hour: number;
  readonly dead_letter_count: number;
  readonly failed_attempts_last_hour: number;
  readonly oldest_ready_age_seconds: number | null;
  readonly ready_count: number;
  readonly recovered_last_hour: number;
  readonly running_count: number;
  readonly scheduled_count: number;
}

export class JobIdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';

  constructor() {
    super('Job idempotency key was already used with different schedule content');
    this.name = 'JobIdempotencyConflictError';
  }
}

export class JobRecoveryConflictError extends Error {
  readonly code = 'BUSINESS_RULE_VIOLATION';

  constructor() {
    super('Only a dead-lettered job with bounded remaining capacity can be recovered');
    this.name = 'JobRecoveryConflictError';
  }
}

interface DurableJobRow {
  readonly attempt_count: number;
  readonly causation_id: string | null;
  readonly correlation_id: string;
  readonly idempotency_key: string;
  readonly job_id: string;
  readonly job_type: string;
  readonly last_error_code: string | null;
  readonly max_attempts: number;
  readonly payload: JsonObject;
  readonly priority: number;
  readonly queue_scope: string;
  readonly request_id: string;
  readonly run_at: Date;
  readonly status: DurableJobStatus;
}

const DOTTED_SCOPE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:-]{8,200}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_BACKOFF_BASE_MS = 1_000;
const DEFAULT_BACKOFF_MAX_MS = 15 * 60 * 1_000;

function requireDottedScope(value: string, label: string): string {
  if (!DOTTED_SCOPE_PATTERN.test(value) || value.length > 120) {
    throw new TypeError(`${label} must use stable lowercase dotted notation`);
  }
  return value;
}

function requireInteger(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function requireIdempotencyKey(value: string): string {
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) throw new TypeError('Job idempotency key is invalid');
  return value;
}

function requirePayload(value: unknown): string {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError('Job payload must be a JSON object');
  }
  return canonicalRequestJson(value);
}

function safeErrorCode(value: string): string {
  return ERROR_CODE_PATTERN.test(value) ? value : 'JOB_EXECUTION_FAILED';
}

function fromRow(row: DurableJobRow): DurableJob {
  return Object.freeze({
    attempt_count: row.attempt_count,
    causation_id: row.causation_id ? parseUuidV7(row.causation_id) : null,
    correlation_id: parseUuidV7(row.correlation_id),
    job_id: parseUuidV7(row.job_id),
    job_type: row.job_type,
    max_attempts: row.max_attempts,
    payload: Object.freeze(row.payload),
    priority: row.priority,
    queue_scope: row.queue_scope,
    request_id: parseRequestId(row.request_id),
    run_at: row.run_at,
    status: row.status,
  });
}

export function durableJobBackoffMs(
  attemptCount: number,
  baseMs = DEFAULT_BACKOFF_BASE_MS,
  maximumMs = DEFAULT_BACKOFF_MAX_MS,
): number {
  requireInteger(attemptCount, 'Attempt count', 1, 100);
  requireInteger(baseMs, 'Backoff base', 1, 60_000);
  requireInteger(maximumMs, 'Backoff maximum', 1, 24 * 60 * 60 * 1_000);
  if (baseMs > maximumMs) throw new RangeError('Backoff base cannot exceed its maximum');
  return Math.min(maximumMs, baseMs * 2 ** Math.min(attemptCount - 1, 20));
}

export async function scheduleDurableJob(
  client: PoolClient,
  input: {
    readonly causation_id?: string | null;
    readonly correlation_id: string;
    readonly idempotency_key: string;
    readonly job_id?: string;
    readonly job_type: string;
    readonly max_attempts?: number;
    readonly payload: JsonObject;
    readonly priority?: number;
    readonly queue_scope: string;
    readonly request_id: string;
    /**
     * `'immediate'` means "as soon as a worker can take it" and is stamped by the
     * database. A caller that passes `new Date()` instead is comparing two clocks:
     * the row carries the application server's instant while the claim query filters
     * on `clock_timestamp()`, so any skew between them leaves a job that is supposed
     * to be runnable briefly unclaimable. Use a Date only for a genuine future time.
     */
    readonly run_at: Date | 'immediate';
  },
): Promise<{ readonly created: boolean; readonly job_id: UuidV7 }> {
  const immediate = input.run_at === 'immediate';
  if (!immediate && (!(input.run_at instanceof Date) || !Number.isFinite(input.run_at.getTime()))) {
    throw new TypeError('Job run_at must be a valid instant');
  }
  const jobId = input.job_id ? parseUuidV7(input.job_id) : createUuidV7();
  const queueScope = requireDottedScope(input.queue_scope, 'Queue scope');
  const jobType = requireDottedScope(input.job_type, 'Job type');
  const idempotencyKey = requireIdempotencyKey(input.idempotency_key);
  const payloadJson = requirePayload(input.payload);
  const requestId = parseRequestId(input.request_id);
  const correlationId = parseUuidV7(input.correlation_id);
  const causationId = input.causation_id ? parseUuidV7(input.causation_id) : null;
  const priority = requireInteger(input.priority ?? 50, 'Job priority', 0, 100);
  const maxAttempts = requireInteger(
    input.max_attempts ?? DEFAULT_MAX_ATTEMPTS,
    'Maximum job attempts',
    1,
    25,
  );
  const inserted = await client.query<{ job_id: string }>(
    `INSERT INTO marketplace.scheduled_jobs
       (job_id, queue_scope, job_type, idempotency_key, payload, request_id,
        correlation_id, causation_id, priority, run_at, max_attempts)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9,
             COALESCE($10::timestamptz, clock_timestamp()), $11)
     ON CONFLICT (queue_scope, idempotency_key) DO NOTHING
     RETURNING job_id`,
    [
      jobId,
      queueScope,
      jobType,
      idempotencyKey,
      payloadJson,
      requestId,
      correlationId,
      causationId,
      priority,
      immediate ? null : input.run_at,
      maxAttempts,
    ],
  );
  if (inserted.rowCount === 1) return Object.freeze({ created: true, job_id: jobId });
  const existing = await client.query<DurableJobRow>(
    `SELECT job_id, queue_scope, job_type, idempotency_key, payload, request_id,
            correlation_id, causation_id, status, priority, run_at, attempt_count,
            max_attempts, last_error_code
       FROM marketplace.scheduled_jobs
      WHERE queue_scope = $1 AND idempotency_key = $2`,
    [queueScope, idempotencyKey],
  );
  const row = existing.rows[0];
  if (
    !row ||
    row.job_type !== jobType ||
    canonicalRequestJson(row.payload) !== payloadJson ||
    row.priority !== priority ||
    row.max_attempts !== maxAttempts ||
    // An immediate job carries whatever instant the database stamped, so there is
    // no caller-supplied value to compare it against.
    (!immediate && row.run_at.getTime() !== (input.run_at as Date).getTime())
  ) {
    throw new JobIdempotencyConflictError();
  }
  return Object.freeze({ created: false, job_id: parseUuidV7(row.job_id) });
}

async function expireAbandonedClaims(client: PoolClient, queueScope: string): Promise<void> {
  await client.query(
    `UPDATE marketplace.job_attempts attempt
        SET outcome = 'LEASE_EXPIRED', error_code = 'JOB_LEASE_EXPIRED',
            finished_at = clock_timestamp(),
            next_attempt_at = CASE
              WHEN job.attempt_count < job.max_attempts THEN clock_timestamp()
              ELSE NULL
            END
       FROM marketplace.scheduled_jobs job
      WHERE job.queue_scope = $1 AND job.status = 'RUNNING'
        AND job.claim_until <= clock_timestamp()
        AND attempt.job_id = job.job_id AND attempt.attempt_number = job.attempt_count
        AND attempt.outcome = 'RUNNING'`,
    [queueScope],
  );
  await client.query(
    `UPDATE marketplace.scheduled_jobs
        SET status = CASE
              WHEN attempt_count >= max_attempts THEN 'DEAD_LETTER'
              ELSE 'SCHEDULED'
            END,
            run_at = CASE
              WHEN attempt_count < max_attempts THEN clock_timestamp()
              ELSE run_at
            END,
            claimed_by = NULL, claim_until = NULL,
            last_error_code = 'JOB_LEASE_EXPIRED', updated_at = clock_timestamp()
      WHERE queue_scope = $1 AND status = 'RUNNING' AND claim_until <= clock_timestamp()`,
    [queueScope],
  );
}

export async function claimDurableJobs(
  pool: Pool,
  input: {
    readonly batch_size?: number;
    readonly claim_lease_ms?: number;
    readonly queue_scope: string;
    readonly worker_id: string;
  },
): Promise<readonly DurableJob[]> {
  const queueScope = requireDottedScope(input.queue_scope, 'Queue scope');
  const workerId = parseUuidV7(input.worker_id);
  const batchSize = requireInteger(
    input.batch_size ?? DEFAULT_BATCH_SIZE,
    'Job batch size',
    1,
    100,
  );
  const leaseMs = requireInteger(
    input.claim_lease_ms ?? DEFAULT_LEASE_MS,
    'Job claim lease',
    1_000,
    5 * 60 * 1_000,
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await expireAbandonedClaims(client, queueScope);
    const result = await client.query<DurableJobRow>(
      `WITH candidates AS (
         SELECT job_id
           FROM marketplace.scheduled_jobs
          WHERE queue_scope = $1 AND status = 'SCHEDULED'
            AND run_at <= clock_timestamp() AND attempt_count < max_attempts
          ORDER BY priority DESC, run_at, created_at, job_id
          FOR UPDATE SKIP LOCKED
          LIMIT $2
       ), claimed AS (
         UPDATE marketplace.scheduled_jobs job
            SET status = 'RUNNING', claimed_by = $3,
                claim_until = clock_timestamp() + ($4 * interval '1 millisecond'),
                attempt_count = job.attempt_count + 1, updated_at = clock_timestamp()
           FROM candidates
          WHERE job.job_id = candidates.job_id
         RETURNING job.*
       )
       SELECT claimed.job_id, claimed.queue_scope, claimed.job_type,
              claimed.idempotency_key, claimed.payload, claimed.request_id,
              claimed.correlation_id, claimed.causation_id, claimed.status,
              claimed.priority, claimed.run_at, claimed.attempt_count,
              claimed.max_attempts, claimed.last_error_code
         FROM claimed
        ORDER BY claimed.priority DESC, claimed.run_at, claimed.job_id`,
      [queueScope, batchSize, workerId, leaseMs],
    );
    if (result.rows.length > 0) {
      await client.query(
        `INSERT INTO marketplace.job_attempts
           (attempt_id, job_id, attempt_number, worker_id, outcome)
         SELECT input.attempt_id, input.job_id, input.attempt_number, $4, 'RUNNING'
           FROM unnest($1::uuid[], $2::uuid[], $3::integer[])
             AS input(attempt_id, job_id, attempt_number)`,
        [
          result.rows.map(() => createUuidV7()),
          result.rows.map((row) => row.job_id),
          result.rows.map((row) => row.attempt_count),
          workerId,
        ],
      );
    }
    await client.query('COMMIT');
    return Object.freeze(result.rows.map(fromRow));
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function finishJobAttempt(
  pool: Pool,
  input: {
    readonly error_code: string | null;
    readonly job: DurableJob;
    readonly next_attempt_at: Date | null;
    readonly outcome: 'DEAD_LETTER' | 'RETRY_SCHEDULED' | 'SUCCEEDED';
    readonly worker_id: UuidV7;
  },
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const jobStatus =
      input.outcome === 'SUCCEEDED'
        ? 'SUCCEEDED'
        : input.outcome === 'DEAD_LETTER'
          ? 'DEAD_LETTER'
          : 'SCHEDULED';
    const updated = await client.query(
      `UPDATE marketplace.scheduled_jobs
          SET status = $3, run_at = COALESCE($4, run_at),
              claimed_by = NULL, claim_until = NULL, last_error_code = $5,
              completed_at = CASE WHEN $3 = 'SUCCEEDED' THEN clock_timestamp() ELSE NULL END,
              updated_at = clock_timestamp()
        WHERE job_id = $1 AND status = 'RUNNING' AND claimed_by = $2
          AND attempt_count = $6 AND claim_until > clock_timestamp()`,
      [
        input.job.job_id,
        input.worker_id,
        jobStatus,
        input.next_attempt_at,
        input.error_code,
        input.job.attempt_count,
      ],
    );
    if (updated.rowCount !== 1) {
      await client.query('ROLLBACK');
      return false;
    }
    const attemptUpdated = await client.query(
      `UPDATE marketplace.job_attempts
          SET outcome = $4, error_code = $5, finished_at = clock_timestamp(),
              next_attempt_at = $6
        WHERE job_id = $1 AND attempt_number = $2 AND worker_id = $3
          AND outcome = 'RUNNING'`,
      [
        input.job.job_id,
        input.job.attempt_count,
        input.worker_id,
        input.outcome,
        input.error_code,
        input.next_attempt_at,
      ],
    );
    if (attemptUpdated.rowCount !== 1) {
      throw new Error('Claimed job attempt history was missing during finalization');
    }
    await client.query('COMMIT');
    return true;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function runDurableJobBatch(
  pool: Pool,
  input: {
    readonly backoff_base_ms?: number;
    readonly backoff_max_ms?: number;
    readonly batch_size?: number;
    readonly claim_lease_ms?: number;
    readonly classify_error?: (error: unknown) => string;
    readonly handler: (job: DurableJob) => Promise<void>;
    readonly queue_scope: string;
    readonly worker_id: string;
  },
): Promise<DurableJobRunSummary> {
  const workerId = parseUuidV7(input.worker_id);
  const jobs = await claimDurableJobs(pool, input);
  let deadLettered = 0;
  let lostClaim = 0;
  let retried = 0;
  let succeeded = 0;
  for (const job of jobs) {
    try {
      await input.handler(job);
      if (
        await finishJobAttempt(pool, {
          error_code: null,
          job,
          next_attempt_at: null,
          outcome: 'SUCCEEDED',
          worker_id: workerId,
        })
      ) {
        succeeded += 1;
      } else lostClaim += 1;
    } catch (error: unknown) {
      const terminal = job.attempt_count >= job.max_attempts;
      const errorCode = safeErrorCode(input.classify_error?.(error) ?? 'JOB_EXECUTION_FAILED');
      const nextAttemptAt = terminal
        ? null
        : new Date(
            Date.now() +
              durableJobBackoffMs(job.attempt_count, input.backoff_base_ms, input.backoff_max_ms),
          );
      const updated = await finishJobAttempt(pool, {
        error_code: errorCode,
        job,
        next_attempt_at: nextAttemptAt,
        outcome: terminal ? 'DEAD_LETTER' : 'RETRY_SCHEDULED',
        worker_id: workerId,
      });
      if (!updated) lostClaim += 1;
      else if (terminal) deadLettered += 1;
      else retried += 1;
    }
  }
  return Object.freeze({
    claimed: jobs.length,
    dead_lettered: deadLettered,
    lost_claim: lostClaim,
    retried,
    succeeded,
  });
}

export async function listDeadLetterJobs(
  pool: Pool,
  queueScope: string,
  limit = DEFAULT_BATCH_SIZE,
): Promise<readonly (DurableJob & { readonly last_error_code: string })[]> {
  const scope = requireDottedScope(queueScope, 'Queue scope');
  const boundedLimit = requireInteger(limit, 'Dead-letter list limit', 1, 100);
  const result = await pool.query<DurableJobRow>(
    `SELECT job_id, queue_scope, job_type, idempotency_key, payload, request_id,
            correlation_id, causation_id, status, priority, run_at, attempt_count,
            max_attempts, last_error_code
       FROM marketplace.scheduled_jobs
      WHERE queue_scope = $1 AND status = 'DEAD_LETTER'
      ORDER BY updated_at, job_id
      LIMIT $2`,
    [scope, boundedLimit],
  );
  return Object.freeze(
    result.rows.map((row) =>
      Object.freeze({ ...fromRow(row), last_error_code: row.last_error_code ?? 'UNKNOWN' }),
    ),
  );
}

export async function recoverDeadLetterJob(
  pool: Pool,
  input: {
    readonly actor_id: string;
    readonly attempts_added?: number;
    readonly job_id: string;
    readonly reason_code: string;
    readonly request_id: string;
  },
): Promise<UuidV7> {
  const actorId = parseUuidV7(input.actor_id);
  const requestId = parseRequestId(input.request_id);
  const jobId = parseUuidV7(input.job_id);
  const attemptsAdded = requireInteger(input.attempts_added ?? 3, 'Recovery attempts', 1, 25);
  if (!ERROR_CODE_PATTERN.test(input.reason_code))
    throw new TypeError('Recovery reason is invalid');
  const recoveryId = createUuidV7();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const recovered = await client.query<{ attempt_count: number }>(
      `WITH target AS (
         SELECT job_id, attempt_count
           FROM marketplace.scheduled_jobs
          WHERE job_id = $1 AND status = 'DEAD_LETTER'
            AND max_attempts + $2 <= 100
          FOR UPDATE
       )
       UPDATE marketplace.scheduled_jobs job
          SET status = 'SCHEDULED', max_attempts = job.max_attempts + $2,
              run_at = clock_timestamp(), last_error_code = NULL,
              claimed_by = NULL, claim_until = NULL, updated_at = clock_timestamp()
         FROM target
        WHERE job.job_id = target.job_id
       RETURNING target.attempt_count`,
      [jobId, attemptsAdded],
    );
    const previousAttemptCount = recovered.rows[0]?.attempt_count;
    if (previousAttemptCount === undefined) throw new JobRecoveryConflictError();
    await client.query(
      `INSERT INTO marketplace.job_recoveries
         (recovery_id, job_id, actor_id, request_id, reason_code,
          previous_attempt_count, attempts_added)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        recoveryId,
        jobId,
        actorId,
        requestId,
        input.reason_code,
        previousAttemptCount,
        attemptsAdded,
      ],
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

export async function readJobQueueMetrics(
  pool: Pool,
  queueScope: string,
): Promise<JobQueueMetrics> {
  const scope = requireDottedScope(queueScope, 'Queue scope');
  const result = await pool.query<{
    completed_last_hour: number;
    dead_letter_count: number;
    failed_attempts_last_hour: number;
    oldest_ready_age_seconds: number | null;
    ready_count: number;
    recovered_last_hour: number;
    running_count: number;
    scheduled_count: number;
  }>(
    `SELECT
       count(*) FILTER (WHERE job.status = 'SCHEDULED' AND job.run_at <= clock_timestamp())::int
         AS ready_count,
       count(*) FILTER (WHERE job.status = 'SCHEDULED' AND job.run_at > clock_timestamp())::int
         AS scheduled_count,
       count(*) FILTER (WHERE job.status = 'RUNNING')::int AS running_count,
       count(*) FILTER (WHERE job.status = 'DEAD_LETTER')::int AS dead_letter_count,
       extract(epoch FROM clock_timestamp() - min(job.run_at)
         FILTER (WHERE job.status = 'SCHEDULED' AND job.run_at <= clock_timestamp()))::float8
         AS oldest_ready_age_seconds,
       count(*) FILTER (WHERE job.status = 'SUCCEEDED'
         AND job.completed_at >= clock_timestamp() - interval '1 hour')::int
         AS completed_last_hour,
       (SELECT count(*)::int FROM marketplace.job_attempts attempt
         JOIN marketplace.scheduled_jobs attempt_job ON attempt_job.job_id = attempt.job_id
        WHERE attempt_job.queue_scope = $1
          AND attempt.outcome IN ('RETRY_SCHEDULED', 'DEAD_LETTER', 'LEASE_EXPIRED')
          AND attempt.finished_at >= clock_timestamp() - interval '1 hour')
         AS failed_attempts_last_hour,
       (SELECT count(*)::int FROM marketplace.job_recoveries recovery
         JOIN marketplace.scheduled_jobs recovery_job ON recovery_job.job_id = recovery.job_id
        WHERE recovery_job.queue_scope = $1
          AND recovery.recovered_at >= clock_timestamp() - interval '1 hour')
         AS recovered_last_hour
      FROM marketplace.scheduled_jobs job
     WHERE job.queue_scope = $1`,
    [scope],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Job metrics query returned no aggregate row');
  return Object.freeze(row);
}
