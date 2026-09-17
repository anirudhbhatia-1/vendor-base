import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDatabaseConfig, loadProductionRuntimeDatabaseConfig } from './config.js';

export type RuntimeEnvironment =
  'local' | 'test' | 'queue-compat' | 'supabase-dev' | 'supabase-production' | 'online-test';

export type ObjectStorageDriver = 'filesystem' | 'supabase';

export interface ProtectedObjectBucketNames {
  readonly catalogue_images: string;
  readonly vendor_onboarding: string;
}

export interface SharedRuntimeConfig {
  readonly dataMode: 'synthetic';
  readonly databaseUrl: string;
  readonly environment: RuntimeEnvironment;
  readonly objectStorageBuckets: ProtectedObjectBucketNames | undefined;
  readonly objectStorageDriver: ObjectStorageDriver;
  readonly objectStorageGrantKey: string;
  readonly objectStorageRoot: string;
  readonly otlpEndpoint: string | undefined;
  readonly paymentWebhookKey: string;
  readonly providerClearingAccountReference: string;
  readonly queuePrefix: string;
  readonly syntheticProvidersAcknowledged: boolean;
  readonly valkeyUrl: string;
  readonly version: string;
}

const environments = new Set<RuntimeEnvironment>([
  'local',
  'test',
  'queue-compat',
  'supabase-dev',
  'supabase-production',
  'online-test',
]);

/**
 * Environments whose runtime is a developer machine or an automated test. Only these may
 * fall back to the synthetic material committed to this repository. Every other environment
 * reaches a database, queue or browser that is not exclusively under a developer's control,
 * so its secret material must be injected from the approved secret manager (D-15).
 */
const syntheticDefaultEnvironments = new Set<RuntimeEnvironment>(['local', 'test', 'queue-compat']);

const placeholderPattern = /^(replace[-_]with|<|changeme|example)/i;

export function allowsSyntheticDefaults(environment: RuntimeEnvironment): boolean {
  return syntheticDefaultEnvironments.has(environment);
}

/**
 * Resolves one piece of private key material. Outside the synthetic-default environments the
 * value must be supplied explicitly and must not reuse a committed default or an env.example
 * placeholder, because both are published in this repository.
 */
export function resolveSecretMaterial(options: {
  readonly environment: RuntimeEnvironment;
  readonly localDefault: string;
  readonly minimumLength?: number;
  readonly name: string;
}): string {
  const { environment, localDefault, name } = options;
  const minimumLength = options.minimumLength ?? 32;
  const provided = process.env[name];
  if (allowsSyntheticDefaults(environment)) {
    const value = provided ?? localDefault;
    if (value.length < minimumLength) {
      throw new Error(`${name} must contain at least ${minimumLength} characters`);
    }
    return value;
  }
  if (provided === undefined || provided === '') {
    throw new Error(
      `${name} must be injected from the approved secret manager in the ${environment} environment; committed synthetic material is local-only`,
    );
  }
  if (provided.length < minimumLength) {
    throw new Error(`${name} must contain at least ${minimumLength} characters`);
  }
  if (provided === localDefault || provided.toLowerCase().startsWith('local-synthetic')) {
    throw new Error(
      `${name} must not reuse committed synthetic material in the ${environment} environment`,
    );
  }
  if (placeholderPattern.test(provided)) {
    throw new Error(
      `${name} still contains an env.example placeholder in the ${environment} environment`,
    );
  }
  return provided;
}

/**
 * D-15 permits fake provider adapters only in local development and automated tests. No approved
 * integration adapter is implemented yet, so an environment outside that set must acknowledge the
 * synthetic runtime explicitly; otherwise startup fails rather than silently accepting a fake
 * one-time-password or a locally rooted object store on a shared deployment.
 */
function resolveSyntheticProviderAcknowledgement(environment: RuntimeEnvironment): boolean {
  const acknowledgement = process.env.ALLOW_SYNTHETIC_PROVIDERS;
  if (allowsSyntheticDefaults(environment)) return true;
  if (acknowledgement === undefined || acknowledgement === '') return false;
  if (acknowledgement !== 'synthetic-testing-only') {
    throw new Error('ALLOW_SYNTHETIC_PROVIDERS must be unset or exactly "synthetic-testing-only"');
  }
  return true;
}

function absoluteStorageRoot(): string {
  const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
  return resolve(repositoryRoot, process.env.OBJECT_STORAGE_LOCAL_PATH ?? '.local-data/objects');
}

function resolveDatabaseUrl(environment: RuntimeEnvironment): string {
  if (environment === 'supabase-dev') return loadDatabaseConfig('supabase-dev').connectionString;
  if (environment === 'supabase-production')
    return loadProductionRuntimeDatabaseConfig().connectionString;
  if (environment === 'test' || environment === 'queue-compat') {
    return process.env.TEST_DATABASE_URL ?? loadDatabaseConfig('test').connectionString;
  }
  if (environment === 'online-test') return loadDatabaseConfig('online-test').connectionString;
  return process.env.DATABASE_URL ?? loadDatabaseConfig('local').connectionString;
}

