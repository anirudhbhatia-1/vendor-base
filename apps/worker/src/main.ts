import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { workerLogger } from './json-logger.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: workerLogger });
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
}

void bootstrap().catch((error: unknown) => {
  workerLogger.error(
    error instanceof Error ? error : new Error('Unknown worker bootstrap failure'),
  );
  process.exitCode = 1;
});
