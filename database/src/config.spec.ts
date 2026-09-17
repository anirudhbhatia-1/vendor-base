import assert from 'node:assert/strict';
import test from 'node:test';
import { loadProductionRuntimeDatabaseConfig } from './config.js';

const projectRef = 'abcdefghijklmnopqrst';
const originalEnvironment = { ...process.env };

function configure(mode: 'direct' | 'session' | 'transaction', port: '5432' | '6543'): void {
  process.env['SUPABASE_PRODUCTION_PROJECT_REF'] = projectRef;
  process.env['SUPABASE_PRODUCTION_RUNTIME_PASSWORD'] =
    'runtime-password-material-at-least-32-characters';
  process.env['SUPABASE_PRODUCTION_SSL_ROOT_CERT'] = '/run/secrets/supabase-ca.crt';
  process.env['SUPABASE_PRODUCTION_RUNTIME_CONNECTION_MODE'] = mode;
  process.env['SUPABASE_PRODUCTION_DATABASE_URL'] =
    `postgresql://marketplace_app.${projectRef}:placeholder@aws-0-ap-south-1.pooler.supabase.com:${port}/postgres?sslmode=verify-full`;
}

test.afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, originalEnvironment);
});

test('production transaction runtime resolves the Supavisor transaction port', () => {
  configure('transaction', '5432');
  const config = loadProductionRuntimeDatabaseConfig();
  assert.equal(new URL(config.connectionString).port, '6543');
});

test('production session runtime refuses the transaction port', () => {
  configure('session', '6543');
  assert.throws(
    () => loadProductionRuntimeDatabaseConfig(),
    /session runtime must use the shared pooler on port 5432/,
  );
});
