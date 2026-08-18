import { withDatabaseClient } from '../src/client.js';
import { loadDatabaseConfig, parseTarget } from '../src/config.js';
import { rebuildDatabase } from '../src/rebuild.js';

const target = parseTarget(process.argv.slice(2));
const config = loadDatabaseConfig(target);
await withDatabaseClient(config, (client) => rebuildDatabase(client, target));
