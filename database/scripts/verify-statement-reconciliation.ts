import { createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  LocalFakeMoneyProvider,
  SYNTHETIC_FINANCIAL_POLICY,
  type FakeProviderOutcome,
  type ProviderOperationInput,
} from '../src/money-policy.js';
import { MoneyLifecycleService, MoneyStateError } from '../src/money-lifecycle.js';
import { CompleteMoneyLifecycleService } from '../src/complete-money-lifecycle.js';
import { adminContext, check, rejects, systemContext } from './verify-support.js';

/** A provider that does not answer a capture it was asked for by name. */
class UnansweringProvider extends LocalFakeMoneyProvider {
  override async capture(input: ProviderOperationInput): Promise<FakeProviderOutcome> {
    return input.operation_reference.includes('UNANSWERED') ? 'UNKNOWN' : super.capture(input);
  }
}

/**
 * 10.5 -- a provider statement is matched against the books.
 *
 * Payments captured, unanswered and voided; refunds unanswered and refused; a
 * shop payout unanswered; and a capture the books hold that the statement
 * leaves out. Two statements are imported over them: the first matches,
 * applies the answers we were waiting for, names what is duplicated,
 * unmatched, contradictory and missing; the second reports the missing one,
 * repeats one, contradicts itself, and answers what the first left unknown.
 * A refused refund is proposed again for a person; an unknown one never is.
 *
 * April 2027, and its own statement period, so the books it reads for
 * "missing" are its own.
 */
