import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

export function verifyCompose(text) {
  const errors = [];
  if (!text.includes('127.0.0.1:3001:3001')) errors.push('API must bind only to loopback');
  if (/^\s*-\s*["']?0\.0\.0\.0:/m.test(text)) errors.push('public host port is forbidden');
  for (const variable of ['API_IMAGE', 'WORKER_IMAGE', 'RELEASE_VERSION']) {
    if (!text.includes(`\${${variable}:?`)) errors.push(`${variable} must fail closed`);
  }
  for (const control of ['read_only: true', 'cap_drop:', 'no-new-privileges:true']) {
    if (!text.includes(control)) errors.push(`missing container control: ${control}`);
  }
  if (!text.includes('internal: true')) errors.push('service network must be internal');
  if (/\b(?:latest|main|master)\b/.test(text)) errors.push('mutable image reference is forbidden');
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
  errors.push(...verifyCompose(compose), ...verifyContainerfile(containerfile));

  const targets = JSON.parse(read('infrastructure/online-test/provider-targets.json'));
  if (targets.environment !== 'online-test' || targets.dataClassification !== 'synthetic-only') {
    errors.push('provider targets must be synthetic-only online-test');
  }
  if (targets.status !== 'selected-not-provisioned') {
    errors.push('provider status must remain honest until resources are provisioned');
  }

  for (const application of ['customer', 'vendor', 'partner', 'admin']) {
    const nextConfig = read(`apps/${application}-pwa/next.config.mjs`);
    if (
      !nextConfig.includes("deploymentTarget === 'cloudflare-pages'") ||
      !nextConfig.includes("output: 'export'")
    ) {
      errors.push(`${application} PWA is missing the controlled static export`);
    }
  }

  for (const service of ['api', 'worker']) {
    const config = read(`apps/${service}/src/runtime-config.ts`);
    if (!config.includes("'online-test'") || !config.includes("dataMode: 'synthetic'")) {
      errors.push(`${service} does not enforce synthetic online-test runtime configuration`);
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
