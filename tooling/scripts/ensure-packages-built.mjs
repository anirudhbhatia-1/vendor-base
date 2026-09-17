import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

/**
 * Rebuilds any workspace package whose `dist/` output is older than its `src/`.
 *
 * Every shared package resolves types from `src/` but runtime from `dist/`
 * (`apps/api` and `apps/worker` run `node dist/main.js` under plain Node, so
 * emitted JavaScript is required). TypeScript therefore checks source that Node
 * never loads, and a stale `dist/` fails only at runtime with a missing-export
 * error. This closes that gap before any development or start command runs.
 *
 * Usage: node tooling/scripts/ensure-packages-built.mjs [--self-test]
 */

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const packageDirectories = [
  'packages/domain-types',
  'packages/contracts',
  'packages/pwa-auth',
  'packages/i18n',
  'packages/ui',
  'database',
];

function newestModification(directory, extensions) {
  let newest = 0;
  if (!fs.existsSync(directory)) return newest;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestModification(file, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      newest = Math.max(newest, fs.statSync(file).mtimeMs);
    }
  }
  return newest;
}

export function isStale(sourceMtime, outputMtime) {
  return outputMtime === 0 || sourceMtime > outputMtime;
}

function runSelfTest() {
  if (!isStale(10, 0)) throw new Error('a missing build output was not reported as stale');
  if (!isStale(20, 10)) throw new Error('a newer source file was not reported as stale');
  if (isStale(10, 20)) throw new Error('a fresh build output was reported as stale');
  console.log('Package build freshness self-test passed.');
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }
  for (const directory of packageDirectories) {
    const absolute = path.join(repositoryRoot, directory);
    const sourceMtime = newestModification(path.join(absolute, 'src'), ['.ts', '.tsx']);
    const outputMtime = newestModification(path.join(absolute, 'dist'), ['.js']);
    if (!isStale(sourceMtime, outputMtime)) continue;
    const name = JSON.parse(fs.readFileSync(path.join(absolute, 'package.json'), 'utf8')).name;
    console.warn(`Rebuilding ${name}: dist is older than src.`);
    const result = spawnSync('pnpm', ['--filter', name, 'run', 'build'], {
      cwd: repositoryRoot,
      stdio: 'inherit',
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

main();
