import { Controller, Get, Inject } from '@nestjs/common';
import { RUNTIME_CONFIG, type RuntimeConfig } from './runtime-config.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  @Get('live')
  liveness() {
    return {
      status: 'ok',
      service: 'marketplace-api',
      version: this.config.version,
      environment: this.config.environment,
      data_mode: this.config.dataMode,
    } as const;
  }

  @Get('ready')
  readiness() {
    return {
      status: 'ready',
      service: 'marketplace-api',
      version: this.config.version,
      environment: this.config.environment,
      data_mode: this.config.dataMode,
      production_ready: false,
      checks: {
        process: 'ready',
        database: 'not_configured',
        queue: 'not_configured',
      },
    } as const;
  }
}
