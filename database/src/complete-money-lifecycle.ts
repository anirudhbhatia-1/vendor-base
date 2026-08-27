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
  if (!pattern.test(value)) throw new MoneyInputError(`${label} is not marked synthetic data`);
  return value;
}
async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class CompleteMoneyLifecycleService {
  readonly #pool: Pool;
  constructor(input: { readonly connection_string: string }) {
    this.#pool = new Pool({
      connectionString: input.connection_string,
      application_name: 'neighbourhood-store-complete-money',
      max: 12,
    });
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
    const who = admin(input.context);
    const now = input.now ?? new Date();
    const contextRefs = refs(input.context);
    marked(input.command_reference, /^SYNTH-CMD-[A-Z0-9-]{4,64}$/, 'Command reference');
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
      const updated = await client.query(
        `UPDATE marketplace.payment_transactions
            SET payment_state='VOIDED',voided_amount_minor=amount_minor,voided_at=$2,
                version=version+1,updated_at=$2 WHERE payment_transaction_id=$1 RETURNING *`,
        [input.payment_transaction_id, now],
      );
      await client.query(
        `INSERT INTO marketplace.payment_events
          (payment_event_id,payment_transaction_id,payment_version,event_type,previous_state,
           resulting_state,provider_result,command_reference,actor_id,actor_kind,reason_code,
           request_id,correlation_id,occurred_at)
         VALUES ($1,$2,$3,'PAYMENT_VOIDED','AUTHORIZED','VOIDED','SUCCEEDED',$4,$5,'admin',
           'UNUSED_AUTHORIZATION_VOIDED',$6,$7,$8)`,
        [
          createUuidV7(),
          input.payment_transaction_id,
          input.expected_version + 1,
          input.command_reference,
          who,
          contextRefs.request,
          contextRefs.correlation,
          now,
        ],
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
            `SYNTH-BENEFICIARY-${input.beneficiary_kind}-${owner.replaceAll('-', '').toUpperCase()}`,
            `SYNTH-PAYOUT-${payoutId.replaceAll('-', '').toUpperCase()}`,
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
    marked(input.statement_reference, /^SYNTH-STMT-[A-Z0-9-]{4,64}$/, 'Statement reference');
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
    marked(
      input.correction_reference,
      /^SYNTH-CORRECTION-[A-Z0-9-]{4,64}$/,
      'Correction reference',
    );
    marked(input.evidence_reference, /^SYNTH-EVIDENCE-[A-Z0-9-]{4,64}$/, 'Evidence reference');
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
    admin(input.context);
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
    const result = await this.#pool.query<any>(
      `SELECT cg.checkout_group_id,cg.checkout_reference,cg.total_minor,cg.currency,cg.lifecycle_state,
        json_agg(json_build_object('order_reference',o.order_reference,'vendor_location_id',o.vendor_location_id,
          'total_minor',o.total_minor,'state',o.lifecycle_state) ORDER BY o.order_reference) orders
       FROM marketplace.checkout_groups cg JOIN marketplace.vendor_orders o USING (checkout_group_id)
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
    const settlements = await this.#pool.query(
      `SELECT s.*,COALESCE(json_agg(sl ORDER BY sl.settlement_line_id)
        FILTER (WHERE sl.settlement_line_id IS NOT NULL),'[]') lines
       FROM marketplace.settlements s LEFT JOIN marketplace.settlement_lines sl USING (settlement_id)
       WHERE s.vendor_location_id=$1 GROUP BY s.settlement_id ORDER BY s.created_at DESC`,
      [input.vendor_location_id],
    );
    return { settlements: settlements.rows };
  }

  async partnerStatement(input: { readonly context: RequestContext }) {
    const partnerId = actor(input.context, 'delivery_partner');
    const result = await this.#pool.query(
      `SELECT e.*,p.payout_state,p.paid_at FROM marketplace.partner_earnings_records e
        LEFT JOIN marketplace.settlements s ON s.partner_user_id=e.partner_user_id
        LEFT JOIN marketplace.payouts p ON p.settlement_id=s.settlement_id AND p.beneficiary_kind='PARTNER'
       WHERE e.partner_user_id=$1 ORDER BY e.created_at DESC`,
      [partnerId],
    );
    return { earnings: result.rows };
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
