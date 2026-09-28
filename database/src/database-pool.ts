import { Pool, type PoolConfig } from 'pg';

const SAFE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

/**
 * Creates a PostgreSQL pool with the mandatory idle-client error listener.
 *
 * `pg` emits idle connection failures on the pool itself; without a listener,
 * a transient hosted-pooler reset becomes an uncaught exception and terminates
 * the API or worker. Only non-sensitive error metadata is written here because
 * this package is shared by both composition roots.
 */
export function createDatabasePool(config: PoolConfig): Pool {
  return instrumentPool(new Pool(config));
}

/** Pools created by resolveServicePool, which releaseServicePool may end. */
const ownedPools = new WeakSet<Pool>();

export interface ServicePoolInput {
  readonly connection_string?: string;
  /**
   * A pool shared by a composition root. When present the service uses it and
   * never ends it: the root that created the pool ends it. Sharing one pool
   * across the domain services keeps a process within a hosted pooler's
   * connection cap, which ~35 per-service pools exceed.
   */
  readonly pool?: Pool;
}

/**
 * Resolves the pool a domain service runs on: the injected shared pool when a
 * composition root provides one, otherwise a pool of the service's own with
 * the given defaults, which the service releases in close().
 */
export function resolveServicePool(
  input: ServicePoolInput,
  defaults: Omit<PoolConfig, 'connectionString'>,
): Pool {
  if (input.pool) return input.pool;
  if (!input.connection_string) {
    throw new Error('A domain service needs a connection_string or a shared pool');
  }
  const pool = createDatabasePool({ ...defaults, connectionString: input.connection_string });
  ownedPools.add(pool);
  return pool;
}

/**
 * Ends a pool the calling service owns; a no-op for an injected shared pool,
 * and for a pool already released by a service it was forwarded to.
 */
export async function releaseServicePool(pool: Pool): Promise<void> {
  if (!ownedPools.has(pool)) return;
  ownedPools.delete(pool);
  await pool.end();
}

function instrumentPool(pool: Pool): Pool {
  const report = (event: string, error: Error & { readonly code?: string }) => {
    const code = error.code ?? 'DATABASE_POOL_ERROR';
    process.stderr.write(
      `${JSON.stringify({
        error_code: code,
        error_message: SAFE_NETWORK_CODES.has(code)
          ? 'Database connection interrupted'
          : error.message,
        event,
        timestamp: new Date().toISOString(),
      })}\n`,
    );
  };
  pool.on('error', (error: Error & { readonly code?: string }) =>
    report('database.pool.idle_client_error', error),
  );
  // pg-pool listens on a client only while it is idle: the listener comes off
  // at checkout and goes back on at release. A hosted pooler closing the
  // socket under a client mid-transaction therefore emitted 'error' on a client
  // nobody was listening to, and Node ended the worker with "Connection
  // terminated unexpectedly". The statement in flight still rejects to its
  // caller through the client's query queue; this listener only stops the
  // unhandled event, and it stays for the life of the connection because
  // pg-pool removes only its own.
  pool.on('connect', (client) => {
    client.on('error', (error: Error & { readonly code?: string }) =>
      report('database.pool.client_error', error),
    );
  });
  return pool;
}
