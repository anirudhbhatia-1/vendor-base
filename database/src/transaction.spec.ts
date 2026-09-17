import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { transaction } from './transaction.js';

function fakePool(options: { rollbackFails?: boolean } = {}) {
  const statements: string[] = [];
  let releasedWith: unknown = 'never released';
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql === 'ROLLBACK' && options.rollbackFails) throw new Error('rollback lost');
      return { rows: [] };
    },
    release: (error?: Error) => {
      releasedWith = error;
    },
  } as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as Pool;
  return { pool, statements, released: () => releasedWith };
}

test('a completed unit of work commits and returns the connection clean', async () => {
  const { pool, statements, released } = fakePool();
  const result = await transaction(pool, async () => 42);
  assert.equal(result, 42);
  assert.deepEqual(statements, ['BEGIN', 'COMMIT']);
  assert.equal(released(), undefined);
});

test('a refused unit of work rolls back, rethrows, and still returns the connection to the pool', async () => {
  // A domain refusal inside a transaction is the normal case -- every 409 is
  // one. Destroying the connection on each would churn the pooler for nothing.
  const { pool, statements, released } = fakePool();
  const refusal = new Error('not allowed in this state');
  await assert.rejects(
    transaction(pool, async () => {
      throw refusal;
    }),
    (raised) => raised === refusal,
  );
  assert.deepEqual(statements, ['BEGIN', 'ROLLBACK']);
  assert.equal(released(), undefined);
});

test('a connection whose rollback fails is destroyed, and the original error still wins', async () => {
  const { pool, released } = fakePool({ rollbackFails: true });
  const refusal = new Error('original');
  await assert.rejects(
    transaction(pool, async () => {
      throw refusal;
    }),
    (raised) => raised === refusal,
  );
  assert.ok(released() instanceof Error, 'the connection must be released with its failure');
});
