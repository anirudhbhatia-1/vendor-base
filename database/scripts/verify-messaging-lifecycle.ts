import { createRequestId, createUuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  createVersionedAggregate,
  defineAggregatePolicy,
  transitionAggregate,
} from '../src/aggregate-versioning.js';
import {
  claimOutboxBatch,
  dispatchOutboxBatch,
  enqueueOutboxEvent,
  listDeadLetterEvents,
  processInboxEvent,
  recoverDeadLetterEvent,
} from '../src/transactional-messaging.js';

export async function verifyTransactionalMessaging(connectionString: string): Promise<void> {
  const pool = new Pool({
    application_name: 'neighbourhood-store-test-messaging-verifier',
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 12,
    query_timeout: 30_000,
    statement_timeout: 30_000,
  });
  const systemActorId = createUuidV7();
  const recoveryActorId = createUuidV7();
  const policy = defineAggregatePolicy({
    aggregate_type: 'messaging_probe',
    creation: {
      allowed_actor_kinds: ['system'],
      allowed_initial_states: ['CREATED'],
      reason: 'forbidden',
      required_evidence: ['probe_reference'],
    },
    states: ['CREATED', 'CHANGED'],
    transitions: [
      {
        allowed_actor_kinds: ['system'],
        from_state: 'CREATED',
        reason: 'forbidden',
        required_evidence: ['probe_reference'],
        to_state: 'CHANGED',
      },
    ],
  });

  const createProbeEvent = async (label: string, maxAttempts = 8) => {
    const aggregateId = createUuidV7();
    await createVersionedAggregate(pool, policy, {
      actor_id: systemActorId,
      actor_kind: 'system',
      aggregate_id: aggregateId,
      correlation_id: createUuidV7(),
      evidence: { probe_reference: label },
      initial_state: 'CREATED',
      request_id: createRequestId(),
    });
    const requestId = createRequestId();
    const correlationId = createUuidV7();
    let eventId: string | undefined;
    await transitionAggregate(
      pool,
      policy,
      {
        actor_id: systemActorId,
        actor_kind: 'system',
        aggregate_id: aggregateId,
        correlation_id: correlationId,
        evidence: { probe_reference: label },
        expected_version: 1,
        request_id: requestId,
        to_state: 'CHANGED',
      },
      async (client, resultingVersion) => {
        eventId = await enqueueOutboxEvent(client, {
          aggregate_id: aggregateId,
          aggregate_type: policy.aggregate_type,
          aggregate_version: resultingVersion,
          correlation_id: correlationId,
          event_type: 'messaging_probe.changed',
          max_attempts: maxAttempts,
          payload: { probe_reference: label },
          request_id: requestId,
        });
      },
    );
    if (!eventId) throw new Error('Committed transition did not create an outbox event');
    return { aggregateId, eventId };
  };

  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS marketplace_test`);
    await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_test.inbox_effects (
      event_id uuid PRIMARY KEY,
      effect_count integer NOT NULL
    )`);

    const rollbackAggregateId = createUuidV7();
    await createVersionedAggregate(pool, policy, {
      actor_id: systemActorId,
      actor_kind: 'system',
      aggregate_id: rollbackAggregateId,
      correlation_id: createUuidV7(),
      evidence: { probe_reference: 'ROLLBACK' },
      initial_state: 'CREATED',
      request_id: createRequestId(),
    });
    let rolledBack = false;
    try {
      const requestId = createRequestId();
      const correlationId = createUuidV7();
      await transitionAggregate(
        pool,
        policy,
        {
          actor_id: systemActorId,
          actor_kind: 'system',
          aggregate_id: rollbackAggregateId,
          correlation_id: correlationId,
          evidence: { probe_reference: 'ROLLBACK' },
          expected_version: 1,
          request_id: requestId,
          to_state: 'CHANGED',
        },
        async (client, resultingVersion) => {
          await enqueueOutboxEvent(client, {
            aggregate_id: rollbackAggregateId,
            aggregate_type: policy.aggregate_type,
            aggregate_version: resultingVersion,
            correlation_id: correlationId,
            event_type: 'messaging_probe.changed',
            payload: { probe_reference: 'ROLLBACK' },
            request_id: requestId,
          });
          throw new Error('Synthetic transaction rollback');
        },
      );
    } catch {
      rolledBack = true;
    }
    const rollbackState = await pool.query<{ event_count: string; version: number }>(
      `SELECT h.version,
              (SELECT count(*)::text FROM marketplace.outbox_events event
                WHERE event.aggregate_id = h.aggregate_id) AS event_count
         FROM marketplace.aggregate_heads h
        WHERE h.aggregate_type = $1 AND h.aggregate_id = $2`,
      [policy.aggregate_type, rollbackAggregateId],
    );
    if (
      !rolledBack ||
      rollbackState.rows[0]?.version !== 1 ||
      rollbackState.rows[0].event_count !== '0'
    ) {
      throw new Error('Business transition and outbox event did not roll back atomically');
    }

    const batchEvents = await Promise.all([
      createProbeEvent('BATCH-1'),
      createProbeEvent('BATCH-2'),
      createProbeEvent('BATCH-3'),
      createProbeEvent('BATCH-4'),
    ]);
    const firstWorkerId = createUuidV7();
    const secondWorkerId = createUuidV7();
    const [firstClaims, secondClaims] = await Promise.all([
      claimOutboxBatch(pool, { batch_size: 2, worker_id: firstWorkerId }),
      claimOutboxBatch(pool, { batch_size: 2, worker_id: secondWorkerId }),
    ]);
    const claimedIds = new Set([...firstClaims, ...secondClaims].map((event) => event.event_id));
    if (firstClaims.length !== 2 || secondClaims.length !== 2 || claimedIds.size !== 4) {
      throw new Error('Bounded concurrent outbox claims overlapped or exceeded batch size');
    }
    await pool.query(
      `UPDATE marketplace.outbox_events
          SET status = 'PUBLISHED', claimed_by = NULL, claim_until = NULL,
              published_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE event_id = ANY($1::uuid[])`,
      [batchEvents.map((event) => event.eventId)],
    );

    const retryEvent = await createProbeEvent('RETRY-DEAD-LETTER', 2);
    const retryWorkerId = createUuidV7();
    const firstFailure = await dispatchOutboxBatch(pool, {
      backoff_base_ms: 10,
      backoff_max_ms: 100,
      batch_size: 1,
      classify_error: () => 'SYNTHETIC_PROVIDER_DOWN',
      publish: async () => {
        throw new Error('Synthetic provider detail that must not be stored');
      },
      worker_id: retryWorkerId,
    });
    if (firstFailure.scheduled_for_retry !== 1 || firstFailure.dead_lettered !== 0) {
      throw new Error('Failed outbox dispatch did not schedule bounded retry');
    }
    await pool.query(
      `UPDATE marketplace.outbox_events SET available_at = clock_timestamp()
        WHERE event_id = $1`,
      [retryEvent.eventId],
    );
    const secondFailure = await dispatchOutboxBatch(pool, {
      backoff_base_ms: 10,
      backoff_max_ms: 100,
      batch_size: 1,
      classify_error: () => 'SYNTHETIC_PROVIDER_DOWN',
      publish: async () => {
        throw new Error('Synthetic provider remains unavailable');
      },
      worker_id: retryWorkerId,
    });
    const deadLetters = await listDeadLetterEvents(pool, 10);
    if (
      secondFailure.dead_lettered !== 1 ||
      deadLetters.length !== 1 ||
      deadLetters[0]?.event_id !== retryEvent.eventId ||
      deadLetters[0].last_error_code !== 'SYNTHETIC_PROVIDER_DOWN'
    ) {
      throw new Error('Retry exhaustion did not expose a bounded safe dead letter');
    }
    await recoverDeadLetterEvent(pool, {
      actor_id: recoveryActorId,
      event_id: retryEvent.eventId,
      reason_code: 'PROVIDER_RESTORED',
      request_id: createRequestId(),
    });
    const recovered = await pool.query<{
      attempt_count: number;
      previous_attempt_count: number;
      recovery_count: string;
      status: string;
    }>(
      `SELECT event.status, event.attempt_count, recovery.previous_attempt_count,
              (SELECT count(*)::text FROM marketplace.outbox_recoveries all_recoveries
                WHERE all_recoveries.event_id = event.event_id) AS recovery_count
         FROM marketplace.outbox_events event
         JOIN marketplace.outbox_recoveries recovery ON recovery.event_id = event.event_id
        WHERE event.event_id = $1`,
      [retryEvent.eventId],
    );
    if (
      recovered.rows[0]?.status !== 'PENDING' ||
      recovered.rows[0].attempt_count !== 0 ||
      recovered.rows[0].previous_attempt_count !== 2 ||
      recovered.rows[0].recovery_count !== '1'
    ) {
      throw new Error('Dead-letter recovery was not reset and attributed correctly');
    }
    const recoveredDispatch = await dispatchOutboxBatch(pool, {
      batch_size: 1,
      publish: async () => undefined,
      worker_id: createUuidV7(),
    });
    if (recoveredDispatch.published !== 1) {
      throw new Error('Recovered dead letter did not return to normal dispatch');
    }

    const inboxEvent = await createProbeEvent('INBOX-DEDUPE');
    let handlerExecutions = 0;
    const inboxDispatch = await dispatchOutboxBatch(pool, {
      batch_size: 1,
      publish: async (event) => {
        const results = await Promise.all([
          processInboxEvent(
            pool,
            {
              consumer_scope: 'synthetic_projection.apply',
              correlation_id: createUuidV7(),
              event_id: event.event_id,
              request_id: createRequestId(),
            },
            async (client) => {
              handlerExecutions += 1;
              await client.query(
                `INSERT INTO marketplace_test.inbox_effects (event_id, effect_count)
                 VALUES ($1, 1)`,
                [event.event_id],
              );
              return 'applied';
            },
          ),
          processInboxEvent(
            pool,
            {
              consumer_scope: 'synthetic_projection.apply',
              correlation_id: createUuidV7(),
              event_id: event.event_id,
              request_id: createRequestId(),
            },
            async () => {
              handlerExecutions += 1;
              return 'duplicate-handler-ran';
            },
          ),
        ]);
        if (results.filter((result) => result.processed).length !== 1) {
          throw new Error('Concurrent inbox receipts did not choose exactly one processor');
        }
      },
      worker_id: createUuidV7(),
    });
    const inboxState = await pool.query<{
      effect_count: string;
      receipt_count: string;
      status: string;
    }>(
      `SELECT event.status,
              (SELECT count(*)::text FROM marketplace.inbox_receipts receipt
                WHERE receipt.event_id = event.event_id) AS receipt_count,
              (SELECT count(*)::text FROM marketplace_test.inbox_effects effect
                WHERE effect.event_id = event.event_id) AS effect_count
         FROM marketplace.outbox_events event
        WHERE event.event_id = $1`,
      [inboxEvent.eventId],
    );
    if (
      inboxDispatch.published !== 1 ||
      handlerExecutions !== 1 ||
      inboxState.rows[0]?.status !== 'PUBLISHED' ||
      inboxState.rows[0].receipt_count !== '1' ||
      inboxState.rows[0].effect_count !== '1'
    ) {
      throw new Error('Inbox deduplication did not preserve exactly one database effect');
    }

    let immutableRejected = false;
    try {
      await pool.query(
        `UPDATE marketplace.outbox_events SET payload = '{"tampered":true}'::jsonb
          WHERE event_id = $1`,
        [inboxEvent.eventId],
      );
    } catch (error: unknown) {
      immutableRejected =
        typeof error === 'object' && error !== null && 'code' in error && error.code === '55000';
    }
    if (!immutableRejected) throw new Error('Outbox event content accepted mutation');

    let deletionRejected = false;
    try {
      await pool.query(`DELETE FROM marketplace.outbox_events WHERE event_id = $1`, [
        batchEvents[0]?.eventId,
      ]);
    } catch {
      deletionRejected = true;
    }
    const durableEvent = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM marketplace.outbox_events WHERE event_id = $1
       ) AS exists`,
      [batchEvents[0]?.eventId],
    );
    if (!deletionRejected || !durableEvent.rows[0]?.exists) {
      throw new Error('Durable outbox history accepted deletion');
    }
  } finally {
    await pool.end();
  }
}
