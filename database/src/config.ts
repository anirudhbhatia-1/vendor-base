export type DatabaseTarget = 'local' | 'test' | 'online-test';

export interface DatabaseConfig {
  readonly connectionString: string;
  readonly databaseName: string;
  readonly target: DatabaseTarget;
}

const defaults: Readonly<Record<'local' | 'test', string>> = {
  local:
    'postgresql://marketplace_local:marketplace_local_only@127.0.0.1:5432/neighbourhood_store_local',
  test: 'postgresql://marketplace_test:marketplace_test_only@127.0.0.1:5433/neighbourhood_store_test',
};

const expectedDatabaseNames: Readonly<Record<'local' | 'test', string>> = {
  local: 'neighbourhood_store_local',
  test: 'neighbourhood_store_test',
};

const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);

export function parseTarget(arguments_: readonly string[]): DatabaseTarget {
  const targetIndex = arguments_.indexOf('--target');
  const target = targetIndex === -1 ? 'local' : arguments_[targetIndex + 1];
  if (target !== 'local' && target !== 'test' && target !== 'online-test') {
    throw new Error('Database target must be local, test, or online-test');
  }
  return target;
}

export function loadDatabaseConfig(target: DatabaseTarget): DatabaseConfig {
  const configuredUrl =
    target === 'test'
      ? process.env.TEST_DATABASE_URL
      : target === 'online-test'
        ? process.env.ONLINE_TEST_DATABASE_URL
        : process.env.DATABASE_URL;
  if (target === 'online-test' && !configuredUrl) {
    throw new Error('ONLINE_TEST_DATABASE_URL is required for the online-test target');
  }
  const connectionString = configuredUrl ?? defaults[target as 'local' | 'test'];

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('Database URL is invalid');
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('Database URL must use the PostgreSQL protocol');
  }
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (target === 'online-test') {
    const projectRef = process.env.ONLINE_TEST_SUPABASE_PROJECT_REF;
    if (!projectRef || !/^[a-z0-9]{20}$/.test(projectRef)) {
      throw new Error('ONLINE_TEST_SUPABASE_PROJECT_REF must be a 20-character project reference');
    }
    const directHost = `db.${projectRef}.supabase.co`;
    const sessionPoolerHost = /^aws-[a-z0-9-]+\.pooler\.supabase\.com$/;
    if (parsed.hostname !== directHost && !sessionPoolerHost.test(parsed.hostname)) {
      throw new Error('online-test database host must be the selected Supabase project');
    }
    if (databaseName !== 'postgres') {
      throw new Error('online-test Supabase database name must be postgres');
    }
    if (parsed.searchParams.get('sslmode') !== 'require') {
      throw new Error('online-test database URL must require TLS');
    }
    const directUser = parsed.username === 'postgres';
    const poolerUser = parsed.username === `postgres.${projectRef}`;
    if (!directUser && !poolerUser) {
      throw new Error('online-test database user does not match the selected Supabase project');
    }
  } else {
    if (!loopbackHosts.has(parsed.hostname)) {
      throw new Error('Local and test database connections must use a loopback host');
    }
    if (databaseName !== expectedDatabaseNames[target]) {
      throw new Error(`Database name must match the approved ${target} database`);
    }
  }

  return Object.freeze({ connectionString, databaseName, target });
}

export function requireOnlineTestMigrationConfirmation(target: DatabaseTarget): void {
  if (target !== 'online-test') return;
  const projectRef = process.env.ONLINE_TEST_SUPABASE_PROJECT_REF;
  const expected = `apply-${projectRef}-online-test`;
  if (process.env.ONLINE_TEST_MIGRATION_CONFIRM !== expected) {
    throw new Error(`Set ONLINE_TEST_MIGRATION_CONFIRM=${expected} to apply remote migrations`);
  }
}

export function requireRebuildConfirmation(target: DatabaseTarget): void {
  const expected = `rebuild-neighbourhood-store-${target}`;
  if (process.env.DB_REBUILD_CONFIRM !== expected) {
    throw new Error(`Set DB_REBUILD_CONFIRM=${expected} to rebuild this database`);
  }
}
