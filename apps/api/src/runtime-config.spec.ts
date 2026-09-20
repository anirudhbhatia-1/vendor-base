import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { loadRuntimeConfig } from './runtime-config.js';

const managedKeys = [
  'ALLOW_SYNTHETIC_PROVIDERS',
  'APP_ENV',
  'MAPBOX_ACCESS_TOKEN',
  'ROUTING_PROVIDER',
  'OBJECT_STORAGE_CATALOGUE_BUCKET',
  'OBJECT_STORAGE_DRIVER',
  'OBJECT_STORAGE_EVIDENCE_BUCKET',
  'OBJECT_STORAGE_GRANT_KEY',
  'OTP_ADAPTER',
  'OTP_HASH_KEY',
  'PAYMENT_WEBHOOK_KEY',
  'PROVIDER_CLEARING_ACCOUNT_REFERENCE',
  'SESSION_TOKEN_HASH_KEY',
  'SUPABASE_DATABASE_URL',
  'SUPABASE_PROJECT_REF',
] as const;

const original = new Map(managedKeys.map((key) => [key, process.env[key]] as const));

function restore(): void {
  for (const [key, value] of original) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
}

function configureLocal(): void {
  process.env.APP_ENV = 'local';
  delete process.env.ALLOW_SYNTHETIC_PROVIDERS;
  delete process.env.OTP_ADAPTER;
  delete process.env.OTP_HASH_KEY;
  delete process.env.SESSION_TOKEN_HASH_KEY;
}

/** A remote-database development runtime with every operator-injected value supplied. */
function configureRemoteDevelopment(): void {
  process.env.APP_ENV = 'supabase-dev';
  process.env.ALLOW_SYNTHETIC_PROVIDERS = 'synthetic-testing-only';
  process.env.SUPABASE_PROJECT_REF = 'abcdefghijklmnopqrst';
  process.env.SUPABASE_DATABASE_URL =
    'postgresql://postgres.abcdefghijklmnopqrst:URL_ENCODED_TEST_PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
  process.env.OBJECT_STORAGE_GRANT_KEY = 'injected-object-grant-material-for-supabase-dev';
  process.env.PAYMENT_WEBHOOK_KEY = 'injected-payment-webhook-material-for-supabase-dev';
  process.env.PROVIDER_CLEARING_ACCOUNT_REFERENCE = 'SUPABASE-DEV-CLEARING-ACCOUNT';
  process.env.OTP_HASH_KEY = 'injected-one-time-password-hash-material-dev';
  process.env.SESSION_TOKEN_HASH_KEY = 'injected-session-token-hash-material-dev';
}

describe('loadRuntimeConfig identity material policy', () => {
  afterEach(restore);

  it('uses committed synthetic material in local development', () => {
    configureLocal();
    const config = loadRuntimeConfig();
    assert.equal(config.otpProvider, 'fake');
    assert.ok(config.sessionTokenHashKey.length >= 32);
  });

  it('names the unimplemented adapter when a real OTP provider is requested', () => {
    configureLocal();
    process.env.OTP_ADAPTER = 'msg91';
    assert.throws(loadRuntimeConfig, /has no implemented adapter/);
  });

  it('refuses a remote runtime with no injected session token hash key', () => {
    configureRemoteDevelopment();
    delete process.env.SESSION_TOKEN_HASH_KEY;
    assert.throws(loadRuntimeConfig, /SESSION_TOKEN_HASH_KEY must be injected/);
  });

  it('refuses committed synthetic session material on a remote runtime', () => {
    configureRemoteDevelopment();
    process.env.SESSION_TOKEN_HASH_KEY = 'local-synthetic-session-token-hash-material';
    assert.throws(loadRuntimeConfig, /must not reuse committed synthetic material/);
  });

  it('refuses an env.example placeholder session token hash key', () => {
    configureRemoteDevelopment();
    process.env.SESSION_TOKEN_HASH_KEY =
      'replace-with-different-private-random-material-at-least-32-characters';
    assert.throws(loadRuntimeConfig, /still contains an env.example placeholder/);
  });

  it('refuses one value reused for both the session and one-time-password digests', () => {
    configureRemoteDevelopment();
    process.env.SESSION_TOKEN_HASH_KEY = 'injected-one-time-password-hash-material-dev';
    assert.throws(loadRuntimeConfig, /must differ from OTP_HASH_KEY/);
  });

  it('accepts a fully injected remote development configuration', () => {
    configureRemoteDevelopment();
    const config = loadRuntimeConfig();
    assert.equal(config.environment, 'supabase-dev');
    assert.equal(config.otpHashKey, 'injected-one-time-password-hash-material-dev');
    assert.notEqual(config.sessionTokenHashKey, config.otpHashKey);
  });
});

describe('the fake OTP gate is independent of object storage', () => {
  afterEach(restore);

  it('still refuses a remote runtime that has real storage but no OTP provider', () => {
    configureRemoteDevelopment();
    // Real storage, so the shared storage gate is satisfied on its own.
    Reflect.deleteProperty(process.env, 'ALLOW_SYNTHETIC_PROVIDERS');
    process.env.OBJECT_STORAGE_DRIVER = 'supabase';
    process.env.OBJECT_STORAGE_CATALOGUE_BUCKET = 'catalogue-approved';
    process.env.OBJECT_STORAGE_EVIDENCE_BUCKET = 'evidence-quarantine';
    // Real roads too (D-17), so the shared routing gate is satisfied on its own.
    process.env.ROUTING_PROVIDER = 'mapbox';
    process.env.MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoidW5pdCIsImEiOiJ0ZXN0MDEyMyJ9.unit-test-signature';
    assert.throws(loadRuntimeConfig, /fake OTP adapter cannot authenticate/);
  });
});
