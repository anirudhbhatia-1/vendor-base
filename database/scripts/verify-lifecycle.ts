import { createRequestId, createUuidV7 } from '@neighbourhood-store/domain-types';
import { Pool, type Client } from 'pg';
import { withDatabaseClient } from '../src/client.js';
import { takeAssertionCount } from './verify-support.js';
import { loadDatabaseConfig } from '../src/config.js';
import { createDatabasePool } from '../src/database-pool.js';
import {
  expectedFixtureHash,
  readFixtureHash,
  resetFixtures,
  seedFixtures,
} from '../src/fixtures.js';
import { migrateDown, migrateUp, migrationStatus } from '../src/migrations.js';
import { writeEvent } from '../src/output.js';
import { rebuildDatabase } from '../src/rebuild.js';
import {
  executeIdempotentCommand,
  IdempotencyKeyReusedError,
  canonicalRequestHash,
  reconcileUncertainCommand,
} from '../src/idempotency.js';
import {
  AggregateTransitionRejectedError,
  AggregateVersionConflictError,
  createVersionedAggregate,
  defineAggregatePolicy,
  transitionAggregate,
} from '../src/aggregate-versioning.js';
import { verifyTransactionalMessaging } from './verify-messaging-lifecycle.js';
import { verifyDurableJobs } from './verify-jobs-lifecycle.js';
import { verifyVersionedConfiguration } from './verify-configuration-lifecycle.js';
import { verifyReferenceModule } from './verify-reference-module.js';
import { verifyOtpIdentity } from './verify-otp-identity.js';
import { verifyIdentitySessions } from './verify-identity-sessions.js';
import { verifyIdentityAccess } from './verify-identity-access.js';
import { verifyIdentityPreferences } from './verify-identity-preferences.js';
import { verifyVendorNetwork } from './verify-vendor-network.js';
import { verifyVendorOnboarding } from './verify-vendor-onboarding.js';
import { verifyVendorPublication } from './verify-vendor-publication.js';
import { verifyInventoryReservations } from './verify-inventory-reservations.js';
import { verifyAssignmentCustody } from './verify-assignment-custody.js';
import { verifyMoneyLifecycle } from './verify-money-lifecycle.js';
import { verifyPartnerPayouts } from './verify-partner-payouts.js';
import { verifyStatementReconciliation } from './verify-statement-reconciliation.js';
import { verifyFinancialCorrections } from './verify-financial-corrections.js';
import { auditMoneyConservation } from '../src/money-conservation.js';
import { verifyMoneyConservation } from './verify-money-conservation.js';
import { verifyAdminDashboard } from './verify-admin-dashboard.js';
import { verifyOrderMonitor } from './verify-order-monitor.js';
import { verifySupportCases } from './verify-support-cases.js';
import { verifyTrustReview } from './verify-trust-review.js';
import { verifyFinanceQueues } from './verify-finance-queues.js';
import { verifyConfigurationPublication } from './verify-configuration-publication.js';
import { verifyIncidentControls } from './verify-incident-controls.js';
import { verifyReporting } from './verify-reporting.js';
import { verifyRouting } from './verify-routing.js';
import { verifyAdminControlPlane } from './verify-admin-control-plane.js';
import { verifyAdminOnboarding } from './verify-admin-onboarding.js';
import { verifyCatalogueFreshnessModeration } from './verify-catalogue-freshness-moderation.js';
import { verifyCatalogueProducts } from './verify-catalogue-products.js';
import { verifyCustomerAddresses } from './verify-customer-addresses.js';
import { verifyCustomerDiscovery } from './verify-customer-discovery.js';
import { verifyCustomerEnrolment } from './verify-customer-enrolment.js';
import { verifyCustomerCart } from './verify-customer-cart.js';
import { verifyVendorStaff } from './verify-vendor-staff.js';
import { verifyGroupedCheckout } from './verify-grouped-checkout.js';
import { verifyVendorFulfilment } from './verify-vendor-fulfilment.js';
import { verifyPartnerLifecycle } from './verify-partner-lifecycle.js';
import { verifyPartnerAvailability } from './verify-partner-availability.js';
import { verifyPartnerWaitPolicy } from './verify-partner-wait-policy.js';
import { verifyLocalNotifications } from './verify-local-notifications.js';
import { verifyLaunchReadiness } from './verify-launch-readiness.js';

async function assertVersions(client: Client): Promise<void> {
  const result = await client.query<{
    postgis_version: string | null;
    server_version_number: string;
  }>(`SELECT
       current_setting('server_version_num') AS server_version_number,
       (SELECT extversion FROM pg_extension WHERE extname = 'postgis') AS postgis_version`);
  const versions = result.rows[0];
  if (!versions?.server_version_number.startsWith('18')) {
    throw new Error('Lifecycle verification requires PostgreSQL 18');
  }
  if (!versions.postgis_version?.startsWith('3.6.')) {
    throw new Error('Lifecycle verification requires PostGIS 3.6.x');
  }
}

/**
 * A hosted pooler closing the socket under a checked-out client ended the
 * worker: pg emits 'error' on the client, pg-pool listens only while the client
 * is idle, and an 'error' with no listener is thrown from `emit`. The process
 * printed "Connection terminated unexpectedly" and stopped ticking. This is
 * the exact event, raised on a client the pool has handed out.
 */
async function verifyDatabasePoolResilience(connectionString: string): Promise<void> {
  const pool = createDatabasePool({
    application_name: 'neighbourhood-store-test-pool-verifier',
    connectionString,
    max: 1,
  });
  try {
    const client = await pool.connect();
    let survived = false;
    try {
      client.emit(
        'error',
        Object.assign(new Error('SYNTH connection terminated unexpectedly'), {
          code: 'ECONNRESET',
        }),
      );
      survived = true;
    } catch {
      survived = false;
    } finally {
      client.release(true);
    }
    if (!survived) {
      throw new Error(
        'A connection error on a checked-out client was unhandled and would end the process',
      );
    }
    const again = await pool.query<{ one: number }>('SELECT 1 AS one');
    if (again.rows[0]?.one !== 1) {
      throw new Error('The pool did not serve again after a checked-out client failed');
    }
  } finally {
    await pool.end();
  }
}

