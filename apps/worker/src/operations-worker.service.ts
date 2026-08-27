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
  PartnerFieldOpsService,
  VendorFulfilmentService,
  VendorOnboardingService,
  dispatchOutboxBatch,
} from '@neighbourhood-store/database';
import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { workerLogger } from './json-logger.js';
import { loadRuntimeConfig } from './runtime-config.js';

const POLL_MS = 15_000;
const OFFLINE_PROOF_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * Runs the server-owned deadlines that must not depend on a browser being open.
 * PostgreSQL remains the durable queue in the approved local environment; every
 * claim uses the locking implemented by the owning domain service, so a second
 * worker can safely be started when load testing begins.
 */
@Injectable()
export class OperationsWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly #workerId = createUuidV7();
  readonly #pool: Pool;
  readonly #assignments: AssignmentCustodyService;
  readonly #adminControl: AdminControlPlaneService;
  readonly #checkout: GroupedCheckoutService;
  readonly #inventory: InventoryReservationService;
  readonly #partnerField: PartnerFieldOpsService;
  readonly #fulfilment: VendorFulfilmentService;
  readonly #onboarding: VendorOnboardingService;
  #poller: NodeJS.Timeout | undefined;
  #running = false;

  constructor() {
    const { databaseUrl } = loadRuntimeConfig();
    this.#pool = new Pool({
      application_name: 'neighbourhood-store-operations-worker',
      connectionString: databaseUrl,
      max: 4,
    });
    this.#inventory = new InventoryReservationService({ connection_string: databaseUrl });
    this.#adminControl = new AdminControlPlaneService({ connection_string: databaseUrl });
    this.#assignments = new AssignmentCustodyService({ connection_string: databaseUrl });
    this.#checkout = new GroupedCheckoutService({ connection_string: databaseUrl });
    this.#partnerField = new PartnerFieldOpsService({ connection_string: databaseUrl });
    this.#fulfilment = new VendorFulfilmentService({
      connection_string: databaseUrl,
      inventory: this.#inventory,
    });
    this.#onboarding = new VendorOnboardingService({
      connection_string: databaseUrl,
      storage: new LocalProtectedObjectStorage({
        grant_key: ['local', 'synthetic', 'protected', 'object', 'grant', 'material'].join('-'),
        root_directory: `${process.cwd()}/.local-data/objects`,
      }),
    });
  }

  onApplicationBootstrap(): void {
    void this.#poll();
    this.#poller = setInterval(() => void this.#poll(), POLL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.#poller) clearInterval(this.#poller);
    await Promise.all([
      this.#pool.end(),
      this.#assignments.close(),
      this.#adminControl.close(),
      this.#checkout.close(),
      this.#inventory.close(),
      this.#partnerField.close(),
      this.#fulfilment.close(),
      this.#onboarding.close(),
    ]);
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
    try {
      const [
        reservations,
        quotes,
        accepts,
        decisions,
        offers,
        documents,
        offlineProofs,
        controls,
        outbox,
      ] = await Promise.all([
        this.#inventory.expireDue({ context, now }),
        this.#checkout.expireQuotes({ now }),
        this.#fulfilment.timeoutOverdueAccepts({ context, now }),
        this.#fulfilment.timeoutOverdueDecisions({ context, now }),
        this.#assignments.expireOffers({
          command_prefix: `SYNTH-WORKER-${now.toISOString().slice(0, 16).replaceAll(/[-:T]/g, '')}`,
          context,
          now,
        }),
        this.#onboarding.advanceDocumentDeadlines({ at: now, context }),
        this.#partnerField.expireOfflineProofs({
          context,
          now,
          older_than: new Date(now.getTime() - OFFLINE_PROOF_TTL_MS),
        }),
        this.#adminControl.expireOperationalControls({ context, now }),
        dispatchOutboxBatch(this.#pool, {
          batch_size: 100,
          publish: async (event) => {
            workerLogger.event('outbox.event.published', {
              aggregate_id: event.aggregate_id,
              aggregate_type: event.aggregate_type,
              event_id: event.event_id,
              event_type: event.event_type,
            });
          },
          worker_id: this.#workerId,
        }),
      ]);
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
        outbox.published;
      if (changed > 0) {
        workerLogger.event('operations.deadlines.processed', {
          accepts: accepts.length,
          decisions: decisions.length,
          documents,
          offline_proofs: offlineProofs.length,
          trust_controls: controls.trust,
          incident_controls: controls.incidents,
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
