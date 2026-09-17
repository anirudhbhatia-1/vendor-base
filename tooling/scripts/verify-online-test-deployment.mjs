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
    'CUSTOMER_PWA_IMAGE',
    'RELEASE_VERSION',
    // Without these the runtime would fall back to the synthetic material committed to this
    // repository, so a deployed API would verify sessions and payment webhooks against
    // publicly readable keys.
    'ALLOW_SYNTHETIC_PROVIDERS',
    'OBJECT_STORAGE_GRANT_KEY',
    'OTP_HASH_KEY',
    'PAYMENT_WEBHOOK_KEY',
    'PROVIDER_CLEARING_ACCOUNT_REFERENCE',
    'SESSION_TOKEN_HASH_KEY',
    // The selected Supabase project, its runtime login and its Auth keys.
    'SUPABASE_PRODUCTION_PROJECT_REF',
    'SUPABASE_PRODUCTION_DATABASE_URL',
    'SUPABASE_PRODUCTION_RUNTIME_PASSWORD',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    // The deployed browser origins: the API's CORS list and the customer BFF's own origin
    // are exact, so a deployment must name them rather than inherit a loopback default.
    'CORS_ALLOWED_ORIGINS',
    'CADDY_API_HOST',
    'CADDY_SHOP_HOST',
  ]) {
    if (!text.includes(`\${${variable}:?`)) errors.push(`${variable} must fail closed`);
  }
  // The runtime profile is fixed: the one the marketplace is developed against, in
  // synthetic mode. A compose file that changed either would be a different environment.
  if (!text.includes('APP_ENV: supabase-production'))
    errors.push('runtime profile must be supabase-production');
  if (!text.includes('DATA_MODE: synthetic')) errors.push('data mode must be synthetic');
  // Every literal image reference is digest-pinned; the app images arrive digest-pinned
  // through release.env.
  for (const match of text.matchAll(/^\s*image:\s*(\S+)/gm)) {
    const reference = match[1];
    if (reference.startsWith('${')) continue;
    if (!/@sha256:[a-f0-9]{64}$/.test(reference))
      errors.push(`image is not digest-pinned: ${reference}`);
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
  const containerfile =
    read('infrastructure/online-test/Containerfile') +
    read('infrastructure/online-test/Containerfile.customer-pwa');
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
  // D-16: compute is the Azure for Students VM. The inventory says whether it is live
  // (`activeEnvironment`) so the record cannot claim a deployment that has not passed
  // its health check.
  if (targets.status !== 'provisioning-azure-test' && targets.status !== 'active-azure-test') {
    errors.push('provider targets must record the D-16 Azure test environment state');
  }
  if (!['local', 'azure-test'].includes(targets.activeEnvironment)) {
    errors.push('active environment must be local or azure-test');
  }
  if (targets.status === 'active-azure-test' && targets.activeEnvironment !== 'azure-test') {
    errors.push('an active Azure test environment must be the active environment');
  }
  if (targets.runtimeProfile !== 'supabase-production') {
    errors.push('the runtime profile in the inventory must match compose.yaml');
  }
  if (!/Azure/.test(targets.providers?.compute ?? '')) {
    errors.push('compute target must be the Azure VM per D-16');
  }
  if (targets.providers?.objectStorage !== 'Supabase Storage') {
    errors.push('object storage target must be Supabase Storage per D-15');
  }
  if (
    !/Azure Storage static websites/.test(targets.providers?.pwaAndCdn ?? '') ||
    !/Container App/.test(targets.providers?.pwaAndCdn ?? '')
  ) {
    errors.push(
      'the client target must name Azure Storage static websites for the static shells and a container app for the customer PWA',
    );
  }
  // The Container Apps definitions exist for every app the inventory names.
  for (const app of ['valkey', 'worker', 'api', 'shop']) {
    if (!fs.existsSync(path.join(repositoryRoot, `infrastructure/online-test/aca/${app}.json`))) {
      errors.push(`missing Container Apps definition for ${app}`);
    }
  }
  if (
    !['not-provisioned', 'provisioned'].includes(targets.externalResourceState?.pwaAndCdn) ||
    targets.externalResourceState?.database !== 'provisioned-synthetic-development-project' ||
    targets.externalResourceState?.objectStorage !== 'not-activated' ||
    !['provisioning', 'provisioned'].includes(targets.externalResourceState?.compute)
  ) {
    errors.push('external resource inventory is incomplete or inaccurate');
  }
  if (!fs.existsSync(path.join(repositoryRoot, 'docs/decisions/D-16.md'))) {
    errors.push('the Azure compute decision D-16 must be recorded');
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
  if (!/Azure/.test(targets.providers.compute)) {
    throw new Error('the compute target is not the one D-16 records');
  }
  const unpinned = compose.replace(
    /(image: docker\.io\/valkey\/valkey:[^@\n]+)@sha256:[a-f0-9]{64}/,
    '$1',
  );
  if (!verifyCompose(unpinned).some((error) => error.includes('not digest-pinned'))) {
    throw new Error('an unpinned literal image was accepted');
  }
  const wrongProfile = compose.replace('APP_ENV: supabase-production', 'APP_ENV: local');
  if (!verifyCompose(wrongProfile).some((error) => error.includes('runtime profile'))) {
    throw new Error('a changed runtime profile was accepted');
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
