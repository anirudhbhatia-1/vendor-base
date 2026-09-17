import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectDevelopmentConfig, profiles } from './preflight-supabase-development.mjs';

test('preflight reports multiple missing keys and never prints arbitrary credential values', () => {
  const issues = inspectDevelopmentConfig({
    OTP_ADAPTER: 'secret-value',
    SUPABASE_PRODUCTION_DATABASE_URL: 'not-a-url:secret-value',
  });
  assert.ok(issues.some((issue) => issue.startsWith('OTP_HASH_KEY: missing')));
  assert.ok(issues.some((issue) => issue.startsWith('SESSION_TOKEN_HASH_KEY: missing')));
  assert.ok(issues.some((issue) => issue.startsWith('ALLOW_SYNTHETIC_PROVIDERS:')));
  assert.equal(issues.join('\n').includes('secret-value'), false);
});

test('development config rejects admin runtime URLs, missing CA, reused secrets and shared buckets together', () => {
  const issues = inspectDevelopmentConfig(
    {
      SUPABASE_PRODUCTION_DATABASE_URL:
        'postgresql://postgres:URL_ENCODED_PASSWORD@127.0.0.1:5432/postgres?sslrootcert=/missing',
      OTP_HASH_KEY: 'x'.repeat(32),
      SESSION_TOKEN_HASH_KEY: 'x'.repeat(32),
      OBJECT_STORAGE_DRIVER: 'supabase',
      OBJECT_STORAGE_CATALOGUE_BUCKET: 'same',
      OBJECT_STORAGE_EVIDENCE_BUCKET: 'same',
    },
    () => false,
  );
  for (const text of [
    'sslmode=verify-full',
    'not readable',
    'least-privilege',
    'must differ from OTP',
    'must differ from the catalogue',
  ])
    assert.ok(
      issues.some((issue) => issue.includes(text)),
      text,
    );
  assert.equal(issues.join('\n').includes('postgresql://'), false);
});

test('the supabase-dev profile requires its own project keys and not the production ones', () => {
  const issues = inspectDevelopmentConfig(
    {
      APP_ENV: 'supabase-dev',
      SUPABASE_PRODUCTION_DATABASE_URL: 'postgresql://postgres:synthetic@h:5432/d',
    },
    () => true,
    profiles['supabase-dev'],
  );
  assert.ok(issues.some((issue) => issue.startsWith('SUPABASE_DATABASE_URL: missing')));
  assert.equal(
    issues.some((issue) => issue.startsWith('SUPABASE_PRODUCTION_')),
    false,
  );
  assert.equal(
    issues.some((issue) => issue.startsWith('APP_ENV:')),
    false,
  );
});
