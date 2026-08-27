export type RuntimeEnvironment = 'local' | 'test' | 'queue-compat' | 'online-test';

export interface RuntimeConfig {
  readonly environment: RuntimeEnvironment;
  readonly version: string;
  readonly dataMode: 'synthetic';
  readonly databaseUrl: string;
}

const allowedEnvironments = new Set<RuntimeEnvironment>([
  'local',
  'test',
  'queue-compat',
  'online-test',
]);

export function loadRuntimeConfig(): RuntimeConfig {
  const environment = process.env.APP_ENV ?? 'local';
  if (!allowedEnvironments.has(environment as RuntimeEnvironment)) {
    throw new Error('APP_ENV must be local, test, queue-compat, or online-test');
  }
  const dataMode = process.env.DATA_MODE ?? 'synthetic';
  if (dataMode !== 'synthetic') throw new Error('Only synthetic DATA_MODE is allowed');

  const version = process.env.RELEASE_VERSION ?? '0.0.0';
  if (environment === 'online-test' && !/^[a-f0-9]{40}$/.test(version)) {
    throw new Error('online-test RELEASE_VERSION must be a full lowercase Git commit SHA');
  }
  return Object.freeze({
    environment: environment as RuntimeEnvironment,
    version,
    dataMode,
    databaseUrl:
      process.env.DATABASE_URL ??
      'postgresql://marketplace_local:marketplace_local_only@127.0.0.1:5432/neighbourhood_store_local',
  });
}
