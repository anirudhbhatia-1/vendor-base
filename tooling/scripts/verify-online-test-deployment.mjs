import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

export function verifyCompose(text) {
  const errors = [];
  if (!text.includes('127.0.0.1:3001:3001')) errors.push('API must bind only to loopback');
  if (/^\s*-\s*["']?0\.0\.0\.0:/m.test(text)) errors.push('public host port is forbidden');
  for (const variable of [
    'API_IMAGE',
    'WORKER_IMAGE',
    'RELEASE_VERSION',
    // Without these the runtime would fall back to the synthetic material committed to this
    // repository, so a deployed online-test API would verify sessions and payment webhooks
    // against publicly readable keys.
    'ALLOW_SYNTHETIC_PROVIDERS',
    'OBJECT_STORAGE_GRANT_KEY',
    'ONLINE_TEST_DATABASE_URL',
    'OTP_HASH_KEY',
    'PAYMENT_WEBHOOK_KEY',
    'PROVIDER_CLEARING_ACCOUNT_REFERENCE',
    'SESSION_TOKEN_HASH_KEY',
  ]) {
    if (!text.includes(`\${${variable}:?`)) errors.push(`${variable} must fail closed`);
  }
  for (const control of ['read_only: true', 'cap_drop:', 'no-new-privileges:true']) {
    if (!text.includes(control)) errors.push(`missing container control: ${control}`);
  }
  if (!text.includes('internal: true')) errors.push('service network must be internal');
  if (/\b(?:latest|main|master)\b/.test(text)) errors.push('mutable image reference is forbidden');
  return errors;
}

/**
 * Ignore patterns match the whole path, so a bare `.env` excludes only the repository
 * root one. Verified by building a probe context: with a bare pattern, `nested/.env`
 * reached the build context and would have carried the live Supabase service-role key
 * into the builder layer of every image build.
 */
export function verifyContainerIgnore(text) {
  const patterns = new Set(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  );
  const errors = [];
  for (const required of ['**/.env', '**/.env.*', '**/*.key', '**/*.pem']) {
    if (!patterns.has(required)) {
      errors.push(`container build context must exclude ${required} at every depth`);
    }
  }
  return errors;
}

export function verifyContainerfile(text) {
  const errors = [];
  if (!text.includes('ARG NODE_IMAGE') || !text.includes('FROM ${NODE_IMAGE}')) {
    errors.push('base image must be supplied as a pinned build argument');
  }
  if (!text.includes('USER node')) errors.push('runtime must be non-root');
  if (!text.includes('pnpm install --frozen-lockfile'))
    errors.push('install must be lockfile-pinned');
  return errors;
}

function verifyRepository() {
  const errors = [];
  const compose = read('infrastructure/online-test/compose.yaml');
  const containerfile = read('infrastructure/online-test/Containerfile');
  const containerIgnore = read('.containerignore');
  errors.push(
    ...verifyCompose(compose),
    ...verifyContainerfile(containerfile),
    ...verifyContainerIgnore(containerIgnore),
  );

  const targets = JSON.parse(read('infrastructure/online-test/provider-targets.json'));
  if (targets.environment !== 'online-test' || targets.dataClassification !== 'synthetic-only') {
    errors.push('provider targets must be synthetic-only online-test');
  }
  if (targets.status !== 'paused-local-primary' || targets.activeEnvironment !== 'local') {
    errors.push('provider targets must remain paused while local is the active environment');
  }
  // D-15 replaced two named targets. Both had survived in this inventory: object
  // storage as Cloudflare R2, and all four PWAs as Cloudflare Pages static exports.
  if (targets.providers?.objectStorage !== 'Supabase Storage') {
    errors.push('object storage target must be Supabase Storage per D-15');
  }
  if (!/Workers\/OpenNext/.test(targets.providers?.pwaAndCdn ?? '')) {
    errors.push('the customer PWA target must name Workers/OpenNext, not a static export');
  }
  if (
    targets.externalResourceState?.pwaAndCdn !==
      'provisioned-synthetic-snapshots-non-authoritative' ||
    targets.externalResourceState?.database !== 'provisioned-empty-baseline-non-authoritative' ||
    targets.externalResourceState?.objectStorage !== 'not-activated' ||
    targets.externalResourceState?.compute !== 'not-provisioned'
  ) {
    errors.push('paused external resource inventory is incomplete or inaccurate');
  }

  // D-15 splits the client targets. The vendor, partner and admin PWAs remain controlled
  // static exports. The customer PWA moved to Workers/OpenNext with a same-origin BFF that
  // holds the HttpOnly session cookie, which a static export cannot serve.
  for (const application of ['vendor', 'partner', 'admin']) {
    const nextConfig = read(`apps/${application}-pwa/next.config.mjs`);
    if (
      !nextConfig.includes("deploymentTarget === 'cloudflare-pages'") ||
      !nextConfig.includes("output: 'export'")
    ) {
      errors.push(`${application} PWA is missing the controlled static export`);
    }
  }
  const customerConfig = read('apps/customer-pwa/next.config.mjs');
  if (customerConfig.includes("output: 'export'")) {
    errors.push('customer PWA must not be a static export; its BFF routes need a server runtime');
  }
  for (const route of [
    'apps/customer-pwa/app/api/session/route.ts',
    'apps/customer-pwa/app/api/backend/[...path]/route.ts',
  ]) {
    if (!fs.existsSync(path.join(repositoryRoot, route))) {
      errors.push(`customer PWA is missing the same-origin BFF route ${route}`);
    }
  }

  // The online-test/synthetic invariant is owned by the shared loader in the
  // database package; the API and worker are thin wrappers that must delegate
  // to it rather than re-deriving the runtime mode themselves.
  const shared = read('database/src/runtime-config.ts');
  if (!shared.includes("'online-test'") || !shared.includes("dataMode: 'synthetic'")) {
    errors.push('shared runtime configuration does not enforce the synthetic online-test mode');
  }
  for (const service of ['api', 'worker']) {
    const config = read(`apps/${service}/src/runtime-config.ts`);
    if (!config.includes('loadSharedRuntimeConfig')) {
      errors.push(`${service} does not delegate to the shared runtime configuration loader`);
    }
  }
  return errors;
}

function runSelfTest() {
  const compose = read('infrastructure/online-test/compose.yaml');
  if (verifyCompose(compose).length !== 0) throw new Error('valid compose fixture was rejected');
  const unsafePort = compose.replace('127.0.0.1:3001:3001', '0.0.0.0:3001:3001');
  if (!verifyCompose(unsafePort).some((error) => error.includes('public host port'))) {
    throw new Error('public port mutation was not rejected');
  }
  if (verifyContainerIgnore(read('.containerignore')).length !== 0) {
    throw new Error('the real container ignore file was rejected');
  }
  if (!verifyContainerIgnore('.env\n*.key\n').some((e) => e.includes('**/.env'))) {
    throw new Error('a root-only ignore pattern was accepted');
  }

  const targetsPath = path.join(repositoryRoot, 'infrastructure/online-test/provider-targets.json');
  const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
  if (targets.providers.objectStorage !== 'Supabase Storage') {
    throw new Error('the object-storage target is not the one D-15 approves');
  }
  if (!/Workers\/OpenNext/.test(targets.providers.pwaAndCdn)) {
    throw new Error('the client target does not name the customer PWA runtime');
  }

  const leakedSecret = compose.replaceAll(
    '${SESSION_TOKEN_HASH_KEY:?SESSION_TOKEN_HASH_KEY is required}',
    'local-synthetic-session-token-hash-material',
  );
  if (!verifyCompose(leakedSecret).some((error) => error.includes('SESSION_TOKEN_HASH_KEY'))) {
    throw new Error('committed session material was not rejected');
  }
  const mutable = compose.replace(
    '${API_IMAGE:?API_IMAGE must be an immutable digest-pinned image}',
    'example/api:latest',
  );
  if (!verifyCompose(mutable).some((error) => error.includes('mutable image'))) {
    throw new Error('mutable image mutation was not rejected');
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
  console.warn('Online-test deployment control self-test passed.');
} else {
  const errors = verifyRepository();
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.warn('Online-test deployment static verification passed.');
  }
}
