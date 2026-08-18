import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import { inTransaction, withMigrationLock } from './client.js';
import { writeEvent } from './output.js';

interface FixtureRecord {
  readonly displayName: string;
  readonly fixtureKey: string;
  readonly fixtureKind: 'catalogue' | 'store' | 'zone';
  readonly ordinal: number;
  readonly payload: Readonly<Record<string, boolean | number | string>>;
}

const fixtures: readonly FixtureRecord[] = [
  {
    fixtureKey: 'zone:synth-jpr-302019',
    fixtureKind: 'zone',
    ordinal: 10,
    displayName: 'SYNTH Jaipur Zone 302019',
    payload: { city: 'Jaipur', pin_code: '302019', synthetic: true },
  },
  {
    fixtureKey: 'zone:synth-jpr-302020',
    fixtureKind: 'zone',
    ordinal: 20,
    displayName: 'SYNTH Jaipur Zone 302020',
    payload: { city: 'Jaipur', pin_code: '302020', synthetic: true },
  },
  {
    fixtureKey: 'zone:synth-jpr-302021',
    fixtureKind: 'zone',
    ordinal: 30,
    displayName: 'SYNTH Jaipur Zone 302021',
    payload: { city: 'Jaipur', pin_code: '302021', synthetic: true },
  },
  {
    fixtureKey: 'store:synth-fruit-01',
    fixtureKind: 'store',
    ordinal: 40,
    displayName: 'SYNTH Jaipur Fruit Lane 01',
    payload: { category: 'fruit_and_vegetables', synthetic: true, zone: '302020' },
  },
  {
    fixtureKey: 'store:synth-sabzi-02',
    fixtureKind: 'store',
    ordinal: 50,
    displayName: 'SYNTH Jaipur Sabzi Lane 02',
    payload: { category: 'fruit_and_vegetables', synthetic: true, zone: '302021' },
  },
  {
    fixtureKey: 'store:synth-kirana-01',
    fixtureKind: 'store',
    ordinal: 60,
    displayName: 'SYNTH Jaipur Kirana Lane 01',
    payload: { category: 'kirana', synthetic: true, zone: '302019' },
  },
  {
    fixtureKey: 'catalogue:synth-produce-v1',
    fixtureKind: 'catalogue',
    ordinal: 70,
    displayName: 'SYNTH Produce Catalogue v1',
    payload: { item_count: 20, synthetic: true, version: 'step-2.4-v1' },
  },
] as const;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function fixtureHash(records: readonly FixtureRecord[]): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(records)))
    .digest('hex');
}

export const expectedFixtureHash = fixtureHash(fixtures);

async function assertBaseline(client: Client): Promise<void> {
  const result = await client.query<{
    marketplace_schema: string | null;
    postgis_version: string | null;
  }>(
    `SELECT
       to_regnamespace('marketplace')::text AS marketplace_schema,
       (SELECT extversion FROM pg_extension WHERE extname = 'postgis') AS postgis_version`,
  );
  const state = result.rows[0];
  if (!state?.marketplace_schema || !state.postgis_version) {
    throw new Error('Apply the baseline migration before loading fixtures');
  }
}

export async function resetFixtures(client: Client): Promise<void> {
  await withMigrationLock(client, async () => {
    await inTransaction(client, async () => {
      await client.query('DROP SCHEMA IF EXISTS marketplace_test CASCADE');
    });
  });
  writeEvent('database.fixtures.reset');
}

export async function seedFixtures(client: Client): Promise<string> {
  return withMigrationLock(client, async () => {
    await assertBaseline(client);
    await inTransaction(client, async () => {
      await client.query('CREATE SCHEMA IF NOT EXISTS marketplace_test');
      await client.query(`
        CREATE TABLE IF NOT EXISTS marketplace_test.fixture_records (
          fixture_key text PRIMARY KEY,
          fixture_kind text NOT NULL CHECK (fixture_kind IN ('catalogue', 'store', 'zone')),
          ordinal integer NOT NULL UNIQUE,
          display_name text NOT NULL CHECK (display_name LIKE 'SYNTH%'),
          synthetic_marker boolean NOT NULL DEFAULT true CHECK (synthetic_marker IS TRUE),
          payload jsonb NOT NULL CHECK (payload @> '{"synthetic": true}'::jsonb)
        )
      `);
      await client.query('DELETE FROM marketplace_test.fixture_records');
      for (const fixture of fixtures) {
        await client.query(
          `INSERT INTO marketplace_test.fixture_records
             (fixture_key, fixture_kind, ordinal, display_name, synthetic_marker, payload)
           VALUES ($1, $2, $3, $4, true, $5::jsonb)`,
          [
            fixture.fixtureKey,
            fixture.fixtureKind,
            fixture.ordinal,
            fixture.displayName,
            JSON.stringify(fixture.payload),
          ],
        );
      }
    });

    const hash = await readFixtureHash(client);
    if (hash !== expectedFixtureHash) throw new Error('Persisted fixtures are not deterministic');
    writeEvent('database.fixtures.seeded', { count: fixtures.length, hash });
    return hash;
  });
}

export async function readFixtureHash(client: Client): Promise<string> {
  const result = await client.query<{
    display_name: string;
    fixture_key: string;
    fixture_kind: FixtureRecord['fixtureKind'];
    ordinal: number;
    payload: FixtureRecord['payload'];
  }>(
    `SELECT fixture_key, fixture_kind, ordinal, display_name, payload
       FROM marketplace_test.fixture_records
      ORDER BY ordinal`,
  );
  const records = result.rows.map((row) => ({
    fixtureKey: row.fixture_key,
    fixtureKind: row.fixture_kind,
    ordinal: row.ordinal,
    displayName: row.display_name,
    payload: row.payload,
  }));
  return fixtureHash(records);
}
