import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const applications = ['customer-pwa', 'vendor-pwa', 'partner-pwa', 'admin-pwa'];
const secretSentinel = 'SERVER_ONLY_ONLINE_TEST_SENTINEL_2_6';

for (const application of applications) {
  const result = spawnSync(
    'pnpm',
    ['--filter', `@neighbourhood-store/${application}`, 'run', 'build'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_ENV: 'online-test',
        DATA_MODE: 'synthetic',
        DEPLOYMENT_TARGET: 'cloudflare-pages',
        SERVER_ONLY_SENTINEL: secretSentinel,
      },
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);

  const outputDirectory = path.join(repositoryRoot, 'apps', application, 'out');
  if (!fs.existsSync(path.join(outputDirectory, 'index.html'))) {
    throw new Error(`${application} did not produce out/index.html`);
  }
  for (const file of walk(outputDirectory)) {
    if (fs.readFileSync(file).includes(secretSentinel)) {
      throw new Error(`${application} bundled a server-only environment value`);
    }
  }
}

console.warn('All four Cloudflare Pages static PWA artifacts passed verification.');

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(file);
    else if (entry.isFile()) yield file;
  }
}
