import { createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { DatabaseError, Pool } from 'pg';
import { SYNTHETIC_FINANCIAL_POLICY } from '../src/money-policy.js';
import {
  MoneyAuthorizationError,
  MoneyInputError,
  MoneyLifecycleService,
  MoneyStateError,
} from '../src/money-lifecycle.js';
import { CompleteMoneyLifecycleService } from '../src/complete-money-lifecycle.js';
import { PartnerLifecycleService } from '../src/partner-lifecycle.js';
import { adminContext, check, partnerContext, rejects } from './verify-support.js';

/**
 * 10.4 -- a partner is paid what they earned, once.
 *
 * Two partners, three trips and a displaced attempt, walked through the
 * daily batches: the shop's run first and the partner's after it (the order
 * the worker runs them in, which used to leave the partner run nothing to
 * pay); a dispute answered before payout and one answered below the line; a
 * returned trip; compensations; a payout the bank refuses, held, released and
 * paid again; one whose outcome is unknown, never paid twice; and a refused
 * payout the provider later says went out after all.
 *
 * The walk runs on its own days (March 2027) so the day's batch is its own,
 * and asserts only on its own partners: the batch also pays whatever earlier
 * modules left payable, as the worker's batch would.
 */
export async function verifyPartnerPayouts(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, application_name: 'partner-payouts-verifier' });
  const money = new MoneyLifecycleService({ connection_string: connectionString });
  const complete = new CompleteMoneyLifecycleService({ connection_string: connectionString });
  const partners = new PartnerLifecycleService({ connection_string: connectionString });
  const start = new Date('2027-03-01T04:00:00.000Z');
  const day = (n: number, minutes = 0) =>
    new Date(start.getTime() + n * 86_400_000 + minutes * 60_000);
  const admin = createUuidV7({ now_ms: start.getTime() });
  const riderOne = createUuidV7({ now_ms: start.getTime() + 1 });
  const riderTwo = createUuidV7({ now_ms: start.getTime() + 2 });
  const vendor = createUuidV7({ now_ms: start.getTime() + 3 });
  const location = createUuidV7({ now_ms: start.getTime() + 4 });
  const request = createUuidV7({ now_ms: start.getTime() + 5 });
  const tag = String(admin).replaceAll('-', '').slice(-10).toUpperCase();
  const orderRef = (n: number) => `SYNTH-ORDER-PAYOUT-${tag}-${n}`;
  const ops = adminContext(admin);

  const payable = async (partner: UuidV7) => {
    const result = await pool.query<{ balance: string }>(
      `SELECT COALESCE(sum(credit_minor - debit_minor), 0)::text AS balance
         FROM marketplace.ledger_entries
        WHERE account_reference='SYNTH-ACCOUNT-PARTNER-PAYABLE' AND partner_user_id=$1`,
      [partner],
    );
    return Number(result.rows[0]?.balance);
  };
  const payoutsOf = async (partner: UuidV7) =>
    (
      await pool.query<{
        payout_id: UuidV7;
        payout_state: string;
        amount_minor: string;
        provider_operation_reference: string;
        beneficiary_reference: string;
        payout_batch_id: string;
      }>(
        `SELECT payout_id, payout_state, amount_minor::text, provider_operation_reference,
                beneficiary_reference, payout_batch_id
           FROM marketplace.payouts WHERE partner_user_id=$1 ORDER BY created_at, payout_id`,
        [partner],
      )
    ).rows;
  const itemsOf = async (payoutId: UuidV7) =>
    (
      await pool.query<{ source_kind: string; amount_minor: string; lifecycle_state: string }>(
        `SELECT source_kind, amount_minor::text, lifecycle_state
           FROM marketplace.partner_payout_items WHERE payout_id=$1
          ORDER BY source_kind, amount_minor`,
        [payoutId],
      )
    ).rows;
  // The worker's run: the shop's batch, then the partner's, each sent.
  const dailyRun = async (at: Date, scenario: 'DECLINE' | 'SUCCESS' | 'UNKNOWN' = 'SUCCESS') => {
    for (const beneficiary_kind of ['VENDOR', 'PARTNER'] as const) {
      const batch = await complete.createPayoutBatch({
        beneficiary_kind,
        context: ops,
        now: at,
        provider_scenario: scenario,
      });
      await complete.submitPayoutBatch({
        context: ops,
        now: new Date(at.getTime() + 1_000),
        payout_batch_id: batch.payout_batch_id,
      });
    }
  };
  const assignment = async (
    partner: UuidV7,
    reference: string,
    state: 'DELIVERED' | 'REASSIGNED' | 'RETURNED',
  ) => {
    const id = createUuidV7();
    const custody = state === 'REASSIGNED' ? 'NONE' : state;
    await pool.query(
      `INSERT INTO marketplace.delivery_assignments
        (delivery_assignment_id,source_order_reference,vendor_location_id,partner_user_id,
         assignment_state,custody_state,package_count,approximate_pickup_area,
         approximate_drop_area,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,1,'SYNTH Payout Store','SYNTH Payout Drop',$7,$7,$8,$8)`,
      [id, reference, location, partner, state, custody, request, start],
    );
    return id;
  };
  const earning = async (
    partner: UuidV7,
    assignmentId: string,
    outcome: 'DELIVERED' | 'RETURNED',
    parts: { base: number; distance: number; wait?: number },
  ) => {
    const id = createUuidV7();
    const wait = parts.wait ?? 0;
    await pool.query(
      `INSERT INTO marketplace.partner_earnings_records
        (partner_earnings_record_id,delivery_assignment_id,partner_user_id,outcome,
         base_minor,distance_minor,wait_minor,net_minor,request_id,correlation_id,
         created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$10)`,
      [
        id,
        assignmentId,
        partner,
        outcome,
        parts.base,
        parts.distance,
        wait,
        parts.base + parts.distance + wait,
        request,
        start,
      ],
    );
    await complete.postPartnerEarning({
      context: ops,
      now: start,
      partner_earnings_record_id: id,
    });
    return id;
  };
  const compensation = async (partner: UuidV7, amountMinor: number, at: Date) => {
    const displaced = await assignment(partner, orderRef(100 + amountMinor), 'REASSIGNED');
    const id = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.partner_attempt_compensations
        (partner_attempt_compensation_id,delivery_assignment_id,partner_user_id,
         decided_by_user_id,displaced_from,amount_minor,reason_code,request_id,
         correlation_id,created_at)
       VALUES ($1,$2,$3,$4,'ASSIGNED',$5,'PARTNER_VEHICLE_BREAKDOWN',$6,$6,$7)`,
      [id, displaced, partner, admin, amountMinor, request, at],
    );
    await complete.postPendingAttemptCompensations({ context: ops, now: at });
    return id;
  };
  const dispute = async (
    partner: UuidV7,
    earningId: UuidV7,
    component: 'BASE' | 'DISTANCE',
    resolved: number,
    at: Date,
  ) => {
    const opened = await partners.openDispute({
      context: partnerContext(partner),
      disputed_component: component,
      evidence_note: 'SYNTH the road was longer than the card',
      now: at,
      partner_earnings_record_id: earningId,
      proposed_amount_minor: resolved,
    });
    await partners.resolveDispute({
      context: ops,
      now: at,
      partner_dispute_case_id: opened.partner_dispute_case_id,
      resolution: 'RESOLVED',
      resolution_reason_code: 'ROUTE_RECHECKED',
      resolved_amount_minor: resolved,
    });
    await complete.postPendingEarningAdjustments({ context: ops, now: at });
  };

  try {
    await pool.query('INSERT INTO marketplace.users (user_id) VALUES ($1),($2),($3)', [
      admin,
      riderOne,
      riderTwo,
    ]);
    await pool.query(
      `INSERT INTO marketplace.vendors
        (vendor_id,business_name,profile_description,lifecycle_state,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,'SYNTH Payout Vendor','Synthetic partner payout vendor','ACTIVE',$2,$2,$3,$3)`,
      [vendor, request, start],
    );
    await pool.query(
      `INSERT INTO marketplace.vendor_locations
        (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
         coordinates,category,lifecycle_state,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,'SYNTH Payout Location','Synthetic partner payout location','Asia/Kolkata',
         ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,
         'FRUIT_VEGETABLE','ACTIVE',$3,$3,$4,$4)`,
      [location, vendor, request, start],
    );

    // Order 1 is delivered by rider one and settles: the shop is owed its
    // goods less commission, the rider their trip.
    const payment = await money.createPayment({
      allocations: [
        {
          delivery_minor: 3_200,
          discount_minor: 0,
          item_minor: 20_000,
          policy_version_reference: 'SYNTH-POLICY-PAYOUT-V1',
          source_order_reference: orderRef(1),
          tax_minor: 0,
          tip_minor: 0,
          vendor_location_id: location,
        },
      ],
      amount_minor: 23_200,
      command_reference: `SYNTH-CMD-PAYOUT-PAY-${tag}`,
      context: ops,
      provider_operation_reference: `SYNTH-PAY-PAYOUT-${tag}`,
      provider_scenario: 'SUCCESS',
      source_checkout_reference: `SYNTH-CHECKOUT-PAYOUT-${tag}`,
      now: start,
    });
    const authorized = await money.authorize({
      command_reference: `SYNTH-CMD-PAYOUT-AUTH-${tag}`,
      context: ops,
      expected_version: payment.version,
      payment_transaction_id: payment.payment_transaction_id,
      now: start,
    });
    await money.capture({
      command_reference: `SYNTH-CMD-PAYOUT-CAPTURE-${tag}`,
      context: ops,
      expected_version: authorized.version,
      payment_transaction_id: payment.payment_transaction_id,
      now: start,
    });
    const delivered = await assignment(riderOne, orderRef(1), 'DELIVERED');
    const tripOut = await earning(riderOne, delivered, 'DELIVERED', {
      base: 2_000,
      distance: 1_200,
    });
    const settlement = await money.createSettlement({
      completed: true,
      context: ops,
      customer_captured_minor: 23_200,
      financial_policy: SYNTHETIC_FINANCIAL_POLICY,
      now: start,
      partner_outbound_minor: 3_200,
      partner_return_minor: 0,
      partner_tip_minor: 0,
      partner_user_id: riderOne,
      partner_wait_minor: 0,
      payment_transaction_id: payment.payment_transaction_id,
      policy_version_reference: 'SYNTH-POLICY-PAYOUT-V1',
      source_order_reference: orderRef(1),
      successful_refunds_minor: 0,
      vendor_item_minor: 20_000,
      vendor_location_id: location,
    });

    // Order 2 comes back. Nothing divides it, so the trip out is the
    // platform's to pay, from its subsidy.
    const returned = await assignment(riderOne, orderRef(2), 'RETURNED');
    const tripBack = await earning(riderOne, returned, 'RETURNED', {
      base: 2_000,
      distance: 600,
      wait: 200,
    });
    const funding = await pool.query<{ account_reference: string; debit: string; order: string }>(
      `SELECT entry.account_reference, entry.debit_minor::text AS debit,
              entry.source_order_reference AS order
         FROM marketplace.partner_earnings_records earning
         JOIN marketplace.ledger_entries entry USING (ledger_transaction_id)
        WHERE earning.partner_earnings_record_id=$1 AND entry.debit_minor > 0`,
      [tripBack],
    );
    check(
      funding.rows.length === 1 &&
        funding.rows[0]?.account_reference === 'SYNTH-ACCOUNT-PLATFORM-SUBSIDY' &&
        funding.rows[0].debit === '2800' &&
        funding.rows[0].order === orderRef(2),
      `A returned trip was not funded from the platform's subsidy (${JSON.stringify(funding.rows)})`,
    );

    // Rider one's dispute on the delivered trip is answered before payout;
    // rider two is compensated for an attempt taken from them.
    await dispute(riderOne, tripOut, 'BASE', 2_300, day(0, 30));
    const firstCompensation = await compensation(riderTwo, 1_500, day(0, 40));
    const compensationReplay = await complete.postAttemptCompensation({
      context: ops,
      partner_attempt_compensation_id: firstCompensation,
    });
    check(
      !compensationReplay.posted && compensationReplay.replayed,
      'A compensation posted a second time',
    );
    check(
      (await payable(riderOne)) === 6_300 && (await payable(riderTwo)) === 1_500,
      `The books do not owe the riders what they earned (${await payable(riderOne)}, ${await payable(riderTwo)})`,
    );

    // A partner is paid by the batch, not per order.
    await rejects(
      () =>
        money.schedulePayout({
          amount_minor: 3_200,
          beneficiary_kind: 'PARTNER',
          beneficiary_reference: `SYNTH-BENEFICIARY-PARTNER-${tag}`,
          context: ops,
          now: day(2),
          provider_operation_reference: `SYNTH-PAYOUT-LEGACY-${tag}`,
          provider_scenario: 'SUCCESS',
          settlement_id: settlement.settlement_id,
        }),
      MoneyInputError,
      'A partner was paid per order beside the batch',
    );

    // Day 2: the shop's run moves the settlement on; the partner's run still
    // pays the rider for it, and for everything else of theirs.
    await dailyRun(day(2));
    const shopPaid = await pool.query<{
      payout_state: string;
      provider_operation_reference: string;
      settlement_state: string;
    }>(
      `SELECT payout.payout_state, payout.provider_operation_reference, settlement.settlement_state
         FROM marketplace.payouts payout
         JOIN marketplace.settlements settlement USING (settlement_id)
        WHERE payout.settlement_id=$1 AND payout.beneficiary_kind='VENDOR'`,
      [settlement.settlement_id],
    );
    check(
      shopPaid.rows[0]?.payout_state === 'PAID' &&
        /^SYNTH-PAYOUT-[A-Z0-9-]{4,64}$/.test(shopPaid.rows[0].provider_operation_reference) &&
        shopPaid.rows[0].settlement_state === 'PAID',
      `The daily batch did not pay the shop (${JSON.stringify(shopPaid.rows)})`,
    );
    const [firstPayout, ...extraOne] = await payoutsOf(riderOne);
    check(
      firstPayout?.payout_state === 'PAID' &&
        firstPayout.amount_minor === '6300' &&
        extraOne.length === 0 &&
        /^SYNTH-BENEFICIARY-PARTNER-/.test(firstPayout.beneficiary_reference),
      `The partner's run did not pay the rider for an order the shop's run had moved on (${JSON.stringify(firstPayout)})`,
    );
    const firstItems = await itemsOf(firstPayout.payout_id);
    check(
      JSON.stringify(firstItems.map((item) => [item.source_kind, item.amount_minor])) ===
        JSON.stringify([
          ['ADJUSTMENT', '300'],
          ['EARNING', '2800'],
          ['EARNING', '3200'],
        ]) && firstItems.every((item) => item.lifecycle_state === 'PAID'),
      `The payout does not name what it paid (${JSON.stringify(firstItems)})`,
    );
    const [riderTwoFirst] = await payoutsOf(riderTwo);
    check(
      riderTwoFirst?.payout_state === 'PAID' && riderTwoFirst.amount_minor === '1500',
      `A reassignment's compensation reached no payout (${JSON.stringify(riderTwoFirst)})`,
    );
    check(
      (await payable(riderOne)) === 0 && (await payable(riderTwo)) === 0,
      'The payouts did not clear what the books owed the riders',
    );

    // A replayed day and the next day pay nothing again.
    await dailyRun(day(2, 5));
    await dailyRun(day(3));
    check(
      (await payoutsOf(riderOne)).length === 1 && (await payoutsOf(riderTwo)).length === 1,
      'A paid earning was paid again',
    );

    // The schema holds a source to one live payout, and a payout to its items.
    await rejects(
      () =>
        pool.query(
          `INSERT INTO marketplace.partner_payout_items
            (partner_payout_item_id,payout_id,partner_user_id,source_kind,
             partner_earnings_record_id,amount_minor)
           VALUES ($1,$2,$3,'EARNING',$4,3200)`,
          [createUuidV7(), firstPayout.payout_id, riderOne, tripOut],
        ),
      DatabaseError,
      'An earning was put on a second live payout',
    );
    await rejects(
      () =>
        pool.query(
          `UPDATE marketplace.partner_payout_items SET amount_minor=1 WHERE payout_id=$1`,
          [firstPayout.payout_id],
        ),
      DatabaseError,
      'A paid item was rewritten',
    );

    // Day 4: the bank refuses rider one's payout. Nothing moved; the case is
    // a person's, and the rider is held until their account is checked.
    await compensation(riderOne, 1_000, day(3, 30));
    await dailyRun(day(4), 'DECLINE');
    const refused = (await payoutsOf(riderOne))[1];
    check(
      refused?.payout_state === 'FAILED_REVIEW' &&
        (await itemsOf(refused.payout_id)).every((item) => item.lifecycle_state === 'PAYING'),
      `A refused payout released what it carried on its own (${JSON.stringify(refused)})`,
    );
    const refusedCase = await pool.query<{ exception_state: string; next_action_code: string }>(
      `SELECT exception_state, next_action_code FROM marketplace.finance_exceptions
        WHERE exception_kind='PAYOUT_FAILED' AND operation_reference=$1`,
      [refused.provider_operation_reference],
    );
    check(
      refusedCase.rows[0]?.exception_state === 'OPEN' &&
        refusedCase.rows[0].next_action_code === 'VERIFY_PARTNER_BANK_ACCOUNT' &&
        (await payable(riderOne)) === 1_000,
      `A refused payout opened no case, or left the books wrong (${JSON.stringify(refusedCase.rows)})`,
    );
    // Something new is owed to the held rider; it waits with the rest.
    await compensation(riderOne, 400, day(4, 30));
    await dailyRun(day(5));
    check(
      (await payoutsOf(riderOne)).length === 2,
      'A rider whose bank refused a payout was paid again before anyone checked the account',
    );
    await rejects(
      () =>
        complete.releaseFailedPartnerPayout({
          context: partnerContext(riderOne),
          payout_id: refused.payout_id,
          reason_code: 'BANK_ACCOUNT_VERIFIED',
        }),
      MoneyAuthorizationError,
      'A rider released their own refused payout',
    );
    const release = await complete.releaseFailedPartnerPayout({
      context: ops,
      now: day(5, 30),
      payout_id: refused.payout_id,
      reason_code: 'BANK_ACCOUNT_VERIFIED',
    });
    check(release.released_items === 1, 'The refused payout released nothing');
    await dailyRun(day(6));
    const rePaid = (await payoutsOf(riderOne))[2];
    check(
      rePaid?.payout_state === 'PAID' &&
        rePaid.amount_minor === '1400' &&
        (await payable(riderOne)) === 0,
      `A released payout was not paid again (${JSON.stringify(rePaid)})`,
    );

    // The provider later says the refused payout went out after all: the
    // rider has been paid twice, the books say so, and finance recovers it.
    await money.reconcilePayout({
      amount_minor: 1_000,
      context: ops,
      now: day(6, 30),
      payout_id: refused.payout_id,
      provider_state: 'SUCCEEDED',
      statement_reference: `SYNTH-STMT-PAYOUT-${tag}`,
    });
    const duplicate = await pool.query<{ amount: string }>(
      `SELECT amount_at_risk_minor::text AS amount FROM marketplace.finance_exceptions
        WHERE exception_kind='PAYOUT_DUPLICATE_RISK' AND operation_reference=$1
          AND exception_state='OPEN'`,
      [refused.provider_operation_reference],
    );
    check(
      duplicate.rows[0]?.amount === '1000' && (await payable(riderOne)) === -1_000,
      `A payout paid twice was not recorded as owed back (${JSON.stringify(duplicate.rows)}, ${await payable(riderOne)})`,
    );

    // Day 7: rider two's payout goes unanswered. It may have paid, so it is
    // neither released nor paid again until the provider says.
    await compensation(riderTwo, 700, day(6, 40));
    await dailyRun(day(7), 'UNKNOWN');
    const unanswered = (await payoutsOf(riderTwo))[1];
    check(
      unanswered?.payout_state === 'SUBMITTED',
      `An unanswered payout was not held as submitted (${JSON.stringify(unanswered)})`,
    );
    await rejects(
      () =>
        complete.releaseFailedPartnerPayout({
          context: ops,
          payout_id: unanswered.payout_id,
          reason_code: 'BANK_ACCOUNT_VERIFIED',
        }),
      MoneyStateError,
      'A payout whose outcome is unknown was released to be paid again',
    );
    await dailyRun(day(8));
    check(
      (await payoutsOf(riderTwo)).length === 2,
      'What an unanswered payout carried was paid again',
    );
    await money.reconcilePayout({
      amount_minor: 700,
      context: ops,
      now: day(8, 30),
      payout_id: unanswered.payout_id,
      provider_state: 'SUCCEEDED',
      statement_reference: `SYNTH-STMT-UNKNOWN-${tag}`,
    });
    check(
      (await itemsOf(unanswered.payout_id)).every((item) => item.lifecycle_state === 'PAID') &&
        (await payable(riderTwo)) === 0,
      'A reconciled payout did not settle what it carried',
    );

    // A dispute answered below the line is recovered from what the rider is
    // next owed; until they are owed more than that, nothing is paid.
    await dispute(riderOne, tripBack, 'DISTANCE', 400, day(8, 40));
    await dailyRun(day(9));
    check(
      (await payoutsOf(riderOne)).length === 3,
      'A rider who owed money back was sent a payout',
    );
    await compensation(riderOne, 500, day(9, 30));
    await dailyRun(day(10));
    const recovered = (await payoutsOf(riderOne))[3];
    check(
      recovered?.amount_minor === '300' &&
        JSON.stringify(
          (await itemsOf(recovered.payout_id)).map((item) => [item.source_kind, item.amount_minor]),
        ) ===
          JSON.stringify([
            ['ADJUSTMENT', '-200'],
            ['COMPENSATION', '500'],
          ]),
      `A recovery did not come off the rider's next payout (${JSON.stringify(recovered)})`,
    );

    // What the riders read: each line with the payout that carried it.
    const statement = await complete.partnerStatement({ context: partnerContext(riderOne) });
    check(
      statement.earnings.length === 2 &&
        statement.earnings.every((line) => line.lifecycle_state === 'PAID') &&
        statement.compensations.length === 3 &&
        statement.compensations.every((line) => line.lifecycle_state === 'PAID'),
      `The rider's statement does not say what was paid (${JSON.stringify(statement)})`,
    );
    const riderTwoStatement = await complete.partnerStatement({
      context: partnerContext(riderTwo),
    });
    check(
      riderTwoStatement.compensations.length === 2 &&
        riderTwoStatement.compensations.every((line) => line.lifecycle_state === 'PAID'),
      `A rider cannot see their compensation or its payout (${JSON.stringify(riderTwoStatement.compensations)})`,
    );

    const balance = await complete.ledgerTrialBalance({ context: ops });
    check(balance.balanced, 'The partner payouts left the books unbalanced');
  } finally {
    await Promise.all([pool.end(), money.close(), complete.close(), partners.close()]);
  }
}
