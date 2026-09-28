import { createRequestId, createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { DatabaseError, Pool } from 'pg';
import { SYNTHETIC_FINANCIAL_POLICY } from '../src/money-policy.js';
import { MoneyInputError, MoneyLifecycleService, MoneyStateError } from '../src/money-lifecycle.js';
import { CompleteMoneyLifecycleService } from '../src/complete-money-lifecycle.js';
import {
  activateConfigurationVersion,
  approveConfigurationVersion,
  createConfigurationDraft,
  scheduleConfigurationVersion,
  validateConfigurationVersion,
} from '../src/versioned-configuration.js';
import { adminContext, check, rejects, systemContext } from './verify-support.js';

type Entry = {
  account_reference: string;
  component: string;
  debit_minor: number;
  credit_minor: number;
  vendor_location_id?: UuidV7;
  partner_user_id?: UuidV7;
  source_order_reference?: string;
};

/**
 * 10.6 -- a correction says what it moves, is approved by the right people,
 * posts once, and leaves the original and its own history standing.
 *
 * A shop's settlement credited it 200 short. The correction is previewed
 * (the shop's payable and the platform's revenue each move 200), refused
 * where it names a closed account, an owner-less payable or unbalanced
 * entries, proposed with its reason and evidence, refused to its proposer
 * and posted by a second operator. The same posting cannot be corrected
 * twice or through its reversal; the correction's adjustment can, and that
 * correction is rejected, then one within the published single-approval
 * limit is posted by its proposer alone. A proposal nobody answers expires.
 *
 * May 2027, so its configuration version and postings are its own.
 */
export async function verifyFinancialCorrections(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, application_name: 'financial-corrections-verifier' });
  const money = new MoneyLifecycleService({ connection_string: connectionString });
  const complete = new CompleteMoneyLifecycleService({ connection_string: connectionString });
  const start = new Date('2027-05-01T04:00:00.000Z');
  const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
  const maker = createUuidV7({ now_ms: start.getTime() });
  const checker = createUuidV7({ now_ms: start.getTime() + 1 });
  const vendor = createUuidV7({ now_ms: start.getTime() + 2 });
  const location = createUuidV7({ now_ms: start.getTime() + 3 });
  const request = createUuidV7({ now_ms: start.getTime() + 4 });
  const tag = String(maker).replaceAll('-', '').slice(-10).toUpperCase();
  const makerOps = adminContext(maker);
  const checkerOps = adminContext(checker);
  const order = `SYNTH-ORDER-CORRECT-${tag}`;

  const entriesOf = async (ledgerId: string): Promise<Entry[]> =>
    (
      await pool.query<{
        account_reference: string;
        component: string;
        debit_minor: string;
        credit_minor: string;
        vendor_location_id: UuidV7 | null;
        partner_user_id: UuidV7 | null;
        source_order_reference: string | null;
      }>(
        `SELECT account_reference, component, debit_minor::text, credit_minor::text,
                vendor_location_id, partner_user_id, source_order_reference
           FROM marketplace.ledger_entries WHERE ledger_transaction_id=$1 ORDER BY ledger_entry_id`,
        [ledgerId],
      )
    ).rows.map((row) => ({
      account_reference: row.account_reference,
      component: row.component,
      debit_minor: Number(row.debit_minor),
      credit_minor: Number(row.credit_minor),
      ...(row.vendor_location_id ? { vendor_location_id: row.vendor_location_id } : {}),
      ...(row.partner_user_id ? { partner_user_id: row.partner_user_id } : {}),
      ...(row.source_order_reference ? { source_order_reference: row.source_order_reference } : {}),
    }));
  const shopPayable = async () =>
    Number(
      (
        await pool.query<{ balance: string }>(
          `SELECT COALESCE(sum(credit_minor - debit_minor),0)::text AS balance
             FROM marketplace.ledger_entries
            WHERE account_reference='SYNTH-ACCOUNT-VENDOR-PAYABLE' AND vendor_location_id=$1`,
          [location],
        )
      ).rows[0]?.balance,
    );
  // Moves `shift` paise of the platform's revenue to the shop's payable.
  const shifted = (entries: readonly Entry[], shift: number): Entry[] =>
    entries.map((entry) =>
      entry.account_reference === 'SYNTH-ACCOUNT-VENDOR-PAYABLE'
        ? { ...entry, credit_minor: entry.credit_minor + shift }
        : entry.account_reference === 'SYNTH-ACCOUNT-PLATFORM-REVENUE'
          ? { ...entry, credit_minor: entry.credit_minor - shift }
          : entry,
    );
  const debits = (entries: readonly Entry[]) =>
    entries.reduce((sum, entry) => sum + entry.debit_minor, 0);

  try {
    await pool.query('INSERT INTO marketplace.users (user_id) VALUES ($1),($2)', [maker, checker]);
    await pool.query(
      `INSERT INTO marketplace.vendors
        (vendor_id,business_name,profile_description,lifecycle_state,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,'SYNTH Correction Vendor','Synthetic correction vendor','ACTIVE',$2,$2,$3,$3)`,
      [vendor, request, start],
    );
    await pool.query(
      `INSERT INTO marketplace.vendor_locations
        (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
         coordinates,category,lifecycle_state,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,'SYNTH Correction Location','Synthetic correction location','Asia/Kolkata',
         ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,
         'FRUIT_VEGETABLE','ACTIVE',$3,$3,$4,$4)`,
      [location, vendor, request, start],
    );
    const payment = await money.createPayment({
      allocations: [
        {
          delivery_minor: 2_000,
          discount_minor: 0,
          item_minor: 20_000,
          policy_version_reference: 'SYNTH-POLICY-CORRECT-V1',
          source_order_reference: order,
          tax_minor: 0,
          tip_minor: 0,
          vendor_location_id: location,
        },
      ],
      amount_minor: 22_000,
      command_reference: `SYNTH-CMD-CORRECT-PAY-${tag}`,
      context: makerOps,
      provider_operation_reference: `SYNTH-PAY-CORRECT-${tag}`,
      provider_scenario: 'SUCCESS',
      source_checkout_reference: `SYNTH-CHECKOUT-CORRECT-${tag}`,
      now: start,
    });
    const authorized = await money.authorize({
      command_reference: `SYNTH-CMD-CORRECT-AUTH-${tag}`,
      context: makerOps,
      expected_version: payment.version,
      payment_transaction_id: payment.payment_transaction_id,
      now: start,
    });
    await money.capture({
      command_reference: `SYNTH-CMD-CORRECT-CAPTURE-${tag}`,
      context: makerOps,
      expected_version: authorized.version,
      payment_transaction_id: payment.payment_transaction_id,
      now: start,
    });
    await money.createSettlement({
      completed: true,
      context: makerOps,
      customer_captured_minor: 22_000,
      financial_policy: SYNTHETIC_FINANCIAL_POLICY,
      now: start,
      partner_outbound_minor: 0,
      partner_return_minor: 0,
      partner_tip_minor: 0,
      partner_wait_minor: 0,
      payment_transaction_id: payment.payment_transaction_id,
      policy_version_reference: 'SYNTH-POLICY-CORRECT-V1',
      source_order_reference: order,
      successful_refunds_minor: 0,
      vendor_item_minor: 20_000,
      vendor_location_id: location,
    });
    const postings = await pool.query<{ ledger_transaction_id: UuidV7; transaction_kind: string }>(
      `SELECT DISTINCT t.ledger_transaction_id, t.transaction_kind
         FROM marketplace.ledger_transactions t
         JOIN marketplace.ledger_entries e USING (ledger_transaction_id)
        WHERE e.source_order_reference=$1`,
      [order],
    );
    const settlementPosting = postings.rows.find((row) => row.transaction_kind === 'SETTLEMENT');
    const capturePosting = postings.rows.find((row) => row.transaction_kind === 'CAPTURE');
    check(settlementPosting && capturePosting, 'The order posted no settlement or capture');
    const original = await entriesOf(settlementPosting.ledger_transaction_id);
    const replacement = shifted(original, 200);
    const payableBefore = await shopPayable();

    // 1. The preview says what moves, for whom, and who must approve it.
    const preview = await complete.previewCorrection({
      context: makerOps,
      entries: replacement,
      now: at(1),
      original_ledger_transaction_id: settlementPosting.ledger_transaction_id,
    });
    const change = (account: string) =>
      preview.impact.find((row) => row.account_reference === account)?.change_debit_minor;
    check(
      preview.impact_minor === 200 &&
        preview.impact.length === 2 &&
        change('SYNTH-ACCOUNT-VENDOR-PAYABLE') === -200 &&
        preview.impact.find((row) => row.account_reference === 'SYNTH-ACCOUNT-VENDOR-PAYABLE')
          ?.vendor_location_id === location &&
        change('SYNTH-ACCOUNT-PLATFORM-REVENUE') === 200 &&
        preview.second_approval_required &&
        preview.single_approval_limit_minor === 0,
      `The preview did not say what the correction moves or who must approve it (${JSON.stringify(preview)})`,
    );
    check((await shopPayable()) === payableBefore, 'A preview moved money');
    for (const [label, entries] of [
      [
        'an owner-less payable',
        replacement.map((entry) =>
          entry.account_reference === 'SYNTH-ACCOUNT-VENDOR-PAYABLE'
            ? { ...entry, vendor_location_id: undefined }
            : entry,
        ),
      ],
      [
        'an account not in the catalogue',
        replacement.map((entry) =>
          entry.account_reference === 'SYNTH-ACCOUNT-PLATFORM-REVENUE'
            ? { ...entry, account_reference: 'SYNTH-ACCOUNT-NOWHERE' }
            : entry,
        ),
      ],
      ['unbalanced entries', shifted(original, 200).slice(1)],
    ] as const)
      await rejects(
        () =>
          complete.previewCorrection({
            context: makerOps,
            entries: entries as Entry[],
            original_ledger_transaction_id: settlementPosting.ledger_transaction_id,
          }),
        MoneyInputError,
        `A correction with ${label} was previewed`,
      );

    // 2. Reason and evidence are required, in their shapes.
    const proposal = {
      amount_minor: debits(replacement),
      context: makerOps,
      correction_reference: `SYNTH-CORRECTION-SHORT-${tag}`,
      entries: replacement,
      evidence_reference: `SYNTH-EVIDENCE-SHORT-${tag}`,
      now: at(2),
      original_ledger_transaction_id: settlementPosting.ledger_transaction_id,
      reason_code: 'COMMISSION_OVERCHARGED',
    };
    await rejects(
      () => complete.proposeCorrection({ ...proposal, reason_code: 'overcharged' }),
      MoneyInputError,
      'A correction without a reason code was proposed',
    );
    await rejects(
      () => complete.proposeCorrection({ ...proposal, evidence_reference: '' }),
      MoneyInputError,
      'A correction without evidence was proposed',
    );
    const proposed = await complete.proposeCorrection(proposal);
    check(
      proposed.lifecycle_state === 'PROPOSED' &&
        Number(proposed.impact_minor) === 200 &&
        proposed.second_approval_required === true &&
        JSON.stringify(
          (proposed.impact as typeof preview.impact).map((row) => [
            row.account_reference,
            row.vendor_location_id,
            row.change_debit_minor,
          ]),
        ) ===
          JSON.stringify(
            preview.impact.map((row) => [
              row.account_reference,
              row.vendor_location_id,
              row.change_debit_minor,
            ]),
          ),
      `The proposal did not record the impact its approver will see (${JSON.stringify(proposed)})`,
    );
    const replayed = await complete.proposeCorrection(proposal);
    check(
      replayed.financial_correction_id === proposed.financial_correction_id,
      'A replayed proposal was proposed twice',
    );
    await rejects(
      () => complete.proposeCorrection({ ...proposal, reason_code: 'SOMETHING_ELSE' }),
      MoneyStateError,
      'A reference was reused for a different correction',
    );
    await rejects(
      () =>
        complete.proposeCorrection({
          ...proposal,
          correction_reference: `SYNTH-CORRECTION-AGAIN-${tag}`,
        }),
      MoneyStateError,
      'A posting with a correction open was corrected a second time',
    );
    // What was proposed is history.
    await rejects(
      () =>
        pool.query(
          `UPDATE marketplace.financial_corrections SET amount_minor=1 WHERE financial_correction_id=$1`,
          [proposed.financial_correction_id],
        ),
      DatabaseError,
      'A proposed correction was rewritten',
    );

    // 3. Over the limit, the proposer cannot post it; a second operator can.
    await rejects(
      () =>
        complete.approveAndPostCorrection({
          context: makerOps,
          expected_version: proposed.version,
          financial_correction_id: proposed.financial_correction_id,
          now: at(3),
        }),
      MoneyStateError,
      'A correction over the limit was posted by its proposer',
    );
    const posted = await complete.approveAndPostCorrection({
      context: checkerOps,
      expected_version: proposed.version,
      financial_correction_id: proposed.financial_correction_id,
      now: at(3),
    });

    // 4. Reversal and replacement: the shop is owed 200 more, the original stands.
    check(
      posted.lifecycle_state === 'POSTED' &&
        posted.approved_by_user_id === checker &&
        (await shopPayable()) === payableBefore + 200,
      `The correction did not move the shop's money by what it previewed (${await shopPayable()} against ${payableBefore})`,
    );
    const reversal = await entriesOf(posted.reversal_ledger_transaction_id);
    check(
      JSON.stringify(await entriesOf(settlementPosting.ledger_transaction_id)) ===
        JSON.stringify(original) &&
        reversal.length === original.length &&
        reversal.every((entry) => entry.component === 'REVERSAL') &&
        debits(reversal) === debits(original),
      'The original posting changed, or the reversal does not mirror it',
    );

    // 5. History: the posting names its correction; the correction its events.
    const originalView = await complete.ledgerTransaction({
      context: makerOps,
      ledger_transaction_id: settlementPosting.ledger_transaction_id,
    });
    const adjustmentView = await complete.ledgerTransaction({
      context: makerOps,
      ledger_transaction_id: posted.adjustment_ledger_transaction_id,
    });
    check(
      originalView.corrections[0]?.role === 'ORIGINAL' &&
        adjustmentView.corrections[0]?.role === 'ADJUSTMENT' &&
        originalView.corrections[0].financial_correction_id === posted.financial_correction_id,
      'A posting does not name the correction that reversed or replaced it',
    );
    await rejects(
      () =>
        complete.proposeCorrection({
          ...proposal,
          correction_reference: `SYNTH-CORRECTION-TWICE-${tag}`,
        }),
      MoneyStateError,
      'A corrected posting was corrected again, which would reverse it twice',
    );
    await rejects(
      () =>
        complete.previewCorrection({
          context: makerOps,
          entries: original,
          original_ledger_transaction_id: posted.reversal_ledger_transaction_id,
        }),
      MoneyStateError,
      'A reversal was corrected on its own',
    );

    // The correction's adjustment can itself be corrected: rejected once...
    const adjustment = await entriesOf(posted.adjustment_ledger_transaction_id);
    const followUp = {
      amount_minor: debits(shifted(adjustment, 100)),
      context: makerOps,
      correction_reference: `SYNTH-CORRECTION-FOLLOW-${tag}`,
      entries: shifted(adjustment, 100),
      evidence_reference: `SYNTH-EVIDENCE-FOLLOW-${tag}`,
      now: at(10),
      original_ledger_transaction_id: posted.adjustment_ledger_transaction_id,
      reason_code: 'COMMISSION_OVERCHARGED',
    };
    const followed = await complete.proposeCorrection(followUp);
    const rejected = await complete.rejectCorrection({
      context: makerOps,
      expected_version: followed.version,
      financial_correction_id: followed.financial_correction_id,
      now: at(11),
      reason_code: 'WRONG_AMOUNT',
    });
    check(
      rejected.lifecycle_state === 'REJECTED' &&
        rejected.closing_reason_code === 'WRONG_AMOUNT' &&
        (await shopPayable()) === payableBefore + 200,
      'A rejected correction moved money or kept no reason',
    );

    // ...then, under a published single-approval limit of 500, posted by its
    // proposer alone.
    const settingFrom = at(15);
    const draft = await createConfigurationDraft(pool, {
      actor_id: maker,
      configuration_key: 'finance.correction_approval',
      configuration_kind: 'SETTING',
      configuration_value: { single_approval_limit_minor: 500 },
      correlation_id: createUuidV7(),
      request_id: createRequestId(),
      scope: { kind: 'GLOBAL', reference: 'global' },
    });
    await validateConfigurationVersion(pool, {
      actor_id: maker,
      configuration_version_id: draft.configuration_version_id,
      request_id: createRequestId(),
    });
    await approveConfigurationVersion(pool, {
      actor_id: checker,
      configuration_version_id: draft.configuration_version_id,
      request_id: createRequestId(),
    });
    await scheduleConfigurationVersion(pool, {
      actor_id: checker,
      configuration_version_id: draft.configuration_version_id,
      effective_from: settingFrom,
      request_id: createRequestId(),
    });
    await activateConfigurationVersion(pool, {
      actor_id: checker,
      at: settingFrom,
      configuration_version_id: draft.configuration_version_id,
      request_id: createRequestId(),
    });
    const small = await complete.proposeCorrection({
      ...followUp,
      correction_reference: `SYNTH-CORRECTION-SMALL-${tag}`,
      now: at(20),
    });
    check(
      small.second_approval_required === false && Number(small.single_approval_limit_minor) === 500,
      `A correction within the published limit still required a second approver (${JSON.stringify(small)})`,
    );
    const selfPosted = await complete.approveAndPostCorrection({
      context: makerOps,
      expected_version: small.version,
      financial_correction_id: small.financial_correction_id,
      now: at(21),
    });
    check(
      selfPosted.lifecycle_state === 'POSTED' &&
        selfPosted.approved_by_user_id === maker &&
        (await shopPayable()) === payableBefore + 300,
      'A correction within the limit could not be posted by its proposer',
    );
    // Over the published limit, a second operator is required again.
    const large = await complete.previewCorrection({
      context: makerOps,
      entries: shifted(await entriesOf(selfPosted.adjustment_ledger_transaction_id), 600),
      now: at(22),
      original_ledger_transaction_id: selfPosted.adjustment_ledger_transaction_id,
    });
    check(
      large.impact_minor === 600 && large.second_approval_required,
      `A correction over the published limit did not require a second approver (${JSON.stringify(large)})`,
    );

    // A proposal nobody answers expires, and cannot be posted after.
    const captureEntries = await entriesOf(capturePosting.ledger_transaction_id);
    const stale = await complete.proposeCorrection({
      amount_minor: debits(captureEntries),
      context: makerOps,
      correction_reference: `SYNTH-CORRECTION-STALE-${tag}`,
      entries: captureEntries.map((entry) =>
        entry.account_reference === 'SYNTH-ACCOUNT-PLATFORM-CLEARING'
          ? { ...entry, component: 'ADJUSTMENT' }
          : entry,
      ),
      evidence_reference: `SYNTH-EVIDENCE-STALE-${tag}`,
      now: at(30),
      original_ledger_transaction_id: capturePosting.ledger_transaction_id,
      reason_code: 'CAPTURE_RECLASSIFIED',
    });
    const expired = await complete.expireCorrections({
      context: systemContext(maker),
      now: at(46),
    });
    const staleAfter = await pool.query<{ lifecycle_state: string; closing_reason_code: string }>(
      `SELECT lifecycle_state, closing_reason_code FROM marketplace.financial_corrections
        WHERE financial_correction_id=$1`,
      [stale.financial_correction_id],
    );
    check(
      expired >= 1 &&
        staleAfter.rows[0]?.lifecycle_state === 'EXPIRED' &&
        staleAfter.rows[0].closing_reason_code === 'APPROVAL_WINDOW_ELAPSED',
      'A proposal nobody answered did not expire',
    );
    await rejects(
      () =>
        complete.approveAndPostCorrection({
          context: checkerOps,
          expected_version: stale.version,
          financial_correction_id: stale.financial_correction_id,
          now: at(47),
        }),
      MoneyStateError,
      'An expired correction was posted',
    );

    const listed = await complete.listCorrections({ context: makerOps, limit: 200 });
    const history = (id: string) =>
      listed.corrections
        .find((row: { financial_correction_id: string }) => row.financial_correction_id === id)
        ?.events.map((event: { event_type: string }) => event.event_type);
    check(
      JSON.stringify(history(posted.financial_correction_id)) ===
        JSON.stringify(['CORRECTION_PROPOSED', 'CORRECTION_POSTED']) &&
        JSON.stringify(history(followed.financial_correction_id)) ===
          JSON.stringify(['CORRECTION_PROPOSED', 'CORRECTION_REJECTED']) &&
        JSON.stringify(history(stale.financial_correction_id)) ===
          JSON.stringify(['CORRECTION_PROPOSED', 'CORRECTION_EXPIRED']),
      'A correction does not carry its history',
    );

    const balance = await complete.ledgerTrialBalance({ context: makerOps });
    check(balance.balanced, 'The corrections left the books unbalanced');
  } finally {
    await Promise.all([pool.end(), money.close(), complete.close()]);
  }
}
