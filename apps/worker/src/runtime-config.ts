export type RuntimeEnvironment = 'local' | 'test' | 'queue-compat';

export interface RuntimeConfig {
  readonly environment: RuntimeEnvironment;
  readonly version: string;
}

const allowedEnvironments = new Set<RuntimeEnvironment>(['local', 'test', 'queue-compat']);

export function loadRuntimeConfig(): RuntimeConfig {
  const environment = process.env.APP_ENV ?? 'local';
  if (!allowedEnvironments.has(environment as RuntimeEnvironment)) {
    throw new Error('APP_ENV must be local, test, or queue-compat');
  }
  return Object.freeze({ environment: environment as RuntimeEnvironment, version: '0.0.0' });
}
