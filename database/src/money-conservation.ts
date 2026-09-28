import type { Pool, PoolClient } from 'pg';

/**
 * Whether the books agree with what everyone is owed (10.7).
 *
 * Every posting balances -- the database refuses one that does not -- but a
 * balanced ledger can still disagree with the records it summarises: a
 * settlement that says a shop is owed 900 while the shop's payable reads
 * 1,000 balances perfectly. Conservation is the ledger read against those
 * records, per participant:
 *
 * - customers: customer clearing is what was captured less what was refunded;
 * - each shop: its payable is its settlements (as re-divided and as adjusted
 *   by an answered challenge), plus adjustments decided after its payout was
 *   fixed, less what its payouts paid;
 * - each partner: their payable is what their settlements owe them, plus the
 *   trips no settlement owes (returns), dispute answers and compensations,
 *   less what their payouts paid;
 * - the provider: its clearing is what payouts paid.
 *
 * A posted correction deliberately moves the books and not the record it
 * corrects, so its reversal and adjustment are counted on the record side.
 * The platform's own accounts are the remainder: with every participant
 * reconciled and the trial balance at zero, they are too.
 *
 * Beside the money: every statement row that did not match has a case with
 * an owner, and every table that holds financial history refuses an edit.
 */
export type ConservationBreach = {
  readonly invariant:
    | 'CUSTOMER_CLEARING'
    | 'VENDOR_PAYABLE'
    | 'PARTNER_PAYABLE'
    | 'PROVIDER_CLEARING'
    | 'TRIAL_BALANCE'
    | 'STATEMENT_UNROUTED'
    | 'HISTORY_EDITABLE';
  readonly subject: string;
  readonly ledger_minor: number | null;
  readonly expected_minor: number | null;
};

export type ConservationReport = {
  readonly conserved: boolean;
  readonly checked: {
    readonly vendors: number;
    readonly partners: number;
    readonly statement_rows: number;
    readonly history_tables: number;
  };
  readonly breaches: readonly ConservationBreach[];
};

/** The tables whose rows are financial history once written. */
export const FINANCIAL_HISTORY_TABLES = Object.freeze([
  'ledger_transactions',
  'ledger_entries',
  'payment_events',
  'refund_events',
  'refund_lines',
  'settlement_lines',
  'provider_statement_imports',
  'provider_statement_rows',
  'financial_corrections',
  'financial_correction_events',
  'partner_payout_items',
  'partner_earning_adjustments',
  'partner_wait_earning_adjustments',
  'partner_attempt_compensations',
  'vendor_settlement_adjustments',
] as const);

const STATEMENT_EXCEPTION_KIND: Readonly<Record<string, string>> = Object.freeze({
  UNMATCHED: 'STATEMENT_UNMATCHED',
  DUPLICATE: 'STATEMENT_DUPLICATE',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  STATUS_MISMATCH: 'STATUS_MISMATCH',
  MISSING_EXPECTED: 'STATEMENT_MISSING',
});

/** Entries of posted corrections, counted beside the records they correct. */
const CORRECTED = `
  SELECT entry.account_reference, entry.vendor_location_id, entry.partner_user_id,
         entry.debit_minor, entry.credit_minor
    FROM marketplace.financial_corrections correction
    JOIN marketplace.ledger_entries entry
      ON entry.ledger_transaction_id IN (correction.reversal_ledger_transaction_id,
                                         correction.adjustment_ledger_transaction_id)
   WHERE correction.lifecycle_state = 'POSTED'`;

