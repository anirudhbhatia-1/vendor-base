import { loadDatabaseConfig } from '../src/config.js';
import { withDatabaseClient } from '../src/client.js';
import { writeEvent } from '../src/output.js';

const projectRef = process.env.SUPABASE_PRODUCTION_PROJECT_REF;
const expectedConfirmation = `provision-marketplace-app-${projectRef}`;
if (process.env.SUPABASE_PRODUCTION_ROLE_CONFIRM !== expectedConfirmation) {
  throw new Error(`Set SUPABASE_PRODUCTION_ROLE_CONFIRM=${expectedConfirmation}`);
}

const password = process.env.SUPABASE_PRODUCTION_RUNTIME_PASSWORD;
if (!password || password.length < 32 || /[\r\n]/.test(password)) {
  throw new Error(
    'SUPABASE_PRODUCTION_RUNTIME_PASSWORD must be at least 32 characters without newlines',
  );
}

const config = loadDatabaseConfig('supabase-production');
await withDatabaseClient(config, async (client) => {
  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('marketplace.bootstrap_password', $1, true)", [password]);
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marketplace_app') THEN
          EXECUTE format(
            'ALTER ROLE marketplace_app WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
            current_setting('marketplace.bootstrap_password')
          );
        ELSE
          EXECUTE format(
            'CREATE ROLE marketplace_app WITH LOGIN PASSWORD %L IN ROLE marketplace_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
            current_setting('marketplace.bootstrap_password')
          );
        END IF;
      END
      $$
    `);
    await client.query('GRANT marketplace_runtime TO marketplace_app');
    await client.query('ALTER ROLE marketplace_app SET search_path = marketplace, public');
    await client.query("ALTER ROLE marketplace_app SET statement_timeout = '30s'");
    await client.query("ALTER ROLE marketplace_app SET lock_timeout = '5s'");
    await client.query(
      "ALTER ROLE marketplace_app SET idle_in_transaction_session_timeout = '30s'",
    );
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  }
});

writeEvent('database.production_runtime.provisioned', {
  role: 'marketplace_app',
  target: 'supabase-production',
});
