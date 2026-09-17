import { withDatabaseClient } from '../src/client.js';
import {
  loadDatabaseConfig,
  parseTarget,
  requireRemoteMigrationConfirmation,
} from '../src/config.js';
import { migrateDown, migrateUp, migrationStatus } from '../src/migrations.js';
import { writeEvent } from '../src/output.js';

const [command = 'status'] = process.argv.slice(2);
const target = parseTarget(process.argv.slice(2));
const config = loadDatabaseConfig(target);
const stepsIndex = process.argv.indexOf('--steps');
const steps = stepsIndex === -1 ? 1 : Number(process.argv[stepsIndex + 1]);

await withDatabaseClient(config, async (client) => {
  if (command === 'up') {
    requireRemoteMigrationConfirmation(target);
    const count = await migrateUp(client);
    writeEvent('database.migration.up.complete', { count, target });
    return;
  }
  if (command === 'down') {
    requireRemoteMigrationConfirmation(target);
    const count = await migrateDown(client, steps);
    writeEvent('database.migration.down.complete', { count, target });
    return;
  }
  if (command === 'status') {
    const statuses = await migrationStatus(client);
    for (const status of statuses) writeEvent('database.migration.status', status);
    return;
  }
  throw new Error('Migration command must be up, down, or status');
});
