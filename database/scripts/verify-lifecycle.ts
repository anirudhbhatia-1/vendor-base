import type { Client } from 'pg';
import { withDatabaseClient } from '../src/client.js';
import { loadDatabaseConfig } from '../src/config.js';
import {
  expectedFixtureHash,
  readFixtureHash,
  resetFixtures,
  seedFixtures,
} from '../src/fixtures.js';
import { migrateDown, migrateUp, migrationStatus } from '../src/migrations.js';
import { writeEvent } from '../src/output.js';
import { rebuildDatabase } from '../src/rebuild.js';

async function assertVersions(client: Client): Promise<void> {
  const result = await client.query<{
    postgis_version: string | null;
    server_version_number: string;
  }>(`SELECT
       current_setting('server_version_num') AS server_version_number,
       (SELECT extversion FROM pg_extension WHERE extname = 'postgis') AS postgis_version`);
  const versions = result.rows[0];
  if (!versions?.server_version_number.startsWith('18')) {
    throw new Error('Lifecycle verification requires PostgreSQL 18');
  }
  if (!versions.postgis_version?.startsWith('3.6.')) {
    throw new Error('Lifecycle verification requires PostGIS 3.6.x');
  }
}

const config = loadDatabaseConfig('test');
process.env.DB_REBUILD_CONFIRM = 'rebuild-neighbourhood-store-test';

await withDatabaseClient(config, async (client) => {
  await migrateUp(client);
  await assertVersions(client);

  const firstHash = await seedFixtures(client);
  const secondHash = await seedFixtures(client);
  if (firstHash !== expectedFixtureHash || secondHash !== expectedFixtureHash) {
    throw new Error('Repeated seed execution changed the fixture hash');
  }

  await resetFixtures(client);
  const resetHash = await seedFixtures(client);
  if (
    resetHash !== expectedFixtureHash ||
    (await readFixtureHash(client)) !== expectedFixtureHash
  ) {
    throw new Error('Fixture reset did not rebuild deterministic data');
  }

  const reverted = await migrateDown(client, 1);
  if (reverted !== 1) throw new Error('Expected the blank baseline to roll back once');
  const rolledBack = await client.query<{ postgis_exists: boolean; schema_exists: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS postgis_exists,
       to_regnamespace('marketplace') IS NOT NULL AS schema_exists`,
  );
  if (rolledBack.rows[0]?.postgis_exists || rolledBack.rows[0]?.schema_exists) {
    throw new Error('Baseline rollback left PostGIS or the domain schema installed');
  }

  await migrateUp(client);
  await assertVersions(client);
  const statuses = await migrationStatus(client);
  if (!statuses.every((status) => status.applied)) {
    throw new Error('Forward migration after rollback is incomplete');
  }

  const rebuiltHash = await rebuildDatabase(client, 'test');
  await assertVersions(client);
  if (rebuiltHash !== expectedFixtureHash) {
    throw new Error('Rebuild from zero changed the deterministic fixture hash');
  }

  writeEvent('database.lifecycle.verified', {
    fixture_hash: rebuiltHash,
    migrations: statuses.length,
    target: 'test',
  });
});
