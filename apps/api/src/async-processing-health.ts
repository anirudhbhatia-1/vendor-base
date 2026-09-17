import { Redis } from 'ioredis';
import type { Pool } from 'pg';

/**
 * Broker and consumer health, kept apart from whether this process can serve.
 *
 * `/health/ready` used to derive `queue: 'ready'` from `to_regclass()` on two
 * PostgreSQL tables. That answers "is the job schema installed", which is a
 * migration question, and it answered it under a name that reads as "the queue
 * works". A deployment with Valkey stopped and no worker running reported a ready
 * queue, so nothing downstream could tell that jobs were accumulating unclaimed.
 */

/** A worker seen more recently than this is treated as live. */
const WORKER_STALE_AFTER_MS = 90_000;

export type BrokerState = 'ready' | 'unreachable' | 'unauthenticated';

export interface AsyncProcessingHealth {
  readonly broker: BrokerState;
  readonly workers: 'ready' | 'none_live' | 'unknown';
  readonly live_worker_count: number;
  readonly oldest_pending_job_age_seconds: number | null;
}

/**
 * One short-lived connection per check, deliberately.
 *
 * A retained client would either retry for ever against a stopped broker -- the
 * unbounded `ECONNREFUSED` stream that `queue-readiness.ts` in the worker exists
 * to suppress -- or, with retries disabled, stay dead after the first failure and
 * report a recovered broker as still down. Neither is acceptable in a probe whose
 * whole job is to be accurate about the current moment.
 */
export async function checkBroker(valkeyUrl: string, timeoutMs = 1_000): Promise<BrokerState> {
  const client = new Redis(valkeyUrl, {
    commandTimeout: timeoutMs,
    connectTimeout: timeoutMs,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  // ioredis emits `error` on a failed connection; without a listener that is an
  // unhandled event, which would take the process down over a health check.
  client.on('error', () => undefined);
  try {
    await client.connect();
    const reply = await client.ping();
    return reply === 'PONG' ? 'ready' : 'unreachable';
  } catch (error: unknown) {
    // A broker that answers "you are not authenticated" is reachable and speaking
    // the protocol. That is a credential fault, not an outage, and conflating the
    // two sends operators to restart a service that is running.
    const message = error instanceof Error ? error.message : '';
    return /NOAUTH|WRONGPASS|NOPERM/i.test(message) ? 'unauthenticated' : 'unreachable';
  } finally {
    client.disconnect();
  }
}

/**
 * Consumer liveness and backlog age, read from the durable heartbeat written by
 * the worker (migration 0071) rather than from the worker's own stdout.
 *
 * `oldest_pending_job_age_seconds` is the number that actually shows a stalled
 * pipeline: a live worker with a backlog growing for an hour is a different
 * failure from no worker at all, and both are invisible in a table-presence check.
 */
export async function checkConsumers(pool: Pool): Promise<Omit<AsyncProcessingHealth, 'broker'>> {
  try {
    const result = await pool.query<{
      live_workers: string;
      oldest_pending_seconds: string | null;
    }>(
      `SELECT
         (SELECT count(*)::text FROM marketplace.worker_heartbeats
           WHERE stopped_at IS NULL
             AND last_seen_at > now() - ($1::integer * interval '1 millisecond')) AS live_workers,
         (SELECT floor(extract(epoch FROM now() - min(run_at)))::text
            FROM marketplace.scheduled_jobs
           WHERE status = 'SCHEDULED' AND run_at <= now()) AS oldest_pending_seconds`,
      [WORKER_STALE_AFTER_MS],
    );
    const liveWorkers = Number(result.rows[0]?.live_workers ?? '0');
    const oldest = result.rows[0]?.oldest_pending_seconds;
    return {
      live_worker_count: liveWorkers,
      oldest_pending_job_age_seconds:
        oldest === null || oldest === undefined ? null : Number(oldest),
      workers: liveWorkers > 0 ? 'ready' : 'none_live',
    };
  } catch {
    // The database branch of readiness already reports a connection failure. Here
    // it means consumer health is genuinely unknown, which is not the same claim
    // as "no worker is running".
    return { live_worker_count: 0, oldest_pending_job_age_seconds: null, workers: 'unknown' };
  }
}
