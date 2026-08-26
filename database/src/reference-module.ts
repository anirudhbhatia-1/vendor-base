import {
  parseUuidV7,
  type ActorKind,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import type { Pool } from 'pg';
import {
  AggregateVersionConflictError,
  createVersionedAggregate,
  defineAggregatePolicy,
  transitionAggregate,
} from './aggregate-versioning.js';
import { readJobQueueMetrics, runDurableJobBatch, scheduleDurableJob } from './durable-jobs.js';
import { executeIdempotentCommand, type JsonObject } from './idempotency.js';
import {
  dispatchOutboxBatch,
  enqueueOutboxEvent,
  processInboxEvent,
} from './transactional-messaging.js';
import {
  resolveConfiguration,
  snapshotConfigurationVersions,
  type FeatureFlagSubject,
} from './versioned-configuration.js';

export const REFERENCE_CONFIGURATION_KEY = 'reference.processing_enabled';
export const REFERENCE_EVENT_TYPE = 'reference.submission_created';
export const REFERENCE_JOB_TYPE = 'reference.process_submission';
export const REFERENCE_QUEUE_SCOPE = 'reference.processing';
export const REFERENCE_CONSUMER_SCOPE = 'reference.submission_consumer';

export const referenceSubmissionPolicy = defineAggregatePolicy({
  aggregate_type: 'reference_submission',
  creation: {
    allowed_actor_kinds: ['customer'],
    allowed_initial_states: ['SUBMITTED'],
    reason: 'forbidden',
    required_evidence: ['configuration_version_id', 'synthetic_reference'],
  },
  states: ['SUBMITTED', 'PROCESSED', 'CANCELLED'],
  transitions: [
    {
      allowed_actor_kinds: ['system'],
      from_state: 'SUBMITTED',
      reason: 'forbidden',
      required_evidence: ['job_id'],
      to_state: 'PROCESSED',
    },
    {
      allowed_actor_kinds: ['system'],
      from_state: 'SUBMITTED',
      reason: 'required',
      required_evidence: ['conflict_probe'],
      to_state: 'CANCELLED',
    },
  ],
});

export class ReferenceConfigurationDisabledError extends Error {
  readonly code = 'BUSINESS_RULE_VIOLATION';

  constructor() {
    super('Synthetic reference processing is not enabled for this server-authoritative scope');
    this.name = 'ReferenceConfigurationDisabledError';
  }
}

function requireActor(context: RequestContext, expected: ActorKind): UuidV7 {
  if (!context.actor || context.actor.actor_kind !== expected) {
    throw new TypeError(`Reference flow requires an authenticated ${expected} actor`);
  }
  return parseUuidV7(context.actor.actor_id);
}

function requireSyntheticBody(value: unknown): JsonObject & {
  readonly label: string;
  readonly synthetic: true;
} {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as { synthetic?: unknown }).synthetic !== true ||
    typeof (value as { label?: unknown }).label !== 'string' ||
    (value as { label: string }).label.length < 1 ||
    (value as { label: string }).label.length > 120
  ) {
    throw new TypeError('Reference submission must contain a bounded synthetic label');
  }
  return Object.freeze({
    label: (value as { label: string }).label,
    synthetic: true,
  });
}

export async function executeReferenceSubmission(
  pool: Pool,
  input: {
    readonly aggregate_id: string;
    readonly context: RequestContext;
    readonly idempotency_key: string;
    readonly request_body: unknown;
    readonly subject?: FeatureFlagSubject;
  },
) {
  const actorId = requireActor(input.context, 'customer');
  const aggregateId = parseUuidV7(input.aggregate_id);
  const body = requireSyntheticBody(input.request_body);
  return executeIdempotentCommand(
    pool,
    {
      actor_id: actorId,
      command_scope: 'reference.submit',
      idempotency_key: input.idempotency_key,
      request_body: { aggregate_id: aggregateId, body },
      request_id: input.context.request_id,
    },
    async () => {
      const initiallyResolved = await resolveConfiguration(pool, {
        configuration_key: REFERENCE_CONFIGURATION_KEY,
        configuration_kind: 'FEATURE_FLAG',
        ...(input.subject ? { subject: input.subject } : {}),
      });
      if (!initiallyResolved || initiallyResolved.configuration_value !== true) {
        throw new ReferenceConfigurationDisabledError();
      }
      const created = await createVersionedAggregate(
        pool,
        referenceSubmissionPolicy,
        {
          actor_id: actorId,
          actor_kind: 'customer',
          aggregate_id: aggregateId,
          causation_id: input.context.causation_id,
          correlation_id: input.context.correlation_id,
          evidence: {
            configuration_version_id: initiallyResolved.configuration_version_id,
            synthetic_reference: body.label,
          },
          initial_state: 'SUBMITTED',
          request_id: input.context.request_id,
        },
        async (client, resultingVersion) => {
          const transactionResolution = await resolveConfiguration(client, {
            configuration_key: REFERENCE_CONFIGURATION_KEY,
            configuration_kind: 'FEATURE_FLAG',
            ...(input.subject ? { subject: input.subject } : {}),
          });
          if (
            !transactionResolution ||
            transactionResolution.configuration_value !== true ||
            transactionResolution.configuration_version_id !==
              initiallyResolved.configuration_version_id
          ) {
            throw new ReferenceConfigurationDisabledError();
          }
          await snapshotConfigurationVersions(client, {
            business_record_id: aggregateId,
            business_record_type: 'reference_submission',
            versions: [
              {
                configuration_key: transactionResolution.configuration_key,
                configuration_version_id: transactionResolution.configuration_version_id,
              },
            ],
          });
          await enqueueOutboxEvent(client, {
            aggregate_id: aggregateId,
            aggregate_type: referenceSubmissionPolicy.aggregate_type,
            aggregate_version: resultingVersion,
            causation_id: input.context.causation_id,
            correlation_id: input.context.correlation_id,
            event_type: REFERENCE_EVENT_TYPE,
            payload: {
              aggregate_id: aggregateId,
              configuration_version_id: transactionResolution.configuration_version_id,
              synthetic: true,
            },
            request_id: input.context.request_id,
          });
        },
      );
      return {
        kind: 'completed' as const,
        http_status: 201,
        response_body: {
          aggregate_id: created.aggregate_id,
          state: created.state,
          version: created.version,
        },
      };
    },
  );
}

