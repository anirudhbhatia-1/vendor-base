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
      version: config.version,
      queue: 'not_configured',
      production_ready: false,
    });
    this.heartbeat = setInterval(() => {
      workerLogger.event('worker.heartbeat', { queue: 'not_configured' });
    }, 30_000);
  }

  onApplicationShutdown(signal?: string): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    workerLogger.event('worker.stopped', { signal: signal ?? 'application_close' });
  }
}
