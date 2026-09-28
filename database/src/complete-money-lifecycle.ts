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
  MoneyLifecycleService,
  MoneyNotFoundError,
  MoneyStateError,
} from './money-lifecycle.js';
import {
  LocalFakeMoneyProvider,
  providerOutcome,
  type MoneyProviderAdapter,
} from './money-policy.js';
import { transaction } from './transaction.js';
import { assembleTrialBalance, type LedgerAccountBalanceRow } from './ledger-balance.js';
import { divideOrder, OrderDivisionError, type OrderDivision } from './settlement-division.js';
import { correctionImpact, CorrectionImpactError } from './correction-impact.js';
import { resolveConfiguration } from './versioned-configuration.js';

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

/**
 * The states in which a settlement's payout is not yet fixed, so its payable
 * may still move. A payout batch writes the amount it will pay when it moves
 * the settlement to SCHEDULED; changing the payable after that paid the stale
 * figure while the books recorded the new one.
 */
const REDIVIDABLE_SETTLEMENT_STATES: ReadonlySet<string> = new Set([
  'PENDING',
  'ELIGIBLE',
  'HELD',
  'FAILED_REVIEW',
]);

/**
 * One ledger entry from a signed credit: positive credits the account,
 * negative debits it, zero is no entry. Entries built this way balance when
 * their signed amounts sum to zero.
 */
function signedEntry(
  account_reference: string,
  signed_credit_minor: number,
  owner: {
    readonly source_order_reference?: string;
    readonly vendor_location_id?: UuidV7;
    readonly partner_user_id?: UuidV7;
  },
): CorrectionEntry | null {
  if (signed_credit_minor === 0) return null;
  return {
    account_reference,
    component: 'ADJUSTMENT',
    debit_minor: signed_credit_minor < 0 ? -signed_credit_minor : 0,
    credit_minor: signed_credit_minor > 0 ? signed_credit_minor : 0,
    ...owner,
  };
}

/** The settlement lines a shop may challenge (VEN-50). */
export type DisputableComponent =
  'ITEM_PROCEEDS' | 'PAYMENT_FEE' | 'PLATFORM_FEE' | 'REFUND' | 'TAX';

function isDisputableComponent(value: string): value is DisputableComponent {
  return Object.hasOwn(DISPUTE_DIRECTION, value);
}

/**
 * Which way an answer moves the shop's money. The goods paid for are the
 * shop's: an answer above the line pays it more. A fee, a payment cost, tax,
 * or goods taken back are deductions: an answer *below* the line pays it more.
 */
const DISPUTE_DIRECTION: Readonly<Record<DisputableComponent, 1 | -1>> = Object.freeze({
  ITEM_PROCEEDS: 1,
  PAYMENT_FEE: -1,
  PLATFORM_FEE: -1,
  REFUND: -1,
  TAX: -1,
});

/** One shop challenge as the table holds it; bigint amounts arrive as text. */
export type VendorSettlementDisputeRecord = {
  readonly vendor_settlement_dispute_id: string;
  readonly settlement_id: string;
  readonly vendor_location_id: string;
  readonly disputed_component: string;
  readonly disputed_amount_minor: string;
  readonly expected_amount_minor: string;
  readonly evidence_note: string;
  readonly lifecycle_state: 'OPEN' | 'RESOLVED' | 'WITHDRAWN';
  readonly resolution_reason_code: string | null;
  readonly resolved_amount_minor: string | null;
  readonly deadline_at: Date;
  readonly resolved_at: Date | null;
  readonly created_at: Date;
};

/** An answered challenge, with the money its answer moved when it moved any. */
export type ResolvedVendorSettlementDispute = VendorSettlementDisputeRecord & {
  readonly vendor_settlement_adjustment_id?: UuidV7;
  readonly adjustment_delta_minor?: number;
  readonly applied_to_settlement?: boolean;
};

/**
 * JSON with object keys sorted, so a value read back from jsonb (which keeps
 * its own key order) compares equal to the value that was written.
 */
function canonicalJson(value: unknown): string {
  const sorted = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sorted)
      : item !== null && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(item as Record<string, unknown>)
              .filter(([, field]) => field !== undefined)
              .sort(([left], [right]) => (left < right ? -1 : 1))
              .map(([key, field]) => [key, sorted(field)]),
          )
        : item;
  return JSON.stringify(sorted(value));
}

/** How long a correction proposal waits for its approver (10.6). */
const CORRECTION_APPROVAL_WINDOW_MS = 15 * 60_000;
/** The versioned setting that holds the single-approval limit (10.6). */
const CORRECTION_APPROVAL_KEY = 'finance.correction_approval';

/** A challenge is answered within seven days (VEN-50). */
const VENDOR_DISPUTE_ANSWER_MS = 7 * 24 * 3_600_000;

type SettlementFigures = {
  /** The goods as sold, before any return. */
  readonly sale_minor: number;
  /** What the shop is paid for the goods it kept. */
  readonly goods_paid_minor: number;
  /** The goods taken back off the shop by refunds. */
  readonly goods_returned_minor: number;
  readonly platform_fee_minor: number;
  readonly payment_fee_minor: number;
  readonly tax_minor: number;
  /** Everything refunded to the customer, delivery and tip included. */
  readonly customer_refund_minor: number;
};

/**
 * One settlement's line totals, as a lateral subquery over `settlement`.
 * The component filters are the settlement's own policy-versioned lines.
 */
const SETTLEMENT_LINE_TOTALS = `
  SELECT sum(amount_minor) FILTER (WHERE component='ITEM_PROCEEDS') AS proceeds,
         sum(amount_minor) FILTER (WHERE component='PLATFORM_FEE') AS platform_fee,
         sum(amount_minor) FILTER (WHERE component='PAYMENT_FEE') AS payment_fee,
         sum(amount_minor) FILTER (WHERE component='TAX') AS tax,
         sum(amount_minor) FILTER (WHERE component='REFUND' AND participant_kind='CUSTOMER')
           AS refund
    FROM marketplace.settlement_lines
   WHERE settlement_id=settlement.settlement_id`;

function settlementFigures(row: {
  readonly goods: string | null;
  readonly proceeds: string;
  readonly platform_fee: string;
  readonly payment_fee: string;
  readonly tax: string;
  readonly customer_refund: string;
}): SettlementFigures {
  const paid = Number(row.proceeds);
  // A settlement written before 0111 has no snapshot: its sale is what its
  // lines still pay, and no return can be told apart from it.
  const sale = row.goods === null ? paid : Number(row.goods);
  return Object.freeze({
    sale_minor: sale,
    goods_paid_minor: paid,
    goods_returned_minor: Math.max(0, sale - paid),
    platform_fee_minor: Number(row.platform_fee),
    payment_fee_minor: Number(row.payment_fee),
    tax_minor: Number(row.tax),
    customer_refund_minor: Math.abs(Number(row.customer_refund)),
  });
}

function figureFor(component: DisputableComponent, figures: SettlementFigures): number {
  switch (component) {
    case 'ITEM_PROCEEDS':
      return figures.goods_paid_minor;
    case 'PLATFORM_FEE':
      return figures.platform_fee_minor;
    case 'REFUND':
      return figures.goods_returned_minor;
    case 'PAYMENT_FEE':
      return figures.payment_fee_minor;
    case 'TAX':
      return figures.tax_minor;
  }
}

/** A shop's challenge with its order, and the money its answer moved. */
export type VendorSettlementDisputeView = {
  readonly vendor_settlement_dispute_id: string;
  readonly settlement_id: string;
  readonly vendor_location_id: string;
  readonly source_order_reference: string;
  readonly disputed_component: string;
  readonly disputed_amount_minor: string;
  readonly expected_amount_minor: string;
  readonly evidence_note: string;
  readonly lifecycle_state: 'OPEN' | 'RESOLVED' | 'WITHDRAWN';
  readonly resolution_reason_code: string | null;
  readonly resolved_amount_minor: string | null;
  readonly deadline_at: Date;
  readonly resolved_at: Date | null;
  readonly created_at: Date;
  readonly adjustment_delta_minor: string | null;
  readonly applied_to_settlement: boolean | null;
};

const DISPUTE_PROJECTION = `
  SELECT dispute.vendor_settlement_dispute_id, dispute.settlement_id,
         dispute.vendor_location_id, settlement.source_order_reference,
         dispute.disputed_component,
         dispute.disputed_amount_minor::text, dispute.expected_amount_minor::text,
         dispute.evidence_note, dispute.lifecycle_state, dispute.resolution_reason_code,
         dispute.resolved_amount_minor::text, dispute.deadline_at, dispute.resolved_at,
         dispute.created_at,
         adjustment.delta_minor::text AS adjustment_delta_minor,
         adjustment.applied_to_settlement
    FROM marketplace.vendor_settlement_disputes dispute
    JOIN marketplace.settlements settlement USING (settlement_id)
    LEFT JOIN marketplace.vendor_settlement_adjustments adjustment
      ON adjustment.vendor_settlement_dispute_id=dispute.vendor_settlement_dispute_id`;

/**
 * Where a statement row that did not match goes (10.5): the reconciliation
 * queue, with the next thing a person does about it.
 */
const STATEMENT_EXCEPTIONS = Object.freeze({
  UNMATCHED: { kind: 'STATEMENT_UNMATCHED', next_action_code: 'INVESTIGATE_UNKNOWN_OPERATION' },
  DUPLICATE: { kind: 'STATEMENT_DUPLICATE', next_action_code: 'CONFIRM_DUPLICATE_SETTLEMENT' },
  AMOUNT_MISMATCH: { kind: 'AMOUNT_MISMATCH', next_action_code: 'RESOLVE_AMOUNT_DIFFERENCE' },
  STATUS_MISMATCH: { kind: 'STATUS_MISMATCH', next_action_code: 'RESOLVE_STATUS_CONFLICT' },
} as const);

