import { Module } from '@nestjs/common';
import { WorkerLifecycleService } from './worker-lifecycle.service.js';
import { FinancePayoutWorkerService } from './finance-payout-worker.service.js';
import { OperationsWorkerService } from './operations-worker.service.js';

@Module({
  providers: [WorkerLifecycleService, FinancePayoutWorkerService, OperationsWorkerService],
})
export class AppModule {}
