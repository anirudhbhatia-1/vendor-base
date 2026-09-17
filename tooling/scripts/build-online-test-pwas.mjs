import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * The three static shells for Azure Storage static-website hosting (D-16).
 *
 * The customer PWA is not built here: its cookie BFF needs a server, so it ships as
 * a container (`infrastructure/online-test/Containerfile.customer-pwa`). This script
 * used to "verify" a customer `out/index.html` that was only ever a stale artefact
 * from before D-15 moved that shell off the static export.
 *
 * Each export is written with directory indexes (`catalogue/index.html`) because a
 * static host answers `/catalogue/` from that file and nothing else. Only explicitly
 * public `NEXT_PUBLIC_*` values may enter these bundles; the sentinel check below
 * proves a server-only value did not.
 */
const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const applications = ['vendor-pwa', 'partner-pwa', 'admin-pwa'];
const secretSentinel = 'SERVER_ONLY_ONLINE_TEST_SENTINEL_2_6';

const apiUrl = process.env.NEXT_PUBLIC_API_URL;
if (!apiUrl) {
  console.warn(
    'NEXT_PUBLIC_API_URL is not set: the shells will target the loopback development API. ' +
      'Set it to the deployed API origin before uploading these exports.',
  );
}

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

console.warn('All three static shell exports passed verification.');

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(file);
    else if (entry.isFile()) yield file;
  }
}
