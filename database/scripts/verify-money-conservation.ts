import { createRequestId, createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { SYNTHETIC_FINANCIAL_POLICY } from '../src/money-policy.js';
import { MoneyLifecycleService } from '../src/money-lifecycle.js';
import { CompleteMoneyLifecycleService } from '../src/complete-money-lifecycle.js';
import { auditMoneyConservation, type ConservationBreach } from '../src/money-conservation.js';
import { adminContext, check } from './verify-support.js';

/**
 * 10.7 -- money is conserved when things happen at once, and the audit that
 * says so can tell when it is not.
 *
 * Concurrency: two refunds race for the last of a payment's allowance; two
 * partner batch runs start together; one payout is submitted twice at once;
 * one correction is approved by two operators at once. Each settles to one
 * outcome, and the books agree with the records after it.
 *
 * The audit: inside a transaction that is rolled back, each kind of breach is
 * planted in turn -- money on a shop's, a partner's, the customers' or the
 * provider's account that no record explains, a statement row nobody owns,
 * a history table whose guard is gone -- and the audit must name each one.
 *
 * June 2027, so its batches and postings are its own.
 */
export async function verifyMoneyConservation(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, application_name: 'money-conservation-verifier' });
  const money = new MoneyLifecycleService({ connection_string: connectionString });
  const complete = new CompleteMoneyLifecycleService({ connection_string: connectionString });
  // A second service, so the racing calls do not share one pool's ordering.
  const rival = new CompleteMoneyLifecycleService({ connection_string: connectionString });
  const rivalMoney = new MoneyLifecycleService({ connection_string: connectionString });
  const start = new Date('2027-06-01T04:00:00.000Z');
  const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
  const maker = createUuidV7({ now_ms: start.getTime() });
  const checker = createUuidV7({ now_ms: start.getTime() + 1 });
  const thirdOperator = createUuidV7({ now_ms: start.getTime() + 2 });
  const rider = createUuidV7({ now_ms: start.getTime() + 3 });
  const vendor = createUuidV7({ now_ms: start.getTime() + 4 });
  const location = createUuidV7({ now_ms: start.getTime() + 5 });
  const request = createUuidV7({ now_ms: start.getTime() + 6 });
  const tag = String(maker).replaceAll('-', '').slice(-10).toUpperCase();
  const ops = adminContext(maker);
  const order = `SYNTH-ORDER-CONSERVE-${tag}`;

  const conserved = async (after: string) => {
    const report = await auditMoneyConservation(pool);
    check(
      report.conserved,
      `Money is not conserved after ${after} (${JSON.stringify(report.breaches)})`,
    );
  };

  try {
    await pool.query('INSERT INTO marketplace.users (user_id) VALUES ($1),($2),($3),($4)', [
      maker,
      checker,
      thirdOperator,
      rider,
    ]);
    await pool.query(
      `INSERT INTO marketplace.vendors
        (vendor_id,business_name,profile_description,lifecycle_state,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,'SYNTH Conservation Vendor','Synthetic conservation vendor','ACTIVE',$2,$2,$3,$3)`,
      [vendor, request, start],
    );
    await pool.query(
      `INSERT INTO marketplace.vendor_locations
        (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
         coordinates,category,lifecycle_state,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,'SYNTH Conservation Location','Synthetic conservation location','Asia/Kolkata',
         ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,
         'FRUIT_VEGETABLE','ACTIVE',$3,$3,$4,$4)`,
      [location, vendor, request, start],
    );
    const payment = await money.createPayment({
      allocations: [
        {
          delivery_minor: 1_000,
          discount_minor: 0,
          item_minor: 9_000,
          policy_version_reference: 'SYNTH-POLICY-CONSERVE-V1',
          source_order_reference: order,
          tax_minor: 0,
          tip_minor: 0,
          vendor_location_id: location,
        },
      ],
      amount_minor: 10_000,
      command_reference: `SYNTH-CMD-CONSERVE-PAY-${tag}`,
      context: ops,
      provider_operation_reference: `SYNTH-PAY-CONSERVE-${tag}`,
      provider_scenario: 'SUCCESS',
      source_checkout_reference: `SYNTH-CHECKOUT-CONSERVE-${tag}`,
      now: start,
    });
    const authorized = await money.authorize({
      command_reference: `SYNTH-CMD-CONSERVE-AUTH-${tag}`,
      context: ops,
      expected_version: payment.version,
      payment_transaction_id: payment.payment_transaction_id,
      now: start,
    });
    await money.capture({
      command_reference: `SYNTH-CMD-CONSERVE-CAPTURE-${tag}`,
      context: ops,
      expected_version: authorized.version,
      payment_transaction_id: payment.payment_transaction_id,
      now: start,
    });

    // 1. Eight refunds, each on its own connection, race for 3,000 each of a
    // 10,000 capture: three fit and no more. Warmed first, so the race is
    // between queries rather than between connection handshakes.
    const racers = Array.from(
      { length: 8 },
      () => new MoneyLifecycleService({ connection_string: connectionString }),
    );
    try {
      await Promise.all(
        racers.map((service) => service.listRefunds({ context: ops }).catch(() => null)),
      );
      const race = await Promise.allSettled(
        racers.map((service, index) =>
          service.proposeRefund({
            command_reference: `SYNTH-CMD-CONSERVE-RACE-${index}-${tag}`,
            context: ops,
            delivery_minor: 0,
            discount_reversal_minor: 0,
            item_minor: 3_000,
            now: at(1),
            payment_transaction_id: payment.payment_transaction_id,
            provider_operation_reference: `SYNTH-REF-CONSERVE-RACE-${index}-${tag}`,
            provider_scenario: 'SUCCESS',
            source_order_reference: order,
            tax_minor: 0,
            tip_minor: 0,
            trigger_code: 'PARTIAL_ITEM_REFUND',
          }),
        ),
      );
      check(
        race.filter((outcome) => outcome.status === 'fulfilled').length === 3,
        `Refunds racing for one allowance overran it (${race.filter((outcome) => outcome.status === 'fulfilled').length} of 8 fitted where 3 can)`,
      );
    } finally {
      await Promise.all(racers.map((service) => service.close()));
    }

    // 2. One payout submitted twice at once is paid and posted once.
    const settlement = await money.createSettlement({
      completed: true,
      context: ops,
      customer_captured_minor: 10_000,
      financial_policy: SYNTHETIC_FINANCIAL_POLICY,
      now: start,
      partner_outbound_minor: 0,
      partner_return_minor: 0,
      partner_tip_minor: 0,
      partner_wait_minor: 0,
      payment_transaction_id: payment.payment_transaction_id,
      policy_version_reference: 'SYNTH-POLICY-CONSERVE-V1',
      source_order_reference: order,
      successful_refunds_minor: 0,
      vendor_item_minor: 9_000,
      vendor_location_id: location,
    });
    const scheduled = await money.schedulePayout({
      amount_minor: Number(settlement.vendor_payable_minor),
      beneficiary_kind: 'VENDOR',
      beneficiary_reference: `SYNTH-BENEFICIARY-CONSERVE-${tag}`,
      context: ops,
      now: at(2 * 24 * 60),
      provider_operation_reference: `SYNTH-PAYOUT-CONSERVE-${tag}`,
      provider_scenario: 'SUCCESS',
      settlement_id: settlement.settlement_id,
    });
    await Promise.allSettled(
      [money, rivalMoney].map((service) =>
        service.submitPayout({
          context: ops,
          expected_version: scheduled.version,
          now: at(2 * 24 * 60 + 1),
          payout_id: scheduled.payout_id,
        }),
      ),
    );
    const payoutPostings = await pool.query<{ count: string; state: string }>(
      `SELECT (SELECT count(*) FROM marketplace.ledger_transactions
                WHERE transaction_kind='PAYOUT' AND provider_operation_reference=$1)::text AS count,
              (SELECT payout_state FROM marketplace.payouts WHERE payout_id=$2) AS state`,
      [`SYNTH-PAYOUT-CONSERVE-${tag}`, scheduled.payout_id],
    );
    check(
      payoutPostings.rows[0]?.count === '1' && payoutPostings.rows[0].state === 'PAID',
      `A payout submitted twice at once was paid or posted twice (${JSON.stringify(payoutPostings.rows[0])})`,
    );

    // 3. Two partner batch runs start together: one batch, one payout item.
    const trip = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.delivery_assignments
        (delivery_assignment_id,source_order_reference,vendor_location_id,partner_user_id,
         assignment_state,custody_state,package_count,approximate_pickup_area,
         approximate_drop_area,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'RETURNED','RETURNED',1,'SYNTH Conserve Store','SYNTH Conserve Drop',$5,$5,$6,$6)`,
      [trip, `SYNTH-ORDER-CONSERVE-RETURN-${tag}`, location, rider, request, start],
    );
    const earning = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.partner_earnings_records
        (partner_earnings_record_id,delivery_assignment_id,partner_user_id,outcome,
         base_minor,distance_minor,net_minor,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,$3,'RETURNED',2000,500,2500,$4,$4,$5,$5)`,
      [earning, trip, rider, request, start],
    );
    await complete.postPartnerEarning({
      context: ops,
      now: start,
      partner_earnings_record_id: earning,
    });
    const batchRuns = await Promise.allSettled(
      [complete, rival].map((service) =>
        service.createPayoutBatch({
          beneficiary_kind: 'PARTNER',
          context: ops,
          now: at(3 * 24 * 60),
          provider_scenario: 'SUCCESS',
        }),
      ),
    );
    const paidOnce = await pool.query<{ items: string; batches: string }>(
      `SELECT (SELECT count(*) FROM marketplace.partner_payout_items
                WHERE partner_earnings_record_id=$1)::text AS items,
              (SELECT count(*) FROM marketplace.payout_batches WHERE batch_reference=$2)::text
                AS batches`,
      [
        earning,
        `SYNTH-PAYOUT-BATCH-PARTNER-${at(3 * 24 * 60)
          .toISOString()
          .slice(0, 10)
          .replaceAll('-', '')}`,
      ],
    );
    check(
      batchRuns.some((outcome) => outcome.status === 'fulfilled') &&
        paidOnce.rows[0]?.items === '1' &&
        paidOnce.rows[0].batches === '1',
      `Two batch runs at once paid an earning twice or wrote two batches (${JSON.stringify(paidOnce.rows[0])})`,
    );

    // 4. One correction approved by two operators at once posts once.
    const capture = await pool.query<{ ledger_transaction_id: UuidV7 }>(
      `SELECT ledger_transaction_id FROM marketplace.ledger_transactions
        WHERE transaction_kind='CAPTURE' AND provider_operation_reference=$1`,
      [`SYNTH-PAY-CONSERVE-${tag}`],
    );
    const captureId = capture.rows[0]?.ledger_transaction_id;
    check(captureId, 'The capture posted nothing to correct');
    const captureEntries = await pool.query<{
      account_reference: string;
      component: string;
      debit_minor: string;
      credit_minor: string;
      vendor_location_id: UuidV7 | null;
      source_order_reference: string | null;
    }>(
      `SELECT account_reference, component, debit_minor::text, credit_minor::text,
              vendor_location_id, source_order_reference
         FROM marketplace.ledger_entries WHERE ledger_transaction_id=$1 ORDER BY ledger_entry_id`,
      [captureId],
    );
    const replacement = captureEntries.rows.map((entry) => ({
      account_reference: entry.account_reference,
      component: entry.component,
      debit_minor: Number(entry.debit_minor),
      credit_minor: Number(entry.credit_minor),
      ...(entry.vendor_location_id ? { vendor_location_id: entry.vendor_location_id } : {}),
      ...(entry.source_order_reference
        ? { source_order_reference: entry.source_order_reference }
        : {}),
    }));
    const proposed = await complete.proposeCorrection({
      amount_minor: replacement.reduce((sum, entry) => sum + entry.debit_minor, 0),
      context: ops,
      correction_reference: `SYNTH-CORRECTION-CONSERVE-${tag}`,
      entries: replacement,
      evidence_reference: `SYNTH-EVIDENCE-CONSERVE-${tag}`,
      now: at(3 * 24 * 60 + 5),
      original_ledger_transaction_id: captureId,
      reason_code: 'CAPTURE_RESTATED',
    });
    const approvals = await Promise.allSettled(
      [
        [complete, checker],
        [rival, thirdOperator],
      ].map(([service, operator]) =>
        (service as CompleteMoneyLifecycleService).approveAndPostCorrection({
          context: adminContext(operator as UuidV7),
          expected_version: proposed.version,
          financial_correction_id: proposed.financial_correction_id,
          now: at(3 * 24 * 60 + 6),
        }),
      ),
    );
    const reversals = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.ledger_transactions
        WHERE source_reference=$1`,
      [
        `SYNTH-ADJUSTMENT-REVERSAL-${String(proposed.financial_correction_id).replaceAll('-', '').toUpperCase()}`,
      ],
    );
    check(
      approvals.filter((outcome) => outcome.status === 'fulfilled').length === 1 &&
        reversals.rows[0]?.count === '1',
      `A correction approved twice at once was posted twice (${JSON.stringify(approvals.map((outcome) => outcome.status))})`,
    );
    await conserved('the concurrent runs');

    // 5. The audit names every kind of breach, planted and rolled back.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const clean = await auditMoneyConservation(client);
      check(
        clean.conserved,
        `The audit found a breach before any was planted (${JSON.stringify(clean.breaches)})`,
      );
      const plant = async (
        label: string,
        expected: ConservationBreach['invariant'],
        sql: () => Promise<unknown>,
      ) => {
        await client.query('SAVEPOINT planted');
        await sql();
        const report = await auditMoneyConservation(client);
        await client.query('ROLLBACK TO SAVEPOINT planted');
        check(
          !report.conserved && report.breaches.some((breach) => breach.invariant === expected),
          `The audit did not see ${label} (${JSON.stringify(report.breaches)})`,
        );
      };
      const posting = async (
        entries: readonly [string, number, number, { vendor?: UuidV7; partner?: UuidV7 }][],
      ) => {
        const id = createUuidV7();
        await client.query(
          `INSERT INTO marketplace.ledger_transactions
            (ledger_transaction_id,source_reference,transaction_kind,posted_at,request_id,correlation_id)
           VALUES ($1,$2,'ADJUSTMENT',$3,$4,$5)`,
          [
            id,
            `SYNTH-ADJUSTMENT-PLANT-${id.replaceAll('-', '').toUpperCase()}`,
            at(9_000),
            createRequestId(),
            createUuidV7(),
          ],
        );
        for (const [account, debit, credit, owner] of entries)
          await client.query(
            `INSERT INTO marketplace.ledger_entries
              (ledger_entry_id,ledger_transaction_id,account_reference,component,debit_minor,
               credit_minor,vendor_location_id,partner_user_id)
             VALUES ($1,$2,$3,'ADJUSTMENT',$4,$5,$6,$7)`,
            [
              createUuidV7(),
              id,
              account,
              debit,
              credit,
              owner.vendor ?? null,
              owner.partner ?? null,
            ],
          );
      };
      await plant('a shop credited with money no record owes it', 'VENDOR_PAYABLE', () =>
        posting([
          ['SYNTH-ACCOUNT-PLATFORM-CLEARING', 1, 0, {}],
          ['SYNTH-ACCOUNT-VENDOR-PAYABLE', 0, 1, { vendor: location }],
        ]),
      );
      await plant('a partner credited with money no record owes them', 'PARTNER_PAYABLE', () =>
        posting([
          ['SYNTH-ACCOUNT-PLATFORM-CLEARING', 1, 0, {}],
          ['SYNTH-ACCOUNT-PARTNER-PAYABLE', 0, 1, { partner: rider }],
        ]),
      );
      await plant('customer money no capture explains', 'CUSTOMER_CLEARING', () =>
        posting([
          ['SYNTH-ACCOUNT-CUSTOMER-CLEARING', 1, 0, {}],
          ['SYNTH-ACCOUNT-PLATFORM-CLEARING', 0, 1, {}],
        ]),
      );
      await plant('provider money no payout explains', 'PROVIDER_CLEARING', () =>
        posting([
          ['SYNTH-ACCOUNT-PLATFORM-CLEARING', 1, 0, {}],
          ['SYNTH-ACCOUNT-FAKE-PROVIDER', 0, 1, {}],
        ]),
      );
      await plant('a statement row nobody owns', 'STATEMENT_UNROUTED', () =>
        client.query(
          `INSERT INTO marketplace.provider_statement_rows
            (statement_row_id,provider_operation_reference,statement_reference,operation_kind,
             amount_minor,provider_state,created_at,reconciliation_class)
           VALUES ($1,$2,$3,'PAYMENT',100,'SUCCEEDED',$4,'DUPLICATE')`,
          [createUuidV7(), `SYNTH-PAY-PLANT-${tag}`, `SYNTH-STMT-PLANT-${tag}`, at(9_000)],
        ),
      );
      await plant('a history table whose guard is gone', 'HISTORY_EDITABLE', () =>
        client.query('DROP TRIGGER refund_lines_append_only ON marketplace.refund_lines'),
      );
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    await conserved('the planted breaches were rolled back');
  } finally {
    await Promise.all([
      pool.end(),
      money.close(),
      complete.close(),
      rival.close(),
      rivalMoney.close(),
    ]);
  }
}
