import { createDatabasePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import type { Pool } from 'pg';
import { deriveCheckoutGroupState } from './checkout-group-state.js';
import { globalAdminCapabilities } from './admin-capabilities.js';
import type { VendorFulfilmentService } from './vendor-fulfilment.js';
import type { MoneyLifecycleService } from './money-lifecycle.js';
import type { AssignmentCustodyService } from './assignment-custody.js';

export class OrderMonitorInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}
export class OrderMonitorNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';
}
export class OrderMonitorStateError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
}
export class OrderMonitorAuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
}

const ORDER_STATES = [
  'PLACED',
  'ACCEPTED',
  'PICKING',
  'AWAITING_CUSTOMER_DECISION',
  'READY',
  'PICKED_UP',
  'DELIVERED',
  'RETURNED',
  'CANCELLED',
  'EXPIRED',
] as const;
const FULFILMENT_METHODS = ['PLATFORM_DELIVERY', 'CUSTOMER_PICKUP', 'VENDOR_DELIVERY'] as const;
const EXCEPTIONS = ['ANY', 'STALLED', 'PARTNER_EXCEPTION', 'SUPPORT_CASE', 'PAYMENT'] as const;
export type InterventionKind = 'CANCEL' | 'REFUND' | 'REASSIGN' | 'RETURN' | 'COMMUNICATE';
const KINDS: readonly InterventionKind[] = [
  'CANCEL',
  'REFUND',
  'REASSIGN',
  'RETURN',
  'COMMUNICATE',
];
/** The three messages operations may send a customer about an order. */
export const OPERATIONS_MESSAGES = Object.freeze({
  UNDER_REVIEW: 'operations_message.under_review',
  DELAY_ACKNOWLEDGED: 'operations_message.delay_acknowledged',
  SUPPORT_WILL_CONTACT: 'operations_message.support_will_contact',
} as const);
export type OperationsMessage = keyof typeof OPERATIONS_MESSAGES;

/** The capability each intervention needs, besides reading the monitor. */
export const INTERVENTION_CAPABILITY: Readonly<Record<InterventionKind, string>> = Object.freeze({
  CANCEL: 'admin.order.intervene',
  REFUND: 'admin.finance.refund_propose',
  REASSIGN: 'admin.delivery.assignment_manage',
  RETURN: 'admin.delivery.assignment_manage',
  COMMUNICATE: 'admin.support.case_manage',
});

const PRE_CUSTODY_ORDER = ['PLACED', 'ACCEPTED', 'PICKING', 'AWAITING_CUSTOMER_DECISION', 'READY'];
const NO_CUSTODY_ASSIGNMENT = [
  'UNASSIGNED',
  'OFFERED',
  'DECLINED',
  'OFFER_EXPIRED',
  'REASSIGNED',
  'CANCELLED',
];
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;

export type MonitorFilters = {
  readonly state?: string;
  readonly vendor_location_id?: UuidV7;
  readonly fulfilment_method?: string;
  readonly exception?: string;
  readonly min_time_in_state_seconds?: number;
  readonly checkout_group_id?: UuidV7;
  readonly limit?: number;
};

export type InterventionParams = {
  readonly amount_minor?: number;
  readonly compensation_minor?: number;
  readonly message?: string;
  readonly destination_note?: string;
};

type OrderContext = {
  readonly vendor_order_id: string;
  readonly checkout_group_id: string;
  readonly order_reference: string;
  readonly lifecycle_state: string;
  readonly version: number;
  readonly vendor_location_id: string;
  readonly customer_user_id: string;
  readonly payment_transaction_id: string | null;
  readonly payment_state: string | null;
  readonly provider_scenario: string | null;
  readonly allocated_total_minor: number;
  readonly live_refunds_minor: number;
  readonly assignment: {
    readonly delivery_assignment_id: string;
    readonly assignment_state: string;
    readonly custody_state: string;
    readonly version: number;
    readonly partner_user_id: string | null;
  } | null;
  readonly siblings: readonly { readonly order_reference: string; readonly state: string }[];
};

/** Paise, said as rupees, for an effect line. */
function rupees(minor: number): string {
  return `₹${(minor / 100).toFixed(2)}`;
}

/**
 * The live order monitor and its interventions (11.2).
 *
 * Operations find orders by state, shop, fulfilment, exception and how long
 * they have sat; open a group without its siblings being touched; read one
 * order's whole history -- its transitions, payment, ledger, delivery
 * attempts, custody, cases and messages -- in time order; and act on it
 * through five commands, each previewed by the server from the order as it
 * stands, then confirmed with a reason, the capability its kind needs, the
 * versions the operator read, and a second person where money moves. Every
 * view and action is on the operational audit.
 */
export class OrderMonitorService {
  readonly #pool: Pool;
  readonly #fulfilment: VendorFulfilmentService;
  readonly #money: MoneyLifecycleService;
  readonly #assignments: AssignmentCustodyService;

