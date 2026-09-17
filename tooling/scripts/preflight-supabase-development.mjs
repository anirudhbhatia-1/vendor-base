import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Required of either profile: the PWA bundle values and the private material. */
const sharedRequired = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'OTP_HASH_KEY',
  'SESSION_TOKEN_HASH_KEY',
  'OBJECT_STORAGE_GRANT_KEY',
  'PAYMENT_WEBHOOK_KEY',
  'PROVIDER_CLEARING_ACCOUNT_REFERENCE',
];

/**
 * The two Supabase-backed development profiles.
 *
 * Both run the same local processes with the same synthetic providers. They differ
 * in one thing only, and it is the thing worth being loud about: which database the
 * processes read and write. `supabase-dev` reaches a separate development project;
 * `supabase-production` reaches the production project, which is a deliberate mode
 * and not a production deployment -- but it is also not a mode anyone should enter
 * without having been told, so the banner names the database either way.
 */
export const profiles = {
  'supabase-dev': {
    appEnv: 'supabase-dev',
    database: 'a separate Supabase development project',
    databaseUrlKey: 'SUPABASE_DATABASE_URL',
    envFile: 'infrastructure/supabase-dev/.env',
    example: 'infrastructure/supabase-dev/env.example',
    leastPrivilegeLogin: undefined,
    required: ['SUPABASE_PROJECT_REF', 'SUPABASE_DATABASE_URL', ...sharedRequired],
    sslRootCertKey: undefined,
    verifyFullTls: false,
  },
  'supabase-production': {
    appEnv: 'supabase-production',
    database: 'the PRODUCTION Supabase project',
    databaseUrlKey: 'SUPABASE_PRODUCTION_DATABASE_URL',
    envFile: 'infrastructure/supabase-production/.env',
    example: 'infrastructure/supabase-production/env.example',
    leastPrivilegeLogin: 'marketplace_app',
    required: [
      'SUPABASE_PRODUCTION_PROJECT_REF',
      'SUPABASE_PRODUCTION_DATABASE_URL',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      ...sharedRequired,
    ],
    sslRootCertKey: 'SUPABASE_PRODUCTION_SSL_ROOT_CERT',
    verifyFullTls: true,
  },
};

const secretKeys = [
  'OTP_HASH_KEY',
  'SESSION_TOKEN_HASH_KEY',
  'OBJECT_STORAGE_GRANT_KEY',
  'PAYMENT_WEBHOOK_KEY',
];

