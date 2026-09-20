import { createDatabasePool } from './database-pool.js';
/* eslint-disable @typescript-eslint/no-explicit-any -- SQL projections are validated at this persistence boundary. */
import { createHash } from 'node:crypto';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import {
  MoneyAuthorizationError,
  MoneyInputError,
  MoneyNotFoundError,
  MoneyStateError,
} from './money-lifecycle.js';
import {
  LocalFakeMoneyProvider,
  providerOutcome,
  type MoneyProviderAdapter,
} from './money-policy.js';
import { transaction } from './transaction.js';

type StatementKind = 'PAYMENT' | 'PAYOUT' | 'REFUND';
type ProviderState = 'FAILED' | 'SUCCEEDED' | 'UNKNOWN';
type CorrectionEntry = {
  readonly account_reference: string;
  readonly component: string;
  readonly credit_minor: number;
  readonly debit_minor: number;
  readonly partner_user_id?: UuidV7;
  readonly source_order_reference?: string;
  readonly vendor_location_id?: UuidV7;
};

function admin(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'admin')
    throw new MoneyAuthorizationError('Finance administrator required');
  return context.actor.actor_id;
}
function financeAutomation(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'admin' && context.actor?.actor_kind !== 'system')
    throw new MoneyAuthorizationError('Finance administrator or system worker required');
  return context.actor.actor_id;
}
function actor(context: RequestContext, kind: string): UuidV7 {
  if (context.actor?.actor_kind !== kind) throw new MoneyAuthorizationError('Actor scope required');
  return context.actor.actor_id;
}
function refs(context: RequestContext) {
  return {
    correlation: parseUuidV7(context.correlation_id),
    request: parseRequestId(context.request_id),
  };
}
function amount(value: number, label: string, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
    throw new MoneyInputError(`${label} must be integer paise`);
  return value;
}
function marked(value: string, pattern: RegExp, label: string) {
  if (!pattern.test(value)) throw new MoneyInputError(`${label} is invalid`);
  return value;
}
export class CompleteMoneyLifecycleService {
  readonly #pool: Pool;
  readonly #provider: MoneyProviderAdapter;
  constructor(input: {
    readonly connection_string: string;
    readonly provider?: MoneyProviderAdapter;
  }) {
    this.#pool = createDatabasePool({
      connectionString: input.connection_string,
      application_name: 'neighbourhood-store-complete-money',
      max: 12,
    });
    this.#provider = input.provider ?? new LocalFakeMoneyProvider();
  }
  async close() {
    await this.#pool.end();
  }

  async voidAuthorization(input: {
    readonly command_reference: string;
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly now?: Date;
    readonly payment_transaction_id: UuidV7;
  }) {
    const who = financeAutomation(input.context);
    const actorKind = input.context.actor?.actor_kind ?? 'system';
    const now = input.now ?? new Date();
    const contextRefs = refs(input.context);
    marked(input.command_reference, /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/, 'Command reference');
    return transaction(this.#pool, async (client) => {
      const replay = await client.query(
        `SELECT p.* FROM marketplace.payment_events e
          JOIN marketplace.payment_transactions p USING (payment_transaction_id)
         WHERE e.command_reference=$1`,
        [input.command_reference],
      );
      if (replay.rows[0]) return replay.rows[0];
      const found = await client.query<any>(
        `SELECT * FROM marketplace.payment_transactions
          WHERE payment_transaction_id=$1 FOR UPDATE`,
        [input.payment_transaction_id],
      );
      const payment = found.rows[0];
      if (!payment) throw new MoneyNotFoundError('Payment not found');
      if (payment.payment_state !== 'AUTHORIZED' || payment.version !== input.expected_version)
        throw new MoneyStateError('Only the current authorized amount can be voided');
      // The release has to reach the provider: until it does, the customer's
      // bank still holds the money. This used to record VOIDED with a
      // provider result of SUCCEEDED that no provider had given.
      const outcome = await providerOutcome(() =>
        this.#provider.void({
          amount_minor: Number(payment.amount_minor),
          operation_reference: payment.provider_operation_reference,
          scenario: payment.provider_scenario,
        }),
      );
      const next = outcome === 'SUCCEEDED' ? 'VOIDED' : 'UNKNOWN_REQUIRES_RECONCILIATION';
      const updated = await client.query(
        `UPDATE marketplace.payment_transactions
            SET payment_state=$3,
                voided_amount_minor=CASE WHEN $3='VOIDED' THEN amount_minor ELSE voided_amount_minor END,
                voided_at=CASE WHEN $3='VOIDED' THEN $2::timestamptz ELSE voided_at END,
                version=version+1,updated_at=$2 WHERE payment_transaction_id=$1 RETURNING *`,
        [input.payment_transaction_id, now, next],
      );
      await client.query(
        `INSERT INTO marketplace.payment_events
          (payment_event_id,payment_transaction_id,payment_version,event_type,previous_state,
           resulting_state,provider_result,command_reference,actor_id,actor_kind,reason_code,
           request_id,correlation_id,occurred_at)
         VALUES ($1,$2,$3,'PAYMENT_VOIDED','AUTHORIZED',$4,$5,$6,$7,$8,
           'UNUSED_AUTHORIZATION_VOIDED',$9,$10,$11)`,
        [
          createUuidV7(),
          input.payment_transaction_id,
          input.expected_version + 1,
          next,
          outcome,
          input.command_reference,
          who,
          actorKind,
          contextRefs.request,
          contextRefs.correlation,
          now,
        ],
      );
      // A void the provider declined or did not answer leaves money held
      // that the order will never use; it is an exception until a statement
      // or a status query says which. A declined void is not a decline of
      // the payment, so it is never recorded as FAILED.
      if (outcome !== 'SUCCEEDED')
        await client.query(
          `INSERT INTO marketplace.finance_exceptions
            (finance_exception_id,exception_kind,operation_reference,amount_at_risk_minor,
             next_action_code,created_at,updated_at)
           VALUES ($1,'PAYMENT_UNKNOWN',$2,$3,'RECONCILE_VOID_SAME_OPERATION',$4,$4)`,
          [createUuidV7(), payment.provider_operation_reference, payment.amount_minor, now],
        );
      return updated.rows[0];
    });
  }

  async createPayoutBatch(input: {
    readonly beneficiary_kind: 'PARTNER' | 'VENDOR';
    readonly context: RequestContext;
    readonly now?: Date;
    readonly provider_scenario: 'DECLINE' | 'MALFORMED' | 'SUCCESS' | 'UNKNOWN';
  }) {
    financeAutomation(input.context);
    const now = input.now ?? new Date();
    const contextRefs = refs(input.context);
    return transaction(this.#pool, async (client) => {
      const day = now.toISOString().slice(0, 10).replaceAll('-', '');
      // payout_batch_reference_shape requires the SYNTH- prefix, the same
      // omission the ledger references in this file carried.
      const batchReference = `SYNTH-PAYOUT-BATCH-${input.beneficiary_kind}-${day}`;
      const replay = await client.query(
        `SELECT * FROM marketplace.payout_batches WHERE batch_reference=$1`,
        [batchReference],
      );
      if (replay.rows[0]) return this.#projectBatch(client, replay.rows[0].payout_batch_id);
      const batchId = createUuidV7();
      await client.query(
        `INSERT INTO marketplace.payout_batches
          (payout_batch_id,batch_reference,beneficiary_kind,scheduled_for,request_id,correlation_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          batchId,
          batchReference,
          input.beneficiary_kind,
          now,
          contextRefs.request,
          contextRefs.correlation,
        ],
      );
      const settlements = await client.query<any>(
        `SELECT * FROM marketplace.settlements s
          WHERE s.settlement_state IN ('PENDING','ELIGIBLE') AND s.eligible_at<=$1
            AND CASE WHEN $2='VENDOR' THEN s.vendor_payable_minor ELSE s.partner_payable_minor END > 0
            AND NOT EXISTS (SELECT 1 FROM marketplace.payouts p
              WHERE p.settlement_id=s.settlement_id AND p.beneficiary_kind=$2)
          ORDER BY s.eligible_at,s.settlement_id FOR UPDATE SKIP LOCKED`,
        [now, input.beneficiary_kind],
      );
      let total = 0;
      for (const settlement of settlements.rows) {
        const payoutId = createUuidV7();
        const payable = Number(
          input.beneficiary_kind === 'VENDOR'
            ? settlement.vendor_payable_minor
            : settlement.partner_payable_minor,
        );
        total += payable;
        const owner =
          input.beneficiary_kind === 'VENDOR'
            ? String(settlement.vendor_location_id)
            : String(settlement.partner_user_id);
        await client.query(
          `INSERT INTO marketplace.payouts
            (payout_id,settlement_id,beneficiary_kind,beneficiary_reference,
             provider_operation_reference,payout_state,amount_minor,provider_scenario,
             payout_batch_id,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,'SCHEDULED',$6,$7,$8,$9,$9)`,
          [
            payoutId,
            settlement.settlement_id,
            input.beneficiary_kind,
            `BENEFICIARY-${input.beneficiary_kind}-${owner.replaceAll('-', '').toUpperCase()}`,
            `PAYOUT-${payoutId.replaceAll('-', '').toUpperCase()}`,
            payable,
            input.provider_scenario,
            batchId,
            now,
          ],
        );
        await client.query(
          `UPDATE marketplace.settlements SET settlement_state='SCHEDULED',version=version+1,
            updated_at=$2 WHERE settlement_id=$1`,
          [settlement.settlement_id, now],
        );
      }
      await client.query(
        `UPDATE marketplace.payout_batches SET lifecycle_state=$2,total_minor=$3,item_count=$4,
          updated_at=$5 WHERE payout_batch_id=$1`,
        [batchId, settlements.rowCount ? 'READY' : 'DRAFT', total, settlements.rowCount ?? 0, now],
      );
      return this.#projectBatch(client, batchId);
    });
  }

  async scheduleDailyPayoutJob(input: { readonly context: RequestContext; readonly now?: Date }) {
    financeAutomation(input.context);
    const now = input.now ?? new Date();
    const contextRefs = refs(input.context);
    const fields = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
        minute: '2-digit',
        month: '2-digit',
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
      })
        .formatToParts(now)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    const year = fields['year'];
    const month = fields['month'];
    const day = fields['day'];
    const hour = fields['hour'];
    if ([year, month, day, hour].some((field) => field === undefined))
      throw new MoneyStateError('Asia/Kolkata payout schedule could not be resolved');
    const nextDay = Number(hour) >= 18;
    // India has a fixed UTC+05:30 offset and does not observe daylight-saving time.
    const runAt = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day) + (nextDay ? 1 : 0), 12, 30),
    );
    const localDate = new Date(runAt.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const key = `finance.daily-payout.${localDate}`;
    const jobId = createUuidV7();
    const result = await this.#pool.query(
      `INSERT INTO marketplace.scheduled_jobs
        (job_id,queue_scope,job_type,idempotency_key,payload,request_id,correlation_id,
         run_at,max_attempts)
       VALUES ($1,'finance.payout','finance.payout.daily_batch',$2,$3,$4,$5,$6,8)
       ON CONFLICT (queue_scope,idempotency_key) DO UPDATE SET updated_at=marketplace.scheduled_jobs.updated_at
       RETURNING *`,
      [
        jobId,
        key,
        JSON.stringify({
          beneficiary_kinds: ['VENDOR', 'PARTNER'],
          local_time: '18:00',
          timezone: 'Asia/Kolkata',
        }),
        contextRefs.request,
        contextRefs.correlation,
        runAt,
      ],
    );
    return result.rows[0];
  }

  async importProviderStatement(input: {
    readonly context: RequestContext;
    readonly rows: readonly {
      readonly amount_minor: number;
      readonly operation_kind: StatementKind;
      readonly provider_operation_reference: string;
      readonly provider_state: ProviderState;
    }[];
    readonly statement_reference: string;
    readonly now?: Date;
  }) {
    const who = admin(input.context);
    const now = input.now ?? new Date();
    const contextRefs = refs(input.context);
    marked(input.statement_reference, /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/, 'Statement reference');
    const canonical = JSON.stringify(input.rows);
    const digest = createHash('sha256').update(canonical).digest('hex');
    return transaction(this.#pool, async (client) => {
      const replay = await client.query(
        `SELECT * FROM marketplace.provider_statement_imports
          WHERE statement_reference=$1 OR content_digest=$2`,
        [input.statement_reference, digest],
      );
      if (replay.rows[0])
        return this.#projectImport(client, replay.rows[0].provider_statement_import_id);
      const importId = createUuidV7();
      await client.query(
        `INSERT INTO marketplace.provider_statement_imports
          (provider_statement_import_id,statement_reference,content_digest,row_count,
           imported_by_user_id,request_id,correlation_id,imported_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          importId,
          input.statement_reference,
          digest,
          input.rows.length,
          who,
          contextRefs.request,
          contextRefs.correlation,
          now,
        ],
      );
      const seen = new Set<string>();
      for (const row of input.rows) {
        amount(row.amount_minor, 'Statement amount');
        const expected = await this.#expectedOperation(
          client,
          row.provider_operation_reference,
          row.operation_kind,
        );
        const prior = await client.query(
          `SELECT 1 FROM marketplace.provider_statement_rows
            WHERE provider_operation_reference=$1 LIMIT 1`,
          [row.provider_operation_reference],
        );
        let classification = 'MATCHED';
        if (seen.has(row.provider_operation_reference) || prior.rows[0])
          classification = 'DUPLICATE';
        else if (!expected) classification = 'UNMATCHED';
        else if (expected.amount_minor !== row.amount_minor) classification = 'AMOUNT_MISMATCH';
        else if (expected.provider_state !== row.provider_state) classification = 'STATUS_MISMATCH';
        seen.add(row.provider_operation_reference);
        await client.query(
          `INSERT INTO marketplace.provider_statement_rows
            (statement_row_id,provider_operation_reference,statement_reference,operation_kind,
             amount_minor,provider_state,matched_at,created_at,provider_statement_import_id,
             reconciliation_class,expected_amount_minor,expected_state)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            createUuidV7(),
            row.provider_operation_reference,
            input.statement_reference,
            row.operation_kind,
            row.amount_minor,
            row.provider_state,
            classification === 'MATCHED' ? now : null,
            now,
            importId,
            classification,
            expected?.amount_minor ?? null,
            expected?.provider_state ?? null,
          ],
        );
        if (classification !== 'MATCHED') {
          const exceptionKind =
            classification === 'DUPLICATE'
              ? 'STATEMENT_DUPLICATE'
              : classification === 'AMOUNT_MISMATCH'
                ? 'AMOUNT_MISMATCH'
                : classification === 'STATUS_MISMATCH'
                  ? 'STATUS_MISMATCH'
                  : 'STATEMENT_UNMATCHED';
          await client.query(
            `INSERT INTO marketplace.finance_exceptions
              (finance_exception_id,exception_kind,operation_reference,amount_at_risk_minor,
               owner_reference,next_action_code,created_at,updated_at)
             VALUES ($1,$2,$3,$4,'FINANCE_RECONCILIATION','REVIEW_STATEMENT_ROW',$5,$5)`,
            [
              createUuidV7(),
              exceptionKind,
              row.provider_operation_reference,
              row.amount_minor,
              now,
            ],
          );
        }
      }
      return this.#projectImport(client, importId);
    });
  }

  async proposeCorrection(input: {
    readonly amount_minor: number;
    readonly context: RequestContext;
    readonly correction_reference: string;
    readonly entries: readonly CorrectionEntry[];
    readonly evidence_reference: string;
    readonly now?: Date;
    readonly original_ledger_transaction_id: UuidV7;
    readonly reason_code: string;
  }) {
    const who = admin(input.context);
    const now = input.now ?? new Date();
    const contextRefs = refs(input.context);
    marked(input.correction_reference, /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/, 'Correction reference');
    marked(input.evidence_reference, /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/, 'Evidence reference');
    const total = this.#validateEntries(input.entries);
    if (total !== amount(input.amount_minor, 'Correction amount'))
      throw new MoneyInputError('Correction amount must equal proposed entry debits');
    return transaction(this.#pool, async (client) => {
      const original = await client.query(
        `SELECT 1 FROM marketplace.ledger_transactions WHERE ledger_transaction_id=$1`,
        [input.original_ledger_transaction_id],
      );
      if (!original.rows[0]) throw new MoneyNotFoundError('Original ledger transaction not found');
      const correctionId = createUuidV7();
      const inserted = await client.query(
        `INSERT INTO marketplace.financial_corrections
          (financial_correction_id,correction_reference,original_ledger_transaction_id,
           reason_code,evidence_reference,amount_minor,proposed_entries,proposed_by_user_id,
           approval_expires_at,request_id,correlation_id,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,
        [
          correctionId,
          input.correction_reference,
          input.original_ledger_transaction_id,
          input.reason_code,
          input.evidence_reference,
          input.amount_minor,
          JSON.stringify(input.entries),
          who,
          new Date(now.getTime() + 900_000),
          contextRefs.request,
          contextRefs.correlation,
          now,
        ],
      );
      await this.#correctionEvent(client, {
        actor_id: who,
        context: input.context,
        correction_id: correctionId,
        event_type: 'CORRECTION_PROPOSED',
        now,
        previous_state: null,
        reason_code: input.reason_code,
        resulting_state: 'PROPOSED',
        version: 1,
      });
      return inserted.rows[0];
    });
  }

  async approveAndPostCorrection(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly financial_correction_id: UuidV7;
    readonly now?: Date;
  }) {
    const who = admin(input.context);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const found = await client.query<any>(
        `SELECT * FROM marketplace.financial_corrections
          WHERE financial_correction_id=$1 FOR UPDATE`,
        [input.financial_correction_id],
      );
      const correction = found.rows[0];
      if (!correction) throw new MoneyNotFoundError('Correction not found');
      if (
        correction.lifecycle_state !== 'PROPOSED' ||
        correction.version !== input.expected_version ||
        correction.approval_expires_at <= now ||
        correction.proposed_by_user_id === who
      )
        throw new MoneyStateError('Correction approval is stale, expired, or self-approved');
      const originalEntries = await client.query<any>(
        `SELECT * FROM marketplace.ledger_entries WHERE ledger_transaction_id=$1 ORDER BY ledger_entry_id`,
        [correction.original_ledger_transaction_id],
      );
      const reversalId = await this.#postEntries(client, {
        context: input.context,
        entries: originalEntries.rows.map((entry: any) => ({
          account_reference: entry.account_reference,
          component: 'REVERSAL',
          debit_minor: Number(entry.credit_minor),
          credit_minor: Number(entry.debit_minor),
          vendor_location_id: entry.vendor_location_id ?? undefined,
          partner_user_id: entry.partner_user_id ?? undefined,
          source_order_reference: entry.source_order_reference ?? undefined,
        })),
        kind: 'REVERSAL',
        now,
        source_reference: `SYNTH-ADJUSTMENT-REVERSAL-${String(correction.financial_correction_id).replaceAll('-', '').toUpperCase()}`,
      });
      const adjustmentId = await this.#postEntries(client, {
        context: input.context,
        entries: correction.proposed_entries as CorrectionEntry[],
        kind: 'ADJUSTMENT',
        now,
        source_reference: `SYNTH-ADJUSTMENT-CORRECTION-${String(correction.financial_correction_id).replaceAll('-', '').toUpperCase()}`,
      });
      const updated = await client.query(
        `UPDATE marketplace.financial_corrections SET lifecycle_state='POSTED',approved_by_user_id=$2,
          reversal_ledger_transaction_id=$3,adjustment_ledger_transaction_id=$4,version=2,updated_at=$5
          WHERE financial_correction_id=$1 RETURNING *`,
        [input.financial_correction_id, who, reversalId, adjustmentId, now],
      );
      await this.#correctionEvent(client, {
        actor_id: who,
        context: input.context,
        correction_id: input.financial_correction_id,
        event_type: 'CORRECTION_POSTED',
        now,
        previous_state: 'PROPOSED',
        reason_code: correction.reason_code,
        resulting_state: 'POSTED',
        version: 2,
      });
      return updated.rows[0];
    });
  }

  async postPartnerEarning(input: {
    readonly context: RequestContext;
    readonly partner_earnings_record_id: UuidV7;
    readonly now?: Date;
  }) {
    financeAutomation(input.context);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const found = await client.query<any>(
        `SELECT * FROM marketplace.partner_earnings_records
          WHERE partner_earnings_record_id=$1 FOR UPDATE`,
        [input.partner_earnings_record_id],
      );
      const earning = found.rows[0];
      if (!earning) throw new MoneyNotFoundError('Partner earning not found');
      if (earning.ledger_transaction_id) return earning;
      const credits = [
        ['PARTNER_BASE', Number(earning.base_minor)],
        ['PARTNER_DISTANCE', Number(earning.distance_minor)],
        ['PARTNER_TIME', Number(earning.time_minor)],
        ['PARTNER_WAIT', Number(earning.wait_minor)],
        ['PARTNER_RETURN', Number(earning.return_minor)],
        ['PARTNER_INCENTIVE', Number(earning.incentive_minor)],
        ['PARTNER_TIP', Number(earning.tip_minor)],
        ['ADJUSTMENT', Math.max(0, Number(earning.adjustment_minor))],
      ].filter(([, value]) => Number(value) > 0);
      const negativeAdjustment = Math.max(0, -Number(earning.adjustment_minor));
      const ledgerId = await this.#postEntries(client, {
        context: input.context,
        entries: [
          {
            account_reference: 'SYNTH-ACCOUNT-PARTNER-PAYABLE',
            component: 'ADJUSTMENT',
            debit_minor: Number(earning.net_minor),
            credit_minor: 0,
            partner_user_id: earning.partner_user_id,
          },
          ...(negativeAdjustment > 0
            ? [
                {
                  account_reference: 'SYNTH-ACCOUNT-PARTNER-PAYABLE',
                  component: 'ADJUSTMENT',
                  debit_minor: negativeAdjustment,
                  credit_minor: 0,
                  partner_user_id: earning.partner_user_id,
                },
              ]
            : []),
          ...credits.map(([component, value]) => ({
            account_reference: 'SYNTH-ACCOUNT-PARTNER-PAYABLE',
            component: String(component),
            debit_minor: 0,
            credit_minor: Number(value),
            partner_user_id: earning.partner_user_id,
          })),
        ],
        kind: 'ADJUSTMENT',
        now,
        source_reference: `SYNTH-ADJUSTMENT-EARNING-${String(input.partner_earnings_record_id).replaceAll('-', '').toUpperCase()}`,
      });
      const updated = await client.query(
        `UPDATE marketplace.partner_earnings_records SET ledger_transaction_id=$2,updated_at=$3
          WHERE partner_earnings_record_id=$1 RETURNING *`,
        [input.partner_earnings_record_id, ledgerId, now],
      );
      return updated.rows[0];
    });
  }

  async customerReceipt(input: {
    readonly checkout_group_id: UuidV7;
    readonly context: RequestContext;
  }) {
    const customerId = actor(input.context, 'customer');
    // Refunds are part of the receipt, not a separate story. A customer who was
    // partially refunded — a missing line, a lighter weight than ordered — could
    // previously see the original total and nothing else, which reads as if the
    // money simply vanished. Each refund is reported against the order it
    // belongs to, with what it covered, so the arithmetic is visible.
    const result = await this.#pool.query<any>(
      `SELECT cg.checkout_group_id,cg.checkout_reference,cg.total_minor,cg.currency,cg.lifecycle_state,
        json_agg(DISTINCT jsonb_build_object('order_reference',o.order_reference,'vendor_location_id',o.vendor_location_id,
          'total_minor',o.total_minor,'state',o.lifecycle_state)) orders,
        COALESCE(json_agg(DISTINCT jsonb_build_object('refund_id',r.refund_id,'order_reference',r.source_order_reference,
          'refund_state',r.refund_state,'trigger_code',r.trigger_code,'refund_total_minor',r.refund_total_minor,
          'item_minor',r.item_minor,'tax_minor',r.tax_minor,'delivery_minor',r.delivery_minor,
          'tip_minor',r.tip_minor)) FILTER (WHERE r.refund_id IS NOT NULL),'[]') refunds,
        COALESCE((SELECT sum(refund.refund_total_minor) FROM marketplace.refunds refund
                   WHERE refund.source_order_reference IN (
                     SELECT vendor_order.order_reference FROM marketplace.vendor_orders vendor_order
                      WHERE vendor_order.checkout_group_id = cg.checkout_group_id)
                     AND refund.refund_state NOT IN ('PROPOSED','REJECTED')),0) refunded_total_minor
       FROM marketplace.checkout_groups cg JOIN marketplace.vendor_orders o USING (checkout_group_id)
       LEFT JOIN marketplace.refunds r ON r.source_order_reference = o.order_reference
       WHERE cg.checkout_group_id=$1 AND cg.customer_user_id=$2 GROUP BY cg.checkout_group_id`,
      [input.checkout_group_id, customerId],
    );
    if (!result.rows[0]) throw new MoneyNotFoundError('Receipt not found');
    return result.rows[0];
  }

  async vendorStatement(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
  }) {
    const userId = actor(input.context, 'vendor_staff');
    const membership = await this.#pool.query(
      `SELECT 1 FROM marketplace.staff_memberships sm JOIN marketplace.role_assignments ra
        ON ra.role_assignment_id=sm.role_assignment_id
       WHERE sm.user_id=$1 AND sm.vendor_location_id=$2 AND ra.state='ACTIVE'
         AND ra.valid_from<=clock_timestamp() AND (ra.valid_until IS NULL OR ra.valid_until>clock_timestamp())`,
      [userId, input.vendor_location_id],
    );
    if (!membership.rows[0]) throw new MoneyNotFoundError('Statement not found');
    // The shape `VendorStatement` in the typed contracts declares, and the
    // vendor console renders. This returned raw `settlements.*` rows -- bigint
    // strings under the table's own column names -- so the payouts page
    // crashed on `lifecycle_state.toLowerCase()` the first time a store had a
    // settlement to show. The ladder had asserted only that the rows belonged
    // to the right location, never that they had the fields the contract says.
    //
    // Gross is what the goods sold for after refunds; the platform's share is
    // the commission on that; net is what the vendor is owed. The three add up
    // by construction of the settlement, and that is asserted, not assumed.
    const settlements = await this.#pool.query<{
      settlement_id: string;
      source_order_reference: string;
      settlement_state: string;
      eligible_at: Date;
      vendor_payable_minor: string;
      platform_remainder_minor: string;
    }>(
      `SELECT settlement_id, source_order_reference, settlement_state, eligible_at,
              vendor_payable_minor::text, platform_remainder_minor::text
         FROM marketplace.settlements
        WHERE vendor_location_id=$1
        ORDER BY created_at DESC`,
      [input.vendor_location_id],
    );
    const entries = settlements.rows.map((row) => {
      const net = Number(row.vendor_payable_minor);
      const fee = Number(row.platform_remainder_minor);
      return Object.freeze({
        settlement_id: row.settlement_id,
        reference: row.source_order_reference,
        eligible_at: row.eligible_at.toISOString(),
        lifecycle_state: row.settlement_state,
        gross_minor: net + fee,
        platform_fee_minor: fee,
        net_minor: net,
      });
    });
    const sum = (states: readonly string[]) =>
      entries
        .filter((entry) => states.includes(entry.lifecycle_state))
        .reduce((total, entry) => total + entry.net_minor, 0);
    return Object.freeze({
      vendor_location_id: input.vendor_location_id,
      pending_minor: sum(['PENDING', 'HELD', 'FAILED_REVIEW']),
      eligible_minor: sum(['ELIGIBLE', 'SCHEDULED', 'SUBMITTED']),
      settled_minor: sum(['PAID']),
      settlements: Object.freeze(entries),
    });
  }

  /**
   * The shape `PartnerStatement` declares, and the earnings screen renders.
   *
   * Same defect as the vendor statement: raw rows, so the screen crashed on
   * the first earning. The old query also joined every settlement of the
   * partner to every earning of theirs, so a rider with two deliveries saw
   * each earning twice; the payout is now found through the order the earning
   * belongs to.
   */
  async partnerStatement(input: { readonly context: RequestContext }) {
    const partnerId = actor(input.context, 'delivery_partner');
    const result = await this.#pool.query<{
      partner_earnings_record_id: string;
      source_order_reference: string;
      net_minor: string;
      created_at: Date;
      payout_state: string | null;
    }>(
      `SELECT e.partner_earnings_record_id, a.source_order_reference, e.net_minor::text,
              e.created_at, payout.payout_state
         FROM marketplace.partner_earnings_records e
         JOIN marketplace.delivery_assignments a USING (delivery_assignment_id)
         LEFT JOIN marketplace.settlements s
           ON s.source_order_reference = a.source_order_reference
         LEFT JOIN LATERAL (
           SELECT p.payout_state FROM marketplace.payouts p
            WHERE p.settlement_id = s.settlement_id AND p.beneficiary_kind = 'PARTNER'
            ORDER BY p.created_at DESC LIMIT 1
         ) payout ON true
        WHERE e.partner_user_id=$1
        ORDER BY e.created_at DESC`,
      [partnerId],
    );
    const earnings = result.rows.map((row) =>
      Object.freeze({
        partner_earnings_record_id: row.partner_earnings_record_id,
        reference: row.source_order_reference,
        // What has happened to the money, in the payout's own words; before a
        // payout exists the amount is earned and nothing more.
        lifecycle_state: row.payout_state ?? 'EARNED',
        total_minor: Number(row.net_minor),
        posted_at: row.created_at.toISOString(),
      }),
    );
    const total = earnings.reduce((sum, entry) => sum + entry.total_minor, 0);
    const paid = earnings
      .filter((entry) => entry.lifecycle_state === 'PAID')
      .reduce((sum, entry) => sum + entry.total_minor, 0);
    return Object.freeze({
      pending_minor: total - paid,
      paid_minor: paid,
      total_earned_minor: total,
      earnings: Object.freeze(earnings),
    });
  }

  async financeQueue(input: { readonly context: RequestContext }) {
    admin(input.context);
    const rows = await this.#pool.query(
      `SELECT * FROM marketplace.finance_exceptions WHERE exception_state<>'RESOLVED'
        ORDER BY amount_at_risk_minor DESC,created_at,finance_exception_id`,
    );
    return { exceptions: rows.rows };
  }

  async #expectedOperation(client: PoolClient, reference: string, kind: StatementKind) {
    const query =
      kind === 'PAYMENT'
        ? `SELECT amount_minor,payment_state state FROM marketplace.payment_transactions WHERE provider_operation_reference=$1`
        : kind === 'REFUND'
          ? `SELECT refund_total_minor amount_minor,refund_state state FROM marketplace.refunds WHERE provider_operation_reference=$1`
          : `SELECT amount_minor,payout_state state FROM marketplace.payouts WHERE provider_operation_reference=$1`;
    const result = await client.query<any>(query, [reference]);
    const row = result.rows[0];
    if (!row) return null;
    const succeeded = ['AUTHORIZED', 'CAPTURED', 'PAID', 'SUCCEEDED', 'VOIDED'].includes(
      String(row.state),
    );
    const failed = ['FAILED', 'FAILED_RETRYABLE', 'FAILED_REVIEW', 'CANCELLED'].includes(
      String(row.state),
    );
    return {
      amount_minor: Number(row.amount_minor),
      provider_state: succeeded ? 'SUCCEEDED' : failed ? 'FAILED' : 'UNKNOWN',
    };
  }

  async #projectBatch(client: PoolClient, id: string) {
    const batch = await client.query<any>(
      `SELECT * FROM marketplace.payout_batches WHERE payout_batch_id=$1`,
      [id],
    );
    const payouts = await client.query<any>(
      `SELECT * FROM marketplace.payouts WHERE payout_batch_id=$1 ORDER BY payout_id`,
      [id],
    );
    return { ...batch.rows[0], payouts: payouts.rows };
  }
  async #projectImport(client: PoolClient, id: string) {
    const statement = await client.query<any>(
      `SELECT * FROM marketplace.provider_statement_imports WHERE provider_statement_import_id=$1`,
      [id],
    );
    const rows = await client.query<any>(
      `SELECT * FROM marketplace.provider_statement_rows WHERE provider_statement_import_id=$1 ORDER BY statement_row_id`,
      [id],
    );
    return { ...statement.rows[0], rows: rows.rows };
  }
  #validateEntries(entries: readonly CorrectionEntry[]) {
    if (entries.length < 2 || entries.length > 20)
      throw new MoneyInputError('Correction requires two to twenty entries');
    let debit = 0;
    let credit = 0;
    for (const entry of entries) {
      amount(entry.debit_minor, 'Debit', true);
      amount(entry.credit_minor, 'Credit', true);
      if (entry.debit_minor > 0 === entry.credit_minor > 0)
        throw new MoneyInputError('Every correction entry must use exactly one side');
      debit += entry.debit_minor;
      credit += entry.credit_minor;
    }
    if (debit !== credit || debit <= 0)
      throw new MoneyInputError('Correction entries must balance');
    return debit;
  }
  async #postEntries(
    client: PoolClient,
    input: {
      readonly context: RequestContext;
      readonly entries: readonly CorrectionEntry[];
      readonly kind: string;
      readonly now: Date;
      readonly source_reference: string;
    },
  ) {
    this.#validateEntries(input.entries);
    const contextRefs = refs(input.context);
    const ledgerId = createUuidV7();
    await client.query(
      `INSERT INTO marketplace.ledger_transactions
        (ledger_transaction_id,source_reference,transaction_kind,posted_at,request_id,correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        ledgerId,
        input.source_reference,
        input.kind,
        input.now,
        contextRefs.request,
        contextRefs.correlation,
      ],
    );
    for (const entry of input.entries) {
      await client.query(
        `INSERT INTO marketplace.ledger_entries
          (ledger_entry_id,ledger_transaction_id,account_reference,component,debit_minor,credit_minor,
           vendor_location_id,partner_user_id,source_order_reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          createUuidV7(),
          ledgerId,
          entry.account_reference,
          entry.component,
          entry.debit_minor,
          entry.credit_minor,
          entry.vendor_location_id ?? null,
          entry.partner_user_id ?? null,
          entry.source_order_reference ?? null,
        ],
      );
    }
    return ledgerId;
  }
  async #correctionEvent(
    client: PoolClient,
    input: {
      readonly actor_id: UuidV7;
      readonly context: RequestContext;
      readonly correction_id: UuidV7;
      readonly event_type: string;
      readonly now: Date;
      readonly previous_state: string | null;
      readonly reason_code: string;
      readonly resulting_state: string;
      readonly version: number;
    },
  ) {
    const contextRefs = refs(input.context);
    await client.query(
      `INSERT INTO marketplace.financial_correction_events
        (financial_correction_event_id,financial_correction_id,correction_version,event_type,
         previous_state,resulting_state,actor_id,reason_code,request_id,correlation_id,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        createUuidV7(),
        input.correction_id,
        input.version,
        input.event_type,
        input.previous_state,
        input.resulting_state,
        input.actor_id,
        input.reason_code,
        contextRefs.request,
        contextRefs.correlation,
        input.now,
      ],
    );
  }
}
