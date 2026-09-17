import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabasePool } from './database-pool.js';

test('database pools handle idle client errors instead of crashing the process', async () => {
  const pool = createDatabasePool({
    connectionString: 'postgresql://example:example@127.0.0.1:1/example',
  });
  try {
    assert.equal(pool.listenerCount('error'), 1);
  } finally {
    await pool.end();
  }
});