async function verifyIdempotentCommands(connectionString: string): Promise<void> {
  const pool = new Pool({
    application_name: 'neighbourhood-store-test-idempotency-verifier',
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 8,
    query_timeout: 30_000,
    statement_timeout: 30_000,
  });
  const actorId = createUuidV7();
  try {
    await pool.query('DELETE FROM marketplace.idempotency_records');

    let sequentialExecutions = 0;
    const firstInput = {
      actor_id: actorId,
      command_scope: 'checkout.submit_order',
      idempotency_key: 'sequential-retry-0001',
      request_body: { items: [{ product_id: 'SYNTH-TOMATO', quantity: 2 }], total_minor: 9000 },
      request_id: createRequestId(),
    };
    const first = await executeIdempotentCommand(pool, firstInput, async () => {
      sequentialExecutions += 1;
      return {
        kind: 'completed',
        http_status: 201,
        response_body: { order_reference: 'ORD-SYNTH-0001', status: 'accepted' },
      };
    });
    const replay = await executeIdempotentCommand(
      pool,
      { ...firstInput, request_id: createRequestId() },
      async () => {
        sequentialExecutions += 1;
        throw new Error('Replay executed the command handler');
      },
    );
    if (
      sequentialExecutions !== 1 ||
      first.replayed ||
      !replay.replayed ||
      first.http_status !== replay.http_status ||
      JSON.stringify(first.response_body) !== JSON.stringify(replay.response_body)
    ) {
      throw new Error('Sequential duplicate did not replay the original result exactly');
    }

    let mismatchRejected = false;
    try {
      await executeIdempotentCommand(
        pool,
        { ...firstInput, request_body: { total_minor: 9100 }, request_id: createRequestId() },
        async () => ({ kind: 'completed', http_status: 201, response_body: { invalid: true } }),
      );
    } catch (error: unknown) {
      mismatchRejected = error instanceof IdempotencyKeyReusedError;
    }
    if (!mismatchRejected) throw new Error('Idempotency-key payload mismatch was not rejected');

    let releaseHandler: (() => void) | undefined;
    let announceHandler: (() => void) | undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      announceHandler = resolve;
    });
    const handlerRelease = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    let concurrentExecutions = 0;
    const simultaneousInput = {
      actor_id: actorId,
      command_scope: 'basket.apply_coupon',
      idempotency_key: 'simultaneous-retry-0001',
      request_body: { coupon: 'SYNTH20', basket_reference: 'BASKET-SYNTH-1' },
      request_id: createRequestId(),
    };
    const ownerPromise = executeIdempotentCommand(pool, simultaneousInput, async () => {
      concurrentExecutions += 1;
      announceHandler?.();
      await handlerRelease;
      return {
        kind: 'completed',
        http_status: 200,
        response_body: { discount_minor: 2000, status: 'applied' },
      };
    });
    await handlerStarted;
    const duplicatePromise = executeIdempotentCommand(
      pool,
      { ...simultaneousInput, request_id: createRequestId() },
      async () => {
        concurrentExecutions += 1;
        return { kind: 'completed', http_status: 500, response_body: { invalid: true } };
      },
    );
    releaseHandler?.();
    const [owner, duplicate] = await Promise.all([ownerPromise, duplicatePromise]);
    if (
      concurrentExecutions !== 1 ||
      owner.replayed ||
      !duplicate.replayed ||
      JSON.stringify(owner.response_body) !== JSON.stringify(duplicate.response_body)
    ) {
      throw new Error('Simultaneous duplicates did not collapse to one command execution');
    }

    let uncertainExecutions = 0;
    const uncertainInput = {
      actor_id: actorId,
      command_scope: 'payment.authorize_order',
      idempotency_key: 'uncertain-provider-0001',
      request_body: { amount_minor: 9000, order_reference: 'ORD-SYNTH-0001' },
      request_id: createRequestId(),
    };
    const uncertain = await executeIdempotentCommand(pool, uncertainInput, async () => {
      uncertainExecutions += 1;
      return {
        kind: 'uncertain',
        reconciliation_due_at: new Date(Date.now() + 48 * 60 * 60 * 1000),
        response_body: {
          provider_reference: 'PAY-SYNTH-UNKNOWN',
          status: 'pending_reconciliation',
        },
      };
    });
    const uncertainReplay = await executeIdempotentCommand(
      pool,
      { ...uncertainInput, request_id: createRequestId() },
      async () => {
        uncertainExecutions += 1;
        return { kind: 'completed', http_status: 200, response_body: { invalid: true } };
      },
    );
    if (
      uncertainExecutions !== 1 ||
      uncertain.status !== 'UNCERTAIN' ||
      uncertain.http_status !== 202 ||
      !uncertainReplay.replayed
    ) {
      throw new Error('Uncertain provider outcome was not retained and replayed');
    }

    const retained = await pool.query<{ retained: boolean }>(
      `SELECT expires_at >= reconciliation_due_at
              AND expires_at >= created_at + interval '7 days' AS retained
         FROM marketplace.idempotency_records
        WHERE record_id = $1`,
      [uncertain.record_id],
    );
    if (!retained.rows[0]?.retained) {
      throw new Error('Uncertain provider outcome retention is too short for reconciliation');
    }

    // A handler that dies mid-flight leaves the outcome genuinely unknown. The lease
    // expires, the record becomes UNCERTAIN, and it must be due for reconciliation
    // promptly while still being retained for the full seven days. These were the same
    // constant, so an abandoned payment authorization would have waited a week.
    const abandonedInput = {
      actor_id: actorId,
      command_scope: 'payment.authorize_order',
      idempotency_key: 'abandoned-lease-0001',
      request_body: { amount_minor: 4200, order_reference: 'ORD-SYNTH-0002' },
      request_id: createRequestId(),
    };
    await pool.query(
      `INSERT INTO marketplace.idempotency_records
         (record_id, actor_id, command_scope, idempotency_key, request_hash, request_id,
          status, lease_expires_at, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'IN_PROGRESS',
               clock_timestamp() - interval '1 minute',
               clock_timestamp() + interval '24 hours',
               clock_timestamp() - interval '5 minutes',
               clock_timestamp() - interval '5 minutes')`,
      [
        createUuidV7(),
        actorId,
        abandonedInput.command_scope,
        abandonedInput.idempotency_key,
        canonicalRequestHash(abandonedInput.request_body),
        abandonedInput.request_id,
      ],
    );
    let abandonedExecutions = 0;
    const abandoned = await executeIdempotentCommand(pool, abandonedInput, async () => {
      abandonedExecutions += 1;
      return { kind: 'completed', http_status: 200, response_body: { retried: true } };
    });
    if (abandonedExecutions !== 0 || abandoned.status !== 'UNCERTAIN') {
      throw new Error('An abandoned command was re-executed instead of held for reconciliation');
    }
    const abandonedTiming = await pool.query<{ due_soon: boolean; retained: boolean }>(
      `SELECT reconciliation_due_at <= clock_timestamp() + interval '10 minutes' AS due_soon,
              expires_at >= created_at + interval '7 days' AS retained
         FROM marketplace.idempotency_records
        WHERE actor_id = $1 AND command_scope = $2 AND idempotency_key = $3`,
      [actorId, abandonedInput.command_scope, abandonedInput.idempotency_key],
    );
    if (!abandonedTiming.rows[0]?.due_soon) {
      throw new Error('An abandoned command is not due for reconciliation promptly');
    }
    if (!abandonedTiming.rows[0]?.retained) {
      throw new Error('An abandoned command is not retained long enough to reconcile');
    }

    const reconciled = await reconcileUncertainCommand(pool, {
      record_id: uncertain.record_id,
      outcome: {
        kind: 'completed',
        http_status: 200,
        response_body: { provider_reference: 'PAY-SYNTH-SETTLED', status: 'authorized' },
      },
    });
    const reconciledReplay = await executeIdempotentCommand(
      pool,
      { ...uncertainInput, request_id: createRequestId() },
      async () => {
        uncertainExecutions += 1;
        return { kind: 'completed', http_status: 500, response_body: { invalid: true } };
      },
    );
    if (
      reconciled.status !== 'SUCCEEDED' ||
      !reconciledReplay.replayed ||
      uncertainExecutions !== 1 ||
      JSON.stringify(reconciled.response_body) !== JSON.stringify(reconciledReplay.response_body)
    ) {
      throw new Error('Reconciled provider outcome did not replace the uncertain replay safely');
    }

    const thrown = await executeIdempotentCommand(
      pool,
      {
        actor_id: actorId,
        command_scope: 'provider.dispatch_order',
        idempotency_key: 'thrown-provider-0001',
        request_body: { order_reference: 'ORD-SYNTH-0001' },
        request_id: createRequestId(),
      },
      async () => {
        throw new Error('Synthetic connection loss after provider submission');
      },
    );
    if (thrown.status !== 'UNCERTAIN' || thrown.http_status !== 202) {
      throw new Error('Thrown provider outcome was not conservatively retained as uncertain');
    }
  } finally {
    await pool.end();
  }
}

