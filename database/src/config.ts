export type DatabaseTarget =
  'local' | 'test' | 'supabase-dev' | 'supabase-production' | 'online-test';

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
  if (
    target !== 'local' &&
    target !== 'test' &&
    target !== 'supabase-dev' &&
    target !== 'supabase-production' &&
    target !== 'online-test'
  ) {
    throw new Error(
      'Database target must be local, test, supabase-dev, supabase-production, or online-test',
    );
  }
  return target;
}

export function loadDatabaseConfig(target: DatabaseTarget): DatabaseConfig {
  const configuredUrl =
    target === 'test'
      ? process.env.TEST_DATABASE_URL
      : target === 'supabase-dev'
        ? process.env.SUPABASE_DATABASE_URL
        : target === 'supabase-production'
          ? process.env.SUPABASE_PRODUCTION_MIGRATION_URL
          : target === 'online-test'
            ? process.env.ONLINE_TEST_DATABASE_URL
            : process.env.DATABASE_URL;
  if (
    (target === 'supabase-dev' || target === 'supabase-production' || target === 'online-test') &&
    !configuredUrl
  ) {
    throw new Error(
      `${target === 'supabase-dev' ? 'SUPABASE_DATABASE_URL' : target === 'supabase-production' ? 'SUPABASE_PRODUCTION_MIGRATION_URL' : 'ONLINE_TEST_DATABASE_URL'} is required for the ${target} target`,
    );
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
  if (target === 'supabase-dev' || target === 'supabase-production' || target === 'online-test') {
    const projectRef =
      target === 'supabase-dev'
        ? process.env.SUPABASE_PROJECT_REF
        : target === 'supabase-production'
          ? process.env.SUPABASE_PRODUCTION_PROJECT_REF
          : process.env.ONLINE_TEST_SUPABASE_PROJECT_REF;
    if (!projectRef || !/^[a-z0-9]{20}$/.test(projectRef)) {
      throw new Error(
        `${target === 'supabase-dev' ? 'SUPABASE_PROJECT_REF' : target === 'supabase-production' ? 'SUPABASE_PRODUCTION_PROJECT_REF' : 'ONLINE_TEST_SUPABASE_PROJECT_REF'} must be a 20-character project reference`,
      );
    }
    const directHost = `db.${projectRef}.supabase.co`;
    const sessionPoolerHost = /^aws-[a-z0-9-]+\.pooler\.supabase\.com$/;
    if (parsed.hostname !== directHost && !sessionPoolerHost.test(parsed.hostname)) {
      throw new Error(`${target} database host must be the selected Supabase project`);
    }
    if (databaseName !== 'postgres') {
      throw new Error(`${target} Supabase database name must be postgres`);
    }
    if (parsed.port !== '5432') {
      throw new Error(`${target} must use a direct or session-pooler connection on port 5432`);
    }
    const sslMode = parsed.searchParams.get('sslmode');
    if (target === 'supabase-production' && process.env.SUPABASE_PRODUCTION_SSL_ROOT_CERT) {
      parsed.searchParams.set('sslrootcert', process.env.SUPABASE_PRODUCTION_SSL_ROOT_CERT);
    }
    if (target === 'supabase-dev' && sslMode === null) {
      // Supabase's dashboard may omit this parameter from copied pooler URLs.
      // Keep the development connection encrypted while avoiding edits to the
      // password-bearing URL and Node's legacy SSL-mode alias warning.
      parsed.searchParams.set('uselibpqcompat', 'true');
      parsed.searchParams.set('sslmode', 'require');
    } else if (
      sslMode !== 'verify-full' &&
      !(
        target === 'supabase-dev' &&
        sslMode === 'require' &&
        parsed.searchParams.get('uselibpqcompat') === 'true'
      )
    ) {
      throw new Error(`${target} database URL must use sslmode=verify-full`);
    }
    if (target === 'supabase-production') {
      const rootCertificate = parsed.searchParams.get('sslrootcert');
      if (!rootCertificate || !rootCertificate.startsWith('/')) {
        throw new Error(
          'supabase-production requires an absolute sslrootcert path to the Supabase CA',
        );
      }
    }
    const directUser = parsed.username === 'postgres';
    const poolerUser = parsed.username === `postgres.${projectRef}`;
    if (!directUser && !poolerUser) {
      throw new Error(`${target} database user does not match the selected Supabase project`);
    }
  } else {
    if (!loopbackHosts.has(parsed.hostname)) {
      throw new Error('Local and test database connections must use a loopback host');
    }
    if (databaseName !== expectedDatabaseNames[target]) {
      throw new Error(`Database name must match the approved ${target} database`);
    }
  }

  return Object.freeze({
    connectionString:
      target === 'supabase-dev' || target === 'supabase-production'
        ? parsed.toString()
        : connectionString,
    databaseName,
    target,
  });
}

export function loadProductionRuntimeDatabaseConfig(): DatabaseConfig {
  const configuredUrl = process.env.SUPABASE_PRODUCTION_DATABASE_URL;
  const projectRef = process.env.SUPABASE_PRODUCTION_PROJECT_REF;
  const password = process.env.SUPABASE_PRODUCTION_RUNTIME_PASSWORD;
  const rootCertificate = process.env.SUPABASE_PRODUCTION_SSL_ROOT_CERT;
  if (!configuredUrl || !projectRef || !password || !rootCertificate) {
    throw new Error('Production runtime database configuration is incomplete');
  }
  if (!/^[a-z0-9]{20}$/.test(projectRef)) {
    throw new Error('SUPABASE_PRODUCTION_PROJECT_REF must be a 20-character project reference');
  }
  if (password.length < 32 || /[\r\n]/.test(password)) {
    throw new Error('SUPABASE_PRODUCTION_RUNTIME_PASSWORD is invalid');
  }

  let parsed: URL;
  try {
    parsed = new URL(configuredUrl);
  } catch {
    throw new Error('SUPABASE_PRODUCTION_DATABASE_URL is invalid');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('Production runtime URL must use the PostgreSQL protocol');
  }
  const poolerHostPattern = /^aws-[a-z0-9-]+\.pooler\.supabase\.com$/;
  if (
    parsed.hostname !== `db.${projectRef}.supabase.co` &&
    !poolerHostPattern.test(parsed.hostname)
  ) {
    throw new Error('Production runtime database host must be the selected Supabase project');
  }
  if (decodeURIComponent(parsed.pathname.slice(1)) !== 'postgres') {
    throw new Error('Production runtime must use database postgres');
  }
  if (
    parsed.username !== 'marketplace_app' &&
    parsed.username !== `marketplace_app.${projectRef}`
  ) {
    throw new Error('Production runtime must use the marketplace_app login');
  }
  const directHost = parsed.hostname === `db.${projectRef}.supabase.co`;
  const sessionPoolerHost = poolerHostPattern.test(parsed.hostname);
  const connectionMode =
    process.env.SUPABASE_PRODUCTION_RUNTIME_CONNECTION_MODE ??
    (directHost ? 'direct' : parsed.port === '6543' ? 'transaction' : 'session');
  if (!['direct', 'session', 'transaction'].includes(connectionMode)) {
    throw new Error(
      'SUPABASE_PRODUCTION_RUNTIME_CONNECTION_MODE must be direct, session, or transaction',
    );
  }
  if (connectionMode === 'direct' && (!directHost || parsed.port !== '5432')) {
    throw new Error('Production direct runtime must use the project host on port 5432');
  }
  if (connectionMode === 'session' && (!sessionPoolerHost || parsed.port !== '5432')) {
    throw new Error('Production session runtime must use the shared pooler on port 5432');
  }
  if (connectionMode === 'transaction') {
    if (!sessionPoolerHost || (parsed.port !== '5432' && parsed.port !== '6543')) {
      throw new Error('Production transaction runtime must use the shared pooler on port 6543');
    }
    parsed.port = '6543';
  }
  if (parsed.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('Production runtime must use sslmode=verify-full');
  }

  parsed.password = password;
  parsed.searchParams.set('sslrootcert', rootCertificate);
  return Object.freeze({
    connectionString: parsed.toString(),
    databaseName: 'postgres',
    target: 'supabase-production',
  });
}

export function requireRemoteMigrationConfirmation(target: DatabaseTarget): void {
  if (target !== 'supabase-dev' && target !== 'supabase-production' && target !== 'online-test')
    return;
  const projectRef =
    target === 'supabase-dev'
      ? process.env.SUPABASE_PROJECT_REF
      : target === 'supabase-production'
        ? process.env.SUPABASE_PRODUCTION_PROJECT_REF
        : process.env.ONLINE_TEST_SUPABASE_PROJECT_REF;
  const expected = `apply-${projectRef}-${target}`;
  const variable =
    target === 'supabase-dev'
      ? 'SUPABASE_MIGRATION_CONFIRM'
      : target === 'supabase-production'
        ? 'SUPABASE_PRODUCTION_MIGRATION_CONFIRM'
        : 'ONLINE_TEST_MIGRATION_CONFIRM';
  if (process.env[variable] !== expected) {
    throw new Error(`Set ${variable}=${expected} to apply remote migrations`);
  }
}

export function requireRebuildConfirmation(target: DatabaseTarget): void {
  const expected = `rebuild-neighbourhood-store-${target}`;
  if (process.env.DB_REBUILD_CONFIRM !== expected) {
    throw new Error(`Set DB_REBUILD_CONFIRM=${expected} to rebuild this database`);
  }
}
