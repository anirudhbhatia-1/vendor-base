import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  parseUuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { MoneyLifecycleService } from '../src/money-lifecycle.js';
import { CompleteMoneyLifecycleService } from '../src/complete-money-lifecycle.js';

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const TABLES = `marketplace.financial_correction_events, marketplace.financial_corrections,
  marketplace.finance_exceptions, marketplace.provider_statement_rows,
  marketplace.provider_statement_imports, marketplace.payouts, marketplace.payout_batches,
  marketplace.settlement_lines, marketplace.settlements, marketplace.ledger_entries,
  marketplace.ledger_transactions, marketplace.refund_events, marketplace.refunds,
  marketplace.payment_events, marketplace.payment_allocations, marketplace.payment_transactions CASCADE`;

export async function verifyMoneyLifecycle(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, application_name: 'money-lifecycle-verifier' });
  const service = new MoneyLifecycleService({ connection_string: connectionString });
  const complete = new CompleteMoneyLifecycleService({ connection_string: connectionString });
  const now = new Date('2026-08-24T06:00:00.000Z');
  const admin = createUuidV7({ now_ms: now.getTime() });
  const approver = createUuidV7({ now_ms: now.getTime() + 1 });
  const partner = createUuidV7({ now_ms: now.getTime() + 2 });
  const vendor = createUuidV7({ now_ms: now.getTime() + 3 });
  const location = createUuidV7({ now_ms: now.getTime() + 4 });
  const request = createUuidV7({ now_ms: now.getTime() + 5 });
  const context = (actorId = admin) =>
    createRequestContext({
      actor: createAuthenticatedActor({
        actor_id: actorId,
        actor_kind: 'admin',
        session_id: createUuidV7(),
      }),
    });
  try {
    await pool.query(`TRUNCATE ${TABLES}`);
    await pool.query(
      'INSERT INTO marketplace.users (user_id) VALUES ($1),($2),($3) ON CONFLICT DO NOTHING',
      [admin, approver, partner],
    );
    await pool.query(
      `INSERT INTO marketplace.vendors
        (vendor_id,business_name,profile_description,lifecycle_state,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,'SYNTH Money Vendor','Synthetic money verification vendor','ACTIVE',$2,$2,$3,$3)`,
      [vendor, request, now],
    );
    await pool.query(
      `INSERT INTO marketplace.vendor_locations
        (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
         coordinates,category,lifecycle_state,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,'SYNTH Money Location','Synthetic money verification location','Asia/Kolkata',
         ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,
         'FRUIT_VEGETABLE','ACTIVE',$3,$3,$4,$4)`,
      [location, vendor, request, now],
    );

    const payment = await service.createPayment({
      allocations: [
        {
          delivery_minor: 3_900,
          discount_minor: 0,
          item_minor: 30_000,
          policy_version_reference: 'SYNTH-POLICY-D05-V1',
          source_order_reference: 'SYNTH-ORDER-MONEY-0001',
          tax_minor: 0,
          tip_minor: 1_000,
          vendor_location_id: location,
        },
      ],
      amount_minor: 34_900,
      command_reference: 'SYNTH-CMD-PAYMENT-CREATE-0001',
      context: context(),
      provider_operation_reference: 'SYNTH-PAY-AUTH-0001',
      provider_scenario: 'SUCCESS',
      source_checkout_reference: 'SYNTH-CHECKOUT-MONEY-0001',
      now,
    });
    const replay = await service
      .createPayment({
        allocations: [],
        amount_minor: 1,
        command_reference: 'SYNTH-CMD-PAYMENT-CREATE-0001',
        context: context(),
        provider_operation_reference: 'SYNTH-PAY-DIFFERENT-0001',
        provider_scenario: 'DECLINE',
        source_checkout_reference: 'SYNTH-CHECKOUT-DIFFERENT-0001',
        now,
      })
      .catch(() => null);
    check(replay === null, 'Changed payment retry was not rejected before mutation');

    const authorized = await service.authorize({
      command_reference: 'SYNTH-CMD-PAYMENT-AUTH-0001',
      context: context(),
      expected_version: payment.version,
      payment_transaction_id: payment.payment_transaction_id,
      now: new Date(now.getTime() + 1_000),
    });
    check(authorized.payment_state === 'AUTHORIZED', 'Synthetic authorization did not succeed');
    const captured = await service.capture({
      command_reference: 'SYNTH-CMD-PAYMENT-CAPTURE-0001',
      context: context(),
      expected_version: authorized.version,
      payment_transaction_id: payment.payment_transaction_id,
      now: new Date(now.getTime() + 2_000),
    });
    check(captured.payment_state === 'CAPTURED', 'Synthetic capture did not succeed');
    check(
      Number(captured.captured_amount_minor) === 34_900,
      'Capture did not retain its resolved amount',
    );

    const proposedRefund = await service.proposeRefund({
      command_reference: 'SYNTH-CMD-REFUND-PROPOSE-0001',
      context: context(),
      delivery_minor: 0,
      discount_reversal_minor: 0,
      item_minor: 6_000,
      payment_transaction_id: payment.payment_transaction_id,
      provider_operation_reference: 'SYNTH-REF-MONEY-0001',
      provider_scenario: 'SUCCESS',
      source_order_reference: 'SYNTH-ORDER-MONEY-0001',
      tax_minor: 0,
      tip_minor: 0,
      trigger_code: 'PARTIAL_ITEM_REFUND',
      now: new Date(now.getTime() + 3_000),
    });
    let selfApprovalBlocked = false;
    try {
      await service.approveAndSubmitRefund({
        command_reference: 'SYNTH-CMD-REFUND-SELF-0001',
        context: context(),
        expected_version: 1,
        refund_id: proposedRefund.refund_id,
        now: new Date(now.getTime() + 4_000),
      });
    } catch {
      selfApprovalBlocked = true;
    }
    check(selfApprovalBlocked, 'Refund maker-checker control allowed self approval');
    const refunded = await service.approveAndSubmitRefund({
      command_reference: 'SYNTH-CMD-REFUND-SUBMIT-0001',
      context: context(approver),
      expected_version: 1,
      refund_id: proposedRefund.refund_id,
      now: new Date(now.getTime() + 5_000),
    });
    check(refunded.refund_state === 'SUCCEEDED', 'Approved synthetic refund did not succeed');

    const settlement = await service.createSettlement({
      completed: true,
      context: context(),
      customer_captured_minor: 34_900,
      partner_outbound_minor: 3_900,
      partner_return_minor: 0,
      partner_tip_minor: 1_000,
      partner_user_id: partner,
      partner_wait_minor: 0,
      payment_transaction_id: payment.payment_transaction_id,
      source_order_reference: 'SYNTH-ORDER-MONEY-0001',
      successful_refunds_minor: 6_000,
      vendor_item_minor: 30_000,
      vendor_location_id: location,
      now: new Date(now.getTime() + 6_000),
    });
    check(
      Number(settlement.vendor_payable_minor) === 23_500 &&
        Number(settlement.partner_payable_minor) === 4_900 &&
        Number(settlement.platform_remainder_minor) === 500,
      'Refunded settlement did not preserve the approved policy balance',
    );
    const settlementLines = await pool.query<{ count: string }>(
      'SELECT count(*)::text count FROM marketplace.settlement_lines WHERE settlement_id=$1',
      [settlement.settlement_id],
    );
    check(settlementLines.rows[0]?.count === '7', 'Settlement component lines are incomplete');

    const payoutTime = new Date(new Date(settlement.eligible_at).getTime() + 1_000);
    const vendorPayout = await service.schedulePayout({
      amount_minor: 23_500,
      beneficiary_kind: 'VENDOR',
      beneficiary_reference: 'SYNTH-BENEFICIARY-VENDOR-0001',
      context: context(),
      provider_operation_reference: 'SYNTH-PAYOUT-VENDOR-0001',
      provider_scenario: 'SUCCESS',
      settlement_id: settlement.settlement_id,
      now: payoutTime,
    });
    const paidVendor = await service.submitPayout({
      context: context(),
      expected_version: 1,
      payout_id: vendorPayout.payout_id,
      now: new Date(payoutTime.getTime() + 1_000),
    });
    check(paidVendor.payout_state === 'PAID', 'Vendor payout did not reach PAID');
    const partnerPayout = await service.schedulePayout({
      amount_minor: 4_900,
      beneficiary_kind: 'PARTNER',
      beneficiary_reference: 'SYNTH-BENEFICIARY-PARTNER-0001',
      context: context(),
      provider_operation_reference: 'SYNTH-PAYOUT-PARTNER-0001',
      provider_scenario: 'UNKNOWN',
      settlement_id: settlement.settlement_id,
      now: payoutTime,
    });
    const uncertainPayout = await service.submitPayout({
      context: context(),
      expected_version: 1,
      payout_id: partnerPayout.payout_id,
      now: new Date(payoutTime.getTime() + 2_000),
    });
    check(uncertainPayout.payout_state === 'SUBMITTED', 'Unknown payout was not contained');
    const reconciledPayout = await service.reconcilePayout({
      amount_minor: 4_900,
      context: context(approver),
      payout_id: partnerPayout.payout_id,
      provider_state: 'SUCCEEDED',
      statement_reference: 'SYNTH-STMT-PARTNER-0001',
      now: new Date(payoutTime.getTime() + 3_000),
    });
    check(reconciledPayout.payout_state === 'PAID', 'Statement did not resolve unknown payout');

    const unknown = await service.createPayment({
      allocations: [
        {
          delivery_minor: 0,
          discount_minor: 0,
          item_minor: 1_000,
          policy_version_reference: 'SYNTH-POLICY-D05-V1',
          source_order_reference: 'SYNTH-ORDER-MONEY-0002',
          tax_minor: 0,
          tip_minor: 0,
          vendor_location_id: location,
        },
      ],
      amount_minor: 1_000,
      command_reference: 'SYNTH-CMD-PAYMENT-CREATE-0002',
      context: context(),
      provider_operation_reference: 'SYNTH-PAY-AUTH-UNKNOWN-0002',
      provider_scenario: 'UNKNOWN',
      source_checkout_reference: 'SYNTH-CHECKOUT-MONEY-0002',
      now,
    });
    const uncertain = await service.authorize({
      command_reference: 'SYNTH-CMD-PAYMENT-AUTH-0002',
      context: context(),
      expected_version: 1,
      payment_transaction_id: unknown.payment_transaction_id,
      now: new Date(now.getTime() + 4_000),
    });
    check(
      uncertain.payment_state === 'UNKNOWN_REQUIRES_RECONCILIATION',
      'Unknown provider result was not contained',
    );

    const voidPayment = await service.createPayment({
      allocations: [
        {
          delivery_minor: 0,
          discount_minor: 0,
          item_minor: 2_000,
          policy_version_reference: 'SYNTH-POLICY-D05-V1',
          source_order_reference: 'SYNTH-ORDER-MONEY-VOID-0003',
          tax_minor: 0,
          tip_minor: 0,
          vendor_location_id: location,
        },
      ],
      amount_minor: 2_000,
      command_reference: 'SYNTH-CMD-PAYMENT-CREATE-VOID-0003',
      context: context(),
      provider_operation_reference: 'SYNTH-PAY-VOID-0003',
      provider_scenario: 'SUCCESS',
      source_checkout_reference: 'SYNTH-CHECKOUT-MONEY-VOID-0003',
      now,
    });
    const voidAuthorized = await service.authorize({
      command_reference: 'SYNTH-CMD-PAYMENT-AUTH-VOID-0003',
      context: context(),
      expected_version: 1,
      payment_transaction_id: voidPayment.payment_transaction_id,
      now: new Date(now.getTime() + 7_000),
    });
    const voided = await complete.voidAuthorization({
      command_reference: 'SYNTH-CMD-PAYMENT-VOID-0003',
      context: context(),
      expected_version: voidAuthorized.version,
      payment_transaction_id: voidPayment.payment_transaction_id,
      now: new Date(now.getTime() + 8_000),
    });
    check(
      voided.payment_state === 'VOIDED' && Number(voided.voided_amount_minor) === 2_000,
      'Unused authorization was not voided exactly once',
    );

    const payoutJob = await complete.scheduleDailyPayoutJob({ context: context(), now });
    const payoutJobReplay = await complete.scheduleDailyPayoutJob({ context: context(), now });
    check(
      payoutJob.job_id === payoutJobReplay.job_id &&
        new Date(payoutJob.run_at).toISOString() === '2026-08-24T12:30:00.000Z',
      'Daily payout schedule is not idempotent at 18:00 Asia/Kolkata',
    );
    const batch = await complete.createPayoutBatch({
      beneficiary_kind: 'VENDOR',
      context: context(),
      now: new Date(payoutTime.getTime() + 10_000),
      provider_scenario: 'SUCCESS',
    });
    const batchReplay = await complete.createPayoutBatch({
      beneficiary_kind: 'VENDOR',
      context: context(),
      now: new Date(payoutTime.getTime() + 10_000),
      provider_scenario: 'SUCCESS',
    });
    check(
      batch.payout_batch_id === batchReplay.payout_batch_id,
      'Daily payout batch replay created duplicate payouts',
    );

    const imported = await complete.importProviderStatement({
      context: context(),
      now: new Date(payoutTime.getTime() + 11_000),
      rows: [
        {
          amount_minor: 34_900,
          operation_kind: 'PAYMENT',
          provider_operation_reference: 'SYNTH-PAY-AUTH-0001',
          provider_state: 'SUCCEEDED',
        },
        {
          amount_minor: 34_900,
          operation_kind: 'PAYMENT',
          provider_operation_reference: 'SYNTH-PAY-AUTH-0001',
          provider_state: 'SUCCEEDED',
        },
        {
          amount_minor: 5_999,
          operation_kind: 'REFUND',
          provider_operation_reference: 'SYNTH-REF-MONEY-0001',
          provider_state: 'SUCCEEDED',
        },
        {
          amount_minor: 23_500,
          operation_kind: 'PAYOUT',
          provider_operation_reference: 'SYNTH-PAYOUT-VENDOR-0001',
          provider_state: 'FAILED',
        },
        {
          amount_minor: 777,
          operation_kind: 'PAYMENT',
          provider_operation_reference: 'SYNTH-PAY-NOT-FOUND-0009',
          provider_state: 'UNKNOWN',
        },
      ],
      statement_reference: 'SYNTH-STMT-IMPORT-0001',
    });
    const classes = imported.rows.map(
      (row: { reconciliation_class: string }) => row.reconciliation_class,
    );
    check(
      ['MATCHED', 'DUPLICATE', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH', 'UNMATCHED'].every(
        (classification) => classes.includes(classification),
      ),
      'Provider statement import did not classify every reconciliation outcome',
    );
    const importReplay = await complete.importProviderStatement({
      context: context(),
      rows: [],
      statement_reference: 'SYNTH-STMT-IMPORT-0001',
    });
    check(
      importReplay.provider_statement_import_id === imported.provider_statement_import_id,
      'Statement reference replay was not idempotent',
    );

    const originalLedger = await pool.query<{ ledger_transaction_id: string }>(
      `SELECT ledger_transaction_id FROM marketplace.ledger_transactions
        WHERE transaction_kind='CAPTURE' ORDER BY posted_at LIMIT 1`,
    );
    const originalId = originalLedger.rows[0]?.ledger_transaction_id;
    check(originalId, 'Capture ledger transaction missing for correction');
    const correction = await complete.proposeCorrection({
      amount_minor: 100,
      context: context(),
      correction_reference: 'SYNTH-CORRECTION-MONEY-0001',
      entries: [
        {
          account_reference: 'SYNTH-ACCOUNT-PLATFORM-SUBSIDY',
          component: 'ADJUSTMENT',
          credit_minor: 0,
          debit_minor: 100,
        },
        {
          account_reference: 'SYNTH-ACCOUNT-FAKE-PROVIDER',
          component: 'ADJUSTMENT',
          credit_minor: 100,
          debit_minor: 0,
        },
      ],
      evidence_reference: 'SYNTH-EVIDENCE-MONEY-0001',
      now: new Date(payoutTime.getTime() + 12_000),
      original_ledger_transaction_id: parseUuidV7(originalId),
      reason_code: 'PROVIDER_ROUNDING_CORRECTION',
    });
    let correctionSelfApprovalBlocked = false;
    try {
      await complete.approveAndPostCorrection({
        context: context(),
        expected_version: 1,
        financial_correction_id: correction.financial_correction_id,
        now: new Date(payoutTime.getTime() + 13_000),
      });
    } catch {
      correctionSelfApprovalBlocked = true;
    }
    check(correctionSelfApprovalBlocked, 'Correction maker was allowed to approve their own work');
    const postedCorrection = await complete.approveAndPostCorrection({
      context: context(approver),
      expected_version: 1,
      financial_correction_id: correction.financial_correction_id,
      now: new Date(payoutTime.getTime() + 14_000),
    });
    check(
      postedCorrection.lifecycle_state === 'POSTED' &&
        postedCorrection.reversal_ledger_transaction_id &&
        postedCorrection.adjustment_ledger_transaction_id,
      'Correction did not post a linked reversal and adjustment',
    );
    const evidence = await pool.query<{ exceptions: string; imbalance: string }>(
      `SELECT
        (SELECT count(*)::text FROM marketplace.finance_exceptions WHERE exception_kind='PAYMENT_UNKNOWN') AS exceptions,
        (SELECT (sum(debit_minor)-sum(credit_minor))::text FROM marketplace.ledger_entries) AS imbalance`,
    );
    check(
      evidence.rows[0]?.exceptions === '1' && evidence.rows[0].imbalance === '0',
      'Unknown-result evidence or ledger balance is incomplete',
    );
    let protectedHistory = false;
    try {
      await pool.query('UPDATE marketplace.ledger_entries SET debit_minor=debit_minor+1');
    } catch {
      protectedHistory = true;
    }
    check(protectedHistory, 'Ledger history was mutable');
    let protectedStatement = false;
    try {
      await pool.query(
        `UPDATE marketplace.provider_statement_rows SET amount_minor=amount_minor+1
          WHERE provider_statement_import_id=$1`,
        [imported.provider_statement_import_id],
      );
    } catch {
      protectedStatement = true;
    }
    check(protectedStatement, 'Provider statement history was mutable');
  } finally {
    await complete.close();
    await service.close();
    await pool.query(`TRUNCATE ${TABLES}`).catch(() => undefined);
    await pool
      .query('DELETE FROM marketplace.vendor_locations WHERE vendor_id=$1', [vendor])
      .catch(() => undefined);
    await pool
      .query('DELETE FROM marketplace.vendors WHERE vendor_id=$1', [vendor])
      .catch(() => undefined);
    await pool
      .query('DELETE FROM marketplace.users WHERE user_id=ANY($1::uuid[])', [
        [admin, approver, partner],
      ])
      .catch(() => undefined);
    await pool.end();
  }
}