export async function dispatchReferenceEvents(pool: Pool, input: { readonly worker_id: string }) {
  const workerId = parseUuidV7(input.worker_id);
  return dispatchOutboxBatch(pool, {
    batch_size: 25,
    publish: async (event) => {
      if (event.event_type !== REFERENCE_EVENT_TYPE) {
        throw new TypeError('Reference dispatcher received an unsupported event type');
      }
      await processInboxEvent(
        pool,
        {
          consumer_scope: REFERENCE_CONSUMER_SCOPE,
          correlation_id: event.correlation_id,
          event_id: event.event_id,
          request_id: event.request_id,
        },
        async (client) => {
          await scheduleDurableJob(client, {
            causation_id: event.event_id,
            correlation_id: event.correlation_id,
            idempotency_key: `event:${event.event_id}`,
            job_type: REFERENCE_JOB_TYPE,
            payload: {
              aggregate_id: event.aggregate_id,
              event_id: event.event_id,
              synthetic: true,
            },
            queue_scope: REFERENCE_QUEUE_SCOPE,
            request_id: event.request_id,
            run_at: new Date(),
          });
        },
      );
    },
    worker_id: workerId,
  });
}

export async function runReferenceJobs(
  pool: Pool,
  input: {
    readonly system_actor_id: string;
    readonly worker_id: string;
  },
) {
  const systemActorId = parseUuidV7(input.system_actor_id);
  const workerId = parseUuidV7(input.worker_id);
  return runDurableJobBatch(pool, {
    batch_size: 25,
    handler: async (job) => {
      if (job.job_type !== REFERENCE_JOB_TYPE) {
        throw new TypeError('Reference worker received an unsupported job type');
      }
      const aggregateId = job.payload.aggregate_id;
      if (typeof aggregateId !== 'string')
        throw new TypeError('Reference job aggregate is invalid');
      try {
        await transitionAggregate(pool, referenceSubmissionPolicy, {
          actor_id: systemActorId,
          actor_kind: 'system',
          aggregate_id: aggregateId,
          causation_id: job.job_id,
          correlation_id: job.correlation_id,
          evidence: { job_id: job.job_id },
          expected_version: 1,
          request_id: job.request_id,
          to_state: 'PROCESSED',
        });
      } catch (error: unknown) {
        if (
          !(error instanceof AggregateVersionConflictError) ||
          error.current_state !== 'PROCESSED'
        ) {
          throw error;
        }
      }
    },
    queue_scope: REFERENCE_QUEUE_SCOPE,
    worker_id: workerId,
  });
}

export async function transitionReferenceForConflictProbe(
  pool: Pool,
  input: {
    readonly aggregate_id: string;
    readonly context: RequestContext;
    readonly to_state: 'CANCELLED' | 'PROCESSED';
  },
) {
  const actorId = requireActor(input.context, 'system');
  return transitionAggregate(pool, referenceSubmissionPolicy, {
    actor_id: actorId,
    actor_kind: 'system',
    aggregate_id: input.aggregate_id,
    causation_id: input.context.causation_id,
    correlation_id: input.context.correlation_id,
    evidence:
      input.to_state === 'PROCESSED'
        ? { job_id: input.context.causation_id ?? input.context.request_id }
        : { conflict_probe: true },
    expected_version: 1,
    ...(input.to_state === 'CANCELLED' ? { reason_code: 'SYNTHETIC_CONFLICT_PROBE' } : {}),
    request_id: input.context.request_id,
    to_state: input.to_state,
  });
}

