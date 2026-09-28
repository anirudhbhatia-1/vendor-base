import {
  loadSharedRuntimeConfig,
  resolveSecretMaterial,
  type RuntimeEnvironment,
  type SharedRuntimeConfig,
} from '@neighbourhood-store/database';

export type { RuntimeEnvironment };

export interface RuntimeConfig extends SharedRuntimeConfig {
  /**
   * How long shutdown waits for an in-flight queue handler before giving up on it.
   *
   * The default stays short so a watch-mode restart is not held up by a hung job.
   * A deployment should raise it towards, but under, its own stop grace: the
   * online-test compose allows 30s, so abandoning work after 4s wasted 26s the
   * orchestrator was willing to give. An abandoned job is safe — it stays claimed
   * until it stalls and is retried, and every handler is idempotent — but it is
   * needless latency and load.
   */
  readonly shutdownGraceMs: number;
  /**
   * The same key material the API resolves, because the worker builds the same
   * domain composition: custody and handover code digests written by one
   * process must verify in the other, so the resolution (name and local
   * default) must stay identical to the API's.
   */
  readonly otpHashKey: string;
  readonly sessionTokenHashKey: string;
  readonly supabaseServiceRoleKey: string | undefined;
  readonly supabaseUrl: string | undefined;
}

export function loadRuntimeConfig(): RuntimeConfig {
  const shared = loadSharedRuntimeConfig();
  const raw = process.env.WORKER_SHUTDOWN_GRACE_MS ?? '4000';
  const shutdownGraceMs = Number(raw);
  if (!Number.isInteger(shutdownGraceMs) || shutdownGraceMs < 1_000 || shutdownGraceMs > 120_000) {
    throw new Error('WORKER_SHUTDOWN_GRACE_MS must be an integer from 1000 to 120000');
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
  return Object.freeze({
    ...shared,
    otpHashKey,
    sessionTokenHashKey,
    shutdownGraceMs,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseUrl: process.env.SUPABASE_URL,
  });
}
