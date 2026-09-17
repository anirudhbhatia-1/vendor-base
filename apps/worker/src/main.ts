import './telemetry.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { workerLogger } from './json-logger.js';
import { WorkerLifecycleService } from './worker-lifecycle.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: workerLogger });
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  // Every provider's bootstrap hook has resolved by this point, so the queues
  // are open and the worker can genuinely accept work.
  app.get(WorkerLifecycleService).markReady();
}

void bootstrap().catch((error: unknown) => {
  workerLogger.error(
    error instanceof Error ? error : new Error('Unknown worker bootstrap failure'),
  );
  process.exitCode = 1;
});
