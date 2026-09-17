import type { Pool, PoolClient } from 'pg';

/**
 * One transaction boundary for the domain services.
 *
 * Twenty-four modules each declared this same function -- `tx`, `transaction`,
 * `withTransaction` -- with the same body, and each was free to drift. A
 * transaction helper is the last place drift should be possible: it decides
 * whether a failed statement leaves the connection clean before the pool
 * hands it to the next caller.
 *
 * A failed statement is rolled back and the connection goes back to the pool
 * clean -- a refused command is the normal case, not a broken connection. Only
 * when the rollback itself fails is the connection destroyed rather than
 * reused, because nothing can say what state it is in.
 */
export async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let poisoned: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackFailure) {
      poisoned =
        rollbackFailure instanceof Error ? rollbackFailure : new Error(String(rollbackFailure));
    }
    throw error;
  } finally {
    client.release(poisoned);
  }
}
