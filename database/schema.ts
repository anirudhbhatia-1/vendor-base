import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * PostgreSQL migrations remain authoritative. These definitions describe the
 * reviewed schema for typed server-side access; drizzle-kit push is prohibited.
 */
export const marketplaceSchema = pgSchema('marketplace');

export const customerPrivacyRequests = marketplaceSchema.table(
  'customer_privacy_requests',
  {
    customerPrivacyRequestId: uuid('customer_privacy_request_id').primaryKey(),
    userId: uuid('user_id').notNull(),
    requestKind: text('request_kind').notNull(),
    lifecycleState: text('lifecycle_state').notNull().default('REQUESTED'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    exportExpiresAt: timestamp('export_expires_at', { withTimezone: true }),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('one_open_customer_privacy_request')
      .on(table.userId, table.requestKind)
      .where(sql`${table.lifecycleState} IN ('REQUESTED','PROCESSING','READY')`),
    check(
      'customer_privacy_requests_request_kind_check',
      sql`${table.requestKind} IN ('DATA_EXPORT','ACCOUNT_DELETION')`,
    ),
    check(
      'customer_privacy_requests_lifecycle_state_check',
      sql`${table.lifecycleState} IN ('REQUESTED','PROCESSING','READY','COMPLETED','CANCELLED','FAILED')`,
    ),
  ],
);

export const idempotencyRecords = marketplaceSchema.table(
  'idempotency_records',
  {
    recordId: uuid('record_id').primaryKey(),
    actorId: uuid('actor_id').notNull(),
    commandScope: text('command_scope').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    requestId: uuid('request_id').notNull(),
    status: text('status').notNull(),
    httpStatus: smallint('http_status'),
    responseBody: jsonb('response_body'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }).notNull(),
    reconciliationDueAt: timestamp('reconciliation_due_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('unique_idempotent_command').on(
      table.actorId,
      table.commandScope,
      table.idempotencyKey,
    ),
    index('idempotency_records_expiry').on(table.expiresAt),
    index('idempotency_records_uncertain')
      .on(table.reconciliationDueAt)
      .where(sql`${table.status} = 'UNCERTAIN'`),
    check(
      'idempotency_status_allowed',
      sql`${table.status} IN ('IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'UNCERTAIN')`,
    ),
  ],
);

export const aggregateHeads = marketplaceSchema.table(
  'aggregate_heads',
  {
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    version: integer('version').notNull(),
    state: text('state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.aggregateType, table.aggregateId],
      name: 'aggregate_heads_pkey',
    }),
    index('aggregate_heads_by_type_state').on(
      table.aggregateType,
      table.state,
      table.updatedAt,
      table.aggregateId,
    ),
  ],
);

export const aggregateTransitions = marketplaceSchema.table(
  'aggregate_transitions',
  {
    transitionId: uuid('transition_id').primaryKey(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    previousVersion: integer('previous_version').notNull(),
    resultingVersion: integer('resulting_version').notNull(),
    fromState: text('from_state'),
    toState: text('to_state').notNull(),
    actorId: uuid('actor_id').notNull(),
    actorKind: text('actor_kind').notNull(),
    reasonCode: text('reason_code'),
    evidence: jsonb('evidence').notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    causationId: uuid('causation_id'),
    commandRecordId: uuid('command_record_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('aggregate_transition_version').on(
      table.aggregateType,
      table.aggregateId,
      table.resultingVersion,
    ),
    index('aggregate_transitions_history').on(
      table.aggregateType,
      table.aggregateId,
      table.resultingVersion,
    ),
    index('aggregate_transitions_request').on(table.requestId),
  ],
);

export const outboxEvents = marketplaceSchema.table(
  'outbox_events',
  {
    eventId: uuid('event_id').primaryKey(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    aggregateVersion: integer('aggregate_version').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    causationId: uuid('causation_id'),
    status: text('status').default('PENDING').notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    maxAttempts: integer('max_attempts').notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    claimedBy: uuid('claimed_by'),
    claimUntil: timestamp('claim_until', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('outbox_events_dispatch')
      .on(table.status, table.availableAt, table.createdAt, table.eventId)
      .where(sql`${table.status} IN ('PENDING', 'PUBLISHING')`),
    index('outbox_events_dead_letter')
      .on(table.updatedAt, table.eventId)
      .where(sql`${table.status} = 'DEAD_LETTER'`),
  ],
);

export const inboxReceipts = marketplaceSchema.table(
  'inbox_receipts',
  {
    consumerScope: text('consumer_scope').notNull(),
    eventId: uuid('event_id').notNull(),
    status: text('status').notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.consumerScope, table.eventId],
      name: 'inbox_receipts_pkey',
    }),
    index('inbox_receipts_event').on(table.eventId, table.consumerScope),
  ],
);

