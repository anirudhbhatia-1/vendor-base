import {
  createAuthenticatedActor,
  createRequestContext,
  createRequestId,
  createUuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  AggregateVersionConflictError,
  createVersionedAggregate,
} from '../src/aggregate-versioning.js';
import {
  activateConfigurationVersion,
  approveConfigurationVersion,
  createConfigurationDraft,
  scheduleConfigurationVersion,
  validateConfigurationVersion,
} from '../src/versioned-configuration.js';
import { enqueueOutboxEvent } from '../src/transactional-messaging.js';
import {
  dispatchReferenceEvents,
  executeReferenceSubmission,
  readReferenceEvidence,
  REFERENCE_CONFIGURATION_KEY,
  referenceSubmissionPolicy,
  runReferenceJobs,
  transitionReferenceForConflictProbe,
} from '../src/reference-module.js';

export async function verifyReferenceModule(connectionString: string): Promise<void> {
  const pool = new Pool({
    application_name: 'neighbourhood-store-test-reference-module-verifier',
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 12,
    query_timeout: 30_000,
    statement_timeout: 30_000,
  });
  const proposerId = createUuidV7();
  const validatorId = createUuidV7();
  const approverId = createUuidV7();
  const systemActorId = createUuidV7();
  const workerId = createUuidV7();
  const customerActor = createAuthenticatedActor({
    actor_id: createUuidV7(),
    actor_kind: 'customer',
    session_id: createUuidV7(),
  });
  const systemActor = createAuthenticatedActor({
    actor_id: systemActorId,
    actor_kind: 'system',
    session_id: createUuidV7(),
  });

  try {
    const flagDraft = await createConfigurationDraft(pool, {
      actor_id: proposerId,
      configuration_key: REFERENCE_CONFIGURATION_KEY,
      configuration_kind: 'FEATURE_FLAG',
      configuration_value: true,
      correlation_id: createUuidV7(),
      request_id: createRequestId(),
      scope: { kind: 'GLOBAL', reference: 'global' },
    });
    await validateConfigurationVersion(pool, {
      actor_id: validatorId,
      configuration_version_id: flagDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    await approveConfigurationVersion(pool, {
      actor_id: approverId,
      configuration_version_id: flagDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    await scheduleConfigurationVersion(pool, {
      actor_id: approverId,
      configuration_version_id: flagDraft.configuration_version_id,
      effective_from: new Date(Date.now() - 1_000),
      request_id: createRequestId(),
    });
    await activateConfigurationVersion(pool, {
      actor_id: approverId,
      configuration_version_id: flagDraft.configuration_version_id,
      request_id: createRequestId(),
    });

    const requestContext = createRequestContext({ actor: customerActor });
    const aggregateId = createUuidV7();
    const commandInput = {
      aggregate_id: aggregateId,
      context: requestContext,
      idempotency_key: 'reference-submit-0001',
      request_body: { label: 'SYNTH-REFERENCE-PRIMARY', synthetic: true },
    } as const;
    const submitted = await executeReferenceSubmission(pool, commandInput);
    const replay = await executeReferenceSubmission(pool, commandInput);
    if (
      submitted.status !== 'SUCCEEDED' ||
      submitted.http_status !== 201 ||
      submitted.replayed ||
      !replay.replayed ||
      JSON.stringify(submitted.response_body) !== JSON.stringify(replay.response_body)
    ) {
      throw new Error('Reference command did not replay its original result idempotently');
    }

    const dispatch = await dispatchReferenceEvents(pool, { worker_id: workerId });
    if (dispatch.claimed !== 1 || dispatch.published !== 1) {
      throw new Error('Reference outbox event was not consumed exactly once');
    }
    const jobRun = await runReferenceJobs(pool, {
      system_actor_id: systemActorId,
      worker_id: workerId,
    });
    if (jobRun.claimed !== 1 || jobRun.succeeded !== 1 || jobRun.retried !== 0) {
      throw new Error('Reference durable job did not complete its state transition');
    }
    const emptyJobRun = await runReferenceJobs(pool, {
      system_actor_id: systemActorId,
      worker_id: workerId,
    });
    if (emptyJobRun.claimed !== 0) throw new Error('Completed reference job was claimed again');

    const evidence = await readReferenceEvidence(pool, {
      aggregate_id: aggregateId,
      correlation_id: requestContext.correlation_id,
      request_id: requestContext.request_id,
    });
    if (
      evidence.aggregate_state !== 'PROCESSED' ||
      evidence.aggregate_version !== 2 ||
      evidence.transition_count !== 2 ||
      evidence.outbox_count !== 1 ||
      evidence.inbox_count !== 1 ||
      evidence.idempotency_count !== 1 ||
      evidence.job_count !== 1 ||
      evidence.snapshot_count !== 1 ||
      !evidence.all_correlated ||
      !evidence.all_requested ||
      evidence.queue_metrics.completed_last_hour < 1 ||
      evidence.queue_metrics.failed_attempts_last_hour !== 0
    ) {
      throw new Error('Reference evidence did not preserve state, metrics, or audit correlation');
    }

    const conflictAggregateId = createUuidV7();
    const conflictCustomerContext = createRequestContext({ actor: customerActor });
    await executeReferenceSubmission(pool, {
      aggregate_id: conflictAggregateId,
      context: conflictCustomerContext,
      idempotency_key: 'reference-conflict-0001',
      request_body: { label: 'SYNTH-REFERENCE-CONFLICT', synthetic: true },
    });
    const conflictContext = createRequestContext({
      actor: systemActor,
      correlation_id: conflictCustomerContext.correlation_id,
    });
    const conflictResults = await Promise.allSettled([
      transitionReferenceForConflictProbe(pool, {
        aggregate_id: conflictAggregateId,
        context: conflictContext,
        to_state: 'PROCESSED',
      }),
      transitionReferenceForConflictProbe(pool, {
        aggregate_id: conflictAggregateId,
        context: conflictContext,
        to_state: 'CANCELLED',
      }),
    ]);
    const winners = conflictResults.filter((result) => result.status === 'fulfilled');
    const conflicts = conflictResults.filter(
      (result) =>
        result.status === 'rejected' && result.reason instanceof AggregateVersionConflictError,
    );
    if (winners.length !== 1 || conflicts.length !== 1) {
      throw new Error('Reference expected-version conflict did not produce exactly one winner');
    }

    const rollbackAggregateId = createUuidV7();
    const rollbackContext = createRequestContext({ actor: customerActor });
    let transactionFailed = false;
    try {
      await createVersionedAggregate(
        pool,
        referenceSubmissionPolicy,
        {
          actor_id: customerActor.actor_id,
          actor_kind: 'customer',
          aggregate_id: rollbackAggregateId,
          correlation_id: rollbackContext.correlation_id,
          evidence: {
            configuration_version_id: flagDraft.configuration_version_id,
            synthetic_reference: 'SYNTH-REFERENCE-ROLLBACK',
          },
          initial_state: 'SUBMITTED',
          request_id: rollbackContext.request_id,
        },
        async (client, resultingVersion) => {
          await enqueueOutboxEvent(client, {
            aggregate_id: rollbackAggregateId,
            aggregate_type: referenceSubmissionPolicy.aggregate_type,
            aggregate_version: resultingVersion,
            correlation_id: rollbackContext.correlation_id,
            event_type: 'reference.rollback_probe',
            payload: { synthetic: true },
            request_id: rollbackContext.request_id,
          });
          throw new Error('Synthetic transaction rollback');
        },
      );
    } catch {
      transactionFailed = true;
    }
    const rollbackEvidence = await pool.query<{
      heads: string;
      outbox: string;
      transitions: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM marketplace.aggregate_heads
           WHERE aggregate_type = 'reference_submission' AND aggregate_id = $1) AS heads,
         (SELECT count(*)::text FROM marketplace.aggregate_transitions
           WHERE aggregate_type = 'reference_submission' AND aggregate_id = $1) AS transitions,
         (SELECT count(*)::text FROM marketplace.outbox_events
           WHERE aggregate_type = 'reference_submission' AND aggregate_id = $1) AS outbox`,
      [rollbackAggregateId],
    );
    if (
      !transactionFailed ||
      rollbackEvidence.rows[0]?.heads !== '0' ||
      rollbackEvidence.rows[0].transitions !== '0' ||
      rollbackEvidence.rows[0].outbox !== '0'
    ) {
      throw new Error('Reference transaction failure left partial aggregate or outbox state');
    }
  } finally {
    await pool.end();
  }
}
