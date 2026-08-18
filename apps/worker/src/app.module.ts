import { Module } from '@nestjs/common';
import { WorkerLifecycleService } from './worker-lifecycle.service.js';

@Module({ providers: [WorkerLifecycleService] })
export class AppModule {}
