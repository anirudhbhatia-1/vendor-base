export const RUNTIME_CONFIG = Symbol('RUNTIME_CONFIG');

export type RuntimeEnvironment = 'local' | 'test' | 'queue-compat' | 'online-test';

export interface RuntimeConfig {
  readonly environment: RuntimeEnvironment;
  readonly host: string;
  readonly port: number;
  readonly version: string;
  readonly dataMode: 'synthetic';
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

  const rawPort = process.env.API_PORT ?? '3001';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('API_PORT must be an integer from 1 to 65535');
  }

  return Object.freeze({
    environment: environment as RuntimeEnvironment,
    host: process.env.API_HOST ?? '127.0.0.1',
    port,
    version,
    dataMode,
  });
}
