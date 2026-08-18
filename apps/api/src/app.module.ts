import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { LifecycleService } from './lifecycle.service.js';
import { loadRuntimeConfig, RUNTIME_CONFIG } from './runtime-config.js';

@Module({
  controllers: [HealthController],
  providers: [
    LifecycleService,
    {
      provide: RUNTIME_CONFIG,
      useFactory: loadRuntimeConfig,
    },
  ],
})
export class AppModule {}
