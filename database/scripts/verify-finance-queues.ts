import { createHmac } from 'node:crypto';
import { createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { CatalogueProductService } from '../src/catalogue-products.js';
import { CompleteMoneyLifecycleService } from '../src/complete-money-lifecycle.js';
import { CustomerCartService } from '../src/customer-cart.js';
import {
  FINANCE_QUEUES,
  FinanceQueueAuthorizationError,
  FinanceQueueInputError,
  FinanceQueueNotFoundError,
  FinanceQueueService,
  FinanceQueueStateError,
} from '../src/finance-queues.js';
import { CheckoutInputError, GroupedCheckoutService } from '../src/grouped-checkout.js';
import { InventoryReservationService } from '../src/inventory-reservations.js';
import { MoneyLifecycleService } from '../src/money-lifecycle.js';
import { OrderMoneyOrchestrator } from '../src/order-money-orchestrator.js';
import { VendorFulfilmentService } from '../src/vendor-fulfilment.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';
import {
  adminContext,
  check,
  customerContext,
  rejects,
  systemContext,
  vendorContext,
} from './verify-support.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 11.5 -- the finance queues, worked.
 *
 * Two customers pay with the provider's answer unknown. The first answer
 * arrives by webhook and a second delivery of the same event contradicts it
 * (queued as a conflict); the other payment is reconciled from its queue
 * with the provider's answer. The first order is captured and a refund on it
 * is declined by the provider (queued as a refund failure). The conflict is
 * assigned, noted, evidenced, linked to a correction, refused as corrected
 * while that correction is only proposed, written off with a second person's
 * approval, reopened and closed as no money moved. A history table briefly
 * loses its guard and the ledger audit's breach is queued, then cleared.
 * Each step is also tried by the wrong person, stale, and with bad inputs.
 */
export async function verifyFinanceQueues(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4, application_name: 'finance-queues-verifier' });
  const HASH_KEY = 'synthetic-verifier-handover-code-material';
  const webhookKey = 'SYNTH-LOCAL-WEBHOOK-KEY-MATERIAL-0001';
  const inventory = new InventoryReservationService({ connection_string: connectionString });
  const catalogue = new CatalogueProductService({ connection_string: connectionString });
  const carts = new CustomerCartService({ connection_string: connectionString });
  const checkout = new GroupedCheckoutService({
    connection_string: connectionString,
    webhook_key: webhookKey,
  });
  const fulfilment = new VendorFulfilmentService({
    connection_string: connectionString,
    inventory,
    hash_key: HASH_KEY,
  });
  const money = new MoneyLifecycleService({ connection_string: connectionString });
  const complete = new CompleteMoneyLifecycleService({ connection_string: connectionString });
  const orderMoney = new OrderMoneyOrchestrator({
    complete_money: complete,
    connection_string: connectionString,
    money,
  });
  const queues = new FinanceQueueService({ connection_string: connectionString, money });
  const now = new Date(Date.now() - 2 * MINUTE);
  const later = (ms: number) => new Date(now.getTime() + ms);
  const people = {
    first: createUuidV7(),
    second: createUuidV7(),
    operator: createUuidV7(),
    colleague: createUuidV7(),
    approver: createUuidV7(),
    outsider: createUuidV7(),
    system: createUuidV7(),
  };
  const grant = async (user: UuidV7, role: string) => {
    const assignment = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.role_assignments
         (role_assignment_id, user_id, role_key, valid_from, granted_by_user_id,
          request_id, correlation_id, retention_review_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,NULL,$5,$5,$6,$4,$4)`,
      [assignment, user, role, later(-HOUR), createUuidV7(), later(365 * DAY)],
    );
    await pool.query(
      `INSERT INTO marketplace.admin_membership_scopes
         (admin_membership_scope_id, role_assignment_id, user_id, scope_kind, scope_id, created_at)
       VALUES ($1,$2,$3,'GLOBAL',NULL,$4)`,
      [createUuidV7(), assignment, user, later(-HOUR)],
    );
  };
  const operator = adminContext(people.operator);
  const approver = adminContext(people.approver);
  const outsider = adminContext(people.outsider);
  const exceptionFor = async (kind: string, reference: string) =>
    (
      await pool.query<{
        finance_exception_id: UuidV7;
        queue: string;
        exception_state: string;
        resolution_code: string | null;
        resolved_by_user_id: string | null;
        version: number;
      }>(
        `SELECT finance_exception_id, queue, exception_state, resolution_code, resolved_by_user_id, version
           FROM marketplace.finance_exceptions
          WHERE exception_kind = $1 AND (operation_reference = $2 OR business_reference = $2)
          ORDER BY created_at DESC LIMIT 1`,
        [kind, reference],
      )
    ).rows[0];
  const history = async (id: string) =>
    (
      await pool.query<{ event_type: string; actor_id: string; reason_code: string }>(
        `SELECT event_type, actor_id, reason_code FROM marketplace.finance_exception_events
          WHERE finance_exception_id = $1 ORDER BY occurred_at, finance_exception_event_id`,
        [id],
      )
    ).rows;

  try {
    await pool.query(
      "INSERT INTO marketplace.users (user_id,state,data_classification) SELECT unnest($1::uuid[]),'ACTIVE','RESTRICTED'",
      [Object.values(people)],
    );
    await grant(people.operator, 'FINANCE_OPERATOR');
    await grant(people.colleague, 'FINANCE_OPERATOR');
    await grant(people.approver, 'FINANCE_APPROVER');
    await grant(people.outsider, 'CONFIG_OPERATOR');

    const store = await createDiscoverableStoreFixture(pool, {
      location_name: 'SYNTH Finance Queue Store',
      latitude: 26.951,
      longitude: 75.851,
      fulfilment_modes: ['PLATFORM_DELIVERY'],
    });
    const suffix = `${Date.now()}`;
    const product = await catalogue.createProduct({
      context: vendorContext(store.ownerUserId),
      vendor_location_id: store.locationId,
      product_reference: `SYNTH-PROD-FQ${suffix}`,
      title: 'SYNTH Finance Queue Product',
      category: 'FRUIT_VEGETABLE',
      unit_label: 'EACH',
      tax_basis: 'EXEMPT',
      variable_weight: false,
      sku: `SYNTH-SKU-FQ${suffix}`,
      variant_title: 'SYNTH Finance Queue Variant',
      price_minor: 20_000,
      initial_stock_quantity: 10,
      low_stock_threshold: 1,
      now,
    });
    // A customer pays and the provider does not say how it went.
    const payUnknown = async (user: UuidV7, tag: string) => {
      const context = customerContext(user);
      const addressId = createUuidV7();
      await pool.query(
        `INSERT INTO marketplace.customer_addresses
          (customer_address_id,user_id,address_reference,label,pin_code,coordinates,request_id,correlation_id)
         VALUES ($1,$2,'SYNTH-ADDRESS-FQ-' || $4,'SYNTH Finance Home','302020',
           ST_SetSRID(ST_MakePoint(75.855,26.951),4326)::geography,$3,$3)`,
        [addressId, user, createUuidV7(), `${tag}${suffix}`.slice(-14)],
      );
      const cart = await carts.currentCart({ context, now });
      await carts.setCartAddress({ context, customer_address_id: addressId, now });
      await carts.addLine({
        context,
        vendor_location_id: store.locationId,
        catalogue_variant_id: product.catalogue_variant_id as UuidV7,
        quantity: 1,
        now,
      });
      const quote = await checkout.createQuote({ context, cart_id: cart.cart_id, now });
      const placed = await checkout.place({
        context,
        checkout_quote_id: quote.checkout_quote_id,
        provider_scenario: 'UNKNOWN',
        idempotency_key: `fq-${tag}-${user}`,
        now: later(1_000),
      });
      const payment = await pool.query<{
        payment_transaction_id: UuidV7;
        reference: string;
        amount: string;
      }>(
        `SELECT payment.payment_transaction_id, payment.provider_operation_reference AS reference,
                payment.amount_minor::text AS amount
           FROM marketplace.checkout_groups grouping
           JOIN marketplace.payment_transactions payment USING (payment_transaction_id)
          WHERE grouping.checkout_group_id = $1`,
        [placed.checkout_group_id],
      );
      const row = payment.rows[0];
      check(row, 'The unknown payment was not recorded');
      return { context, placed, ...row };
    };
    const webhook = (
      reference: string,
      eventId: string,
      outcome: 'SUCCEEDED' | 'FAILED',
      at: Date,
    ) => {
      const body = {
        provider_event_id: eventId,
        provider_operation_reference: reference,
        outcome,
        occurred_at: at.toISOString(),
      };
      return checkout.receiveWebhook({
        context: systemContext(people.system),
        ...body,
        signature: createHmac('sha256', webhookKey).update(JSON.stringify(body)).digest('hex'),
        now: at,
      });
    };

    // 1. Two payments with no answer, each in the payment-unknown queue.
    const first = await payUnknown(people.first, 'A');
    const second = await payUnknown(people.second, 'B');
    const unknownFirst = await exceptionFor('PAYMENT_UNKNOWN', first.reference);
    const unknownSecond = await exceptionFor('PAYMENT_UNKNOWN', second.reference);
    check(
      unknownFirst?.queue === 'PAYMENT_UNKNOWN' && unknownSecond?.queue === 'PAYMENT_UNKNOWN',
      'An unknown payment did not reach its queue',
    );
    const opened = await history(unknownFirst.finance_exception_id);
    check(opened[0]?.event_type === 'OPENED', 'An exception opened without a history');

    // 2. The first answer arrives; a second delivery of the same event contradicts it.
    const eventId = `SYNTH-EVENT-FQ-${suffix}`;
    await webhook(first.reference, eventId, 'SUCCEEDED', later(2_000));
    await rejects(
      () => webhook(first.reference, eventId, 'FAILED', later(3_000)),
      CheckoutInputError,
      'A contradicting delivery of the same event was accepted',
    );
    const conflict = await exceptionFor('WEBHOOK_CONFLICT', eventId);
    const settledFirst = await exceptionFor('PAYMENT_UNKNOWN', first.reference);
    check(
      conflict?.queue === 'WEBHOOK_DUPLICATION' && conflict.exception_state === 'OPEN',
      'The contradicting delivery was refused but not queued',
    );
    // The answer closed the unknown payment, on its record, as the operation that settled it.
    check(
      settledFirst?.exception_state === 'RESOLVED' &&
        settledFirst.resolution_code === 'RESOLVED_BY_OPERATION' &&
        settledFirst.resolved_by_user_id === null &&
        (await history(settledFirst.finance_exception_id)).at(-1)?.event_type === 'RESOLVED',
      `An exception closed by the money flow left no record (${JSON.stringify(settledFirst)})`,
    );

    // 3. The queues: all eleven, each row with its values, references and next action.
    await rejects(
      () => queues.queues({ context: outsider }),
      FinanceQueueAuthorizationError,
      'Someone outside finance read the queues',
    );
    await rejects(
      () => queues.queues({ context: first.context }),
      FinanceQueueAuthorizationError,
      'A customer read the finance queues',
    );
    await rejects(
      () => queues.queues({ context: operator, queue: 'EVERYTHING' }),
      FinanceQueueInputError,
      'An unknown queue was read',
    );
    const view = await queues.queues({ context: operator, now: later(5 * MINUTE) });
    const unknownRow = view.rows.find(
      (row) => row.finance_exception_id === unknownSecond.finance_exception_id,
    );
    check(
      FINANCE_QUEUES.every((queue) => view.summary.some((entry) => entry.key === queue.key)) &&
        view.summary.find((entry) => entry.key === 'PAYMENT_UNKNOWN')?.open === 1 &&
        unknownRow?.expected_minor === Number(second.amount) &&
        unknownRow.actual_minor === 0 &&
        unknownRow.provider_reference === second.reference &&
        unknownRow.business_reference === second.placed.checkout_group_id &&
        unknownRow.risk === 'HIGH' &&
        unknownRow.age_seconds > 0 &&
        !unknownRow.allowed_actions.includes('RECONCILE') &&
        unknownRow.next_safe_action === 'AWAIT_PROVIDER_WEBHOOK',
      `The queues did not carry what an operator needs (${JSON.stringify({ unknownRow, summary: view.summary.slice(0, 3) })})`,
    );

    // 4. An unanswered authorisation is the checkout's: not confirmed by hand,
    // not reconciled here, and settled when its answer arrives.
    await rejects(
      () =>
        queues.act({
          context: operator,
          finance_exception_id: unknownSecond.finance_exception_id,
          action: 'RESOLVE',
          expected_version: unknownSecond.version,
          reason_code: 'SYNTH_RESOLVE',
          resolution_code: 'PROVIDER_CONFIRMED',
          now: later(6 * MINUTE),
        }),
      FinanceQueueStateError,
      'A payment the provider has not answered was resolved as confirmed',
    );
    await rejects(
      () =>
        queues.act({
          context: operator,
          finance_exception_id: unknownSecond.finance_exception_id,
          action: 'RECONCILE',
          expected_version: unknownSecond.version,
          reason_code: 'SYNTH_RECONCILE',
          provider_state: 'SUCCEEDED',
          evidence_reference: 'SYNTH-EVIDENCE-PROVIDER-PORTAL',
          now: later(6 * MINUTE),
        }),
      FinanceQueueStateError,
      'An unanswered authorisation was reconciled by hand instead of by the checkout',
    );
    await webhook(second.reference, `${eventId}-B`, 'SUCCEEDED', later(6 * MINUTE));
    check(
      (await exceptionFor('PAYMENT_UNKNOWN', second.reference))?.exception_state === 'RESOLVED',
      "The checkout's answer did not settle the unknown payment",
    );

    // 5. The first order is packed and captured; the provider declines its refund.
    // The order was made when the webhook settled the payment.
    const orderA = (
      await pool.query<{
        vendor_order_id: UuidV7;
        order_reference: string;
        version: number;
      }>(
        `SELECT vendor_order_id, order_reference, version FROM marketplace.vendor_orders
          WHERE checkout_group_id = $1`,
        [first.placed.checkout_group_id],
      )
    ).rows[0];
    check(orderA, 'The first payment made no order');
    const vendor = vendorContext(store.ownerUserId);
    const accepted = await fulfilment.accept({
      context: vendor,
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: store.locationId,
      expected_version: orderA.version,
      preparation_estimate_seconds: 600,
      now: later(10_000),
    });
    const picking = await fulfilment.startPicking({
      context: vendor,
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: store.locationId,
      expected_version: accepted.version,
    });
    const lines = await pool.query<{ id: UuidV7; quantity: number; price: string }>(
      `SELECT vendor_order_line_id AS id, quantity, unit_price_minor::text AS price
         FROM marketplace.vendor_order_lines WHERE vendor_order_id = $1`,
      [orderA.vendor_order_id],
    );
    for (const line of lines.rows)
      await fulfilment.markLineFound({
        context: vendor,
        vendor_order_id: orderA.vendor_order_id,
        vendor_location_id: store.locationId,
        vendor_order_line_id: line.id,
        actual_quantity: line.quantity,
        actual_unit_price_minor: Number(line.price),
        expected_version: 0,
      });
    await fulfilment.markReady({
      context: vendor,
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: store.locationId,
      expected_version: picking.version,
      package_count: 1,
    });
    const captured = await orderMoney.settleAuthorizationForOrder({
      context: systemContext(people.system),
      vendor_order_id: orderA.vendor_order_id,
      now: later(MINUTE),
    });
    // The provider does not answer the capture either: an unanswered capture
    // is reconciled from the queue with the provider's answer and evidence.
    check(
      captured === 'CAPTURE_UNKNOWN',
      `The capture was expected to go unanswered (${captured})`,
    );
    const captureUnknown = await exceptionFor('PAYMENT_UNKNOWN', first.reference);
    check(
      captureUnknown?.exception_state === 'OPEN' && captureUnknown.queue === 'PAYMENT_UNKNOWN',
      'The unanswered capture was not queued',
    );
    await rejects(
      () =>
        queues.act({
          context: operator,
          finance_exception_id: captureUnknown.finance_exception_id,
          action: 'RECONCILE',
          expected_version: captureUnknown.version,
          reason_code: 'SYNTH_RECONCILE',
          provider_state: 'SUCCEEDED',
          now: later(MINUTE + 30_000),
        }),
      FinanceQueueInputError,
      'A capture was reconciled without evidence',
    );
    const reconciledCapture = await queues.act({
      context: operator,
      finance_exception_id: captureUnknown.finance_exception_id,
      action: 'RECONCILE',
      expected_version: captureUnknown.version,
      reason_code: 'PROVIDER_STATEMENT_CHECKED',
      provider_state: 'SUCCEEDED',
      evidence_reference: 'SYNTH-EVIDENCE-CAPTURE-PORTAL',
      now: later(MINUTE + 30_000),
    });
    const paymentState = await pool.query<{ payment_state: string }>(
      'SELECT payment_state FROM marketplace.payment_transactions WHERE payment_transaction_id = $1',
      [first.payment_transaction_id],
    );
    check(
      reconciledCapture.exception_state === 'RESOLVED' &&
        paymentState.rows[0]?.payment_state === 'CAPTURED',
      `Reconciling the capture from the queue did not settle it (${JSON.stringify(reconciledCapture)})`,
    );
    const refundReference = `SYNTH-REF-FQ-${suffix}`;
    const proposed = await money.proposeRefund({
      command_reference: `SYNTH-CMD-FQ-PROPOSE-${suffix}`,
      context: operator,
      delivery_minor: 0,
      discount_reversal_minor: 0,
      item_minor: 1_000,
      payment_transaction_id: first.payment_transaction_id,
      provider_operation_reference: refundReference,
      provider_scenario: 'DECLINE',
      source_order_reference: orderA.order_reference,
      tax_minor: 0,
      tip_minor: 0,
      trigger_code: 'PARTIAL_ITEM_REFUND',
      now: later(2 * MINUTE),
    });
    await money.approveAndSubmitRefund({
      command_reference: `SYNTH-CMD-FQ-APPROVE-${suffix}`,
      context: approver,
      expected_version: proposed.version,
      refund_id: proposed.refund_id,
      now: later(2 * MINUTE + 1_000),
    });
    const refundFailure = await exceptionFor('REFUND_FAILED', refundReference);
    const refundRow = (
      await queues.queues({ context: operator, queue: 'REFUND_FAILURE', now: later(3 * MINUTE) })
    ).rows.find((row) => row.finance_exception_id === refundFailure?.finance_exception_id);
    check(
      refundFailure?.queue === 'REFUND_FAILURE' &&
        refundRow?.expected_minor === 1_000 &&
        refundRow.actual_minor === 0 &&
        refundRow.business_reference === orderA.order_reference &&
        refundRow.next_safe_action === 'REPROPOSE_DECLINED_REFUND',
      `A declined refund was not queued with what it owed (${JSON.stringify(refundRow)})`,
    );

    // 5b. A refund the provider did not answer is reconciled from its queue.
    const unknownRefundReference = `SYNTH-REF-FQU-${suffix}`;
    const unanswered = await money.proposeRefund({
      command_reference: `SYNTH-CMD-FQU-PROPOSE-${suffix}`,
      context: operator,
      delivery_minor: 0,
      discount_reversal_minor: 0,
      item_minor: 500,
      payment_transaction_id: first.payment_transaction_id,
      provider_operation_reference: unknownRefundReference,
      provider_scenario: 'UNKNOWN',
      source_order_reference: orderA.order_reference,
      tax_minor: 0,
      tip_minor: 0,
      trigger_code: 'PARTIAL_ITEM_REFUND',
      now: later(4 * MINUTE),
    });
    await money.approveAndSubmitRefund({
      command_reference: `SYNTH-CMD-FQU-APPROVE-${suffix}`,
      context: approver,
      expected_version: unanswered.version,
      refund_id: unanswered.refund_id,
      now: later(4 * MINUTE + 1_000),
    });
    const refundUnknown = await exceptionFor('REFUND_UNKNOWN', unknownRefundReference);
    check(refundUnknown?.queue === 'REFUND_FAILURE', 'An unanswered refund was not queued');
    await rejects(
      () =>
        queues.act({
          context: operator,
          finance_exception_id: refundUnknown.finance_exception_id,
          action: 'RECONCILE',
          expected_version: refundUnknown.version,
          reason_code: 'SYNTH_RECONCILE',
          provider_state: 'SUCCEEDED',
          now: later(5 * MINUTE),
        }),
      FinanceQueueInputError,
      'A refund was reconciled without evidence',
    );
    const reconciled = await queues.act({
      context: operator,
      finance_exception_id: refundUnknown.finance_exception_id,
      action: 'RECONCILE',
      expected_version: refundUnknown.version,
      reason_code: 'PROVIDER_STATEMENT_CHECKED',
      provider_state: 'SUCCEEDED',
      evidence_reference: 'SYNTH-EVIDENCE-PROVIDER-PORTAL',
      now: later(5 * MINUTE),
    });
    const afterReconcile = await pool.query<{ attempts: number; last_retry_at: Date | null }>(
      'SELECT attempts, last_retry_at FROM marketplace.finance_exceptions WHERE finance_exception_id = $1',
      [refundUnknown.finance_exception_id],
    );
    check(
      reconciled.exception_state === 'RESOLVED' &&
        afterReconcile.rows[0]?.attempts === 1 &&
        afterReconcile.rows[0].last_retry_at !== null &&
        (await history(refundUnknown.finance_exception_id)).some(
          (event) => event.event_type === 'RETRIED' && event.actor_id === people.operator,
        ),
      `Reconciling from the queue did not settle it with the attempt on record (${JSON.stringify(reconciled)})`,
    );

    // 6. The conflict, worked: assigned, noted, evidenced, linked to a correction.
    let step = 0;
    const act = (
      context: ReturnType<typeof adminContext>,
      action: string,
      version: number,
      fields: Record<string, unknown> = {},
      id: UuidV7 = conflict.finance_exception_id,
    ) =>
      queues.act({
        context,
        finance_exception_id: id,
        action,
        expected_version: version,
        reason_code: `SYNTH_${action}`,
        // Each step a second after the last, so the history reads in order.
        now: later(20 * MINUTE + (step += 1) * 1_000),
        ...fields,
      });
    await rejects(
      () => act(operator, 'ASSIGN', conflict.version, { assignee_user_id: people.outsider }),
      FinanceQueueInputError,
      'An exception was assigned to someone outside finance',
    );
    await rejects(
      () => act(operator, 'ASSIGN', conflict.version + 5),
      FinanceQueueStateError,
      'An exception was changed against a stale version',
    );
    const assigned = await act(operator, 'ASSIGN', conflict.version);
    const noted = await act(operator, 'NOTE', assigned.version, {
      note: 'SYNTH called the provider.',
    });
    await rejects(
      () => act(operator, 'EVIDENCE', noted.version, { evidence_reference: 'screenshot.png' }),
      FinanceQueueInputError,
      'Evidence without a reference was attached',
    );
    const evidenced = await act(operator, 'EVIDENCE', noted.version, {
      evidence_reference: 'SYNTH-EVIDENCE-PROVIDER-EMAIL',
    });
    const ledger = await pool.query<{ ledger_transaction_id: UuidV7 }>(
      `SELECT ledger_transaction_id FROM marketplace.ledger_transactions
        WHERE provider_operation_reference = $1 LIMIT 1`,
      [first.reference],
    );
    const ledgerId = ledger.rows[0]?.ledger_transaction_id;
    check(ledgerId, 'The capture posted nothing to link a correction to');
    const correction = async (state: 'PROPOSED' | 'REJECTED') => {
      const id = createUuidV7();
      await pool.query(
        `INSERT INTO marketplace.financial_corrections
           (financial_correction_id, correction_reference, original_ledger_transaction_id,
            lifecycle_state, reason_code, evidence_reference, amount_minor, proposed_entries,
            proposed_by_user_id, approval_expires_at, request_id, correlation_id,
            closed_by_user_id, closing_reason_code, impact_minor, single_approval_limit_minor)
         VALUES ($1,$2,$3,$4,'SYNTH_CORRECTION','SYNTH-EVIDENCE-CORRECTION-1',100,'[]',$5,$6,$7,$7,$8,$9,100,0)`,
        [
          id,
          `SYNTH-CORRECTION-FQ-${state}-${suffix}`,
          ledgerId,
          state,
          people.colleague,
          later(DAY),
          createUuidV7(),
          state === 'REJECTED' ? people.approver : null,
          state === 'REJECTED' ? 'SYNTH_REJECTED' : null,
        ],
      );
      return id as UuidV7;
    };
    await rejects(
      () =>
        act(operator, 'LINK_CORRECTION', evidenced.version, {
          financial_correction_id: createUuidV7(),
        }),
      FinanceQueueNotFoundError,
      'A correction that does not exist was linked',
    );
    const rejectedCorrection = await correction('REJECTED');
    await rejects(
      () =>
        act(operator, 'LINK_CORRECTION', evidenced.version, {
          financial_correction_id: rejectedCorrection,
        }),
      FinanceQueueStateError,
      'A rejected correction was linked',
    );
    const linked = await act(operator, 'LINK_CORRECTION', evidenced.version, {
      financial_correction_id: await correction('PROPOSED'),
    });
    await rejects(
      () => act(operator, 'RESOLVE', linked.version, { resolution_code: 'CORRECTED' }),
      FinanceQueueStateError,
      'An exception was resolved as corrected on a correction not yet posted',
    );
    await rejects(
      () => act(operator, 'RESOLVE', linked.version, { resolution_code: 'WRITTEN_OFF' }),
      FinanceQueueInputError,
      'A write-off was resolved without its approval',
    );
    await rejects(
      () =>
        act(operator, 'RESOLVE', linked.version, {
          resolution_code: 'DUPLICATE',
          duplicate_of: refundFailure.finance_exception_id,
        }),
      FinanceQueueNotFoundError,
      'An exception was closed as a duplicate of one in another queue',
    );
    const linkedRow = await queues.detail({
      context: operator,
      finance_exception_id: conflict.finance_exception_id,
      now: later(21 * MINUTE),
    });
    check(
      linkedRow.correction?.state === 'PROPOSED' &&
        linkedRow.approval === 'CORRECTION_PROPOSED' &&
        linkedRow.evidence_count === 1 &&
        linkedRow.assigned_to_user_id === people.operator,
      `The row did not show its correction, approval and evidence (${JSON.stringify(linkedRow)})`,
    );

    // 7. A write-off needs a second person who may approve.
    const proposedOff = await act(operator, 'PROPOSE_WRITE_OFF', linked.version, {
      note: 'SYNTH the provider confirms nothing moved twice.',
    });
    await rejects(
      () => act(adminContext(people.colleague), 'APPROVE_WRITE_OFF', proposedOff.version),
      FinanceQueueAuthorizationError,
      'An operator without approval authority approved a write-off',
    );
    const writtenOff = await act(approver, 'APPROVE_WRITE_OFF', proposedOff.version);
    check(
      writtenOff.exception_state === 'RESOLVED' && writtenOff.resolution_code === 'WRITTEN_OFF',
      'The approved write-off did not resolve the exception',
    );
    // Reopened, it is open again with its resolution cleared; then closed plainly.
    const reopened = await act(operator, 'REOPEN', writtenOff.version);
    const reopenedRow = await pool.query<{
      resolution_code: string | null;
      exception_state: string;
    }>(
      'SELECT resolution_code, exception_state FROM marketplace.finance_exceptions WHERE finance_exception_id = $1',
      [conflict.finance_exception_id],
    );
    const closed = await act(operator, 'RESOLVE', reopened.version, {
      resolution_code: 'NO_MONEY_MOVED',
    });
    const trail = (await history(conflict.finance_exception_id)).map((event) => event.event_type);
    check(
      reopenedRow.rows[0]?.exception_state === 'OPEN' &&
        reopenedRow.rows[0].resolution_code === null &&
        closed.resolution_code === 'NO_MONEY_MOVED' &&
        trail.join(',') ===
          'OPENED,ASSIGNED,NOTE,EVIDENCE,CORRECTION_LINKED,WRITE_OFF_PROPOSED,RESOLVED,REOPENED,RESOLVED',
      `The exception's history is not the steps taken (${trail.join(',')})`,
    );
    const approvedBy = (await history(conflict.finance_exception_id)).find(
      (event) => event.reason_code === 'WRITTEN_OFF',
    );
    check(
      approvedBy?.actor_id === people.approver,
      'The write-off is not recorded against its approver',
    );

    // An approver who proposes a write-off may not approve it themselves.
    const refundNow = await exceptionFor('REFUND_FAILED', refundReference);
    check(refundNow, 'The refund failure disappeared');
    const selfProposed = await act(
      approver,
      'PROPOSE_WRITE_OFF',
      refundNow.version,
      { note: 'SYNTH customer refunded by hand.' },
      refundNow.finance_exception_id,
    );
    await rejects(
      () =>
        act(
          approver,
          'APPROVE_WRITE_OFF',
          selfProposed.version,
          {},
          refundNow.finance_exception_id,
        ),
      FinanceQueueStateError,
      'A write-off was approved by the person who proposed it',
    );

    // 8. The ledger audit's breach is queued, and cleared when it clears.
    const guard = await pool.query<{ tgname: string; definition: string }>(
      `SELECT trigger.tgname, pg_get_triggerdef(trigger.oid) AS definition
         FROM pg_trigger trigger JOIN pg_class relation ON relation.oid = trigger.tgrelid
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'marketplace' AND relation.relname = 'refund_events'
          AND NOT trigger.tgisinternal`,
    );
    const protection = guard.rows[0];
    check(protection, 'The refund history has no guard to lift');
    await pool.query(`DROP TRIGGER ${protection.tgname} ON marketplace.refund_events`);
    let breached: Awaited<ReturnType<FinanceQueueService['recordConservationBreaches']>>;
    try {
      breached = await queues.recordConservationBreaches({
        context: systemContext(people.system),
        now: later(30 * MINUTE),
      });
    } finally {
      await pool.query(protection.definition);
    }
    const breach = await pool.query<{
      finance_exception_id: string;
      queue: string;
      exception_state: string;
    }>(
      `SELECT finance_exception_id, queue, exception_state FROM marketplace.finance_exceptions
        WHERE operation_reference LIKE 'CONSERVATION:HISTORY_EDITABLE:%' ORDER BY created_at DESC LIMIT 1`,
    );
    const cleared = await queues.recordConservationBreaches({
      context: systemContext(people.system),
      now: later(31 * MINUTE),
    });
    const afterClear = await pool.query<{
      exception_state: string;
      resolution_code: string | null;
    }>(
      'SELECT exception_state, resolution_code FROM marketplace.finance_exceptions WHERE finance_exception_id = $1',
      [breach.rows[0]?.finance_exception_id],
    );
    check(
      breached.opened >= 1 &&
        breach.rows[0]?.queue === 'LEDGER_UNBALANCED' &&
        cleared.cleared >= 1 &&
        afterClear.rows[0]?.exception_state === 'RESOLVED' &&
        afterClear.rows[0].resolution_code === 'BREACH_CLEARED',
      `The conservation breach was not queued and then cleared (${JSON.stringify({ breached, cleared, breach: breach.rows })})`,
    );

    // 9. The record is protected; the looks and steps are audited.
    let halfResolved = false;
    try {
      await pool.query(
        `UPDATE marketplace.finance_exceptions SET resolved_at = NULL
          WHERE finance_exception_id = $1`,
        [conflict.finance_exception_id],
      );
    } catch (error) {
      halfResolved = (error as { code?: string }).code === '23514';
    }
    let rewritten = false;
    try {
      await pool.query(
        `UPDATE marketplace.finance_exception_events SET reason_code = 'SYNTH_REWRITTEN'
          WHERE finance_exception_id = $1`,
        [conflict.finance_exception_id],
      );
    } catch (error) {
      rewritten = (error as { code?: string }).code === '55000';
    }
    const audit = await pool.query<{ action: string }>(
      `SELECT DISTINCT action FROM marketplace.operational_audit_events
        WHERE target_kind = 'FINANCE_EXCEPTION' AND target_reference = $1`,
      [conflict.finance_exception_id],
    );
    const actions = new Set(audit.rows.map((row) => row.action));
    check(
      halfResolved &&
        rewritten &&
        [
          'FINANCE_EXCEPTION_ASSIGN',
          'FINANCE_EXCEPTION_NOTE',
          'FINANCE_EXCEPTION_EVIDENCE',
          'FINANCE_EXCEPTION_LINK_CORRECTION',
          'FINANCE_EXCEPTION_PROPOSE_WRITE_OFF',
          'FINANCE_EXCEPTION_APPROVE_WRITE_OFF',
          'FINANCE_EXCEPTION_REOPEN',
          'FINANCE_EXCEPTION_RESOLVE',
          'FINANCE_EXCEPTION_VIEWED',
        ].every((action) => actions.has(action)),
      `The record is not protected, or the audit is missing steps (${[...actions].join(', ')})`,
    );
  } finally {
    await Promise.all([
      pool.end(),
      queues.close(),
      orderMoney.close(),
      complete.close(),
      money.close(),
      fulfilment.close(),
      checkout.close(),
      carts.close(),
      catalogue.close(),
      inventory.close(),
    ]);
  }
}