export async function readReferenceEvidence(
  pool: Pool,
  input: {
    readonly aggregate_id: string;
    readonly correlation_id: string;
    readonly request_id: string;
  },
) {
  const aggregateId = parseUuidV7(input.aggregate_id);
  const correlationId = parseUuidV7(input.correlation_id);
  const result = await pool.query<{
    aggregate_state: string;
    aggregate_version: number;
    all_correlated: boolean;
    all_requested: boolean;
    idempotency_count: number;
    inbox_count: number;
    job_count: number;
    outbox_count: number;
    snapshot_count: number;
    transition_count: number;
  }>(
    `SELECT head.state AS aggregate_state, head.version AS aggregate_version,
       (SELECT count(*)::int FROM marketplace.aggregate_transitions transition
         WHERE transition.aggregate_type = 'reference_submission'
           AND transition.aggregate_id = head.aggregate_id) AS transition_count,
       (SELECT count(*)::int FROM marketplace.outbox_events event
         WHERE event.aggregate_type = 'reference_submission'
           AND event.aggregate_id = head.aggregate_id) AS outbox_count,
       (SELECT count(*)::int FROM marketplace.scheduled_jobs job
         WHERE job.queue_scope = $4
           AND job.payload->>'aggregate_id' = head.aggregate_id::text) AS job_count,
       (SELECT count(*)::int FROM marketplace.inbox_receipts receipt
         JOIN marketplace.outbox_events event ON event.event_id = receipt.event_id
        WHERE event.aggregate_type = 'reference_submission'
          AND event.aggregate_id = head.aggregate_id) AS inbox_count,
       (SELECT count(*)::int FROM marketplace.business_configuration_snapshots snapshot
         WHERE snapshot.business_record_type = 'reference_submission'
           AND snapshot.business_record_id = head.aggregate_id) AS snapshot_count,
       (SELECT count(*)::int FROM marketplace.idempotency_records command
         WHERE command.command_scope = 'reference.submit' AND command.request_id = $3)
         AS idempotency_count,
       NOT EXISTS (
         SELECT 1 FROM (
           SELECT transition.correlation_id, transition.request_id
             FROM marketplace.aggregate_transitions transition
            WHERE transition.aggregate_type = 'reference_submission'
              AND transition.aggregate_id = head.aggregate_id
           UNION ALL
           SELECT event.correlation_id, event.request_id
             FROM marketplace.outbox_events event
            WHERE event.aggregate_type = 'reference_submission'
              AND event.aggregate_id = head.aggregate_id
           UNION ALL
           SELECT job.correlation_id, job.request_id
             FROM marketplace.scheduled_jobs job
            WHERE job.queue_scope = $4
              AND job.payload->>'aggregate_id' = head.aggregate_id::text
           UNION ALL
           SELECT receipt.correlation_id, receipt.request_id
             FROM marketplace.inbox_receipts receipt
             JOIN marketplace.outbox_events event ON event.event_id = receipt.event_id
            WHERE event.aggregate_type = 'reference_submission'
              AND event.aggregate_id = head.aggregate_id
         ) evidence WHERE evidence.correlation_id <> $2
       ) AS all_correlated,
       NOT EXISTS (
         SELECT 1 FROM (
           SELECT transition.request_id
             FROM marketplace.aggregate_transitions transition
            WHERE transition.aggregate_type = 'reference_submission'
              AND transition.aggregate_id = head.aggregate_id
           UNION ALL
           SELECT event.request_id
             FROM marketplace.outbox_events event
            WHERE event.aggregate_type = 'reference_submission'
              AND event.aggregate_id = head.aggregate_id
           UNION ALL
           SELECT job.request_id
             FROM marketplace.scheduled_jobs job
            WHERE job.queue_scope = $4
              AND job.payload->>'aggregate_id' = head.aggregate_id::text
           UNION ALL
           SELECT receipt.request_id
             FROM marketplace.inbox_receipts receipt
             JOIN marketplace.outbox_events event ON event.event_id = receipt.event_id
            WHERE event.aggregate_type = 'reference_submission'
              AND event.aggregate_id = head.aggregate_id
           UNION ALL
           SELECT command.request_id
             FROM marketplace.idempotency_records command
            WHERE command.command_scope = 'reference.submit' AND command.request_id = $3
         ) evidence WHERE evidence.request_id <> $3
       ) AS all_requested
      FROM marketplace.aggregate_heads head
     WHERE head.aggregate_type = 'reference_submission' AND head.aggregate_id = $1`,
    [aggregateId, correlationId, input.request_id, REFERENCE_QUEUE_SCOPE],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Reference aggregate evidence was not found');
  return Object.freeze({
    ...row,
    queue_metrics: await readJobQueueMetrics(pool, REFERENCE_QUEUE_SCOPE),
  });
}
