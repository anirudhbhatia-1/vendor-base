import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  parseUuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  LocalFakeMoneyProvider,
  SYNTHETIC_FINANCIAL_POLICY,
  type MoneyProviderAdapter,
} from '../src/money-policy.js';
import { MoneyLifecycleService } from '../src/money-lifecycle.js';
import { CompleteMoneyLifecycleService } from '../src/complete-money-lifecycle.js';
import { check } from './verify-support.js';

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
      financial_policy: SYNTHETIC_FINANCIAL_POLICY,
      policy_version_reference: 'SYNTH-POLICY-FIN-V1-TEST0001',
      now: new Date(now.getTime() + 6_000),
    });
    // Commission is now a rate rather than a flat fee: 500 basis points of the
    // 24,000 the vendor actually supplied is 1,200, where the old flat fee took
    // 500 regardless of basket size.
    check(
      Number(settlement.vendor_payable_minor) === 22_800 &&
        Number(settlement.partner_payable_minor) === 4_900 &&
        Number(settlement.platform_remainder_minor) === 1_200,
      'Refunded settlement did not preserve the approved policy balance',
    );
    const settlementLines = await pool.query<{ count: string }>(
      'SELECT count(*)::text count FROM marketplace.settlement_lines WHERE settlement_id=$1',
      [settlement.settlement_id],
    );
    check(settlementLines.rows[0]?.count === '7', 'Settlement component lines are incomplete');

    const payoutTime = new Date(new Date(settlement.eligible_at).getTime() + 1_000);
    const vendorPayout = await service.schedulePayout({
      // Matches the vendor payable above, which the commission rate reduced
      // from 23,500 to 22,800.
      amount_minor: 22_800,
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

    // 7.4: the void reaches the provider. A void the provider does not answer
    // leaves the money held, so the payment is unknown with an exception --
    // never VOIDED on the strength of a result nobody gave.
    const silentVoid: MoneyProviderAdapter = new (class extends LocalFakeMoneyProvider {
      override async void(): Promise<never> {
        throw new Error('Synthetic provider connection dropped');
      }
    })();
    const unansweredComplete = new CompleteMoneyLifecycleService({
      connection_string: connectionString,
      provider: silentVoid,
    });
    try {
      const heldPayment = await service.createPayment({
        allocations: [
          {
            delivery_minor: 0,
            discount_minor: 0,
            item_minor: 2_500,
            policy_version_reference: 'SYNTH-POLICY-D05-V1',
            source_order_reference: 'SYNTH-ORDER-MONEY-VOID-0004',
            tax_minor: 0,
            tip_minor: 0,
            vendor_location_id: location,
          },
        ],
        amount_minor: 2_500,
        command_reference: 'SYNTH-CMD-PAYMENT-CREATE-VOID-0004',
        context: context(),
        provider_operation_reference: 'SYNTH-PAY-VOID-0004',
        provider_scenario: 'SUCCESS',
        source_checkout_reference: 'SYNTH-CHECKOUT-MONEY-VOID-0004',
        now,
      });
      const heldAuthorized = await service.authorize({
        command_reference: 'SYNTH-CMD-PAYMENT-AUTH-VOID-0004',
        context: context(),
        expected_version: 1,
        payment_transaction_id: heldPayment.payment_transaction_id,
        now: new Date(now.getTime() + 7_000),
      });
      const unansweredVoid = await unansweredComplete.voidAuthorization({
        command_reference: 'SYNTH-CMD-PAYMENT-VOID-0004',
        context: context(),
        expected_version: heldAuthorized.version,
        payment_transaction_id: heldPayment.payment_transaction_id,
        now: new Date(now.getTime() + 8_000),
      });
      const voidEvidence = await pool.query<{ provider_result: string | null; exceptions: string }>(
        `SELECT e.provider_result,
                (SELECT count(*)::text FROM marketplace.finance_exceptions x
                  WHERE x.operation_reference='SYNTH-PAY-VOID-0004'
                    AND x.exception_kind='PAYMENT_UNKNOWN'
                    AND x.next_action_code='RECONCILE_VOID_SAME_OPERATION'
                    AND x.exception_state='OPEN') AS exceptions
           FROM marketplace.payment_events e
          WHERE e.command_reference='SYNTH-CMD-PAYMENT-VOID-0004'`,
      );
      check(
        unansweredVoid.payment_state === 'UNKNOWN_REQUIRES_RECONCILIATION' &&
          unansweredVoid.voided_at === null &&
          voidEvidence.rows[0]?.provider_result === 'UNKNOWN' &&
          voidEvidence.rows[0].exceptions === '1',
        `A void the provider did not answer was not held as unknown with an exception (${JSON.stringify(
          { state: unansweredVoid.payment_state, evidence: voidEvidence.rows[0] },
        )})`,
      );
    } finally {
      await unansweredComplete.close();
    }

    // A provider that answers with garbage -- or not at all -- at authorise
    // or capture used to escape the transaction: the in-flight record rolled
    // back, the caller got an error, and nobody was told money may have
    // moved. It is the same unknown as a provider that says "unknown".
    const garbled = await service.createPayment({
      allocations: [
        {
          delivery_minor: 0,
          discount_minor: 0,
          item_minor: 1_500,
          policy_version_reference: 'SYNTH-POLICY-D05-V1',
          source_order_reference: 'SYNTH-ORDER-MONEY-GARBLED-0005',
          tax_minor: 0,
          tip_minor: 0,
          vendor_location_id: location,
        },
      ],
      amount_minor: 1_500,
      command_reference: 'SYNTH-CMD-PAYMENT-CREATE-GARBLED-0005',
      context: context(),
      provider_operation_reference: 'SYNTH-PAY-GARBLED-0005',
      provider_scenario: 'MALFORMED',
      source_checkout_reference: 'SYNTH-CHECKOUT-MONEY-GARBLED-0005',
      now,
    });
    const garbledResult = await service.authorize({
      command_reference: 'SYNTH-CMD-PAYMENT-AUTH-GARBLED-0005',
      context: context(),
      expected_version: 1,
      payment_transaction_id: garbled.payment_transaction_id,
      now: new Date(now.getTime() + 9_000),
    });
    const garbledEvidence = await pool.query<{ events: string; exceptions: string }>(
      `SELECT (SELECT count(*)::text FROM marketplace.payment_events
                WHERE payment_transaction_id=$1) AS events,
              (SELECT count(*)::text FROM marketplace.finance_exceptions
                WHERE operation_reference='SYNTH-PAY-GARBLED-0005'
                  AND exception_kind='PAYMENT_UNKNOWN') AS exceptions`,
      [garbled.payment_transaction_id],
    );
    check(
      garbledResult.payment_state === 'UNKNOWN_REQUIRES_RECONCILIATION' &&
        garbledEvidence.rows[0]?.events === '3' &&
        garbledEvidence.rows[0].exceptions === '1',
      `A malformed provider response at authorise was not contained as unknown (${JSON.stringify({
        state: garbledResult.payment_state,
        evidence: garbledEvidence.rows[0],
      })})`,
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
          // Matches the payout amount so this row isolates a status mismatch;
          // the refund row above is the one that mismatches on amount.
          amount_minor: 22_800,
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
    // Three unknowns, each opened by the walk that made it: the provider's
    // UNKNOWN at authorise, the void it did not answer, the garbled authorise.
    check(
      evidence.rows[0]?.exceptions === '3' && evidence.rows[0].imbalance === '0',
      `Unknown-result evidence or ledger balance is incomplete (${JSON.stringify(evidence.rows[0])})`,
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

    // 10.1 — the posting engine. Each posting names what it records; the
    // catalogue governs what may be posted; a posting commits with the state
    // it records or not at all; the books are shown only when they balance.
    const refusal = async (sql: string, params: unknown[] = []) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql, params);
        await client.query('COMMIT');
        return null;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        return error instanceof Error ? error.message : String(error);
      } finally {
        client.release();
      }
    };
    const posted = await pool.query<{
      account_reference: string;
      component: string;
      partner_user_id: string | null;
      policy_version_reference: string | null;
      provider_operation_reference: string | null;
      source_order_reference: string | null;
      source_reference: string;
      transaction_kind: string;
      vendor_location_id: string | null;
    }>(
      `SELECT t.source_reference, t.transaction_kind, t.provider_operation_reference,
              t.policy_version_reference, e.account_reference, e.component,
              e.vendor_location_id, e.partner_user_id, e.source_order_reference
         FROM marketplace.ledger_transactions t
         JOIN marketplace.ledger_entries e USING (ledger_transaction_id)
        WHERE t.source_reference IN ($1,$2,$3,$4,'SYNTH-SETTLEMENT-MONEY-0001')`,
      [
        `SYNTH-CAPTURE-${payment.payment_transaction_id.toUpperCase()}`,
        `SYNTH-REFUND-${String(proposedRefund.refund_id).toUpperCase()}`,
        `SYNTH-PAYOUT-${String(vendorPayout.payout_id).toUpperCase()}`,
        `SYNTH-PAYOUT-${String(partnerPayout.payout_id).toUpperCase()}`,
      ],
    );
    const of = (kind: string) => posted.rows.filter((row) => row.transaction_kind === kind);
    check(
      of('CAPTURE').every(
        (row) =>
          row.provider_operation_reference === 'SYNTH-PAY-AUTH-0001' &&
          row.policy_version_reference === 'SYNTH-POLICY-D05-V1',
      ) &&
        of('REFUND').every((row) => row.provider_operation_reference === 'SYNTH-REF-MONEY-0001') &&
        of('SETTLEMENT').every(
          (row) => row.policy_version_reference === 'SYNTH-POLICY-FIN-V1-TEST0001',
        ) &&
        of('PAYOUT').some(
          (row) => row.provider_operation_reference === 'SYNTH-PAYOUT-VENDOR-0001',
        ) &&
        of('PAYOUT').some(
          (row) => row.provider_operation_reference === 'SYNTH-PAYOUT-PARTNER-0001',
        ),
      `A posting does not carry the provider operation or policy it was made under (${JSON.stringify(
        posted.rows.map((row) => [
          row.transaction_kind,
          row.provider_operation_reference,
          row.policy_version_reference,
        ]),
      )})`,
    );
    const owned = (component: string, account: string) =>
      posted.rows.filter((row) => row.component === component && row.account_reference === account);
    check(
      owned('VENDOR_PROCEEDS', 'SYNTH-ACCOUNT-VENDOR-PAYABLE').every(
        (row) =>
          row.vendor_location_id === location &&
          row.source_order_reference === 'SYNTH-ORDER-MONEY-0001',
      ) &&
        owned('PARTNER_OUTBOUND', 'SYNTH-ACCOUNT-PARTNER-PAYABLE').every(
          (row) =>
            row.partner_user_id === partner &&
            row.source_order_reference === 'SYNTH-ORDER-MONEY-0001',
        ) &&
        owned('PAYOUT', 'SYNTH-ACCOUNT-VENDOR-PAYABLE').every(
          (row) => row.vendor_location_id === location,
        ) &&
        owned('PAYOUT', 'SYNTH-ACCOUNT-PARTNER-PAYABLE').every(
          (row) => row.partner_user_id === partner,
        ) &&
        of('REFUND').every((row) => row.source_order_reference === 'SYNTH-ORDER-MONEY-0001') &&
        of('CAPTURE').some(
          (row) =>
            row.component === 'PLATFORM_REMAINDER' &&
            row.source_order_reference === 'SYNTH-ORDER-MONEY-0001' &&
            row.vendor_location_id === location,
        ),
      `An amount owed to a vendor or a partner, or paid out to them, names nobody or no order (${JSON.stringify(
        posted.rows.map((row) => [
          row.component,
          row.account_reference,
          row.vendor_location_id,
          row.partner_user_id,
          row.source_order_reference,
        ]),
      )})`,
    );

    // The catalogue governs the posting: no owner, no closed account, no
    // empty transaction, no rewriting the catalogue.
    const nobody = await refusal(
      `WITH t AS (
         INSERT INTO marketplace.ledger_transactions
           (ledger_transaction_id,source_reference,transaction_kind,posted_at,request_id,correlation_id)
         VALUES ($1,'SYNTH-ADJUSTMENT-NOBODY-0001','ADJUSTMENT',$2,$3,$3) RETURNING ledger_transaction_id)
       INSERT INTO marketplace.ledger_entries
         (ledger_entry_id,ledger_transaction_id,account_reference,component,debit_minor,credit_minor)
       SELECT $4::uuid, ledger_transaction_id,'SYNTH-ACCOUNT-VENDOR-PAYABLE','ADJUSTMENT',100,0 FROM t
       UNION ALL
       SELECT $5::uuid, ledger_transaction_id,'SYNTH-ACCOUNT-PLATFORM-CLEARING','ADJUSTMENT',0,100 FROM t`,
      [createUuidV7(), now, request, createUuidV7(), createUuidV7()],
    );
    check(
      nobody?.includes('names no vendor'),
      `An entry on the vendor payable naming no vendor was accepted (${nobody})`,
    );
    const empty = await refusal(
      `INSERT INTO marketplace.ledger_transactions
         (ledger_transaction_id,source_reference,transaction_kind,posted_at,request_id,correlation_id)
       VALUES ($1,'SYNTH-ADJUSTMENT-EMPTY-0001','ADJUSTMENT',$2,$3,$3)`,
      [createUuidV7(), now, request],
    );
    check(
      empty?.includes('has 0 entries'),
      `A transaction with no entries was accepted (${empty})`,
    );
    await pool.query(
      `UPDATE marketplace.ledger_accounts SET lifecycle_state='CLOSED'
        WHERE account_reference='SYNTH-ACCOUNT-PLATFORM-SUBSIDY'`,
    );
    try {
      const closed = await refusal(
        `WITH t AS (
           INSERT INTO marketplace.ledger_transactions
             (ledger_transaction_id,source_reference,transaction_kind,posted_at,request_id,correlation_id)
           VALUES ($1,'SYNTH-ADJUSTMENT-CLOSED-0001','ADJUSTMENT',$2,$3,$3) RETURNING ledger_transaction_id)
         INSERT INTO marketplace.ledger_entries
           (ledger_entry_id,ledger_transaction_id,account_reference,component,debit_minor,credit_minor)
         SELECT $4::uuid, ledger_transaction_id,'SYNTH-ACCOUNT-PLATFORM-SUBSIDY','ADJUSTMENT',100,0 FROM t
         UNION ALL
         SELECT $5::uuid, ledger_transaction_id,'SYNTH-ACCOUNT-PLATFORM-CLEARING','ADJUSTMENT',0,100 FROM t`,
        [createUuidV7(), now, request, createUuidV7(), createUuidV7()],
      );
      check(closed?.includes('is closed'), `A closed account accepted a posting (${closed})`);
    } finally {
      await pool.query(
        `UPDATE marketplace.ledger_accounts SET lifecycle_state='ACTIVE'
          WHERE account_reference='SYNTH-ACCOUNT-PLATFORM-SUBSIDY'`,
      );
    }
    const retyped = await refusal(
      `UPDATE marketplace.ledger_accounts SET account_type='REVENUE'
        WHERE account_reference='SYNTH-ACCOUNT-PLATFORM-SUBSIDY'`,
    );
    const dropped = await refusal(
      `DELETE FROM marketplace.ledger_accounts WHERE account_reference='SYNTH-ACCOUNT-PLATFORM-SUBSIDY'`,
    );
    const erased = await refusal(`DELETE FROM marketplace.ledger_transactions`);
    check(
      retyped?.includes('lifecycle state') && dropped?.includes('never deleted') && erased,
      `The catalogue or the history could be rewritten (${JSON.stringify([retyped, dropped, erased])})`,
    );

    // A capture and its posting are one transaction: when the posting cannot
    // be written the capture is not recorded either, and the same command
    // then succeeds whole.
    const atomic = await service.createPayment({
      allocations: [
        {
          delivery_minor: 0,
          discount_minor: 0,
          item_minor: 5_000,
          policy_version_reference: 'SYNTH-POLICY-D05-V1',
          source_order_reference: 'SYNTH-ORDER-MONEY-ATOMIC-0004',
          tax_minor: 0,
          tip_minor: 0,
          vendor_location_id: location,
        },
      ],
      amount_minor: 5_000,
      command_reference: 'SYNTH-CMD-PAYMENT-CREATE-ATOMIC-0004',
      context: context(),
      provider_operation_reference: 'SYNTH-PAY-ATOMIC-0004',
      provider_scenario: 'SUCCESS',
      source_checkout_reference: 'SYNTH-CHECKOUT-MONEY-ATOMIC-0004',
      now,
    });
    const atomicAuthorized = await service.authorize({
      command_reference: 'SYNTH-CMD-PAYMENT-AUTH-ATOMIC-0004',
      context: context(),
      expected_version: atomic.version,
      payment_transaction_id: atomic.payment_transaction_id,
      now: new Date(now.getTime() + 20_000),
    });
    const atomicSource = `SYNTH-CAPTURE-${atomic.payment_transaction_id.toUpperCase()}`;
    await pool.query(
      `CREATE FUNCTION marketplace.verify_refuse_posting() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.source_reference = '${atomicSource}' THEN
           RAISE EXCEPTION 'verifier refused the posting' USING ERRCODE = '23514';
         END IF;
         RETURN NEW;
       END $$;
       CREATE TRIGGER verify_refuse_posting BEFORE INSERT ON marketplace.ledger_transactions
       FOR EACH ROW EXECUTE FUNCTION marketplace.verify_refuse_posting()`,
    );
    let captureRefused: string | null = null;
    try {
      await service.capture({
        command_reference: 'SYNTH-CMD-PAYMENT-CAPTURE-ATOMIC-0004',
        context: context(),
        expected_version: atomicAuthorized.version,
        payment_transaction_id: atomic.payment_transaction_id,
        now: new Date(now.getTime() + 21_000),
      });
    } catch (error) {
      captureRefused = error instanceof Error ? error.message : String(error);
    } finally {
      await pool.query(
        `DROP TRIGGER verify_refuse_posting ON marketplace.ledger_transactions;
         DROP FUNCTION marketplace.verify_refuse_posting()`,
      );
    }
    const afterRefusal = await pool.query<{
      events: string;
      ledger: string;
      payment_state: string;
      version: number;
    }>(
      `SELECT payment_state, version,
              (SELECT count(*)::text FROM marketplace.payment_events
                WHERE payment_transaction_id=$1 AND event_type='PAYMENT_CAPTURED') AS events,
              (SELECT count(*)::text FROM marketplace.ledger_transactions WHERE source_reference=$2) AS ledger
         FROM marketplace.payment_transactions WHERE payment_transaction_id=$1`,
      [atomic.payment_transaction_id, atomicSource],
    );
    check(
      captureRefused?.includes('verifier refused the posting') &&
        afterRefusal.rows[0]?.payment_state === 'AUTHORIZED' &&
        afterRefusal.rows[0].version === atomicAuthorized.version &&
        afterRefusal.rows[0].events === '0' &&
        afterRefusal.rows[0].ledger === '0',
      `A capture whose posting failed was recorded anyway (${captureRefused}; ${JSON.stringify(afterRefusal.rows[0])})`,
    );
    const atomicCaptured = await service.capture({
      command_reference: 'SYNTH-CMD-PAYMENT-CAPTURE-ATOMIC-0004',
      context: context(),
      expected_version: atomicAuthorized.version,
      payment_transaction_id: atomic.payment_transaction_id,
      now: new Date(now.getTime() + 22_000),
    });
    const atomicLedger = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.ledger_transactions WHERE source_reference=$1`,
      [atomicSource],
    );
    check(
      atomicCaptured.payment_state === 'CAPTURED' && atomicLedger.rows[0]?.count === '1',
      'The same capture command did not then succeed whole',
    );

    // The books, shown only balanced: the vendor's and the partner's payables
    // were credited by the settlement and cleared by their payouts.
    const books = await complete.ledgerTrialBalance({ context: context() });
    const account = (reference: string) =>
      books.accounts.find((row) => row.account_reference === reference);
    check(
      books.balanced &&
        books.totals.debit_minor === books.totals.credit_minor &&
        books.accounts.length >= 8 &&
        account('SYNTH-ACCOUNT-VENDOR-PAYABLE')?.balance_minor === 0 &&
        account('SYNTH-ACCOUNT-PARTNER-PAYABLE')?.balance_minor === 0 &&
        account('SYNTH-ACCOUNT-VENDOR-PAYABLE')?.entries === 2,
      `The trial balance does not read the books as posted (${JSON.stringify(books)})`,
    );
    const read = await complete.ledgerTransaction({
      context: context(),
      ledger_transaction_id: parseUuidV7(originalId),
    });
    check(
      read.transaction_kind === 'CAPTURE' &&
        read.provider_operation_reference === 'SYNTH-PAY-AUTH-0001' &&
        read.entries.length === 2 &&
        read.entries.some(
          (entry: { source_order_reference: string | null }) =>
            entry.source_order_reference === 'SYNTH-ORDER-MONEY-0001',
        ),
      `A posting cannot be read back with its entries and references (${JSON.stringify(read)})`,
    );
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