export async function auditMoneyConservation(
  queryable: Pick<Pool | PoolClient, 'query'>,
): Promise<ConservationReport> {
  const breaches: ConservationBreach[] = [];
  const compare = (
    invariant: ConservationBreach['invariant'],
    subject: string,
    ledger: number,
    expected: number,
  ) => {
    if (ledger !== expected)
      breaches.push({ invariant, subject, ledger_minor: ledger, expected_minor: expected });
  };

  const trial = await queryable.query<{ debit: string; credit: string }>(
    `SELECT COALESCE(sum(debit_minor),0)::text AS debit, COALESCE(sum(credit_minor),0)::text AS credit
       FROM marketplace.ledger_entries`,
  );
  compare('TRIAL_BALANCE', 'INR', Number(trial.rows[0]?.debit), Number(trial.rows[0]?.credit));

  const customer = await queryable.query<{ ledger: string; expected: string }>(
    `WITH corrected AS (${CORRECTED})
     SELECT (SELECT COALESCE(sum(debit_minor - credit_minor),0) FROM marketplace.ledger_entries
              WHERE account_reference='SYNTH-ACCOUNT-CUSTOMER-CLEARING')::text AS ledger,
            ((SELECT COALESCE(sum(captured_amount_minor),0) FROM marketplace.payment_transactions
               WHERE payment_state='CAPTURED')
             - (SELECT COALESCE(sum(refund_total_minor),0) FROM marketplace.refunds
                 WHERE refund_state='SUCCEEDED')
             + (SELECT COALESCE(sum(debit_minor - credit_minor),0) FROM corrected
                 WHERE account_reference='SYNTH-ACCOUNT-CUSTOMER-CLEARING'))::text AS expected`,
  );
  compare(
    'CUSTOMER_CLEARING',
    'all customers',
    Number(customer.rows[0]?.ledger),
    Number(customer.rows[0]?.expected),
  );

  const vendors = await queryable.query<{ vendor: string; ledger: string; expected: string }>(
    `WITH corrected AS (${CORRECTED}),
     owners AS (
       SELECT vendor_location_id AS vendor FROM marketplace.settlements
       UNION SELECT vendor_location_id FROM marketplace.ledger_entries
              WHERE account_reference='SYNTH-ACCOUNT-VENDOR-PAYABLE' AND vendor_location_id IS NOT NULL)
     SELECT owners.vendor::text AS vendor,
            (SELECT COALESCE(sum(credit_minor - debit_minor),0) FROM marketplace.ledger_entries
              WHERE account_reference='SYNTH-ACCOUNT-VENDOR-PAYABLE'
                AND vendor_location_id=owners.vendor)::text AS ledger,
            ((SELECT COALESCE(sum(vendor_payable_minor),0) FROM marketplace.settlements
               WHERE vendor_location_id=owners.vendor)
             -- An answered challenge moves the settlement at once and the
             -- books when it is posted.
             - (SELECT COALESCE(sum(delta_minor),0) FROM marketplace.vendor_settlement_adjustments
                 WHERE vendor_location_id=owners.vendor AND applied_to_settlement
                   AND ledger_transaction_id IS NULL)
             + (SELECT COALESCE(sum(delta_minor),0) FROM marketplace.vendor_settlement_adjustments
                 WHERE vendor_location_id=owners.vendor AND NOT applied_to_settlement
                   AND ledger_transaction_id IS NOT NULL)
             - (SELECT COALESCE(sum(payout.amount_minor),0) FROM marketplace.payouts payout
                  JOIN marketplace.settlements settlement USING (settlement_id)
                 WHERE payout.beneficiary_kind='VENDOR' AND payout.payout_state='PAID'
                   AND settlement.vendor_location_id=owners.vendor)
             + (SELECT COALESCE(sum(credit_minor - debit_minor),0) FROM corrected
                 WHERE account_reference='SYNTH-ACCOUNT-VENDOR-PAYABLE'
                   AND vendor_location_id=owners.vendor))::text AS expected
       FROM owners`,
  );
  for (const row of vendors.rows)
    compare('VENDOR_PAYABLE', row.vendor, Number(row.ledger), Number(row.expected));

  const partners = await queryable.query<{ partner: string; ledger: string; expected: string }>(
    `WITH corrected AS (${CORRECTED}),
     owners AS (
       SELECT partner_user_id AS partner FROM marketplace.settlements WHERE partner_user_id IS NOT NULL
       UNION SELECT partner_user_id FROM marketplace.ledger_entries
              WHERE account_reference='SYNTH-ACCOUNT-PARTNER-PAYABLE' AND partner_user_id IS NOT NULL)
     SELECT owners.partner::text AS partner,
            (SELECT COALESCE(sum(credit_minor - debit_minor),0) FROM marketplace.ledger_entries
              WHERE account_reference='SYNTH-ACCOUNT-PARTNER-PAYABLE'
                AND partner_user_id=owners.partner)::text AS ledger,
            ((SELECT COALESCE(sum(partner_payable_minor),0) FROM marketplace.settlements
               WHERE partner_user_id=owners.partner)
             -- A trip no settlement owes (a return): posted at what it was
             -- earned at, before any dispute answer, which is its own row.
             + (SELECT COALESCE(sum(earning.net_minor - COALESCE((
                   SELECT sum(adjustment.delta_minor)
                     FROM marketplace.partner_earning_adjustments adjustment
                    WHERE adjustment.partner_earnings_record_id = earning.partner_earnings_record_id
                 ), 0)),0)
                  FROM marketplace.partner_earnings_records earning
                 WHERE earning.partner_user_id=owners.partner AND earning.outcome<>'DELIVERED'
                   AND earning.ledger_transaction_id IS NOT NULL)
             + (SELECT COALESCE(sum(delta_minor),0) FROM marketplace.partner_earning_adjustments
                 WHERE partner_user_id=owners.partner AND ledger_transaction_id IS NOT NULL)
             + (SELECT COALESCE(sum(amount_minor),0) FROM marketplace.partner_attempt_compensations
                 WHERE partner_user_id=owners.partner AND ledger_transaction_id IS NOT NULL)
             - (SELECT COALESCE(sum(amount_minor),0) FROM marketplace.payouts
                 WHERE beneficiary_kind='PARTNER' AND payout_state='PAID'
                   AND partner_user_id=owners.partner)
             + (SELECT COALESCE(sum(credit_minor - debit_minor),0) FROM corrected
                 WHERE account_reference='SYNTH-ACCOUNT-PARTNER-PAYABLE'
                   AND partner_user_id=owners.partner))::text AS expected
       FROM owners`,
  );
  for (const row of partners.rows)
    compare('PARTNER_PAYABLE', row.partner, Number(row.ledger), Number(row.expected));

  const provider = await queryable.query<{ ledger: string; expected: string }>(
    `WITH corrected AS (${CORRECTED}),
     provider_accounts AS (
       SELECT account_reference FROM marketplace.ledger_accounts WHERE owner_kind='PROVIDER')
     SELECT (SELECT COALESCE(sum(credit_minor - debit_minor),0) FROM marketplace.ledger_entries
              WHERE account_reference IN (SELECT account_reference FROM provider_accounts))::text
              AS ledger,
            ((SELECT COALESCE(sum(amount_minor),0) FROM marketplace.payouts
               WHERE payout_state='PAID')
             + (SELECT COALESCE(sum(credit_minor - debit_minor),0) FROM corrected
                 WHERE account_reference IN (SELECT account_reference FROM provider_accounts)))::text
              AS expected`,
  );
  compare(
    'PROVIDER_CLEARING',
    'payout provider',
    Number(provider.rows[0]?.ledger),
    Number(provider.rows[0]?.expected),
  );

  // A statement row that did not match is somebody's case, open or closed.
  const statementRows = await queryable.query<{
    provider_operation_reference: string;
    reconciliation_class: string;
    routed: boolean;
  }>(
    `SELECT row.provider_operation_reference, row.reconciliation_class,
            EXISTS (SELECT 1 FROM marketplace.finance_exceptions exception
                     WHERE exception.operation_reference = row.provider_operation_reference
                       AND exception.exception_kind = CASE row.reconciliation_class
                         WHEN 'UNMATCHED' THEN 'STATEMENT_UNMATCHED'
                         WHEN 'DUPLICATE' THEN 'STATEMENT_DUPLICATE'
                         WHEN 'MISSING_EXPECTED' THEN 'STATEMENT_MISSING'
                         ELSE row.reconciliation_class END
                       AND exception.owner_reference IS NOT NULL) AS routed
       FROM marketplace.provider_statement_rows row
      WHERE row.reconciliation_class IS NOT NULL AND row.reconciliation_class <> 'MATCHED'`,
  );
  for (const row of statementRows.rows)
    if (!row.routed)
      breaches.push({
        invariant: 'STATEMENT_UNROUTED',
        subject: `${row.reconciliation_class} ${row.provider_operation_reference} (${STATEMENT_EXCEPTION_KIND[row.reconciliation_class] ?? row.reconciliation_class})`,
        ledger_minor: null,
        expected_minor: null,
      });

  // Every history table refuses an UPDATE and a DELETE before it happens.
  const history = await queryable.query<{ table_name: string; guarded: boolean }>(
    `SELECT wanted.table_name,
            EXISTS (SELECT 1 FROM pg_trigger trigger
                      JOIN pg_class relation ON relation.oid = trigger.tgrelid
                      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
                     WHERE namespace.nspname = 'marketplace'
                       AND relation.relname = wanted.table_name
                       AND NOT trigger.tgisinternal
                       AND trigger.tgtype & 2 = 2      -- BEFORE
                       AND trigger.tgtype & 8 = 8      -- DELETE
                       AND trigger.tgtype & 16 = 16)   -- UPDATE
              AS guarded
       FROM unnest($1::text[]) AS wanted(table_name)`,
    [FINANCIAL_HISTORY_TABLES],
  );
  for (const row of history.rows)
    if (!row.guarded)
      breaches.push({
        invariant: 'HISTORY_EDITABLE',
        subject: row.table_name,
        ledger_minor: null,
        expected_minor: null,
      });

  return Object.freeze({
    conserved: breaches.length === 0,
    checked: Object.freeze({
      vendors: vendors.rowCount ?? 0,
      partners: partners.rowCount ?? 0,
      statement_rows: statementRows.rowCount ?? 0,
      history_tables: history.rowCount ?? 0,
    }),
    breaches: Object.freeze(breaches),
  });
}
