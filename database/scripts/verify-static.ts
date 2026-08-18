import { readdir, readFile } from 'node:fs/promises';
import { loadDatabaseConfig, requireOnlineTestMigrationConfirmation } from '../src/config.js';
import { writeEvent } from '../src/output.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectConfigRejection(url: string): Promise<void> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;
  try {
    let rejected = false;
    try {
      loadDatabaseConfig('local');
    } catch {
      rejected = true;
    }
    assert(rejected, 'Unsafe database URL was accepted');
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
}

function withOnlineEnvironment<T>(
  values: Record<string, string | undefined>,
  callback: () => T,
): T {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  }
}

const compose = await readFile(new URL('../../compose.yaml', import.meta.url), 'utf8');
assert(compose.includes('postgis/postgis:18-3.6@sha256:'), 'Compose image is not immutable');
assert(compose.includes("'127.0.0.1:5432:5432'"), 'Local database is not loopback-bound');
assert(compose.includes("'127.0.0.1:5433:5432'"), 'Test database is not loopback-bound');
assert(compose.includes('/var/lib/postgresql'), 'PostgreSQL 18 volume path is incorrect');
assert(compose.includes("profiles: ['test']"), 'Test database profile is missing');
assert(
  (compose.match(/test "\$\$\(cat \/proc\/1\/comm\)" = postgres/g) ?? []).length === 2,
  'Health checks can accept the temporary PostGIS initialization server',
);
assert(
  (compose.match(/platform: linux\/amd64/g) ?? []).length === 2,
  'PostGIS services must declare the image platform explicitly',
);
assert(!compose.includes('0.0.0.0'), 'Compose exposes a database on all interfaces');

const migrationFiles = (await readdir(new URL('../migrations/', import.meta.url))).sort();
const upNames = migrationFiles
  .filter((name) => name.endsWith('.up.sql'))
  .map((name) => name.replace('.up.sql', ''));
const downNames = migrationFiles
  .filter((name) => name.endsWith('.down.sql'))
  .map((name) => name.replace('.down.sql', ''));
assert(
  JSON.stringify(upNames) === JSON.stringify(downNames),
  'Migration up/down files are unpaired',
);
assert(upNames.length === 1 && upNames[0] === '0000_baseline', 'Unexpected baseline migrations');

for (const filename of migrationFiles) {
  const sql = await readFile(new URL(`../migrations/${filename}`, import.meta.url), 'utf8');
  assert(!/^\s*(BEGIN|COMMIT|ROLLBACK)\b/im.test(sql), `${filename} contains transaction control`);
}

await expectConfigRejection(
  'postgresql://example:example@database.example.com:5432/neighbourhood_store_local',
);
await expectConfigRejection(
  'postgresql://example:example@127.0.0.1:5432/neighbourhood_store_production',
);

const projectRef = 'abcdefghijklmnopqrst';
withOnlineEnvironment(
  {
    ONLINE_TEST_DATABASE_URL: `postgresql://postgres:synthetic@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
    ONLINE_TEST_SUPABASE_PROJECT_REF: projectRef,
    ONLINE_TEST_MIGRATION_CONFIRM: `apply-${projectRef}-online-test`,
  },
  () => {
    const online = loadDatabaseConfig('online-test');
    assert(online.target === 'online-test', 'Safe Supabase online-test target was rejected');
    requireOnlineTestMigrationConfirmation('online-test');
  },
);

withOnlineEnvironment(
  {
    ONLINE_TEST_DATABASE_URL:
      'postgresql://postgres:synthetic@database.example.com:5432/postgres?sslmode=require',
    ONLINE_TEST_SUPABASE_PROJECT_REF: projectRef,
  },
  () => {
    let rejected = false;
    try {
      loadDatabaseConfig('online-test');
    } catch {
      rejected = true;
    }
    assert(rejected, 'Non-Supabase online-test host was accepted');
  },
);

withOnlineEnvironment(
  {
    ONLINE_TEST_DATABASE_URL: `postgresql://postgres:synthetic@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
    ONLINE_TEST_SUPABASE_PROJECT_REF: projectRef,
    ONLINE_TEST_MIGRATION_CONFIRM: undefined,
  },
  () => {
    let rejected = false;
    try {
      requireOnlineTestMigrationConfirmation('online-test');
    } catch {
      rejected = true;
    }
    assert(rejected, 'Remote migration confirmation was not required');
  },
);

writeEvent('database.static_controls.verified', {
  compose_services: 2,
  migration_pairs: upNames.length,
});
