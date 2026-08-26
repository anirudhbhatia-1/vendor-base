import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import {
  LocalFakeMoneyProvider,
  SYNTHETIC_FINANCIAL_POLICY,
  type FakeProviderScenario,
} from './money-policy.js';

export class MoneyInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}
export class MoneyStateError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
}
export class MoneyNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';
}
export class MoneyAuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
}

const COMMAND = /^SYNTH-CMD-[A-Z0-9-]{4,64}$/;
const CHECKOUT = /^SYNTH-CHECKOUT-[A-Z0-9-]{4,64}$/;
const ORDER = /^SYNTH-ORDER-[A-Z0-9-]{4,64}$/;
const POLICY = /^SYNTH-POLICY-[A-Z0-9-]{4,64}$/;
const OPERATION = /^SYNTH-(PAY|REF|PAYOUT)-[A-Z0-9-]{4,64}$/;

export interface PaymentRecord {
  readonly amount_minor: number;
  readonly currency: 'INR';
  readonly payment_state: string;
  readonly payment_transaction_id: UuidV7;
  readonly provider_operation_reference: string;
  readonly source_checkout_reference: string;
  readonly version: number;
}

function text(value: string, pattern: RegExp, label: string): string {
  if (!pattern.test(value)) throw new MoneyInputError(`${label} is invalid or not synthetic`);
  return value;
}
function minor(value: number, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new MoneyInputError(`${label} must be integer paise`);
  }
  return value;
}
function actor(context: RequestContext, kind = 'admin'): UuidV7 {
  if (!context.actor || context.actor.actor_kind !== kind) {
    throw new MoneyAuthorizationError('Authenticated finance authority is required');
  }
  return context.actor.actor_id;
}
function contextIds(context: RequestContext) {
  return {
    correlation: parseUuidV7(context.correlation_id),
    request: parseRequestId(context.request_id),
  };
}
function record(row: Record<string, unknown>): PaymentRecord {
  return Object.freeze({
    amount_minor: Number(row.amount_minor),
    currency: 'INR',
    payment_state: String(row.payment_state),
    payment_transaction_id: parseUuidV7(String(row.payment_transaction_id)),
    provider_operation_reference: String(row.provider_operation_reference),
    source_checkout_reference: String(row.source_checkout_reference),
    version: Number(row.version),
  });
}
async function tx<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class MoneyLifecycleService {
  readonly #pool: Pool;
  readonly #provider: LocalFakeMoneyProvider;

  constructor(input: {
    readonly connection_string: string;
    readonly provider?: LocalFakeMoneyProvider;
  }) {
    this.#pool = new Pool({
      connectionString: input.connection_string,
      application_name: 'neighbourhood-store-money',
      max: 12,
    });
    this.#provider = input.provider ?? new LocalFakeMoneyProvider();
  }
  async close() {
    await this.#pool.end();
  }

  async createPayment(input: {
    readonly allocations: readonly {
      readonly delivery_minor: number;
      readonly discount_minor: number;
      readonly item_minor: number;
      readonly policy_version_reference: string;
      readonly source_order_reference: string;
      readonly tax_minor: number;
      readonly tip_minor: number;
      readonly vendor_location_id: UuidV7;
    }[];
    readonly amount_minor: number;
    readonly command_reference: string;
    readonly context: RequestContext;
    readonly payment_transaction_id?: UuidV7;
    readonly provider_operation_reference: string;
    readonly provider_scenario: FakeProviderScenario;
    readonly source_checkout_reference: string;
    readonly now?: Date;
  }): Promise<PaymentRecord> {
    const who = actor(input.context);
    const command = text(input.command_reference, COMMAND, 'Command reference');
    const amount = minor(input.amount_minor, 'Payment amount', 1);
    if (input.allocations.length < 1 || input.allocations.length > 3)
      throw new MoneyInputError('Payment requires one to three vendor allocations');
    const calculated = input.allocations.reduce(
      (sum, allocation) =>
        sum +
        allocation.item_minor +
        allocation.tax_minor +
        allocation.delivery_minor +
        allocation.tip_minor -
        allocation.discount_minor,
      0,
    );
    if (calculated !== amount)
      throw new MoneyInputError('Payment allocations do not equal the authorization amount');
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    return tx(this.#pool, async (client) => {
      const replay = await client.query(
        `SELECT payment.* FROM marketplace.payment_events event JOIN marketplace.payment_transactions payment USING (payment_transaction_id) WHERE event.command_reference=$1`,
        [command],
      );
      if (replay.rows[0]) return record(replay.rows[0]);
      const paymentId = input.payment_transaction_id ?? createUuidV7({ now_ms: now.getTime() });
      const inserted = await client.query(
        `INSERT INTO marketplace.payment_transactions
          (payment_transaction_id,source_checkout_reference,provider_operation_reference,payment_state,
           amount_minor,provider_scenario,request_id,correlation_id,created_at,updated_at)
         VALUES ($1,$2,$3,'CREATED',$4,$5,$6,$7,$8,$8) RETURNING *`,
        [
          paymentId,
          text(input.source_checkout_reference, CHECKOUT, 'Checkout reference'),
          text(input.provider_operation_reference, OPERATION, 'Provider operation'),
          amount,
          input.provider_scenario,
          ids.request,
          ids.correlation,
          now,
        ],
      );
      for (const allocation of input.allocations) {
        [
          allocation.item_minor,
          allocation.tax_minor,
          allocation.delivery_minor,
          allocation.tip_minor,
          allocation.discount_minor,
        ].forEach((value) => minor(value, 'Allocation component'));
        await client.query(
          `INSERT INTO marketplace.payment_allocations
            (payment_allocation_id,payment_transaction_id,source_order_reference,vendor_location_id,
             item_minor,tax_minor,delivery_minor,tip_minor,discount_minor,policy_version_reference,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            createUuidV7(),
            paymentId,
            text(allocation.source_order_reference, ORDER, 'Order reference'),
            allocation.vendor_location_id,
            allocation.item_minor,
            allocation.tax_minor,
            allocation.delivery_minor,
            allocation.tip_minor,
            allocation.discount_minor,
            text(allocation.policy_version_reference, POLICY, 'Policy reference'),
            now,
          ],
        );
      }
      await client.query(
        `INSERT INTO marketplace.payment_events
          (payment_event_id,payment_transaction_id,payment_version,event_type,resulting_state,
           command_reference,actor_id,actor_kind,reason_code,request_id,correlation_id,occurred_at)
         VALUES ($1,$2,1,'PAYMENT_CREATED','CREATED',$3,$4,'admin','PAYMENT_CREATED',$5,$6,$7)`,
        [createUuidV7(), paymentId, command, who, ids.request, ids.correlation, now],
      );
      return record(inserted.rows[0]);
    });
  }

  async authorize(input: {
    readonly command_reference: string;
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly payment_transaction_id: UuidV7;
    readonly now?: Date;
  }): Promise<PaymentRecord> {
    return this.#providerTransition(input, 'CREATED', 'PAYMENT_AUTHORIZED');
  }

  async capture(input: {
    readonly command_reference: string;
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly payment_transaction_id: UuidV7;
    readonly now?: Date;
  }): Promise<PaymentRecord> {
    const result = await this.#providerTransition(input, 'AUTHORIZED', 'PAYMENT_CAPTURED');
    if (result.payment_state === 'CAPTURED') {
      await this.#postBalanced({
        context: input.context,
        entries: [
          {
            account: 'SYNTH-ACCOUNT-CUSTOMER-CLEARING',
            component: 'CUSTOMER_CAPTURE',
            debit: result.amount_minor,
            credit: 0,
          },
          {
            account: 'SYNTH-ACCOUNT-PLATFORM-CLEARING',
            component: 'PLATFORM_REMAINDER',
            debit: 0,
            credit: result.amount_minor,
          },
        ],
        kind: 'CAPTURE',
        source: `SYNTH-CAPTURE-${result.payment_transaction_id.toUpperCase()}`,
        now: input.now ?? new Date(),
      });
    }
    return result;
  }

  async createSettlement(input: {
    readonly context: RequestContext;
    readonly customer_captured_minor: number;
    readonly partner_outbound_minor: number;
    readonly partner_return_minor: number;
    readonly partner_tip_minor: number;
    readonly partner_user_id?: UuidV7;
    readonly partner_wait_minor: number;
    readonly payment_transaction_id: UuidV7;
    readonly source_order_reference: string;
    readonly successful_refunds_minor: number;
    readonly vendor_item_minor: number;
    readonly vendor_location_id: UuidV7;
    readonly completed: boolean;
    readonly now?: Date;
  }) {
    actor(input.context);
    const now = input.now ?? new Date();
    const customerNet =
      minor(input.customer_captured_minor, 'Captured') -
      minor(input.successful_refunds_minor, 'Refunds');
    const remainingItems = Math.max(
      0,
      minor(input.vendor_item_minor, 'Vendor items') - input.successful_refunds_minor,
    );
    const vendorFee =
      input.completed && remainingItems > 0 ? SYNTHETIC_FINANCIAL_POLICY.vendor_fee_minor : 0;
    const vendorPayable = remainingItems - vendorFee;
    const partnerPayable =
      input.partner_outbound_minor +
      input.partner_wait_minor +
      input.partner_return_minor +
      input.partner_tip_minor;
    [partnerPayable, vendorPayable, customerNet].forEach((value) =>
      minor(value, 'Settlement amount'),
    );
    const platform = customerNet - vendorPayable - partnerPayable;
    const eligibleAt = new Date(
      now.getTime() + SYNTHETIC_FINANCIAL_POLICY.settlement_delay_seconds * 1_000,
    );
    return tx(this.#pool, async (client) => {
      const result = await client.query(
        `INSERT INTO marketplace.settlements
        (settlement_id,source_order_reference,payment_transaction_id,vendor_location_id,partner_user_id,
         settlement_state,customer_captured_minor,successful_refunds_minor,customer_net_minor,
         vendor_payable_minor,partner_payable_minor,platform_remainder_minor,eligible_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,
        [
          createUuidV7(),
          text(input.source_order_reference, ORDER, 'Order reference'),
          input.payment_transaction_id,
          input.vendor_location_id,
          input.partner_user_id ?? null,
          input.customer_captured_minor,
          input.successful_refunds_minor,
          customerNet,
          vendorPayable,
          partnerPayable,
          platform,
          eligibleAt,
          now,
        ],
      );
      const sourceOrder = text(input.source_order_reference, ORDER, 'Order reference');
      const entries: { account: string; component: string; credit: number; debit: number }[] = [
        {
          account: 'SYNTH-ACCOUNT-PLATFORM-CLEARING',
          component: 'PLATFORM_REMAINDER',
          debit: customerNet,
          credit: 0,
        },
      ];
      if (vendorPayable > 0)
        entries.push({
          account: 'SYNTH-ACCOUNT-VENDOR-PAYABLE',
          component: 'VENDOR_PROCEEDS',
          debit: 0,
          credit: vendorPayable,
        });
      if (partnerPayable > 0)
        entries.push({
          account: 'SYNTH-ACCOUNT-PARTNER-PAYABLE',
          component: 'PARTNER_OUTBOUND',
          debit: 0,
          credit: partnerPayable,
        });
      if (platform > 0)
        entries.push({
          account: 'SYNTH-ACCOUNT-PLATFORM-REVENUE',
          component: 'PLATFORM_REMAINDER',
          debit: 0,
          credit: platform,
        });
      if (platform < 0)
        entries.push({
          account: 'SYNTH-ACCOUNT-PLATFORM-SUBSIDY',
          component: 'PLATFORM_REMAINDER',
          debit: -platform,
          credit: 0,
        });
      await this.#insertBalanced(client, {
        context: input.context,
        entries,
        kind: 'SETTLEMENT',
        now,
        source: `SYNTH-SETTLEMENT-${sourceOrder.slice('SYNTH-ORDER-'.length)}`,
      });
      return Object.freeze({
        ...result.rows[0],
        customer_net_minor: customerNet,
        vendor_fee_minor: vendorFee,
      });
    });
  }

  async schedulePayout(input: {
    readonly amount_minor: number;
    readonly beneficiary_kind: 'PARTNER' | 'VENDOR';
    readonly beneficiary_reference: string;
    readonly context: RequestContext;
    readonly provider_operation_reference: string;
    readonly provider_scenario: FakeProviderScenario;
    readonly settlement_id: UuidV7;
    readonly now?: Date;
  }) {
    actor(input.context);
    const amount = minor(input.amount_minor, 'Payout amount', 1);
    const now = input.now ?? new Date();
    const beneficiary = text(
      input.beneficiary_reference,
      /^SYNTH-BENEFICIARY-[A-Z0-9-]{4,64}$/,
      'Beneficiary reference',
    );
    const operation = text(input.provider_operation_reference, OPERATION, 'Payout operation');
    return tx(this.#pool, async (client) => {
      const replay = await client.query(
        'SELECT * FROM marketplace.payouts WHERE provider_operation_reference=$1',
        [operation],
      );
      if (replay.rows[0]) return Object.freeze(replay.rows[0]);
      const settlementResult = await client.query(
        'SELECT * FROM marketplace.settlements WHERE settlement_id=$1 FOR UPDATE',
        [input.settlement_id],
      );
      const settlement = settlementResult.rows[0];
      if (!settlement) throw new MoneyNotFoundError('Settlement not found');
      if (!['PENDING', 'ELIGIBLE', 'SCHEDULED', 'SUBMITTED'].includes(settlement.settlement_state))
        throw new MoneyStateError('Settlement cannot schedule a payout');
      if (settlement.eligible_at > now) throw new MoneyStateError('Settlement is not eligible yet');
      const expected =
        input.beneficiary_kind === 'VENDOR'
          ? Number(settlement.vendor_payable_minor)
          : Number(settlement.partner_payable_minor);
      if (amount !== expected || expected <= 0)
        throw new MoneyInputError('Payout must equal the beneficiary settlement payable');
      const duplicate = await client.query(
        'SELECT 1 FROM marketplace.payouts WHERE settlement_id=$1 AND beneficiary_kind=$2',
        [input.settlement_id, input.beneficiary_kind],
      );
      if (duplicate.rows[0]) throw new MoneyStateError('Beneficiary payout already exists');
      const inserted = await client.query(
        `INSERT INTO marketplace.payouts
          (payout_id,settlement_id,beneficiary_kind,beneficiary_reference,
           provider_operation_reference,payout_state,amount_minor,provider_scenario,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,'SCHEDULED',$6,$7,$8,$8) RETURNING *`,
        [
          createUuidV7(),
          input.settlement_id,
          input.beneficiary_kind,
          beneficiary,
          operation,
          amount,
          input.provider_scenario,
          now,
        ],
      );
      await client.query(
        `UPDATE marketplace.settlements
            SET settlement_state='SCHEDULED',version=version+1,updated_at=$2
          WHERE settlement_id=$1`,
        [input.settlement_id, now],
      );
      return Object.freeze(inserted.rows[0]);
    });
  }

  async submitPayout(input: {
    readonly context: RequestContext;
    readonly payout_id: UuidV7;
    readonly expected_version: number;
    readonly now?: Date;
  }) {
    actor(input.context);
    const now = input.now ?? new Date();
    const payout = await tx(this.#pool, async (client) => {
      const found = await client.query(
        'SELECT * FROM marketplace.payouts WHERE payout_id=$1 FOR UPDATE',
        [input.payout_id],
      );
      const current = found.rows[0];
      if (!current) throw new MoneyNotFoundError('Payout not found');
      if (current.payout_state === 'PAID' || current.payout_state === 'SUBMITTED')
        return Object.freeze(current);
      if (current.payout_state !== 'SCHEDULED' || current.version !== input.expected_version)
        throw new MoneyStateError('Payout state or version does not permit submission');
      const outcome = this.#provider.execute({
        amount_minor: Number(current.amount_minor),
        operation_reference: current.provider_operation_reference,
        scenario: current.provider_scenario,
      });
      const next =
        outcome === 'SUCCEEDED' ? 'PAID' : outcome === 'DECLINED' ? 'FAILED_REVIEW' : 'SUBMITTED';
      const updated = await client.query(
        `UPDATE marketplace.payouts
            SET payout_state=$2::text,version=version+1,submitted_at=$3::timestamptz,
                paid_at=CASE WHEN $2::text='PAID' THEN $3::timestamptz ELSE NULL END,
                updated_at=$3::timestamptz
          WHERE payout_id=$1 RETURNING *`,
        [input.payout_id, next, now],
      );
      if (outcome === 'UNKNOWN')
        await client.query(
          `INSERT INTO marketplace.finance_exceptions
            (finance_exception_id,exception_kind,operation_reference,amount_at_risk_minor,
             next_action_code,created_at,updated_at)
           VALUES ($1,'PAYOUT_UNKNOWN',$2,$3,'MATCH_PROVIDER_STATEMENT',$4,$4)`,
          [createUuidV7(), current.provider_operation_reference, current.amount_minor, now],
        );
      return Object.freeze(updated.rows[0]);
    });
    if (payout.payout_state === 'PAID') {
      await this.#postPayoutLedger(input.context, payout, now);
      await this.#refreshSettlementState(String(payout.settlement_id), now);
    }
    return payout;
  }

  async reconcilePayout(input: {
    readonly amount_minor: number;
    readonly context: RequestContext;
    readonly payout_id: UuidV7;
    readonly provider_state: 'FAILED' | 'SUCCEEDED' | 'UNKNOWN';
    readonly statement_reference: string;
    readonly now?: Date;
  }) {
    actor(input.context);
    const amount = minor(input.amount_minor, 'Statement amount', 1);
    const now = input.now ?? new Date();
    const statement = text(
      input.statement_reference,
      /^SYNTH-STMT-[A-Z0-9-]{4,64}$/,
      'Statement reference',
    );
    const payout = await tx(this.#pool, async (client) => {
      const found = await client.query(
        'SELECT * FROM marketplace.payouts WHERE payout_id=$1 FOR UPDATE',
        [input.payout_id],
      );
      const current = found.rows[0];
      if (!current) throw new MoneyNotFoundError('Payout not found');
      if (Number(current.amount_minor) !== amount)
        throw new MoneyInputError('Statement amount conflicts with payout');
      const existing = await client.query(
        'SELECT * FROM marketplace.provider_statement_rows WHERE provider_operation_reference=$1',
        [current.provider_operation_reference],
      );
      if (existing.rows[0] && existing.rows[0].statement_reference !== statement)
        throw new MoneyStateError('Operation already reconciled to another statement');
      if (!existing.rows[0])
        await client.query(
          `INSERT INTO marketplace.provider_statement_rows
            (statement_row_id,provider_operation_reference,statement_reference,operation_kind,
             amount_minor,provider_state,matched_at,created_at)
           VALUES ($1,$2,$3,'PAYOUT',$4,$5,$6,$6)`,
          [
            createUuidV7(),
            current.provider_operation_reference,
            statement,
            amount,
            input.provider_state,
            input.provider_state === 'UNKNOWN' ? null : now,
          ],
        );
      if (input.provider_state === 'UNKNOWN') return Object.freeze(current);
      const next = input.provider_state === 'SUCCEEDED' ? 'PAID' : 'FAILED_REVIEW';
      const updated = await client.query(
        `UPDATE marketplace.payouts
            SET payout_state=$2::text,statement_reference=$3::text,version=version+1,
                paid_at=CASE WHEN $2::text='PAID' THEN $4::timestamptz ELSE paid_at END,
                updated_at=$4::timestamptz
          WHERE payout_id=$1 RETURNING *`,
        [input.payout_id, next, statement, now],
      );
      await client.query(
        `UPDATE marketplace.finance_exceptions
            SET exception_state='RESOLVED',updated_at=$2
          WHERE operation_reference=$1 AND exception_state<>'RESOLVED'`,
        [current.provider_operation_reference, now],
      );
      return Object.freeze(updated.rows[0]);
    });
    if (payout.payout_state === 'PAID') {
      await this.#postPayoutLedger(input.context, payout, now);
      await this.#refreshSettlementState(String(payout.settlement_id), now);
    }
    return payout;
  }

  async proposeRefund(input: {
    readonly command_reference: string;
    readonly context: RequestContext;
    readonly delivery_minor: number;
    readonly discount_reversal_minor: number;
    readonly item_minor: number;
    readonly payment_transaction_id: UuidV7;
    readonly provider_operation_reference: string;
    readonly provider_scenario: FakeProviderScenario;
    readonly source_order_reference: string;
    readonly tax_minor: number;
    readonly tip_minor: number;
    readonly trigger_code:
      | 'CONTROLLED_RETURN'
      | 'FULL_ITEM_REFUND'
      | 'PARTIAL_ITEM_REFUND'
      | 'PRE_PICKUP_CANCEL'
      | 'PROVIDER_EXCEPTION';
    readonly now?: Date;
  }) {
    const who = actor(input.context);
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    const total =
      minor(input.item_minor, 'Item refund') +
      minor(input.tax_minor, 'Tax refund') +
      minor(input.delivery_minor, 'Delivery refund') +
      minor(input.tip_minor, 'Tip refund') -
      minor(input.discount_reversal_minor, 'Discount reversal');
    minor(total, 'Refund total', 1);
    return tx(this.#pool, async (client) => {
      const payment = await client.query<{ amount_minor: string; payment_state: string }>(
        'SELECT amount_minor,payment_state FROM marketplace.payment_transactions WHERE payment_transaction_id=$1 FOR SHARE',
        [input.payment_transaction_id],
      );
      if (!payment.rows[0] || payment.rows[0].payment_state !== 'CAPTURED') {
        throw new MoneyStateError('Refund requires a captured payment');
      }
      const previous = await client.query<{ total: string }>(
        `SELECT COALESCE(sum(refund_total_minor),0)::text AS total
           FROM marketplace.refunds
          WHERE payment_transaction_id=$1 AND refund_state='SUCCEEDED'`,
        [input.payment_transaction_id],
      );
      if (Number(previous.rows[0]?.total ?? 0) + total > Number(payment.rows[0].amount_minor)) {
        throw new MoneyInputError('Refund exceeds the remaining captured amount');
      }
      const refundId = createUuidV7();
      const inserted = await client.query(
        `INSERT INTO marketplace.refunds
          (refund_id,payment_transaction_id,source_order_reference,provider_operation_reference,
           refund_state,trigger_code,item_minor,tax_minor,delivery_minor,tip_minor,
           discount_reversal_minor,proposed_by_user_id,approval_expires_at,provider_scenario,
           request_id,correlation_id,created_at,updated_at)
         VALUES ($1,$2,$3,$4,'PENDING_APPROVAL',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
         RETURNING *`,
        [
          refundId,
          input.payment_transaction_id,
          text(input.source_order_reference, ORDER, 'Order reference'),
          text(input.provider_operation_reference, OPERATION, 'Refund operation'),
          input.trigger_code,
          input.item_minor,
          input.tax_minor,
          input.delivery_minor,
          input.tip_minor,
          input.discount_reversal_minor,
          who,
          new Date(now.getTime() + 900_000),
          input.provider_scenario,
          ids.request,
          ids.correlation,
          now,
        ],
      );
      await client.query(
        `INSERT INTO marketplace.refund_events
          (refund_event_id,refund_id,refund_version,event_type,resulting_state,actor_id,reason_code,
           command_reference,request_id,correlation_id,occurred_at)
         VALUES ($1,$2,1,'REFUND_PROPOSED','PENDING_APPROVAL',$3,'REFUND_PROPOSED',$4,$5,$6,$7)`,
        [
          createUuidV7(),
          refundId,
          who,
          text(input.command_reference, COMMAND, 'Command reference'),
          ids.request,
          ids.correlation,
          now,
        ],
      );
      return Object.freeze({ ...inserted.rows[0], refund_total_minor: total });
    });
  }

  async approveAndSubmitRefund(input: {
    readonly command_reference: string;
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly refund_id: UuidV7;
    readonly now?: Date;
  }) {
    const who = actor(input.context);
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    const approved = await tx(this.#pool, async (client) => {
      const result = await client.query(
        'SELECT * FROM marketplace.refunds WHERE refund_id=$1 FOR UPDATE',
        [input.refund_id],
      );
      const refund = result.rows[0];
      if (!refund) throw new MoneyNotFoundError('Refund not found');
      if (
        refund.refund_state !== 'PENDING_APPROVAL' ||
        refund.version !== input.expected_version ||
        refund.approval_expires_at <= now ||
        refund.proposed_by_user_id === who
      ) {
        throw new MoneyStateError('Refund approval is stale, expired, or self-approved');
      }
      const outcome = this.#provider.execute({
        amount_minor: Number(refund.refund_total_minor),
        operation_reference: refund.provider_operation_reference,
        scenario: refund.provider_scenario,
      });
      const next =
        outcome === 'SUCCEEDED'
          ? 'SUCCEEDED'
          : outcome === 'DECLINED'
            ? 'FAILED_RETRYABLE'
            : 'FAILED_REVIEW';
      const updated = await client.query(
        `UPDATE marketplace.refunds
            SET refund_state=$2,approved_by_user_id=$3,version=3,updated_at=$4
          WHERE refund_id=$1 RETURNING *`,
        [input.refund_id, next, who, now],
      );
      const command = text(input.command_reference, COMMAND, 'Command reference');
      await client.query(
        `INSERT INTO marketplace.refund_events
          (refund_event_id,refund_id,refund_version,event_type,previous_state,resulting_state,
           actor_id,reason_code,command_reference,request_id,correlation_id,occurred_at)
         VALUES
          ($1,$2,2,'REFUND_APPROVED','PENDING_APPROVAL','SUBMITTED',$3,'REFUND_APPROVED',$4,$5,$6,$7),
          ($8,$2,3,'REFUND_PROVIDER_RESULT','SUBMITTED',$9,$3,'REFUND_PROVIDER_RESULT',$10,$5,$6,$7)`,
        [
          createUuidV7(),
          input.refund_id,
          who,
          `${command}-APPROVAL`,
          ids.request,
          ids.correlation,
          now,
          createUuidV7(),
          next,
          command,
        ],
      );
      if (outcome === 'UNKNOWN') {
        await client.query(
          `INSERT INTO marketplace.finance_exceptions
            (finance_exception_id,exception_kind,operation_reference,amount_at_risk_minor,
             next_action_code,created_at,updated_at)
           VALUES ($1,'REFUND_UNKNOWN',$2,$3,'RECONCILE_SAME_OPERATION',$4,$4)`,
          [createUuidV7(), refund.provider_operation_reference, refund.refund_total_minor, now],
        );
      }
      return Object.freeze(updated.rows[0]);
    });
    if (approved.refund_state === 'SUCCEEDED') {
      const amount = Number(approved.refund_total_minor);
      await this.#postBalanced({
        context: input.context,
        entries: [
          {
            account: 'SYNTH-ACCOUNT-PLATFORM-CLEARING',
            component: 'CUSTOMER_REFUND',
            credit: 0,
            debit: amount,
          },
          {
            account: 'SYNTH-ACCOUNT-CUSTOMER-CLEARING',
            component: 'CUSTOMER_REFUND',
            credit: amount,
            debit: 0,
          },
        ],
        kind: 'REFUND',
        now,
        source: `SYNTH-REFUND-${String(approved.refund_id).toUpperCase()}`,
      });
    }
    return approved;
  }

  async #providerTransition(
    input: {
      readonly command_reference: string;
      readonly context: RequestContext;
      readonly expected_version: number;
      readonly payment_transaction_id: UuidV7;
      readonly now?: Date;
    },
    expected: string,
    eventType: string,
  ): Promise<PaymentRecord> {
    const who = actor(input.context);
    const command = text(input.command_reference, COMMAND, 'Command reference');
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    return tx(this.#pool, async (client) => {
      const replay = await client.query(
        `SELECT payment.* FROM marketplace.payment_events event JOIN marketplace.payment_transactions payment USING (payment_transaction_id) WHERE event.command_reference=$1`,
        [command],
      );
      if (replay.rows[0]) return record(replay.rows[0]);
      const locked = await client.query(
        'SELECT * FROM marketplace.payment_transactions WHERE payment_transaction_id=$1 FOR UPDATE',
        [input.payment_transaction_id],
      );
      const payment = locked.rows[0];
      if (!payment) throw new MoneyNotFoundError('Payment not found');
      if (payment.payment_state !== expected || payment.version !== input.expected_version)
        throw new MoneyStateError('Payment state or version does not permit this operation');
      const inFlightState = expected === 'CREATED' ? 'AUTHORIZING' : 'CAPTURE_PENDING';
      await client.query(
        'UPDATE marketplace.payment_transactions SET payment_state=$2,version=version+1,updated_at=$3 WHERE payment_transaction_id=$1',
        [input.payment_transaction_id, inFlightState, now],
      );
      await client.query(
        `INSERT INTO marketplace.payment_events
          (payment_event_id,payment_transaction_id,payment_version,event_type,previous_state,resulting_state,
           command_reference,actor_id,actor_kind,reason_code,request_id,correlation_id,occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'admin',$9,$10,$11,$12)`,
        [
          createUuidV7(),
          input.payment_transaction_id,
          input.expected_version + 1,
          `${eventType}_STARTED`,
          expected,
          inFlightState,
          `${command}-START`,
          who,
          `${eventType}_STARTED`,
          ids.request,
          ids.correlation,
          now,
        ],
      );
      const outcome = this.#provider.execute({
        amount_minor: Number(payment.amount_minor),
        operation_reference: payment.provider_operation_reference,
        scenario: payment.provider_scenario,
      });
      const successState = expected === 'CREATED' ? 'AUTHORIZED' : 'CAPTURED';
      const next =
        outcome === 'SUCCEEDED'
          ? successState
          : outcome === 'DECLINED'
            ? 'FAILED'
            : 'UNKNOWN_REQUIRES_RECONCILIATION';
      const updated = await client.query(
        'UPDATE marketplace.payment_transactions SET payment_state=$2,version=version+1,updated_at=$3 WHERE payment_transaction_id=$1 RETURNING *',
        [input.payment_transaction_id, next, now],
      );
      await client.query(
        `INSERT INTO marketplace.payment_events
          (payment_event_id,payment_transaction_id,payment_version,event_type,previous_state,resulting_state,
           provider_result,command_reference,actor_id,actor_kind,reason_code,request_id,correlation_id,occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'admin',$10,$11,$12,$13)`,
        [
          createUuidV7(),
          input.payment_transaction_id,
          input.expected_version + 2,
          eventType,
          inFlightState,
          next,
          outcome,
          command,
          who,
          eventType,
          ids.request,
          ids.correlation,
          now,
        ],
      );
      if (outcome === 'UNKNOWN')
        await client.query(
          `INSERT INTO marketplace.finance_exceptions
          (finance_exception_id,exception_kind,operation_reference,amount_at_risk_minor,next_action_code,created_at,updated_at)
         VALUES ($1,'PAYMENT_UNKNOWN',$2,$3,'RECONCILE_SAME_OPERATION',$4,$4)`,
          [createUuidV7(), payment.provider_operation_reference, payment.amount_minor, now],
        );
      return record(updated.rows[0]);
    });
  }

  async #postBalanced(input: {
    readonly context: RequestContext;
    readonly entries: readonly {
      account: string;
      component: string;
      credit: number;
      debit: number;
    }[];
    readonly kind: string;
    readonly now: Date;
    readonly source: string;
  }) {
    await tx(this.#pool, async (client) => {
      await this.#insertBalanced(client, input);
    });
  }

  async #postPayoutLedger(context: RequestContext, payout: Record<string, unknown>, now: Date) {
    const amount = Number(payout.amount_minor);
    const payable =
      payout.beneficiary_kind === 'VENDOR'
        ? 'SYNTH-ACCOUNT-VENDOR-PAYABLE'
        : 'SYNTH-ACCOUNT-PARTNER-PAYABLE';
    await this.#postBalanced({
      context,
      entries: [
        { account: payable, component: 'PAYOUT', debit: amount, credit: 0 },
        { account: 'SYNTH-ACCOUNT-FAKE-PROVIDER', component: 'PAYOUT', debit: 0, credit: amount },
      ],
      kind: 'PAYOUT',
      now,
      source: `SYNTH-PAYOUT-${String(payout.payout_id).toUpperCase()}`,
    });
  }

  async #refreshSettlementState(settlementId: string, now: Date) {
    await this.#pool.query(
      `UPDATE marketplace.settlements settlement
          SET settlement_state=CASE
                WHEN EXISTS (
                  SELECT 1 FROM marketplace.payouts payout
                   WHERE payout.settlement_id=settlement.settlement_id
                     AND payout.payout_state='FAILED_REVIEW'
                ) THEN 'FAILED_REVIEW'
                WHEN (SELECT count(*) FROM marketplace.payouts payout
                       WHERE payout.settlement_id=settlement.settlement_id)
                     = (CASE WHEN settlement.vendor_payable_minor > 0 THEN 1 ELSE 0 END
                        + CASE WHEN settlement.partner_payable_minor > 0 THEN 1 ELSE 0 END)
                 AND NOT EXISTS (
                   SELECT 1 FROM marketplace.payouts payout
                    WHERE payout.settlement_id=settlement.settlement_id
                      AND payout.payout_state<>'PAID'
                 ) THEN 'PAID'
                ELSE 'SUBMITTED'
              END,
              version=version+1,updated_at=$2
        WHERE settlement_id=$1`,
      [settlementId, now],
    );
  }

  async #insertBalanced(
    client: PoolClient,
    input: {
      readonly context: RequestContext;
      readonly entries: readonly {
        account: string;
        component: string;
        credit: number;
        debit: number;
      }[];
      readonly kind: string;
      readonly now: Date;
      readonly source: string;
    },
  ) {
    const debit = input.entries.reduce((sum, entry) => sum + entry.debit, 0);
    const credit = input.entries.reduce((sum, entry) => sum + entry.credit, 0);
    if (debit !== credit || debit <= 0)
      throw new MoneyInputError('Ledger transaction is unbalanced');
    const ids = contextIds(input.context);
    const existing = await client.query(
      'SELECT 1 FROM marketplace.ledger_transactions WHERE source_reference=$1',
      [input.source],
    );
    if (existing.rows[0]) return;
    const ledgerId = createUuidV7();
    await client.query(
      'INSERT INTO marketplace.ledger_transactions (ledger_transaction_id,source_reference,transaction_kind,posted_at,request_id,correlation_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [ledgerId, input.source, input.kind, input.now, ids.request, ids.correlation],
    );
    for (const entry of input.entries)
      await client.query(
        `INSERT INTO marketplace.ledger_entries
          (ledger_entry_id,ledger_transaction_id,account_reference,component,debit_minor,credit_minor)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [createUuidV7(), ledgerId, entry.account, entry.component, entry.debit, entry.credit],
      );
  }
}
