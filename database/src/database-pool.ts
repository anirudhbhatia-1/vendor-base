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
  const pool = new Pool(config);
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
