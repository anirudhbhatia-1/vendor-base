import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import type { FullConfig } from '@playwright/test';

/**
 * Seeds the live journeys' fixtures immediately before they run.
 *
 * The vendor journey needs an order that is still awaiting acceptance, and an
 * order stops waiting a few minutes after it is placed. Fixtures made once and
 * reused would therefore be expired by the time anyone ran the suite, so the
 * seeding happens here, inside the same `pnpm test:e2e` invocation, and only
 * when asked: `LIVE_SUPABASE_ACCEPTANCE=true` alone runs the journeys against
 * credentials already in the environment, exactly as before.
 *
 * The provisioner is `database/scripts/live-supabase-fixtures.ts`. It creates
 * only `SYNTH` records through the API, and it needs the API, worker and
 * Supabase project the journeys themselves need. Its last stdout line is JSON
 * whose `environment` holds the `ACCEPTANCE_*` values the specs read; they are
 * copied onto this process, which Playwright forks its workers from.
 */
export default function globalSetup(config: FullConfig): void {
  if (process.env.LIVE_SUPABASE_ACCEPTANCE !== 'true') return;
  if (process.env.ACCEPTANCE_SEED_FIXTURES !== 'true') return;

  // The repository root: where playwright.config.ts lives. rootDir is the test
  // directory, one level below it.
  const repositoryRoot = config.configFile ? dirname(config.configFile) : dirname(config.rootDir);
  const databaseDirectory = join(repositoryRoot, 'database');
  const result = spawnSync('pnpm', ['exec', 'tsx', 'scripts/live-supabase-fixtures.ts'], {
    cwd: databaseDirectory,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Acceptance fixtures were not seeded (exit ${String(result.status)})`);
  }
  const lastLine = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1);
  if (!lastLine) throw new Error('The fixture provisioner printed no result');
  const parsed: unknown = JSON.parse(lastLine);
  if (!parsed || typeof parsed !== 'object' || !('environment' in parsed)) {
    throw new Error('The fixture provisioner did not print an environment block');
  }
  const environment = (parsed as { environment: unknown }).environment;
  if (!environment || typeof environment !== 'object') {
    throw new Error('The fixture environment block is not an object');
  }
  for (const [key, value] of Object.entries(environment as Record<string, unknown>)) {
    if (typeof value !== 'string' || !key.startsWith('ACCEPTANCE_')) {
      throw new Error(`Unexpected fixture environment entry ${key}`);
    }
    process.env[key] = value;
  }
  console.error(`acceptance fixtures seeded for ${process.env.ACCEPTANCE_VENDOR_LOCATION_ID}`);
}
