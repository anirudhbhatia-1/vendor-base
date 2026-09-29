import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import type { Pool, PoolClient } from 'pg';
import { globalAdminCapabilities } from './admin-capabilities.js';
import { releaseServicePool, resolveServicePool } from './database-pool.js';
import { auditMoneyConservation, type ConservationBreach } from './money-conservation.js';
import type { MoneyLifecycleService } from './money-lifecycle.js';
import { transaction as tx } from './transaction.js';

export class FinanceQueueInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}
export class FinanceQueueNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';
}
export class FinanceQueueStateError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
}
export class FinanceQueueAuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
}

/** The eleven owned queues (11.5), in the order the console lists them. */
export const FINANCE_QUEUES = Object.freeze([
  {
    key: 'AUTHORIZATION_WITHOUT_CHECKOUT',
    owner: 'FINANCE_OPERATIONS',
    title: 'Authorisation without checkout',
  },
  { key: 'PAYMENT_UNKNOWN', owner: 'FINANCE_OPERATIONS', title: 'Payment outcome unknown' },
  {
    key: 'CAPTURE_ALLOCATION_MISMATCH',
    owner: 'FINANCE_OPERATIONS',
    title: 'Capture and allocation mismatch',
  },
  {
    key: 'WEBHOOK_DUPLICATION',
    owner: 'FINANCE_RECONCILIATION',
    title: 'Webhook duplication or conflict',
  },
  { key: 'REFUND_FAILURE', owner: 'FINANCE_OPERATIONS', title: 'Refund failure' },
  { key: 'LEDGER_UNBALANCED', owner: 'FINANCE_RECONCILIATION', title: 'Unbalanced ledger' },
  {
    key: 'VENDOR_SETTLEMENT_MISMATCH',
    owner: 'FINANCE_OPERATIONS',
    title: 'Vendor settlement mismatch',
  },
  {
    key: 'PARTNER_EARNING_MISMATCH',
    owner: 'FINANCE_OPERATIONS',
    title: 'Partner earning mismatch',
  },
  { key: 'PAYOUT_FAILURE', owner: 'FINANCE_OPERATIONS', title: 'Payout failure or duplicate risk' },
  { key: 'STATEMENT_UNMATCHED', owner: 'FINANCE_RECONCILIATION', title: 'Statement unmatched' },
  { key: 'DISPUTE', owner: 'FINANCE_OPERATIONS', title: 'Disputes' },
] as const);
export type FinanceQueueKey = (typeof FINANCE_QUEUES)[number]['key'];

export const FINANCE_RESOLUTIONS = Object.freeze([
  'PROVIDER_CONFIRMED',
  'CORRECTED',
  'NO_MONEY_MOVED',
  'DUPLICATE',
  'WRITTEN_OFF',
] as const);

export const FINANCE_ACTIONS = Object.freeze([
  'ASSIGN',
  'NOTE',
  'EVIDENCE',
  'RECONCILE',
  'LINK_CORRECTION',
  'RESOLVE',
  'PROPOSE_WRITE_OFF',
  'APPROVE_WRITE_OFF',
  'REOPEN',
] as const);
export type FinanceAction = (typeof FINANCE_ACTIONS)[number];

/**
 * What a person can reconcile with the provider's answer, and what it names.
 * An unanswered authorisation is the checkout's to settle (its answer is a
 * signed webhook); only an unanswered capture, refund or payout is reconciled
 * by hand.
 */
function reconcilable(kind: string, nextAction: string): 'PAYMENT' | 'REFUND' | 'PAYOUT' | null {
  if (kind === 'PAYMENT_UNKNOWN' && nextAction === 'RECONCILE_SAME_OPERATION') return 'PAYMENT';
  if (kind === 'REFUND_UNKNOWN') return 'REFUND';
  if (kind === 'PAYOUT_UNKNOWN') return 'PAYOUT';
  return null;
}

/** How serious an exception is (D-09), the same rule the dashboard ranks by. */
export function financeRisk(kind: string, amountMinor: number): 'CRITICAL' | 'HIGH' | 'MEDIUM' {
  if (['LEDGER_UNBALANCED', 'PAYOUT_DUPLICATE_RISK'].includes(kind)) return 'CRITICAL';
  if (
    [
      'PAYMENT_UNKNOWN',
      'REFUND_UNKNOWN',
      'PAYOUT_UNKNOWN',
      'PAYOUT_FAILED',
      'POSTING_FAILED',
      'CAPTURE_ALLOCATION_MISMATCH',
      'WEBHOOK_CONFLICT',
      'PARTNER_EARNING_MISMATCH',
    ].includes(kind) ||
    amountMinor >= 100_000
  )
    return 'HIGH';
  return 'MEDIUM';
}

