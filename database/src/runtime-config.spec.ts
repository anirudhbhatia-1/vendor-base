import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { loadSharedRuntimeConfig } from './runtime-config.js';

const managedKeys = [
  'ALLOW_SYNTHETIC_PROVIDERS',
  'APP_ENV',
  'DATABASE_URL',
  'SUPABASE_PROJECT_REF',
  'OBJECT_STORAGE_CATALOGUE_BUCKET',
  'OBJECT_STORAGE_DRIVER',
  'OBJECT_STORAGE_EVIDENCE_BUCKET',
  'OBJECT_STORAGE_GRANT_KEY',
  'PAYMENT_WEBHOOK_KEY',
  'PROVIDER_CLEARING_ACCOUNT_REFERENCE',
  'RELEASE_VERSION',
  'SUPABASE_DATABASE_URL',
  'VALKEY_URL',
] as const;

const original = new Map(managedKeys.map((key) => [key, process.env[key]] as const));

function restore(): void {
  for (const [key, value] of original) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
}

/** A deployed environment configured with every value an operator is expected to inject. */
function configureDeployedEnvironment(): void {
  process.env.APP_ENV = 'supabase-dev';
  process.env.ALLOW_SYNTHETIC_PROVIDERS = 'synthetic-testing-only';
  process.env.SUPABASE_PROJECT_REF = 'abcdefghijklmnopqrst';
  process.env.SUPABASE_DATABASE_URL =
    'postgresql://postgres.abcdefghijklmnopqrst:URL_ENCODED_TEST_PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
  process.env.OBJECT_STORAGE_GRANT_KEY = 'injected-object-grant-material-for-supabase-dev';
  process.env.PAYMENT_WEBHOOK_KEY = 'injected-payment-webhook-material-for-supabase-dev';
  process.env.PROVIDER_CLEARING_ACCOUNT_REFERENCE = 'SUPABASE-DEV-CLEARING-ACCOUNT';
}

describe('loadSharedRuntimeConfig secret material policy', () => {
  afterEach(restore);

  it('permits committed synthetic material in local development', () => {
    process.env.APP_ENV = 'local';
    delete process.env.ALLOW_SYNTHETIC_PROVIDERS;
    delete process.env.OBJECT_STORAGE_GRANT_KEY;
    delete process.env.PAYMENT_WEBHOOK_KEY;
    delete process.env.PROVIDER_CLEARING_ACCOUNT_REFERENCE;
    const config = loadSharedRuntimeConfig();
    assert.equal(config.environment, 'local');
    assert.equal(config.syntheticProvidersAcknowledged, true);
    assert.ok(config.paymentWebhookKey.length >= 32);
  });

  it('refuses a deployed environment that never acknowledged the local-only adapters', () => {
    configureDeployedEnvironment();
    delete process.env.ALLOW_SYNTHETIC_PROVIDERS;
    assert.throws(loadSharedRuntimeConfig, /cannot serve the supabase-dev environment/);
  });

  it('refuses an unrecognised acknowledgement value', () => {
    configureDeployedEnvironment();
    process.env.ALLOW_SYNTHETIC_PROVIDERS = 'true';
    assert.throws(loadSharedRuntimeConfig, /ALLOW_SYNTHETIC_PROVIDERS/);
  });

  it('refuses a deployed environment with no injected payment webhook key', () => {
    configureDeployedEnvironment();
    delete process.env.PAYMENT_WEBHOOK_KEY;
    assert.throws(loadSharedRuntimeConfig, /PAYMENT_WEBHOOK_KEY must be injected/);
  });

  it('refuses committed synthetic material reused in a deployed environment', () => {
    configureDeployedEnvironment();
    process.env.PAYMENT_WEBHOOK_KEY = 'local-synthetic-payment-webhook-key-material';
    assert.throws(loadSharedRuntimeConfig, /must not reuse committed synthetic material/);
  });

  it('refuses an env.example placeholder in a deployed environment', () => {
    configureDeployedEnvironment();
    process.env.OBJECT_STORAGE_GRANT_KEY =
      'replace-with-another-private-random-value-at-least-32-characters';
    assert.throws(loadSharedRuntimeConfig, /still contains an env.example placeholder/);
  });

  it('refuses secret material shorter than the minimum length', () => {
    configureDeployedEnvironment();
    process.env.OBJECT_STORAGE_GRANT_KEY = 'too-short';
    assert.throws(loadSharedRuntimeConfig, /at least 32 characters/);
  });

  it('refuses a deployed environment with no provider clearing account', () => {
    configureDeployedEnvironment();
    delete process.env.PROVIDER_CLEARING_ACCOUNT_REFERENCE;
    assert.throws(loadSharedRuntimeConfig, /PROVIDER_CLEARING_ACCOUNT_REFERENCE must name/);
  });

  it('accepts a fully injected deployed configuration', () => {
    configureDeployedEnvironment();
    const config = loadSharedRuntimeConfig();
    assert.equal(config.environment, 'supabase-dev');
    assert.equal(config.syntheticProvidersAcknowledged, true);
    assert.equal(config.providerClearingAccountReference, 'SUPABASE-DEV-CLEARING-ACCOUNT');
    assert.notEqual(config.paymentWebhookKey, 'local-synthetic-payment-webhook-key-material');
  });
});

