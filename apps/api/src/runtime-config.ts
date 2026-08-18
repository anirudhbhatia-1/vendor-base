export const RUNTIME_CONFIG = Symbol('RUNTIME_CONFIG');

export type RuntimeEnvironment = 'local' | 'test' | 'queue-compat';

export interface RuntimeConfig {
  readonly environment: RuntimeEnvironment;
  readonly host: string;
  readonly port: number;
  readonly version: string;
}

const allowedEnvironments = new Set<RuntimeEnvironment>(['local', 'test', 'queue-compat']);

export function loadRuntimeConfig(): RuntimeConfig {
  const environment = process.env.APP_ENV ?? 'local';
  if (!allowedEnvironments.has(environment as RuntimeEnvironment)) {
    throw new Error('APP_ENV must be local, test, or queue-compat');
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
    version: '0.0.0',
  });
}
