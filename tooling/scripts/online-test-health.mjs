import fs from 'node:fs';
import path from 'node:path';

const releaseVersion = required('RELEASE_VERSION');
if (!/^[a-f0-9]{40}$/.test(releaseVersion)) {
  throw new Error('RELEASE_VERSION must be a full lowercase Git commit SHA');
}

const apiUrl = safeHttpsUrl('ONLINE_TEST_API_URL', required('ONLINE_TEST_API_URL'));
// The profile the deployed API must report. The Azure test environment (D-16) runs the
// `supabase-production` profile in synthetic mode; the staging profile stays the default.
const expectedEnvironment = process.env.ONLINE_TEST_EXPECTED_ENVIRONMENT ?? 'online-test';
if (!['online-test', 'supabase-production'].includes(expectedEnvironment)) {
  throw new Error('ONLINE_TEST_EXPECTED_ENVIRONMENT must be online-test or supabase-production');
}
const pwaVariables = [
  'ONLINE_TEST_CUSTOMER_URL',
  'ONLINE_TEST_VENDOR_URL',
  'ONLINE_TEST_PARTNER_URL',
  'ONLINE_TEST_ADMIN_URL',
];

const evidence = {
  checkedAt: new Date().toISOString(),
  releaseVersion,
  environment: expectedEnvironment,
  checks: [],
};

for (const endpoint of ['/health/live', '/health/ready']) {
  const response = await fetch(new URL(endpoint, apiUrl), { redirect: 'error' });
  if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}`);
  const body = await response.json();
  if (
    body.environment !== expectedEnvironment ||
    body.data_mode !== 'synthetic' ||
    body.version !== releaseVersion
  ) {
    throw new Error(
      `${endpoint} identity did not match the expected ${expectedEnvironment} release`,
    );
  }
  if (endpoint.endsWith('/ready') && body.production_ready !== false) {
    throw new Error('Online-test API unexpectedly claims production readiness');
  }
  evidence.checks.push({ target: endpoint, status: 'passed' });
}

for (const variable of pwaVariables) {
  const url = safeHttpsUrl(variable, required(variable));
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error(`${variable} returned HTTP ${response.status}`);
  evidence.checks.push({ target: variable, status: 'passed' });
}

const outputDirectory = path.resolve('.online-test-evidence');
fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
const outputPath = path.join(outputDirectory, `${releaseVersion}.json`);
fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.warn(`Online-test health verification passed. Evidence: ${outputPath}`);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeHttpsUrl(name, value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be a credential-free HTTPS URL`);
  }
  return url;
}