  constructor(input: {
    readonly connection_string: string;
    readonly fulfilment: VendorFulfilmentService;
    readonly money: MoneyLifecycleService;
    readonly assignments: AssignmentCustodyService;
  }) {
    this.#pool = createDatabasePool({
      connectionString: input.connection_string,
      application_name: 'neighbourhood-store-order-monitor',
      max: 6,
    });
    this.#fulfilment = input.fulfilment;
    this.#money = input.money;
    this.#assignments = input.assignments;
  }

  async close() {
    await this.#pool.end();
  }

  /**
   * Checkout groups and the child orders that match (11.2 requirement 1-2).
   * A group shows the children that match and counts the rest, so opening
   * one order never brings its siblings into view or into an action; the
   * group's state is still derived from all of them.
   */
  async monitor(input: {
    readonly context: RequestContext;
    readonly filters: MonitorFilters;
    readonly now?: Date;
  }) {
    admin(input.context);
    const now = input.now ?? new Date();
    const filters = validFilters(input.filters);
    const rows = await this.#pool.query<{
      vendor_order_id: string;
      checkout_group_id: string;
      order_reference: string;
      lifecycle_state: string;
      version: number;
      vendor_location_id: string;
      location_name: string;
      fulfilment_method: string;
      state_since: Date;
      stalled: boolean;
      partner_exception: boolean;
      support_case: boolean;
      payment_exception: boolean;
    }>(
      `WITH candidates AS (
         SELECT o.vendor_order_id, o.checkout_group_id, o.order_reference, o.lifecycle_state,
                o.version, o.vendor_location_id, location.location_name,
                COALESCE(cvg.fulfilment_method, 'PLATFORM_DELIVERY') AS fulfilment_method,
                COALESCE((SELECT max(event.occurred_at) FROM marketplace.vendor_order_events event
                           WHERE event.vendor_order_id = o.vendor_order_id), o.created_at) AS state_since,
                (
                  (o.lifecycle_state = 'PLACED' AND o.accept_by <= $1)
                  OR EXISTS (SELECT 1 FROM marketplace.vendor_order_customer_decisions decision
                              WHERE decision.vendor_order_id = o.vendor_order_id
                                AND decision.answer = 'PENDING' AND decision.decision_deadline_at <= $1)
                  OR (o.lifecycle_state IN ('READY','PICKED_UP') AND EXISTS (
                        SELECT 1 FROM marketplace.delivery_assignments attempt
                         WHERE attempt.vendor_order_id = o.vendor_order_id
                           AND attempt.assignment_state IN ('UNASSIGNED','OFFER_EXPIRED','DECLINED')))
                ) AS stalled,
                EXISTS (
                  SELECT 1 FROM marketplace.delivery_assignments attempt
                   JOIN LATERAL (
                     SELECT report.resolution_state FROM marketplace.partner_exception_events report
                      WHERE report.delivery_assignment_id = attempt.delivery_assignment_id
                      ORDER BY report.occurred_at DESC, report.partner_exception_event_id DESC LIMIT 1
                   ) latest ON true
                  WHERE attempt.vendor_order_id = o.vendor_order_id AND latest.resolution_state = 'OPEN'
                ) AS partner_exception,
                EXISTS (SELECT 1 FROM marketplace.support_cases support
                         WHERE support.vendor_order_id = o.vendor_order_id
                           AND support.lifecycle_state NOT IN ('RESOLVED','WITHDRAWN')) AS support_case,
                (payment.payment_state = 'UNKNOWN_REQUIRES_RECONCILIATION'
                 OR EXISTS (SELECT 1 FROM marketplace.refunds refund
                             WHERE refund.source_order_reference = o.order_reference
                               AND refund.refund_state IN ('FAILED_REVIEW','FAILED_RETRYABLE'))) AS payment_exception
           FROM marketplace.vendor_orders o
           JOIN marketplace.checkout_groups grouping USING (checkout_group_id)
           JOIN marketplace.vendor_locations location ON location.vendor_location_id = o.vendor_location_id
           LEFT JOIN marketplace.payment_transactions payment
             ON payment.payment_transaction_id = grouping.payment_transaction_id
           LEFT JOIN marketplace.checkout_quote_groups cqg
             ON cqg.checkout_quote_id = grouping.checkout_quote_id
            AND cqg.vendor_location_id = o.vendor_location_id
           LEFT JOIN marketplace.cart_vendor_groups cvg USING (cart_vendor_group_id)
          WHERE ($2::text IS NULL OR o.lifecycle_state = $2)
            AND ($3::uuid IS NULL OR o.vendor_location_id = $3)
            AND ($4::uuid IS NULL OR o.checkout_group_id = $4)
       )
       SELECT * FROM candidates
        WHERE ($5::text IS NULL OR fulfilment_method = $5)
          AND ($6::bigint IS NULL OR EXTRACT(EPOCH FROM ($1 - state_since)) >= $6)
          AND CASE $7::text
                WHEN 'ANY' THEN stalled OR partner_exception OR support_case OR payment_exception
                WHEN 'STALLED' THEN stalled
                WHEN 'PARTNER_EXCEPTION' THEN partner_exception
                WHEN 'SUPPORT_CASE' THEN support_case
                WHEN 'PAYMENT' THEN payment_exception
                ELSE true END
        ORDER BY state_since ASC, vendor_order_id
        LIMIT $8`,
      [
        now,
        filters.state ?? null,
        filters.vendor_location_id ?? null,
        filters.checkout_group_id ?? null,
        filters.fulfilment_method ?? null,
        filters.min_time_in_state_seconds ?? null,
        filters.exception ?? null,
        filters.limit,
      ],
    );
    const groupIds = [...new Set(rows.rows.map((row) => row.checkout_group_id))];
    const groups = groupIds.length
      ? await this.#pool.query<{
          checkout_group_id: string;
          lifecycle_state: string;
          created_at: Date;
          children: { state: string; fulfilment_method: string | null }[];
        }>(
          `SELECT grouping.checkout_group_id, grouping.lifecycle_state, grouping.created_at,
                  json_agg(json_build_object('state', o.lifecycle_state,
                                             'fulfilment_method', cvg.fulfilment_method)) AS children
             FROM marketplace.checkout_groups grouping
             JOIN marketplace.vendor_orders o USING (checkout_group_id)
             LEFT JOIN marketplace.checkout_quote_groups cqg
               ON cqg.checkout_quote_id = grouping.checkout_quote_id
              AND cqg.vendor_location_id = o.vendor_location_id
             LEFT JOIN marketplace.cart_vendor_groups cvg USING (cart_vendor_group_id)
            WHERE grouping.checkout_group_id = ANY($1::uuid[])
            GROUP BY grouping.checkout_group_id`,
          [groupIds],
        )
      : { rows: [] };
    return {
      filters: filters.echo,
      checkout_groups: groups.rows.map((group) => {
        const orders = rows.rows
          .filter((row) => row.checkout_group_id === group.checkout_group_id)
          .map((row) => ({
            vendor_order_id: row.vendor_order_id,
            order_reference: row.order_reference,
            lifecycle_state: row.lifecycle_state,
            version: row.version,
            vendor_location_id: row.vendor_location_id,
            location_name: row.location_name,
            fulfilment_method: row.fulfilment_method,
            time_in_state_seconds: Math.max(
              0,
              Math.floor((now.getTime() - row.state_since.getTime()) / 1_000),
            ),
            exceptions: [
              ...(row.stalled ? ['STALLED'] : []),
              ...(row.partner_exception ? ['PARTNER_EXCEPTION'] : []),
              ...(row.support_case ? ['SUPPORT_CASE'] : []),
              ...(row.payment_exception ? ['PAYMENT'] : []),
            ],
          }));
        return {
          checkout_group_id: group.checkout_group_id,
          payment_state: group.lifecycle_state,
          derived_lifecycle_state: deriveCheckoutGroupState({
            payment_state: group.lifecycle_state,
            orders: group.children.map((child) => ({
              lifecycle_state: child.state,
              fulfilment_method: child.fulfilment_method,
            })),
          }),
          created_at: group.created_at.toISOString(),
          orders,
          sibling_orders_not_shown: group.children.length - orders.length,
        };
      }),
    };
  }

  /**
   * One order's history in time order (11.2 requirement 3): its transitions,
   * the group's payment and this order's refunds, its ledger postings, its
   * delivery attempts and custody, its support cases and the messages sent
   * about it. Recorded as viewed.
   */
  async timeline(input: { readonly context: RequestContext; readonly vendor_order_id: UuidV7 }) {
    const actor = admin(input.context);
    const order = await this.#order(input.vendor_order_id);
    type Entry = {
      readonly kind:
        'TRANSITION' | 'PAYMENT' | 'LEDGER' | 'ASSIGNMENT' | 'CUSTODY' | 'CASE' | 'NOTIFICATION';
      readonly at: Date;
      readonly summary: string;
      readonly reference: string;
    };
    const entries: Entry[] = [];
    const add = (kind: Entry['kind'], at: Date, summary: string, reference: string) =>
      entries.push({ kind, at, summary, reference });
    const id = input.vendor_order_id;

    const transitions = await this.#pool.query<{
      event_id: string;
      event_type: string;
      previous_state: string | null;
      resulting_state: string | null;
      actor_kind: string;
      reason_code: string;
      occurred_at: Date;
    }>(
      `SELECT event_id, event_type, previous_state, resulting_state, actor_kind, reason_code, occurred_at
         FROM marketplace.vendor_order_events WHERE vendor_order_id=$1`,
      [id],
    );
    for (const row of transitions.rows)
      add(
        'TRANSITION',
        row.occurred_at,
        `${row.event_type}${row.previous_state || row.resulting_state ? ` ${row.previous_state ?? '—'} → ${row.resulting_state ?? '—'}` : ''} by ${row.actor_kind} (${row.reason_code})`,
        row.event_id,
      );
    if (order.payment_transaction_id) {
      const payments = await this.#pool.query<{
        payment_event_id: string;
        event_type: string;
        resulting_state: string;
        provider_result: string | null;
        occurred_at: Date;
      }>(
        `SELECT payment_event_id, event_type, resulting_state, provider_result, occurred_at
           FROM marketplace.payment_events WHERE payment_transaction_id=$1`,
        [order.payment_transaction_id],
      );
      for (const row of payments.rows)
        add(
          'PAYMENT',
          row.occurred_at,
          `${row.event_type} → ${row.resulting_state}${row.provider_result ? ` (provider ${row.provider_result})` : ''}`,
          row.payment_event_id,
        );
    }
    const refunds = await this.#pool.query<{
      refund_id: string;
      refund_state: string;
      refund_total_minor: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT refund_id, refund_state, refund_total_minor::text, created_at, updated_at
         FROM marketplace.refunds WHERE source_order_reference=$1`,
      [order.order_reference],
    );
    for (const row of refunds.rows)
      add(
        'PAYMENT',
        row.updated_at,
        `Refund of ${rupees(Number(row.refund_total_minor))} ${row.refund_state.toLowerCase().replaceAll('_', ' ')}`,
        row.refund_id,
      );
    const postings = await this.#pool.query<{
      ledger_transaction_id: string;
      transaction_kind: string;
      source_reference: string;
      posted_at: Date;
      moved: string;
    }>(
      `SELECT t.ledger_transaction_id, t.transaction_kind, t.source_reference, t.posted_at,
              sum(e.debit_minor)::text AS moved
         FROM marketplace.ledger_transactions t
         JOIN marketplace.ledger_entries e USING (ledger_transaction_id)
        WHERE e.source_order_reference=$1
        GROUP BY t.ledger_transaction_id`,
      [order.order_reference],
    );
    for (const row of postings.rows)
      add(
        'LEDGER',
        row.posted_at,
        `${row.transaction_kind} posting of ${rupees(Number(row.moved))} (${row.source_reference})`,
        row.ledger_transaction_id,
      );
    const attempts = await this.#pool.query<{
      assignment_event_id: string;
      event_type: string;
      resulting_state: string;
      actor_kind: string;
      reason_code: string;
      occurred_at: Date;
    }>(
      `SELECT event.assignment_event_id, event.event_type, event.resulting_state, event.actor_kind,
              event.reason_code, event.occurred_at
         FROM marketplace.assignment_events event
         JOIN marketplace.delivery_assignments attempt USING (delivery_assignment_id)
        WHERE attempt.vendor_order_id=$1`,
      [id],
    );
    for (const row of attempts.rows)
      add(
        'ASSIGNMENT',
        row.occurred_at,
        `${row.event_type} → ${row.resulting_state} by ${row.actor_kind} (${row.reason_code})`,
        row.assignment_event_id,
      );
    const custody = await this.#pool.query<{
      custody_event_id: string;
      custody_state: string;
      package_count: number | null;
      occurred_at: Date;
    }>(
      `SELECT event.custody_event_id, event.custody_state, event.package_count, event.occurred_at
         FROM marketplace.custody_events event
         JOIN marketplace.delivery_assignments attempt USING (delivery_assignment_id)
        WHERE attempt.vendor_order_id=$1`,
      [id],
    );
    for (const row of custody.rows)
      add(
        'CUSTODY',
        row.occurred_at,
        `Custody ${row.custody_state.toLowerCase().replaceAll('_', ' ')}${row.package_count === null ? '' : `, ${row.package_count} package(s)`}`,
        row.custody_event_id,
      );
    const cases = await this.#pool.query<{
      reference: string;
      summary: string;
      occurred_at: Date;
    }>(
      `SELECT support.support_case_id::text AS reference,
              'Case opened: ' || support.category || ' (' || support.severity || ')' AS summary,
              support.created_at AS occurred_at
         FROM marketplace.support_cases support WHERE support.vendor_order_id=$1
       UNION ALL
       SELECT event.support_case_event_id::text, 'Case ' || event.event_type || ' (' || event.reason_code || ')',
              event.occurred_at
         FROM marketplace.support_case_events event
         JOIN marketplace.support_cases support USING (support_case_id)
        WHERE support.vendor_order_id=$1`,
      [id],
    );
    for (const row of cases.rows) add('CASE', row.occurred_at, row.summary, row.reference);
    const notices = await this.#pool.query<{
      notification_intent_id: string;
      template_key: string;
      delivery_state: string;
      created_at: Date;
    }>(
      `SELECT notification_intent_id, template_key, delivery_state, created_at
         FROM marketplace.notification_intents
        WHERE source_id = $1 OR source_id IN (
          SELECT delivery_assignment_id FROM marketplace.delivery_assignments WHERE vendor_order_id = $1)`,
      [id],
    );
    for (const row of notices.rows)
      add(
        'NOTIFICATION',
        row.created_at,
        `${row.template_key} (${row.delivery_state.toLowerCase()})`,
        row.notification_intent_id,
      );

    entries.sort((left, right) => left.at.getTime() - right.at.getTime());
    const auditEventId = await this.#audit(input.context, actor, {
      action: 'ORDER_TIMELINE_VIEWED',
      vendor_order_id: id,
      reason_code: 'OPERATOR_VIEW',
      before: null,
      after: { entries: entries.length },
    });
    return {
      vendor_order_id: id,
      order_reference: order.order_reference,
      lifecycle_state: order.lifecycle_state,
      entries: entries.map((entry) => ({ ...entry, at: entry.at.toISOString() })),
      trace: {
        request_id: input.context.request_id,
        audit_event_id: auditEventId,
      },
    };
  }

  /**
   * What an intervention would do to this order as it stands (11.2
   * requirement 4), computed by the server: whether it is allowed and why
   * not, the money and custody it touches, what it leaves alone, who is
   * told, the capability it needs, whether a second person must approve,
   * and the versions to send back with the confirmation. Nothing is written.
   */
  async preview(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly kind: string;
    readonly params?: InterventionParams;
  }) {
    admin(input.context);
    const kind = interventionKind(input.kind);
    const order = await this.#order(input.vendor_order_id);
    return planIntervention(kind, order, input.params ?? {});
  }

  /**
   * Carries out a previewed intervention (11.2 requirement 5): confirmed,
   * with a reason, by an operator holding its kind's capability, against the
   * versions they read. Money goes through its maker-checker: a refund is a
   * proposal a finance approver must approve, and a cancellation after
   * capture files its refund the same way. Siblings are never touched. The
   * action is on the operational audit with the state before and after.
   */
  async intervene(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly kind: string;
    readonly reason_code: string;
    readonly confirm: boolean;
    readonly expected_order_version: number;
    readonly expected_assignment_version?: number;
    readonly params?: InterventionParams;
    readonly now?: Date;
  }) {
    const actor = admin(input.context);
    const now = input.now ?? new Date();
    const kind = interventionKind(input.kind);
    if (!REASON.test(input.reason_code))
      throw new OrderMonitorInputError('An intervention needs a reason code');
    if (input.confirm !== true)
      throw new OrderMonitorInputError('An intervention must be confirmed after its preview');
    const capabilities = await globalAdminCapabilities(this.#pool, actor, now);
    if (!capabilities.has(INTERVENTION_CAPABILITY[kind]))
      throw new OrderMonitorAuthorizationError(
        `${kind.toLowerCase()} needs ${INTERVENTION_CAPABILITY[kind]}`,
      );
    const params = input.params ?? {};
    const order = await this.#order(input.vendor_order_id);
    const plan = planIntervention(kind, order, params);
    if (!plan.allowed) throw new OrderMonitorStateError(plan.blocked_reason ?? 'Not allowed');
    if (order.version !== input.expected_order_version)
      throw new OrderMonitorStateError('The order changed since the preview; preview it again');
    if (
      (kind === 'REASSIGN' || kind === 'RETURN') &&
      order.assignment?.version !== input.expected_assignment_version
    )
      throw new OrderMonitorStateError(
        'The delivery attempt changed since the preview; preview it again',
      );
    const key = String(parseRequestId(input.context.request_id)).replaceAll('-', '').toUpperCase();
    let result: Record<string, unknown>;
    let approvalReference: string | null = null;
    switch (kind) {
      case 'CANCEL': {
        const cancelled = await this.#fulfilment.cancelByOperator({
          context: input.context,
          expected_version: order.version,
          now,
          reason_code: input.reason_code,
          vendor_order_id: input.vendor_order_id,
        });
        result = { lifecycle_state: cancelled.lifecycle_state };
        break;
      }
      case 'REFUND': {
        const amount = plan.money.proposed_minor;
        const refund = await this.#money.proposeRefund({
          command_reference: `SYNTH-CMD-INTERVENE-REFUND-${key}`,
          context: input.context,
          delivery_minor: 0,
          discount_reversal_minor: 0,
          item_minor: amount,
          now,
          payment_transaction_id: parseUuidV7(String(order.payment_transaction_id)),
          provider_operation_reference: `SYNTH-REF-INTERVENE-${key}`,
          provider_scenario: (order.provider_scenario ?? 'SUCCESS') as
            'DECLINE' | 'MALFORMED' | 'SUCCESS' | 'UNKNOWN',
          source_order_reference: order.order_reference,
          tax_minor: 0,
          tip_minor: 0,
          trigger_code:
            amount === order.allocated_total_minor ? 'FULL_ITEM_REFUND' : 'PARTIAL_ITEM_REFUND',
        });
        approvalReference = String(refund.refund_id);
        result = {
          refund_id: refund.refund_id,
          refund_state: refund.refund_state,
          amount_minor: amount,
        };
        break;
      }
      case 'REASSIGN': {
        const attempt = order.assignment;
        if (!attempt) throw new OrderMonitorStateError('No delivery attempt to reassign');
        const reassigned = await this.#assignments.reassign({
          command_reference: `SYNTH-CMD-INTERVENE-REASSIGN-${key}`,
          compensation_minor: params.compensation_minor ?? 0,
          context: input.context,
          delivery_assignment_id: parseUuidV7(attempt.delivery_assignment_id),
          expected_version: attempt.version,
          now,
          reason_code: input.reason_code,
        });
        result = { assignment_state: reassigned.assignment_state };
        break;
      }
      case 'RETURN': {
        const attempt = order.assignment;
        if (!attempt) throw new OrderMonitorStateError('No delivery attempt to return');
        const authorized = await this.#assignments.authorizeReturn({
          command_reference: `SYNTH-CMD-INTERVENE-RETURN-${key}`,
          context: input.context,
          delivery_assignment_id: parseUuidV7(attempt.delivery_assignment_id),
          destination_reference: `SYNTH-RETURN-STORE-${order.vendor_location_id.replaceAll('-', '').slice(0, 12).toUpperCase()}`,
          ...(params.destination_note ? { destination_note: params.destination_note } : {}),
          expected_version: attempt.version,
          now,
          reason_code: input.reason_code,
        });
        result = { assignment_state: authorized.assignment_state };
        break;
      }
      case 'COMMUNICATE': {
        const message = operationsMessage(params.message);
        const notice = await this.#pool.query<{ notification_intent_id: string }>(
          `INSERT INTO marketplace.notification_intents
            (notification_intent_id,recipient_user_id,notification_kind,template_key,
             template_payload,channels,provider_scenario,source_kind,source_id,source_event_type,
             deduplication_key,request_id,correlation_id,created_at,updated_at)
           VALUES ($1,$2,'ORDER_STATUS',$3,$4,$5,'SUCCESS','vendor_order',$6,'OPERATIONS_MESSAGE',$7,$8,$9,$10,$10)
           ON CONFLICT (deduplication_key) DO UPDATE SET deduplication_key=EXCLUDED.deduplication_key
           RETURNING notification_intent_id`,
          [
            createUuidV7(),
            order.customer_user_id,
            OPERATIONS_MESSAGES[message],
            JSON.stringify({ order_reference: order.order_reference }),
            ['IN_APP', 'PUSH'],
            input.vendor_order_id,
            `operations-message:${input.vendor_order_id}:${message}:${key}`,
            parseRequestId(input.context.request_id),
            parseUuidV7(input.context.correlation_id),
            now,
          ],
        );
        result = {
          notification_intent_id: notice.rows[0]?.notification_intent_id,
          template_key: OPERATIONS_MESSAGES[message],
        };
        break;
      }
    }
    const auditEventId = await this.#audit(input.context, actor, {
      action: `ORDER_INTERVENTION_${kind}`,
      vendor_order_id: input.vendor_order_id,
      reason_code: input.reason_code,
      before: plan.current,
      after: result,
      approval_reference: approvalReference,
    });
    return {
      kind,
      vendor_order_id: input.vendor_order_id,
      result,
      approval: plan.approval,
      audit_event_id: auditEventId,
    };
  }

  async #order(vendorOrderId: UuidV7): Promise<OrderContext> {
    const found = await this.#pool.query<{
      vendor_order_id: string;
      checkout_group_id: string;
      order_reference: string;
      lifecycle_state: string;
      version: number;
      vendor_location_id: string;
      customer_user_id: string;
      payment_transaction_id: string | null;
      payment_state: string | null;
      provider_scenario: string | null;
      allocated_total_minor: string | null;
      live_refunds_minor: string;
      assignment: OrderContext['assignment'];
      siblings: { order_reference: string; state: string }[] | null;
    }>(
      `SELECT o.vendor_order_id, o.checkout_group_id, o.order_reference, o.lifecycle_state,
              o.version, o.vendor_location_id, grouping.customer_user_id,
              payment.payment_transaction_id, payment.payment_state, payment.provider_scenario,
              allocation.allocated_total_minor::text AS allocated_total_minor,
              COALESCE((SELECT sum(refund.refund_total_minor) FROM marketplace.refunds refund
                         WHERE refund.source_order_reference = o.order_reference
                           AND refund.refund_state IN ('PENDING_APPROVAL','SUBMITTED','SUCCEEDED','FAILED_REVIEW')
                           AND NOT (refund.refund_state = 'PENDING_APPROVAL'
                                    AND refund.approval_expires_at <= clock_timestamp())), 0)::text
                AS live_refunds_minor,
              (SELECT json_build_object('delivery_assignment_id', attempt.delivery_assignment_id,
                                        'assignment_state', attempt.assignment_state,
                                        'custody_state', attempt.custody_state,
                                        'version', attempt.version,
                                        'partner_user_id', attempt.partner_user_id)
                 FROM marketplace.delivery_assignments attempt
                WHERE attempt.vendor_order_id = o.vendor_order_id
                ORDER BY attempt.created_at DESC, attempt.delivery_assignment_id DESC LIMIT 1) AS assignment,
              (SELECT json_agg(json_build_object('order_reference', sibling.order_reference,
                                                 'state', sibling.lifecycle_state)
                               ORDER BY sibling.order_reference)
                 FROM marketplace.vendor_orders sibling
                WHERE sibling.checkout_group_id = o.checkout_group_id
                  AND sibling.vendor_order_id <> o.vendor_order_id) AS siblings
         FROM marketplace.vendor_orders o
         JOIN marketplace.checkout_groups grouping USING (checkout_group_id)
         LEFT JOIN marketplace.payment_transactions payment
           ON payment.payment_transaction_id = grouping.payment_transaction_id
         LEFT JOIN marketplace.payment_allocations allocation
           ON allocation.payment_transaction_id = payment.payment_transaction_id
          AND allocation.source_order_reference = o.order_reference
        WHERE o.vendor_order_id = $1`,
      [vendorOrderId],
    );
    const row = found.rows[0];
    if (!row) throw new OrderMonitorNotFoundError('Order not found');
    return {
      ...row,
      allocated_total_minor: Number(row.allocated_total_minor ?? 0),
      live_refunds_minor: Number(row.live_refunds_minor),
      siblings: row.siblings ?? [],
    };
  }

  async #audit(
    context: RequestContext,
    actor: UuidV7,
    input: {
      readonly action: string;
      readonly vendor_order_id: UuidV7;
      readonly reason_code: string;
      readonly before: object | null;
      readonly after: object | null;
      readonly approval_reference?: string | null;
    },
  ): Promise<string> {
    const id = createUuidV7();
    await this.#pool.query(
      `INSERT INTO marketplace.operational_audit_events
        (operational_audit_event_id,action,target_kind,target_reference,actor_id,reason_code,
         before_value,after_value,request_id,correlation_id,approval_reference)
       VALUES ($1,$2,'VENDOR_ORDER',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        input.action,
        String(input.vendor_order_id),
        actor,
        input.reason_code,
        input.before ? JSON.stringify(input.before) : null,
        input.after ? JSON.stringify(input.after) : null,
        parseRequestId(context.request_id),
        parseUuidV7(context.correlation_id),
        input.approval_reference ?? null,
      ],
    );
    return id;
  }
}