/** What can be done to an exception in its state; the server's answer, shown as-is. */
export function financeActionsFor(row: {
  readonly exception_state: string;
  readonly exception_kind: string;
  readonly next_action_code: string;
  readonly write_off_proposed: boolean;
}): readonly FinanceAction[] {
  if (row.exception_state === 'RESOLVED') return ['NOTE', 'REOPEN'];
  const actions: FinanceAction[] = ['ASSIGN', 'NOTE', 'EVIDENCE', 'LINK_CORRECTION', 'RESOLVE'];
  if (reconcilable(row.exception_kind, row.next_action_code)) actions.push('RECONCILE');
  actions.push(row.write_off_proposed ? 'APPROVE_WRITE_OFF' : 'PROPOSE_WRITE_OFF');
  return actions;
}

/** Which queue a conservation breach belongs in, and its kind there. */
const BREACH_KIND: Readonly<Record<ConservationBreach['invariant'], string>> = Object.freeze({
  TRIAL_BALANCE: 'LEDGER_UNBALANCED',
  CUSTOMER_CLEARING: 'LEDGER_UNBALANCED',
  PROVIDER_CLEARING: 'LEDGER_UNBALANCED',
  HISTORY_EDITABLE: 'LEDGER_UNBALANCED',
  VENDOR_PAYABLE: 'SETTLEMENT_MISMATCH',
  PARTNER_PAYABLE: 'PARTNER_EARNING_MISMATCH',
  STATEMENT_UNROUTED: 'STATEMENT_UNMATCHED',
});

const LEDGER = 'admin.finance.ledger_manage';
const APPROVE = 'admin.finance.refund_approve';
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;
const EVIDENCE = /^SYNTH-EVIDENCE-[A-Z0-9-]{4,64}$/;

type QueueRow = ExceptionRow & {
  derived_expected: string | null;
  derived_actual: string | null;
  derived_business: string | null;
  provider_state: string | null;
  correction_state: string | null;
  correction_second_approval: boolean | null;
  evidence_count: string;
  history_count: string;
  write_off_proposed: boolean;
};

type ExceptionRow = {
  finance_exception_id: string;
  exception_kind: string;
  queue: FinanceQueueKey;
  operation_reference: string;
  amount_at_risk_minor: string;
  exception_state: 'OPEN' | 'ASSIGNED' | 'RESOLVED';
  owner_reference: string;
  next_action_code: string;
  expected_minor: string | null;
  actual_minor: string | null;
  business_reference: string | null;
  assigned_to_user_id: string | null;
  attempts: number;
  last_retry_at: Date | null;
  financial_correction_id: string | null;
  resolution_code: string | null;
  resolved_by_user_id: string | null;
  resolved_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
};

/**
 * The finance queues (11.5).
 *
 * Every exception is in one of eleven owned queues -- disputes are read from
 * their own tables -- and each row carries what was expected and what
 * happened (from the exception or the payment, refund or payout it names),
 * the provider and business references, the risk, its age, the last retry,
 * the next safe action, the correction proposed for it and whether that was
 * approved, the evidence attached and its history. A person assigns it,
 * notes and evidences it, reconciles it with the provider's answer where the
 * operation is unknown, links a correction, resolves it with a reason -- a
 * correction only once posted -- or proposes a write-off that someone else
 * approves. Conservation breaches the ledger audit finds are queued, and
 * closed when they clear. Every change is on the exception's history and
 * the operational audit.
 */
export class FinanceQueueService {
  readonly #pool: Pool;
  readonly #money: MoneyLifecycleService;

