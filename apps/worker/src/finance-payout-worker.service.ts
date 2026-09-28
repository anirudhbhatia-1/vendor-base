import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  runDurableJobBatch,
  type CompleteMoneyLifecycleService,
  type DomainServices,
  type DurableJob,
} from '@neighbourhood-store/database';
import { DOMAIN_SERVICES } from './tokens.js';
import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  parseUuidV7,
  PLATFORM_SYSTEM_USER_ID,
} from '@neighbourhood-store/domain-types';
import { Queue, Worker } from 'bullmq';
import { Pool } from 'pg';
import { workerLogger } from './json-logger.js';
import { closeQueuesWithin, reportQueueErrors, requireQueueReady } from './queue-readiness.js';
import { loadRuntimeConfig } from './runtime-config.js';

const QUEUE = 'finance.payout';
const JOB = 'finance.payout.daily_batch';
type FinanceTrigger = { readonly kind: 'durable-job-claim' };

@Injectable()
export class FinancePayoutWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly #shutdownGraceMs: number;
  readonly #workerId = createUuidV7();
  readonly #pool: Pool;
  readonly #money: CompleteMoneyLifecycleService;
  readonly #queue: Queue<FinanceTrigger>;
  readonly #queueWorker: Worker<FinanceTrigger>;
  readonly #queueUrl: string;
  #running = false;
  #stopping = false;

  constructor(@Inject(DOMAIN_SERVICES) services: DomainServices) {
    const config = loadRuntimeConfig();
    this.#shutdownGraceMs = config.shutdownGraceMs;
    // The shared composition: the same complete-money service and pool the
    // operations worker and the API use, closed by the module at shutdown.
    this.#pool = services.pool;
    this.#money = services.completeMoney;
    const queueOptions = {
      connection: { url: config.valkeyUrl, maxRetriesPerRequest: null },
      prefix: config.queuePrefix,
    } as const;
    this.#queue = new Queue<FinanceTrigger>('finance-scheduler', queueOptions);
    this.#queueWorker = new Worker<FinanceTrigger>('finance-scheduler', async () => this.#poll(), {
      ...queueOptions,
      concurrency: 2,
      maxStalledCount: 2,
    });
    reportQueueErrors({
      component: 'finance-scheduler',
      emitters: [this.#queue, this.#queueWorker],
      logger: workerLogger,
      queueUrl: config.valkeyUrl,
    });
    this.#queueUrl = config.valkeyUrl;
  }

  async onApplicationBootstrap(): Promise<void> {
    await requireQueueReady({
      queueUrl: this.#queueUrl,
      ready: [this.#queue.waitUntilReady(), this.#queueWorker.waitUntilReady()],
    });
    await this.#money.scheduleDailyPayoutJob({ context: this.#systemContext() });
    await this.#queue.upsertJobScheduler(
      'finance-durable-job-claim',
      { every: 15_000 },
      { name: 'finance.durable-job-claim', data: { kind: 'durable-job-claim' } },
    );
    await this.#queue.add(
      'finance.durable-job-claim',
      { kind: 'durable-job-claim' },
      { jobId: `startup-${this.#workerId}`, removeOnComplete: true },
    );
    workerLogger.event('finance.payout.worker.ready', {
      local_schedule: '18:00',
      queue: QUEUE,
      timezone: 'Asia/Kolkata',
    });
  }

  async onApplicationShutdown(): Promise<void> {
    this.#stopping = true;
    await closeQueuesWithin({
      close: async () => {
        await this.#queueWorker.close();
      },
      graceMs: this.#shutdownGraceMs,
      component: QUEUE,
      logger: workerLogger,
    });
    await this.#queue.close();
    // The pool and service belong to the module's composition, which closes
    // after every provider's hook has finished.
  }

  async #poll(): Promise<void> {
    if (this.#running || this.#stopping) return;
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
    // Created, then sent (10.4): until audit run 69 the day's batches were
    // written and nothing ever submitted them. A retried job finds the day's
    // batch and sends only what is still scheduled.
    for (const beneficiary_kind of ['VENDOR', 'PARTNER'] as const) {
      const batch = await this.#money.createPayoutBatch({
        beneficiary_kind,
        context,
        provider_scenario: 'SUCCESS',
      });
      await this.#money.submitPayoutBatch({
        context,
        payout_batch_id: parseUuidV7(String(batch.payout_batch_id)),
      });
    }
    await this.#money.scheduleDailyPayoutJob({ context });
  }

  #systemContext(job?: DurableJob) {
    return createRequestContext({
      // The platform actor: the payout run acts on nobody's behalf, and the
      // finance histories it writes require a user (0089). The worker's own
      // id stays the session, which is what it is.
      actor: createAuthenticatedActor({
        actor_id: PLATFORM_SYSTEM_USER_ID,
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
