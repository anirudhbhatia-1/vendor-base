import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { workerLogger } from './json-logger.js';
import { loadRuntimeConfig } from './runtime-config.js';

@Injectable()
export class WorkerLifecycleService implements OnApplicationBootstrap, OnApplicationShutdown {
  private heartbeat: NodeJS.Timeout | undefined;

  onApplicationBootstrap(): void {
    const config = loadRuntimeConfig();
    workerLogger.event('worker.ready', {
      environment: config.environment,
      data_mode: config.dataMode,
      version: config.version,
      queues: ['finance.payout', 'marketplace.operations', 'marketplace.outbox'],
      production_ready: false,
    });
    this.heartbeat = setInterval(() => {
      workerLogger.event('worker.heartbeat', {
        queues: ['finance.payout', 'marketplace.operations', 'marketplace.outbox'],
      });
    }, 30_000);
  }

  onApplicationShutdown(signal?: string): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    workerLogger.event('worker.stopped', { signal: signal ?? 'application_close' });
  }
}
