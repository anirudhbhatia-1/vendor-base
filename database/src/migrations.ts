import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Client } from 'pg';
import { inTransaction, withMigrationLock } from './client.js';
import { writeEvent } from './output.js';

interface Migration {
  readonly checksum: string;
  readonly downSql: string;
  readonly name: string;
  readonly upSql: string;
}

interface AppliedMigration {
  readonly checksum: string;
  readonly name: string;
}

const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));
const migrationPattern = /^(\d{4}_[a-z0-9_]+)\.(up|down)\.sql$/;

async function loadMigrations(): Promise<readonly Migration[]> {
  const filenames = await readdir(migrationsDirectory);
  const pairs = new Map<string, { down?: string; up?: string }>();

  for (const filename of filenames) {
    const match = migrationPattern.exec(filename);
    if (!match) continue;
    const [, name, direction] = match;
    if (!name || !direction) continue;
    const pair = pairs.get(name) ?? {};
    pair[direction as 'down' | 'up'] = filename;
    pairs.set(name, pair);
  }

  const migrations: Migration[] = [];
  for (const [name, pair] of [...pairs.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!pair.up || !pair.down) throw new Error(`Migration ${name} must have up and down files`);
    const [upSql, downSql] = await Promise.all([
      readFile(new URL(`../migrations/${pair.up}`, import.meta.url), 'utf8'),
      readFile(new URL(`../migrations/${pair.down}`, import.meta.url), 'utf8'),
    ]);
    const checksum = createHash('sha256').update(upSql).update('\0').update(downSql).digest('hex');
    migrations.push({ checksum, downSql, name, upSql });
  }

  if (migrations.length === 0) throw new Error('No reviewed migrations were found');
  return migrations;
}

async function ensureLedger(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.marketplace_schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);
}

async function appliedMigrations(client: Client): Promise<readonly AppliedMigration[]> {
  const result = await client.query<AppliedMigration>(
    'SELECT name, checksum FROM public.marketplace_schema_migrations ORDER BY name',
  );
  return result.rows;
}

function validateChecksums(
  migrations: readonly Migration[],
  applied: readonly AppliedMigration[],
): void {
  const byName = new Map(migrations.map((migration) => [migration.name, migration]));
  for (const recorded of applied) {
    const migration = byName.get(recorded.name);
    if (!migration)
      throw new Error(`Applied migration ${recorded.name} is missing from the repository`);
    if (migration.checksum !== recorded.checksum) {
      throw new Error(`Applied migration ${recorded.name} was modified after execution`);
    }
  }
}

export async function migrateUp(client: Client): Promise<number> {
  return withMigrationLock(client, async () => {
    await ensureLedger(client);
    const migrations = await loadMigrations();
    const applied = await appliedMigrations(client);
    validateChecksums(migrations, applied);
    const appliedNames = new Set(applied.map((migration) => migration.name));
    let count = 0;

    for (const migration of migrations) {
      if (appliedNames.has(migration.name)) continue;
      await inTransaction(client, async () => {
        await client.query(migration.upSql);
        await client.query(
          'INSERT INTO public.marketplace_schema_migrations (name, checksum) VALUES ($1, $2)',
          [migration.name, migration.checksum],
        );
      });
      count += 1;
      writeEvent('database.migration.applied', { migration: migration.name });
    }
    return count;
  });
}

export async function migrateDown(client: Client, steps: number): Promise<number> {
  if (!Number.isInteger(steps) || steps < 1) throw new Error('Migration steps must be positive');
  return withMigrationLock(client, async () => {
    await ensureLedger(client);
    const migrations = await loadMigrations();
    const applied = await appliedMigrations(client);
    validateChecksums(migrations, applied);
    const byName = new Map(migrations.map((migration) => [migration.name, migration]));
    const selected = [...applied].reverse().slice(0, steps);

    for (const recorded of selected) {
      const migration = byName.get(recorded.name);
      if (!migration) throw new Error(`Migration ${recorded.name} cannot be rolled back`);
      await inTransaction(client, async () => {
        await client.query(migration.downSql);
        await client.query('DELETE FROM public.marketplace_schema_migrations WHERE name = $1', [
          migration.name,
        ]);
      });
      writeEvent('database.migration.reverted', { migration: migration.name });
    }
    return selected.length;
  });
}

export async function migrationStatus(
  client: Client,
): Promise<readonly { applied: boolean; name: string }[]> {
  await ensureLedger(client);
  const migrations = await loadMigrations();
  const applied = await appliedMigrations(client);
  validateChecksums(migrations, applied);
  const appliedNames = new Set(applied.map((migration) => migration.name));
  return migrations.map((migration) => ({
    applied: appliedNames.has(migration.name),
    name: migration.name,
  }));
}
