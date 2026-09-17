import { Client } from 'pg';
import { loadDatabaseConfig, loadProductionRuntimeDatabaseConfig } from '../src/config.js';
import { withDatabaseClient } from '../src/client.js';
import { migrationStatus } from '../src/migrations.js';
import { writeEvent } from '../src/output.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertVerifiedTls(client: Client): void {
  const stream = (
    client as unknown as {
      readonly connection?: {
        readonly stream?: { readonly authorized?: boolean; readonly encrypted?: boolean };
      };
    }
  ).connection?.stream;
  assert(stream?.encrypted === true, 'Production client connection is not encrypted');
  assert(stream.authorized === true, 'Production server certificate was not authorized');
}

const config = loadDatabaseConfig('supabase-production');
await withDatabaseClient(config, async (client) => {
  assertVerifiedTls(client);
  const migrations = await migrationStatus(client);
  assert(
    migrations.every(({ applied }) => applied),
    'Production has pending migrations',
  );

  const result = await client.query<{
    app_login: boolean;
    app_superuser: boolean;
    postgis: boolean;
    public_schema_access: boolean;
    runtime_role: boolean;
  }>(`
    SELECT
      EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS postgis,
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marketplace_runtime' AND NOT rolcanlogin) AS runtime_role,
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marketplace_app' AND rolcanlogin) AS app_login,
      COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = 'marketplace_app'), false) AS app_superuser,
      has_schema_privilege('public', 'marketplace', 'USAGE') AS public_schema_access
  `);
  const checks = result.rows[0];
  assert(checks?.postgis, 'PostGIS is not installed');
  assert(checks.runtime_role, 'marketplace_runtime NOLOGIN role is missing');
  assert(
    checks.app_login && !checks.app_superuser,
    'Least-privilege marketplace_app login is missing',
  );
  assert(!checks.public_schema_access, 'PUBLIC still has marketplace schema access');

  const exposed = await client.query<{ count: string }>(`
    SELECT count(*)::text AS count
    FROM information_schema.role_table_grants
    WHERE table_schema IN ('marketplace', 'public')
      AND table_name = CASE
        WHEN table_schema = 'public' THEN 'marketplace_schema_migrations'
        ELSE table_name
      END
      AND grantee IN ('PUBLIC', 'anon', 'authenticated')
  `);
  assert(exposed.rows[0]?.count === '0', 'Supabase client roles have direct marketplace grants');

  writeEvent('database.production.verified', {
    migrations: migrations.length,
    postgis: true,
    public_access: false,
    runtime_role: 'marketplace_app',
    ssl: true,
  });
});

const runtimeConfig = loadProductionRuntimeDatabaseConfig();
const runtime = new Client({
  application_name: 'neighbourhood-store-production-runtime-verifier',
  connectionString: runtimeConfig.connectionString,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
});
await runtime.connect();
try {
  assertVerifiedTls(runtime);
  const result = await runtime.query<{
    current_user: string;
    schema_access: boolean;
    superuser: boolean;
  }>(`
    SELECT
      current_user,
      has_schema_privilege(current_user, 'marketplace', 'USAGE') AS schema_access,
      COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS superuser
  `);
  const checks = result.rows[0];
  assert(
    checks?.current_user === 'marketplace_app',
    'Runtime did not authenticate as marketplace_app',
  );
  assert(checks.schema_access, 'marketplace_app cannot use the marketplace schema');
  assert(!checks.superuser, 'marketplace_app unexpectedly has superuser privileges');
  writeEvent('database.production_runtime.verified', {
    role: checks.current_user,
    schema_access: true,
    superuser: false,
  });
} finally {
  await runtime.end();
}
