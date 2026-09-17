import './telemetry.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { apiLogger } from './json-logger.js';
import { allowedMethods, isAllowedOrigin, parseConfiguredOrigins } from './cors.js';
import { RUNTIME_CONFIG, type RuntimeConfig } from './runtime-config.js';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({ bodyLimit: 7 * 1024 * 1024, logger: false });
  const { installRequestContextHook, parseIngressRequestIdMode } =
    await import('./request-context-hook.js');
  installRequestContextHook(adapter.getInstance(), {
    ingressRequestIdMode: parseIngressRequestIdMode(process.env.INGRESS_REQUEST_ID_MODE),
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: apiLogger,
  });
  const configuredOrigins = parseConfiguredOrigins(process.env.CORS_ALLOWED_ORIGINS);
  app.enableCors({
    methods: [...allowedMethods],
    origin: (origin, callback) => {
      // A same-origin or non-browser request sends no Origin header.
      if (!origin) callback(null, true);
      else callback(null, isAllowedOrigin(origin, configuredOrigins));
    },
  });
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
