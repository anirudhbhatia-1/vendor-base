import type { Client } from 'pg';
import { inTransaction, withMigrationLock } from './client.js';
import { requireRebuildConfirmation, type DatabaseTarget } from './config.js';
import { seedFixtures } from './fixtures.js';
import { migrateUp } from './migrations.js';
import { writeEvent } from './output.js';

export async function rebuildDatabase(client: Client, target: DatabaseTarget): Promise<string> {
  requireRebuildConfirmation(target);
  await withMigrationLock(client, async () => {
    await inTransaction(client, async () => {
      await client.query('DROP SCHEMA IF EXISTS marketplace_test CASCADE');
      await client.query('DROP SCHEMA IF EXISTS marketplace CASCADE');
      await client.query('DROP TABLE IF EXISTS public.marketplace_schema_migrations');
      await client.query('DROP EXTENSION IF EXISTS postgis CASCADE');
    });
  });
  writeEvent('database.rebuild.cleared', { target });
  await migrateUp(client);
  const hash = await seedFixtures(client);
  writeEvent('database.rebuild.completed', { hash, target });
  return hash;
}
