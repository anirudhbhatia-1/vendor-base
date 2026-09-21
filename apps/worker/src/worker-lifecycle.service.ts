import { createDatabasePool } from '@neighbourhood-store/database';
import { createUuidV7 } from '@neighbourhood-store/domain-types';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';
import { workerLogger } from './json-logger.js';
import { loadRuntimeConfig } from './runtime-config.js';

const QUEUES = ['finance.payout', 'marketplace.operations', 'marketplace.outbox'] as const;
const HEARTBEAT_INTERVAL_MS = 30_000;

@Injectable()
export class WorkerLifecycleService implements OnApplicationShutdown {
  private heartbeat: NodeJS.Timeout | undefined;
  readonly #workerId = createUuidV7();
  #pool: Pool | undefined;

  /**
   * Records liveness where something other than this process can read it.
   *
   * The heartbeat used to exist only as a log line, so `/health/ready` had no way
   * to tell "the job tables are installed" from "a worker is consuming them" and
   * reported the first as if it were the second. A failure to write is logged and
   * swallowed: losing the liveness record must not take down a worker that is
   * otherwise processing jobs correctly.
   */
  async #recordHeartbeat(pool: Pool, stopped: boolean): Promise<void> {
    const config = loadRuntimeConfig();
    try {
      // Every instant on the row is the database's own clock. The start used to
      // be this process's clock and the heartbeat the database's, and the row's
      // check (`last_seen_at >= started_at`) refused the very first heartbeat
      // whenever the database ran a few seconds behind the worker -- readiness
      // then saw no consumer for a worker that was running (audit run 56, on a
      // container clock that had drifted during host sleep). The first insert
      // stamps the start; a repeat keeps it.
      await pool.query(
        `INSERT INTO marketplace.worker_heartbeats
           (worker_id, component, queues, environment, version, started_at, last_seen_at, stopped_at)
         VALUES ($1,$2,$3,$4,$5,now(),now(),CASE WHEN $6 THEN now() END)
         ON CONFLICT (worker_id) DO UPDATE
            SET last_seen_at = now(), stopped_at = EXCLUDED.stopped_at`,
        [
          this.#workerId,
          'marketplace.worker',
          [...QUEUES],
          config.environment,
          config.version,
          stopped,
        ],
      );
    } catch (error: unknown) {
      workerLogger.event('worker.heartbeat.unrecorded', {
        error_message: error instanceof Error ? error.message : 'unknown',
        first_response:
          'Worker liveness could not be recorded, so readiness will report no consumer. ' +
          'The worker itself is unaffected.',
      });
    }
  }

  /**
   * Announces readiness.
   *
   * This is deliberately not an `onApplicationBootstrap` hook. Nest runs those
   * in provider-registration order, so this service's hook resolved while the
   * queue workers were still awaiting their own bootstrap — `worker.ready` was
   * emitted before the worker could actually accept a job, and a supervisor
   * that stopped the process on that signal raced an unfinished bootstrap.
   * The entry point calls this once the application context is fully
   * initialized instead.
   */
  markReady(): void {
    const config = loadRuntimeConfig();
    workerLogger.event('worker.ready', {
      environment: config.environment,
      data_mode: config.dataMode,
      version: config.version,
      queues: ['finance.payout', 'marketplace.operations', 'marketplace.outbox'],
      production_ready: false,
    });
    this.#pool = createDatabasePool({
      application_name: 'neighbourhood-store-worker-liveness',
      connectionString: config.databaseUrl,
      max: 1,
    });
    void this.#recordHeartbeat(this.#pool, false);
    this.heartbeat = setInterval(() => {
      workerLogger.event('worker.heartbeat', { queues: [...QUEUES] });
      if (this.#pool) void this.#recordHeartbeat(this.#pool, false);
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref?.();
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    // A worker that stopped on purpose is marked stopped, so readiness can tell
    // a clean shutdown apart from one that vanished mid-job.
    if (this.#pool) {
      await this.#pool
        .query(
          `UPDATE marketplace.worker_heartbeats SET stopped_at = now(), last_seen_at = now()
          WHERE worker_id = $1`,
          [this.#workerId],
        )
        .catch(() => undefined);
      await this.#pool.end().catch(() => undefined);
      this.#pool = undefined;
    }
    workerLogger.event('worker.stopped', { signal: signal ?? 'application_close' });
  }
}