function admin(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'admin') throw new OrderMonitorAuthorizationError();
  return context.actor.actor_id;
}

function interventionKind(value: string): InterventionKind {
  if (!(KINDS as readonly string[]).includes(value))
    throw new OrderMonitorInputError('Unknown intervention');
  return value as InterventionKind;
}

function operationsMessage(value: string | undefined): OperationsMessage {
  if (!value || !Object.hasOwn(OPERATIONS_MESSAGES, value))
    throw new OrderMonitorInputError(
      `A message is one of ${Object.keys(OPERATIONS_MESSAGES).join(', ')}`,
    );
  return value as OperationsMessage;
}

function validFilters(input: MonitorFilters) {
  if (input.state !== undefined && !(ORDER_STATES as readonly string[]).includes(input.state))
    throw new OrderMonitorInputError('Unknown order state');
  if (
    input.fulfilment_method !== undefined &&
    !(FULFILMENT_METHODS as readonly string[]).includes(input.fulfilment_method)
  )
    throw new OrderMonitorInputError('Unknown fulfilment method');
  if (input.exception !== undefined && !(EXCEPTIONS as readonly string[]).includes(input.exception))
    throw new OrderMonitorInputError('Unknown exception filter');
  if (
    input.min_time_in_state_seconds !== undefined &&
    (!Number.isSafeInteger(input.min_time_in_state_seconds) || input.min_time_in_state_seconds < 0)
  )
    throw new OrderMonitorInputError('Time in state must be whole seconds');
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  return {
    ...input,
    limit,
    echo: {
      state: input.state ?? null,
      vendor_location_id: input.vendor_location_id ?? null,
      fulfilment_method: input.fulfilment_method ?? null,
      exception: input.exception ?? null,
      min_time_in_state_seconds: input.min_time_in_state_seconds ?? null,
      checkout_group_id: input.checkout_group_id ?? null,
    },
  };
}

