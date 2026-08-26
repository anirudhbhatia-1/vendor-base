import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNTIME_CONFIG = Symbol('RUNTIME_CONFIG');

export type RuntimeEnvironment = 'local' | 'test' | 'queue-compat' | 'online-test';

export interface RuntimeConfig {
  readonly environment: RuntimeEnvironment;
  readonly host: string;
  readonly port: number;
  readonly version: string;
  readonly dataMode: 'synthetic';
  readonly databaseUrl: string;
  readonly otpHashKey: string;
  readonly otpProvider: 'fake';
  readonly sessionTokenHashKey: string;
  readonly objectStorageDriver: 'filesystem';
  readonly objectStorageGrantKey: string;
  readonly objectStorageRoot: string;
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

  const otpProvider = process.env.OTP_ADAPTER ?? 'fake';
  if (otpProvider !== 'fake') throw new Error('Only the fake OTP adapter is allowed');
  const otpHashKey =
    process.env.OTP_HASH_KEY ?? ['local', 'synthetic', 'otp', 'hash', 'material', 'only'].join('-');
  if (otpHashKey.length < 32) throw new Error('OTP_HASH_KEY must contain at least 32 characters');
  const sessionTokenHashKey =
    process.env.SESSION_TOKEN_HASH_KEY ??
    ['local', 'synthetic', 'session', 'token', 'hash', 'material'].join('-');
  if (sessionTokenHashKey.length < 32) {
    throw new Error('SESSION_TOKEN_HASH_KEY must contain at least 32 characters');
  }
  const objectStorageDriver = process.env.OBJECT_STORAGE_DRIVER ?? 'filesystem';
  if (objectStorageDriver !== 'filesystem') {
    throw new Error('Only the local filesystem object-storage adapter is allowed');
  }
  const objectStorageGrantKey =
    process.env.OBJECT_STORAGE_GRANT_KEY ??
    ['local', 'synthetic', 'protected', 'object', 'grant', 'material'].join('-');
  if (objectStorageGrantKey.length < 32) {
    throw new Error('OBJECT_STORAGE_GRANT_KEY must contain at least 32 characters');
  }
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const objectStorageRoot = resolve(
    repositoryRoot,
    process.env.OBJECT_STORAGE_LOCAL_PATH ?? '.local-data/objects',
  );

  return Object.freeze({
    environment: environment as RuntimeEnvironment,
    host: process.env.API_HOST ?? '127.0.0.1',
    port,
    version,
    dataMode,
    databaseUrl:
      process.env.DATABASE_URL ??
      'postgresql://marketplace_local:marketplace_local_only@127.0.0.1:5432/neighbourhood_store_local',
    otpHashKey,
    otpProvider,
    objectStorageDriver,
    objectStorageGrantKey,
    objectStorageRoot,
    sessionTokenHashKey,
  });
}
