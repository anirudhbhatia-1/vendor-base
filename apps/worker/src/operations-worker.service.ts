import { createDatabasePool } from '@neighbourhood-store/database';
import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  AssignmentCustodyService,
  AdminControlPlaneService,
  GroupedCheckoutService,
  InventoryReservationService,
  LocalProtectedObjectStorage,
  PartnerAvailabilityService,
  PartnerFieldOpsService,
  PartnerWaitPolicyService,
  LocalNotificationService,
  LocalFakeMoneyProvider,
  CompleteMoneyLifecycleService,
  ConfigurationAdminService,
  DeliveryDispatchOrchestrator,
  MoneyLifecycleService,
  OrderMoneyOrchestrator,
  VendorFulfilmentService,
  VendorOnboardingService,
  dispatchOutboxBatch,
  processInboxEvent,
} from '@neighbourhood-store/database';
import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  formatTraceparent,
} from '@neighbourhood-store/domain-types';
import { Queue, QueueEvents, Worker, type Job } from 'bullmq';
import { closeQueuesWithin, reportQueueErrors, requireQueueReady } from './queue-readiness.js';
import { trace } from '@opentelemetry/api';
import { Pool } from 'pg';
import { handleDomainEvent } from './domain-event-handler.js';
import { workerLogger } from './json-logger.js';
import { loadRuntimeConfig } from './runtime-config.js';

const POLL_MS = 15_000;
const OFFLINE_PROOF_TTL_MS = 24 * 60 * 60 * 1_000;
const QUEUE_NAME = 'operations';

type OperationsJob =
  | { readonly kind: 'tick' }
  | {
      readonly causation_id: string | null;
      readonly correlation_id: string;
      readonly event_id: string;
      readonly event_type: string;
      readonly kind: 'outbox';
      readonly request_id: string;
      readonly traceparent: string;
    };

/**
 * Runs the server-owned deadlines that must not depend on a browser being open.
 * PostgreSQL remains the durable queue in the approved local environment; every
 * claim uses the locking implemented by the owning domain service, so a second
 * worker can safely be started when load testing begins.
 */
