import { createDatabasePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import { resolveFinancialPolicy } from './financial-policy.js';
import {
  LocalFakeMoneyProvider,
  calculateCommissionAmount,
  type FakeProviderScenario,
  type FinancialPolicy,
  type MoneyProviderAdapter,
  providerOutcome,
} from './money-policy.js';
import { transaction as tx } from './transaction.js';

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

const COMMAND = /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/;
const CHECKOUT = /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/;
const ORDER = /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/;
const POLICY = /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/;
const OPERATION = /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/;

export interface PaymentRecord {
  readonly amount_minor: number;
  readonly captured_amount_minor: number;
  readonly currency: 'INR';
  readonly payment_state: string;
  readonly payment_transaction_id: UuidV7;
  readonly provider_operation_reference: string;
  readonly source_checkout_reference: string;
  readonly version: number;
  readonly voided_amount_minor: number;
}

function text(value: string, pattern: RegExp, label: string): string {
  if (!pattern.test(value)) throw new MoneyInputError(`${label} is invalid`);
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
/**
 * A finance operation caused either by a person or by a committed domain event.
 *
 * Capture and settlement are consequences of the order lifecycle, so the worker
 * has to be able to perform them; requiring an administrator meant they could
 * only ever be run by hand. The actor is still recorded truthfully, so a
 * movement the platform made is never filed as one an administrator made.
 */
function financeAutomation(context: RequestContext): {
  readonly id: UuidV7;
  readonly kind: string;
} {
  const kind = context.actor?.actor_kind;
  if (!context.actor || (kind !== 'admin' && kind !== 'system')) {
    throw new MoneyAuthorizationError('Finance administrator or system worker is required');
  }
  return { id: context.actor.actor_id, kind: kind as string };
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
    captured_amount_minor: Number(row.captured_amount_minor ?? 0),
    currency: 'INR',
    payment_state: String(row.payment_state),
    payment_transaction_id: parseUuidV7(String(row.payment_transaction_id)),
    provider_operation_reference: String(row.provider_operation_reference),
    source_checkout_reference: String(row.source_checkout_reference),
    version: Number(row.version),
    voided_amount_minor: Number(row.voided_amount_minor ?? 0),
  });
}
export class MoneyLifecycleService {
  readonly #pool: Pool;
  readonly #provider: MoneyProviderAdapter;

