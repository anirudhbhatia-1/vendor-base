import {
  loadSharedRuntimeConfig,
  resolveSecretMaterial,
  type RuntimeEnvironment,
  type SharedRuntimeConfig,
} from '@neighbourhood-store/database';

export const RUNTIME_CONFIG = Symbol('RUNTIME_CONFIG');
export type { RuntimeEnvironment };

export interface RuntimeConfig extends SharedRuntimeConfig {
  readonly host: string;
  readonly otpHashKey: string;
  readonly otpProvider: 'fake';
  readonly port: number;
  readonly sessionTokenHashKey: string;
  readonly supabaseServiceRoleKey: string | undefined;
  readonly supabaseUrl: string | undefined;
}

export function loadRuntimeConfig(): RuntimeConfig {
  const shared = loadSharedRuntimeConfig();
  const rawPort = process.env.API_PORT ?? '3001';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('API_PORT must be an integer from 1 to 65535');
  }
  const otpProvider = process.env.OTP_ADAPTER ?? 'fake';
  if (otpProvider !== 'fake') {
    throw new Error(
      `OTP_ADAPTER "${otpProvider}" has no implemented adapter; the approved MSG91 integration remains an open D-15 gate`,
    );
  }
  // The fake adapter issues predictable one-time passwords, so it may never
  // authenticate a deployment anyone but the running developer can reach. This is now
  // a separate gate from object storage: the Supabase storage adapter is real, so an
  // environment can have working storage and still have no usable OTP provider.
  if (!shared.syntheticProvidersAcknowledged) {
    throw new Error(
      `The fake OTP adapter cannot authenticate the ${shared.environment} environment; the approved MSG91 integration is an open D-15 gate. Set ALLOW_SYNTHETIC_PROVIDERS=synthetic-testing-only to run a knowingly synthetic deployment`,
    );
  }
  const otpHashKey = resolveSecretMaterial({
    environment: shared.environment,
    localDefault: ['local', 'synthetic', 'otp', 'hash', 'material', 'only'].join('-'),
    name: 'OTP_HASH_KEY',
  });
  const sessionTokenHashKey = resolveSecretMaterial({
    environment: shared.environment,
    localDefault: ['local', 'synthetic', 'session', 'token', 'hash', 'material'].join('-'),
    name: 'SESSION_TOKEN_HASH_KEY',
  });
  if (sessionTokenHashKey === otpHashKey) {
    throw new Error('SESSION_TOKEN_HASH_KEY must differ from OTP_HASH_KEY');
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (shared.environment === 'supabase-production' && (!supabaseUrl || !supabaseServiceRoleKey)) {
    throw new Error('Supabase admin configuration is required for supabase-production');
  }
  return Object.freeze({
    ...shared,
    host: process.env.API_HOST ?? '127.0.0.1',
    otpHashKey,
    otpProvider: 'fake',
    port,
    sessionTokenHashKey,
    supabaseServiceRoleKey,
    supabaseUrl,
  });
}
