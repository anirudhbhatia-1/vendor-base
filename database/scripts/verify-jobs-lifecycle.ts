import { createRequestId, createUuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  claimDurableJobs,
  JobIdempotencyConflictError,
  listDeadLetterJobs,
  readJobQueueMetrics,
  recoverDeadLetterJob,
  runDurableJobBatch,
  scheduleDurableJob,
} from '../src/durable-jobs.js';

/** Append-only guards must refuse with 55000, not an internal field-resolution error. */
function isAppendOnlyRefusal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '55000';
}

export async function verifyDurableJobs(connectionString: string): Promise<void> {
  const pool = new Pool({
    application_name: 'neighbourhood-store-test-job-verifier',
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 12,
    query_timeout: 30_000,
    statement_timeout: 30_000,
  });
  const queueScope = 'synthetic_jobs.execute';
  const schedule = async (
    key: string,
    options: {
      readonly job_id?: string;
      readonly max_attempts?: number;
      readonly payload?: Record<string, boolean | number | string>;
      readonly priority?: number;
      readonly run_at?: Date | 'immediate';
    } = {},
  ) => {
    const client = await pool.connect();
    try {
      return await scheduleDurableJob(client, {
        correlation_id: createUuidV7(),
        idempotency_key: key,
        ...(options.job_id === undefined ? {} : { job_id: options.job_id }),
        job_type: 'synthetic_jobs.perform',
        ...(options.max_attempts === undefined ? {} : { max_attempts: options.max_attempts }),
        payload: options.payload ?? { synthetic: true },
        ...(options.priority === undefined ? {} : { priority: options.priority }),
        queue_scope: queueScope,
        request_id: createRequestId(),
        run_at: options.run_at ?? 'immediate',
      });
    } finally {
      client.release();
    }
  };

  try {
    const rollbackClient = await pool.connect();
    const rollbackJobId = createUuidV7();
    try {
      await rollbackClient.query('BEGIN');
      await scheduleDurableJob(rollbackClient, {
        correlation_id: createUuidV7(),
        idempotency_key: 'rollback-job-0001',
        job_id: rollbackJobId,
        job_type: 'synthetic_jobs.perform',
        payload: { synthetic: true },
        queue_scope: queueScope,
        request_id: createRequestId(),
        run_at: 'immediate',
      });
      await rollbackClient.query('ROLLBACK');
    } finally {
      rollbackClient.release();
    }
    const rolledBack = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM marketplace.scheduled_jobs WHERE job_id = $1) AS exists`,
      [rollbackJobId],
    );
    if (rolledBack.rows[0]?.exists) throw new Error('Rolled-back schedule became durable');

    // A job meant to run now must be stamped by the database, not by this process.
    // Scheduling it with `new Date()` compared the application server's clock against
    // the claim query's `clock_timestamp()`, so any skew between the two left a
    // supposedly-runnable job unclaimable — an intermittent failure in the mandatory
    // `pnpm db:verify` gate rather than a reproducible one.
    const clockScope = 'synthetic_jobs.clock';
    const scheduleInClockScope = async (key: string, runAt: Date | 'immediate') => {
      const jobId = createUuidV7();
      const client = await pool.connect();
      try {
        await scheduleDurableJob(client, {
          correlation_id: createUuidV7(),
          idempotency_key: key,
          job_id: jobId,
          job_type: 'synthetic_jobs.perform',
          payload: { operation: key },
          queue_scope: clockScope,
          request_id: createRequestId(),
          run_at: runAt,
        });
      } finally {
        client.release();
      }
      return jobId;
    };
    const immediateJobId = await scheduleInClockScope('immediate-job-0001', 'immediate');
    const immediateRow = await pool.query<{ claimable: boolean; skew_ms: number }>(
      `SELECT run_at <= clock_timestamp() AS claimable,
              EXTRACT(MILLISECOND FROM (clock_timestamp() - run_at))::float8 AS skew_ms
         FROM marketplace.scheduled_jobs
        WHERE job_id = $1`,
      [immediateJobId],
    );
    if (immediateRow.rows[0]?.claimable !== true) {
      throw new Error('An immediate job was not claimable the instant it was scheduled');
    }
    // Contrast: a genuine future time must still be withheld from workers. Both live in
    // their own queue scope — `scheduled_jobs` is append-only, so they cannot be removed,
    // and left in the shared scope the immediate one would be claimed by a later batch.
    const futureJobId = await scheduleInClockScope(
      'future-job-0001',
      new Date(Date.now() + 60 * 60 * 1_000),
    );
    const futureRow = await pool.query<{ claimable: boolean }>(
      `SELECT run_at <= clock_timestamp() AS claimable
         FROM marketplace.scheduled_jobs WHERE job_id = $1`,
      [futureJobId],
    );
    if (futureRow.rows[0]?.claimable !== false) {
      throw new Error('A job scheduled for the future was offered to workers early');
    }

    const sameRunAt = new Date(Date.now() + 60 * 60 * 1_000);
    const firstSchedule = await schedule('deduplicated-job-0001', {
      payload: { operation: 'future' },
      run_at: sameRunAt,
    });
    const replayedSchedule = await schedule('deduplicated-job-0001', {
      payload: { operation: 'future' },
      run_at: sameRunAt,
    });
    if (
      !firstSchedule.created ||
      replayedSchedule.created ||
      firstSchedule.job_id !== replayedSchedule.job_id
    ) {
      throw new Error('Repeated job schedule did not return the original durable job');
    }
    let mismatchRejected = false;
    try {
      await schedule('deduplicated-job-0001', {
        payload: { operation: 'different' },
        run_at: sameRunAt,
      });
    } catch (error: unknown) {
      mismatchRejected = error instanceof JobIdempotencyConflictError;
    }
    if (!mismatchRejected) throw new Error('Changed job content reused an idempotency key');

    const batchJobs = await Promise.all([
      schedule('bounded-claim-0001', { priority: 90 }),
      schedule('bounded-claim-0002', { priority: 80 }),
      schedule('bounded-claim-0003', { priority: 70 }),
      schedule('bounded-claim-0004', { priority: 60 }),
    ]);
    const [firstClaims, secondClaims] = await Promise.all([
      claimDurableJobs(pool, {
        batch_size: 2,
        claim_lease_ms: 1_000,
        queue_scope: queueScope,
        worker_id: createUuidV7(),
      }),
      claimDurableJobs(pool, {
        batch_size: 2,
        claim_lease_ms: 1_000,
        queue_scope: queueScope,
        worker_id: createUuidV7(),
      }),
    ]);
    const claimedIds = new Set([...firstClaims, ...secondClaims].map((job) => job.job_id));
    if (firstClaims.length !== 2 || secondClaims.length !== 2 || claimedIds.size !== 4) {
      throw new Error('Concurrent durable-job claims overlapped or exceeded their bounds');
    }
    await pool.query(
      `UPDATE marketplace.scheduled_jobs
          SET claim_until = clock_timestamp() - interval '1 second'
        WHERE job_id = ANY($1::uuid[])`,
      [batchJobs.map((job) => job.job_id)],
    );
    const reclaimed = await runDurableJobBatch(pool, {
      batch_size: 4,
      handler: async () => undefined,
      queue_scope: queueScope,
      worker_id: createUuidV7(),
    });
    const leaseAttempts = await pool.query<{
      lease_expired_count: string;
      succeeded_count: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE outcome = 'LEASE_EXPIRED')::text AS lease_expired_count,
         count(*) FILTER (WHERE outcome = 'SUCCEEDED')::text AS succeeded_count
       FROM marketplace.job_attempts
       WHERE job_id = ANY($1::uuid[])`,
      [batchJobs.map((job) => job.job_id)],
    );
    if (
      reclaimed.succeeded !== 4 ||
      leaseAttempts.rows[0]?.lease_expired_count !== '4' ||
      leaseAttempts.rows[0].succeeded_count !== '4'
    ) {
      throw new Error('Expired job ownership was not recorded and recovered safely');
    }

    const retryJob = await schedule('retry-then-success-0001', { max_attempts: 3 });
    const retryWorkerId = createUuidV7();
    const retryResult = await runDurableJobBatch(pool, {
      backoff_base_ms: 10,
      backoff_max_ms: 100,
      batch_size: 1,
      classify_error: () => 'SYNTHETIC_TRANSIENT',
      handler: async () => {
        throw new Error('Synthetic raw detail must not be stored');
      },
      queue_scope: queueScope,
      worker_id: retryWorkerId,
    });
    if (retryResult.retried !== 1 || retryResult.dead_lettered !== 0) {
      throw new Error('Transient job failure did not schedule a bounded retry');
    }
    await pool.query(
      `UPDATE marketplace.scheduled_jobs SET run_at = clock_timestamp() WHERE job_id = $1`,
      [retryJob.job_id],
    );
    const retrySuccess = await runDurableJobBatch(pool, {
      batch_size: 1,
      handler: async () => undefined,
      queue_scope: queueScope,
      worker_id: retryWorkerId,
    });
    const retryHistory = await pool.query<{
      next_attempt_count: string;
      retry_count: string;
      success_count: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE outcome = 'RETRY_SCHEDULED')::text AS retry_count,
         count(*) FILTER (WHERE outcome = 'RETRY_SCHEDULED' AND next_attempt_at IS NOT NULL)::text
           AS next_attempt_count,
         count(*) FILTER (WHERE outcome = 'SUCCEEDED')::text AS success_count
       FROM marketplace.job_attempts WHERE job_id = $1`,
      [retryJob.job_id],
    );
    if (
      retrySuccess.succeeded !== 1 ||
      retryHistory.rows[0]?.retry_count !== '1' ||
      retryHistory.rows[0].next_attempt_count !== '1' ||
      retryHistory.rows[0].success_count !== '1'
    ) {
      throw new Error('Retried job did not preserve attempt timing and eventual success');
    }

    const deadJob = await schedule('dead-letter-recovery-0001', { max_attempts: 2 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failed = await runDurableJobBatch(pool, {
        backoff_base_ms: 10,
        backoff_max_ms: 100,
        batch_size: 1,
        classify_error: () => 'SYNTHETIC_TERMINAL',
        handler: async () => {
          throw new Error('Synthetic execution failure');
        },
        queue_scope: queueScope,
        worker_id: createUuidV7(),
      });
      if (attempt === 0 && failed.retried !== 1) {
        throw new Error('First terminal-path failure did not retry');
      }
      if (attempt === 1 && failed.dead_lettered !== 1) {
        throw new Error('Retry exhaustion did not dead-letter the job');
      }
      await pool.query(
        `UPDATE marketplace.scheduled_jobs SET run_at = clock_timestamp() WHERE job_id = $1`,
        [deadJob.job_id],
      );
    }
    const deadLetters = await listDeadLetterJobs(pool, queueScope, 10);
    if (
      deadLetters.length !== 1 ||
      deadLetters[0]?.job_id !== deadJob.job_id ||
      deadLetters[0].last_error_code !== 'SYNTHETIC_TERMINAL'
    ) {
      throw new Error('Terminal job failure was not exposed as a safe dead letter');
    }
    await recoverDeadLetterJob(pool, {
      actor_id: createUuidV7(),
      attempts_added: 2,
      job_id: deadJob.job_id,
      reason_code: 'SYNTHETIC_DEPENDENCY_RESTORED',
      request_id: createRequestId(),
    });
    const recoverySuccess = await runDurableJobBatch(pool, {
      batch_size: 1,
      handler: async () => undefined,
      queue_scope: queueScope,
      worker_id: createUuidV7(),
    });
    const recoveredState = await pool.query<{
      attempt_count: number;
      attempts_added: number;
      max_attempts: number;
      previous_attempt_count: number;
      status: string;
    }>(
      `SELECT job.status, job.attempt_count, job.max_attempts,
              recovery.previous_attempt_count, recovery.attempts_added
         FROM marketplace.scheduled_jobs job
         JOIN marketplace.job_recoveries recovery ON recovery.job_id = job.job_id
        WHERE job.job_id = $1`,
      [deadJob.job_id],
    );
    if (
      recoverySuccess.succeeded !== 1 ||
      recoveredState.rows[0]?.status !== 'SUCCEEDED' ||
      recoveredState.rows[0].attempt_count !== 3 ||
      recoveredState.rows[0].max_attempts !== 4 ||
      recoveredState.rows[0].previous_attempt_count !== 2 ||
      recoveredState.rows[0].attempts_added !== 2
    ) {
      throw new Error('Recovered job did not preserve lifetime attempts and attribution');
    }

    const metrics = await readJobQueueMetrics(pool, queueScope);
    if (
      metrics.scheduled_count !== 1 ||
      metrics.ready_count !== 0 ||
      metrics.running_count !== 0 ||
      metrics.dead_letter_count !== 0 ||
      metrics.oldest_ready_age_seconds !== null ||
      metrics.completed_last_hour < 6 ||
      metrics.failed_attempts_last_hour < 7 ||
      metrics.recovered_last_hour !== 1
    ) {
      throw new Error('Job queue metrics did not expose age, throughput, failure and recovery');
    }

    let immutableRejected = false;
    try {
      await pool.query(
        `UPDATE marketplace.scheduled_jobs SET payload = '{"tampered":true}'::jsonb
          WHERE job_id = $1`,
        [firstSchedule.job_id],
      );
    } catch (error: unknown) {
      immutableRejected = isAppendOnlyRefusal(error);
    }
    // The deletion path was raising `42703 record "old" has no field "outcome"` -- the
    // shared guard resolving a job_attempts column while firing on scheduled_jobs. A
    // bare catch accepted that, so the documented `55000` contract was broken and the
    // test stayed green. Migration 0066 fixed the guard; checking the code keeps it fixed.
    let deletionRejected = false;
    try {
      await pool.query(`DELETE FROM marketplace.scheduled_jobs WHERE job_id = $1`, [
        firstSchedule.job_id,
      ]);
    } catch (error: unknown) {
      deletionRejected = isAppendOnlyRefusal(error);
    }
    if (!immutableRejected || !deletionRejected) {
      throw new Error('Durable job identity or history did not refuse with the append-only code');
    }

    // The same guard function fires for job_attempts, so both tables it serves are
    // asserted rather than only the one whose columns it reads. This targets a row that
    // exists: `firstSchedule` was never claimed, so deleting its attempts matches
    // nothing, raises nothing, and would fail the assertion for want of a row rather
    // than because the guard let anything through.
    const existingAttempt = await pool.query<{ attempt_id: string }>(
      `SELECT attempt_id FROM marketplace.job_attempts LIMIT 1`,
    );
    const attemptId = existingAttempt.rows[0]?.attempt_id;
    if (!attemptId) throw new Error('No job attempt was recorded to test history protection');
    let attemptDeletionRejected = false;
    try {
      await pool.query(`DELETE FROM marketplace.job_attempts WHERE attempt_id = $1`, [attemptId]);
    } catch (error: unknown) {
      attemptDeletionRejected = isAppendOnlyRefusal(error);
    }
    if (!attemptDeletionRejected) {
      throw new Error('Job attempt history did not refuse deletion with the append-only code');
    }
  } finally {
    await pool.end();
  }
}