/** Pure, redacted checks: never echo supplied values, even on invalid input. */
export function inspectDevelopmentConfig(
  env,
  canRead = () => true,
  profile = profiles['supabase-production'],
) {
  const issues = [];
  for (const key of profile.required) {
    if (!env[key]?.trim()) issues.push(`${key}: missing`);
    else if (/^(replace[-_]|<|changeme|example)/i.test(env[key]))
      issues.push(`${key}: replace the example placeholder`);
  }
  if (env.APP_ENV !== profile.appEnv)
    issues.push(`APP_ENV: expected the ${profile.appEnv} database profile`);
  if (env.DATA_MODE !== 'synthetic')
    issues.push('DATA_MODE: this development command requires synthetic');
  if (env.ALLOW_SYNTHETIC_PROVIDERS !== 'synthetic-testing-only')
    issues.push(
      'ALLOW_SYNTHETIC_PROVIDERS: explicit synthetic-testing-only acknowledgement required',
    );
  if ((env.API_HOST ?? '127.0.0.1') !== '127.0.0.1')
    issues.push('API_HOST: this development command requires 127.0.0.1');
  if ((env.API_PORT ?? '3001') !== '3001')
    issues.push('API_PORT: expected 3001 for the four PWA development stack');
  if ((env.OTP_ADAPTER ?? 'fake') !== 'fake')
    issues.push('OTP_ADAPTER: this command does not activate external SMS adapters');
  if ((env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001') !== 'http://127.0.0.1:3001')
    issues.push('NEXT_PUBLIC_API_URL: expected http://127.0.0.1:3001');
  if (env.CUSTOMER_PWA_ORIGIN && env.CUSTOMER_PWA_ORIGIN !== 'http://localhost:3100')
    issues.push('CUSTOMER_PWA_ORIGIN: unset it or use http://localhost:3100 for local development');
  for (const key of secretKeys) {
    if (env[key] && (env[key].length < 32 || env[key].startsWith('local-synthetic')))
      issues.push(`${key}: use independently generated private material of at least 32 characters`);
  }
  if (env.OTP_HASH_KEY && env.OTP_HASH_KEY === env.SESSION_TOKEN_HASH_KEY)
    issues.push('SESSION_TOKEN_HASH_KEY: must differ from OTP_HASH_KEY');
  if (env.OBJECT_STORAGE_DRIVER === 'supabase') {
    for (const key of ['OBJECT_STORAGE_CATALOGUE_BUCKET', 'OBJECT_STORAGE_EVIDENCE_BUCKET'])
      if (!env[key]) issues.push(`${key}: required for Supabase storage`);
    if (
      env.OBJECT_STORAGE_CATALOGUE_BUCKET &&
      env.OBJECT_STORAGE_CATALOGUE_BUCKET === env.OBJECT_STORAGE_EVIDENCE_BUCKET
    )
      issues.push('OBJECT_STORAGE_EVIDENCE_BUCKET: must differ from the catalogue bucket');
  }
  const databaseUrl = env[profile.databaseUrlKey];
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      if (profile.verifyFullTls && url.searchParams.get('sslmode') !== 'verify-full')
        issues.push(`${profile.databaseUrlKey}: sslmode=verify-full required`);
      const cert =
        (profile.sslRootCertKey ? env[profile.sslRootCertKey] : undefined) ??
        url.searchParams.get('sslrootcert');
      if (cert && !canRead(cert))
        issues.push(
          `${profile.sslRootCertKey ?? 'sslrootcert'}: configured certificate is not readable`,
        );
      if (profile.leastPrivilegeLogin && !url.username.startsWith(profile.leastPrivilegeLogin))
        issues.push(
          `${profile.databaseUrlKey}: runtime must use the least-privilege ${profile.leastPrivilegeLogin} login`,
        );
    } catch {
      issues.push(`${profile.databaseUrlKey}: invalid URL (value redacted)`);
    }
  }
  return issues;
}

export async function main(profileName = 'supabase-production', envFileOverride) {
  const profile = profiles[profileName];
  if (!profile) {
    console.error(`Unknown preflight profile ${profileName}.`);
    return 1;
  }
  const envFile = envFileOverride ?? path.join(repoRoot, profile.envFile);
  let values;
  try {
    values = parseEnv(fs.readFileSync(envFile, 'utf8'));
  } catch {
    console.error(`Development env file is missing or unreadable. See ${profile.example}.`);
    return 1;
  }
  // Matches node --env-file: explicit shell variables take precedence.
  const env = { ...values, ...process.env };
  const issues = inspectDevelopmentConfig(
    env,
    (file) => {
      try {
        fs.accessSync(file, fs.constants.R_OK);
        return true;
      } catch {
        return false;
      }
    },
    profile,
  );
  console.log(
    `Supabase development preflight — local processes, synthetic providers, reading and writing ${profile.database}. NOT a production launch.`,
  );
  console.log(
    'Configuration values and credentials are redacted. No database/provider requests are made.',
  );
  if (issues.length === 0) {
    for (const [key, value] of Object.entries(values))
      if (process.env[key] === undefined) process.env[key] = value;
    for (const [label, modulePath] of [
      ['API', '../../apps/api/src/runtime-config.ts'],
      ['worker', '../../apps/worker/src/runtime-config.ts'],
    ]) {
      try {
        (await import(new URL(modulePath, import.meta.url).href)).loadRuntimeConfig();
      } catch {
        issues.push(
          `${label}: runtime config rejected; check profile, TLS/runtime identity, provider keys and bucket settings. Raw exception redacted.`,
        );
      }
    }
  }
  for (const issue of issues) console.error(`- ${issue}`);
  console.log(
    'Browser: http://localhost:3100 (customer), ports 3101/3102/3103 (vendor/partner/admin).',
  );
  console.log(
    'Open localhost, not 127.0.0.1: the customer PWA refuses mutations whose Origin is not the canonical http://localhost:3100.',
  );
  console.log(
    'NOT CHECKED: database reachability, migrations, actual grants, broker/consumer health, storage access and provider delivery.',
  );
  console.log(
    'Startup checks occupied ports separately. Stop your existing stack with Ctrl+C; never kill unrelated processes. Restart after .env changes.',
  );
  return issues.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  process.exitCode = await main(process.argv[2], process.argv[3]);