  constructor(input: {
    readonly connection_string: string;
    readonly pool?: Pool;
    readonly money: MoneyLifecycleService;
  }) {
    this.#pool = resolveServicePool(input, {
      application_name: 'neighbourhood-store-finance-queues',
      max: 4,
    });
    this.#money = input.money;
  }

  async close() {
    await releaseServicePool(this.#pool);
  }

  /** The queues with their counts, and the rows of one queue or of all. */
  async queues(input: {
    readonly context: RequestContext;
    readonly queue?: string;
    readonly include_resolved?: boolean;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    await this.#require(this.#pool, input.context, now, LEDGER);
    if (input.queue !== undefined && !FINANCE_QUEUES.some((entry) => entry.key === input.queue)) {
      throw new FinanceQueueInputError(
        `Queue must be one of ${FINANCE_QUEUES.map((q) => q.key).join(', ')}`,
      );
    }
    const counts = await this.#pool.query<{
      queue: string;
      open: string;
      at_risk: string;
      oldest: Date | null;
    }>(
      `SELECT queue, count(*)::text AS open, COALESCE(sum(amount_at_risk_minor), 0)::text AS at_risk,
              min(created_at) AS oldest
         FROM marketplace.finance_exceptions WHERE exception_state <> 'RESOLVED'
        GROUP BY queue`,
    );
    const disputes = await this.#disputes(this.#pool, false);
    const byQueue = new Map(counts.rows.map((row) => [row.queue, row]));
    const summary = FINANCE_QUEUES.map((entry) => {
      if (entry.key === 'DISPUTE') {
        const oldest = disputes.reduce<Date | null>(
          (min, dispute) => (!min || dispute.created_at < min ? dispute.created_at : min),
          null,
        );
        return {
          ...entry,
          open: disputes.length,
          at_risk_minor: disputes.reduce((sum, dispute) => sum + dispute.at_risk_minor, 0),
          oldest_age_seconds: oldest ? Math.floor((now.getTime() - oldest.getTime()) / 1000) : null,
        };
      }
      const row = byQueue.get(entry.key);
      return {
        ...entry,
        open: Number(row?.open ?? 0),
        at_risk_minor: Number(row?.at_risk ?? 0),
        oldest_age_seconds: row?.oldest
          ? Math.floor((now.getTime() - row.oldest.getTime()) / 1000)
          : null,
      };
    });
    const rows =
      input.queue === 'DISPUTE'
        ? []
        : await this.#rows(this.#pool, {
            queue: input.queue ?? null,
            include_resolved: input.include_resolved === true,
            id: null,
          });
    return {
      summary,
      rows: rows.map((row) => this.#shape(row, now)),
      disputes:
        input.queue === undefined || input.queue === 'DISPUTE'
          ? disputes.map((dispute) => ({
              ...dispute,
              age_seconds: Math.floor((now.getTime() - dispute.created_at.getTime()) / 1000),
              created_at: dispute.created_at.toISOString(),
              deadline_at: dispute.deadline_at.toISOString(),
            }))
          : [],
    };
  }

  /** One exception with its full history. The look is audited. */
  async detail(input: {
    readonly context: RequestContext;
    readonly finance_exception_id: UuidV7;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const actor = await this.#require(this.#pool, input.context, now, LEDGER);
    const [row] = await this.#rows(this.#pool, {
      queue: null,
      include_resolved: true,
      id: input.finance_exception_id,
    });
    if (!row) throw new FinanceQueueNotFoundError();
    const history = await this.#pool.query<{
      event_type: string;
      actor_id: string;
      reason_code: string;
      payload: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `SELECT event_type, actor_id, reason_code, payload, occurred_at
         FROM marketplace.finance_exception_events WHERE finance_exception_id = $1
        ORDER BY occurred_at, finance_exception_event_id`,
      [input.finance_exception_id],
    );
    await this.#audit(this.#pool, input.context, actor, {
      action: 'FINANCE_EXCEPTION_VIEWED',
      id: input.finance_exception_id,
      reason_code: 'OPERATOR_VIEW',
      before: null,
      after: null,
    });
    return {
      ...this.#shape(row, now),
      history: history.rows.map((event) => ({
        ...event,
        occurred_at: event.occurred_at.toISOString(),
      })),
    };
  }

  /**
   * One step on an exception, against the version read, with a reason.
   */
  async act(input: {
    readonly context: RequestContext;
    readonly finance_exception_id: UuidV7;
    readonly action: string;
    readonly expected_version: number;
    readonly reason_code: string;
    readonly note?: string;
    readonly evidence_reference?: string;
    readonly assignee_user_id?: UuidV7;
    readonly financial_correction_id?: UuidV7;
    readonly resolution_code?: string;
    readonly duplicate_of?: UuidV7;
    readonly provider_state?: 'FAILED' | 'SUCCEEDED' | 'UNKNOWN';
    readonly statement_amount_minor?: number;
    readonly now?: Date;
  }) {
    if (!(FINANCE_ACTIONS as readonly string[]).includes(input.action)) {
      throw new FinanceQueueInputError(`Action must be one of ${FINANCE_ACTIONS.join(', ')}`);
    }
    const action = input.action as FinanceAction;
    if (!REASON.test(input.reason_code)) {
      throw new FinanceQueueInputError('Reason code must be shouting-snake-case');
    }
    if (!Number.isSafeInteger(input.expected_version) || input.expected_version < 1) {
      throw new FinanceQueueInputError('Expected version must be a positive integer');
    }
    const now = input.now ?? new Date();
    // Reconciling runs the money service's own command, which moves money
    // in its own transaction; the exception is then read afresh.
    if (action === 'RECONCILE') return this.#reconcile(input, now);
    return tx(this.#pool, async (client) => {
      const actor = await this.#require(client, input.context, now, LEDGER);
      const row = await this.#lock(client, input.finance_exception_id, input.expected_version);
      const writeOffProposed = await this.#writeOffProposed(client, row);
      if (!financeActionsFor({ ...row, write_off_proposed: writeOffProposed }).includes(action)) {
        throw new FinanceQueueStateError(
          `${action.replaceAll('_', ' ').toLowerCase()} is not allowed on a ${row.exception_state.toLowerCase()} exception`,
        );
      }
      await this.#as(client, actor, input.reason_code);
      let patch: Record<string, unknown> = {};
      let event: { type: string; payload: Record<string, unknown> } | null = null;
      switch (action) {
        case 'ASSIGN': {
          const assignee = input.assignee_user_id ?? actor;
          const held = await globalAdminCapabilities(client, assignee, now);
          if (!held.has(LEDGER))
            throw new FinanceQueueInputError('That person cannot work finance exceptions');
          patch = { exception_state: 'ASSIGNED', assigned_to_user_id: assignee };
          break;
        }
        case 'NOTE': {
          const note = (input.note ?? '').trim();
          if (note.length < 1 || note.length > 1000) {
            throw new FinanceQueueInputError('A note is between 1 and 1000 characters');
          }
          event = { type: 'NOTE', payload: { note } };
          break;
        }
        case 'EVIDENCE': {
          if (!input.evidence_reference || !EVIDENCE.test(input.evidence_reference)) {
            throw new FinanceQueueInputError('Evidence is a SYNTH-EVIDENCE reference');
          }
          event = { type: 'EVIDENCE', payload: { evidence_reference: input.evidence_reference } };
          break;
        }
        case 'LINK_CORRECTION': {
          if (!input.financial_correction_id)
            throw new FinanceQueueInputError('Name the correction');
          const correction = await client.query<{ lifecycle_state: string }>(
            'SELECT lifecycle_state FROM marketplace.financial_corrections WHERE financial_correction_id = $1',
            [input.financial_correction_id],
          );
          const state = correction.rows[0]?.lifecycle_state;
          if (!state) throw new FinanceQueueNotFoundError('No such correction');
          if (state === 'REJECTED' || state === 'EXPIRED') {
            throw new FinanceQueueStateError(
              'A rejected or expired correction cannot answer an exception',
            );
          }
          patch = { financial_correction_id: input.financial_correction_id };
          event = {
            type: 'CORRECTION_LINKED',
            payload: { financial_correction_id: input.financial_correction_id, state },
          };
          break;
        }
        case 'RESOLVE': {
          const code = input.resolution_code;
          if (
            !code ||
            !(FINANCE_RESOLUTIONS as readonly string[]).includes(code) ||
            code === 'WRITTEN_OFF'
          ) {
            throw new FinanceQueueInputError(
              'Resolve as PROVIDER_CONFIRMED, CORRECTED, NO_MONEY_MOVED or DUPLICATE; a write-off is proposed and approved',
            );
          }
          if (code === 'CORRECTED') {
            const correction = await client.query<{ lifecycle_state: string }>(
              'SELECT lifecycle_state FROM marketplace.financial_corrections WHERE financial_correction_id = $1',
              [row.financial_correction_id],
            );
            if (correction.rows[0]?.lifecycle_state !== 'POSTED') {
              throw new FinanceQueueStateError(
                'Corrected means a linked correction that has been posted',
              );
            }
          }
          if (code === 'PROVIDER_CONFIRMED' && (await this.#stillUnknown(client, row))) {
            throw new FinanceQueueStateError(
              'The provider has not confirmed the operation; reconcile it first',
            );
          }
          if (code === 'DUPLICATE') {
            if (!input.duplicate_of || input.duplicate_of === row.finance_exception_id) {
              throw new FinanceQueueInputError('A duplicate names the exception it repeats');
            }
            const other = await client.query(
              `SELECT 1 FROM marketplace.finance_exceptions WHERE finance_exception_id = $1 AND queue = $2`,
              [input.duplicate_of, row.queue],
            );
            if (other.rows.length === 0) {
              throw new FinanceQueueNotFoundError(
                'The exception it repeats is not in the same queue',
              );
            }
          }
          patch = {
            exception_state: 'RESOLVED',
            resolution_code: code,
            resolved_by_user_id: actor,
            resolved_at: now,
          };
          break;
        }
        case 'PROPOSE_WRITE_OFF': {
          const note = (input.note ?? '').trim();
          if (note.length < 1)
            throw new FinanceQueueInputError('A write-off says why the money is not recovered');
          event = {
            type: 'WRITE_OFF_PROPOSED',
            payload: { note, amount_minor: Number(row.amount_at_risk_minor) },
          };
          break;
        }
        case 'APPROVE_WRITE_OFF': {
          const held = await globalAdminCapabilities(client, actor, now);
          if (!held.has(APPROVE)) throw new FinanceQueueAuthorizationError();
          const proposer = await client.query<{ actor_id: string }>(
            `SELECT actor_id FROM marketplace.finance_exception_events
              WHERE finance_exception_id = $1 AND event_type = 'WRITE_OFF_PROPOSED'
              ORDER BY occurred_at DESC LIMIT 1`,
            [row.finance_exception_id],
          );
          if (proposer.rows[0]?.actor_id === actor) {
            throw new FinanceQueueStateError(
              'A write-off is approved by someone who did not propose it',
            );
          }
          patch = {
            exception_state: 'RESOLVED',
            resolution_code: 'WRITTEN_OFF',
            resolved_by_user_id: actor,
            resolved_at: now,
          };
          break;
        }
        case 'REOPEN':
          patch = { exception_state: 'OPEN', assigned_to_user_id: null };
          break;
      }
      const updated = await this.#update(client, row, patch, now);
      if (event) {
        await client.query(
          `INSERT INTO marketplace.finance_exception_events
             (finance_exception_id, event_type, actor_id, reason_code, payload, occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            row.finance_exception_id,
            event.type,
            actor,
            input.reason_code,
            JSON.stringify(event.payload),
            now,
          ],
        );
      }
      await this.#audit(client, input.context, actor, {
        action: `FINANCE_EXCEPTION_${action}`,
        id: row.finance_exception_id,
        reason_code: input.reason_code,
        before: { exception_state: row.exception_state, version: row.version },
        after: {
          exception_state: updated.exception_state,
          version: updated.version,
          ...(event?.payload ?? {}),
        },
        approval_reference: action === 'APPROVE_WRITE_OFF' ? row.finance_exception_id : null,
      });
      return {
        finance_exception_id: row.finance_exception_id,
        action,
        exception_state: updated.exception_state,
        resolution_code: updated.resolution_code,
        version: updated.version,
      };
    });
  }

  /**
   * Opens an exception for each breach the ledger audit finds, in the queue
   * it belongs to, and closes the ones that have cleared (requirement 6).
   */
  async recordConservationBreaches(input: {
    readonly context: RequestContext;
    readonly now?: Date;
  }) {
    const kind = input.context.actor?.actor_kind;
    if (kind !== 'system' && kind !== 'admin') throw new FinanceQueueAuthorizationError();
    const now = input.now ?? new Date();
    const report = await auditMoneyConservation(this.#pool);
    return tx(this.#pool, async (client) => {
      await this.#as(client, input.context.actor?.actor_id as UuidV7, 'CONSERVATION_AUDIT');
      const references = report.breaches.map(
        (breach) => `CONSERVATION:${breach.invariant}:${breach.subject}`,
      );
      let opened = 0;
      for (const breach of report.breaches) {
        const reference = `CONSERVATION:${breach.invariant}:${breach.subject}`;
        const expected = breach.expected_minor ?? 0;
        const ledger = breach.ledger_minor ?? 0;
        const inserted = await client.query(
          `INSERT INTO marketplace.finance_exceptions
             (finance_exception_id, exception_kind, operation_reference, amount_at_risk_minor,
              expected_minor, actual_minor, business_reference, owner_reference, next_action_code,
              created_at, updated_at)
           SELECT $1,$2,$3,$4,$5,$6,$7,'FINANCE_RECONCILIATION','PROPOSE_CORRECTION',$8,$8
            WHERE NOT EXISTS (SELECT 1 FROM marketplace.finance_exceptions
                               WHERE operation_reference = $3 AND exception_state <> 'RESOLVED')`,
          [
            createUuidV7({ now_ms: now.getTime() }),
            BREACH_KIND[breach.invariant],
            reference,
            Math.abs(expected - ledger),
            Math.abs(expected),
            Math.abs(ledger),
            breach.subject,
            now,
          ],
        );
        opened += inserted.rowCount ?? 0;
      }
      await this.#as(client, input.context.actor?.actor_id as UuidV7, 'BREACH_CLEARED');
      const cleared = await client.query(
        `UPDATE marketplace.finance_exceptions
            SET exception_state = 'RESOLVED', resolution_code = 'BREACH_CLEARED', updated_at = $2
          WHERE operation_reference LIKE 'CONSERVATION:%' AND exception_state <> 'RESOLVED'
            AND NOT (operation_reference = ANY($1::text[]))`,
        [references, now],
      );
      return { breaches: report.breaches.length, opened, cleared: cleared.rowCount ?? 0 };
    });
  }

  // -----------------------------------------------------------------------

  async #reconcile(input: Parameters<FinanceQueueService['act']>[0], now: Date) {
    const actor = await this.#require(this.#pool, input.context, now, LEDGER);
    const found = await this.#rows(this.#pool, {
      queue: null,
      include_resolved: true,
      id: input.finance_exception_id,
    });
    const row = found[0];
    if (!row) throw new FinanceQueueNotFoundError();
    if (row.version !== input.expected_version) {
      throw new FinanceQueueStateError('The exception changed since it was read; reload it');
    }
    const target = reconcilable(row.exception_kind, row.next_action_code);
    if (!target || row.exception_state === 'RESOLVED') {
      throw new FinanceQueueStateError(
        'Only an open unanswered capture, refund or payout is reconciled here; an authorisation is settled by the checkout',
      );
    }
    if (!input.provider_state) throw new FinanceQueueInputError("Give the provider's answer");
    if (!input.evidence_reference || !EVIDENCE.test(input.evidence_reference)) {
      throw new FinanceQueueInputError('Evidence is a SYNTH-EVIDENCE reference');
    }
    const operation = await this.#pool.query<{ id: string; amount_minor: string }>(
      target === 'PAYMENT'
        ? 'SELECT payment_transaction_id AS id, amount_minor::text FROM marketplace.payment_transactions WHERE provider_operation_reference = $1'
        : target === 'REFUND'
          ? 'SELECT refund_id AS id, refund_total_minor::text AS amount_minor FROM marketplace.refunds WHERE provider_operation_reference = $1'
          : 'SELECT payout_id AS id, amount_minor::text FROM marketplace.payouts WHERE provider_operation_reference = $1',
      [row.operation_reference],
    );
    const found2 = operation.rows[0];
    if (!found2) throw new FinanceQueueNotFoundError('The operation it names is gone');
    if (target === 'PAYMENT')
      await this.#money.reconcilePayment({
        context: input.context,
        payment_transaction_id: found2.id as UuidV7,
        provider_state: input.provider_state,
        evidence_reference: input.evidence_reference,
        now,
      });
    else if (target === 'REFUND')
      await this.#money.reconcileRefund({
        context: input.context,
        refund_id: found2.id as UuidV7,
        provider_state: input.provider_state,
        evidence_reference: input.evidence_reference,
        now,
      });
    else
      await this.#money.reconcilePayout({
        context: input.context,
        payout_id: found2.id as UuidV7,
        provider_state: input.provider_state,
        amount_minor: input.statement_amount_minor ?? Number(found2.amount_minor),
        statement_reference: input.evidence_reference,
        now,
      });
    // The attempt is on the record whether or not it settled the operation.
    return tx(this.#pool, async (client) => {
      await this.#as(client, actor, input.reason_code);
      const current = await client.query<ExceptionRow>(
        'SELECT * FROM marketplace.finance_exceptions WHERE finance_exception_id = $1 FOR UPDATE',
        [row.finance_exception_id],
      );
      const now2 = current.rows[0] as ExceptionRow;
      const updated = await this.#update(
        client,
        now2,
        { attempts: now2.attempts + 1, last_retry_at: now },
        now,
      );
      await client.query(
        `INSERT INTO marketplace.finance_exception_events
           (finance_exception_id, event_type, actor_id, reason_code, payload, occurred_at)
         VALUES ($1,'RETRIED',$2,$3,$4,$5)`,
        [
          row.finance_exception_id,
          actor,
          input.reason_code,
          JSON.stringify({
            provider_state: input.provider_state,
            evidence_reference: input.evidence_reference,
          }),
          now,
        ],
      );
      await this.#audit(client, input.context, actor, {
        action: 'FINANCE_EXCEPTION_RECONCILE',
        id: row.finance_exception_id,
        reason_code: input.reason_code,
        before: { exception_state: row.exception_state, version: row.version },
        after: { exception_state: updated.exception_state, version: updated.version },
      });
      return {
        finance_exception_id: row.finance_exception_id,
        action: 'RECONCILE' as const,
        exception_state: updated.exception_state,
        resolution_code: updated.resolution_code,
        version: updated.version,
      };
    });
  }

  async #rows(
    queryable: Pick<Pool | PoolClient, 'query'>,
    input: {
      readonly queue: string | null;
      readonly include_resolved: boolean;
      readonly id: string | null;
    },
  ) {
    const rows = await queryable.query<QueueRow>(
      `SELECT e.*,
              COALESCE(payment.amount_minor, refund.refund_total_minor, payout.amount_minor)::text AS derived_expected,
              (CASE WHEN payment.payment_transaction_id IS NOT NULL
                      THEN CASE WHEN payment.payment_state = 'CAPTURED'
                                THEN payment.captured_amount_minor ELSE 0 END
                    WHEN refund.refund_id IS NOT NULL
                      THEN CASE WHEN refund.refund_state = 'SUCCEEDED' THEN refund.refund_total_minor ELSE 0 END
                    WHEN payout.payout_id IS NOT NULL
                      THEN CASE WHEN payout.payout_state = 'PAID' THEN payout.amount_minor ELSE 0 END
               END)::text AS derived_actual,
              COALESCE(refund.source_order_reference, payout.settlement_id::text,
                       grouping.checkout_group_id::text) AS derived_business,
              COALESCE(payment.payment_state, refund.refund_state, payout.payout_state) AS provider_state,
              correction.lifecycle_state AS correction_state,
              correction.second_approval_required AS correction_second_approval,
              (SELECT count(*)::text FROM marketplace.finance_exception_events ev
                WHERE ev.finance_exception_id = e.finance_exception_id AND ev.event_type = 'EVIDENCE') AS evidence_count,
              (SELECT count(*)::text FROM marketplace.finance_exception_events ev
                WHERE ev.finance_exception_id = e.finance_exception_id) AS history_count,
              EXISTS (SELECT 1 FROM marketplace.finance_exception_events ev
                       WHERE ev.finance_exception_id = e.finance_exception_id
                         AND ev.event_type = 'WRITE_OFF_PROPOSED'
                         AND ev.occurred_at >= COALESCE((SELECT max(r.occurred_at)
                               FROM marketplace.finance_exception_events r
                              WHERE r.finance_exception_id = e.finance_exception_id
                                AND r.event_type = 'REOPENED'), '-infinity'::timestamptz)) AS write_off_proposed
         FROM marketplace.finance_exceptions e
         LEFT JOIN marketplace.payment_transactions payment
           ON payment.provider_operation_reference = e.operation_reference
         LEFT JOIN marketplace.checkout_groups grouping
           ON grouping.payment_transaction_id = payment.payment_transaction_id
         LEFT JOIN marketplace.refunds refund ON refund.provider_operation_reference = e.operation_reference
         LEFT JOIN marketplace.payouts payout ON payout.provider_operation_reference = e.operation_reference
         LEFT JOIN marketplace.financial_corrections correction
           ON correction.financial_correction_id = e.financial_correction_id
        WHERE ($1::uuid IS NULL OR e.finance_exception_id = $1)
          AND ($2::text IS NULL OR e.queue = $2)
          AND ($3::boolean OR e.exception_state <> 'RESOLVED')
        ORDER BY e.amount_at_risk_minor DESC, e.created_at, e.finance_exception_id
        LIMIT 500`,
      [input.id, input.queue, input.include_resolved],
    );
    return rows.rows;
  }

  #shape(row: QueueRow, now: Date) {
    const expected = row.expected_minor ?? row.derived_expected;
    const actual = row.actual_minor ?? row.derived_actual;
    return {
      finance_exception_id: row.finance_exception_id,
      queue: row.queue,
      exception_kind: row.exception_kind,
      owner: row.owner_reference,
      exception_state: row.exception_state,
      assigned_to_user_id: row.assigned_to_user_id,
      expected_minor: expected === null ? null : Number(expected),
      actual_minor: actual === null ? null : Number(actual),
      amount_at_risk_minor: Number(row.amount_at_risk_minor),
      provider_reference: row.operation_reference,
      provider_state: row.provider_state,
      business_reference: row.business_reference ?? row.derived_business,
      risk: financeRisk(row.exception_kind, Number(row.amount_at_risk_minor)),
      age_seconds: Math.max(0, Math.floor((now.getTime() - row.created_at.getTime()) / 1000)),
      attempts: row.attempts,
      last_retry_at: row.last_retry_at?.toISOString() ?? null,
      next_safe_action: row.exception_state === 'RESOLVED' ? 'NONE' : row.next_action_code,
      correction: row.financial_correction_id
        ? {
            financial_correction_id: row.financial_correction_id,
            state: row.correction_state,
            second_approval_required: row.correction_second_approval,
          }
        : null,
      approval: row.write_off_proposed
        ? 'WRITE_OFF_AWAITING_APPROVAL'
        : row.financial_correction_id
          ? `CORRECTION_${row.correction_state}`
          : 'NONE',
      evidence_count: Number(row.evidence_count),
      history_count: Number(row.history_count),
      resolution_code: row.resolution_code,
      resolved_at: row.resolved_at?.toISOString() ?? null,
      allowed_actions: financeActionsFor(row),
      version: row.version,
      created_at: row.created_at.toISOString(),
    };
  }

  async #disputes(queryable: Pick<Pool | PoolClient, 'query'>, includeResolved: boolean) {
    const rows = await queryable.query<{
      dispute_kind: 'VENDOR_SETTLEMENT' | 'PARTNER_EARNING';
      dispute_id: string;
      business_reference: string;
      expected_minor: string;
      actual_minor: string;
      lifecycle_state: string;
      deadline_at: Date;
      created_at: Date;
    }>(
      `SELECT 'VENDOR_SETTLEMENT' AS dispute_kind, vendor_settlement_dispute_id::text AS dispute_id,
              settlement_id::text AS business_reference, expected_amount_minor::text AS expected_minor,
              disputed_amount_minor::text AS actual_minor, lifecycle_state, deadline_at, created_at
         FROM marketplace.vendor_settlement_disputes
        WHERE $1::boolean OR lifecycle_state = 'OPEN'
       UNION ALL
       SELECT 'PARTNER_EARNING', partner_dispute_case_id::text, partner_earnings_record_id::text,
              proposed_amount_minor::text, disputed_amount_minor::text, lifecycle_state, deadline_at, created_at
         FROM marketplace.partner_dispute_cases
        WHERE $1::boolean OR lifecycle_state = 'OPEN'
        ORDER BY deadline_at
        LIMIT 200`,
      [includeResolved],
    );
    return rows.rows.map((row) => ({
      dispute_kind: row.dispute_kind,
      dispute_id: row.dispute_id,
      business_reference: row.business_reference,
      expected_minor: Number(row.expected_minor),
      actual_minor: Number(row.actual_minor),
      at_risk_minor: Math.abs(Number(row.expected_minor) - Number(row.actual_minor)),
      lifecycle_state: row.lifecycle_state,
      next_safe_action: 'RESOLVE_DISPUTE',
      deadline_at: row.deadline_at,
      created_at: row.created_at,
    }));
  }

  async #stillUnknown(client: PoolClient, row: ExceptionRow): Promise<boolean> {
    const found = await client.query<{ unknown: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM marketplace.payment_transactions
                       WHERE provider_operation_reference = $1
                         AND payment_state = 'UNKNOWN_REQUIRES_RECONCILIATION')
           OR EXISTS (SELECT 1 FROM marketplace.refunds
                       WHERE provider_operation_reference = $1 AND refund_state = 'FAILED_REVIEW')
           OR EXISTS (SELECT 1 FROM marketplace.payouts
                       WHERE provider_operation_reference = $1 AND payout_state = 'SUBMITTED') AS unknown`,
      [row.operation_reference],
    );
    return found.rows[0]?.unknown === true;
  }

  async #writeOffProposed(client: PoolClient, row: ExceptionRow): Promise<boolean> {
    const found = await client.query<{ proposed: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM marketplace.finance_exception_events ev
                       WHERE ev.finance_exception_id = $1 AND ev.event_type = 'WRITE_OFF_PROPOSED'
                         AND ev.occurred_at >= COALESCE((SELECT max(r.occurred_at)
                               FROM marketplace.finance_exception_events r
                              WHERE r.finance_exception_id = $1 AND r.event_type = 'REOPENED'),
                             '-infinity'::timestamptz)) AS proposed`,
      [row.finance_exception_id],
    );
    return found.rows[0]?.proposed === true;
  }

  async #lock(client: PoolClient, id: UuidV7, version: number): Promise<ExceptionRow> {
    const found = await client.query<ExceptionRow>(
      'SELECT * FROM marketplace.finance_exceptions WHERE finance_exception_id = $1 FOR UPDATE',
      [id],
    );
    const row = found.rows[0];
    if (!row) throw new FinanceQueueNotFoundError();
    if (row.version !== version) {
      throw new FinanceQueueStateError('The exception changed since it was read; reload it');
    }
    return row;
  }

  /** Names the operator and reason the history trigger records for this transaction. */
  async #as(client: PoolClient, actor: UuidV7, reason: string) {
    await client.query(
      "SELECT set_config('app.finance_actor', $1, true), set_config('app.finance_reason', $2, true)",
      [actor, reason],
    );
  }

  async #update(client: PoolClient, row: ExceptionRow, patch: Record<string, unknown>, now: Date) {
    const allowed = new Set([
      'exception_state',
      'assigned_to_user_id',
      'financial_correction_id',
      'resolution_code',
      'resolved_by_user_id',
      'resolved_at',
      'attempts',
      'last_retry_at',
    ]);
    const keys = Object.keys(patch);
    for (const key of keys)
      if (!allowed.has(key)) throw new Error(`Not an exception column: ${key}`);
    const sets = keys.map((key, index) => `${key} = $${index + 4}`);
    const updated = await client.query<ExceptionRow>(
      `UPDATE marketplace.finance_exceptions
          SET ${[...sets, 'version = version + 1', 'updated_at = $3'].join(', ')}
        WHERE finance_exception_id = $1 AND version = $2
        RETURNING *`,
      [row.finance_exception_id, row.version, now, ...keys.map((key) => patch[key])],
    );
    const next = updated.rows[0];
    if (!next)
      throw new FinanceQueueStateError('The exception changed since it was read; reload it');
    return next;
  }

  async #require(
    queryable: Pick<Pool | PoolClient, 'query'>,
    context: RequestContext,
    now: Date,
    capability: string,
  ): Promise<UuidV7> {
    if (context.actor?.actor_kind !== 'admin') throw new FinanceQueueAuthorizationError();
    const held = await globalAdminCapabilities(queryable, context.actor.actor_id, now);
    if (!held.has(capability)) throw new FinanceQueueAuthorizationError();
    return context.actor.actor_id;
  }

  async #audit(
    queryable: Pick<Pool | PoolClient, 'query'>,
    context: RequestContext,
    actor: string,
    input: {
      readonly action: string;
      readonly id: string;
      readonly reason_code: string;
      readonly before: Record<string, unknown> | null;
      readonly after: Record<string, unknown> | null;
      readonly approval_reference?: string | null;
    },
  ) {
    await queryable.query(
      `INSERT INTO marketplace.operational_audit_events
         (operational_audit_event_id, action, target_kind, target_reference, actor_id, reason_code,
          before_value, after_value, request_id, correlation_id, approval_reference)
       VALUES ($1,$2,'FINANCE_EXCEPTION',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        createUuidV7(),
        input.action,
        input.id,
        actor,
        input.reason_code,
        input.before ? JSON.stringify(input.before) : null,
        input.after ? JSON.stringify(input.after) : null,
        parseRequestId(context.request_id),
        parseUuidV7(context.correlation_id),
        input.approval_reference ?? null,
      ],
    );
  }
}