/** The payee as the provider is told it; the schema requires the SYNTH- prefix. */
function beneficiaryReference(kind: 'PARTNER' | 'VENDOR', owner: string): string {
  return `SYNTH-BENEFICIARY-${kind}-${owner.replaceAll('-', '').toUpperCase()}`;
}
function payoutOperationReference(payoutId: string): string {
  return `SYNTH-PAYOUT-${payoutId.replaceAll('-', '').toUpperCase()}`;
}

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
  /** Submits a batch's payouts through the one path that pays and posts them. */
  readonly #money: MoneyLifecycleService;
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
    this.#money = new MoneyLifecycleService({
      connection_string: input.connection_string,
      provider: this.#provider,
    });
  }
  async close() {
    await Promise.all([this.#pool.end(), this.#money.close()]);
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

  /**
   * The day's payout batch for one kind of beneficiary, created once per day.
   *
   * A shop is paid per settlement. A partner is paid once per batch for
   * everything of theirs that is payable (10.4): each earning, dispute answer
   * and compensation is an item on that payout. Until audit run 69 the
   * partner run looked for settlements the shop run had just moved on, and
   * so found none; and neither run could write a payout at all, because the
   * references it wrote lacked the SYNTH- prefix the schema requires.
   */
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
      const written =
        input.beneficiary_kind === 'VENDOR'
          ? await this.#batchVendorPayouts(client, batchId, input.provider_scenario, now)
          : await this.#batchPartnerPayouts(client, batchId, input.provider_scenario, now);
      await client.query(
        `UPDATE marketplace.payout_batches SET lifecycle_state=$2,total_minor=$3,item_count=$4,
          updated_at=$5 WHERE payout_batch_id=$1`,
        [batchId, written.count ? 'READY' : 'DRAFT', written.total, written.count, now],
      );
      return this.#projectBatch(client, batchId);
    });
  }

  async #batchVendorPayouts(
    client: PoolClient,
    batchId: string,
    scenario: string,
    now: Date,
  ): Promise<{ readonly count: number; readonly total: number }> {
    const settlements = await client.query<any>(
      `SELECT * FROM marketplace.settlements s
        WHERE s.settlement_state IN ('PENDING','ELIGIBLE') AND s.eligible_at<=$1
          AND s.vendor_payable_minor > 0
          AND NOT EXISTS (SELECT 1 FROM marketplace.payouts p
            WHERE p.settlement_id=s.settlement_id AND p.beneficiary_kind='VENDOR')
        ORDER BY s.eligible_at,s.settlement_id FOR UPDATE SKIP LOCKED`,
      [now],
    );
    let total = 0;
    for (const settlement of settlements.rows) {
      const payoutId = createUuidV7();
      const payable = Number(settlement.vendor_payable_minor);
      total += payable;
      await client.query(
        `INSERT INTO marketplace.payouts
          (payout_id,settlement_id,beneficiary_kind,beneficiary_reference,
           provider_operation_reference,payout_state,amount_minor,provider_scenario,
           payout_batch_id,created_at,updated_at)
         VALUES ($1,$2,'VENDOR',$3,$4,'SCHEDULED',$5,$6,$7,$8,$8)`,
        [
          payoutId,
          settlement.settlement_id,
          beneficiaryReference('VENDOR', String(settlement.vendor_location_id)),
          payoutOperationReference(payoutId),
          payable,
          scenario,
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
    return { count: settlements.rowCount ?? 0, total };
  }

  /**
   * Every partner's payable sources, one payout per partner (10.4).
   *
   * A source is payable once it is in the books and on no live payout: an
   * earning on a delivered order once its settlement is eligible and not
   * held; an earning with no settlement to wait for (a return) once posted;
   * a dispute's answer and a reassignment's compensation once posted. The
   * earning is paid at the amount it was posted at; a later dispute answer is
   * its own item. A partner whose sources add up to nothing, or who owes more
   * than they are owed, is carried to the next batch; a partner whose last
   * payout the bank refused is held until a person has checked the account.
   */
  async #batchPartnerPayouts(
    client: PoolClient,
    batchId: string,
    scenario: string,
    now: Date,
  ): Promise<{ readonly count: number; readonly total: number }> {
    const sources = await client.query<{
      partner_user_id: string;
      source_kind: 'ADJUSTMENT' | 'COMPENSATION' | 'EARNING';
      source_id: string;
      amount_minor: string;
    }>(
      `WITH held AS (
         SELECT DISTINCT payout.partner_user_id
           FROM marketplace.finance_exceptions exception
           JOIN marketplace.payouts payout
             ON payout.provider_operation_reference = exception.operation_reference
          WHERE exception.exception_kind = 'PAYOUT_FAILED'
            AND exception.exception_state IN ('OPEN','ASSIGNED')
            AND payout.partner_user_id IS NOT NULL
       ), sources AS (
         SELECT earning.partner_user_id, 'EARNING' AS source_kind,
                earning.partner_earnings_record_id AS source_id,
                earning.net_minor - COALESCE((
                  SELECT sum(adjustment.delta_minor)
                    FROM marketplace.partner_earning_adjustments adjustment
                   WHERE adjustment.partner_earnings_record_id = earning.partner_earnings_record_id
                ), 0) AS amount_minor,
                earning.created_at
           FROM marketplace.partner_earnings_records earning
           JOIN marketplace.delivery_assignments assignment USING (delivery_assignment_id)
           LEFT JOIN marketplace.settlements settlement
             ON settlement.source_order_reference = assignment.source_order_reference
          WHERE earning.ledger_transaction_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM marketplace.partner_payout_items item
                             WHERE item.partner_earnings_record_id = earning.partner_earnings_record_id
                               AND item.lifecycle_state <> 'RELEASED')
            AND CASE WHEN earning.outcome = 'DELIVERED' THEN
                  settlement.settlement_id IS NOT NULL
                  AND settlement.eligible_at <= $1
                  AND settlement.settlement_state <> 'HELD'
                  -- Paid per order before 0112: never again.
                  AND NOT EXISTS (SELECT 1 FROM marketplace.payouts legacy
                                   WHERE legacy.settlement_id = settlement.settlement_id
                                     AND legacy.beneficiary_kind = 'PARTNER')
                ELSE true END
         UNION ALL
         SELECT adjustment.partner_user_id, 'ADJUSTMENT', adjustment.partner_earning_adjustment_id,
                adjustment.delta_minor, adjustment.created_at
           FROM marketplace.partner_earning_adjustments adjustment
          WHERE adjustment.ledger_transaction_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM marketplace.partner_payout_items item
                             WHERE item.partner_earning_adjustment_id = adjustment.partner_earning_adjustment_id
                               AND item.lifecycle_state <> 'RELEASED')
         UNION ALL
         SELECT compensation.partner_user_id, 'COMPENSATION',
                compensation.partner_attempt_compensation_id, compensation.amount_minor,
                compensation.created_at
           FROM marketplace.partner_attempt_compensations compensation
          WHERE compensation.ledger_transaction_id IS NOT NULL AND compensation.amount_minor > 0
            AND NOT EXISTS (SELECT 1 FROM marketplace.partner_payout_items item
                             WHERE item.partner_attempt_compensation_id = compensation.partner_attempt_compensation_id
                               AND item.lifecycle_state <> 'RELEASED')
       )
       SELECT partner_user_id::text, source_kind, source_id::text, amount_minor::text
         FROM sources
        WHERE amount_minor <> 0
          AND partner_user_id NOT IN (SELECT partner_user_id FROM held)
        ORDER BY partner_user_id, created_at, source_id`,
      [now],
    );
    const byPartner = new Map<string, (typeof sources.rows)[number][]>();
    for (const row of sources.rows) {
      const list = byPartner.get(row.partner_user_id) ?? [];
      list.push(row);
      byPartner.set(row.partner_user_id, list);
    }
    let count = 0;
    let total = 0;
    for (const [partnerId, items] of byPartner) {
      const payable = items.reduce((sum, item) => sum + Number(item.amount_minor), 0);
      if (payable <= 0) continue;
      const payoutId = createUuidV7();
      await client.query(
        `INSERT INTO marketplace.payouts
          (payout_id,settlement_id,partner_user_id,beneficiary_kind,beneficiary_reference,
           provider_operation_reference,payout_state,amount_minor,provider_scenario,
           payout_batch_id,created_at,updated_at)
         VALUES ($1,NULL,$2,'PARTNER',$3,$4,'SCHEDULED',$5,$6,$7,$8,$8)`,
        [
          payoutId,
          partnerId,
          beneficiaryReference('PARTNER', partnerId),
          payoutOperationReference(payoutId),
          payable,
          scenario,
          batchId,
          now,
        ],
      );
      // The live-source indexes refuse a source already on another payout,
      // so two batches racing for the same earning cannot both commit it.
      for (const item of items)
        await client.query(
          `INSERT INTO marketplace.partner_payout_items
            (partner_payout_item_id,payout_id,partner_user_id,source_kind,
             partner_earnings_record_id,partner_earning_adjustment_id,
             partner_attempt_compensation_id,amount_minor,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            createUuidV7(),
            payoutId,
            partnerId,
            item.source_kind,
            item.source_kind === 'EARNING' ? item.source_id : null,
            item.source_kind === 'ADJUSTMENT' ? item.source_id : null,
            item.source_kind === 'COMPENSATION' ? item.source_id : null,
            Number(item.amount_minor),
            now,
          ],
        );
      count += 1;
      total += payable;
    }
    return { count, total };
  }

  /**
   * Sends every scheduled payout in a batch to the provider and records where
   * the batch stands. Each payout is submitted under its own lock and version,
   * so a replay submits only what has not been sent; an unknown answer stays
   * SUBMITTED for reconciliation rather than being sent again.
   */
  async submitPayoutBatch(input: {
    readonly context: RequestContext;
    readonly payout_batch_id: UuidV7;
    readonly now?: Date;
  }) {
    financeAutomation(input.context);
    const now = input.now ?? new Date();
    const scheduled = await this.#pool.query<{ payout_id: string; version: number }>(
      `SELECT payout_id, version FROM marketplace.payouts
        WHERE payout_batch_id=$1 AND payout_state='SCHEDULED' ORDER BY payout_id`,
      [input.payout_batch_id],
    );
    for (const payout of scheduled.rows)
      await this.#money.submitPayout({
        context: input.context,
        expected_version: payout.version,
        now,
        payout_id: parseUuidV7(payout.payout_id),
      });
    return transaction(this.#pool, async (client) => {
      await this.#refreshBatchState(client, input.payout_batch_id, now);
      return this.#projectBatch(client, input.payout_batch_id);
    });
  }

  async #refreshBatchState(client: PoolClient, batchId: string, now: Date) {
    await client.query(
      `UPDATE marketplace.payout_batches batch
          SET lifecycle_state = CASE
                WHEN tally.items = 0 THEN batch.lifecycle_state
                WHEN tally.paid = tally.items THEN 'PAID'
                WHEN tally.paid > 0 THEN 'PARTIALLY_PAID'
                WHEN tally.failed = tally.items THEN 'FAILED_REVIEW'
                WHEN tally.scheduled = tally.items THEN 'READY'
                ELSE 'SUBMITTED'
              END,
              updated_at = $2
         FROM (SELECT count(*) AS items,
                      count(*) FILTER (WHERE payout_state='PAID') AS paid,
                      count(*) FILTER (WHERE payout_state='FAILED_REVIEW') AS failed,
                      count(*) FILTER (WHERE payout_state='SCHEDULED') AS scheduled
                 FROM marketplace.payouts WHERE payout_batch_id=$1) tally
        WHERE batch.payout_batch_id=$1`,
      [batchId, now],
    );
  }

  /**
   * Releases what a refused partner payout carried, after a person has
   * checked the partner's bank account (10.4). Only a payout the provider
   * definitively refused can be released: one whose outcome is unknown may
   * yet have paid, and releasing it would pay the same money twice. The
   * items become payable again in the next batch, and the case closes.
   */
  async releaseFailedPartnerPayout(input: {
    readonly context: RequestContext;
    readonly payout_id: UuidV7;
    readonly reason_code: string;
    readonly now?: Date;
  }) {
    const who = admin(input.context);
    const now = input.now ?? new Date();
    const reason = marked(input.reason_code, /^[A-Z][A-Z0-9_]{2,63}$/, 'Reason code');
    return transaction(this.#pool, async (client) => {
      const found = await client.query<{
        beneficiary_kind: string;
        payout_state: string;
        provider_operation_reference: string;
      }>(
        `SELECT beneficiary_kind, payout_state, provider_operation_reference
           FROM marketplace.payouts WHERE payout_id=$1 FOR UPDATE`,
        [input.payout_id],
      );
      const payout = found.rows[0];
      if (!payout) throw new MoneyNotFoundError('Payout not found');
      if (payout.beneficiary_kind !== 'PARTNER')
        throw new MoneyStateError('Only a partner payout carries items to release');
      if (payout.payout_state !== 'FAILED_REVIEW')
        throw new MoneyStateError('Only a payout the provider refused can be released');
      const released = await client.query(
        `UPDATE marketplace.partner_payout_items
            SET lifecycle_state='RELEASED', settled_at=$2, released_by_user_id=$3,
                release_reason_code=$4
          WHERE payout_id=$1 AND lifecycle_state='PAYING'`,
        [input.payout_id, now, who, reason],
      );
      await client.query(
        `UPDATE marketplace.finance_exceptions
            SET exception_state='RESOLVED', updated_at=$2
          WHERE exception_kind='PAYOUT_FAILED' AND operation_reference=$1
            AND exception_state<>'RESOLVED'`,
        [payout.provider_operation_reference, now],
      );
      return { payout_id: input.payout_id, released_items: released.rowCount ?? 0 };
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

  /**
   * Imports a provider statement and reconciles it against the books (10.5).
   *
   * Idempotent on the statement: the same reference with the same rows (in
   * any order) is the same import; the same reference with different rows is
   * refused, because a statement that changed under its own name is a
   * conflict, not a replay. Each row is classified against what we hold for
   * its operation: MATCHED; DUPLICATE (twice in the statement, or reported
   * with that answer by an earlier one); UNMATCHED (no such operation);
   * AMOUNT_MISMATCH; STATUS_MISMATCH (including a provider contradicting its
   * own earlier answer). A definitive answer for an operation we were still
   * waiting on is a match, and it is applied after the import commits -- the
   * capture, refund or payout settled through its own reconciliation -- so
   * nothing is retried that may already have happened. With a period, every
   * capture, refund and payout the books settled inside it and no statement
   * has reported is MISSING_EXPECTED. Everything but a match opens an
   * exception with an owner and a next action.
   */
  async importProviderStatement(input: {
    readonly context: RequestContext;
    readonly rows: readonly {
      readonly amount_minor: number;
      readonly operation_kind: StatementKind;
      readonly provider_operation_reference: string;
      readonly provider_state: ProviderState;
    }[];
    readonly statement_reference: string;
    readonly period_start?: Date;
    readonly period_end?: Date;
    readonly now?: Date;
  }) {
    const who = admin(input.context);
    const now = input.now ?? new Date();
    const contextRefs = refs(input.context);
    marked(input.statement_reference, /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/, 'Statement reference');
    if ((input.period_start === undefined) !== (input.period_end === undefined))
      throw new MoneyInputError('A statement period has a start and an end');
    if (input.period_start && input.period_end && input.period_start >= input.period_end)
      throw new MoneyInputError('A statement period must end after it starts');
    for (const row of input.rows) {
      amount(row.amount_minor, 'Statement amount');
      marked(row.provider_operation_reference, /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/, 'Operation');
      if (!['PAYMENT', 'PAYOUT', 'REFUND'].includes(row.operation_kind))
        throw new MoneyInputError('Statement operation kind is invalid');
      if (!['FAILED', 'SUCCEEDED', 'UNKNOWN'].includes(row.provider_state))
        throw new MoneyInputError('Statement provider state is invalid');
    }
    // The content, not its order: the same rows sent sorted differently are
    // the same statement.
    const canonical = JSON.stringify({
      period: [input.period_start?.toISOString() ?? null, input.period_end?.toISOString() ?? null],
      rows: input.rows
        .map((row) => [
          row.operation_kind,
          row.provider_operation_reference,
          row.provider_state,
          row.amount_minor,
        ])
        .sort((left, right) => (JSON.stringify(left) < JSON.stringify(right) ? -1 : 1)),
    });
    const digest = createHash('sha256').update(canonical).digest('hex');
    type Resolution = {
      readonly kind: StatementKind;
      readonly id: string;
      readonly amount_minor: number;
      readonly provider_state: 'FAILED' | 'SUCCEEDED';
      readonly provider_operation_reference: string;
    };
    const imported = await transaction(this.#pool, async (client) => {
      const replay = await client.query<{
        provider_statement_import_id: string;
        content_digest: string;
      }>(
        `SELECT provider_statement_import_id, content_digest
           FROM marketplace.provider_statement_imports
          WHERE statement_reference=$1 OR content_digest=$2
          ORDER BY (statement_reference=$1) DESC LIMIT 1`,
        [input.statement_reference, digest],
      );
      const prior = replay.rows[0];
      if (prior) {
        if (prior.content_digest !== digest)
          throw new MoneyStateError(
            'A statement with this reference was already imported with different rows',
          );
        return { importId: prior.provider_statement_import_id, resolutions: [] as Resolution[] };
      }
      const importId = createUuidV7();
      await client.query(
        `INSERT INTO marketplace.provider_statement_imports
          (provider_statement_import_id,statement_reference,content_digest,row_count,
           imported_by_user_id,request_id,correlation_id,imported_at,period_start,period_end)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          importId,
          input.statement_reference,
          digest,
          input.rows.length,
          who,
          contextRefs.request,
          contextRefs.correlation,
          now,
          input.period_start ?? null,
          input.period_end ?? null,
        ],
      );
      const resolutions: Resolution[] = [];
      const seen = new Set<string>();
      for (const row of input.rows) {
        const expected = await this.#expectedOperation(
          client,
          row.provider_operation_reference,
          row.operation_kind,
        );
        // What an earlier statement already said about this operation.
        const earlier = await client.query<{ provider_state: string }>(
          `SELECT provider_state FROM marketplace.provider_statement_rows
            WHERE provider_operation_reference=$1 AND provider_state IN ('SUCCEEDED','FAILED')
              AND provider_statement_import_id IS DISTINCT FROM $2
            ORDER BY created_at DESC, statement_row_id DESC LIMIT 1`,
          [row.provider_operation_reference, importId],
        );
        const definitive = row.provider_state !== 'UNKNOWN';
        const said = earlier.rows[0]?.provider_state;
        let classification: string;
        if (seen.has(row.provider_operation_reference)) classification = 'DUPLICATE';
        else if (said && definitive && said === row.provider_state) classification = 'DUPLICATE';
        else if (said && definitive) classification = 'STATUS_MISMATCH';
        else if (!expected) classification = 'UNMATCHED';
        else if (expected.amount_minor !== row.amount_minor) classification = 'AMOUNT_MISMATCH';
        else if (expected.provider_state === row.provider_state) classification = 'MATCHED';
        else if (expected.awaiting && definitive) {
          classification = 'MATCHED';
          resolutions.push({
            kind: row.operation_kind,
            id: expected.id,
            amount_minor: row.amount_minor,
            provider_state: row.provider_state as 'FAILED' | 'SUCCEEDED',
            provider_operation_reference: row.provider_operation_reference,
          });
        } else classification = 'STATUS_MISMATCH';
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
        if (classification === 'MATCHED') {
          // Reported at last: an earlier statement's "missing" is answered.
          await client.query(
            `UPDATE marketplace.finance_exceptions SET exception_state='RESOLVED', updated_at=$2
              WHERE exception_kind='STATEMENT_MISSING' AND operation_reference=$1
                AND exception_state<>'RESOLVED'`,
            [row.provider_operation_reference, now],
          );
          continue;
        }
        const routed = STATEMENT_EXCEPTIONS[classification as keyof typeof STATEMENT_EXCEPTIONS];
        await this.#openFinanceException(client, {
          kind: routed.kind,
          owner: 'FINANCE_RECONCILIATION',
          operation_reference: row.provider_operation_reference,
          amount_at_risk_minor: row.amount_minor,
          next_action_code: routed.next_action_code,
          now,
        });
      }
      if (input.period_start && input.period_end) {
        // What the books say moved inside the period and no statement has
        // reported: the capture, refund or payout posting names the provider
        // operation (10.1), and its amount is the posting's.
        const missing = await client.query<{
          provider_operation_reference: string;
          transaction_kind: 'CAPTURE' | 'PAYOUT' | 'REFUND';
          amount_minor: string;
        }>(
          `SELECT t.provider_operation_reference, t.transaction_kind,
                  sum(e.debit_minor)::text AS amount_minor
             FROM marketplace.ledger_transactions t
             JOIN marketplace.ledger_entries e USING (ledger_transaction_id)
            WHERE t.transaction_kind IN ('CAPTURE','REFUND','PAYOUT')
              AND t.provider_operation_reference IS NOT NULL
              AND t.posted_at >= $1 AND t.posted_at < $2
              AND NOT EXISTS (SELECT 1 FROM marketplace.provider_statement_rows reported
                               WHERE reported.provider_operation_reference = t.provider_operation_reference
                                 AND reported.provider_state IS NOT NULL)
            GROUP BY t.provider_operation_reference, t.transaction_kind
            ORDER BY t.provider_operation_reference`,
          [input.period_start, input.period_end],
        );
        for (const row of missing.rows) {
          const kind: StatementKind =
            row.transaction_kind === 'CAPTURE' ? 'PAYMENT' : row.transaction_kind;
          await client.query(
            `INSERT INTO marketplace.provider_statement_rows
              (statement_row_id,provider_operation_reference,statement_reference,operation_kind,
               amount_minor,provider_state,created_at,provider_statement_import_id,
               reconciliation_class,expected_amount_minor,expected_state)
             VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,'MISSING_EXPECTED',$5,'SUCCEEDED')`,
            [
              createUuidV7(),
              row.provider_operation_reference,
              input.statement_reference,
              kind,
              Number(row.amount_minor),
              now,
              importId,
            ],
          );
          await this.#openFinanceException(client, {
            kind: 'STATEMENT_MISSING',
            owner: 'FINANCE_RECONCILIATION',
            operation_reference: row.provider_operation_reference,
            amount_at_risk_minor: Number(row.amount_minor),
            next_action_code: 'CHASE_PROVIDER_FOR_MISSING_OPERATION',
            now,
          });
        }
      }
      return { importId, resolutions };
    });
    // The answers the import found for operations still waiting on one, each
    // applied through its own reconciliation after the statement is on
    // record. One that cannot be applied is a person's.
    let resolved = 0;
    for (const resolution of imported.resolutions) {
      try {
        if (resolution.kind === 'PAYMENT')
          await this.#money.reconcilePayment({
            context: input.context,
            evidence_reference: input.statement_reference,
            now,
            payment_transaction_id: parseUuidV7(resolution.id),
            provider_state: resolution.provider_state,
          });
        else if (resolution.kind === 'REFUND')
          await this.#money.reconcileRefund({
            context: input.context,
            evidence_reference: input.statement_reference,
            now,
            provider_state: resolution.provider_state,
            refund_id: parseUuidV7(resolution.id),
          });
        else
          await this.#money.reconcilePayout({
            amount_minor: resolution.amount_minor,
            context: input.context,
            now,
            payout_id: parseUuidV7(resolution.id),
            provider_state: resolution.provider_state,
            statement_reference: input.statement_reference,
          });
        resolved += 1;
      } catch {
        await transaction(this.#pool, (client) =>
          this.#openFinanceException(client, {
            kind: 'STATEMENT_CONFLICT',
            owner: 'FINANCE_RECONCILIATION',
            operation_reference: resolution.provider_operation_reference,
            amount_at_risk_minor: resolution.amount_minor,
            next_action_code: 'APPLY_STATEMENT_BY_HAND',
            now,
          }),
        );
      }
    }
    return transaction(this.#pool, async (client) => ({
      ...(await this.#projectImport(client, imported.importId)),
      resolved,
    }));
  }

  /**
   * What a correction would do, before it is proposed (10.6): the original
   * posting, the replacement, and the net change per account and per owner,
   * with whether a second person must approve it. Nothing is written.
   */
  async previewCorrection(input: {
    readonly context: RequestContext;
    readonly entries: readonly CorrectionEntry[];
    readonly original_ledger_transaction_id: UuidV7;
    readonly now?: Date;
  }) {
    admin(input.context);
    return transaction(this.#pool, (client) =>
      this.#correctionPlan(client, {
        entries: input.entries,
        now: input.now ?? new Date(),
        original_ledger_transaction_id: input.original_ledger_transaction_id,
      }),
    );
  }

  /**
   * Proposes a correction (10.6): the original posting is reversed whole and
   * the replacement posted when it is approved. The proposal records its
   * reason, its evidence, its impact and the approval limit in force, and is
   * history from then on. Replayed by its reference.
   */
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
    marked(input.reason_code, /^[A-Z][A-Z0-9_]{2,63}$/, 'Reason code');
    const total = this.#validateEntries(input.entries);
    if (total !== amount(input.amount_minor, 'Correction amount'))
      throw new MoneyInputError('Correction amount must equal proposed entry debits');
    return transaction(this.#pool, async (client) => {
      const replay = await client.query<any>(
        `SELECT * FROM marketplace.financial_corrections WHERE correction_reference=$1`,
        [input.correction_reference],
      );
      if (replay.rows[0]) {
        const prior = replay.rows[0];
        if (
          prior.original_ledger_transaction_id !== input.original_ledger_transaction_id ||
          canonicalJson(prior.proposed_entries) !== canonicalJson(input.entries) ||
          prior.reason_code !== input.reason_code ||
          prior.evidence_reference !== input.evidence_reference
        )
          throw new MoneyStateError('A correction with this reference proposes something else');
        return prior;
      }
      const plan = await this.#correctionPlan(client, {
        entries: input.entries,
        now,
        original_ledger_transaction_id: input.original_ledger_transaction_id,
      });
      const correctionId = createUuidV7();
      const inserted = await client.query(
        `INSERT INTO marketplace.financial_corrections
          (financial_correction_id,correction_reference,original_ledger_transaction_id,
           reason_code,evidence_reference,amount_minor,proposed_entries,proposed_by_user_id,
           approval_expires_at,request_id,correlation_id,created_at,updated_at,
           impact,impact_minor,single_approval_limit_minor,second_approval_required)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14,$15,$16) RETURNING *`,
        [
          correctionId,
          input.correction_reference,
          input.original_ledger_transaction_id,
          input.reason_code,
          input.evidence_reference,
          input.amount_minor,
          JSON.stringify(input.entries),
          who,
          new Date(now.getTime() + CORRECTION_APPROVAL_WINDOW_MS),
          contextRefs.request,
          contextRefs.correlation,
          now,
          JSON.stringify(plan.impact),
          plan.impact_minor,
          plan.single_approval_limit_minor,
          plan.second_approval_required,
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

  /**
   * Approves and posts a correction: the reversal of the original and the
   * replacement, in one transaction with the correction's state. Over the
   * policy's limit the approver must be someone other than the proposer;
   * at or under it the proposer may post their own.
   */
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
        (correction.second_approval_required && correction.proposed_by_user_id === who)
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

  /**
   * Declines a proposal (10.6). Any finance operator may, the proposer
   * included -- withdrawing one's own proposal moves no money -- and the
   * reason is recorded on the correction and its history.
   */
  async rejectCorrection(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly financial_correction_id: UuidV7;
    readonly reason_code: string;
    readonly now?: Date;
  }) {
    const who = admin(input.context);
    const now = input.now ?? new Date();
    const reason = marked(input.reason_code, /^[A-Z][A-Z0-9_]{2,63}$/, 'Reason code');
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
        correction.version !== input.expected_version
      )
        throw new MoneyStateError('Only a current proposal can be rejected');
      const updated = await client.query(
        `UPDATE marketplace.financial_corrections
            SET lifecycle_state='REJECTED', closed_by_user_id=$2, closing_reason_code=$3,
                version=2, updated_at=$4
          WHERE financial_correction_id=$1 RETURNING *`,
        [input.financial_correction_id, who, reason, now],
      );
      await this.#correctionEvent(client, {
        actor_id: who,
        context: input.context,
        correction_id: input.financial_correction_id,
        event_type: 'CORRECTION_REJECTED',
        now,
        previous_state: 'PROPOSED',
        reason_code: reason,
        resulting_state: 'REJECTED',
        version: 2,
      });
      return updated.rows[0];
    });
  }

  /**
   * The worker's pass: a proposal nobody approved within its window expires
   * (10.6), so it stops holding its original against another correction.
   */
  async expireCorrections(input: { readonly context: RequestContext; readonly now?: Date }) {
    const who = financeAutomation(input.context);
    const now = input.now ?? new Date();
    const due = await this.#pool.query<{ financial_correction_id: string }>(
      `SELECT financial_correction_id FROM marketplace.financial_corrections
        WHERE lifecycle_state='PROPOSED' AND approval_expires_at<=$1
        ORDER BY approval_expires_at LIMIT 100`,
      [now],
    );
    let expired = 0;
    for (const row of due.rows)
      await transaction(this.#pool, async (client) => {
        const moved = await client.query(
          `UPDATE marketplace.financial_corrections
              SET lifecycle_state='EXPIRED', closing_reason_code='APPROVAL_WINDOW_ELAPSED',
                  version=2, updated_at=$2
            WHERE financial_correction_id=$1 AND lifecycle_state='PROPOSED'
              AND approval_expires_at<=$2`,
          [row.financial_correction_id, now],
        );
        if (!moved.rowCount) return;
        await this.#correctionEvent(client, {
          actor_id: who,
          context: input.context,
          correction_id: parseUuidV7(row.financial_correction_id),
          event_type: 'CORRECTION_EXPIRED',
          now,
          previous_state: 'PROPOSED',
          reason_code: 'APPROVAL_WINDOW_ELAPSED',
          resulting_state: 'EXPIRED',
          version: 2,
        });
        expired += 1;
      });
    return expired;
  }

  /** Corrections with their history, newest first, for the finance console. */
  async listCorrections(input: { readonly context: RequestContext; readonly limit?: number }) {
    admin(input.context);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const corrections = await this.#pool.query<any>(
      `SELECT financial_correction_id, correction_reference, original_ledger_transaction_id,
              lifecycle_state, reason_code, evidence_reference, amount_minor::text,
              proposed_entries, impact, impact_minor::text, single_approval_limit_minor::text,
              second_approval_required, proposed_by_user_id, approved_by_user_id,
              closed_by_user_id, closing_reason_code, reversal_ledger_transaction_id,
              adjustment_ledger_transaction_id, approval_expires_at, version, created_at, updated_at
         FROM marketplace.financial_corrections
        ORDER BY created_at DESC, financial_correction_id DESC LIMIT $1`,
      [limit],
    );
    const ids = corrections.rows.map((row: any) => row.financial_correction_id);
    const events = ids.length
      ? await this.#pool.query<any>(
          `SELECT financial_correction_id, correction_version, event_type, previous_state,
                  resulting_state, actor_id, reason_code, occurred_at
             FROM marketplace.financial_correction_events
            WHERE financial_correction_id = ANY($1::uuid[])
            ORDER BY correction_version`,
          [ids],
        )
      : { rows: [] };
    return {
      corrections: corrections.rows.map((row: any) => ({
        ...row,
        events: events.rows.filter(
          (event: any) => event.financial_correction_id === row.financial_correction_id,
        ),
      })),
    };
  }

  /**
   * The plan a proposal is made from: the original, whether it may be
   * corrected, the replacement checked against the account catalogue, the
   * impact, and the approval limit in force.
   */
  async #correctionPlan(
    client: PoolClient,
    input: {
      readonly entries: readonly CorrectionEntry[];
      readonly now: Date;
      readonly original_ledger_transaction_id: UuidV7;
    },
  ) {
    this.#validateEntries(input.entries);
    const original = await client.query<{ transaction_kind: string }>(
      `SELECT transaction_kind FROM marketplace.ledger_transactions WHERE ledger_transaction_id=$1`,
      [input.original_ledger_transaction_id],
    );
    const header = original.rows[0];
    if (!header) throw new MoneyNotFoundError('Original ledger transaction not found');
    // A reversal is half of a correction already posted; the fact is corrected
    // by correcting that correction's adjustment.
    if (header.transaction_kind === 'REVERSAL')
      throw new MoneyStateError('A reversal is corrected through the adjustment it accompanies');
    const live = await client.query(
      `SELECT 1 FROM marketplace.financial_corrections
        WHERE original_ledger_transaction_id=$1
          AND lifecycle_state IN ('PROPOSED','APPROVED','POSTED')`,
      [input.original_ledger_transaction_id],
    );
    if (live.rows[0])
      throw new MoneyStateError('This posting already has a correction; correct that instead');
    // Every account named must be postable, and one with an owner must name
    // it: refused here rather than at approval, after a second person looked.
    const accounts = await client.query<{
      account_reference: string;
      lifecycle_state: string;
      owner_dimension: string;
    }>(
      `SELECT account_reference, lifecycle_state, owner_dimension
         FROM marketplace.ledger_accounts WHERE account_reference = ANY($1::text[])`,
      [[...new Set(input.entries.map((entry) => entry.account_reference))]],
    );
    const catalogue = new Map(accounts.rows.map((row) => [row.account_reference, row]));
    for (const entry of input.entries) {
      const account = catalogue.get(entry.account_reference);
      if (!account || account.lifecycle_state !== 'ACTIVE')
        throw new MoneyInputError(`${entry.account_reference} is not an open account`);
      if (account.owner_dimension === 'VENDOR_LOCATION' && !entry.vendor_location_id)
        throw new MoneyInputError(`An entry on ${entry.account_reference} must name its vendor`);
      if (account.owner_dimension === 'PARTNER_USER' && !entry.partner_user_id)
        throw new MoneyInputError(`An entry on ${entry.account_reference} must name its partner`);
    }
    const originalEntries = await client.query<{
      account_reference: string;
      component: string;
      debit_minor: string;
      credit_minor: string;
      vendor_location_id: string | null;
      partner_user_id: string | null;
      source_order_reference: string | null;
    }>(
      `SELECT account_reference, component, debit_minor::text, credit_minor::text,
              vendor_location_id, partner_user_id, source_order_reference
         FROM marketplace.ledger_entries WHERE ledger_transaction_id=$1 ORDER BY ledger_entry_id`,
      [input.original_ledger_transaction_id],
    );
    const before = originalEntries.rows.map((entry) => ({
      ...entry,
      debit_minor: Number(entry.debit_minor),
      credit_minor: Number(entry.credit_minor),
    }));
    let impact;
    try {
      impact = correctionImpact(before, input.entries);
    } catch (error) {
      if (error instanceof CorrectionImpactError) throw new MoneyInputError(error.message);
      throw error;
    }
    const limit = await this.#singleApprovalLimit(client, input.now);
    return {
      original_ledger_transaction_id: input.original_ledger_transaction_id,
      original_transaction_kind: header.transaction_kind,
      original_entries: before,
      entries: input.entries,
      impact: impact.rows,
      impact_minor: impact.impact_minor,
      single_approval_limit_minor: limit,
      second_approval_required: impact.impact_minor > limit,
    };
  }

  /**
   * The most a correction may move and be posted by its proposer alone, from
   * the versioned `finance.correction_approval` setting. With no setting, or
   * one that does not say, every correction needs a second person.
   */
  async #singleApprovalLimit(client: PoolClient, at: Date): Promise<number> {
    const resolved = await resolveConfiguration(client, {
      at,
      configuration_key: CORRECTION_APPROVAL_KEY,
      configuration_kind: 'SETTING',
    });
    const value = resolved?.configuration_value as Record<string, unknown> | undefined;
    const limit = value?.['single_approval_limit_minor'];
    return typeof limit === 'number' && Number.isSafeInteger(limit) && limit >= 0 ? limit : 0;
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
        `SELECT earning.*, assignment.source_order_reference
           FROM marketplace.partner_earnings_records earning
           JOIN marketplace.delivery_assignments assignment USING (delivery_assignment_id)
          WHERE earning.partner_earnings_record_id=$1 FOR UPDATE OF earning`,
        [input.partner_earnings_record_id],
      );
      const earning = found.rows[0];
      if (!earning) throw new MoneyNotFoundError('Partner earning not found');
      if (earning.ledger_transaction_id) {
        // The earning as the table holds it, without the joined order.
        const record = { ...earning };
        delete record.source_order_reference;
        return record;
      }
      // A delivered order's settlement already owes the partner this money,
      // so the posting only names what it is made of. Nothing else divides
      // an order that came back or was called off after pickup: the trip the
      // partner made is the platform's cost, taken from its subsidy (10.4).
      const funded = earning.outcome !== 'DELIVERED';
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
          funded
            ? {
                account_reference: 'SYNTH-ACCOUNT-PLATFORM-SUBSIDY',
                component: 'ADJUSTMENT',
                debit_minor: Number(earning.net_minor),
                credit_minor: 0,
                source_order_reference: earning.source_order_reference,
              }
            : {
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

  /**
   * Posts a dispute's outcome to the ledger (9.10): the delta an operator
   * decided moves between the platform's clearing account and the partner's
   * payable, once, and the adjustment row is stamped with the transaction.
   */
  async postEarningAdjustment(input: {
    readonly context: RequestContext;
    readonly partner_earning_adjustment_id: UuidV7;
    readonly now?: Date;
  }) {
    financeAutomation(input.context);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const found = await client.query<{
        partner_earning_adjustment_id: string;
        partner_user_id: string;
        delta_minor: string;
        ledger_transaction_id: string | null;
      }>(
        `SELECT partner_earning_adjustment_id, partner_user_id, delta_minor::text, ledger_transaction_id
           FROM marketplace.partner_earning_adjustments
          WHERE partner_earning_adjustment_id=$1 FOR UPDATE`,
        [input.partner_earning_adjustment_id],
      );
      const adjustment = found.rows[0];
      if (!adjustment) throw new MoneyNotFoundError('Partner earning adjustment not found');
      if (adjustment.ledger_transaction_id) return { posted: false as const, replayed: true };
      const delta = Number(adjustment.delta_minor);
      const magnitude = Math.abs(delta);
      const partner = { partner_user_id: parseUuidV7(adjustment.partner_user_id) };
      const ledgerId = await this.#postEntries(client, {
        context: input.context,
        entries:
          delta > 0
            ? [
                {
                  account_reference: 'SYNTH-ACCOUNT-PLATFORM-CLEARING',
                  component: 'ADJUSTMENT',
                  debit_minor: magnitude,
                  credit_minor: 0,
                },
                {
                  account_reference: 'SYNTH-ACCOUNT-PARTNER-PAYABLE',
                  component: 'ADJUSTMENT',
                  debit_minor: 0,
                  credit_minor: magnitude,
                  ...partner,
                },
              ]
            : [
                {
                  account_reference: 'SYNTH-ACCOUNT-PARTNER-PAYABLE',
                  component: 'ADJUSTMENT',
                  debit_minor: magnitude,
                  credit_minor: 0,
                  ...partner,
                },
                {
                  account_reference: 'SYNTH-ACCOUNT-PLATFORM-CLEARING',
                  component: 'ADJUSTMENT',
                  debit_minor: 0,
                  credit_minor: magnitude,
                },
              ],
        kind: 'ADJUSTMENT',
        now,
        source_reference: `SYNTH-ADJUSTMENT-DISPUTE-${String(input.partner_earning_adjustment_id).replaceAll('-', '').toUpperCase()}`,
      });
      await client.query(
        `UPDATE marketplace.partner_earning_adjustments
            SET ledger_transaction_id=$2, posted_at=$3
          WHERE partner_earning_adjustment_id=$1`,
        [input.partner_earning_adjustment_id, ledgerId, now],
      );
      return { posted: true as const, replayed: false, ledger_transaction_id: ledgerId };
    });
  }

  /**
   * Posts a reassignment's compensation (9.3, 10.4): the amount an operator
   * decided for the partner who was displaced is owed to them, taken from the
   * platform's subsidy, once. Until audit run 69 the decision was recorded
   * and reached neither the books nor a payout.
   */
  async postAttemptCompensation(input: {
    readonly context: RequestContext;
    readonly partner_attempt_compensation_id: UuidV7;
    readonly now?: Date;
  }) {
    financeAutomation(input.context);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const found = await client.query<{
        partner_user_id: string;
        amount_minor: string;
        ledger_transaction_id: string | null;
        source_order_reference: string;
      }>(
        `SELECT compensation.partner_user_id, compensation.amount_minor::text,
                compensation.ledger_transaction_id, assignment.source_order_reference
           FROM marketplace.partner_attempt_compensations compensation
           JOIN marketplace.delivery_assignments assignment USING (delivery_assignment_id)
          WHERE compensation.partner_attempt_compensation_id=$1
            FOR UPDATE OF compensation`,
        [input.partner_attempt_compensation_id],
      );
      const compensation = found.rows[0];
      if (!compensation) throw new MoneyNotFoundError('Partner compensation not found');
      const amountMinor = Number(compensation.amount_minor);
      if (compensation.ledger_transaction_id || amountMinor === 0)
        return { posted: false as const, replayed: compensation.ledger_transaction_id !== null };
      const ledgerId = await this.#postEntries(client, {
        context: input.context,
        entries: [
          {
            account_reference: 'SYNTH-ACCOUNT-PLATFORM-SUBSIDY',
            component: 'ADJUSTMENT',
            debit_minor: amountMinor,
            credit_minor: 0,
            source_order_reference: compensation.source_order_reference,
          },
          {
            account_reference: 'SYNTH-ACCOUNT-PARTNER-PAYABLE',
            component: 'ADJUSTMENT',
            debit_minor: 0,
            credit_minor: amountMinor,
            partner_user_id: parseUuidV7(compensation.partner_user_id),
            source_order_reference: compensation.source_order_reference,
          },
        ],
        kind: 'ADJUSTMENT',
        now,
        source_reference: `SYNTH-ADJUSTMENT-COMPENSATION-${String(input.partner_attempt_compensation_id).replaceAll('-', '').toUpperCase()}`,
      });
      await client.query(
        `UPDATE marketplace.partner_attempt_compensations
            SET ledger_transaction_id=$2, posted_at=$3
          WHERE partner_attempt_compensation_id=$1`,
        [input.partner_attempt_compensation_id, ledgerId, now],
      );
      return { posted: true as const, replayed: false, ledger_transaction_id: ledgerId };
    });
  }

  /** The worker's pass over compensations not yet in the books. */
  async postPendingAttemptCompensations(input: {
    readonly context: RequestContext;
    readonly now?: Date;
    readonly limit?: number;
  }) {
    financeAutomation(input.context);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const pending = await this.#pool.query<{ partner_attempt_compensation_id: string }>(
      `SELECT compensation.partner_attempt_compensation_id
         FROM marketplace.partner_attempt_compensations compensation
        WHERE compensation.ledger_transaction_id IS NULL AND compensation.amount_minor > 0
          AND NOT EXISTS (
            SELECT 1 FROM marketplace.finance_exceptions exception
             WHERE exception.exception_kind='POSTING_FAILED'
               AND exception.operation_reference=compensation.partner_attempt_compensation_id::text
               AND exception.exception_state IN ('OPEN','ASSIGNED'))
        ORDER BY compensation.created_at LIMIT $1`,
      [limit],
    );
    let posted = 0;
    for (const row of pending.rows) {
      try {
        const outcome = await this.postAttemptCompensation({
          context: input.context,
          partner_attempt_compensation_id: parseUuidV7(row.partner_attempt_compensation_id),
          ...(input.now ? { now: input.now } : {}),
        });
        if (outcome.posted) posted += 1;
      } catch {
        await this.#recordPostingFailure(row.partner_attempt_compensation_id, input.now);
      }
    }
    return posted;
  }

  /**
   * Re-divides an order's money after a refund succeeded (10.3).
   *
   * The commission was charged once, at settlement, on what the bags held
   * then; a refund after that took money back from the customer and left the
   * vendor's proceeds and the platform's fee standing on goods that had been
   * returned. The settlement now keeps what it was divided from (0111), so a
   * later refund asks `divideOrder` for the division that should stand — the
   * goods refunded off the shop, the fee on what remains at the rate the order
   * was quoted under, no fee where none applied — and posts only the
   * difference. What the refund took that was not goods (delivery, tip) the
   * platform absorbs: clawing it back from a partner already paid is a
   * dispute, not an arithmetic.
   *
   * The first version recomputed the rate from the policy in force when the
   * settlement was written, charged commission on orders settled without it,
   * and counted a refund taken before the settlement a second time; all three
   * came from carrying a second copy of the arithmetic.
   *
   * Only a settlement whose payout is not yet fixed moves. One already
   * scheduled, submitted or paid is a vendor settlement mismatch for a person
   * (a correction, 10.6), as is one written before the snapshot existed that
   * cannot be divided without guessing.
   */
  async redivideSettlementForRefunds(input: {
    readonly context: RequestContext;
    readonly settlement_id: UuidV7;
    readonly now?: Date;
  }): Promise<
    | { readonly redivided: false; readonly unaccounted: number; readonly reason?: string }
    | {
        readonly redivided: true;
        readonly unaccounted: number;
        readonly settlement: Record<string, unknown>;
        readonly vendor_delta_minor: number;
        readonly platform_delta_minor: number;
      }
  > {
    financeAutomation(input.context);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const found = await client.query<{
        settlement_id: string;
        source_order_reference: string;
        vendor_location_id: string;
        settlement_state: string;
        captured: string;
        accounted: string;
        partner_payable: string;
        vendor_payable: string;
        goods: string | null;
        goods_refunds_at_creation: string | null;
        commission_basis_points: number | null;
        fee_applies: boolean | null;
      }>(
        `SELECT settlement_id, source_order_reference, vendor_location_id, settlement_state,
                customer_captured_minor::text AS captured,
                successful_refunds_minor::text AS accounted,
                partner_payable_minor::text AS partner_payable,
                vendor_payable_minor::text AS vendor_payable,
                goods_minor::text AS goods,
                goods_refunds_at_creation_minor::text AS goods_refunds_at_creation,
                commission_basis_points, fee_applies
           FROM marketplace.settlements
          WHERE settlement_id=$1 FOR UPDATE`,
        [input.settlement_id],
      );
      const settlement = found.rows[0];
      if (!settlement) throw new MoneyNotFoundError('Settlement not found');
      // Everything below is read under the settlement's lock, so a refund or
      // a payout batch cannot slip between the figures and the division.
      const refunds = await client.query<{ refunded: string; goods_refunded: string }>(
        `SELECT COALESCE(sum(refund_total_minor),0)::text AS refunded,
                COALESCE(sum(item_minor),0)::text AS goods_refunded
           FROM marketplace.refunds
          WHERE source_order_reference=$1 AND refund_state='SUCCEEDED'`,
        [settlement.source_order_reference],
      );
      const refunded = Number(refunds.rows[0]?.refunded ?? 0);
      const goodsRefunded = Number(refunds.rows[0]?.goods_refunded ?? 0);
      const unaccounted = refunded - Number(settlement.accounted);
      if (unaccounted <= 0) return { redivided: false as const, unaccounted: 0 };

      if (!REDIVIDABLE_SETTLEMENT_STATES.has(settlement.settlement_state)) {
        await this.#openFinanceException(client, {
          kind: 'SETTLEMENT_MISMATCH',
          operation_reference: settlement.settlement_id,
          amount_at_risk_minor: unaccounted,
          next_action_code: 'CORRECT_REFUND_AFTER_PAYOUT',
          now,
        });
        return { redivided: false as const, unaccounted, reason: 'PAYOUT_FIXED' };
      }
      if (
        settlement.goods === null ||
        settlement.commission_basis_points === null ||
        settlement.fee_applies === null
      ) {
        await this.#openFinanceException(client, {
          kind: 'SETTLEMENT_MISMATCH',
          operation_reference: settlement.settlement_id,
          amount_at_risk_minor: unaccounted,
          next_action_code: 'DIVIDE_SETTLEMENT_BY_HAND',
          now,
        });
        return { redivided: false as const, unaccounted, reason: 'NO_DIVISION_SNAPSHOT' };
      }

      const figures = await client.query<{
        proceeds: string;
        fee: string;
        adjusted: string;
        policy_reference: string | null;
      }>(
        `SELECT COALESCE(sum(amount_minor) FILTER (WHERE component='ITEM_PROCEEDS'),0)::text AS proceeds,
                COALESCE(sum(amount_minor) FILTER (WHERE component='PLATFORM_FEE'),0)::text AS fee,
                (SELECT COALESCE(sum(delta_minor),0)::text
                   FROM marketplace.vendor_settlement_adjustments
                  WHERE settlement_id=$1) AS adjusted,
                (SELECT policy_version_reference FROM marketplace.settlement_lines
                  WHERE settlement_id=$1 ORDER BY created_at, settlement_line_id LIMIT 1)
                  AS policy_reference
           FROM marketplace.settlement_lines WHERE settlement_id=$1`,
        [settlement.settlement_id],
      );
      const current = figures.rows[0];
      const goods = Number(settlement.goods);
      let target: OrderDivision;
      try {
        target = divideOrder({
          captured_minor: Number(settlement.captured),
          refunds_minor: refunded,
          goods_minor: goods,
          goods_refunds_minor: Math.min(goodsRefunded, goods, refunded),
          partner_payable_minor: Number(settlement.partner_payable),
          commission_basis_points: settlement.commission_basis_points,
          fee_applies: settlement.fee_applies,
        });
      } catch (error) {
        if (!(error instanceof OrderDivisionError)) throw error;
        await this.#openFinanceException(client, {
          kind: 'SETTLEMENT_MISMATCH',
          operation_reference: settlement.settlement_id,
          amount_at_risk_minor: unaccounted,
          next_action_code: 'DIVIDE_SETTLEMENT_BY_HAND',
          now,
        });
        return { redivided: false as const, unaccounted, reason: 'INDIVISIBLE' };
      }
      // A resolved dispute moved the payable without a line (VEN-50); the
      // division is compared with the payable as divided, and the dispute's
      // effect stays on top of it.
      const vendorPayable = Number(settlement.vendor_payable);
      const dividedPayable = vendorPayable - Number(current?.adjusted ?? 0);
      const vendorDelta = target.vendor_payable_minor - dividedPayable;
      const feeDelta = target.vendor_fee_minor - Number(current?.fee ?? 0);
      const proceedsDelta = target.remaining_goods_minor - Number(current?.proceeds ?? 0);
      const platformDelta = -(unaccounted + vendorDelta);
      if (vendorPayable + vendorDelta < 0) {
        // A dispute already took more off the shop than the division leaves
        // it: a person decides what the shop owes back.
        await this.#openFinanceException(client, {
          kind: 'SETTLEMENT_MISMATCH',
          operation_reference: settlement.settlement_id,
          amount_at_risk_minor: -(vendorPayable + vendorDelta),
          next_action_code: 'RECOVER_VENDOR_OVERPAYMENT',
          now,
        });
        return { redivided: false as const, unaccounted, reason: 'NEGATIVE_PAYABLE' };
      }

      // Signed credits that sum to zero: the refund debited platform clearing,
      // so the division credits it back and moves the difference between the
      // shop's payable and the platform's revenue.
      const entries = [
        signedEntry('SYNTH-ACCOUNT-VENDOR-PAYABLE', vendorDelta, {
          source_order_reference: settlement.source_order_reference,
          vendor_location_id: parseUuidV7(settlement.vendor_location_id),
        }),
        signedEntry('SYNTH-ACCOUNT-PLATFORM-REVENUE', platformDelta, {
          source_order_reference: settlement.source_order_reference,
        }),
        signedEntry('SYNTH-ACCOUNT-PLATFORM-CLEARING', unaccounted, {
          source_order_reference: settlement.source_order_reference,
        }),
      ].filter((entry): entry is CorrectionEntry => entry !== null);
      const policyReference = current?.policy_reference ?? null;
      await this.#postEntries(client, {
        context: input.context,
        entries,
        kind: 'ADJUSTMENT',
        now,
        ...(policyReference ? { policy_version_reference: policyReference } : {}),
        source_reference: `SYNTH-ADJUSTMENT-REDIVIDE-${settlement.settlement_id.replaceAll('-', '').toUpperCase()}-${refunded}`,
      });

      // The lines say what happened, in the components the statement reads.
      for (const [participant, component, amount] of [
        ['CUSTOMER', 'REFUND', -unaccounted],
        ['VENDOR', 'ITEM_PROCEEDS', proceedsDelta],
        ['PLATFORM', 'PLATFORM_FEE', feeDelta],
        ['PLATFORM', 'ADJUSTMENT', platformDelta],
      ] as const) {
        if (amount === 0) continue;
        await client.query(
          `INSERT INTO marketplace.settlement_lines
            (settlement_line_id,settlement_id,participant_kind,component,amount_minor,
             policy_version_reference,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            createUuidV7(),
            settlement.settlement_id,
            participant,
            component,
            amount,
            policyReference ?? 'SYNTH-POLICY-REDIVISION-UNKNOWN',
            now,
          ],
        );
      }
      const updated = await client.query<Record<string, unknown>>(
        `UPDATE marketplace.settlements
            SET vendor_payable_minor=vendor_payable_minor+$2,
                platform_remainder_minor=platform_remainder_minor+$3,
                customer_net_minor=customer_net_minor-$4,
                successful_refunds_minor=successful_refunds_minor+$4,
                redivided_refunds_minor=redivided_refunds_minor+$4,
                redivided_item_refunds_minor=$6,
                version=version+1, updated_at=$5
          WHERE settlement_id=$1 RETURNING *`,
        [
          settlement.settlement_id,
          vendorDelta,
          platformDelta,
          unaccounted,
          now,
          Math.max(
            0,
            Math.min(goodsRefunded, goods) - Number(settlement.goods_refunds_at_creation ?? 0),
          ),
        ],
      );
      return {
        redivided: true as const,
        unaccounted,
        settlement: updated.rows[0] ?? {},
        vendor_delta_minor: vendorDelta,
        platform_delta_minor: platformDelta,
      };
    });
  }

  /**
   * The worker's pass: every settlement a refund has outrun (10.3).
   *
   * Driven from the refunds, which are few, rather than a correlated scan of
   * every settlement on every tick. Each settlement is its own attempt: one
   * that throws opens a vendor settlement mismatch and is left out of later
   * passes while that is open, where it used to stop every settlement behind
   * it for good, because it sorted first and was never updated.
   */
  async redivideRefundedSettlements(input: {
    readonly context: RequestContext;
    readonly limit?: number;
    readonly now?: Date;
  }) {
    financeAutomation(input.context);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const pending = await this.#pool.query<{ settlement_id: string }>(
      `SELECT settlement.settlement_id
         FROM (SELECT source_order_reference, sum(refund_total_minor) AS refunded
                 FROM marketplace.refunds
                WHERE refund_state='SUCCEEDED'
                GROUP BY source_order_reference) refunds
         JOIN marketplace.settlements settlement USING (source_order_reference)
        WHERE refunds.refunded > settlement.successful_refunds_minor
          AND NOT EXISTS (
            SELECT 1 FROM marketplace.finance_exceptions exception
             WHERE exception.exception_kind='SETTLEMENT_MISMATCH'
               AND exception.operation_reference=settlement.settlement_id::text
               AND exception.exception_state IN ('OPEN','ASSIGNED'))
        ORDER BY settlement.updated_at, settlement.settlement_id LIMIT $1`,
      [limit],
    );
    let redivided = 0;
    for (const row of pending.rows) {
      try {
        const outcome = await this.redivideSettlementForRefunds({
          context: input.context,
          settlement_id: parseUuidV7(row.settlement_id),
          ...(input.now ? { now: input.now } : {}),
        });
        if (outcome.redivided) redivided += 1;
      } catch {
        await transaction(this.#pool, (client) =>
          this.#openFinanceException(client, {
            kind: 'SETTLEMENT_MISMATCH',
            operation_reference: row.settlement_id,
            amount_at_risk_minor: 0,
            next_action_code: 'INVESTIGATE_REDIVISION_FAILURE',
            now: input.now ?? new Date(),
          }),
        );
      }
    }
    return redivided;
  }

  /**
   * The worker's pass: every adjustment not yet in the ledger. A row that
   * cannot post opens a posting failure and is skipped while it is open,
   * instead of blocking every adjustment created after it.
   */
  async postPendingEarningAdjustments(input: {
    readonly context: RequestContext;
    readonly now?: Date;
    readonly limit?: number;
  }) {
    financeAutomation(input.context);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const pending = await this.#pool.query<{ partner_earning_adjustment_id: string }>(
      `SELECT adjustment.partner_earning_adjustment_id
         FROM marketplace.partner_earning_adjustments adjustment
        WHERE adjustment.ledger_transaction_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM marketplace.finance_exceptions exception
             WHERE exception.exception_kind='POSTING_FAILED'
               AND exception.operation_reference=adjustment.partner_earning_adjustment_id::text
               AND exception.exception_state IN ('OPEN','ASSIGNED'))
        ORDER BY adjustment.created_at LIMIT $1`,
      [limit],
    );
    let posted = 0;
    for (const row of pending.rows) {
      try {
        const outcome = await this.postEarningAdjustment({
          context: input.context,
          partner_earning_adjustment_id: parseUuidV7(row.partner_earning_adjustment_id),
          ...(input.now ? { now: input.now } : {}),
        });
        if (outcome.posted) posted += 1;
      } catch {
        await this.#recordPostingFailure(row.partner_earning_adjustment_id, input.now);
      }
    }
    return posted;
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
    // Each order shows what it sold for, what came back, the platform's fee,
    // what was refunded and adjusted, and where the payout stands (VEN-48).
    // The components are the settlement's own policy-versioned lines and the
    // snapshot it was divided from (10.3), read the same way the shop's
    // challenge reads them. The "sale" used to be what the lines still paid —
    // already net of returns — shown beside the refund, so a return read as
    // taken off twice, and the refund shown was the customer's whole refund,
    // delivery and tip included, which the shop never bore.
    const settlements = await this.#pool.query<{
      adjustment_minor: string;
      adjustment_outstanding_minor: string;
      customer_refund: string;
      eligible_at: Date;
      goods: string | null;
      paid_at: Date | null;
      payment_fee: string;
      payout_state: string | null;
      platform_fee: string;
      proceeds: string;
      settlement_id: string;
      settlement_state: string;
      source_order_reference: string;
      tax: string;
      vendor_payable_minor: string;
    }>(
      `SELECT settlement.settlement_id, settlement.source_order_reference,
              settlement.settlement_state, settlement.eligible_at,
              settlement.vendor_payable_minor::text,
              settlement.goods_minor::text AS goods,
              COALESCE(line.proceeds,0)::text AS proceeds,
              COALESCE(line.platform_fee,0)::text AS platform_fee,
              COALESCE(line.payment_fee,0)::text AS payment_fee,
              COALESCE(line.tax,0)::text AS tax,
              COALESCE(-line.refund,0)::text AS customer_refund,
              COALESCE(adjustment.total,0)::text AS adjustment_minor,
              COALESCE(adjustment.outstanding,0)::text AS adjustment_outstanding_minor,
              payout.payout_state, payout.paid_at
         FROM marketplace.settlements settlement
         LEFT JOIN LATERAL (${SETTLEMENT_LINE_TOTALS}) line ON TRUE
         LEFT JOIN LATERAL (
           SELECT sum(delta_minor) AS total,
                  sum(delta_minor) FILTER (WHERE NOT applied_to_settlement) AS outstanding
             FROM marketplace.vendor_settlement_adjustments
            WHERE settlement_id=settlement.settlement_id
         ) adjustment ON TRUE
         LEFT JOIN LATERAL (
           SELECT payout_state, paid_at FROM marketplace.payouts
            WHERE settlement_id=settlement.settlement_id AND beneficiary_kind='VENDOR'
            ORDER BY created_at DESC LIMIT 1
         ) payout ON TRUE
        WHERE settlement.vendor_location_id=$1
        ORDER BY settlement.created_at DESC`,
      [input.vendor_location_id],
    );
    const entries = settlements.rows.map((row) => {
      const figures = settlementFigures(row);
      return Object.freeze({
        settlement_id: row.settlement_id,
        reference: row.source_order_reference,
        eligible_at: row.eligible_at.toISOString(),
        lifecycle_state: row.settlement_state,
        gross_minor: figures.sale_minor,
        goods_returned_minor: figures.goods_returned_minor,
        platform_fee_minor: figures.platform_fee_minor,
        payment_fee_minor: figures.payment_fee_minor,
        tax_minor: figures.tax_minor,
        refund_minor: figures.customer_refund_minor,
        adjustment_minor: Number(row.adjustment_minor),
        adjustment_outstanding_minor: Number(row.adjustment_outstanding_minor),
        net_minor: Number(row.vendor_payable_minor),
        payout_state: row.payout_state ?? null,
        paid_at: row.paid_at ? row.paid_at.toISOString() : null,
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
      outcome: string;
      base_minor: string;
      distance_minor: string;
      time_minor: string;
      wait_minor: string;
      return_minor: string;
      incentive_minor: string;
      tip_minor: string;
      adjustment_minor: string;
      net_minor: string;
      created_at: Date;
      day: string;
      week: string;
      payout_state: string | null;
      paid_at: Date | null;
    }>(
      // The partner's day and week are Asia/Kolkata's (9.2), so a trip at
      // 23:30 IST rolls into that day, not UTC's next one.
      `SELECT e.partner_earnings_record_id, a.source_order_reference, e.outcome,
              e.base_minor::text, e.distance_minor::text, e.time_minor::text, e.wait_minor::text,
              e.return_minor::text, e.incentive_minor::text, e.tip_minor::text,
              e.adjustment_minor::text, e.net_minor::text,
              e.created_at,
              to_char(e.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
              to_char(date_trunc('week', e.created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS week,
              payout.payout_state, payout.paid_at
         FROM marketplace.partner_earnings_records e
         JOIN marketplace.delivery_assignments a USING (delivery_assignment_id)
         LEFT JOIN marketplace.settlements s
           ON s.source_order_reference = a.source_order_reference
         -- The payout that carries the earning (10.4), or, for an earning paid
         -- before 0112, the per-order payout of its settlement. An item
         -- released from a refused payout carries nothing: the line is earned
         -- again until the next payout takes it.
         LEFT JOIN LATERAL (
           SELECT paying.payout_state, paying.paid_at FROM (
             SELECT p.payout_state, p.paid_at, p.created_at
               FROM marketplace.partner_payout_items item
               JOIN marketplace.payouts p ON p.payout_id = item.payout_id
              WHERE item.partner_earnings_record_id = e.partner_earnings_record_id
                AND item.lifecycle_state <> 'RELEASED'
             UNION ALL
             SELECT p.payout_state, p.paid_at, p.created_at FROM marketplace.payouts p
              WHERE p.settlement_id = s.settlement_id AND p.beneficiary_kind = 'PARTNER'
           ) paying ORDER BY paying.created_at DESC LIMIT 1
         ) payout ON true
        WHERE e.partner_user_id=$1
        ORDER BY e.created_at DESC`,
      [partnerId],
    );
    const earnings = result.rows.map((row) =>
      Object.freeze({
        partner_earnings_record_id: row.partner_earnings_record_id,
        reference: row.source_order_reference,
        outcome: row.outcome,
        // What has happened to the money, in the payout's own words; before a
        // payout exists the amount is earned and nothing more.
        lifecycle_state: row.payout_state ?? 'EARNED',
        paid_at: row.paid_at?.toISOString() ?? null,
        // Every component the line is made of (9.10, DLP-49).
        base_minor: Number(row.base_minor),
        distance_minor: Number(row.distance_minor),
        time_minor: Number(row.time_minor),
        wait_minor: Number(row.wait_minor),
        return_minor: Number(row.return_minor),
        incentive_minor: Number(row.incentive_minor),
        tip_minor: Number(row.tip_minor),
        adjustment_minor: Number(row.adjustment_minor),
        total_minor: Number(row.net_minor),
        posted_at: row.created_at.toISOString(),
        day: row.day,
        week: row.week,
      }),
    );
    const total = earnings.reduce((sum, entry) => sum + entry.total_minor, 0);
    const paid = earnings
      .filter((entry) => entry.lifecycle_state === 'PAID')
      .reduce((sum, entry) => sum + entry.total_minor, 0);
    // Rollups by the partner's day and week (DLP-50): the trips and the money
    // that reconcile to the lines above.
    const rollup = (key: 'day' | 'week') => {
      const buckets = new Map<string, { trips: number; net_minor: number; paid_minor: number }>();
      for (const entry of earnings) {
        const bucket = buckets.get(entry[key]) ?? { trips: 0, net_minor: 0, paid_minor: 0 };
        bucket.trips += 1;
        bucket.net_minor += entry.total_minor;
        if (entry.lifecycle_state === 'PAID') bucket.paid_minor += entry.total_minor;
        buckets.set(entry[key], bucket);
      }
      return Object.freeze(
        [...buckets.entries()]
          .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
          .map(([period, bucket]) => Object.freeze({ period, ...bucket })),
      );
    };
    // What a reassignment paid the partner for a trip taken from them (9.3),
    // beside the trips they made, with where its payout stands.
    const compensationRows = await this.#pool.query<{
      partner_attempt_compensation_id: string;
      source_order_reference: string;
      displaced_from: string;
      amount_minor: string;
      reason_code: string;
      created_at: Date;
      payout_state: string | null;
      paid_at: Date | null;
    }>(
      `SELECT c.partner_attempt_compensation_id, a.source_order_reference, c.displaced_from,
              c.amount_minor::text, c.reason_code, c.created_at,
              payout.payout_state, payout.paid_at
         FROM marketplace.partner_attempt_compensations c
         JOIN marketplace.delivery_assignments a USING (delivery_assignment_id)
         LEFT JOIN LATERAL (
           SELECT p.payout_state, p.paid_at
             FROM marketplace.partner_payout_items item
             JOIN marketplace.payouts p ON p.payout_id = item.payout_id
            WHERE item.partner_attempt_compensation_id = c.partner_attempt_compensation_id
              AND item.lifecycle_state <> 'RELEASED'
         ) payout ON true
        WHERE c.partner_user_id=$1 AND c.amount_minor > 0
        ORDER BY c.created_at DESC`,
      [partnerId],
    );
    const compensations = compensationRows.rows.map((row) =>
      Object.freeze({
        partner_attempt_compensation_id: row.partner_attempt_compensation_id,
        reference: row.source_order_reference,
        displaced_from: row.displaced_from,
        reason_code: row.reason_code,
        amount_minor: Number(row.amount_minor),
        lifecycle_state: row.payout_state ?? 'EARNED',
        paid_at: row.paid_at?.toISOString() ?? null,
        posted_at: row.created_at.toISOString(),
      }),
    );
    return Object.freeze({
      pending_minor: total - paid,
      paid_minor: paid,
      total_earned_minor: total,
      earnings: Object.freeze(earnings),
      compensations: Object.freeze(compensations),
      days: rollup('day'),
      weeks: rollup('week'),
    });
  }

  /**
   * A shop challenges a line of its settlement (VEN-50, 10.3).
   *
   * The shape is the partner's dispute (9.10): one open case per settlement
   * line, the amount as recorded and the amount expected, what the shop says,
   * and a deadline. The figure recorded is the one the shop's own statement
   * shows for that line (`#settlementFigures`): the first version read the
   * platform's whole remainder as "the fee" — the figure the statement had
   * just stopped showing — counted re-divided refunds twice, and recorded
   * nothing for payment fees and tax, so the case argued about numbers the
   * shop had never been shown.
   */
  async openSettlementDispute(input: {
    readonly context: RequestContext;
    readonly disputed_component: DisputableComponent | 'ADJUSTMENT';
    readonly evidence_note: string;
    readonly expected_amount_minor: number;
    readonly settlement_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly now?: Date;
  }) {
    const who = actor(input.context, 'vendor_staff');
    const now = input.now ?? new Date();
    const contextRefs = refs(input.context);
    amount(input.expected_amount_minor, 'Expected amount', true);
    // An adjustment is the answer to an earlier challenge: argue with the line
    // it changed, not with the answer.
    if (!isDisputableComponent(input.disputed_component))
      throw new MoneyInputError('Challenge the line the adjustment changed');
    const component = input.disputed_component;
    const note = input.evidence_note.trim();
    if (note.length < 1 || note.length > 500)
      throw new MoneyInputError('Say what is wrong, in up to 500 characters');
    return transaction(this.#pool, async (client) => {
      await this.#requireStaff(client, who, input.vendor_location_id);
      const found = await client.query<{ settlement_id: string; vendor_location_id: string }>(
        `SELECT settlement_id, vendor_location_id FROM marketplace.settlements
          WHERE settlement_id=$1 FOR UPDATE`,
        [input.settlement_id],
      );
      const settlement = found.rows[0];
      if (!settlement || settlement.vendor_location_id !== input.vendor_location_id)
        throw new MoneyNotFoundError('Settlement not found');
      // The goods paid and the goods returned are one amount seen from two
      // sides: two open cases over it could each be answered and paid twice.
      if (component === 'ITEM_PROCEEDS' || component === 'REFUND') {
        const sibling = await client.query(
          `SELECT 1 FROM marketplace.vendor_settlement_disputes
            WHERE settlement_id=$1 AND lifecycle_state='OPEN'
              AND disputed_component IN ('ITEM_PROCEEDS','REFUND')`,
          [input.settlement_id],
        );
        if (sibling.rows[0]) throw new MoneyStateError('That line is already being looked at');
      }
      const figures = await this.#settlementFigures(client, input.settlement_id);
      const recorded = figureFor(component, figures);
      if (recorded === input.expected_amount_minor)
        throw new MoneyInputError('That line already shows the amount you expect');
      try {
        const inserted = await client.query<VendorSettlementDisputeRecord>(
          `INSERT INTO marketplace.vendor_settlement_disputes
            (vendor_settlement_dispute_id,settlement_id,vendor_location_id,raised_by_user_id,
             disputed_component,disputed_amount_minor,expected_amount_minor,evidence_note,
             deadline_at,request_id,correlation_id,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,
          [
            createUuidV7(),
            input.settlement_id,
            input.vendor_location_id,
            who,
            component,
            recorded,
            input.expected_amount_minor,
            note,
            new Date(now.getTime() + VENDOR_DISPUTE_ANSWER_MS),
            contextRefs.request,
            contextRefs.correlation,
            now,
          ],
        );
        const row = inserted.rows[0];
        if (!row) throw new MoneyStateError('The challenge was not recorded');
        return row;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new MoneyStateError('That line is already being looked at');
        throw error;
      }
    });
  }

  /** What the shop has challenged, and how it ended (VEN-50). */
  async listSettlementDisputes(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
  }) {
    const who = actor(input.context, 'vendor_staff');
    const client = await this.#pool.connect();
    try {
      await this.#requireStaff(client, who, input.vendor_location_id);
      const rows = await client.query<VendorSettlementDisputeView>(
        `${DISPUTE_PROJECTION} WHERE dispute.vendor_location_id=$1
          ORDER BY dispute.created_at DESC LIMIT 200`,
        [input.vendor_location_id],
      );
      return { disputes: rows.rows };
    } finally {
      client.release();
    }
  }

  /**
   * The operator's queue of shops' challenges (VEN-50, 11.5). A resolve route
   * existed with nothing to find a case by: the operator needed an id only
   * the database held, and a case past its seven-day answer stayed open for
   * good. Overdue cases sort first.
   */
  async listVendorSettlementDisputesForAdmin(input: {
    readonly context: RequestContext;
    readonly state?: 'OPEN' | 'RESOLVED' | 'WITHDRAWN';
    readonly now?: Date;
  }) {
    admin(input.context);
    const now = input.now ?? new Date();
    const rows = await this.#pool.query<VendorSettlementDisputeView>(
      `${DISPUTE_PROJECTION}
        WHERE ($1::text IS NULL OR dispute.lifecycle_state=$1)
        ORDER BY (dispute.lifecycle_state='OPEN' AND dispute.deadline_at < $2) DESC,
                 dispute.deadline_at, dispute.created_at LIMIT 200`,
      [input.state ?? null, now],
    );
    return {
      disputes: rows.rows.map((row) =>
        Object.freeze({
          ...row,
          overdue: row.lifecycle_state === 'OPEN' && row.deadline_at < now,
        }),
      ),
    };
  }

  /**
   * An operator's answer to a challenge (10.3), or the shop's withdrawal.
   *
   * An answer at a figure other than the line's is money in the same
   * transaction: the adjustment is written, the settlement moves while its
   * payout is not yet fixed, and the ledger is posted. The first version
   * (a) added the figure's difference to the shop whatever the line was, so
   * lowering a fee or a refund the shop had been charged took money *from*
   * it; (b) measured the difference from the figure recorded when the case
   * opened, however the settlement had moved since; (c) moved the payable of
   * a settlement already paid, which no batch would ever pay; and (d) posted
   * from the route afterwards, sweeping every other pending adjustment and
   * failing a committed answer when any of them failed.
   */
  async resolveSettlementDispute(input: {
    readonly context: RequestContext;
    readonly resolution: 'RESOLVED' | 'WITHDRAWN';
    readonly resolution_reason_code?: string;
    readonly resolved_amount_minor?: number;
    readonly vendor_settlement_dispute_id: UuidV7;
    /** The store the shop's route names; its case must be that store's. */
    readonly vendor_location_id?: UuidV7;
    readonly now?: Date;
  }): Promise<ResolvedVendorSettlementDispute> {
    const now = input.now ?? new Date();
    if (input.resolution === 'RESOLVED') {
      if (
        !input.resolution_reason_code ||
        !/^[A-Z][A-Z0-9_]{2,63}$/.test(input.resolution_reason_code)
      )
        throw new MoneyInputError('A resolution needs a reason code');
      if (input.resolved_amount_minor === undefined)
        throw new MoneyInputError('A resolution needs the amount decided');
      amount(input.resolved_amount_minor, 'Resolved amount', true);
    }
    return transaction(this.#pool, async (client) => {
      const found = await client.query<VendorSettlementDisputeRecord>(
        `SELECT * FROM marketplace.vendor_settlement_disputes
          WHERE vendor_settlement_dispute_id=$1 FOR UPDATE`,
        [input.vendor_settlement_dispute_id],
      );
      const dispute = found.rows[0];
      if (!dispute) throw new MoneyNotFoundError('Dispute not found');
      const disputeLocation = parseUuidV7(dispute.vendor_location_id);
      // The route's capability check is for the store in its path; a case of
      // another store is not this route's to touch, and is concealed.
      if (input.vendor_location_id && disputeLocation !== input.vendor_location_id)
        throw new MoneyNotFoundError('Dispute not found');
      if (dispute.lifecycle_state !== 'OPEN') throw new MoneyStateError('Dispute is not open');
      let resolverId: UuidV7;
      if (input.resolution === 'RESOLVED') {
        resolverId = admin(input.context);
      } else if (input.context.actor?.actor_kind === 'vendor_staff') {
        resolverId = actor(input.context, 'vendor_staff');
        await this.#requireStaff(client, resolverId, disputeLocation);
      } else {
        resolverId = admin(input.context);
      }
      const updated = await client.query<VendorSettlementDisputeRecord>(
        `UPDATE marketplace.vendor_settlement_disputes
            SET lifecycle_state=$2, resolver_user_id=$3, resolution_reason_code=$4,
                resolved_amount_minor=$5, resolved_at=$6, updated_at=$6
          WHERE vendor_settlement_dispute_id=$1 RETURNING *`,
        [
          input.vendor_settlement_dispute_id,
          input.resolution,
          resolverId,
          input.resolution_reason_code ?? null,
          input.resolved_amount_minor ?? null,
          now,
        ],
      );
      const resolved = updated.rows[0];
      if (!resolved) throw new MoneyNotFoundError('Dispute not found');
      if (input.resolution !== 'RESOLVED') return resolved;

      const settlementId = parseUuidV7(dispute.settlement_id);
      const settlementRow = await client.query<{
        settlement_state: string;
        vendor_payable: string;
      }>(
        `SELECT settlement_state, vendor_payable_minor::text AS vendor_payable
           FROM marketplace.settlements WHERE settlement_id=$1 FOR UPDATE`,
        [settlementId],
      );
      const settlement = settlementRow.rows[0];
      if (!settlement) throw new MoneyNotFoundError('Settlement not found');
      const component = dispute.disputed_component;
      if (!isDisputableComponent(component))
        throw new MoneyStateError('That line cannot be answered with an adjustment');
      const figures = await this.#settlementFigures(client, settlementId);
      const delta =
        DISPUTE_DIRECTION[component] *
        (Number(input.resolved_amount_minor) - figureFor(component, figures));
      if (delta === 0) return resolved;
      const applied = REDIVIDABLE_SETTLEMENT_STATES.has(settlement.settlement_state);
      if (applied && Number(settlement.vendor_payable) + delta < 0)
        throw new MoneyStateError(
          'That answer would take more than the shop is owed; record a correction instead',
        );
      const contextRefs = refs(input.context);
      const adjustmentId = createUuidV7();
      await client.query(
        `INSERT INTO marketplace.vendor_settlement_adjustments
          (vendor_settlement_adjustment_id,settlement_id,vendor_location_id,
           vendor_settlement_dispute_id,delta_minor,reason_code,decided_by_user_id,
           request_id,correlation_id,created_at,applied_to_settlement)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          adjustmentId,
          settlementId,
          disputeLocation,
          input.vendor_settlement_dispute_id,
          delta,
          input.resolution_reason_code,
          resolverId,
          contextRefs.request,
          contextRefs.correlation,
          now,
          applied,
        ],
      );
      if (applied) {
        // The settlement moves with the decision: the shop's payable and the
        // platform's remainder are two sides of the same amount.
        await client.query(
          `UPDATE marketplace.settlements
              SET vendor_payable_minor=vendor_payable_minor+$2,
                  platform_remainder_minor=platform_remainder_minor-$2,
                  version=version+1, updated_at=$3
            WHERE settlement_id=$1`,
          [settlementId, delta, now],
        );
      } else {
        // The payout is fixed: the books will hold what the shop is owed or
        // owes, and a person pays or recovers it outside that payout.
        await this.#openFinanceException(client, {
          kind: 'SETTLEMENT_MISMATCH',
          operation_reference: adjustmentId,
          amount_at_risk_minor: Math.abs(delta),
          next_action_code:
            delta > 0 ? 'PAY_VENDOR_ADJUSTMENT_SEPARATELY' : 'RECOVER_VENDOR_ADJUSTMENT',
          now,
        });
      }
      await this.#postSettlementAdjustmentLocked(client, {
        context: input.context,
        now,
        vendor_settlement_adjustment_id: adjustmentId,
      });
      return Object.freeze({
        ...resolved,
        vendor_settlement_adjustment_id: adjustmentId,
        adjustment_delta_minor: delta,
        applied_to_settlement: applied,
      });
    });
  }

  /** Posts a resolved vendor dispute's delta to the ledger, once (10.3). */
  async postSettlementAdjustment(input: {
    readonly context: RequestContext;
    readonly vendor_settlement_adjustment_id: UuidV7;
    readonly now?: Date;
  }) {
    financeAutomation(input.context);
    const now = input.now ?? new Date();
    return transaction(this.#pool, (client) =>
      this.#postSettlementAdjustmentLocked(client, {
        context: input.context,
        now,
        vendor_settlement_adjustment_id: input.vendor_settlement_adjustment_id,
      }),
    );
  }

  /**
   * The posting itself, inside the caller's transaction. The shop's payable
   * moves against the platform's revenue — the remainder the settlement
   * credited there — rather than against clearing, which had already netted
   * the customer's money to zero.
   */
  async #postSettlementAdjustmentLocked(
    client: PoolClient,
    input: {
      readonly context: RequestContext;
      readonly vendor_settlement_adjustment_id: UuidV7;
      readonly now: Date;
    },
  ) {
    const found = await client.query<{
      delta_minor: string;
      ledger_transaction_id: string | null;
      source_order_reference: string;
      vendor_location_id: string;
    }>(
      `SELECT adjustment.delta_minor::text, adjustment.ledger_transaction_id,
              adjustment.vendor_location_id, settlement.source_order_reference
         FROM marketplace.vendor_settlement_adjustments adjustment
         JOIN marketplace.settlements settlement USING (settlement_id)
        WHERE adjustment.vendor_settlement_adjustment_id=$1 FOR UPDATE OF adjustment`,
      [input.vendor_settlement_adjustment_id],
    );
    const adjustment = found.rows[0];
    if (!adjustment) throw new MoneyNotFoundError('Vendor settlement adjustment not found');
    if (adjustment.ledger_transaction_id) return { posted: false as const, replayed: true };
    const delta = Number(adjustment.delta_minor);
    const order = { source_order_reference: adjustment.source_order_reference };
    const entries = [
      signedEntry('SYNTH-ACCOUNT-VENDOR-PAYABLE', delta, {
        ...order,
        vendor_location_id: parseUuidV7(adjustment.vendor_location_id),
      }),
      signedEntry('SYNTH-ACCOUNT-PLATFORM-REVENUE', -delta, order),
    ].filter((entry): entry is CorrectionEntry => entry !== null);
    const ledgerId = await this.#postEntries(client, {
      context: input.context,
      entries,
      kind: 'ADJUSTMENT',
      now: input.now,
      source_reference: `SYNTH-ADJUSTMENT-VENDOR-${String(input.vendor_settlement_adjustment_id).replaceAll('-', '').toUpperCase()}`,
    });
    await client.query(
      `UPDATE marketplace.vendor_settlement_adjustments
          SET ledger_transaction_id=$2, posted_at=$3
        WHERE vendor_settlement_adjustment_id=$1`,
      [input.vendor_settlement_adjustment_id, ledgerId, input.now],
    );
    return { posted: true as const, replayed: false, ledger_transaction_id: ledgerId };
  }

  /**
   * The worker's pass: every vendor adjustment not yet in the ledger — a
   * backstop now that an answer posts in its own transaction. A row that
   * cannot post opens a posting failure and is skipped while it is open.
   */
  async postPendingSettlementAdjustments(input: {
    readonly context: RequestContext;
    readonly limit?: number;
    readonly now?: Date;
  }) {
    financeAutomation(input.context);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const pending = await this.#pool.query<{ vendor_settlement_adjustment_id: string }>(
      `SELECT adjustment.vendor_settlement_adjustment_id
         FROM marketplace.vendor_settlement_adjustments adjustment
        WHERE adjustment.ledger_transaction_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM marketplace.finance_exceptions exception
             WHERE exception.exception_kind='POSTING_FAILED'
               AND exception.operation_reference=adjustment.vendor_settlement_adjustment_id::text
               AND exception.exception_state IN ('OPEN','ASSIGNED'))
        ORDER BY adjustment.created_at LIMIT $1`,
      [limit],
    );
    let posted = 0;
    for (const row of pending.rows) {
      try {
        const outcome = await this.postSettlementAdjustment({
          context: input.context,
          vendor_settlement_adjustment_id: parseUuidV7(row.vendor_settlement_adjustment_id),
          ...(input.now ? { now: input.now } : {}),
        });
        if (outcome.posted) posted += 1;
      } catch {
        await this.#recordPostingFailure(row.vendor_settlement_adjustment_id, input.now);
      }
    }
    return posted;
  }

  /**
   * The figures a settlement's statement line shows, read from its own
   * policy-versioned lines and the snapshot it was divided from: one reading
   * for the statement and for the shop's challenge of it.
   */
  async #settlementFigures(client: PoolClient, settlementId: string): Promise<SettlementFigures> {
    const found = await client.query<{
      goods: string | null;
      proceeds: string;
      platform_fee: string;
      payment_fee: string;
      tax: string;
      customer_refund: string;
    }>(
      `SELECT settlement.goods_minor::text AS goods,
              COALESCE(line.proceeds,0)::text AS proceeds,
              COALESCE(line.platform_fee,0)::text AS platform_fee,
              COALESCE(line.payment_fee,0)::text AS payment_fee,
              COALESCE(line.tax,0)::text AS tax,
              COALESCE(-line.refund,0)::text AS customer_refund
         FROM marketplace.settlements settlement
         LEFT JOIN LATERAL (${SETTLEMENT_LINE_TOTALS}) line ON TRUE
        WHERE settlement.settlement_id=$1`,
      [settlementId],
    );
    const row = found.rows[0];
    if (!row) throw new MoneyNotFoundError('Settlement not found');
    return settlementFigures(row);
  }

  /**
   * Opens a finance exception unless one of the same kind is already open for
   * the same operation, so a sweep that meets the same problem every tick
   * leaves one case for a person, not one per tick.
   */
  async #openFinanceException(
    client: PoolClient,
    input: {
      readonly kind:
        | 'AMOUNT_MISMATCH'
        | 'CORRECTION_REVIEW'
        | 'POSTING_FAILED'
        | 'SETTLEMENT_MISMATCH'
        | 'STATEMENT_CONFLICT'
        | 'STATEMENT_DUPLICATE'
        | 'STATEMENT_MISSING'
        | 'STATEMENT_UNMATCHED'
        | 'STATUS_MISMATCH';
      /** The queue that works it; finance operations unless named. */
      readonly owner?: 'FINANCE_OPERATIONS' | 'FINANCE_RECONCILIATION';
      readonly operation_reference: string;
      readonly amount_at_risk_minor: number;
      readonly next_action_code: string;
      readonly now: Date;
    },
  ) {
    await client.query(
      `INSERT INTO marketplace.finance_exceptions
        (finance_exception_id,exception_kind,operation_reference,amount_at_risk_minor,
         owner_reference,next_action_code,created_at,updated_at)
       SELECT $1,$2,$3,$4,$7,$5,$6,$6
        WHERE NOT EXISTS (
          SELECT 1 FROM marketplace.finance_exceptions
           WHERE exception_kind=$2 AND operation_reference=$3
             AND exception_state IN ('OPEN','ASSIGNED'))`,
      [
        createUuidV7(),
        input.kind,
        input.operation_reference,
        Math.max(0, input.amount_at_risk_minor),
        input.next_action_code,
        input.now,
        input.owner ?? 'FINANCE_OPERATIONS',
      ],
    );
  }

  /** A pending adjustment the sweep could not post: one open case for a person. */
  async #recordPostingFailure(adjustmentId: string, now: Date | undefined) {
    await transaction(this.#pool, (client) =>
      this.#openFinanceException(client, {
        kind: 'POSTING_FAILED',
        operation_reference: adjustmentId,
        amount_at_risk_minor: 0,
        next_action_code: 'INVESTIGATE_POSTING_FAILURE',
        now: now ?? new Date(),
      }),
    );
  }

  async #requireStaff(client: PoolClient, userId: UuidV7, vendorLocationId: UuidV7) {
    const membership = await client.query(
      `SELECT 1 FROM marketplace.staff_memberships sm JOIN marketplace.role_assignments ra
        ON ra.role_assignment_id=sm.role_assignment_id
       WHERE sm.user_id=$1 AND sm.vendor_location_id=$2 AND ra.state='ACTIVE'
         AND ra.valid_from<=clock_timestamp() AND (ra.valid_until IS NULL OR ra.valid_until>clock_timestamp())`,
      [userId, vendorLocationId],
    );
    if (!membership.rows[0]) throw new MoneyNotFoundError('Settlement not found');
  }

  async financeQueue(input: { readonly context: RequestContext }) {
    admin(input.context);
    const rows = await this.#pool.query(
      `SELECT * FROM marketplace.finance_exceptions WHERE exception_state<>'RESOLVED'
        ORDER BY amount_at_risk_minor DESC,created_at,finance_exception_id`,
    );
    return { exceptions: rows.rows };
  }

  /**
   * The books as they stand (10.1): every account in the catalogue with its
   * postings, and the two totals — shown only when they agree.
   */
  async ledgerTrialBalance(input: { readonly context: RequestContext }) {
    admin(input.context);
    const rows = await this.#pool.query<LedgerAccountBalanceRow>(
      `SELECT account.account_reference, account.account_type, account.owner_kind,
              account.owner_dimension, account.normal_side, account.lifecycle_state,
              COALESCE(sum(entry.debit_minor),0)::text AS debit_minor,
              COALESCE(sum(entry.credit_minor),0)::text AS credit_minor,
              count(entry.ledger_entry_id)::text AS entries
         FROM marketplace.ledger_accounts account
         LEFT JOIN marketplace.ledger_entries entry USING (account_reference)
        GROUP BY account.account_reference
        ORDER BY account.account_reference`,
    );
    return assembleTrialBalance(rows.rows);
  }

  /**
   * One posting with its entries and the references it was made under, so
   * a correction (10.6) can name what it reverses and an operator can read
   * where an amount went.
   */
  async ledgerTransaction(input: {
    readonly context: RequestContext;
    readonly ledger_transaction_id: UuidV7;
  }) {
    admin(input.context);
    const found = await this.#pool.query<any>(
      `SELECT ledger_transaction_id, source_reference, transaction_kind, currency, posted_at,
              provider_operation_reference, policy_version_reference, request_id, correlation_id
         FROM marketplace.ledger_transactions WHERE ledger_transaction_id=$1`,
      [input.ledger_transaction_id],
    );
    const header = found.rows[0];
    if (!header) throw new MoneyNotFoundError('Ledger transaction not found');
    const entries = await this.#pool.query<any>(
      `SELECT ledger_entry_id, account_reference, component, debit_minor::text AS debit_minor,
              credit_minor::text AS credit_minor, vendor_location_id, partner_user_id,
              source_order_reference, created_at
         FROM marketplace.ledger_entries WHERE ledger_transaction_id=$1
        ORDER BY ledger_entry_id`,
      [input.ledger_transaction_id],
    );
    // A posting's correction history (10.6): corrections that reverse it,
    // and the correction this posting is itself the reversal or adjustment of.
    const corrections = await this.#pool.query<any>(
      `SELECT financial_correction_id, correction_reference, lifecycle_state, reason_code,
              CASE WHEN original_ledger_transaction_id=$1 THEN 'ORIGINAL'
                   WHEN reversal_ledger_transaction_id=$1 THEN 'REVERSAL'
                   ELSE 'ADJUSTMENT' END AS role
         FROM marketplace.financial_corrections
        WHERE $1 IN (original_ledger_transaction_id, reversal_ledger_transaction_id,
                     adjustment_ledger_transaction_id)
        ORDER BY created_at`,
      [input.ledger_transaction_id],
    );
    return { ...header, entries: entries.rows, corrections: corrections.rows };
  }

  /**
   * What the books hold for a provider operation, in the statement's terms
   * (10.5). A payment's settled amount is its capture: a captured payment is
   * the captured amount, succeeded; a voided, failed or cancelled one moved
   * no money; anything else is still unknown. Until audit run 70 a voided
   * payment counted as succeeded, so a provider settling money we had
   * released matched. `awaiting` is an operation whose outcome we are
   * waiting to be told.
   */
  async #expectedOperation(client: PoolClient, reference: string, kind: StatementKind) {
    if (kind === 'PAYMENT') {
      const found = await client.query<{
        payment_transaction_id: string;
        payment_state: string;
        amount_minor: string;
        captured_amount_minor: string;
      }>(
        `SELECT payment_transaction_id, payment_state, amount_minor::text,
                captured_amount_minor::text
           FROM marketplace.payment_transactions WHERE provider_operation_reference=$1`,
        [reference],
      );
      const payment = found.rows[0];
      if (!payment) return null;
      const state = payment.payment_state;
      return {
        id: payment.payment_transaction_id,
        amount_minor: Number(
          state === 'CAPTURED' ? payment.captured_amount_minor : payment.amount_minor,
        ),
        provider_state:
          state === 'CAPTURED'
            ? 'SUCCEEDED'
            : ['VOIDED', 'FAILED', 'CANCELLED'].includes(state)
              ? 'FAILED'
              : 'UNKNOWN',
        awaiting: state === 'UNKNOWN_REQUIRES_RECONCILIATION',
      } as const;
    }
    if (kind === 'REFUND') {
      const found = await client.query<{
        refund_id: string;
        refund_state: string;
        amount_minor: string;
        unanswered: boolean;
      }>(
        `SELECT refund.refund_id, refund.refund_state, refund.refund_total_minor::text AS amount_minor,
                EXISTS (SELECT 1 FROM marketplace.finance_exceptions exception
                         WHERE exception.operation_reference=refund.provider_operation_reference
                           AND exception.exception_kind='REFUND_UNKNOWN'
                           AND exception.exception_state<>'RESOLVED') AS unanswered
           FROM marketplace.refunds refund WHERE refund.provider_operation_reference=$1`,
        [reference],
      );
      const refund = found.rows[0];
      if (!refund) return null;
      return {
        id: refund.refund_id,
        amount_minor: Number(refund.amount_minor),
        provider_state:
          refund.refund_state === 'SUCCEEDED'
            ? 'SUCCEEDED'
            : refund.refund_state === 'FAILED_RETRYABLE'
              ? 'FAILED'
              : 'UNKNOWN',
        awaiting: refund.refund_state === 'FAILED_REVIEW' && refund.unanswered,
      } as const;
    }
    const found = await client.query<{
      payout_id: string;
      payout_state: string;
      amount_minor: string;
    }>(
      `SELECT payout_id, payout_state, amount_minor::text
         FROM marketplace.payouts WHERE provider_operation_reference=$1`,
      [reference],
    );
    const payout = found.rows[0];
    if (!payout) return null;
    return {
      id: payout.payout_id,
      amount_minor: Number(payout.amount_minor),
      provider_state:
        payout.payout_state === 'PAID'
          ? 'SUCCEEDED'
          : payout.payout_state === 'FAILED_REVIEW'
            ? 'FAILED'
            : 'UNKNOWN',
      awaiting: payout.payout_state === 'SUBMITTED',
    } as const;
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
      readonly policy_version_reference?: string | undefined;
      readonly provider_operation_reference?: string | undefined;
      readonly source_reference: string;
    },
  ) {
    this.#validateEntries(input.entries);
    const contextRefs = refs(input.context);
    const ledgerId = createUuidV7();
    await client.query(
      `INSERT INTO marketplace.ledger_transactions
        (ledger_transaction_id,source_reference,transaction_kind,posted_at,request_id,correlation_id,
         provider_operation_reference,policy_version_reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        ledgerId,
        input.source_reference,
        input.kind,
        input.now,
        contextRefs.request,
        contextRefs.correlation,
        input.provider_operation_reference ?? null,
        input.policy_version_reference ?? null,
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