async function verifyAggregateVersioning(connectionString: string): Promise<void> {
  const pool = new Pool({
    application_name: 'neighbourhood-store-test-aggregate-verifier',
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 8,
    query_timeout: 30_000,
    statement_timeout: 30_000,
  });
  const policy = defineAggregatePolicy({
    aggregate_type: 'synthetic_order',
    creation: {
      allowed_actor_kinds: ['customer'],
      allowed_initial_states: ['PLACED'],
      reason: 'forbidden',
      required_evidence: ['checkout_reference'],
    },
    states: ['PLACED', 'ACCEPTED', 'CANCELLED'],
    transitions: [
      {
        allowed_actor_kinds: ['vendor_staff'],
        from_state: 'PLACED',
        reason: 'optional',
        required_evidence: ['vendor_location_id'],
        to_state: 'ACCEPTED',
      },
      {
        allowed_actor_kinds: ['admin', 'customer'],
        from_state: 'PLACED',
        reason: 'required',
        required_evidence: ['cancellation_source'],
        to_state: 'CANCELLED',
      },
      {
        allowed_actor_kinds: ['admin'],
        from_state: 'ACCEPTED',
        reason: 'required',
        required_evidence: ['case_reference'],
        to_state: 'CANCELLED',
      },
    ],
  });
  const customerId = createUuidV7();
  const vendorId = createUuidV7();
  const adminId = createUuidV7();
  const attribution = (
    actorId: string,
    actorKind: 'admin' | 'customer' | 'vendor_staff',
    evidence: Record<string, boolean | number | string>,
    reasonCode?: string,
  ) => ({
    actor_id: actorId,
    actor_kind: actorKind,
    correlation_id: createUuidV7(),
    evidence,
    ...(reasonCode ? { reason_code: reasonCode } : {}),
    request_id: createRequestId(),
  });
  const createOrder = async (aggregateId: string, suffix: string) =>
    createVersionedAggregate(pool, policy, {
      aggregate_id: aggregateId,
      initial_state: 'PLACED',
      ...attribution(customerId, 'customer', { checkout_reference: `CHECKOUT-${suffix}` }),
    });

  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS marketplace_test`);
    await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_test.aggregate_side_effects (
      aggregate_id uuid PRIMARY KEY,
      resulting_version integer NOT NULL
    )`);

    const orderId = createUuidV7();
    const created = await createOrder(orderId, 'VERSIONED-1');
    if (created.version !== 1 || created.state !== 'PLACED') {
      throw new Error('Aggregate creation did not establish version one');
    }
    const acceptedRequestId = createRequestId();
    const acceptedCorrelationId = createUuidV7();
    const accepted = await transitionAggregate(pool, policy, {
      actor_id: vendorId,
      actor_kind: 'vendor_staff',
      aggregate_id: orderId,
      correlation_id: acceptedCorrelationId,
      evidence: { vendor_location_id: 'SYNTH-VENDOR-01' },
      expected_version: 1,
      request_id: acceptedRequestId,
      to_state: 'ACCEPTED',
    });
    if (accepted.version !== 2 || accepted.state !== 'ACCEPTED') {
      throw new Error('Valid aggregate transition did not advance version and state together');
    }
    const attributionRecord = await pool.query<{
      actor_id: string;
      actor_kind: string;
      correlation_id: string;
      evidence: Record<string, string>;
      previous_version: number;
      request_id: string;
      resulting_version: number;
    }>(
      `SELECT actor_id, actor_kind, correlation_id, evidence, previous_version,
              request_id, resulting_version
         FROM marketplace.aggregate_transitions
        WHERE transition_id = $1`,
      [accepted.transition_id],
    );
    const recorded = attributionRecord.rows[0];
    if (
      recorded?.actor_id !== vendorId ||
      recorded.actor_kind !== 'vendor_staff' ||
      recorded.request_id !== acceptedRequestId ||
      recorded.correlation_id !== acceptedCorrelationId ||
      recorded.previous_version !== 1 ||
      recorded.resulting_version !== 2 ||
      recorded.evidence.vendor_location_id !== 'SYNTH-VENDOR-01'
    ) {
      throw new Error('Transition history did not preserve complete attribution and evidence');
    }

    let staleConflict: AggregateVersionConflictError | undefined;
    try {
      await transitionAggregate(pool, policy, {
        actor_id: customerId,
        actor_kind: 'customer',
        aggregate_id: orderId,
        correlation_id: createUuidV7(),
        evidence: { cancellation_source: 'CUSTOMER_APP' },
        expected_version: 1,
        reason_code: 'CUSTOMER_REQUESTED',
        request_id: createRequestId(),
        to_state: 'CANCELLED',
      });
    } catch (error: unknown) {
      if (error instanceof AggregateVersionConflictError) staleConflict = error;
    }
    if (
      staleConflict?.code !== 'VERSION_CONFLICT' ||
      staleConflict.current_version !== 2 ||
      staleConflict.current_state !== 'ACCEPTED'
    ) {
      throw new Error('Stale aggregate edit did not return a stable version conflict');
    }

    const rejectedOrderId = createUuidV7();
    await createOrder(rejectedOrderId, 'REJECTED-1');
    const invalidAttempts = [
      transitionAggregate(pool, policy, {
        actor_id: customerId,
        actor_kind: 'customer',
        aggregate_id: rejectedOrderId,
        correlation_id: createUuidV7(),
        evidence: { vendor_location_id: 'SYNTH-VENDOR-01' },
        expected_version: 1,
        request_id: createRequestId(),
        to_state: 'ACCEPTED',
      }),
      transitionAggregate(pool, policy, {
        actor_id: vendorId,
        actor_kind: 'vendor_staff',
        aggregate_id: rejectedOrderId,
        correlation_id: createUuidV7(),
        evidence: {},
        expected_version: 1,
        request_id: createRequestId(),
        to_state: 'ACCEPTED',
      }),
      transitionAggregate(pool, policy, {
        actor_id: adminId,
        actor_kind: 'admin',
        aggregate_id: rejectedOrderId,
        correlation_id: createUuidV7(),
        evidence: { cancellation_source: 'OPERATIONS' },
        expected_version: 1,
        request_id: createRequestId(),
        to_state: 'CANCELLED',
      }),
      transitionAggregate(pool, policy, {
        actor_id: adminId,
        actor_kind: 'admin',
        aggregate_id: rejectedOrderId,
        correlation_id: createUuidV7(),
        evidence: {},
        expected_version: 1,
        request_id: createRequestId(),
        to_state: 'REFUNDED',
      }),
    ];
    const invalidResults = await Promise.allSettled(invalidAttempts);
    if (
      invalidResults.some(
        (result) =>
          result.status !== 'rejected' ||
          !(result.reason instanceof AggregateTransitionRejectedError),
      )
    ) {
      throw new Error('Actor, evidence, or reason policy accepted an invalid transition');
    }
    const rejectedState = await pool.query<{
      history_count: string;
      state: string;
      version: number;
    }>(
      `SELECT h.version, h.state,
              (SELECT count(*)::text FROM marketplace.aggregate_transitions t
                WHERE t.aggregate_type = h.aggregate_type AND t.aggregate_id = h.aggregate_id)
                AS history_count
         FROM marketplace.aggregate_heads h
        WHERE h.aggregate_type = $1 AND h.aggregate_id = $2`,
      [policy.aggregate_type, rejectedOrderId],
    );
    if (
      rejectedState.rows[0]?.version !== 1 ||
      rejectedState.rows[0].state !== 'PLACED' ||
      rejectedState.rows[0].history_count !== '1'
    ) {
      throw new Error('Rejected transition partially changed aggregate state or history');
    }

    const concurrentOrderId = createUuidV7();
    await createOrder(concurrentOrderId, 'CONCURRENT-1');
    const concurrentResults = await Promise.allSettled([
      transitionAggregate(pool, policy, {
        actor_id: vendorId,
        actor_kind: 'vendor_staff',
        aggregate_id: concurrentOrderId,
        correlation_id: createUuidV7(),
        evidence: { vendor_location_id: 'SYNTH-VENDOR-01' },
        expected_version: 1,
        request_id: createRequestId(),
        to_state: 'ACCEPTED',
      }),
      transitionAggregate(pool, policy, {
        actor_id: customerId,
        actor_kind: 'customer',
        aggregate_id: concurrentOrderId,
        correlation_id: createUuidV7(),
        evidence: { cancellation_source: 'CUSTOMER_APP' },
        expected_version: 1,
        reason_code: 'CUSTOMER_REQUESTED',
        request_id: createRequestId(),
        to_state: 'CANCELLED',
      }),
    ]);
    if (
      concurrentResults.filter((result) => result.status === 'fulfilled').length !== 1 ||
      concurrentResults.filter(
        (result) =>
          result.status === 'rejected' && result.reason instanceof AggregateVersionConflictError,
      ).length !== 1
    ) {
      throw new Error('Simultaneous expected-version edits did not produce one winner');
    }
    const concurrentState = await pool.query<{ history_count: string; version: number }>(
      `SELECT h.version,
              (SELECT count(*)::text FROM marketplace.aggregate_transitions t
                WHERE t.aggregate_type = h.aggregate_type AND t.aggregate_id = h.aggregate_id)
                AS history_count
         FROM marketplace.aggregate_heads h
        WHERE h.aggregate_type = $1 AND h.aggregate_id = $2`,
      [policy.aggregate_type, concurrentOrderId],
    );
    if (concurrentState.rows[0]?.version !== 2 || concurrentState.rows[0].history_count !== '2') {
      throw new Error('Concurrent aggregate winner did not create exactly one transition');
    }

    const rollbackOrderId = createUuidV7();
    await createOrder(rollbackOrderId, 'ROLLBACK-1');
    let callbackFailed = false;
    try {
      await transitionAggregate(
        pool,
        policy,
        {
          actor_id: vendorId,
          actor_kind: 'vendor_staff',
          aggregate_id: rollbackOrderId,
          correlation_id: createUuidV7(),
          evidence: { vendor_location_id: 'SYNTH-VENDOR-01' },
          expected_version: 1,
          request_id: createRequestId(),
          to_state: 'ACCEPTED',
        },
        async (client, resultingVersion) => {
          await client.query(
            `INSERT INTO marketplace_test.aggregate_side_effects
               (aggregate_id, resulting_version) VALUES ($1, $2)`,
            [rollbackOrderId, resultingVersion],
          );
          throw new Error('Synthetic domain mutation failure');
        },
      );
    } catch {
      callbackFailed = true;
    }
    const rollbackState = await pool.query<{
      history_count: string;
      side_effect_count: string;
      version: number;
    }>(
      `SELECT h.version,
              (SELECT count(*)::text FROM marketplace.aggregate_transitions t
                WHERE t.aggregate_type = h.aggregate_type AND t.aggregate_id = h.aggregate_id)
                AS history_count,
              (SELECT count(*)::text FROM marketplace_test.aggregate_side_effects s
                WHERE s.aggregate_id = h.aggregate_id) AS side_effect_count
         FROM marketplace.aggregate_heads h
        WHERE h.aggregate_type = $1 AND h.aggregate_id = $2`,
      [policy.aggregate_type, rollbackOrderId],
    );
    if (
      !callbackFailed ||
      rollbackState.rows[0]?.version !== 1 ||
      rollbackState.rows[0].history_count !== '1' ||
      rollbackState.rows[0].side_effect_count !== '0'
    ) {
      throw new Error('Failed domain mutation was not rolled back with version and history');
    }

    let appendOnlyRejected = false;
    try {
      await pool.query(
        `UPDATE marketplace.aggregate_transitions SET reason_code = 'TAMPERED'
          WHERE transition_id = $1`,
        [accepted.transition_id],
      );
    } catch (error: unknown) {
      appendOnlyRejected =
        typeof error === 'object' && error !== null && 'code' in error && error.code === '55000';
    }
    if (!appendOnlyRejected) throw new Error('Append-only transition history accepted mutation');

    // Deletion, not only mutation. The trigger is BEFORE DELETE OR UPDATE, but only the
    // update half was covered, so narrowing it to BEFORE UPDATE would have passed this
    // suite while letting an actor erase the record of what they did -- which is worse
    // than editing it, because nothing is left to contradict.
    let appendOnlyDeleteRejected = false;
    try {
      await pool.query(`DELETE FROM marketplace.aggregate_transitions WHERE transition_id = $1`, [
        accepted.transition_id,
      ]);
    } catch (error: unknown) {
      appendOnlyDeleteRejected =
        typeof error === 'object' && error !== null && 'code' in error && error.code === '55000';
    }
    if (!appendOnlyDeleteRejected) {
      throw new Error('Append-only transition history accepted a deletion');
    }
  } finally {
    await pool.end();
  }
}

