import { createDatabasePool } from '@neighbourhood-store/database';
import { Controller, Get, Inject, type OnApplicationShutdown, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Pool } from 'pg';
import {
  type AsyncProcessingHealth,
  checkBroker,
  checkConsumers,
} from './async-processing-health.js';
import { RUNTIME_CONFIG, type RuntimeConfig } from './runtime-config.js';

@Controller('health')
export class HealthController implements OnApplicationShutdown {
  readonly #pool: Pool;

  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {
    this.#pool = createDatabasePool({
      application_name: 'neighbourhood-store-health',
      connectionString: config.databaseUrl,
      connectionTimeoutMillis: 2_000,
      max: 1,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.#pool.end();
  }

  @Get('live')
  liveness() {
    return {
      status: 'ok',
      service: 'marketplace-api',
      version: this.config.version,
      environment: this.config.environment,
      data_mode: this.config.dataMode,
    } as const;
  }

  /**
   * Orchestrators and container healthchecks decide readiness from the HTTP status, so a
   * degraded process must answer 503. Returning 200 with a degraded body kept an API with an
   * unreachable database in rotation. The diagnostic body is unchanged either way.
   */
  /**
   * Async processing health is reported but does not decide the HTTP status.
   *
   * A stopped broker or an absent worker is a real and serious fault, and it is
   * now visible in `async_processing` instead of hidden behind `queue: 'ready'`.
   * It must not 503 this endpoint: orchestrators remove a 503 pod from rotation,
   * so failing readiness on a background-processing outage would take the whole
   * API offline for a fault that leaves every synchronous request working, and
   * would remove the very capacity needed to drain the backlog once the broker
   * returns. 503 stays reserved for this process being unable to serve.
   */
  @Get('ready')
  async readiness(@Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const result = await this.#pool.query<{ scheduled_jobs: string; outbox_events: string }>(
        `SELECT to_regclass('marketplace.scheduled_jobs')::text AS scheduled_jobs,
                to_regclass('marketplace.outbox_events')::text AS outbox_events`,
      );
      const schemaReady = Boolean(result.rows[0]?.scheduled_jobs && result.rows[0]?.outbox_events);
      if (!schemaReady) reply.status(503);
      const [broker, consumers] = await Promise.all([
        checkBroker(this.config.valkeyUrl),
        checkConsumers(this.#pool),
      ]);
      const async_processing: AsyncProcessingHealth = { broker, ...consumers };
      return {
        status: schemaReady ? 'ready' : 'degraded',
        service: 'marketplace-api',
        version: this.config.version,
        environment: this.config.environment,
        data_mode: this.config.dataMode,
        production_ready: false,
        checks: {
          process: 'ready',
          database: 'ready',
          // Renamed from `queue`. It reports whether the job tables exist, which is
          // a migration question; calling it `queue` let a table-presence check
          // stand in for broker and consumer health.
          job_schema: schemaReady ? 'ready' : 'schema_missing',
        },
        async_processing,
      } as const;
    } catch {
      reply.status(503);
      return {
        status: 'degraded',
        service: 'marketplace-api',
        version: this.config.version,
        environment: this.config.environment,
        data_mode: this.config.dataMode,
        production_ready: false,
        checks: { process: 'ready', database: 'unavailable', job_schema: 'unavailable' },
        async_processing: {
          broker: 'unreachable',
          live_worker_count: 0,
          oldest_pending_job_age_seconds: null,
          workers: 'unknown',
        },
      } as const;
    }
  }
}