@Injectable()
export class OperationsWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly #shutdownGraceMs: number;
  readonly #workerId = createUuidV7();
  readonly #pool: Pool;
  readonly #assignments: AssignmentCustodyService;
  readonly #adminControl: AdminControlPlaneService;
  readonly #checkout: GroupedCheckoutService;
  readonly #inventory: InventoryReservationService;
  readonly #partnerField: PartnerFieldOpsService;
  readonly #partnerWait: PartnerWaitPolicyService;
  readonly #notifications: LocalNotificationService;
  readonly #configuration: ConfigurationAdminService;
  readonly #availability: PartnerAvailabilityService;
  readonly #fulfilment: VendorFulfilmentService;
  readonly #onboarding: VendorOnboardingService;
  readonly #dispatch: DeliveryDispatchOrchestrator;
  readonly #money: MoneyLifecycleService;
  readonly #completeMoney: CompleteMoneyLifecycleService;
  readonly #orderMoney: OrderMoneyOrchestrator;
  readonly #queue: Queue<OperationsJob>;
  readonly #queueEvents: QueueEvents;
  readonly #queueUrl: string;
  readonly #queueWorker: Worker<OperationsJob>;
  #running = false;
  /**
   * Set before the queues are closed so an in-flight poll can stop between
   * passes. Without it a shutdown waited for the whole poll — which blocks on
   * `waitUntilFinished` for every published outbox event — and the supervisor
   * force-killed the process part way through.
   */
  #stopping = false;

  constructor() {
    const config = loadRuntimeConfig();
    this.#shutdownGraceMs = config.shutdownGraceMs;
    const { databaseUrl } = config;
    this.#pool = createDatabasePool({
      application_name: 'neighbourhood-store-operations-worker',
      connectionString: databaseUrl,
      max: 4,
    });
    this.#inventory = new InventoryReservationService({ connection_string: databaseUrl });
    this.#adminControl = new AdminControlPlaneService({ connection_string: databaseUrl });
    this.#assignments = new AssignmentCustodyService({ connection_string: databaseUrl });
    this.#checkout = new GroupedCheckoutService({
      connection_string: databaseUrl,
      provider: new LocalFakeMoneyProvider({
        clearing_account_reference: config.providerClearingAccountReference,
        webhook_key: config.paymentWebhookKey,
      }),
    });
    this.#partnerField = new PartnerFieldOpsService({ connection_string: databaseUrl });
    this.#partnerWait = new PartnerWaitPolicyService({ connection_string: databaseUrl });
    this.#notifications = new LocalNotificationService({ connection_string: databaseUrl });
    this.#configuration = new ConfigurationAdminService({ connection_string: databaseUrl });
    this.#availability = new PartnerAvailabilityService({ connection_string: databaseUrl });
    this.#money = new MoneyLifecycleService({ connection_string: databaseUrl });
    this.#completeMoney = new CompleteMoneyLifecycleService({ connection_string: databaseUrl });
    this.#orderMoney = new OrderMoneyOrchestrator({
      complete_money: this.#completeMoney,
      connection_string: databaseUrl,
      money: this.#money,
    });
    this.#dispatch = new DeliveryDispatchOrchestrator({
      assignments: this.#assignments,
      availability: this.#availability,
      connection_string: databaseUrl,
    });
    this.#fulfilment = new VendorFulfilmentService({
      connection_string: databaseUrl,
      inventory: this.#inventory,
    });
    this.#onboarding = new VendorOnboardingService({
      connection_string: databaseUrl,
      storage: new LocalProtectedObjectStorage({
        grant_key: config.objectStorageGrantKey,
        root_directory: config.objectStorageRoot,
      }),
    });
    const connection = { url: config.valkeyUrl, maxRetriesPerRequest: null } as const;
    const queueOptions = { connection, prefix: config.queuePrefix } as const;
    this.#queue = new Queue<OperationsJob>(QUEUE_NAME, {
      ...queueOptions,
      defaultJobOptions: {
        attempts: 8,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: { count: 10_000 },
        removeOnFail: { count: 10_000 },
      },
    });
    this.#queueEvents = new QueueEvents(QUEUE_NAME, queueOptions);
    this.#queueWorker = new Worker<OperationsJob>(
      QUEUE_NAME,
      async (job) => this.#handleQueueJob(job),
      { ...queueOptions, concurrency: 4, maxStalledCount: 2 },
    );
    // One useful line instead of three unbounded streams of raw driver errors.
    reportQueueErrors({
      component: QUEUE_NAME,
      emitters: [this.#queue, this.#queueEvents, this.#queueWorker],
      logger: workerLogger,
      queueUrl: config.valkeyUrl,
    });
    this.#queueUrl = config.valkeyUrl;
  }

  async onApplicationBootstrap(): Promise<void> {
    await requireQueueReady({
      queueUrl: this.#queueUrl,
      ready: [
        this.#queue.waitUntilReady(),
        this.#queueEvents.waitUntilReady(),
        this.#queueWorker.waitUntilReady(),
      ],
    });
    await this.#queue.upsertJobScheduler(
      'operations-tick',
      { every: POLL_MS },
      { name: 'operations.tick', data: { kind: 'tick' } },
    );
    await this.#queue.add(
      'operations.tick',
      { kind: 'tick' },
      {
        jobId: `startup-${this.#workerId}`,
      },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    // Let active BullMQ handlers finish while their database pools are still
    // available. Closing everything concurrently can strand an active handler
    // on a pool that has already been ended and prevents watch-mode shutdown.
    this.#stopping = true;
    await closeQueuesWithin({
      close: async () => {
        await this.#queueWorker.close();
      },
      graceMs: this.#shutdownGraceMs,
      component: QUEUE_NAME,
      logger: workerLogger,
    });
    await this.#queueEvents.close();
    await this.#queue.close();
    await Promise.all([
      this.#pool.end(),
      this.#assignments.close(),
      this.#adminControl.close(),
      this.#checkout.close(),
      this.#inventory.close(),
      this.#partnerField.close(),
      this.#partnerWait.close(),
      this.#notifications.close(),
      this.#configuration.close(),
      this.#fulfilment.close(),
      this.#onboarding.close(),
      this.#availability.close(),
      this.#dispatch.close(),
      this.#money.close(),
      this.#completeMoney.close(),
      this.#orderMoney.close(),
    ]);
  }

  async #handleQueueJob(job: Job<OperationsJob>): Promise<void> {
    if (job.data.kind === 'tick') {
      await this.#poll();
      return;
    }
    trace.getActiveSpan()?.setAttributes({
      'app.event_id': job.data.event_id,
      'app.request_id': job.data.request_id,
      'app.correlation_id': job.data.correlation_id,
      ...(job.data.causation_id ? { 'app.causation_id': job.data.causation_id } : {}),
    });
    await this.#consumeOutboxEvent(job.data);
  }

  async #consumeOutboxEvent(
    job: Extract<OperationsJob, { readonly kind: 'outbox' }>,
  ): Promise<void> {
    const context = createRequestContext({
      actor: createAuthenticatedActor({
        actor_id: this.#workerId,
        actor_kind: 'system',
        session_id: this.#workerId,
      }),
      causation_id: job.causation_id,
      correlation_id: job.correlation_id,
      request_id: job.request_id,
      traceparent: job.traceparent,
    });
    await processInboxEvent(
      this.#pool,
      {
        consumer_scope: 'worker.domain_event',
        correlation_id: job.correlation_id,
        event_id: job.event_id,
        request_id: job.request_id,
      },
      async (_client, event) => {
        await handleDomainEvent(
          {
            adminControl: this.#adminControl,
            availability: this.#availability,
            dispatch: this.#dispatch,
            fulfilment: this.#fulfilment,
            log: (name, fields) => workerLogger.event(name, fields),
            now: () => new Date(),
            orderMoney: this.#orderMoney,
          },
          context,
          event,
        );
        return null;
      },
    );
    workerLogger.event('outbox.event.consumed', {
      event_id: job.event_id,
      event_type: job.event_type,
    });
  }

  async #poll(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    const now = new Date();
    const context = createRequestContext({
      actor: createAuthenticatedActor({
        actor_id: this.#workerId,
        actor_kind: 'system',
        session_id: this.#workerId,
      }),
    });
    // Each domain service owns a small pool. Run maintenance claims in a
    // bounded sequence so a worker bootstrap cannot exhaust a hosted
    // database's connection cap before idle pool connections are released.
    //
    // Each pass is isolated: they all ran inside one try/catch with outbox
    // dispatch last, so a single failing pass — an expiry sweep, say — skipped
    // every pass after it and stalled outbox publishing entirely.
    const pass = async <Result>(name: string, run: () => Promise<Result>, fallback: Result) => {
      // Stopping between passes rather than mid-pass: each pass is a claim the
      // next tick will simply make again, so skipping one costs nothing.
      if (this.#stopping) return fallback;
      try {
        return await run();
      } catch (error) {
        workerLogger.error(
          error instanceof Error ? error : new Error(`Operations pass ${name} failed`),
        );
        return fallback;
      }
    };
    try {
      const reservations = await pass(
        'inventory.expireDue',
        () => this.#inventory.expireDue({ context, now }),
        [],
      );
      const quotes = await pass(
        'checkout.expireQuotes',
        () => this.#checkout.expireQuotes({ now }),
        0,
      );
      const accepts = await pass(
        'fulfilment.timeoutOverdueAccepts',
        () => this.#fulfilment.timeoutOverdueAccepts({ context, now }),
        [],
      );
      const decisions = await pass(
        'fulfilment.timeoutOverdueDecisions',
        () => this.#fulfilment.timeoutOverdueDecisions({ context, now }),
        [],
      );
      const offers = await pass(
        'assignments.expireOffers',
        () =>
          this.#assignments.expireOffers({
            command_prefix: `SYNTH-CMD-WORKER-${now.toISOString().slice(0, 16).replaceAll(/[-:T]/g, '')}`,
            context,
            now,
          }),
        0,
      );
      const documents = await pass(
        'onboarding.advanceDocumentDeadlines',
        () => this.#onboarding.advanceDocumentDeadlines({ at: now, context }),
        0,
      );
      const offlineProofs = await pass(
        'partnerField.expireOfflineProofs',
        () =>
          this.#partnerField.expireOfflineProofs({
            context,
            now,
            older_than: new Date(now.getTime() - OFFLINE_PROOF_TTL_MS),
          }),
        [],
      );
      const controls = await pass(
        'adminControl.expireOperationalControls',
        () => this.#adminControl.expireOperationalControls({ context, now }),
        { incidents: 0, trust: 0 },
      );
      const waitTimers = await pass(
        'partnerWait.advanceDue',
        () => this.#partnerWait.advanceDue({ context, now }),
        0,
      );
      const notificationSignals = await pass(
        'notifications.syncDomainSignals',
        () => this.#notifications.syncDomainSignals({ context, now }),
        0,
      );
      const notifications = await pass(
        'notifications.deliverPending',
        () => this.#notifications.deliverPending({ context, now }),
        0,
      );
      const dispatch = await pass(
        'dispatch.offerReadyAssignments',
        () =>
          this.#dispatch.offerReadyAssignments({
            command_prefix: `SYNTH-CMD-WORKER-${now.toISOString().slice(0, 16).replaceAll(/[-:T]/g, '')}`,
            context,
            now,
          }),
        { offered: 0, returned: 0, waiting: 0 },
      );
      const configurations = await pass(
        'configuration.activateDue',
        () =>
          this.#configuration.activateDue({
            actor_id: this.#workerId,
            at: now,
            request_id: context.request_id,
          }),
        [],
      );
      // Dispatch runs regardless of the passes above; it is the path that
      // moves committed domain events out of the database.
      const outbox = await dispatchOutboxBatch(this.#pool, {
        batch_size: 100,
        publish: async (event) => {
          workerLogger.event('outbox.event.published', {
            aggregate_id: event.aggregate_id,
            aggregate_type: event.aggregate_type,
            event_id: event.event_id,
            event_type: event.event_type,
          });
          const job = await this.#queue.add(
            'outbox.event',
            {
              causation_id: event.causation_id,
              correlation_id: event.correlation_id,
              event_id: event.event_id,
              event_type: event.event_type,
              kind: 'outbox',
              request_id: event.request_id,
              traceparent: formatTraceparent(context.trace),
            },
            { jobId: event.event_id, attempts: event.max_attempts },
          );
          if ((await job.getState()) === 'failed') await job.retry();
          // The job is durable once added. Waiting for it to be consumed keeps
          // ordering tight while the worker is running, but during shutdown it
          // would block for up to a minute on a consumer that is closing.
          if (this.#stopping) return;
          await job.waitUntilFinished(this.#queueEvents, 60_000);
        },
        worker_id: this.#workerId,
      });
      const changed =
        reservations.length +
        quotes +
        accepts.length +
        decisions.length +
        offers +
        documents +
        offlineProofs.length +
        controls.trust +
        controls.incidents +
        waitTimers +
        notificationSignals +
        notifications +
        configurations.length +
        dispatch.offered +
        dispatch.returned +
        outbox.published;
      if (changed > 0) {
        workerLogger.event('operations.deadlines.processed', {
          accepts: accepts.length,
          decisions: decisions.length,
          documents,
          offline_proofs: offlineProofs.length,
          trust_controls: controls.trust,
          incident_controls: controls.incidents,
          wait_timers: waitTimers,
          notification_signals: notificationSignals,
          notifications,
          configurations: configurations.length,
          dispatch_offered: dispatch.offered,
          dispatch_returned: dispatch.returned,
          dispatch_waiting: dispatch.waiting,
          offers,
          outbox: outbox.published,
          quotes,
          reservations: reservations.length,
        });
      }
    } catch (error) {
      workerLogger.error(error instanceof Error ? error : new Error('Operations worker failed'));
    } finally {
      this.#running = false;
    }
  }
}
