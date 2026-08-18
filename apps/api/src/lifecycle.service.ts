import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { apiLogger } from './json-logger.js';

@Injectable()
export class LifecycleService implements OnApplicationShutdown {
  onApplicationShutdown(signal?: string): void {
    apiLogger.event('api.stopped', { signal: signal ?? 'application_close' });
  }
}