// Roll every migration back from the current head down to and including the
// named target, then assert the exact expected depth. Deriving the step count
// from the migration ledger keeps this rehearsal correct as migrations are
// added, instead of silently drifting against hardcoded counts.
async function revertThrough(client: Client, target: string): Promise<number> {
  const migrations = await migrationStatus(client);
  const index = migrations.findIndex((migration) => migration.name === target);
  if (index < 0) throw new Error(`Rollback target ${target} is not a known migration`);
  const steps = migrations.length - index;
  const reverted = await migrateDown(client, steps);
  if (reverted !== steps) {
    throw new Error(`Expected ${steps} migrations to roll back through ${target}`);
  }
  return reverted;
}

const config = loadDatabaseConfig('test');
process.env.DB_REBUILD_CONFIRM = 'rebuild-neighbourhood-store-test';

await withDatabaseClient(config, async (client) => {
  await migrateUp(client);
  await assertVersions(client);
  // Each module's count is what its assertions actually did, measured by the
  // shared `check`; nothing here is typed by hand. A module that still asserts
  // with inline `throw new Error(...)` is not counted and reports null rather
  // than a zero that would read as "asserts nothing".
  const measured: Record<string, number | null> = {};
  // 10.7: whatever a module left in the books must agree with what everyone
  // is owed, so a breach names the module that caused it rather than being
  // found at the end of the ladder.
  let conservationChecks = 0;
  const measure = async (name: string, run: () => Promise<void>) => {
    takeAssertionCount();
    await run();
    const count = takeAssertionCount();
    measured[`${name}_assertions`] = count > 0 ? count : null;
    const report = await auditMoneyConservation(client);
    if (!report.conserved)
      throw new Error(
        `Money is not conserved after ${name}: ${JSON.stringify(report.breaches.slice(0, 10))}`,
      );
    conservationChecks += 1;
  };
  await measure('database_pool_resilience', () =>
    verifyDatabasePoolResilience(config.connectionString),
  );
  await measure('idempotent_commands', () => verifyIdempotentCommands(config.connectionString));
  await measure('aggregate_versioning', () => verifyAggregateVersioning(config.connectionString));
  await measure('transactional_messaging', () =>
    verifyTransactionalMessaging(config.connectionString),
  );
  await measure('durable_jobs', () => verifyDurableJobs(config.connectionString));
  await measure('versioned_configuration', () =>
    verifyVersionedConfiguration(config.connectionString),
  );
  await measure('reference_module', () => verifyReferenceModule(config.connectionString));
  await measure('otp_identity', () => verifyOtpIdentity(config.connectionString));
  await measure('identity_sessions', () => verifyIdentitySessions(config.connectionString));
  await measure('identity_preferences', () => verifyIdentityPreferences(config.connectionString));
  await measure('vendor_network', () => verifyVendorNetwork(config.connectionString));
  await measure('vendor_onboarding', () => verifyVendorOnboarding(config.connectionString));
  await measure('vendor_publication', () => verifyVendorPublication(config.connectionString));
  await measure('inventory_reservations', () =>
    verifyInventoryReservations(config.connectionString),
  );
  await measure('catalogue_freshness_moderation', () =>
    verifyCatalogueFreshnessModeration(config.connectionString),
  );
  await measure('catalogue_products', () => verifyCatalogueProducts(config.connectionString));
  await measure('customer_addresses', () => verifyCustomerAddresses(config.connectionString));
  await measure('customer_discovery', () => verifyCustomerDiscovery(config.connectionString));
  await measure('customer_enrolment', () => verifyCustomerEnrolment(config.connectionString));
  await measure('routing', () => verifyRouting(config.connectionString));
  await measure('customer_cart', () => verifyCustomerCart(config.connectionString));
  await measure('grouped_checkout', () => verifyGroupedCheckout(config.connectionString));
  await measure('vendor_fulfilment', () => verifyVendorFulfilment(config.connectionString));
  await measure('admin_control_plane', () => verifyAdminControlPlane(config.connectionString));
  await measure('admin_onboarding', () => verifyAdminOnboarding(config.connectionString));
  await measure('partner_lifecycle', () => verifyPartnerLifecycle(config.connectionString));
  await measure('partner_availability', () => verifyPartnerAvailability(config.connectionString));
  await measure('partner_wait_policy', () => verifyPartnerWaitPolicy(config.connectionString));
  await measure('local_notifications', () => verifyLocalNotifications(config.connectionString));
  await measure('launch_readiness', () => verifyLaunchReadiness(config.connectionString));
  await measure('vendor_staff', () => verifyVendorStaff(config.connectionString));
  await measure('assignment_custody', () => verifyAssignmentCustody(config.connectionString));
  await measure('money_lifecycle', () => verifyMoneyLifecycle(config.connectionString));
  await measure('partner_payouts', () => verifyPartnerPayouts(config.connectionString));
  await measure('statement_reconciliation', () =>
    verifyStatementReconciliation(config.connectionString),
  );
  await measure('financial_corrections', () => verifyFinancialCorrections(config.connectionString));
  await measure('money_conservation', () => verifyMoneyConservation(config.connectionString));
  await measure('admin_dashboard', () => verifyAdminDashboard(config.connectionString));
  await measure('order_monitor', () => verifyOrderMonitor(config.connectionString));
  await measure('support_cases', () => verifySupportCases(config.connectionString));
  await measure('trust_review', () => verifyTrustReview(config.connectionString));
  await measure('finance_queues', () => verifyFinanceQueues(config.connectionString));
  await measure('configuration_publication', () =>
    verifyConfigurationPublication(config.connectionString),
  );
  await measure('incident_controls', () => verifyIncidentControls(config.connectionString));
  await measure('reporting', () => verifyReporting(config.connectionString));
  await measure('identity_access', () => verifyIdentityAccess(config.connectionString));

  const firstHash = await seedFixtures(client);
  const secondHash = await seedFixtures(client);
  if (firstHash !== expectedFixtureHash || secondHash !== expectedFixtureHash) {
    throw new Error('Repeated seed execution changed the fixture hash');
  }

  await resetFixtures(client);
  const resetHash = await seedFixtures(client);
  if (
    resetHash !== expectedFixtureHash ||
    (await readFixtureHash(client)) !== expectedFixtureHash
  ) {
    throw new Error('Fixture reset did not rebuild deterministic data');
  }

  // Domain verifiers intentionally leave evidence for their assertions. Clear
  // that synthetic evidence before rehearsing schema rollback/forward cycles so
  // a Phase 4 staff row cannot outlive the Phase 5 location it references.
  await client.query(`TRUNCATE marketplace.support_cases,
    marketplace.report_export_accesses, marketplace.report_exports,
    marketplace.incident_control_events, marketplace.incident_controls,
    marketplace.trust_appeals, marketplace.trust_case_events,
    marketplace.trust_restriction_signals, marketplace.trust_signal_dismissals,
    marketplace.trust_signals, marketplace.trust_restriction_cases,
    marketplace.payment_authorization_adjustments,
    marketplace.in_app_notifications, marketplace.notification_attempts,
    marketplace.notification_intents,
    marketplace.partner_availability_events, marketplace.partner_availability,
    marketplace.partner_application_events, marketplace.partner_document_renewals,
    marketplace.partner_wait_earning_adjustments, marketplace.partner_wait_timer_events,
    marketplace.partner_wait_timers,
    marketplace.vendor_order_ratings,
    marketplace.vendor_order_events,
    marketplace.vendor_order_customer_decisions,
    marketplace.vendor_order_line_picks,
    marketplace.vendor_staff_events,
    marketplace.cart_events, marketplace.cart_lines,
    marketplace.cart_vendor_groups, marketplace.carts,
    marketplace.customer_discovery_events, marketplace.customer_recent_searches,
    marketplace.customer_shop_requests, marketplace.customer_preferred_store,
    marketplace.customer_favourite_stores,
    marketplace.customer_address_events, marketplace.customer_addresses,
    marketplace.financial_correction_events, marketplace.financial_corrections,
    marketplace.finance_exception_events, marketplace.finance_exceptions, marketplace.provider_statement_rows,
    marketplace.payouts, marketplace.settlements, marketplace.ledger_entries,
    marketplace.ledger_transactions, marketplace.refund_events, marketplace.refunds,
    marketplace.payment_events, marketplace.payment_allocations, marketplace.payment_transactions,
    marketplace.return_tasks, marketplace.custody_events,
    marketplace.assignment_events, marketplace.delivery_assignments,
    marketplace.catalogue_moderation_events, marketplace.catalogue_moderation_cases,
    marketplace.catalogue_product_substitutions, marketplace.catalogue_product_images,
    marketplace.catalogue_prices, marketplace.catalogue_product_variants,
    marketplace.catalogue_import_rows, marketplace.catalogue_imports, marketplace.catalogue_products,
    marketplace.inventory_events,
    marketplace.inventory_reservations, marketplace.inventory_items,
    marketplace.vendor_publication_events,
    marketplace.vendor_publication_cases, marketplace.access_membership_events,
    marketplace.admin_membership_scopes, marketplace.partner_assignment_memberships,
    marketplace.partner_eligibilities, marketplace.staff_memberships,
    marketplace.role_assignments, marketplace.vendor_onboarding_events,
    marketplace.vendor_onboarding_appeals, marketplace.vendor_document_reviews,
    marketplace.vendor_verification_documents, marketplace.vendor_onboarding_cases,
    marketplace.vendor_network_events,
    marketplace.vendor_location_fulfilment_modes, marketplace.vendor_service_zones,
    marketplace.vendor_location_temporary_closures,
    marketplace.vendor_location_calendar_exceptions,
    marketplace.vendor_location_operating_hours, marketplace.vendor_locations,
    marketplace.vendors CASCADE
      `);

  // Configuration versions are append-only, and the seeded ones outlive this
  // rehearsal, so only the publication walk's rejections, cancellations and
  // validation reports -- which 0120 refuses to roll back over -- are cleared.
  await client.query(`BEGIN;
    SET LOCAL session_replication_role = replica;
    DELETE FROM marketplace.configuration_lifecycle_events e
     USING marketplace.configuration_versions v
     WHERE e.configuration_version_id = v.configuration_version_id
       AND v.status IN ('REJECTED', 'CANCELLED');
    DELETE FROM marketplace.configuration_versions WHERE status IN ('REJECTED', 'CANCELLED');
    UPDATE marketplace.configuration_versions SET validation_report = NULL
     WHERE validation_report IS NOT NULL;
    COMMIT;`);

  await revertThrough(client, '0015_money_lifecycle');
  const moneyTablesAfterRollback = await client.query<{
    money_exists: boolean;
    assignments_exist: boolean;
  }>(`SELECT
    to_regclass('marketplace.payment_transactions') IS NOT NULL AS money_exists,
    to_regclass('marketplace.delivery_assignments') IS NOT NULL AS assignments_exist`);
  if (
    moneyTablesAfterRollback.rows[0]?.money_exists ||
    !moneyTablesAfterRollback.rows[0]?.assignments_exist
  ) {
    throw new Error('Money-lifecycle rollback removed the wrong database boundary');
  }

  await migrateUp(client);
  await revertThrough(client, '0014_assignment_custody');
  const assignmentTablesAfterRollback = await client.query<{
    assignments_exist: boolean;
    inventory_exists: boolean;
  }>(`SELECT
    to_regclass('marketplace.delivery_assignments') IS NOT NULL AS assignments_exist,
    to_regclass('marketplace.inventory_items') IS NOT NULL AS inventory_exists`);
  if (
    assignmentTablesAfterRollback.rows[0]?.assignments_exist ||
    !assignmentTablesAfterRollback.rows[0]?.inventory_exists
  ) {
    throw new Error('Assignment-custody rollback removed the wrong database boundary');
  }

  await migrateUp(client);
  await revertThrough(client, '0013_inventory_reservations');
  const inventoryTablesAfterRollback = await client.query<{
    inventory_exists: boolean;
    publication_exists: boolean;
  }>(`SELECT
    to_regclass('marketplace.inventory_items') IS NOT NULL AS inventory_exists,
    to_regclass('marketplace.vendor_publication_cases') IS NOT NULL AS publication_exists`);
  if (
    inventoryTablesAfterRollback.rows[0]?.inventory_exists ||
    !inventoryTablesAfterRollback.rows[0]?.publication_exists
  ) {
    throw new Error('Inventory-reservation rollback removed the wrong database boundary');
  }

  await migrateUp(client);
  await revertThrough(client, '0012_vendor_publication');
  const publicationTablesAfterRollback = await client.query<{
    onboarding_exists: boolean;
    publication_exists: boolean;
  }>(`SELECT
    to_regclass('marketplace.vendor_publication_cases') IS NOT NULL AS publication_exists,
    to_regclass('marketplace.vendor_onboarding_cases') IS NOT NULL AS onboarding_exists`);
  if (
    publicationTablesAfterRollback.rows[0]?.publication_exists ||
    !publicationTablesAfterRollback.rows[0]?.onboarding_exists
  ) {
    throw new Error('Vendor-publication rollback removed the wrong database boundary');
  }

  await migrateUp(client);
  await revertThrough(client, '0011_vendor_onboarding');
  const onboardingTablesAfterRollback = await client.query<{
    onboarding_exists: boolean;
    vendors_exist: boolean;
  }>(`SELECT
    to_regclass('marketplace.vendor_onboarding_cases') IS NOT NULL AS onboarding_exists,
    to_regclass('marketplace.vendors') IS NOT NULL AS vendors_exist`);
  if (
    onboardingTablesAfterRollback.rows[0]?.onboarding_exists ||
    !onboardingTablesAfterRollback.rows[0]?.vendors_exist
  ) {
    throw new Error('Vendor-onboarding rollback removed the wrong database boundary');
  }

  await migrateUp(client);
  await revertThrough(client, '0010_vendor_network');
  const vendorTablesAfterRollback = await client.query<{
    locations_exist: boolean;
    preferences_exist: boolean;
  }>(
    `SELECT
       to_regclass('marketplace.vendor_locations') IS NOT NULL AS locations_exist,
       to_regclass('marketplace.customer_profiles') IS NOT NULL AS preferences_exist`,
  );
  if (
    vendorTablesAfterRollback.rows[0]?.locations_exist ||
    !vendorTablesAfterRollback.rows[0]?.preferences_exist
  ) {
    throw new Error('Vendor-network rollback removed the wrong database boundary');
  }

  await migrateUp(client);
  await revertThrough(client, '0009_identity_preferences');
  const preferenceTablesAfterRollback = await client.query<{
    profiles_exist: boolean;
    roles_exist: boolean;
  }>(
    `SELECT
       to_regclass('marketplace.customer_profiles') IS NOT NULL AS profiles_exist,
       to_regclass('marketplace.role_assignments') IS NOT NULL AS roles_exist`,
  );
  if (
    preferenceTablesAfterRollback.rows[0]?.profiles_exist ||
    !preferenceTablesAfterRollback.rows[0]?.roles_exist
  ) {
    throw new Error('Identity-preference rollback removed the wrong database boundary');
  }

  await migrateUp(client);
  await revertThrough(client, '0008_identity_roles');
  const roleTablesAfterRollback = await client.query<{
    role_assignments_exist: boolean;
    sessions_exist: boolean;
  }>(
    `SELECT
       to_regclass('marketplace.role_assignments') IS NOT NULL AS role_assignments_exist,
       to_regclass('marketplace.sessions') IS NOT NULL AS sessions_exist`,
  );
  if (
    roleTablesAfterRollback.rows[0]?.role_assignments_exist ||
    !roleTablesAfterRollback.rows[0]?.sessions_exist
  ) {
    throw new Error('Identity-role rollback removed the wrong database boundary');
  }

  await migrateUp(client);
  await revertThrough(client, '0007_identity_sessions');
  const sessionTablesAfterRollback = await client.query<{
    otp_exists: boolean;
    sessions_exist: boolean;
  }>(
    `SELECT
       to_regclass('marketplace.sessions') IS NOT NULL AS sessions_exist,
       to_regclass('marketplace.otp_challenges') IS NOT NULL AS otp_exists`,
  );
  if (
    sessionTablesAfterRollback.rows[0]?.sessions_exist ||
    !sessionTablesAfterRollback.rows[0]?.otp_exists
  ) {
    throw new Error('Identity-session rollback removed the wrong database boundary');
  }

  await migrateUp(client);
  await revertThrough(client, '0006_otp_identity');
  const otpTablesAfterRollback = await client.query<{
    configuration_exists: boolean;
    otp_exists: boolean;
  }>(
    `SELECT
       to_regclass('marketplace.otp_challenges') IS NOT NULL AS otp_exists,
       to_regclass('marketplace.configuration_versions') IS NOT NULL AS configuration_exists`,
  );
  if (
    otpTablesAfterRollback.rows[0]?.otp_exists ||
    !otpTablesAfterRollback.rows[0]?.configuration_exists
  ) {
    throw new Error('OTP identity rollback removed the wrong database boundary');
  }

  await migrateUp(client);
  await revertThrough(client, '0005_versioned_configuration');
  const configurationTablesAfterRollback = await client.query<{
    jobs_exist: boolean;
    lifecycle_exist: boolean;
    snapshots_exist: boolean;
    versions_exist: boolean;
  }>(
    `SELECT
       to_regclass('marketplace.configuration_versions') IS NOT NULL AS versions_exist,
       to_regclass('marketplace.configuration_lifecycle_events') IS NOT NULL AS lifecycle_exist,
       to_regclass('marketplace.business_configuration_snapshots') IS NOT NULL AS snapshots_exist,
       to_regclass('marketplace.scheduled_jobs') IS NOT NULL AS jobs_exist`,
  );
  if (
    configurationTablesAfterRollback.rows[0]?.versions_exist ||
    configurationTablesAfterRollback.rows[0]?.lifecycle_exist ||
    configurationTablesAfterRollback.rows[0]?.snapshots_exist ||
    !configurationTablesAfterRollback.rows[0]?.jobs_exist
  ) {
    throw new Error('Versioned-configuration rollback removed the wrong database boundary');
  }

  await migrateUp(client);
  await revertThrough(client, '0004_durable_jobs');
  const jobTablesAfterRollback = await client.query<{
    attempts_exist: boolean;
    jobs_exist: boolean;
    outbox_exist: boolean;
    recoveries_exist: boolean;
  }>(
    `SELECT
       to_regclass('marketplace.scheduled_jobs') IS NOT NULL AS jobs_exist,
       to_regclass('marketplace.job_attempts') IS NOT NULL AS attempts_exist,
       to_regclass('marketplace.job_recoveries') IS NOT NULL AS recoveries_exist,
       to_regclass('marketplace.outbox_events') IS NOT NULL AS outbox_exist`,
  );
  if (
    jobTablesAfterRollback.rows[0]?.jobs_exist ||
    jobTablesAfterRollback.rows[0]?.attempts_exist ||
    jobTablesAfterRollback.rows[0]?.recoveries_exist ||
    !jobTablesAfterRollback.rows[0]?.outbox_exist
  ) {
    throw new Error('Durable-jobs rollback removed the wrong database boundary');
  }

  await migrateUp(client);
  await revertThrough(client, '0003_transactional_messaging');
  const messagingTablesAfterRollback = await client.query<{
    aggregate_heads_exist: boolean;
    inbox_exist: boolean;
    outbox_exist: boolean;
  }>(
    `SELECT
       to_regclass('marketplace.outbox_events') IS NOT NULL AS outbox_exist,
       to_regclass('marketplace.inbox_receipts') IS NOT NULL AS inbox_exist,
       to_regclass('marketplace.aggregate_heads') IS NOT NULL AS aggregate_heads_exist`,
  );
  if (
    messagingTablesAfterRollback.rows[0]?.outbox_exist ||
    messagingTablesAfterRollback.rows[0]?.inbox_exist ||
    !messagingTablesAfterRollback.rows[0]?.aggregate_heads_exist
  ) {
    throw new Error('Transactional-messaging rollback removed the wrong database boundary');
  }

  await migrateUp(client);
  await revertThrough(client, '0002_aggregate_versions');
  const aggregateTablesAfterRollback = await client.query<{
    heads_exist: boolean;
    idempotency_exists: boolean;
    transitions_exist: boolean;
  }>(
    `SELECT
       to_regclass('marketplace.aggregate_heads') IS NOT NULL AS heads_exist,
       to_regclass('marketplace.aggregate_transitions') IS NOT NULL AS transitions_exist,
       to_regclass('marketplace.idempotency_records') IS NOT NULL AS idempotency_exists`,
  );
  if (
    aggregateTablesAfterRollback.rows[0]?.heads_exist ||
    aggregateTablesAfterRollback.rows[0]?.transitions_exist ||
    !aggregateTablesAfterRollback.rows[0]?.idempotency_exists
  ) {
    throw new Error('Aggregate rollback removed the wrong database boundary');
  }

  await migrateUp(client);
  await revertThrough(client, '0001_idempotent_commands');
  const commandTableAfterRollback = await client.query<{ table_exists: boolean }>(
    `SELECT to_regclass('marketplace.idempotency_records') IS NOT NULL AS table_exists`,
  );
  if (commandTableAfterRollback.rows[0]?.table_exists) {
    throw new Error('Idempotent-command rollback left its table installed');
  }

  await migrateUp(client);
  await revertThrough(client, '0000_baseline');
  const rolledBack = await client.query<{ postgis_exists: boolean; schema_exists: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS postgis_exists,
       to_regnamespace('marketplace') IS NOT NULL AS schema_exists`,
  );
  if (rolledBack.rows[0]?.postgis_exists || rolledBack.rows[0]?.schema_exists) {
    throw new Error('Baseline rollback left PostGIS or the domain schema installed');
  }

  await migrateUp(client);
  await assertVersions(client);
  const statuses = await migrationStatus(client);
  if (!statuses.every((status) => status.applied)) {
    throw new Error('Forward migration after rollback is incomplete');
  }

  const rebuiltHash = await rebuildDatabase(client, 'test');
  await assertVersions(client);
  if (rebuiltHash !== expectedFixtureHash) {
    throw new Error('Rebuild from zero changed the deterministic fixture hash');
  }

  writeEvent('database.lifecycle.verified', {
    fixture_hash: rebuiltHash,
    ...measured,
    money_conservation_checks: conservationChecks,
    assertions_note: 'null: the module asserts with inline throws and is not yet counted',
    migrations: statuses.length,
    target: 'test',
  });
});
