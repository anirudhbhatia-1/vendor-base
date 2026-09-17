import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Deploys the online company-test stack to Azure Container Apps (D-16).
 *
 * Renders `infrastructure/online-test/aca/*.json` from an uncommitted release.env
 * plus two files it names (the Supabase CA and the GHCR read token), then applies
 * each app with `az containerapp create|update --yaml`. Values are JSON-escaped
 * into the templates, every `${NAME}` must resolve, and the rendered files live
 * only in a 0600 temporary directory that is removed afterwards. Nothing is
 * printed but app names, hostnames and revision states.
 *
 *   node tooling/scripts/deploy-azure-test.mjs --env /path/to/release.env [--only api,shop]
 */
const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const templateDirectory = path.join(repositoryRoot, 'infrastructure/online-test/aca');
const applications = ['valkey', 'worker', 'api', 'shop'];

const args = process.argv.slice(2);
const envPath = valueOf('--env');
if (!envPath) fail('--env <release.env> is required');
const only = valueOf('--only')?.split(',').filter(Boolean) ?? applications;
for (const name of only) if (!applications.includes(name)) fail(`unknown app ${name}`);

const release = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
for (const [key, value] of Object.entries(release)) {
  if (/^(REPLACE|replace)/.test(value) || value === '') fail(`${key} still carries a placeholder`);
}
// Read only when a selected template asks for them, so a Valkey-only deploy needs
// neither the registry token nor the CA.
defineFileValue('SUPABASE_CA_PEM', 'SUPABASE_CA_FILE', (text) => text);
defineFileValue('GHCR_READ_TOKEN', 'GHCR_READ_TOKEN_FILE', (text) => text.trim());
release.ACA_LOCATION ??= 'centralindia';
release.LOG_LEVEL ??= 'info';
release.API_MIN_REPLICAS ??= '0';
release.SHOP_MIN_REPLICAS ??= '0';
for (const key of ['API_IMAGE', 'WORKER_IMAGE', 'CUSTOMER_PWA_IMAGE']) {
  if (!/@sha256:[a-f0-9]{64}$/.test(required(key))) fail(`${key} must be digest-pinned`);
}
if (!/^[a-f0-9]{40}$/.test(required('RELEASE_VERSION'))) fail('RELEASE_VERSION must be a Git SHA');

const resourceGroup = required('AZURE_RESOURCE_GROUP');
release.ACA_ENVIRONMENT_ID = az([
  'containerapp',
  'env',
  'show',
  '--name',
  required('AZURE_CONTAINERAPPS_ENV'),
  '--resource-group',
  resourceGroup,
  '--query',
  'id',
  '-o',
  'tsv',
]).trim();

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'neighbourhood-aca-'));
fs.chmodSync(temporary, 0o700);
try {
  for (const name of applications) {
    if (!only.includes(name)) continue;
    const template = fs.readFileSync(path.join(templateDirectory, `${name}.json`), 'utf8');
    const rendered = template.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, key) => {
      const value = release[key];
      if (value === undefined) fail(`${name}.json needs ${key}, which release.env does not define`);
      return JSON.stringify(String(value)).slice(1, -1);
    });
    const definition = JSON.parse(rendered);
    // Replica counts are substituted as strings so the templates stay valid JSON.
    const scale = definition.properties?.template?.scale;
    if (scale && typeof scale.minReplicas === 'string')
      scale.minReplicas = Number(scale.minReplicas);
    const file = path.join(temporary, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(definition), { mode: 0o600 });
    const exists =
      spawnSync(
        'az',
        ['containerapp', 'show', '--name', name, '--resource-group', resourceGroup, '-o', 'none'],
        {
          stdio: 'ignore',
        },
      ).status === 0;
    const verb = exists ? 'update' : 'create';
    console.warn(`${verb} ${name}…`);
    az([
      'containerapp',
      verb,
      '--name',
      name,
      '--resource-group',
      resourceGroup,
      '--yaml',
      file,
      '-o',
      'none',
    ]);
    const state = az([
      'containerapp',
      'show',
      '--name',
      name,
      '--resource-group',
      resourceGroup,
      '--query',
      '{fqdn:properties.configuration.ingress.fqdn, revision:properties.latestRevisionName, state:properties.provisioningState}',
      '-o',
      'json',
    ]);
    console.warn(`${name}: ${state.trim()}`);
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

function az(argv) {
  const result = spawnSync('az', [...argv, '--only-show-errors'], { encoding: 'utf8' });
  if (result.status !== 0) {
    // az error text can echo request bodies; keep it to the first line.
    fail(`az ${argv.slice(0, 3).join(' ')} failed: ${(result.stderr || '').split('\n')[0]}`);
  }
  return result.stdout;
}

function defineFileValue(key, pathKey, transform) {
  Object.defineProperty(release, key, {
    enumerable: false,
    get() {
      const file = required(pathKey);
      if (!fs.existsSync(file)) fail(`${pathKey} points at a file that does not exist`);
      return transform(fs.readFileSync(file, 'utf8'));
    },
  });
}

function required(key) {
  const value = release[key];
  if (!value) fail(`${key} is required in release.env`);
  return value;
}

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function parseEnvFile(text) {
  const values = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    let value = line.slice(separator + 1);
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    values[line.slice(0, separator)] = value;
  }
  return values;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