export async function verifyStatementReconciliation(connectionString: string): Promise<void> {
  const pool = new Pool({
    connectionString,
    application_name: 'statement-reconciliation-verifier',
  });
  const money = new MoneyLifecycleService({
    connection_string: connectionString,
    provider: new UnansweringProvider(),
  });
  const complete = new CompleteMoneyLifecycleService({ connection_string: connectionString });
  const start = new Date('2027-04-01T04:00:00.000Z');
  const at = (hours: number) => new Date(start.getTime() + hours * 3_600_000);
  const proposer = createUuidV7({ now_ms: start.getTime() });
  const approver = createUuidV7({ now_ms: start.getTime() + 1 });
  const vendor = createUuidV7({ now_ms: start.getTime() + 2 });
  const location = createUuidV7({ now_ms: start.getTime() + 3 });
  const request = createUuidV7({ now_ms: start.getTime() + 4 });
  const tag = String(proposer).replaceAll('-', '').slice(-10).toUpperCase();
  const ops = adminContext(proposer);
  const checker = adminContext(approver);
  // The operations worker proposes a retry as the platform.
  const platform = systemContext(proposer);

  const payment = async (
    name: string,
    amountMinor: number,
    options: { readonly capture?: boolean; readonly unanswered?: boolean } = {},
  ) => {
    const reference = `SYNTH-PAY-RECON-${options.unanswered ? 'UNANSWERED-' : ''}${name}-${tag}`;
    const created = await money.createPayment({
      allocations: [
        {
          delivery_minor: 1_000,
          discount_minor: 0,
          item_minor: amountMinor - 1_000,
          policy_version_reference: 'SYNTH-POLICY-RECON-V1',
          source_order_reference: `SYNTH-ORDER-RECON-${name}-${tag}`,
          tax_minor: 0,
          tip_minor: 0,
          vendor_location_id: location,
        },
      ],
      amount_minor: amountMinor,
      command_reference: `SYNTH-CMD-RECON-CREATE-${name}-${tag}`,
      context: ops,
      provider_operation_reference: reference,
      provider_scenario: 'SUCCESS',
      source_checkout_reference: `SYNTH-CHECKOUT-RECON-${name}-${tag}`,
      now: at(1),
    });
    const authorized = await money.authorize({
      command_reference: `SYNTH-CMD-RECON-AUTH-${name}-${tag}`,
      context: ops,
      expected_version: created.version,
      payment_transaction_id: created.payment_transaction_id,
      now: at(1),
    });
    const settled =
      options.capture === false
        ? authorized
        : await money.capture({
            command_reference: `SYNTH-CMD-RECON-CAPTURE-${name}-${tag}`,
            context: ops,
            expected_version: authorized.version,
            payment_transaction_id: created.payment_transaction_id,
            now: at(2),
          });
    return { ...settled, reference, order: `SYNTH-ORDER-RECON-${name}-${tag}` };
  };
  const refund = async (
    paid: { payment_transaction_id: UuidV7; order: string },
    name: string,
    amountMinor: number,
    scenario: 'DECLINE' | 'UNKNOWN',
  ) => {
    const reference = `SYNTH-REF-RECON-${name}-${tag}`;
    const proposed = await money.proposeRefund({
      command_reference: `SYNTH-CMD-RECON-REFUND-${name}-${tag}`,
      context: ops,
      delivery_minor: 0,
      discount_reversal_minor: 0,
      item_minor: amountMinor,
      now: at(3),
      payment_transaction_id: paid.payment_transaction_id,
      provider_operation_reference: reference,
      provider_scenario: scenario,
      source_order_reference: paid.order,
      tax_minor: 0,
      tip_minor: 0,
      trigger_code: 'PARTIAL_ITEM_REFUND',
    });
    const submitted = await money.approveAndSubmitRefund({
      command_reference: `SYNTH-CMD-RECON-APPROVE-${name}-${tag}`,
      context: checker,
      expected_version: proposed.version,
      refund_id: proposed.refund_id,
      now: at(3),
    });
    return { ...submitted, reference };
  };
  const exception = async (reference: string, kind: string) =>
    (
      await pool.query<{
        exception_state: string;
        owner_reference: string;
        next_action_code: string;
      }>(
        `SELECT exception_state, owner_reference, next_action_code
           FROM marketplace.finance_exceptions
          WHERE operation_reference=$1 AND exception_kind=$2
          ORDER BY created_at DESC LIMIT 1`,
        [reference, kind],
      )
    ).rows[0];

  try {
    await pool.query('INSERT INTO marketplace.users (user_id) VALUES ($1),($2)', [
      proposer,
      approver,
    ]);
    await pool.query(
      `INSERT INTO marketplace.vendors
        (vendor_id,business_name,profile_description,lifecycle_state,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,'SYNTH Recon Vendor','Synthetic reconciliation vendor','ACTIVE',$2,$2,$3,$3)`,
      [vendor, request, start],
    );
    await pool.query(
      `INSERT INTO marketplace.vendor_locations
        (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
         coordinates,category,lifecycle_state,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,'SYNTH Recon Location','Synthetic reconciliation location','Asia/Kolkata',
         ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,
         'FRUIT_VEGETABLE','ACTIVE',$3,$3,$4,$4)`,
      [location, vendor, request, start],
    );

    const captured = await payment('CAPTURED', 10_000);
    const unanswered = await payment('WAITING', 8_000, { unanswered: true });
    const unreported = await payment('UNREPORTED', 6_000);
    const released = await payment('VOIDED', 5_000, { capture: false });
    await complete.voidAuthorization({
      command_reference: `SYNTH-CMD-RECON-VOID-${tag}`,
      context: ops,
      expected_version: released.version,
      payment_transaction_id: released.payment_transaction_id,
      now: at(2),
    });
    check(
      unanswered.payment_state === 'UNKNOWN_REQUIRES_RECONCILIATION',
      `The unanswered capture was not held as unknown (${unanswered.payment_state})`,
    );
    const waitingRefund = await refund(captured, 'WAITING', 1_000, 'UNKNOWN');
    const laterRefund = await refund(captured, 'LATER', 300, 'UNKNOWN');
    const refusedRefund = await refund(captured, 'REFUSED', 500, 'DECLINE');
    check(
      waitingRefund.refund_state === 'FAILED_REVIEW' &&
        refusedRefund.refund_state === 'FAILED_RETRYABLE',
      'The refunds did not land unanswered and refused',
    );
    // A person's refund proposal that lapses unapproved stops holding the
    // cap: the captured payment has 8,700 left, all of it proposed and never
    // approved; an hour later a new refund against it is allowed.
    await money.proposeRefund({
      command_reference: `SYNTH-CMD-RECON-LAPSED-${tag}`,
      context: ops,
      delivery_minor: 0,
      discount_reversal_minor: 0,
      item_minor: 8_700,
      now: at(4),
      payment_transaction_id: captured.payment_transaction_id,
      provider_operation_reference: `SYNTH-REF-RECON-LAPSED-${tag}`,
      provider_scenario: 'SUCCESS',
      source_order_reference: captured.order,
      tax_minor: 0,
      tip_minor: 0,
      trigger_code: 'PARTIAL_ITEM_REFUND',
    });
    const afterLapse = await money.proposeRefund({
      command_reference: `SYNTH-CMD-RECON-AFTER-LAPSE-${tag}`,
      context: ops,
      delivery_minor: 0,
      discount_reversal_minor: 0,
      item_minor: 100,
      now: at(5),
      payment_transaction_id: captured.payment_transaction_id,
      provider_operation_reference: `SYNTH-REF-RECON-AFTER-LAPSE-${tag}`,
      provider_scenario: 'SUCCESS',
      source_order_reference: captured.order,
      tax_minor: 0,
      tip_minor: 0,
      trigger_code: 'PARTIAL_ITEM_REFUND',
    });
    check(
      afterLapse.refund_state === 'PENDING_APPROVAL',
      'A lapsed refund proposal still held the refund cap',
    );
    const settlement = await money.createSettlement({
      completed: true,
      context: ops,
      customer_captured_minor: 10_000,
      financial_policy: SYNTHETIC_FINANCIAL_POLICY,
      now: at(2),
      partner_outbound_minor: 0,
      partner_return_minor: 0,
      partner_tip_minor: 0,
      partner_wait_minor: 0,
      payment_transaction_id: captured.payment_transaction_id,
      policy_version_reference: 'SYNTH-POLICY-RECON-V1',
      source_order_reference: captured.order,
      successful_refunds_minor: 0,
      vendor_item_minor: 9_000,
      vendor_location_id: location,
    });
    const payoutReference = `SYNTH-PAYOUT-RECON-${tag}`;
    const scheduled = await money.schedulePayout({
      amount_minor: Number(settlement.vendor_payable_minor),
      beneficiary_kind: 'VENDOR',
      beneficiary_reference: `SYNTH-BENEFICIARY-RECON-${tag}`,
      context: ops,
      now: at(50),
      provider_operation_reference: payoutReference,
      provider_scenario: 'UNKNOWN',
      settlement_id: settlement.settlement_id,
    });
    const sent = await money.submitPayout({
      context: ops,
      expected_version: scheduled.version,
      now: at(50),
      payout_id: scheduled.payout_id,
    });
    check(sent.payout_state === 'SUBMITTED', 'The unanswered payout was not held as submitted');

    // An unknown refund is never retried; only a refusal is.
    check(
      (await money.reproposeDeclinedRefunds({ context: platform, now: at(51) })) === 1,
      'The refused refund was not proposed again',
    );
    const retry = await pool.query<{
      refund_id: UuidV7;
      refund_state: string;
      refund_total_minor: string;
      provider_operation_reference: string;
      version: number;
    }>(
      `SELECT refund_id, refund_state, refund_total_minor::text, provider_operation_reference,
              version
         FROM marketplace.refunds WHERE retry_of_refund_id=$1`,
      [refusedRefund.refund_id],
    );
    const firstRetry = retry.rows[0];
    check(
      retry.rows.length === 1 &&
        firstRetry?.refund_state === 'PENDING_APPROVAL' &&
        firstRetry.refund_total_minor === '500' &&
        firstRetry.provider_operation_reference !== refusedRefund.reference,
      `A refused refund was not proposed again as a new refund for a person (${JSON.stringify(retry.rows)})`,
    );
    const retried = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.refunds
        WHERE retry_of_refund_id IN ($1,$2)`,
      [waitingRefund.refund_id, laterRefund.refund_id],
    );
    check(retried.rows[0]?.count === '0', 'A refund whose outcome is unknown was tried again');
    check(
      (await money.reproposeDeclinedRefunds({ context: platform, now: at(51) })) === 0,
      'A refused refund was proposed again twice',
    );

    // Statement one covers the walk's first two days.
    const unknownOperation = `SYNTH-PAY-RECON-NOBODY-${tag}`;
    const statementOneRows = [
      {
        amount_minor: 10_000,
        operation_kind: 'PAYMENT' as const,
        provider_operation_reference: captured.reference,
        provider_state: 'SUCCEEDED' as const,
      },
      {
        amount_minor: 10_000,
        operation_kind: 'PAYMENT' as const,
        provider_operation_reference: captured.reference,
        provider_state: 'SUCCEEDED' as const,
      },
      {
        amount_minor: 8_000,
        operation_kind: 'PAYMENT' as const,
        provider_operation_reference: unanswered.reference,
        provider_state: 'SUCCEEDED' as const,
      },
      {
        amount_minor: 5_000,
        operation_kind: 'PAYMENT' as const,
        provider_operation_reference: released.reference,
        provider_state: 'SUCCEEDED' as const,
      },
      {
        amount_minor: 1_000,
        operation_kind: 'REFUND' as const,
        provider_operation_reference: waitingRefund.reference,
        provider_state: 'SUCCEEDED' as const,
      },
      {
        amount_minor: 300,
        operation_kind: 'REFUND' as const,
        provider_operation_reference: laterRefund.reference,
        provider_state: 'UNKNOWN' as const,
      },
      {
        amount_minor: 500,
        operation_kind: 'REFUND' as const,
        provider_operation_reference: refusedRefund.reference,
        provider_state: 'FAILED' as const,
      },
      {
        amount_minor: Number(settlement.vendor_payable_minor),
        operation_kind: 'PAYOUT' as const,
        provider_operation_reference: payoutReference,
        provider_state: 'SUCCEEDED' as const,
      },
      {
        amount_minor: 777,
        operation_kind: 'PAYMENT' as const,
        provider_operation_reference: unknownOperation,
        provider_state: 'SUCCEEDED' as const,
      },
    ];
    const statementOne = await complete.importProviderStatement({
      context: ops,
      now: at(52),
      period_start: at(0),
      period_end: at(48),
      rows: statementOneRows,
      statement_reference: `SYNTH-STMT-RECON-ONE-${tag}`,
    });
    const classOf = (rows: readonly Record<string, unknown>[], reference: string) =>
      rows
        .filter((row) => row['provider_operation_reference'] === reference)
        .map((row) => row['reconciliation_class']);
    const oneRows = statementOne.rows as Record<string, unknown>[];
    check(
      JSON.stringify(classOf(oneRows, captured.reference)) ===
        JSON.stringify(['MATCHED', 'DUPLICATE']) &&
        classOf(oneRows, unanswered.reference)[0] === 'MATCHED' &&
        classOf(oneRows, waitingRefund.reference)[0] === 'MATCHED' &&
        classOf(oneRows, laterRefund.reference)[0] === 'MATCHED' &&
        classOf(oneRows, refusedRefund.reference)[0] === 'MATCHED' &&
        classOf(oneRows, payoutReference)[0] === 'MATCHED' &&
        classOf(oneRows, unknownOperation)[0] === 'UNMATCHED',
      `The statement was not classified against the books (${JSON.stringify(oneRows.map((row) => [row['provider_operation_reference'], row['reconciliation_class']]))})`,
    );
    check(
      classOf(oneRows, released.reference)[0] === 'STATUS_MISMATCH',
      'A provider settling a payment we voided was matched',
    );
    const missing = oneRows.filter((row) => row['reconciliation_class'] === 'MISSING_EXPECTED');
    check(
      missing.length === 1 &&
        missing[0]?.['provider_operation_reference'] === unreported.reference &&
        missing[0]['provider_state'] === null &&
        Number(missing[0]['expected_amount_minor']) === 6_000,
      `What the books settled and the statement left out was not named missing (${JSON.stringify(missing)})`,
    );

    // The answers we were waiting for are applied, each once.
    const states = await pool.query<{ payment: string; refund: string; payout: string }>(
      `SELECT (SELECT payment_state FROM marketplace.payment_transactions
                WHERE payment_transaction_id=$1) AS payment,
              (SELECT refund_state FROM marketplace.refunds WHERE refund_id=$2) AS refund,
              (SELECT payout_state FROM marketplace.payouts WHERE payout_id=$3) AS payout`,
      [unanswered.payment_transaction_id, waitingRefund.refund_id, scheduled.payout_id],
    );
    check(
      statementOne.resolved === 3 &&
        states.rows[0]?.payment === 'CAPTURED' &&
        states.rows[0].refund === 'SUCCEEDED' &&
        states.rows[0].payout === 'PAID',
      `The statement's answers were not applied to what was waiting for them (${JSON.stringify({ resolved: statementOne.resolved, ...states.rows[0] })})`,
    );
    const capturePosting = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.ledger_transactions
        WHERE transaction_kind='CAPTURE' AND provider_operation_reference=$1`,
      [unanswered.reference],
    );
    check(
      capturePosting.rows[0]?.count === '1' &&
        (await exception(unanswered.reference, 'PAYMENT_UNKNOWN'))?.exception_state !== 'OPEN',
      'The reconciled capture was not posted once, or its case stayed open',
    );

    // Everything else is a person's, in the reconciliation queue, with what
    // to do next.
    const routed = [
      [captured.reference, 'STATEMENT_DUPLICATE', 'CONFIRM_DUPLICATE_SETTLEMENT'],
      [released.reference, 'STATUS_MISMATCH', 'RESOLVE_STATUS_CONFLICT'],
      [unknownOperation, 'STATEMENT_UNMATCHED', 'INVESTIGATE_UNKNOWN_OPERATION'],
      [unreported.reference, 'STATEMENT_MISSING', 'CHASE_PROVIDER_FOR_MISSING_OPERATION'],
    ] as const;
    for (const [reference, kind, action] of routed) {
      const found = await exception(reference, kind);
      check(
        found?.exception_state === 'OPEN' &&
          found.owner_reference === 'FINANCE_RECONCILIATION' &&
          found.next_action_code === action,
        `A ${kind} was not routed to an owned queue with its next action (${JSON.stringify(found)})`,
      );
    }
    const unowned = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.finance_exceptions WHERE owner_reference IS NULL`,
    );
    check(unowned.rows[0]?.count === '0', 'A finance exception belongs to nobody');

    // The same statement again, in another order, is the same import; the
    // same reference with other rows is refused.
    const replayed = await complete.importProviderStatement({
      context: ops,
      now: at(53),
      period_start: at(0),
      period_end: at(48),
      rows: [...statementOneRows].reverse(),
      statement_reference: `SYNTH-STMT-RECON-ONE-${tag}`,
    });
    check(
      replayed.provider_statement_import_id === statementOne.provider_statement_import_id &&
        (replayed.rows as unknown[]).length === oneRows.length,
      'A statement sent again in another order was imported twice',
    );
    await rejects(
      () =>
        complete.importProviderStatement({
          context: ops,
          now: at(53),
          rows: statementOneRows.slice(1),
          statement_reference: `SYNTH-STMT-RECON-ONE-${tag}`,
        }),
      MoneyStateError,
      'A statement that changed under its own reference was accepted as a replay',
    );

    // Statement two: the missing capture reported, one repeated, one
    // contradicted, and the unknown refund answered.
    const statementTwo = await complete.importProviderStatement({
      context: ops,
      now: at(60),
      rows: [
        {
          amount_minor: 6_000,
          operation_kind: 'PAYMENT',
          provider_operation_reference: unreported.reference,
          provider_state: 'SUCCEEDED',
        },
        {
          amount_minor: 10_000,
          operation_kind: 'PAYMENT',
          provider_operation_reference: captured.reference,
          provider_state: 'SUCCEEDED',
        },
        {
          amount_minor: 500,
          operation_kind: 'REFUND',
          provider_operation_reference: refusedRefund.reference,
          provider_state: 'SUCCEEDED',
        },
        {
          amount_minor: 300,
          operation_kind: 'REFUND',
          provider_operation_reference: laterRefund.reference,
          provider_state: 'SUCCEEDED',
        },
        {
          // Statement one said this operation succeeded; nothing of ours
          // stands behind it, so only the provider's own word contradicts it.
          amount_minor: 777,
          operation_kind: 'PAYMENT',
          provider_operation_reference: unknownOperation,
          provider_state: 'FAILED',
        },
      ],
      statement_reference: `SYNTH-STMT-RECON-TWO-${tag}`,
    });
    const twoRows = statementTwo.rows as Record<string, unknown>[];
    check(
      classOf(twoRows, unreported.reference)[0] === 'MATCHED' &&
        (await exception(unreported.reference, 'STATEMENT_MISSING'))?.exception_state ===
          'RESOLVED',
      'A missing operation reported later did not close its case',
    );
    check(
      classOf(twoRows, captured.reference)[0] === 'DUPLICATE' &&
        classOf(twoRows, refusedRefund.reference)[0] === 'STATUS_MISMATCH' &&
        classOf(twoRows, unknownOperation)[0] === 'STATUS_MISMATCH',
      `A repeated or contradicted answer was not caught (${JSON.stringify(twoRows.map((row) => [row['provider_operation_reference'], row['reconciliation_class']]))})`,
    );
    const later = await pool.query<{ refund_state: string }>(
      'SELECT refund_state FROM marketplace.refunds WHERE refund_id=$1',
      [laterRefund.refund_id],
    );
    check(
      classOf(twoRows, laterRefund.reference)[0] === 'MATCHED' &&
        statementTwo.resolved === 1 &&
        later.rows[0]?.refund_state === 'SUCCEEDED',
      'An answer after an earlier "unknown" was treated as a duplicate rather than applied',
    );

    // The retry is a person's to approve; refused again, it is proposed again.
    await rejects(
      () =>
        money.approveAndSubmitRefund({
          command_reference: `SYNTH-CMD-RECON-RETRY-SELF-${tag}`,
          context: ops,
          expected_version: firstRetry.version,
          refund_id: firstRetry.refund_id,
          now: at(61),
        }),
      MoneyStateError,
      'A retried refund was approved by the one who proposed it',
    );
    await money.approveAndSubmitRefund({
      command_reference: `SYNTH-CMD-RECON-RETRY-${tag}`,
      context: checker,
      expected_version: firstRetry.version,
      refund_id: firstRetry.refund_id,
      now: at(61),
    });
    await money.reproposeDeclinedRefunds({ context: platform, now: at(62) });
    const chain = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.refunds WHERE retry_of_refund_id=$1`,
      [firstRetry.refund_id],
    );
    check(chain.rows[0]?.count === '1', 'A refused retry was not proposed again');

    const balance = await complete.ledgerTrialBalance({ context: ops });
    check(balance.balanced, 'Reconciliation left the books unbalanced');
  } finally {
    await Promise.all([pool.end(), money.close(), complete.close()]);
  }
}
