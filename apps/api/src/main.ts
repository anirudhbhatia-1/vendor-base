import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { apiLogger } from './json-logger.js';
import { RUNTIME_CONFIG, type RuntimeConfig } from './runtime-config.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { logger: apiLogger },
  );
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);

  const config = app.get<RuntimeConfig>(RUNTIME_CONFIG);
  await app.listen(config.port, config.host);
  apiLogger.event('api.started', {
    environment: config.environment,
    data_mode: config.dataMode,
    host: config.host,
    port: config.port,
    version: config.version,
    production_ready: false,
  });
}

void bootstrap().catch((error: unknown) => {
  apiLogger.error(error instanceof Error ? error : new Error('Unknown API bootstrap failure'));
  process.exitCode = 1;
});