/** The server's account of one intervention on one order, before it happens. */
export function planIntervention(
  kind: InterventionKind,
  order: OrderContext,
  params: InterventionParams,
) {
  const attempt = order.assignment;
  const captured = order.payment_state === 'CAPTURED';
  const refundable = Math.max(0, order.allocated_total_minor - order.live_refunds_minor);
  const inCustody = attempt !== null && !NO_CUSTODY_ASSIGNMENT.includes(attempt.assignment_state);
  const siblings = order.siblings.map((sibling) => ({ ...sibling, affected: false }));
  const current = {
    order_state: order.lifecycle_state,
    order_version: order.version,
    assignment_state: attempt?.assignment_state ?? null,
    assignment_version: attempt?.version ?? null,
    custody_state: attempt?.custody_state ?? null,
    payment_state: order.payment_state,
  };
  let allowed = true;
  let blocked: string | null = null;
  let proposed = 0;
  const effects: string[] = [];
  const notifies: string[] = [];
  let approval: 'NONE' | 'SECOND_PERSON' = 'NONE';
  const block = (reason: string) => {
    allowed = false;
    blocked ??= reason;
  };
  switch (kind) {
    case 'CANCEL':
      if (!PRE_CUSTODY_ORDER.includes(order.lifecycle_state))
        block(`A ${order.lifecycle_state.toLowerCase()} order cannot be cancelled`);
      else if (inCustody) block('A partner holds the goods: direct a return instead of cancelling');
      effects.push('The order ends as CANCELLED, recorded as operations with your reason.');
      effects.push('Its stock holds are released back to the shop.');
      if (captured) {
        effects.push(
          `The money was captured: a refund of the order's share (${rupees(refundable)}) is filed for a finance approver.`,
        );
        approval = 'SECOND_PERSON';
      } else if (order.payment_state === 'AUTHORIZED') {
        effects.push(
          `The payment authorisation shrinks by the order's share (${rupees(order.allocated_total_minor)}).`,
        );
      }
      notifies.push('customer', 'shop');
      break;
    case 'REFUND':
      proposed = params.amount_minor ?? refundable;
      if (!captured) block('Nothing has been captured on this order to refund');
      else if (refundable <= 0) block('This order has nothing left to refund');
      else if (!Number.isSafeInteger(proposed) || proposed < 1 || proposed > refundable)
        block(`A refund here is between ₹0.01 and ${rupees(refundable)}`);
      effects.push(
        `A refund of ${rupees(proposed)} is proposed against the order (${rupees(refundable)} is refundable).`,
      );
      effects.push('It moves no money until a finance approver approves it.');
      approval = 'SECOND_PERSON';
      notifies.push('customer, once the refund succeeds');
      break;
    case 'REASSIGN': {
      const compensation = params.compensation_minor ?? 0;
      if (!attempt || !attempt.partner_user_id)
        block('There is no partner on this order to reassign');
      else if (!['OFFERED', 'ASSIGNED', 'AT_VENDOR'].includes(attempt.assignment_state))
        block(`An attempt that is ${attempt.assignment_state.toLowerCase()} cannot be reassigned`);
      else if (attempt.custody_state !== 'NONE')
        block('A partner holds the goods: direct a return instead of reassigning');
      if (!Number.isSafeInteger(compensation) || compensation < 0 || compensation > 100_000)
        block('Compensation is between ₹0 and ₹1,000');
      effects.push('The partner is released and the attempt goes back to the pool for another.');
      effects.push(
        compensation > 0
          ? `The displaced partner is owed ${rupees(compensation)} in compensation, paid on their next payout.`
          : 'No compensation is recorded for the displaced partner.',
      );
      notifies.push('displaced partner');
      break;
    }
    case 'RETURN':
      if (!attempt) block('There is no delivery attempt on this order');
      else if (attempt.assignment_state !== 'RETURN_REQUIRED')
        block('Only a delivery that needs a return can be directed back');
      effects.push(
        params.destination_note
          ? `The partner is directed to return the goods to: ${params.destination_note}.`
          : 'The partner is directed to return the goods to the shop.',
      );
      effects.push('Custody stays with the partner until the goods are received.');
      notifies.push('partner');
      break;
    case 'COMMUNICATE': {
      const message = params.message;
      if (!message || !Object.hasOwn(OPERATIONS_MESSAGES, message))
        block(`Choose a message: ${Object.keys(OPERATIONS_MESSAGES).join(', ')}`);
      if (['CANCELLED', 'EXPIRED'].includes(order.lifecycle_state))
        block('The order has ended; message the customer through their support case instead');
      effects.push(
        'The customer is sent the chosen message, in their language, in-app and by push.',
      );
      effects.push('The order itself does not change.');
      notifies.push('customer');
      break;
    }
  }
  if (siblings.length > 0)
    effects.push(`The other ${siblings.length} order(s) in this checkout group are not touched.`);
  return {
    kind,
    vendor_order_id: order.vendor_order_id,
    order_reference: order.order_reference,
    allowed,
    blocked_reason: blocked,
    current,
    money: {
      charged_minor: order.allocated_total_minor,
      refunded_or_pending_minor: order.live_refunds_minor,
      refundable_minor: refundable,
      proposed_minor: proposed,
      captured,
    },
    custody: inCustody ? 'GOODS_WITH_PARTNER' : 'NONE',
    effects,
    siblings,
    notifies,
    required_capability: INTERVENTION_CAPABILITY[kind],
    approval,
    expected: {
      order_version: order.version,
      assignment_version: attempt?.version ?? null,
    },
  };
}