export function loadSharedRuntimeConfig(): SharedRuntimeConfig {
  const rawEnvironment = process.env.APP_ENV ?? 'local';
  if (!environments.has(rawEnvironment as RuntimeEnvironment)) {
    throw new Error('APP_ENV is not an allowed runtime environment');
  }
  const environment = rawEnvironment as RuntimeEnvironment;
  if ((process.env.DATA_MODE ?? 'synthetic') !== 'synthetic') {
    throw new Error('Only synthetic DATA_MODE is allowed');
  }
  const version = process.env.RELEASE_VERSION ?? '0.0.0';
  if (environment === 'online-test' && !/^[a-f0-9]{40}$/.test(version)) {
    throw new Error('online-test RELEASE_VERSION must be a full lowercase Git commit SHA');
  }
  const rawDriver = process.env.OBJECT_STORAGE_DRIVER ?? 'filesystem';
  if (rawDriver !== 'filesystem' && rawDriver !== 'supabase') {
    throw new Error('OBJECT_STORAGE_DRIVER must be filesystem or supabase');
  }
  const objectStorageDriver: ObjectStorageDriver = rawDriver;
  const syntheticProvidersAcknowledged = resolveSyntheticProviderAcknowledgement(environment);
  // The filesystem adapter writes to the machine running the process, so it cannot
  // back a deployment. The Supabase adapter can, which is why it is not gated here.
  if (objectStorageDriver === 'filesystem' && !syntheticProvidersAcknowledged) {
    throw new Error(
      `The filesystem object-storage adapter is local-only and cannot serve the ${environment} environment. Set OBJECT_STORAGE_DRIVER=supabase with its buckets, or ALLOW_SYNTHETIC_PROVIDERS=synthetic-testing-only to run a knowingly synthetic deployment`,
    );
  }
  let objectStorageBuckets: ProtectedObjectBucketNames | undefined;
  if (objectStorageDriver === 'supabase') {
    const catalogue = process.env.OBJECT_STORAGE_CATALOGUE_BUCKET;
    const evidence = process.env.OBJECT_STORAGE_EVIDENCE_BUCKET;
    if (!catalogue || !evidence) {
      throw new Error(
        'OBJECT_STORAGE_CATALOGUE_BUCKET and OBJECT_STORAGE_EVIDENCE_BUCKET are required for the supabase object-storage driver',
      );
    }
    // D-15 keeps quarantined evidence apart from catalogue assets. One bucket for
    // both would make a rejected document reachable wherever an image is.
    if (catalogue === evidence) {
      throw new Error('Quarantined evidence must not share a bucket with catalogue assets');
    }
    objectStorageBuckets = Object.freeze({
      catalogue_images: catalogue,
      vendor_onboarding: evidence,
    });
  }
  const objectStorageGrantKey = resolveSecretMaterial({
    environment,
    localDefault: ['local', 'synthetic', 'protected', 'object', 'grant', 'material'].join('-'),
    name: 'OBJECT_STORAGE_GRANT_KEY',
  });
  const valkeyUrl =
    process.env.VALKEY_URL ??
    (environment === 'test' || environment === 'queue-compat'
      ? 'redis://127.0.0.1:6380'
      : 'redis://127.0.0.1:6379');
  let parsedValkey: URL;
  try {
    parsedValkey = new URL(valkeyUrl);
  } catch {
    throw new Error('VALKEY_URL is invalid');
  }
  if (parsedValkey.protocol !== 'redis:' && parsedValkey.protocol !== 'rediss:') {
    throw new Error('VALKEY_URL must use redis:// or rediss://');
  }
  const queuePrefix = process.env.QUEUE_PREFIX ?? `neighbourhood-store:${environment}`;
  if (!/^[a-z0-9][a-z0-9:-]{2,80}$/.test(queuePrefix)) throw new Error('QUEUE_PREFIX is invalid');
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (otlpEndpoint) {
    let parsedOtlp: URL;
    try {
      parsedOtlp = new URL(otlpEndpoint);
    } catch {
      throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT is invalid');
    }
    if (parsedOtlp.protocol !== 'http:' && parsedOtlp.protocol !== 'https:') {
      throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT must use HTTP or HTTPS');
    }
  }
  const paymentWebhookKey = resolveSecretMaterial({
    environment,
    localDefault: 'local-synthetic-payment-webhook-key-material',
    name: 'PAYMENT_WEBHOOK_KEY',
  });
  const explicitClearingReference = process.env.PROVIDER_CLEARING_ACCOUNT_REFERENCE;
  if (!allowsSyntheticDefaults(environment) && !explicitClearingReference) {
    throw new Error(
      `PROVIDER_CLEARING_ACCOUNT_REFERENCE must name the configured provider clearing account in the ${environment} environment`,
    );
  }
  const providerClearingAccountReference =
    explicitClearingReference ?? 'SYNTH-ACCOUNT-FAKE-PROVIDER';
  if (!/^[A-Z0-9][A-Z0-9._:/-]{3,127}$/.test(providerClearingAccountReference)) {
    throw new Error('PROVIDER_CLEARING_ACCOUNT_REFERENCE is invalid');
  }
  return Object.freeze({
    dataMode: 'synthetic',
    databaseUrl: resolveDatabaseUrl(environment),
    environment,
    objectStorageBuckets,
    objectStorageDriver,
    objectStorageGrantKey,
    objectStorageRoot: absoluteStorageRoot(),
    otlpEndpoint,
    paymentWebhookKey,
    providerClearingAccountReference,
    queuePrefix,
    syntheticProvidersAcknowledged,
    valkeyUrl,
    version,
  });
}
