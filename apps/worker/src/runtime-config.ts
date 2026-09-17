import {
  loadSharedRuntimeConfig,
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
}

export function loadRuntimeConfig(): RuntimeConfig {
  const shared = loadSharedRuntimeConfig();
  const raw = process.env.WORKER_SHUTDOWN_GRACE_MS ?? '4000';
  const shutdownGraceMs = Number(raw);
  if (!Number.isInteger(shutdownGraceMs) || shutdownGraceMs < 1_000 || shutdownGraceMs > 120_000) {
    throw new Error('WORKER_SHUTDOWN_GRACE_MS must be an integer from 1000 to 120000');
  }
  return Object.freeze({ ...shared, shutdownGraceMs });
}
