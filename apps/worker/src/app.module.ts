import {
  createDomainServices,
  createProtectedObjectStorage,
  type DomainServices,
} from '@neighbourhood-store/database';
import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { DOMAIN_SERVICES } from './tokens.js';
import { WorkerLifecycleService } from './worker-lifecycle.service.js';
import { FinancePayoutWorkerService } from './finance-payout-worker.service.js';
import { workerLogger } from './json-logger.js';
import { OperationsWorkerService } from './operations-worker.service.js';
import { loadRuntimeConfig } from './runtime-config.js';

@Module({
  providers: [
    {
      // The same composition the API builds (composition.ts): one shared pool,
      // and the same hash keys, storage driver and routing, so a code the API
      // issued verifies here and evidence lands in the same store.
      provide: DOMAIN_SERVICES,
      useFactory: (): DomainServices => {
        const config = loadRuntimeConfig();
        return createDomainServices({
          application_name: 'neighbourhood-store-worker',
          config,
          log: (event, fields) => workerLogger.event(event, fields),
          otp_hash_key: config.otpHashKey,
          session_token_hash_key: config.sessionTokenHashKey,
          storage: createProtectedObjectStorage({
            config,
            ...(config.supabaseServiceRoleKey
              ? { supabase_service_role_key: config.supabaseServiceRoleKey }
              : {}),
            ...(config.supabaseUrl ? { supabase_url: config.supabaseUrl } : {}),
          }),
        });
      },
    },
    WorkerLifecycleService,
    FinancePayoutWorkerService,
    OperationsWorkerService,
  ],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(DOMAIN_SERVICES) private readonly services: DomainServices) {}

  // Runs after every provider's own shutdown hook (Nest calls the module class
  // last), so both queue workers have drained before the shared pool ends.
  async onApplicationShutdown(): Promise<void> {
    await this.services.close();
  }
}
