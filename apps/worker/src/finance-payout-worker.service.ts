import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  CompleteMoneyLifecycleService,
  runDurableJobBatch,
  type DurableJob,
} from '@neighbourhood-store/database';
import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { workerLogger } from './json-logger.js';
import { loadRuntimeConfig } from './runtime-config.js';

const QUEUE = 'finance.payout';
const JOB = 'finance.payout.daily_batch';

@Injectable()
export class FinancePayoutWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly #workerId = createUuidV7();
  readonly #pool: Pool;
  readonly #money: CompleteMoneyLifecycleService;
  #poller: NodeJS.Timeout | undefined;
  #running = false;

  constructor() {
    const config = loadRuntimeConfig();
    this.#pool = new Pool({
      application_name: 'neighbourhood-store-finance-worker',
      connectionString: config.databaseUrl,
      max: 4,
    });
    this.#money = new CompleteMoneyLifecycleService({ connection_string: config.databaseUrl });
  }

  onApplicationBootstrap(): void {
    void this.#scheduleAndPoll();
    this.#poller = setInterval(() => void this.#poll(), 15_000);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.#poller) clearInterval(this.#poller);
    await Promise.all([this.#pool.end(), this.#money.close()]);
  }

  async #scheduleAndPoll(): Promise<void> {
    try {
      await this.#money.scheduleDailyPayoutJob({ context: this.#systemContext() });
      await this.#poll();
      workerLogger.event('finance.payout.worker.ready', {
        local_schedule: '18:00',
        queue: QUEUE,
        timezone: 'Asia/Kolkata',
      });
    } catch (error) {
      workerLogger.error(error instanceof Error ? error : new Error('Finance worker setup failed'));
    }
  }

  async #poll(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      const result = await runDurableJobBatch(this.#pool, {
        batch_size: 2,
        handler: async (job) => this.#handle(job),
        queue_scope: QUEUE,
        worker_id: this.#workerId,
      });
      if (result.claimed > 0)
        workerLogger.event('finance.payout.batch', {
          claimed: result.claimed,
          dead_lettered: result.dead_lettered,
          lost_claim: result.lost_claim,
          retried: result.retried,
          succeeded: result.succeeded,
        });
    } catch (error) {
      workerLogger.error(error instanceof Error ? error : new Error('Finance payout poll failed'));
    } finally {
      this.#running = false;
    }
  }

  async #handle(job: DurableJob): Promise<void> {
    if (job.job_type !== JOB) throw new Error('Unsupported finance payout job');
    const context = this.#systemContext(job);
    await this.#money.createPayoutBatch({
      beneficiary_kind: 'VENDOR',
      context,
      provider_scenario: 'SUCCESS',
    });
    await this.#money.createPayoutBatch({
      beneficiary_kind: 'PARTNER',
      context,
      provider_scenario: 'SUCCESS',
    });
    await this.#money.scheduleDailyPayoutJob({ context });
  }

  #systemContext(job?: DurableJob) {
    return createRequestContext({
      actor: createAuthenticatedActor({
        actor_id: this.#workerId,
        actor_kind: 'system',
        session_id: this.#workerId,
      }),
      ...(job
        ? {
            causation_id: job.job_id,
            correlation_id: job.correlation_id,
            request_id: job.request_id,
          }
        : {}),
    });
  }
}