export const outboxRecoveries = marketplaceSchema.table(
  'outbox_recoveries',
  {
    recoveryId: uuid('recovery_id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    actorId: uuid('actor_id').notNull(),
    requestId: uuid('request_id').notNull(),
    reasonCode: text('reason_code').notNull(),
    previousAttemptCount: integer('previous_attempt_count').notNull(),
    recoveredAt: timestamp('recovered_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('outbox_recoveries_event').on(table.eventId, table.recoveredAt)],
);

/**
 * Durable worker liveness (migration 0071).
 *
 * Upserted in place by worker id, deliberately without `retentionClass`: this is
 * operational liveness, not user data, and the retention sweep covers only tables
 * that declare the column.
 */
export const workerHeartbeats = marketplaceSchema.table(
  'worker_heartbeats',
  {
    workerId: uuid('worker_id').primaryKey(),
    component: text('component').notNull(),
    queues: text('queues').array().notNull(),
    environment: text('environment').notNull(),
    version: text('version').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
  },
  (table) => [
    index('worker_heartbeats_live')
      .on(table.lastSeenAt.desc())
      .where(sql`${table.stoppedAt} IS NULL`),
  ],
);

export const scheduledJobs = marketplaceSchema.table(
  'scheduled_jobs',
  {
    jobId: uuid('job_id').primaryKey(),
    queueScope: text('queue_scope').notNull(),
    jobType: text('job_type').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payload: jsonb('payload').notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    causationId: uuid('causation_id'),
    status: text('status').default('SCHEDULED').notNull(),
    priority: smallint('priority').default(50).notNull(),
    runAt: timestamp('run_at', { withTimezone: true }).notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    maxAttempts: integer('max_attempts').notNull(),
    claimedBy: uuid('claimed_by'),
    claimUntil: timestamp('claim_until', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('scheduled_jobs_queue_idempotency').on(table.queueScope, table.idempotencyKey),
    index('scheduled_jobs_claim')
      .on(table.queueScope, table.status, table.runAt, table.priority, table.createdAt, table.jobId)
      .where(sql`${table.status} IN ('SCHEDULED', 'RUNNING')`),
    index('scheduled_jobs_dead_letter')
      .on(table.queueScope, table.updatedAt, table.jobId)
      .where(sql`${table.status} = 'DEAD_LETTER'`),
  ],
);

export const jobAttempts = marketplaceSchema.table(
  'job_attempts',
  {
    attemptId: uuid('attempt_id').primaryKey(),
    jobId: uuid('job_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    workerId: uuid('worker_id').notNull(),
    outcome: text('outcome').notNull(),
    errorCode: text('error_code'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('job_attempts_job_number').on(table.jobId, table.attemptNumber),
    index('job_attempts_job_history').on(table.jobId, table.attemptNumber),
    index('job_attempts_recent_failures')
      .on(table.finishedAt, table.outcome)
      .where(sql`${table.outcome} IN ('RETRY_SCHEDULED', 'DEAD_LETTER', 'LEASE_EXPIRED')`),
  ],
);

export const jobRecoveries = marketplaceSchema.table(
  'job_recoveries',
  {
    recoveryId: uuid('recovery_id').primaryKey(),
    jobId: uuid('job_id').notNull(),
    actorId: uuid('actor_id').notNull(),
    requestId: uuid('request_id').notNull(),
    reasonCode: text('reason_code').notNull(),
    previousAttemptCount: integer('previous_attempt_count').notNull(),
    attemptsAdded: integer('attempts_added').notNull(),
    recoveredAt: timestamp('recovered_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('job_recoveries_job').on(table.jobId, table.recoveredAt)],
);

export const configurationVersions = marketplaceSchema.table(
  'configuration_versions',
  {
    configurationVersionId: uuid('configuration_version_id').primaryKey(),
    configurationKey: text('configuration_key').notNull(),
    versionNumber: integer('version_number').notNull(),
    configurationKind: text('configuration_kind').notNull(),
    valueType: text('value_type').notNull(),
    configurationValue: jsonb('configuration_value').notNull(),
    scopeKind: text('scope_kind').notNull(),
    scopeReference: text('scope_reference').notNull(),
    status: text('status').default('DRAFT').notNull(),
    proposedBy: uuid('proposed_by').notNull(),
    validatedBy: uuid('validated_by'),
    approvedBy: uuid('approved_by'),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    rollbackOfVersionId: uuid('rollback_of_version_id'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    effectiveUntil: timestamp('effective_until', { withTimezone: true }),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('configuration_version_identity').on(
      table.configurationKey,
      table.scopeKind,
      table.scopeReference,
      table.versionNumber,
    ),
    uniqueIndex('one_active_configuration_per_scope')
      .on(table.configurationKey, table.scopeKind, table.scopeReference)
      .where(sql`${table.status} = 'ACTIVE'`),
    uniqueIndex('one_scheduled_configuration_per_scope')
      .on(table.configurationKey, table.scopeKind, table.scopeReference)
      .where(sql`${table.status} = 'SCHEDULED'`),
    index('configuration_versions_resolution').on(
      table.configurationKey,
      table.configurationKind,
      table.status,
      table.scopeKind,
      table.scopeReference,
      table.effectiveFrom,
    ),
    index('configuration_versions_rollback')
      .on(table.rollbackOfVersionId)
      .where(sql`${table.rollbackOfVersionId} IS NOT NULL`),
  ],
);

export const configurationLifecycleEvents = marketplaceSchema.table(
  'configuration_lifecycle_events',
  {
    eventId: uuid('event_id').primaryKey(),
    configurationVersionId: uuid('configuration_version_id').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    actorId: uuid('actor_id').notNull(),
    requestId: uuid('request_id').notNull(),
    reasonCode: text('reason_code').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('configuration_lifecycle_history').on(
      table.configurationVersionId,
      table.occurredAt,
      table.eventId,
    ),
  ],
);

export const businessConfigurationSnapshots = marketplaceSchema.table(
  'business_configuration_snapshots',
  {
    businessRecordType: text('business_record_type').notNull(),
    businessRecordId: uuid('business_record_id').notNull(),
    configurationKey: text('configuration_key').notNull(),
    configurationVersionId: uuid('configuration_version_id').notNull(),
    snapshottedAt: timestamp('snapshotted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.businessRecordType, table.businessRecordId, table.configurationKey],
      name: 'business_configuration_snapshot_pk',
    }),
    index('business_configuration_snapshot_version').on(table.configurationVersionId),
  ],
);

export const otpChallenges = marketplaceSchema.table(
  'otp_challenges',
  {
    challengeId: uuid('challenge_id').primaryKey(),
    phoneLookupHash: text('phone_lookup_hash').notNull(),
    deviceId: uuid('device_id').notNull(),
    purpose: text('purpose').notNull(),
    requestKey: text('request_key').notNull(),
    codeHash: text('code_hash').notNull(),
    status: text('status').notNull(),
    providerScenario: text('provider_scenario').notNull(),
    providerReference: text('provider_reference').notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    maxAttempts: integer('max_attempts').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    dataClassification: text('data_classification').default('HIGHLY_RESTRICTED').notNull(),
    retentionClass: text('retention_class').default('OTP_ABUSE_EVIDENCE').notNull(),
    retentionReviewAt: timestamp('retention_review_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('otp_request_identity').on(table.phoneLookupHash, table.purpose, table.requestKey),
    index('otp_challenges_phone_rate').on(table.phoneLookupHash, table.createdAt),
    index('otp_challenges_device_rate').on(table.deviceId, table.createdAt),
    index('otp_challenges_expiry').on(table.status, table.expiresAt),
  ],
);

export const otpProtectedTestOutbox = marketplaceSchema.table('otp_protected_test_outbox', {
  challengeId: uuid('challenge_id').primaryKey(),
  otpCode: text('otp_code').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const otpProviderEvents = marketplaceSchema.table(
  'otp_provider_events',
  {
    providerEventId: text('provider_event_id').primaryKey(),
    challengeId: uuid('challenge_id').notNull(),
    outcome: text('outcome').notNull(),
    requestId: uuid('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('otp_provider_events_challenge').on(table.challengeId, table.createdAt)],
);

export const otpVerificationAttempts = marketplaceSchema.table(
  'otp_verification_attempts',
  {
    attemptId: uuid('attempt_id').primaryKey(),
    challengeId: uuid('challenge_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    outcome: text('outcome').notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('otp_attempt_number_unique').on(table.challengeId, table.attemptNumber),
    index('otp_verification_attempts_recent').on(table.occurredAt, table.outcome),
  ],
);

export const users = marketplaceSchema.table('users', {
  userId: uuid('user_id').primaryKey(),
  state: text('state').default('ACTIVE').notNull(),
  dataClassification: text('data_classification').default('RESTRICTED').notNull(),
  retentionClass: text('retention_class').default('ACCOUNT_LIFECYCLE').notNull(),
  retentionReviewAt: timestamp('retention_review_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const phoneIdentities = marketplaceSchema.table(
  'phone_identities',
  {
    phoneIdentityId: uuid('phone_identity_id').primaryKey(),
    userId: uuid('user_id').notNull(),
    phoneLookupHash: text('phone_lookup_hash').notNull(),
    dataClassification: text('data_classification').default('HIGHLY_RESTRICTED').notNull(),
    retentionClass: text('retention_class').default('VERIFIED_IDENTITY').notNull(),
    retentionReviewAt: timestamp('retention_review_at', { withTimezone: true }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('phone_identities_phone_lookup_hash_key').on(table.phoneLookupHash),
    index('phone_identities_user').on(table.userId),
  ],
);

export const devices = marketplaceSchema.table(
  'devices',
  {
    deviceRegistrationId: uuid('device_registration_id').primaryKey(),
    userId: uuid('user_id').notNull(),
    clientDeviceId: uuid('client_device_id').notNull(),
    platform: text('platform').notNull(),
    deviceLabel: text('device_label'),
    notificationTokenHash: text('notification_token_hash'),
    notificationState: text('notification_state').default('NONE').notNull(),
    dataClassification: text('data_classification').default('RESTRICTED').notNull(),
    retentionClass: text('retention_class').default('DEVICE_SECURITY').notNull(),
    retentionReviewAt: timestamp('retention_review_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('device_identity').on(table.userId, table.clientDeviceId),
    index('devices_user_activity').on(table.userId, table.lastSeenAt, table.deviceRegistrationId),
  ],
);

export const sessions = marketplaceSchema.table(
  'sessions',
  {
    sessionId: uuid('session_id').primaryKey(),
    tokenFamilyId: uuid('token_family_id').notNull(),
    userId: uuid('user_id').notNull(),
    deviceRegistrationId: uuid('device_registration_id').notNull(),
    otpChallengeId: uuid('otp_challenge_id'),
    externalSupabaseSessionId: uuid('external_supabase_session_id'),
    originKind: text('origin_kind').default('OTP').notNull(),
    state: text('state').default('ACTIVE').notNull(),
    version: integer('version').default(1).notNull(),
    accessTokenHash: text('access_token_hash'),
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
    dataClassification: text('data_classification').default('HIGHLY_RESTRICTED').notNull(),
    retentionClass: text('retention_class').default('SESSION_SECURITY').notNull(),
    retentionReviewAt: timestamp('retention_review_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('sessions_otp_challenge_id_key').on(table.otpChallengeId),
    uniqueIndex('sessions_access_token_hash_key').on(table.accessTokenHash),
    uniqueIndex('sessions_external_supabase_session_unique')
      .on(table.externalSupabaseSessionId)
      .where(sql`${table.externalSupabaseSessionId} IS NOT NULL`),
    index('sessions_user_state').on(table.userId, table.state, table.updatedAt, table.sessionId),
    index('sessions_device_state').on(table.deviceRegistrationId, table.state, table.updatedAt),
  ],
);

export const sessionRefreshTokens = marketplaceSchema.table(
  'session_refresh_tokens',
  {
    refreshTokenId: uuid('refresh_token_id').primaryKey(),
    sessionId: uuid('session_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    status: text('status').default('ACTIVE').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('session_refresh_tokens_token_hash_key').on(table.tokenHash),
    uniqueIndex('one_active_refresh_token_per_session')
      .on(table.sessionId)
      .where(sql`${table.status} = 'ACTIVE'`),
    index('refresh_tokens_session_history').on(
      table.sessionId,
      table.createdAt,
      table.refreshTokenId,
    ),
  ],
);

export const sessionEvents = marketplaceSchema.table(
  'session_events',
  {
    eventId: uuid('event_id').primaryKey(),
    sessionId: uuid('session_id').notNull(),
    sessionVersion: integer('session_version').notNull(),
    eventType: text('event_type').notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('session_event_unique').on(table.sessionId, table.sessionVersion, table.eventType),
    index('session_events_history').on(table.sessionId, table.occurredAt, table.eventId),
  ],
);

export const capabilities = marketplaceSchema.table('capabilities', {
  capabilityKey: text('capability_key').primaryKey(),
  actorKind: text('actor_kind').notNull(),
  resourceRule: text('resource_rule').notNull(),
  description: text('description').notNull(),
});

export const roles = marketplaceSchema.table('roles', {
  roleKey: text('role_key').primaryKey(),
  actorKind: text('actor_kind').notNull(),
  assignmentScope: text('assignment_scope').notNull(),
  description: text('description').notNull(),
});

export const roleCapabilities = marketplaceSchema.table(
  'role_capabilities',
  {
    roleKey: text('role_key').notNull(),
    capabilityKey: text('capability_key').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.roleKey, table.capabilityKey],
      name: 'role_capabilities_pkey',
    }),
  ],
);

export const roleSeparationRules = marketplaceSchema.table(
  'role_separation_rules',
  {
    firstRoleKey: text('first_role_key').notNull(),
    secondRoleKey: text('second_role_key').notNull(),
    reasonCode: text('reason_code').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.firstRoleKey, table.secondRoleKey],
      name: 'role_separation_rules_pkey',
    }),
  ],
);

export const roleAssignments = marketplaceSchema.table(
  'role_assignments',
  {
    roleAssignmentId: uuid('role_assignment_id').primaryKey(),
    userId: uuid('user_id').notNull(),
    roleKey: text('role_key').notNull(),
    state: text('state').default('ACTIVE').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    grantedByUserId: uuid('granted_by_user_id'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    dataClassification: text('data_classification').default('RESTRICTED').notNull(),
    retentionClass: text('retention_class').default('ACCESS_CONTROL').notNull(),
    retentionReviewAt: timestamp('retention_review_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('role_assignments_user_active')
      .on(table.userId, table.roleKey, table.validFrom, table.validUntil)
      .where(sql`${table.state} = 'ACTIVE'`),
  ],
);

export const staffMemberships = marketplaceSchema.table(
  'staff_memberships',
  {
    staffMembershipId: uuid('staff_membership_id').primaryKey(),
    roleAssignmentId: uuid('role_assignment_id').notNull(),
    userId: uuid('user_id').notNull(),
    vendorLocationId: uuid('vendor_location_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('staff_memberships_role_assignment_id_key').on(table.roleAssignmentId),
    uniqueIndex('staff_membership_unique').on(
      table.userId,
      table.vendorLocationId,
      table.roleAssignmentId,
    ),
    index('staff_memberships_location_user').on(
      table.vendorLocationId,
      table.userId,
      table.roleAssignmentId,
    ),
  ],
);

export const partnerEligibilities = marketplaceSchema.table(
  'partner_eligibilities',
  {
    partnerEligibilityId: uuid('partner_eligibility_id').primaryKey(),
    roleAssignmentId: uuid('role_assignment_id').notNull(),
    userId: uuid('user_id').notNull(),
    state: text('state').notNull(),
    eligibleFrom: timestamp('eligible_from', { withTimezone: true }),
    eligibleUntil: timestamp('eligible_until', { withTimezone: true }),
    reasonCode: text('reason_code').notNull(),
    version: integer('version').default(1).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('partner_eligibilities_role_assignment_id_key').on(table.roleAssignmentId),
    uniqueIndex('partner_eligibilities_user_id_key').on(table.userId),
  ],
);

export const partnerAssignmentMemberships = marketplaceSchema.table(
  'partner_assignment_memberships',
  {
    partnerAssignmentMembershipId: uuid('partner_assignment_membership_id').primaryKey(),
    userId: uuid('user_id').notNull(),
    deliveryAssignmentId: uuid('delivery_assignment_id').notNull(),
    state: text('state').default('ACTIVE').notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    reasonCode: text('reason_code').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('one_active_assignment_per_partner')
      .on(table.userId)
      .where(sql`${table.state} = 'ACTIVE'`),
    uniqueIndex('one_active_partner_per_assignment')
      .on(table.deliveryAssignmentId)
      .where(sql`${table.state} = 'ACTIVE'`),
  ],
);

export const adminMembershipScopes = marketplaceSchema.table(
  'admin_membership_scopes',
  {
    adminMembershipScopeId: uuid('admin_membership_scope_id').primaryKey(),
    roleAssignmentId: uuid('role_assignment_id').notNull(),
    userId: uuid('user_id').notNull(),
    scopeKind: text('scope_kind').notNull(),
    scopeId: uuid('scope_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('admin_membership_scopes_role_assignment_id_key').on(table.roleAssignmentId),
    index('admin_membership_scopes_lookup').on(table.scopeKind, table.scopeId, table.userId),
  ],
);

export const accessMembershipEvents = marketplaceSchema.table(
  'access_membership_events',
  {
    eventId: uuid('event_id').primaryKey(),
    userId: uuid('user_id').notNull(),
    roleAssignmentId: uuid('role_assignment_id'),
    eventType: text('event_type').notNull(),
    reasonCode: text('reason_code').notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('access_membership_events_user_history').on(
      table.userId,
      table.occurredAt,
      table.eventId,
    ),
  ],
);

export const customerProfiles = marketplaceSchema.table('customer_profiles', {
  userId: uuid('user_id').primaryKey(),
  displayName: text('display_name'),
  language: text('language').default('EN').notNull(),
  state: text('state').default('ACTIVE').notNull(),
  version: integer('version').default(1).notNull(),
  dataClassification: text('data_classification').default('RESTRICTED').notNull(),
  retentionClass: text('retention_class').default('CUSTOMER_PROFILE').notNull(),
  retentionReviewAt: timestamp('retention_review_at', { withTimezone: true }).notNull(),
  requestId: uuid('request_id').notNull(),
  correlationId: uuid('correlation_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const consents = marketplaceSchema.table(
  'consents',
  {
    consentRecordId: uuid('consent_record_id').primaryKey(),
    userId: uuid('user_id').notNull(),
    consentKind: text('consent_kind').notNull(),
    consentVersion: integer('consent_version').notNull(),
    policyVersion: text('policy_version').notNull(),
    decision: text('decision').notNull(),
    source: text('source').notNull(),
    previousConsentRecordId: uuid('previous_consent_record_id'),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    dataClassification: text('data_classification').default('RESTRICTED').notNull(),
    retentionClass: text('retention_class').default('CONSENT_EVIDENCE').notNull(),
    retentionReviewAt: timestamp('retention_review_at', { withTimezone: true }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('consent_version_unique').on(table.userId, table.consentKind, table.consentVersion),
    uniqueIndex('consent_request_unique').on(table.userId, table.consentKind, table.requestId),
    index('consents_current').on(table.userId, table.consentKind, table.consentVersion),
  ],
);

export const notificationChannelPolicies = marketplaceSchema.table(
  'notification_channel_policies',
  {
    notificationKind: text('notification_kind').notNull(),
    channel: text('channel').notNull(),
    userControllable: boolean('user_controllable').notNull(),
    defaultEnabled: boolean('default_enabled').notNull(),
    requiresConsentKind: text('requires_consent_kind'),
    description: text('description').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.notificationKind, table.channel],
      name: 'notification_channel_policies_pkey',
    }),
  ],
);

export const notificationPreferences = marketplaceSchema.table(
  'notification_preferences',
  {
    userId: uuid('user_id').notNull(),
    notificationKind: text('notification_kind').notNull(),
    channel: text('channel').notNull(),
    enabled: boolean('enabled').notNull(),
    version: integer('version').default(1).notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    dataClassification: text('data_classification').default('INTERNAL').notNull(),
    retentionClass: text('retention_class').default('COMMUNICATION_PREFERENCE').notNull(),
    retentionReviewAt: timestamp('retention_review_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.notificationKind, table.channel],
      name: 'notification_preferences_pkey',
    }),
  ],
);

export const notificationPreferenceEvents = marketplaceSchema.table(
  'notification_preference_events',
  {
    eventId: uuid('event_id').primaryKey(),
    userId: uuid('user_id').notNull(),
    notificationKind: text('notification_kind').notNull(),
    channel: text('channel').notNull(),
    enabled: boolean('enabled').notNull(),
    preferenceVersion: integer('preference_version').notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('notification_preference_event_unique').on(
      table.userId,
      table.notificationKind,
      table.channel,
      table.preferenceVersion,
    ),
    index('notification_preference_events_history').on(
      table.userId,
      table.notificationKind,
      table.channel,
      table.preferenceVersion,
    ),
  ],
);

const geographyPoint = customType<{ data: string }>({
  dataType: () => 'geography(Point, 4326)',
});
const geographyMultiPolygon = customType<{ data: string }>({
  dataType: () => 'geography(MultiPolygon, 4326)',
});
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const vendors = marketplaceSchema.table(
  'vendors',
  {
    vendorId: uuid('vendor_id').primaryKey(),
    businessName: text('business_name').notNull(),
    profileDescription: text('profile_description'),
    lifecycleState: text('lifecycle_state').default('DRAFT').notNull(),
    version: integer('version').default(1).notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    dataClassification: text('data_classification').default('INTERNAL').notNull(),
    retentionClass: text('retention_class').default('BUSINESS_RECORD').notNull(),
    retentionReviewAt: timestamp('retention_review_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('vendors_lifecycle').on(table.lifecycleState, table.vendorId)],
);

export const vendorLocations = marketplaceSchema.table(
  'vendor_locations',
  {
    vendorLocationId: uuid('vendor_location_id').primaryKey(),
    vendorId: uuid('vendor_id').notNull(),
    locationName: text('location_name').notNull(),
    profileDescription: text('profile_description'),
    landmark: text('landmark'),
    operatingTimezone: text('operating_timezone').notNull(),
    coordinates: geographyPoint('coordinates').notNull(),
    category: text('category').notNull(),
    lifecycleState: text('lifecycle_state').default('DRAFT').notNull(),
    minimumOrderMinor: bigint('minimum_order_minor', { mode: 'number' }).default(0).notNull(),
    currency: text('currency').default('INR').notNull(),
    preparationSeconds: integer('preparation_seconds').default(1200).notNull(),
    version: integer('version').default(1).notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    dataClassification: text('data_classification').default('INTERNAL').notNull(),
    retentionClass: text('retention_class').default('BUSINESS_RECORD').notNull(),
    retentionReviewAt: timestamp('retention_review_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('vendor_locations_vendor_state').on(
      table.vendorId,
      table.lifecycleState,
      table.vendorLocationId,
    ),
    index('vendor_locations_coordinates').using('gist', table.coordinates),
  ],
);

export const vendorLocationOperatingHours = marketplaceSchema.table(
  'vendor_location_operating_hours',
  {
    operatingHourId: uuid('operating_hour_id').primaryKey(),
    vendorLocationId: uuid('vendor_location_id').notNull(),
    weekday: smallint('weekday').notNull(),
    opensAt: time('opens_at').notNull(),
    closesAt: time('closes_at').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('operating_hours_location_day').on(table.vendorLocationId, table.weekday, table.opensAt),
  ],
);

export const vendorLocationCalendarExceptions = marketplaceSchema.table(
  'vendor_location_calendar_exceptions',
  {
    calendarExceptionId: uuid('calendar_exception_id').primaryKey(),
    vendorLocationId: uuid('vendor_location_id').notNull(),
    localDate: date('local_date').notNull(),
    exceptionKind: text('exception_kind').notNull(),
    opensAt: time('opens_at'),
    closesAt: time('closes_at'),
    reasonCode: text('reason_code').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('calendar_exception_unique').on(table.vendorLocationId, table.localDate)],
);

export const vendorLocationTemporaryClosures = marketplaceSchema.table(
  'vendor_location_temporary_closures',
  {
    temporaryClosureId: uuid('temporary_closure_id').primaryKey(),
    vendorLocationId: uuid('vendor_location_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reasonCode: text('reason_code').notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('temporary_closures_active').on(table.vendorLocationId, table.startsAt, table.endsAt),
  ],
);

export const vendorServiceZones = marketplaceSchema.table(
  'vendor_service_zones',
  {
    serviceZoneId: uuid('service_zone_id').primaryKey(),
    vendorLocationId: uuid('vendor_location_id').notNull(),
    zoneName: text('zone_name').notNull(),
    operatingTimezone: text('operating_timezone').notNull(),
    boundary: geographyMultiPolygon('boundary').notNull(),
    lifecycleState: text('lifecycle_state').default('ACTIVE').notNull(),
    version: integer('version').default(1).notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('vendor_service_zones_boundary').using('gist', table.boundary),
    index('vendor_service_zones_location_state').on(
      table.vendorLocationId,
      table.lifecycleState,
      table.serviceZoneId,
    ),
  ],
);

export const vendorLocationFulfilmentModes = marketplaceSchema.table(
  'vendor_location_fulfilment_modes',
  {
    vendorLocationId: uuid('vendor_location_id').notNull(),
    fulfilmentMode: text('fulfilment_mode').notNull(),
    approvalState: text('approval_state').default('APPROVED').notNull(),
    approvedByUserId: uuid('approved_by_user_id').notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.vendorLocationId, table.fulfilmentMode],
      name: 'vendor_location_fulfilment_modes_pkey',
    }),
  ],
);

export const vendorNetworkEvents = marketplaceSchema.table(
  'vendor_network_events',
  {
    eventId: uuid('event_id').primaryKey(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    resultingVersion: integer('resulting_version').notNull(),
    eventType: text('event_type').notNull(),
    actorId: uuid('actor_id'),
    reasonCode: text('reason_code').notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('vendor_event_unique').on(
      table.aggregateType,
      table.aggregateId,
      table.resultingVersion,
    ),
    index('vendor_network_events_history').on(
      table.aggregateType,
      table.aggregateId,
      table.resultingVersion,
      table.occurredAt,
    ),
  ],
);

export const vendorOnboardingCases = marketplaceSchema.table(
  'vendor_onboarding_cases',
  {
    onboardingCaseId: uuid('onboarding_case_id').primaryKey(),
    entryKind: text('entry_kind').notNull(),
    lifecycleState: text('lifecycle_state').notNull(),
    applicantUserId: uuid('applicant_user_id'),
    createdByUserId: uuid('created_by_user_id'),
    invitationReference: text('invitation_reference'),
    businessProfileReference: text('business_profile_reference'),
    payoutProfileReference: text('payout_profile_reference'),
    proposedBusinessName: text('proposed_business_name'),
    proposedLocationName: text('proposed_location_name'),
    proposedProfileDescription: text('proposed_profile_description'),
    proposedOperatingTimezone: text('proposed_operating_timezone'),
    proposedCoordinates: geographyPoint('proposed_coordinates'),
    proposedCategory: text('proposed_category'),
    proposedMinimumOrderMinor: bigint('proposed_minimum_order_minor', { mode: 'number' }),
    proposedCurrency: text('proposed_currency'),
    proposedPreparationSeconds: integer('proposed_preparation_seconds'),
    vendorId: uuid('vendor_id'),
    vendorLocationId: uuid('vendor_location_id'),
    currentReasonCode: text('current_reason_code').notNull(),
    version: integer('version').default(1).notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    dataClassification: text('data_classification').default('CONFIDENTIAL').notNull(),
    retentionClass: text('retention_class').default('ONBOARDING_EVIDENCE').notNull(),
    retentionReviewAt: timestamp('retention_review_at', { withTimezone: true }).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewStartedAt: timestamp('review_started_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('vendor_onboarding_pipeline').on(
      table.lifecycleState,
      table.updatedAt,
      table.onboardingCaseId,
    ),
    index('vendor_onboarding_applicant').on(
      table.applicantUserId,
      table.updatedAt,
      table.onboardingCaseId,
    ),
    index('vendor_onboarding_coordinates').using('gist', table.proposedCoordinates),
  ],
);

export const vendorVerificationDocuments = marketplaceSchema.table(
  'vendor_verification_documents',
  {
    verificationDocumentId: uuid('verification_document_id').primaryKey(),
    onboardingCaseId: uuid('onboarding_case_id').notNull(),
    documentKind: text('document_kind').notNull(),
    documentVersion: integer('document_version').notNull(),
    lifecycleState: text('lifecycle_state').notNull(),
    objectKey: text('object_key').notNull(),
    contentSha256: text('content_sha256').notNull(),
    contentLength: integer('content_length').notNull(),
    mediaType: text('media_type').notNull(),
    scanState: text('scan_state').notNull(),
    expiresOn: date('expires_on'),
    graceUntil: date('grace_until'),
    affectedCapability: text('affected_capability').notNull(),
    replacesDocumentId: uuid('replaces_document_id'),
    uploadedByUserId: uuid('uploaded_by_user_id').notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    dataClassification: text('data_classification').default('CONFIDENTIAL').notNull(),
    retentionClass: text('retention_class').default('VERIFICATION_DOCUMENT').notNull(),
    retentionReviewAt: timestamp('retention_review_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('vendor_document_object_unique').on(table.objectKey),
    uniqueIndex('vendor_document_version_unique').on(
      table.onboardingCaseId,
      table.documentKind,
      table.documentVersion,
    ),
    index('vendor_documents_case_state').on(
      table.onboardingCaseId,
      table.lifecycleState,
      table.documentKind,
      table.documentVersion,
    ),
  ],
);

export const vendorDocumentReviews = marketplaceSchema.table(
  'vendor_document_reviews',
  {
    documentReviewId: uuid('document_review_id').primaryKey(),
    verificationDocumentId: uuid('verification_document_id').notNull(),
    reviewerUserId: uuid('reviewer_user_id').notNull(),
    previousState: text('previous_state').notNull(),
    resultingState: text('resulting_state').notNull(),
    decision: text('decision').notNull(),
    reasonCode: text('reason_code').notNull(),
    reviewerNote: text('reviewer_note').notNull(),
    evidenceReference: text('evidence_reference').notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('vendor_document_review_history').on(
      table.verificationDocumentId,
      table.occurredAt,
      table.documentReviewId,
    ),
  ],
);

export const vendorOnboardingAppeals = marketplaceSchema.table(
  'vendor_onboarding_appeals',
  {
    onboardingAppealId: uuid('onboarding_appeal_id').primaryKey(),
    onboardingCaseId: uuid('onboarding_case_id').notNull(),
    verificationDocumentId: uuid('verification_document_id'),
    submittedByUserId: uuid('submitted_by_user_id').notNull(),
    lifecycleState: text('lifecycle_state').default('SUBMITTED').notNull(),
    reasonCode: text('reason_code').notNull(),
    appealNote: text('appeal_note').notNull(),
    evidenceReference: text('evidence_reference'),
    reviewerUserId: uuid('reviewer_user_id'),
    reviewReasonCode: text('review_reason_code'),
    reviewerNote: text('reviewer_note'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    version: integer('version').default(1).notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('onboarding_appeals_case_state').on(
      table.onboardingCaseId,
      table.lifecycleState,
      table.createdAt,
      table.onboardingAppealId,
    ),
  ],
);

export const vendorOnboardingEvents = marketplaceSchema.table(
  'vendor_onboarding_events',
  {
    onboardingEventId: uuid('onboarding_event_id').primaryKey(),
    onboardingCaseId: uuid('onboarding_case_id').notNull(),
    caseVersion: integer('case_version').notNull(),
    eventType: text('event_type').notNull(),
    actorUserId: uuid('actor_user_id'),
    reasonCode: text('reason_code').notNull(),
    note: text('note'),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('onboarding_event_version_unique').on(table.onboardingCaseId, table.caseVersion),
    index('vendor_onboarding_event_history').on(
      table.onboardingCaseId,
      table.caseVersion,
      table.occurredAt,
    ),
  ],
);

export const vendorPublicationCases = marketplaceSchema.table(
  'vendor_publication_cases',
  {
    publicationCaseId: uuid('publication_case_id').primaryKey(),
    onboardingCaseId: uuid('onboarding_case_id').notNull(),
    vendorId: uuid('vendor_id').notNull(),
    vendorLocationId: uuid('vendor_location_id').notNull(),
    lifecycleState: text('lifecycle_state').default('DRAFT').notNull(),
    readinessSnapshot: jsonb('readiness_snapshot').default({}).notNull(),
    proposedByUserId: uuid('proposed_by_user_id').notNull(),
    approvedByUserId: uuid('approved_by_user_id'),
    currentReasonCode: text('current_reason_code').notNull(),
    currentNote: text('current_note').notNull(),
    version: integer('version').default(1).notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    unpublishedAt: timestamp('unpublished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('publication_onboarding_unique').on(table.onboardingCaseId),
    uniqueIndex('publication_vendor_unique').on(table.vendorId),
    uniqueIndex('publication_location_unique').on(table.vendorLocationId),
    index('vendor_publication_pipeline').on(
      table.lifecycleState,
      table.updatedAt,
      table.publicationCaseId,
    ),
  ],
);

export const vendorPublicationEvents = marketplaceSchema.table(
  'vendor_publication_events',
  {
    publicationEventId: uuid('publication_event_id').primaryKey(),
    publicationCaseId: uuid('publication_case_id').notNull(),
    caseVersion: integer('case_version').notNull(),
    eventType: text('event_type').notNull(),
    previousState: text('previous_state'),
    resultingState: text('resulting_state').notNull(),
    actorUserId: uuid('actor_user_id').notNull(),
    reasonCode: text('reason_code').notNull(),
    note: text('note').notNull(),
    evidenceReference: text('evidence_reference'),
    readinessSnapshot: jsonb('readiness_snapshot').notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('publication_event_version_unique').on(table.publicationCaseId, table.caseVersion),
    index('vendor_publication_event_history').on(
      table.publicationCaseId,
      table.caseVersion,
      table.occurredAt,
    ),
  ],
);

export const inventoryItems = marketplaceSchema.table(
  'inventory_items',
  {
    inventoryItemId: uuid('inventory_item_id').primaryKey(),
    vendorLocationId: uuid('vendor_location_id').notNull(),
    productReference: text('product_reference').notNull(),
    displayName: text('display_name').notNull(),
    quantityBasis: text('quantity_basis').notNull(),
    availabilityState: text('availability_state').notNull(),
    exactAvailableQuantity: bigint('exact_available_quantity', { mode: 'number' }),
    lowStockThreshold: bigint('low_stock_threshold', { mode: 'number' }),
    lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }).notNull(),
    version: integer('version').default(1).notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('inventory_item_location_product_unique').on(
      table.vendorLocationId,
      table.productReference,
    ),
    index('inventory_items_location_availability').on(
      table.vendorLocationId,
      table.availabilityState,
      table.updatedAt,
      table.inventoryItemId,
    ),
  ],
);

export const inventoryReservations = marketplaceSchema.table(
  'inventory_reservations',
  {
    reservationId: uuid('reservation_id').primaryKey(),
    inventoryItemId: uuid('inventory_item_id').notNull(),
    vendorLocationId: uuid('vendor_location_id').notNull(),
    sourceReference: text('source_reference').notNull(),
    reservationState: text('reservation_state').notNull(),
    quantity: bigint('quantity', { mode: 'number' }).notNull(),
    countedStockApplied: boolean('counted_stock_applied').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    version: integer('version').default(1).notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('inventory_reservation_source_unique').on(
      table.inventoryItemId,
      table.sourceReference,
    ),
    index('inventory_reservations_location_state').on(
      table.vendorLocationId,
      table.reservationState,
      table.updatedAt,
      table.reservationId,
    ),
    index('inventory_reservations_expiry')
      .on(table.expiresAt, table.reservationId)
      .where(sql`${table.reservationState} IN ('SOFT_HELD', 'PROVISIONAL')`),
  ],
);

export const inventoryEvents = marketplaceSchema.table(
  'inventory_events',
  {
    inventoryEventId: uuid('inventory_event_id').primaryKey(),
    inventoryItemId: uuid('inventory_item_id').notNull(),
    itemVersion: integer('item_version').notNull(),
    reservationId: uuid('reservation_id'),
    reservationVersion: integer('reservation_version'),
    eventType: text('event_type').notNull(),
    previousState: text('previous_state'),
    resultingState: text('resulting_state'),
    actorId: uuid('actor_id').notNull(),
    actorKind: text('actor_kind').notNull(),
    reasonCode: text('reason_code').notNull(),
    quantity: bigint('quantity', { mode: 'number' }),
    exactAvailableQuantity: bigint('exact_available_quantity', { mode: 'number' }),
    countedStockApplied: boolean('counted_stock_applied'),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    causationId: uuid('causation_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('inventory_event_item_version_unique').on(table.inventoryItemId, table.itemVersion),
    uniqueIndex('inventory_event_reservation_version_unique').on(
      table.reservationId,
      table.reservationVersion,
    ),
    index('inventory_events_item_history').on(
      table.inventoryItemId,
      table.itemVersion,
      table.occurredAt,
    ),
  ],
);

export const deliveryAssignments = marketplaceSchema.table(
  'delivery_assignments',
  {
    deliveryAssignmentId: uuid('delivery_assignment_id').primaryKey(),
    sourceOrderReference: text('source_order_reference').notNull(),
    vendorLocationId: uuid('vendor_location_id').notNull(),
    partnerUserId: uuid('partner_user_id'),
    assignmentState: text('assignment_state').notNull(),
    custodyState: text('custody_state').default('NONE').notNull(),
    packageCount: integer('package_count').notNull(),
    handlingFlags: text('handling_flags').array().default([]).notNull(),
    approximatePickupArea: text('approximate_pickup_area').notNull(),
    approximateDropArea: text('approximate_drop_area').notNull(),
    offerExpiresAt: timestamp('offer_expires_at', { withTimezone: true }),
    arrivalKind: text('arrival_kind'),
    arrivalDistanceMetres: integer('arrival_distance_metres'),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    arrivalClaimedAt: timestamp('arrival_claimed_at', { withTimezone: true }),
    arrivalClaimReason: text('arrival_claim_reason'),
    version: integer('version').default(1).notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('one_active_attempt_per_synthetic_order')
      .on(table.sourceOrderReference)
      .where(
        sql`${table.assignmentState} IN ('UNASSIGNED', 'OFFERED', 'ASSIGNED', 'AT_VENDOR', 'PICKED_UP', 'EN_ROUTE_TO_CUSTOMER', 'ARRIVED', 'DELIVERY_FAILED', 'RETURN_REQUIRED', 'RETURN_AUTHORIZED', 'RETURNING')`,
      ),
    index('delivery_assignments_partner_active').on(
      table.partnerUserId,
      table.updatedAt,
      table.deliveryAssignmentId,
    ),
  ],
);

export const assignmentEvents = marketplaceSchema.table(
  'assignment_events',
  {
    assignmentEventId: uuid('assignment_event_id').primaryKey(),
    deliveryAssignmentId: uuid('delivery_assignment_id').notNull(),
    assignmentVersion: integer('assignment_version').notNull(),
    eventType: text('event_type').notNull(),
    previousState: text('previous_state'),
    resultingState: text('resulting_state').notNull(),
    previousCustodyState: text('previous_custody_state'),
    resultingCustodyState: text('resulting_custody_state').notNull(),
    actorId: uuid('actor_id').notNull(),
    actorKind: text('actor_kind').notNull(),
    reasonCode: text('reason_code').notNull(),
    commandReference: text('command_reference').notNull(),
    proofReference: text('proof_reference'),
    packageCount: integer('package_count'),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    causationId: uuid('causation_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('assignment_event_version_unique').on(
      table.deliveryAssignmentId,
      table.assignmentVersion,
    ),
    uniqueIndex('assignment_events_command_reference_key').on(table.commandReference),
    index('assignment_events_history').on(
      table.deliveryAssignmentId,
      table.assignmentVersion,
      table.occurredAt,
    ),
  ],
);

export const custodyEvents = marketplaceSchema.table(
  'custody_events',
  {
    custodyEventId: uuid('custody_event_id').primaryKey(),
    deliveryAssignmentId: uuid('delivery_assignment_id').notNull(),
    sequence: integer('sequence').notNull(),
    custodyState: text('custody_state').notNull(),
    partnerUserId: uuid('partner_user_id').notNull(),
    packageCount: integer('package_count').notNull(),
    proofReference: text('proof_reference').notNull(),
    reasonCode: text('reason_code').notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('custody_event_sequence_unique').on(table.deliveryAssignmentId, table.sequence),
  ],
);

export const returnTasks = marketplaceSchema.table('return_tasks', {
  returnTaskId: uuid('return_task_id').primaryKey(),
  deliveryAssignmentId: uuid('delivery_assignment_id').notNull().unique(),
  returnState: text('return_state').notNull(),
  returnReasonCode: text('return_reason_code').notNull(),
  destinationReference: text('destination_reference'),
  expectedPackageCount: integer('expected_package_count').notNull(),
  proofReference: text('proof_reference'),
  authorizedByUserId: uuid('authorized_by_user_id'),
  version: integer('version').default(1).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const passwordCredentials = marketplaceSchema.table('password_credentials', {
  userId: uuid('user_id').primaryKey(),
  algorithm: text('algorithm').notNull(),
  parameters: jsonb('parameters').notNull(),
  hash: bytea('hash').notNull(),
  salt: bytea('salt').notNull(),
  version: integer('version').default(1).notNull(),
  setByUserId: uuid('set_by_user_id').notNull(),
  requestId: uuid('request_id').notNull(),
  correlationId: uuid('correlation_id').notNull(),
  dataClassification: text('data_classification').default('HIGHLY_RESTRICTED').notNull(),
  retentionClass: text('retention_class').default('ACCESS_CONTROL').notNull(),
  retentionReviewAt: timestamp('retention_review_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const passwordVerificationAttempts = marketplaceSchema.table(
  'password_verification_attempts',
  {
    attemptId: uuid('attempt_id').primaryKey(),
    phoneLookupHash: text('phone_lookup_hash').notNull(),
    outcome: text('outcome').notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('password_verification_attempts_rate').on(table.phoneLookupHash, table.attemptedAt),
  ],
);

export const supabaseIdentities = marketplaceSchema.table(
  'supabase_identities',
  {
    supabaseUserId: uuid('supabase_user_id').primaryKey(),
    userId: uuid('user_id').notNull(),
    email: text('email').notNull(),
    dataClassification: text('data_classification').default('HIGHLY_RESTRICTED').notNull(),
    retentionClass: text('retention_class').default('VERIFIED_IDENTITY').notNull(),
    retentionReviewAt: timestamp('retention_review_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('supabase_identities_user_unique').on(table.userId),
    index('supabase_identities_email').on(table.email),
  ],
);

export const adminProvisioningCommands = marketplaceSchema.table(
  'admin_provisioning_commands',
  {
    commandId: uuid('command_id').primaryKey(),
    actorUserId: uuid('actor_user_id').notNull(),
    commandScope: text('command_scope').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    resourceKind: text('resource_kind').notNull(),
    email: text('email').notNull(),
    state: text('state').default('PENDING').notNull(),
    supabaseUserId: uuid('supabase_user_id'),
    resultBody: jsonb('result_body'),
    errorCode: text('error_code'),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('admin_provisioning_command_unique').on(
      table.actorUserId,
      table.commandScope,
      table.idempotencyKey,
    ),
    uniqueIndex('admin_provisioning_supabase_user_unique')
      .on(table.supabaseUserId)
      .where(sql`${table.supabaseUserId} IS NOT NULL`),
    index('admin_provisioning_reconciliation')
      .on(table.updatedAt, table.commandId)
      .where(sql`${table.state} = 'RECONCILIATION_REQUIRED'`),
  ],
);

export const passwordCredentialEvents = marketplaceSchema.table(
  'password_credential_events',
  {
    eventId: uuid('event_id').primaryKey(),
    userId: uuid('user_id').notNull(),
    eventType: text('event_type').notNull(),
    resultingVersion: integer('resulting_version').notNull(),
    actorUserId: uuid('actor_user_id').notNull(),
    reasonCode: text('reason_code').notNull(),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('password_credential_events_version').on(table.userId, table.resultingVersion),
    index('password_credential_events_history').on(table.userId, table.occurredAt),
  ],
);

/**
 * A rating for the delivery, kept apart from the shop's own rating (0060).
 *
 * The two are separate services with separate liable parties, and one score
 * across both punishes a good shop for a late rider.
 */
export const deliveryAssignmentRatings = marketplaceSchema.table(
  'delivery_assignment_ratings',
  {
    deliveryAssignmentId: uuid('delivery_assignment_id').primaryKey(),
    customerUserId: uuid('customer_user_id').notNull(),
    partnerUserId: uuid('partner_user_id').notNull(),
    stars: smallint('stars').notNull(),
    reviewNote: text('review_note'),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('delivery_rating_stars', sql`${table.stars} BETWEEN 1 AND 5`),
    index('delivery_assignment_ratings_by_partner').on(table.partnerUserId, table.createdAt),
  ],
);

/** Road routes by rounded coordinate pair, so one order's quote, offer and settlement ask the provider once (0085). */
export const routeCache = marketplaceSchema.table(
  'route_cache',
  {
    routeCacheId: uuid('route_cache_id').primaryKey(),
    provider: text('provider').notNull(),
    profile: text('profile').notNull(),
    originKey: text('origin_key').notNull(),
    destinationKey: text('destination_key').notNull(),
    distanceMetres: integer('distance_metres').notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    check('route_cache_provider_allowed', sql`${table.provider} IN ('MAPBOX')`),
    check(
      'route_cache_amounts_sane',
      sql`${table.distanceMetres} >= 0 AND ${table.durationSeconds} >= 0`,
    ),
    check('route_cache_window', sql`${table.expiresAt} > ${table.computedAt}`),
    uniqueIndex('route_cache_pair_unique').on(
      table.provider,
      table.profile,
      table.originKey,
      table.destinationKey,
    ),
    index('route_cache_expiry').on(table.expiresAt),
  ],
);

/** A partner's renewed document, awaiting or past review (9.1, 0099). */
export const partnerDocumentRenewals = marketplaceSchema.table(
  'partner_document_renewals',
  {
    partnerDocumentRenewalId: uuid('partner_document_renewal_id').primaryKey(),
    partnerUserId: uuid('partner_user_id').notNull(),
    documentKind: text('document_kind').notNull(),
    documentReference: text('document_reference').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lifecycleState: text('lifecycle_state').notNull().default('SUBMITTED'),
    reviewerUserId: uuid('reviewer_user_id'),
    reasonCode: text('reason_code'),
    note: text('note'),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'partner_document_renewal_decision_shape',
      sql`(${table.lifecycleState} = 'SUBMITTED') = (${table.decidedAt} IS NULL AND ${table.reviewerUserId} IS NULL)`,
    ),
    uniqueIndex('partner_document_renewal_open')
      .on(table.partnerUserId, table.documentKind)
      .where(sql`${table.lifecycleState} = 'SUBMITTED'`),
    index('partner_document_renewals_queue').on(table.lifecycleState, table.createdAt),
  ],
);

/** What a partner displaced by a manual reassignment was owed (9.3, 0100). */
export const partnerAttemptCompensations = marketplaceSchema.table(
  'partner_attempt_compensations',
  {
    partnerAttemptCompensationId: uuid('partner_attempt_compensation_id').primaryKey(),
    deliveryAssignmentId: uuid('delivery_assignment_id').notNull(),
    partnerUserId: uuid('partner_user_id').notNull(),
    decidedByUserId: uuid('decided_by_user_id').notNull(),
    displacedFrom: text('displaced_from').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('INR'),
    reasonCode: text('reason_code').notNull(),
    note: text('note'),
    requestId: uuid('request_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'partner_attempt_compensations_displaced_from_check',
      sql`${table.displacedFrom} IN ('OFFERED', 'ASSIGNED', 'AT_VENDOR')`,
    ),
    index('partner_attempt_compensations_partner').on(table.partnerUserId, table.createdAt),
    index('partner_attempt_compensations_attempt').on(table.deliveryAssignmentId),
  ],
);
