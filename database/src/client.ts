import { Client } from 'pg';
import type { DatabaseConfig } from './config.js';

const migrationLockId = 2_024_002_004;

export async function withDatabaseClient<T>(
  config: DatabaseConfig,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    application_name: `neighbourhood-store-${config.target}-database-tool`,
    connectionString: config.connectionString,
    connectionTimeoutMillis: 5_000,
    query_timeout: 30_000,
    statement_timeout: 30_000,
  });
  await client.connect();
  try {
    return await operation(client);
  } finally {
    await client.end();
  }
}

export async function withMigrationLock<T>(
  client: Client,
  operation: () => Promise<T>,
): Promise<T> {
  await client.query('SELECT pg_advisory_lock($1)', [migrationLockId]);
  try {
    return await operation();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [migrationLockId]);
  }
}

export async function inTransaction<T>(client: Client, operation: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await operation();
    await client.query('COMMIT');
    return result;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  }
}
