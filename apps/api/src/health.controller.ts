import { Controller, Get, Inject, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { RUNTIME_CONFIG, type RuntimeConfig } from './runtime-config.js';

@Controller('health')
export class HealthController implements OnApplicationShutdown {
  readonly #pool: Pool;

  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {
    this.#pool = new Pool({
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

  @Get('ready')
  async readiness() {
    try {
      const result = await this.#pool.query<{ scheduled_jobs: string; outbox_events: string }>(
        `SELECT to_regclass('marketplace.scheduled_jobs')::text AS scheduled_jobs,
                to_regclass('marketplace.outbox_events')::text AS outbox_events`,
      );
      const queueReady = Boolean(result.rows[0]?.scheduled_jobs && result.rows[0]?.outbox_events);
      return {
        status: queueReady ? 'ready' : 'degraded',
        service: 'marketplace-api',
        version: this.config.version,
        environment: this.config.environment,
        data_mode: this.config.dataMode,
        production_ready: false,
        checks: {
          process: 'ready',
          database: 'ready',
          queue: queueReady ? 'ready' : 'schema_missing',
        },
      } as const;
    } catch {
      return {
        status: 'degraded',
        service: 'marketplace-api',
        version: this.config.version,
        environment: this.config.environment,
        data_mode: this.config.dataMode,
        production_ready: false,
        checks: { process: 'ready', database: 'unavailable', queue: 'unavailable' },
      } as const;
    }
  }
}