  constructor(input: {
    readonly connection_string: string;
    readonly provider?: MoneyProviderAdapter;
  }) {
    this.#pool = createDatabasePool({
      connectionString: input.connection_string,
      application_name: 'neighbourhood-store-money',
      max: 12,
    });
    this.#provider = input.provider ?? new LocalFakeMoneyProvider();
  }
  async close() {
    await this.#pool.end();
  }

  /**
   * Read models for the admin finance queue.
   *
   * The finance surface was write-only: an operator could propose a refund but
   * had no way to find the payment it applies to, because payments are keyed by
   * checkout reference and nothing exposed them.
   */
  /**
   * The fee model in force right now.
   *
   * For callers that have no priced order to date the policy from — the manual
   * finance routes. Anything settling a real order should resolve the policy as
   * of that order's quote instead, so it divides by the rules it was sold under.
   */
  async resolveActiveFinancialPolicy(input: { readonly at?: Date } = {}) {
    return resolveFinancialPolicy(this.#pool, input);
  }

  async listPayments(input: {
    readonly context: RequestContext;
    readonly limit?: number;
  }): Promise<readonly Record<string, unknown>[]> {
    actor(input.context);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const rows = await this.#pool.query(
      `SELECT payment_transaction_id, source_checkout_reference, provider_operation_reference,
              payment_state, amount_minor::text AS amount_minor, currency, provider_scenario,
              version, created_at, updated_at
         FROM marketplace.payment_transactions
        ORDER BY created_at DESC, payment_transaction_id DESC
        LIMIT $1`,
      [limit],
    );
    return rows.rows;
  }

  async listRefunds(input: {
    readonly context: RequestContext;
    readonly limit?: number;
  }): Promise<readonly Record<string, unknown>[]> {
    actor(input.context);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const rows = await this.#pool.query(
      `SELECT refund_id, payment_transaction_id, source_order_reference,
              provider_operation_reference, refund_state, trigger_code,
              refund_total_minor::text AS refund_total_minor, approval_expires_at,
              version, created_at, updated_at
         FROM marketplace.refunds
        ORDER BY created_at DESC, refund_id DESC
        LIMIT $1`,
      [limit],
    );
    return rows.rows;
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
    // The capture and its posting are one transaction (10.1): the record
    // says CAPTURED only once the ledger says where the money went. Until
    // run 66 the posting followed in a second transaction, so a failure
    // between the two left a captured payment the ledger knew nothing of.
    return this.#providerTransition(input, 'AUTHORIZED', 'PAYMENT_CAPTURED', (client, payment) =>
      this.#postCaptureLedger(client, input.context, payment, input.now ?? new Date()),
    );
  }

  async #postCaptureLedger(
    client: PoolClient,
    context: RequestContext,
    payment: PaymentRecord,
    now: Date,
  ): Promise<PaymentRecord> {
    await client.query(
      `UPDATE marketplace.payment_transactions SET captured_amount_minor=amount_minor
        WHERE payment_transaction_id=$1 AND captured_amount_minor=0`,
      [payment.payment_transaction_id],
    );
    // One credit per allocated order, so the capture is traceable to the
    // child orders it paid for; the customer side is the whole amount.
    const allocations = await client.query<{
      allocated_total_minor: string;
      policy_version_reference: string;
      source_order_reference: string;
      vendor_location_id: string;
    }>(
      `SELECT source_order_reference, vendor_location_id, allocated_total_minor::text,
              policy_version_reference
         FROM marketplace.payment_allocations
        WHERE payment_transaction_id=$1 ORDER BY source_order_reference`,
      [payment.payment_transaction_id],
    );
    // An order allocated nothing has no credit to carry; if the allocations
    // do not account for the whole amount the capture is posted as one
    // credit, because the ledger balances on the money, not on the split.
    const perOrder = allocations.rows
      .filter((allocation) => Number(allocation.allocated_total_minor) > 0)
      .map((allocation) => ({
        account: 'SYNTH-ACCOUNT-PLATFORM-CLEARING',
        component: 'PLATFORM_REMAINDER',
        debit: 0,
        credit: Number(allocation.allocated_total_minor),
        source_order_reference: allocation.source_order_reference,
        vendor_location_id: allocation.vendor_location_id,
      }));
    const allocated = perOrder.reduce((sum, entry) => sum + entry.credit, 0);
    await this.#insertBalanced(client, {
      context,
      entries: [
        {
          account: 'SYNTH-ACCOUNT-CUSTOMER-CLEARING',
          component: 'CUSTOMER_CAPTURE',
          debit: payment.amount_minor,
          credit: 0,
        },
        ...(allocated === payment.amount_minor
          ? perOrder
          : [
              {
                account: 'SYNTH-ACCOUNT-PLATFORM-CLEARING',
                component: 'PLATFORM_REMAINDER',
                debit: 0,
                credit: payment.amount_minor,
              },
            ]),
      ],
      kind: 'CAPTURE',
      now,
      policy: allocations.rows[0]?.policy_version_reference,
      provider: payment.provider_operation_reference,
      source: `SYNTH-CAPTURE-${payment.payment_transaction_id.toUpperCase()}`,
    });
    return Object.freeze({ ...payment, captured_amount_minor: payment.amount_minor });
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
    /**
     * The policy the order was quoted under, not today's.
     *
     * Required rather than defaulted: a settlement that silently used the
     * compiled-in constant would divide an order's money by rules it was never
     * priced against, which is the drift MKT-10 exists to prevent.
     */
    readonly financial_policy: FinancialPolicy;
    readonly policy_version_reference: string;
  }) {
    financeAutomation(input.context);
    const now = input.now ?? new Date();
    const customerNet =
      minor(input.customer_captured_minor, 'Captured') -
      minor(input.successful_refunds_minor, 'Refunds');
    const remainingItems = Math.max(
      0,
      minor(input.vendor_item_minor, 'Vendor items') - input.successful_refunds_minor,
    );
    // Commission is a rate on what the vendor actually supplied, so a refunded
    // line reduces it rather than being charged for.
    const vendorFee =
      input.completed && remainingItems > 0
        ? calculateCommissionAmount(remainingItems, input.financial_policy.commission_basis_points)
        : 0;
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
      now.getTime() + input.financial_policy.settlement_delay_seconds * 1_000,
    );
    return tx(this.#pool, async (client) => {
      const sourceOrder = text(input.source_order_reference, ORDER, 'Order reference');
      const replay = await client.query(
        `SELECT * FROM marketplace.settlements WHERE source_order_reference=$1`,
        [sourceOrder],
      );
      if (replay.rows[0]) return Object.freeze({ ...replay.rows[0], vendor_fee_minor: vendorFee });
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
      const settlementId = result.rows[0].settlement_id;
      const policy = text(input.policy_version_reference, POLICY, 'Policy reference');
      const lines = [
        ['CUSTOMER', 'CAPTURE', input.customer_captured_minor],
        ['CUSTOMER', 'REFUND', -input.successful_refunds_minor],
        ['VENDOR', 'ITEM_PROCEEDS', remainingItems],
        ['PLATFORM', 'PLATFORM_FEE', vendorFee],
        ['PARTNER', 'DELIVERY_BASE', input.partner_outbound_minor],
        ['PARTNER', 'WAIT', input.partner_wait_minor],
        ['PARTNER', 'RETURN', input.partner_return_minor],
        ['PARTNER', 'TIP', input.partner_tip_minor],
        ['PLATFORM', 'ADJUSTMENT', platform],
      ] as const;
      for (const [participant, component, lineAmount] of lines) {
        if (lineAmount === 0) continue;
        await client.query(
          `INSERT INTO marketplace.settlement_lines
            (settlement_line_id,settlement_id,participant_kind,component,amount_minor,
             policy_version_reference,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [createUuidV7(), settlementId, participant, component, lineAmount, policy, now],
        );
      }
      // Every entry names the order it divides, and an amount owed to a
      // vendor or a partner names them (10.1): the payable accounts are the
      // platform's liabilities owed per vendor and per partner, and the
      // catalogue refuses an entry on them that names nobody.
      if (partnerPayable > 0 && !input.partner_user_id)
        throw new MoneyInputError('A partner payable must name the partner it is owed to');
      const entries: LedgerEntryInput[] = [
        {
          account: 'SYNTH-ACCOUNT-PLATFORM-CLEARING',
          component: 'PLATFORM_REMAINDER',
          debit: customerNet,
          credit: 0,
          source_order_reference: sourceOrder,
          vendor_location_id: input.vendor_location_id,
        },
      ];
      if (vendorPayable > 0)
        entries.push({
          account: 'SYNTH-ACCOUNT-VENDOR-PAYABLE',
          component: 'VENDOR_PROCEEDS',
          debit: 0,
          credit: vendorPayable,
          source_order_reference: sourceOrder,
          vendor_location_id: input.vendor_location_id,
        });
      if (partnerPayable > 0)
        entries.push({
          account: 'SYNTH-ACCOUNT-PARTNER-PAYABLE',
          component: 'PARTNER_OUTBOUND',
          debit: 0,
          credit: partnerPayable,
          partner_user_id: input.partner_user_id,
          source_order_reference: sourceOrder,
        });
      if (platform > 0)
        entries.push({
          account: 'SYNTH-ACCOUNT-PLATFORM-REVENUE',
          component: 'PLATFORM_REMAINDER',
          debit: 0,
          credit: platform,
          source_order_reference: sourceOrder,
          vendor_location_id: input.vendor_location_id,
        });
      if (platform < 0)
        entries.push({
          account: 'SYNTH-ACCOUNT-PLATFORM-SUBSIDY',
          component: 'PLATFORM_REMAINDER',
          debit: -platform,
          credit: 0,
          source_order_reference: sourceOrder,
          vendor_location_id: input.vendor_location_id,
        });
      await this.#insertBalanced(client, {
        context: input.context,
        entries,
        kind: 'SETTLEMENT',
        now,
        policy,
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
      if (current.payout_state === 'PAID') {
        // Posted once per payout; a replay heals a payout paid before run 66
        // whose separate posting was lost.
        await this.#postPayoutLedger(client, input.context, current, now);
        return Object.freeze(current);
      }
      if (current.payout_state === 'SUBMITTED') return Object.freeze(current);
      if (current.payout_state !== 'SCHEDULED' || current.version !== input.expected_version)
        throw new MoneyStateError('Payout state or version does not permit submission');
      const outcome = await providerOutcome(() =>
        this.#provider.submitPayout({
          amount_minor: Number(current.amount_minor),
          operation_reference: current.provider_operation_reference,
          scenario: current.provider_scenario,
        }),
      );
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
      const paid = Object.freeze(updated.rows[0]);
      if (paid.payout_state === 'PAID')
        await this.#postPayoutLedger(client, input.context, paid, now);
      return paid;
    });
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
      const reconciled = Object.freeze(updated.rows[0]);
      if (reconciled.payout_state === 'PAID')
        await this.#postPayoutLedger(client, input.context, reconciled, now);
      return reconciled;
    });
    return payout;
  }

  /**
   * Proposes a refund against one child order of a captured payment (10.2).
   *
   * The refund is bounded twice: by what the payment captured and by what
   * the order itself was charged, both net of every refund not yet failed —
   * a pending proposal reserves its amount, so two cannot both pass the cap
   * and both succeed. When `lines` are given they are the exact order lines
   * being returned and must sum to the item amount; the schema holds them
   * to it. The platform may propose (a cancellation after capture files its
   * own refund); a person must still approve, and a person's proposal
   * expires in fifteen minutes while the platform's waits three days for
   * someone to be at the desk.
   */
  async proposeRefund(input: {
    readonly command_reference: string;
    readonly context: RequestContext;
    readonly delivery_minor: number;
    readonly discount_reversal_minor: number;
    readonly item_minor: number;
    readonly lines?: readonly {
      readonly vendor_order_line_id: UuidV7;
      readonly quantity: number;
      readonly amount_minor: number;
    }[];
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
    const proposer = financeAutomation(input.context);
    const who = proposer.id;
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    const command = text(input.command_reference, COMMAND, 'Command reference');
    const total =
      minor(input.item_minor, 'Item refund') +
      minor(input.tax_minor, 'Tax refund') +
      minor(input.delivery_minor, 'Delivery refund') +
      minor(input.tip_minor, 'Tip refund') -
      minor(input.discount_reversal_minor, 'Discount reversal');
    minor(total, 'Refund total', 1);
    const lines = input.lines ?? [];
    if (lines.length > 0) {
      const lined = lines.reduce(
        (sum, line) => sum + minor(line.amount_minor, 'Line refund', 1),
        0,
      );
      if (lined !== input.item_minor)
        throw new MoneyInputError('Refund lines must sum to the item amount');
      if (lines.some((line) => !Number.isSafeInteger(line.quantity) || line.quantity < 1))
        throw new MoneyInputError('Refund line quantity must be a positive integer');
      if (new Set(lines.map((line) => line.vendor_order_line_id)).size !== lines.length)
        throw new MoneyInputError('A refund names each line once');
    }
    const sourceOrder = text(input.source_order_reference, ORDER, 'Order reference');
    return tx(this.#pool, async (client) => {
      const replay = await client.query(
        `SELECT refund.*, refund.refund_total_minor::bigint AS refund_total_minor
           FROM marketplace.refund_events event
           JOIN marketplace.refunds refund USING (refund_id)
          WHERE event.command_reference=$1`,
        [command],
      );
      if (replay.rows[0])
        return Object.freeze({
          ...replay.rows[0],
          refund_total_minor: Number(replay.rows[0].refund_total_minor),
        });
      const payment = await client.query<{ amount_minor: string; payment_state: string }>(
        'SELECT amount_minor,payment_state FROM marketplace.payment_transactions WHERE payment_transaction_id=$1 FOR UPDATE',
        [input.payment_transaction_id],
      );
      if (!payment.rows[0] || payment.rows[0].payment_state !== 'CAPTURED') {
        throw new MoneyStateError('Refund requires a captured payment');
      }
      const previous = await client.query<{ order_total: string; total: string }>(
        `SELECT COALESCE(sum(refund_total_minor),0)::text AS total,
                COALESCE(sum(refund_total_minor) FILTER (WHERE source_order_reference=$2),0)::text
                  AS order_total
           FROM marketplace.refunds
          WHERE payment_transaction_id=$1
            AND refund_state IN ('PENDING_APPROVAL','SUBMITTED','SUCCEEDED','FAILED_REVIEW')`,
        [input.payment_transaction_id, sourceOrder],
      );
      if (Number(previous.rows[0]?.total ?? 0) + total > Number(payment.rows[0].amount_minor)) {
        throw new MoneyInputError('Refund exceeds the remaining captured amount');
      }
      // The order's own allocation is the ceiling for a refund against it.
      // An order the payment does not allocate to (the money verifier's
      // synthetic references) is bounded by the payment alone.
      const allocation = await client.query<{ allocated_total_minor: string }>(
        `SELECT allocated_total_minor::text FROM marketplace.payment_allocations
          WHERE payment_transaction_id=$1 AND source_order_reference=$2`,
        [input.payment_transaction_id, sourceOrder],
      );
      const allocated = allocation.rows[0]
        ? Number(allocation.rows[0].allocated_total_minor)
        : null;
      if (allocated !== null && Number(previous.rows[0]?.order_total ?? 0) + total > allocated) {
        throw new MoneyInputError('Refund exceeds what this order was charged');
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
          sourceOrder,
          text(input.provider_operation_reference, OPERATION, 'Refund operation'),
          input.trigger_code,
          input.item_minor,
          input.tax_minor,
          input.delivery_minor,
          input.tip_minor,
          input.discount_reversal_minor,
          who,
          new Date(now.getTime() + (proposer.kind === 'system' ? 259_200_000 : 900_000)),
          input.provider_scenario,
          ids.request,
          ids.correlation,
          now,
        ],
      );
      for (const line of lines)
        await client.query(
          `INSERT INTO marketplace.refund_lines
            (refund_line_id,refund_id,vendor_order_line_id,quantity,amount_minor,created_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            createUuidV7(),
            refundId,
            line.vendor_order_line_id,
            line.quantity,
            line.amount_minor,
            now,
          ],
        );
      await client.query(
        `INSERT INTO marketplace.refund_events
          (refund_event_id,refund_id,refund_version,event_type,resulting_state,actor_id,reason_code,
           command_reference,request_id,correlation_id,occurred_at)
         VALUES ($1,$2,1,'REFUND_PROPOSED','PENDING_APPROVAL',$3,'REFUND_PROPOSED',$4,$5,$6,$7)`,
        [createUuidV7(), refundId, who, command, ids.request, ids.correlation, now],
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
    const command = text(input.command_reference, COMMAND, 'Command reference');
    const approved = await tx(this.#pool, async (client) => {
      const result = await client.query(
        'SELECT * FROM marketplace.refunds WHERE refund_id=$1 FOR UPDATE',
        [input.refund_id],
      );
      const refund = result.rows[0];
      if (!refund) throw new MoneyNotFoundError('Refund not found');
      // The same approval again is its outcome again, not a stale error and
      // not a second instruction to the provider.
      const replay = await client.query(
        `SELECT 1 FROM marketplace.refund_events WHERE refund_id=$1 AND command_reference=$2`,
        [input.refund_id, command],
      );
      if (replay.rows[0]) return Object.freeze(refund);
      if (
        refund.refund_state !== 'PENDING_APPROVAL' ||
        refund.version !== input.expected_version ||
        refund.approval_expires_at <= now ||
        refund.proposed_by_user_id === who
      ) {
        throw new MoneyStateError('Refund approval is stale, expired, or self-approved');
      }
      const outcome = await providerOutcome(() =>
        this.#provider.refund({
          amount_minor: Number(refund.refund_total_minor),
          operation_reference: refund.provider_operation_reference,
          scenario: refund.provider_scenario,
        }),
      );
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
      const settled = Object.freeze(updated.rows[0]);
      // The refund and its posting commit together (10.1), like the capture.
      if (settled.refund_state === 'SUCCEEDED')
        await this.#postRefundLedger(client, input.context, settled, now);
      return settled;
    });
    return approved;
  }

  async #postRefundLedger(
    client: PoolClient,
    context: RequestContext,
    refund: Record<string, unknown>,
    now: Date,
  ) {
    const amount = Number(refund.refund_total_minor);
    await this.#insertBalanced(client, {
      context,
      entries: [
        {
          account: 'SYNTH-ACCOUNT-PLATFORM-CLEARING',
          component: 'CUSTOMER_REFUND',
          credit: 0,
          debit: amount,
          source_order_reference: String(refund.source_order_reference),
        },
        {
          account: 'SYNTH-ACCOUNT-CUSTOMER-CLEARING',
          component: 'CUSTOMER_REFUND',
          credit: amount,
          debit: 0,
          source_order_reference: String(refund.source_order_reference),
        },
      ],
      kind: 'REFUND',
      now,
      provider: String(refund.provider_operation_reference),
      source: `SYNTH-REFUND-${String(refund.refund_id).toUpperCase()}`,
    });
  }

  /**
   * The provider's answer for a capture it did not answer at the time (10.2).
   *
   * A capture the provider left UNKNOWN parked the payment in
   * UNKNOWN_REQUIRES_RECONCILIATION with an exception whose next action
   * nothing performed: the order went on to be delivered against money
   * nobody knew had moved, and its settlement never ran. The answer — read
   * off the provider's statement by a person, or asked of the provider by
   * the sweep — is applied here: "succeeded" is the capture, posted in the
   * same transaction; "failed" leaves the authorisation standing so the
   * capture can be attempted again; "unknown" changes nothing. An
   * authorisation the provider did not answer is the checkout's to settle,
   * on its own deadline, and is refused here.
   */
  async reconcilePayment(input: {
    readonly context: RequestContext;
    readonly evidence_reference: string;
    readonly payment_transaction_id: UuidV7;
    readonly provider_state: 'FAILED' | 'SUCCEEDED' | 'UNKNOWN';
    readonly now?: Date;
  }): Promise<PaymentRecord> {
    const who = financeAutomation(input.context);
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    const evidence = text(input.evidence_reference, COMMAND, 'Evidence reference');
    return tx(this.#pool, async (client) => {
      const locked = await client.query(
        'SELECT * FROM marketplace.payment_transactions WHERE payment_transaction_id=$1 FOR UPDATE',
        [input.payment_transaction_id],
      );
      const payment = locked.rows[0];
      if (!payment) throw new MoneyNotFoundError('Payment not found');
      if (payment.payment_state !== 'UNKNOWN_REQUIRES_RECONCILIATION') {
        // Answered already: the same answer again is a receipt, a different
        // one is a conflict for a person, and neither moves anything here.
        if (
          (payment.payment_state === 'CAPTURED' && input.provider_state === 'SUCCEEDED') ||
          (payment.payment_state === 'AUTHORIZED' && input.provider_state === 'FAILED')
        )
          return record(payment);
        throw new MoneyStateError('Payment is not awaiting reconciliation');
      }
      const unanswered = await client.query<{ event_type: string }>(
        `SELECT event_type FROM marketplace.payment_events
          WHERE payment_transaction_id=$1 AND provider_result='UNKNOWN'
          ORDER BY payment_version DESC LIMIT 1`,
        [input.payment_transaction_id],
      );
      if (unanswered.rows[0]?.event_type !== 'PAYMENT_CAPTURED')
        throw new MoneyStateError('An unanswered authorization is reconciled by the checkout');
      if (input.provider_state === 'UNKNOWN') return record(payment);
      const next = input.provider_state === 'SUCCEEDED' ? 'CAPTURED' : 'AUTHORIZED';
      const updated = await client.query(
        `UPDATE marketplace.payment_transactions
            SET payment_state=$2,version=version+1,updated_at=$3
          WHERE payment_transaction_id=$1 RETURNING *`,
        [input.payment_transaction_id, next, now],
      );
      await client.query(
        `INSERT INTO marketplace.payment_events
          (payment_event_id,payment_transaction_id,payment_version,event_type,previous_state,resulting_state,
           provider_result,command_reference,actor_id,actor_kind,reason_code,request_id,correlation_id,occurred_at)
         VALUES ($1,$2,$3,'PAYMENT_CAPTURE_RECONCILED','UNKNOWN_REQUIRES_RECONCILIATION',$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          createUuidV7(),
          input.payment_transaction_id,
          payment.version + 1,
          next,
          input.provider_state,
          `SYNTH-CMD-RECONCILE-${String(input.payment_transaction_id).toUpperCase()}-${payment.version + 1}`,
          who.id,
          who.kind,
          `RECONCILED_${evidence.replaceAll(/[^A-Z0-9]/g, '_')}`.slice(0, 64),
          ids.request,
          ids.correlation,
          now,
        ],
      );
      await client.query(
        `UPDATE marketplace.finance_exceptions
            SET exception_state='RESOLVED',updated_at=$2
          WHERE operation_reference=$1 AND exception_state<>'RESOLVED'`,
        [payment.provider_operation_reference, now],
      );
      const settled = record(updated.rows[0]);
      return next === 'CAPTURED'
        ? this.#postCaptureLedger(client, input.context, settled, now)
        : settled;
    });
  }

  /**
   * The provider's answer for a refund it did not answer at the time (10.2),
   * the refund's counterpart of `reconcilePayment`: "succeeded" is the
   * refund, posted in the same transaction; "failed" makes it retryable.
   */
  async reconcileRefund(input: {
    readonly context: RequestContext;
    readonly evidence_reference: string;
    readonly provider_state: 'FAILED' | 'SUCCEEDED' | 'UNKNOWN';
    readonly refund_id: UuidV7;
    readonly now?: Date;
  }) {
    const who = financeAutomation(input.context);
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    const evidence = text(input.evidence_reference, COMMAND, 'Evidence reference');
    return tx(this.#pool, async (client) => {
      const locked = await client.query(
        'SELECT * FROM marketplace.refunds WHERE refund_id=$1 FOR UPDATE',
        [input.refund_id],
      );
      const refund = locked.rows[0];
      if (!refund) throw new MoneyNotFoundError('Refund not found');
      const open = await client.query(
        `SELECT 1 FROM marketplace.finance_exceptions
          WHERE operation_reference=$1 AND exception_kind='REFUND_UNKNOWN' AND exception_state<>'RESOLVED'`,
        [refund.provider_operation_reference],
      );
      if (refund.refund_state !== 'FAILED_REVIEW' || !open.rows[0]) {
        if (
          (refund.refund_state === 'SUCCEEDED' && input.provider_state === 'SUCCEEDED') ||
          (refund.refund_state === 'FAILED_RETRYABLE' && input.provider_state === 'FAILED')
        )
          return Object.freeze(refund);
        throw new MoneyStateError('Refund is not awaiting reconciliation');
      }
      if (input.provider_state === 'UNKNOWN') return Object.freeze(refund);
      const next = input.provider_state === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED_RETRYABLE';
      const updated = await client.query(
        `UPDATE marketplace.refunds SET refund_state=$2,version=version+1,updated_at=$3
          WHERE refund_id=$1 RETURNING *`,
        [input.refund_id, next, now],
      );
      await client.query(
        `INSERT INTO marketplace.refund_events
          (refund_event_id,refund_id,refund_version,event_type,previous_state,resulting_state,
           actor_id,reason_code,command_reference,request_id,correlation_id,occurred_at)
         VALUES ($1,$2,$3,'REFUND_RECONCILED','FAILED_REVIEW',$4,$5,$6,$7,$8,$9,$10)`,
        [
          createUuidV7(),
          input.refund_id,
          refund.version + 1,
          next,
          who.id,
          `RECONCILED_${evidence.replaceAll(/[^A-Z0-9]/g, '_')}`.slice(0, 64),
          `SYNTH-CMD-RECONCILE-${String(input.refund_id).toUpperCase()}-${refund.version + 1}`,
          ids.request,
          ids.correlation,
          now,
        ],
      );
      await client.query(
        `UPDATE marketplace.finance_exceptions
            SET exception_state='RESOLVED',updated_at=$2
          WHERE operation_reference=$1 AND exception_state<>'RESOLVED'`,
        [refund.provider_operation_reference, now],
      );
      const settled = Object.freeze(updated.rows[0]);
      if (next === 'SUCCEEDED') await this.#postRefundLedger(client, input.context, settled, now);
      return settled;
    });
  }

  /**
   * Asks the provider about every capture and refund it left unanswered
   * (10.2), and applies what it says. Runs on the operations worker's pass;
   * an answer that is still "unknown" waits for the next pass or for the
   * provider's statement (10.5). Only operations older than a minute are
   * asked, so a call still in flight is not second-guessed.
   */
  async reconcileUnknownOperations(input: {
    readonly context: RequestContext;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const before = new Date(now.getTime() - 60_000);
    const answer = async (reference: string) => {
      const outcome = await providerOutcome(async () => {
        const status = await this.#provider.status(reference);
        return status ?? 'UNKNOWN';
      });
      return outcome === 'SUCCEEDED' ? 'SUCCEEDED' : outcome === 'DECLINED' ? 'FAILED' : 'UNKNOWN';
    };
    const payments = await this.#pool.query<{
      payment_transaction_id: string;
      provider_operation_reference: string;
    }>(
      `SELECT payment.payment_transaction_id, payment.provider_operation_reference
         FROM marketplace.payment_transactions payment
        WHERE payment.payment_state='UNKNOWN_REQUIRES_RECONCILIATION' AND payment.updated_at<=$1
          AND (SELECT event_type FROM marketplace.payment_events event
                WHERE event.payment_transaction_id=payment.payment_transaction_id
                  AND event.provider_result='UNKNOWN'
                ORDER BY event.payment_version DESC LIMIT 1)='PAYMENT_CAPTURED'
        ORDER BY payment.updated_at LIMIT 100`,
      [before],
    );
    let settledPayments = 0;
    for (const payment of payments.rows) {
      const state = await answer(payment.provider_operation_reference);
      if (state === 'UNKNOWN') continue;
      await this.reconcilePayment({
        context: input.context,
        evidence_reference: 'PROVIDER-STATUS',
        now,
        payment_transaction_id: parseUuidV7(payment.payment_transaction_id),
        provider_state: state,
      });
      settledPayments += 1;
    }
    const refunds = await this.#pool.query<{
      refund_id: string;
      provider_operation_reference: string;
    }>(
      `SELECT refund.refund_id, refund.provider_operation_reference
         FROM marketplace.refunds refund
        WHERE refund.refund_state='FAILED_REVIEW' AND refund.updated_at<=$1
          AND EXISTS (SELECT 1 FROM marketplace.finance_exceptions exception
                       WHERE exception.operation_reference=refund.provider_operation_reference
                         AND exception.exception_kind='REFUND_UNKNOWN'
                         AND exception.exception_state<>'RESOLVED')
        ORDER BY refund.updated_at LIMIT 100`,
      [before],
    );
    let settledRefunds = 0;
    for (const refund of refunds.rows) {
      const state = await answer(refund.provider_operation_reference);
      if (state === 'UNKNOWN') continue;
      await this.reconcileRefund({
        context: input.context,
        evidence_reference: 'PROVIDER-STATUS',
        now,
        provider_state: state,
        refund_id: parseUuidV7(refund.refund_id),
      });
      settledRefunds += 1;
    }
    return { payments: settledPayments, refunds: settledRefunds };
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
    /**
     * Runs inside the same transaction once the provider has said yes, so
     * whatever it records (the capture's ledger posting) commits with the
     * state or not at all. A replay of a successful command runs it too:
     * it is idempotent, and that heals a record whose posting was made
     * separately before run 66 and lost.
     */
    onSucceeded?: (client: PoolClient, payment: PaymentRecord) => Promise<PaymentRecord>,
  ): Promise<PaymentRecord> {
    const who = financeAutomation(input.context);
    const command = text(input.command_reference, COMMAND, 'Command reference');
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    const successState = expected === 'CREATED' ? 'AUTHORIZED' : 'CAPTURED';
    return tx(this.#pool, async (client) => {
      const replay = await client.query(
        `SELECT payment.* FROM marketplace.payment_events event JOIN marketplace.payment_transactions payment USING (payment_transaction_id) WHERE event.command_reference=$1`,
        [command],
      );
      if (replay.rows[0]) {
        const replayed = record(replay.rows[0]);
        return onSucceeded && replayed.payment_state === successState
          ? onSucceeded(client, replayed)
          : replayed;
      }
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
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          createUuidV7(),
          input.payment_transaction_id,
          input.expected_version + 1,
          `${eventType}_STARTED`,
          expected,
          inFlightState,
          `${command}-START`,
          who.id,
          who.kind,
          `${eventType}_STARTED`,
          ids.request,
          ids.correlation,
          now,
        ],
      );
      // A provider that throws -- malformed answer, timeout, dropped
      // connection -- used to escape here, rolling back the in-flight record
      // and telling the caller nothing, though the money may have moved. It
      // is UNKNOWN, with the exception below, like every other no-answer.
      const instruction = {
        amount_minor: Number(payment.amount_minor),
        operation_reference: payment.provider_operation_reference,
        scenario: payment.provider_scenario,
      };
      const outcome = await providerOutcome(() =>
        expected === 'CREATED'
          ? this.#provider.authorize(instruction)
          : this.#provider.capture(instruction),
      );
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
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          createUuidV7(),
          input.payment_transaction_id,
          input.expected_version + 2,
          eventType,
          inFlightState,
          next,
          outcome,
          command,
          who.id,
          who.kind,
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
      const settled = record(updated.rows[0]);
      return onSucceeded && next === successState ? onSucceeded(client, settled) : settled;
    });
  }

  /**
   * A paid payout's posting, in the transaction that marked it paid: the
   * payable it clears names the beneficiary and the order it settles, and
   * the settlement's own state is refreshed in the same breath.
   */
  async #postPayoutLedger(
    client: PoolClient,
    context: RequestContext,
    payout: Record<string, unknown>,
    now: Date,
  ) {
    const amount = Number(payout.amount_minor);
    const settlement = await client.query<{
      partner_user_id: string | null;
      source_order_reference: string;
      vendor_location_id: string;
    }>(
      `SELECT source_order_reference, vendor_location_id, partner_user_id
         FROM marketplace.settlements WHERE settlement_id=$1`,
      [payout.settlement_id],
    );
    const owner = settlement.rows[0];
    if (!owner) throw new MoneyNotFoundError('Payout settlement not found');
    const vendorPayout = payout.beneficiary_kind === 'VENDOR';
    if (!vendorPayout && !owner.partner_user_id)
      throw new MoneyStateError('A partner payout must clear a settlement that names the partner');
    await this.#insertBalanced(client, {
      context,
      entries: [
        {
          account: vendorPayout ? 'SYNTH-ACCOUNT-VENDOR-PAYABLE' : 'SYNTH-ACCOUNT-PARTNER-PAYABLE',
          component: 'PAYOUT',
          debit: amount,
          credit: 0,
          source_order_reference: owner.source_order_reference,
          ...(vendorPayout
            ? { vendor_location_id: owner.vendor_location_id }
            : { partner_user_id: owner.partner_user_id ?? undefined }),
        },
        {
          account: this.#provider.clearingAccountReference(),
          component: 'PAYOUT',
          debit: 0,
          credit: amount,
          source_order_reference: owner.source_order_reference,
        },
      ],
      kind: 'PAYOUT',
      now,
      provider: String(payout.provider_operation_reference),
      source: `SYNTH-PAYOUT-${String(payout.payout_id).toUpperCase()}`,
    });
    await this.#refreshSettlementState(client, String(payout.settlement_id), now);
  }

  async #refreshSettlementState(client: PoolClient, settlementId: string, now: Date) {
    await client.query(
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

  /**
   * The posting engine (10.1). One transaction, its entries, the references
   * it was made under — business (the source), provider operation, policy
   * version, request and correlation — and on each entry the vendor, partner
   * and order the amount belongs to. Balanced in code before a row is
   * written and again by the schema at commit; posted once per source.
   */
  async #insertBalanced(
    client: PoolClient,
    input: {
      readonly context: RequestContext;
      readonly entries: readonly LedgerEntryInput[];
      readonly kind: string;
      readonly now: Date;
      readonly policy?: string | undefined;
      readonly provider?: string | undefined;
      readonly source: string;
    },
  ) {
    const debit = input.entries.reduce((sum, entry) => sum + minor(entry.debit, 'Debit'), 0);
    const credit = input.entries.reduce((sum, entry) => sum + minor(entry.credit, 'Credit'), 0);
    if (debit !== credit || debit <= 0)
      throw new MoneyInputError('Ledger transaction is unbalanced');
    if (input.entries.some((entry) => entry.debit > 0 === entry.credit > 0))
      throw new MoneyInputError('Every ledger entry must use exactly one side');
    const ids = contextIds(input.context);
    const existing = await client.query(
      'SELECT 1 FROM marketplace.ledger_transactions WHERE source_reference=$1',
      [input.source],
    );
    if (existing.rows[0]) return;
    const ledgerId = createUuidV7();
    await client.query(
      `INSERT INTO marketplace.ledger_transactions
        (ledger_transaction_id,source_reference,transaction_kind,posted_at,request_id,correlation_id,
         provider_operation_reference,policy_version_reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        ledgerId,
        input.source,
        input.kind,
        input.now,
        ids.request,
        ids.correlation,
        input.provider ?? null,
        input.policy ?? null,
      ],
    );
    for (const entry of input.entries)
      await client.query(
        `INSERT INTO marketplace.ledger_entries
          (ledger_entry_id,ledger_transaction_id,account_reference,component,debit_minor,credit_minor,
           vendor_location_id,partner_user_id,source_order_reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          createUuidV7(),
          ledgerId,
          entry.account,
          entry.component,
          entry.debit,
          entry.credit,
          entry.vendor_location_id ?? null,
          entry.partner_user_id ?? null,
          entry.source_order_reference ?? null,
        ],
      );
  }
}

/** One side of a posting, and whose money it is. */
interface LedgerEntryInput {
  readonly account: string;
  readonly component: string;
  readonly credit: number;
  readonly debit: number;
  readonly partner_user_id?: string | undefined;
  readonly source_order_reference?: string | undefined;
  readonly vendor_location_id?: string | undefined;
}