describe('object-storage driver selection', () => {
  afterEach(restore);

  it('defaults local development to the filesystem adapter', () => {
    process.env.APP_ENV = 'local';
    Reflect.deleteProperty(process.env, 'OBJECT_STORAGE_DRIVER');
    const config = loadSharedRuntimeConfig();
    assert.equal(config.objectStorageDriver, 'filesystem');
    assert.equal(config.objectStorageBuckets, undefined);
  });

  it('refuses a driver that has no adapter', () => {
    process.env.APP_ENV = 'local';
    process.env.OBJECT_STORAGE_DRIVER = 's3';
    assert.throws(loadSharedRuntimeConfig, /must be filesystem or supabase/);
  });

  it('refuses the local-only filesystem adapter on a remote runtime', () => {
    configureDeployedEnvironment();
    Reflect.deleteProperty(process.env, 'ALLOW_SYNTHETIC_PROVIDERS');
    assert.throws(loadSharedRuntimeConfig, /filesystem object-storage adapter is local-only/);
  });

  it('lets the Supabase adapter serve a remote runtime with no synthetic acknowledgement', () => {
    configureDeployedEnvironment();
    Reflect.deleteProperty(process.env, 'ALLOW_SYNTHETIC_PROVIDERS');
    process.env.OBJECT_STORAGE_DRIVER = 'supabase';
    process.env.OBJECT_STORAGE_CATALOGUE_BUCKET = 'catalogue-approved';
    process.env.OBJECT_STORAGE_EVIDENCE_BUCKET = 'evidence-quarantine';
    const config = loadSharedRuntimeConfig();
    assert.equal(config.objectStorageDriver, 'supabase');
    assert.equal(config.syntheticProvidersAcknowledged, false);
    assert.deepEqual(config.objectStorageBuckets, {
      catalogue_images: 'catalogue-approved',
      vendor_onboarding: 'evidence-quarantine',
    });
  });

  it('refuses the Supabase adapter with no buckets named', () => {
    configureDeployedEnvironment();
    process.env.OBJECT_STORAGE_DRIVER = 'supabase';
    process.env.OBJECT_STORAGE_CATALOGUE_BUCKET = 'catalogue-approved';
    Reflect.deleteProperty(process.env, 'OBJECT_STORAGE_EVIDENCE_BUCKET');
    assert.throws(loadSharedRuntimeConfig, /OBJECT_STORAGE_EVIDENCE_BUCKET/);
  });

  it('refuses quarantined evidence sharing the catalogue bucket', () => {
    configureDeployedEnvironment();
    process.env.OBJECT_STORAGE_DRIVER = 'supabase';
    process.env.OBJECT_STORAGE_CATALOGUE_BUCKET = 'one-bucket';
    process.env.OBJECT_STORAGE_EVIDENCE_BUCKET = 'one-bucket';
    assert.throws(loadSharedRuntimeConfig, /must not share a bucket/);
  });
});
