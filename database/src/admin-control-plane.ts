import { deriveCheckoutGroupState } from './checkout-group-state.js';
import { createDatabasePool } from './database-pool.js';
import { createHash } from 'node:crypto';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import { listDeadLetterEvents, recoverDeadLetterEvent } from './transactional-messaging.js';
import { transaction as tx } from './transaction.js';
import { rankWork, type RawWorkItem, type WorkSeverity } from './work-ranking.js';
import { globalAdminCapabilities } from './admin-capabilities.js';

export class AdminControlInputError extends Error {}
export class AdminControlNotFoundError extends Error {}
export class AdminControlStateError extends Error {}
export class AdminControlAuthorizationError extends Error {}
const REFERENCE = /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/;
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;
function admin(context: RequestContext) {
  if (context.actor?.actor_kind !== 'admin') throw new AdminControlAuthorizationError();
  return context.actor.actor_id;
}
/** An operator, or the worker acting on a committed domain event. */
function operationsAutomation(context: RequestContext) {
  const kind = context.actor?.actor_kind;
  if (!context.actor || (kind !== 'admin' && kind !== 'system')) {
    throw new AdminControlAuthorizationError();
  }
  return context.actor.actor_id;
}
function operator(context: RequestContext) {
  if (context.actor?.actor_kind !== 'admin' && context.actor?.actor_kind !== 'system')
    throw new AdminControlAuthorizationError();
  return context.actor.actor_id;
}
function reason(value: string) {
  if (!REASON.test(value)) throw new AdminControlInputError('Reason code is invalid');
  return value;
}
function marked(value: string) {
  if (!REFERENCE.test(value)) throw new AdminControlInputError('Reference is invalid');
  return value;
}
/**
 * A finance exception's severity (D-09): a conservation break or money paid
 * twice is critical; an outcome nobody knows, a refused payout, a posting that
 * failed, or a large amount is high; the rest is medium.
 */
function financeSeverity(kind: string, amountMinor: number): WorkSeverity {
  if (['LEDGER_UNBALANCED', 'PAYOUT_DUPLICATE_RISK'].includes(kind)) return 'CRITICAL';
  if (
    [
      'PAYMENT_UNKNOWN',
      'REFUND_UNKNOWN',
      'PAYOUT_UNKNOWN',
      'PAYOUT_FAILED',
      'POSTING_FAILED',
    ].includes(kind) ||
    amountMinor >= 100_000
  )
    return 'HIGH';
  return 'MEDIUM';
}

export class AdminControlPlaneService {
  readonly #pool: Pool;
  constructor(input: { readonly connection_string: string }) {
    this.#pool = createDatabasePool({
      connectionString: input.connection_string,
      application_name: 'neighbourhood-store-admin-control',
      max: 10,
    });
  }
  async close() {
    await this.#pool.end();
  }
  /**
   * The operator's work, ranked (11.1).
   *
   * Every queue that needs a person, each row with its tier, severity, owner,
   * deadline, age, object, money and custody at risk, and next action, ranked
   * by `rankWork` the same way for everyone. An operator sees the rows of the
   * queues their capabilities let them act on and no others; what they cannot
   * see is not counted or hinted at. Every view is written to the operational
   * audit, and the response carries the request, correlation and audit
   * references it was recorded under.
   *
   * Until audit run 73 this returned finance, support, trust and incident rows
   * to anyone who could open it, ranked by money at risk and then age -- so a
   * large finance exception outranked a partner reporting a threat, which was
   * not a row at all -- with no severity, owner, deadline or custody, and no
   * record that anyone had looked.
   */
  async dashboard(input: { readonly context: RequestContext; readonly now?: Date }) {
    const actor = admin(input.context);
    const now = input.now ?? new Date();
    const capabilities = await globalAdminCapabilities(this.#pool, actor, now);
    const may = (...keys: string[]) => keys.some((key) => capabilities.has(key));
    const queues: string[] = [];
    const raw: RawWorkItem[] = [];
    const add = async (
      queue: string,
      allowed: boolean,
      load: () => Promise<readonly RawWorkItem[]>,
    ) => {
      if (!allowed) return;
      queues.push(queue);
      raw.push(...(await load()));
    };

    // Safety and security: a partner in danger, a restriction awaiting its
    // decision, a pause in force.
    await add(
      'PARTNER_SAFETY',
      may('admin.order.intervene', 'admin.delivery.assignment_manage', 'admin.incident.manage'),
      async () => {
        const rows = await this.#pool.query<{
          partner_exception_event_id: string;
          exception_kind: string;
          custody_state: string;
          occurred_at: Date;
        }>(
          `SELECT latest.partner_exception_event_id, latest.exception_kind,
                  assignment.custody_state, latest.occurred_at
             FROM (SELECT DISTINCT ON (event.delivery_assignment_id, event.exception_kind) event.*
                     FROM marketplace.partner_exception_events event
                    ORDER BY event.delivery_assignment_id, event.exception_kind,
                             event.occurred_at DESC, event.partner_exception_event_id DESC) latest
             JOIN marketplace.delivery_assignments assignment USING (delivery_assignment_id)
            WHERE latest.resolution_state = 'OPEN'
              AND latest.exception_kind IN ('UNSAFE_LOCATION','ACCIDENT','MEDICAL_EMERGENCY','THREAT')
            LIMIT 200`,
        );
        return rows.rows.map((row) => ({
          kind: 'SAFETY',
          tier: 'SAFETY_SECURITY' as const,
          severity:
            row.exception_kind === 'UNSAFE_LOCATION' ? ('HIGH' as const) : ('CRITICAL' as const),
          object_kind: 'PARTNER_EXCEPTION',
          object_id: row.partner_exception_event_id,
          title: row.exception_kind,
          owner: 'DELIVERY_OPERATIONS',
          next_action: 'CONTACT_PARTNER_AND_DIRECT',
          created_at: row.occurred_at,
          amount_at_risk_minor: 0,
          custody_risk:
            row.custody_state === 'IN_CUSTODY' ? ('GOODS_IN_CUSTODY' as const) : ('NONE' as const),
        }));
      },
    );
    await add(
      'TRUST',
      may('admin.trust.restriction_approve', 'admin.trust.restriction_propose'),
      async () => {
        const rows = await this.#pool.query<{
          trust_restriction_case_id: string;
          reason_code: string;
          review_at: Date | null;
          created_at: Date;
        }>(
          `SELECT trust_restriction_case_id, reason_code, review_at, created_at
             FROM marketplace.trust_restriction_cases WHERE lifecycle_state='PROPOSED' LIMIT 200`,
        );
        return rows.rows.map((row) => ({
          kind: 'TRUST',
          tier: 'SAFETY_SECURITY' as const,
          severity: 'HIGH' as const,
          object_kind: 'TRUST_RESTRICTION_CASE',
          object_id: row.trust_restriction_case_id,
          title: row.reason_code,
          owner: 'TRUST_APPROVERS',
          next_action: 'DECIDE_RESTRICTION',
          created_at: row.created_at,
          due_at: row.review_at,
          amount_at_risk_minor: 0,
          custody_risk: 'NONE' as const,
        }));
      },
    );
    await add('INCIDENT', may('admin.incident.manage'), async () => {
      const rows = await this.#pool.query<{
        incident_control_id: string;
        control_key: string;
        owner_user_id: string;
        review_at: Date;
        created_at: Date;
      }>(
        `SELECT incident_control_id, control_key, owner_user_id, review_at, created_at
           FROM marketplace.incident_controls WHERE lifecycle_state='ACTIVE' LIMIT 200`,
      );
      return rows.rows.map((row) => ({
        kind: 'INCIDENT',
        tier: 'SAFETY_SECURITY' as const,
        severity: 'HIGH' as const,
        object_kind: 'INCIDENT_CONTROL',
        object_id: row.incident_control_id,
        title: row.control_key,
        owner: `USER-${row.owner_user_id}`,
        next_action: 'REVIEW_OR_REVOKE_CONTROL',
        created_at: row.created_at,
        due_at: row.review_at,
        amount_at_risk_minor: 0,
        custody_risk: 'NONE' as const,
      }));
    });

    // The ledger: finance exceptions, corrections and refunds awaiting a person.
    await add('FINANCE', may('admin.finance.ledger_manage'), async () => {
      const exceptions = await this.#pool.query<{
        finance_exception_id: string;
        exception_kind: string;
        amount_at_risk_minor: string;
        owner_reference: string;
        next_action_code: string;
        created_at: Date;
      }>(
        `SELECT finance_exception_id, exception_kind, amount_at_risk_minor::text, owner_reference,
                next_action_code, created_at
           FROM marketplace.finance_exceptions WHERE exception_state<>'RESOLVED' LIMIT 500`,
      );
      const corrections = await this.#pool.query<{
        financial_correction_id: string;
        reason_code: string;
        impact_minor: string;
        approval_expires_at: Date;
        created_at: Date;
      }>(
        `SELECT financial_correction_id, reason_code, impact_minor::text, approval_expires_at,
                created_at
           FROM marketplace.financial_corrections WHERE lifecycle_state='PROPOSED' LIMIT 200`,
      );
      return [
        ...exceptions.rows.map((row) => ({
          kind: 'FINANCE',
          tier: 'LEDGER' as const,
          severity: financeSeverity(row.exception_kind, Number(row.amount_at_risk_minor)),
          object_kind: 'FINANCE_EXCEPTION',
          object_id: row.finance_exception_id,
          title: row.exception_kind,
          owner: row.owner_reference,
          next_action: row.next_action_code,
          created_at: row.created_at,
          amount_at_risk_minor: Number(row.amount_at_risk_minor),
          custody_risk: 'NONE' as const,
        })),
        ...corrections.rows.map((row) => ({
          kind: 'FINANCE',
          tier: 'LEDGER' as const,
          severity: 'MEDIUM' as const,
          object_kind: 'FINANCIAL_CORRECTION',
          object_id: row.financial_correction_id,
          title: row.reason_code,
          owner: 'FINANCE_OPERATIONS',
          next_action: 'APPROVE_OR_REJECT_CORRECTION',
          created_at: row.created_at,
          due_at: row.approval_expires_at,
          amount_at_risk_minor: Number(row.impact_minor),
          custody_risk: 'NONE' as const,
        })),
      ];
    });
    await add('REFUND_APPROVAL', may('admin.finance.refund_approve'), async () => {
      const rows = await this.#pool.query<{
        refund_id: string;
        trigger_code: string;
        refund_total_minor: string;
        approval_expires_at: Date | null;
        created_at: Date;
      }>(
        `SELECT refund_id, trigger_code, refund_total_minor::text, approval_expires_at, created_at
           FROM marketplace.refunds
          WHERE refund_state='PENDING_APPROVAL' AND approval_expires_at > $1 LIMIT 200`,
        [now],
      );
      return rows.rows.map((row) => ({
        kind: 'REFUND',
        tier: 'LEDGER' as const,
        severity: 'HIGH' as const,
        object_kind: 'REFUND',
        object_id: row.refund_id,
        title: row.trigger_code,
        owner: 'FINANCE_APPROVERS',
        next_action: 'APPROVE_REFUND',
        created_at: row.created_at,
        due_at: row.approval_expires_at,
        amount_at_risk_minor: Number(row.refund_total_minor),
        custody_risk: 'NONE' as const,
      }));
    });

    // Live orders: a deadline passed with nobody acting, a side effect that
    // never ran, a customer's case.
    await add('STALLED_ORDERS', may('admin.order.intervene'), async () => {
      const { stalled_orders } = await this.#stalledOrders(now);
      return (
        stalled_orders as {
          vendor_order_id: string;
          order_reference: string;
          stall_reason: string;
          stalled_seconds: string;
        }[]
      ).map((row) => {
        const since = new Date(now.getTime() - Number(row.stalled_seconds) * 1_000);
        return {
          kind: 'ORDER',
          tier: 'LIVE_ORDER' as const,
          severity: 'HIGH' as const,
          object_kind: 'VENDOR_ORDER',
          object_id: row.vendor_order_id,
          title: `${row.stall_reason} ${row.order_reference}`,
          owner: 'OPERATIONS',
          next_action: 'INTERVENE_ON_ORDER',
          created_at: since,
          // The deadline the order sat past has already gone.
          due_at: since,
          amount_at_risk_minor: 0,
          custody_risk: 'NONE' as const,
        };
      });
    });
    await add('DEAD_LETTERS', may('admin.messaging.deadletter_read'), async () => {
      const rows = await this.#pool.query<{
        event_id: string;
        event_type: string;
        occurred_at: Date;
      }>(
        `SELECT event_id, event_type, updated_at AS occurred_at FROM marketplace.outbox_events
          WHERE status = 'DEAD_LETTER' LIMIT 200`,
      );
      return rows.rows.map((row) => ({
        kind: 'DEAD_LETTER',
        tier: 'LIVE_ORDER' as const,
        severity: 'HIGH' as const,
        object_kind: 'OUTBOX_EVENT',
        object_id: row.event_id,
        title: row.event_type,
        owner: 'OPERATIONS',
        next_action: 'RECOVER_OR_EXPLAIN_EVENT',
        created_at: row.occurred_at,
        amount_at_risk_minor: 0,
        custody_risk: 'NONE' as const,
      }));
    });
    await add('SUPPORT', may('admin.support.case_manage'), async () => {
      const rows = await this.#pool.query<{
        support_case_id: string;
        category: string;
        severity: 'CRITICAL' | 'HIGH' | 'LOW' | 'MEDIUM';
        owner_user_id: string | null;
        owner_team: string | null;
        response_due_at: Date | null;
        lifecycle_state: string;
        created_at: Date;
      }>(
        `SELECT support_case_id, category, severity, owner_user_id, owner_team, response_due_at,
                lifecycle_state, created_at
           FROM marketplace.support_cases
          WHERE lifecycle_state NOT IN ('RESOLVED','WITHDRAWN') AND merged_into_case_id IS NULL
          LIMIT 500`,
      );
      return rows.rows.map((row) => ({
        kind: 'SUPPORT',
        tier: 'LIVE_ORDER' as const,
        severity: row.severity,
        object_kind: 'SUPPORT_CASE',
        object_id: row.support_case_id,
        title: row.category,
        owner: row.owner_user_id ? `USER-${row.owner_user_id}` : (row.owner_team ?? 'SUPPORT'),
        next_action: row.lifecycle_state === 'OPEN' ? 'FIRST_RESPONSE' : 'CONTINUE_CASE',
        created_at: row.created_at,
        due_at: row.response_due_at,
        amount_at_risk_minor: 0,
        custody_risk: 'NONE' as const,
      }));
    });

    // Compliance: people and shops waiting to be let in, documents to check,
    // listings held for review.
    await add('PARTNER_REVIEW', may('admin.partner_application.review'), async () => {
      const applications = await this.#pool.query<{
        partner_application_id: string;
        lifecycle_state: string;
        submitted_at: Date | null;
        created_at: Date;
      }>(
        `SELECT partner_application_id, lifecycle_state, submitted_at, created_at
           FROM marketplace.partner_applications
          WHERE lifecycle_state IN ('SUBMITTED','UNDER_REVIEW') LIMIT 200`,
      );
      const renewals = await this.#pool.query<{
        partner_document_renewal_id: string;
        document_kind: string;
        created_at: Date;
      }>(
        `SELECT partner_document_renewal_id, document_kind, created_at
           FROM marketplace.partner_document_renewals WHERE lifecycle_state='SUBMITTED' LIMIT 200`,
      );
      return [
        ...applications.rows.map((row) => ({
          kind: 'PARTNER_APPLICATION',
          tier: 'COMPLIANCE' as const,
          severity: 'MEDIUM' as const,
          object_kind: 'PARTNER_APPLICATION',
          object_id: row.partner_application_id,
          title: row.lifecycle_state,
          owner: 'PARTNER_REVIEW',
          next_action: row.lifecycle_state === 'SUBMITTED' ? 'START_REVIEW' : 'DECIDE_APPLICATION',
          created_at: row.submitted_at ?? row.created_at,
          amount_at_risk_minor: 0,
          custody_risk: 'NONE' as const,
        })),
        ...renewals.rows.map((row) => ({
          kind: 'PARTNER_DOCUMENT',
          tier: 'COMPLIANCE' as const,
          severity: 'MEDIUM' as const,
          object_kind: 'PARTNER_DOCUMENT_RENEWAL',
          object_id: row.partner_document_renewal_id,
          title: row.document_kind,
          owner: 'PARTNER_REVIEW',
          next_action: 'VERIFY_DOCUMENT',
          created_at: row.created_at,
          amount_at_risk_minor: 0,
          custody_risk: 'NONE' as const,
        })),
      ];
    });
    await add('VENDOR_ONBOARDING', may('admin.vendor_onboarding.review'), async () => {
      const rows = await this.#pool.query<{
        onboarding_case_id: string;
        lifecycle_state: string;
        submitted_at: Date | null;
        created_at: Date;
      }>(
        `SELECT onboarding_case_id, lifecycle_state, submitted_at, created_at
           FROM marketplace.vendor_onboarding_cases
          WHERE lifecycle_state IN ('PENDING','UNDER_REVIEW') LIMIT 200`,
      );
      return rows.rows.map((row) => ({
        kind: 'VENDOR_ONBOARDING',
        tier: 'COMPLIANCE' as const,
        severity: 'MEDIUM' as const,
        object_kind: 'VENDOR_ONBOARDING_CASE',
        object_id: row.onboarding_case_id,
        title: row.lifecycle_state,
        owner: 'VENDOR_ONBOARDING',
        next_action: row.lifecycle_state === 'PENDING' ? 'START_REVIEW' : 'DECIDE_ONBOARDING',
        created_at: row.submitted_at ?? row.created_at,
        amount_at_risk_minor: 0,
        custody_risk: 'NONE' as const,
      }));
    });
    await add('CATALOGUE_MODERATION', may('admin.catalogue.moderate'), async () => {
      const rows = await this.#pool.query<{
        moderation_case_id: string;
        reason_code: string;
        created_at: Date;
      }>(
        `SELECT moderation_case_id, reason_code, created_at
           FROM marketplace.catalogue_moderation_cases WHERE moderation_state='PENDING' LIMIT 200`,
      );
      return rows.rows.map((row) => ({
        kind: 'CATALOGUE',
        tier: 'COMPLIANCE' as const,
        severity: 'LOW' as const,
        object_kind: 'CATALOGUE_MODERATION_CASE',
        object_id: row.moderation_case_id,
        title: row.reason_code,
        owner: 'CATALOGUE_MODERATION',
        next_action: 'MODERATE_LISTING',
        created_at: row.created_at,
        amount_at_risk_minor: 0,
        custody_risk: 'NONE' as const,
      }));
    });

    // Routine: a shop ready to go live, waiting for its reviewer.
    await add('VENDOR_PUBLICATION', may('admin.vendor_publication.review'), async () => {
      const rows = await this.#pool.query<{
        publication_case_id: string;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT publication_case_id, created_at, updated_at
           FROM marketplace.vendor_publication_cases WHERE lifecycle_state='PENDING_APPROVAL'
          LIMIT 200`,
      );
      return rows.rows.map((row) => ({
        kind: 'VENDOR_PUBLICATION',
        tier: 'ROUTINE' as const,
        severity: 'LOW' as const,
        object_kind: 'VENDOR_PUBLICATION_CASE',
        object_id: row.publication_case_id,
        title: 'PENDING_APPROVAL',
        owner: 'VENDOR_PUBLICATION',
        next_action: 'APPROVE_PUBLICATION',
        created_at: row.updated_at,
        amount_at_risk_minor: 0,
        custody_risk: 'NONE' as const,
      }));
    });

    const items = rankWork(raw, now);
    const auditEventId = createUuidV7();
    await this.#pool.query(
      `INSERT INTO marketplace.operational_audit_events
        (operational_audit_event_id,action,target_kind,target_reference,actor_id,reason_code,
         before_value,after_value,request_id,correlation_id)
       VALUES ($1,'DASHBOARD_VIEWED','ADMIN_DASHBOARD',$6,$2,'OPERATOR_VIEW',NULL,$3,$4,$5)`,
      [
        auditEventId,
        actor,
        JSON.stringify({ queues, items: items.length }),
        parseRequestId(input.context.request_id),
        parseUuidV7(input.context.correlation_id),
        String(actor),
      ],
    );
    return {
      items,
      queues,
      generated_at: now.toISOString(),
      trace: {
        request_id: input.context.request_id,
        correlation_id: input.context.correlation_id,
        audit_event_id: auditEventId,
      },
    };
  }

  /**
   * Checkout groups and the vendor orders under them.
   *
   * `stalled_only` narrows this to orders sitting past a deadline that has
   * already passed — an unanswered acceptance, an unanswered customer decision,
   * an offer nobody took. Every one of those deadlines already existed; nothing
   * asked which of them had quietly run out.
   */
  async orderMonitor(input: {
    readonly context: RequestContext;
    readonly checkout_group_id?: UuidV7;
    readonly stalled_only?: boolean;
    readonly now?: Date;
  }) {
    admin(input.context);
    if (input.stalled_only) return this.#stalledOrders(input.now ?? new Date());
    const r = await this.#pool.query<{
      lifecycle_state: string;
      orders: readonly { state: string; fulfilment_method: string | null }[];
    }>(
      `SELECT cg.*,COALESCE(json_agg(json_build_object('vendor_order_id',o.vendor_order_id,'reference',o.order_reference,'state',o.lifecycle_state,'vendor_location_id',o.vendor_location_id,'fulfilment_method',cvg.fulfilment_method) ORDER BY o.order_reference) FILTER(WHERE o.vendor_order_id IS NOT NULL),'[]') orders
         FROM marketplace.checkout_groups cg
         LEFT JOIN marketplace.vendor_orders o USING(checkout_group_id)
         LEFT JOIN marketplace.checkout_quote_groups cqg
           ON cqg.checkout_quote_id=cg.checkout_quote_id AND cqg.vendor_location_id=o.vendor_location_id
         LEFT JOIN marketplace.cart_vendor_groups cvg USING(cart_vendor_group_id)
        WHERE ($1::uuid IS NULL OR cg.checkout_group_id=$1)
        GROUP BY cg.checkout_group_id ORDER BY cg.updated_at DESC LIMIT 100`,
      [input.checkout_group_id ?? null],
    );
    // The monitor shows what a group is, derived from its orders (7.7), next
    // to the stored payment state it used to show alone.
    return {
      checkout_groups: r.rows.map((row) => ({
        ...row,
        derived_lifecycle_state: deriveCheckoutGroupState({
          payment_state: row.lifecycle_state,
          orders: row.orders.map((order) => ({
            lifecycle_state: order.state,
            fulfilment_method: order.fulfilment_method,
          })),
        }),
      })),
    };
  }
  /**
   * Domain events that exhausted every retry and stopped.
   *
   * The outbox refuses to lose an event — an unhandled or failing one goes to
   * the dead-letter path rather than being acknowledged — but nothing surfaced
   * that path to a human. A side effect that never ran was invisible: a payment
   * uncaptured, a partner unpaid, a customer untold, with nothing to look at.
   */
  async deadLetterQueue(input: { readonly context: RequestContext; readonly limit?: number }) {
    admin(input.context);
    const events = await listDeadLetterEvents(this.#pool, Math.min(input.limit ?? 50, 100));
    return {
      events: events.map((event) => ({
        aggregate_id: event.aggregate_id,
        aggregate_type: event.aggregate_type,
        attempt_count: event.attempt_count,
        event_id: event.event_id,
        event_type: event.event_type,
        last_error_code: event.last_error_code,
      })),
    };
  }

  /**
   * Returns one dead-lettered event for redelivery.
   *
   * Separated from reading because it re-runs a side effect that moves real
   * state. The recovery is recorded against the operator who asked for it.
   */
  async recoverDeadLetter(input: {
    readonly context: RequestContext;
    readonly event_id: UuidV7;
    readonly reason_code: string;
  }) {
    const actor = admin(input.context);
    if (!REASON.test(input.reason_code)) {
      throw new AdminControlInputError('Reason code must be shouting-snake-case');
    }
    const recoveryId = await recoverDeadLetterEvent(this.#pool, {
      actor_id: actor,
      event_id: input.event_id,
      reason_code: input.reason_code,
      request_id: parseRequestId(input.context.request_id),
    });
    const client = await this.#pool.connect();
    try {
      await this.#audit(
        client,
        input.context,
        actor,
        'DEAD_LETTER_RECOVERED',
        'OUTBOX_EVENT',
        input.event_id,
        input.reason_code,
        null,
        { recovery_id: recoveryId },
      );
    } finally {
      client.release();
    }
    return { recovery_id: recoveryId };
  }

  async #stalledOrders(now: Date) {
    const stalled = await this.#pool.query(
      `SELECT orders.vendor_order_id, orders.order_reference, orders.lifecycle_state,
              orders.vendor_location_id, orders.checkout_group_id,
              CASE
                WHEN orders.lifecycle_state='PLACED' AND orders.accept_by <= $1
                  THEN 'ACCEPT_DEADLINE_PASSED'
                WHEN decision.decision_id IS NOT NULL THEN 'CUSTOMER_DECISION_OVERDUE'
                ELSE 'DELIVERY_OFFER_EXPIRED'
              END AS stall_reason,
              EXTRACT(EPOCH FROM ($1 - orders.updated_at))::bigint::text AS stalled_seconds
         FROM marketplace.vendor_orders orders
         LEFT JOIN LATERAL (
           SELECT d.decision_id FROM marketplace.vendor_order_customer_decisions d
            WHERE d.vendor_order_id = orders.vendor_order_id
              AND d.answer='PENDING' AND d.decision_deadline_at <= $1
            LIMIT 1
         ) decision ON true
         LEFT JOIN marketplace.delivery_assignments assignment
           ON assignment.vendor_order_id = orders.vendor_order_id
          AND assignment.assignment_state IN ('UNASSIGNED','OFFER_EXPIRED','DECLINED')
        WHERE orders.lifecycle_state NOT IN ('DELIVERED','RETURNED','CANCELLED','EXPIRED')
          AND (
            (orders.lifecycle_state='PLACED' AND orders.accept_by <= $1)
            OR decision.decision_id IS NOT NULL
            OR (assignment.delivery_assignment_id IS NOT NULL
                AND orders.lifecycle_state IN ('READY','PICKED_UP'))
          )
        ORDER BY orders.updated_at
        LIMIT 100`,
      [now],
    );
    return { stalled_orders: stalled.rows };
  }

  /**
   * Opens a support case against one order.
   *
   * Accepts the system as an actor as well as an administrator, because some
   * cases should not wait for a person to notice: an order whose goods came
   * back has already failed, and leaving it in a state nobody reads is how a
   * customer ends up chasing their own refund. The route above is still
   * capability-gated; only the worker reaches this as `system`.
   */
  async createSupportCase(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly category: string;
    readonly description: string;
    readonly severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    readonly response_due_at: Date;
  }) {
    const who = operationsAutomation(input.context);
    if (input.description.trim().length < 1 || input.description.length > 1000)
      throw new AdminControlInputError('Support description is invalid');
    return tx(this.#pool, async (client) => {
      const existing = await client.query(
        `SELECT * FROM marketplace.support_cases WHERE vendor_order_id=$1 AND category=$2
          AND lifecycle_state IN ('OPEN','IN_PROGRESS') ORDER BY created_at LIMIT 1 FOR UPDATE`,
        [input.vendor_order_id, reason(input.category)],
      );
      if (existing.rows[0]) return { ...existing.rows[0], deduplicated: true };
      const supportCaseId = createUuidV7();
      const r = await client.query(
        `INSERT INTO marketplace.support_cases(support_case_id,vendor_order_id,opened_by_user_id,
          category,description,severity,response_due_at,request_id,correlation_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          supportCaseId,
          input.vendor_order_id,
          who,
          reason(input.category),
          input.description.trim(),
          input.severity,
          input.response_due_at,
          parseRequestId(input.context.request_id),
          parseUuidV7(input.context.correlation_id),
        ],
      );
      await client.query(
        `INSERT INTO marketplace.support_case_events(support_case_event_id,support_case_id,event_type,
          actor_id,reason_code,request_id,correlation_id) VALUES($1,$2,'OPENED',$3,$4,$5,$6)`,
        [
          createUuidV7(),
          supportCaseId,
          who,
          reason(input.category),
          parseRequestId(input.context.request_id),
          parseUuidV7(input.context.correlation_id),
        ],
      );
      await this.#audit(
        client,
        input.context,
        who,
        'SUPPORT_CASE_OPENED',
        'SUPPORT_CASE',
        supportCaseId,
        reason(input.category),
        null,
        { severity: input.severity },
      );
      return { ...r.rows[0], deduplicated: false };
    });
  }
  async attachSupportEvidence(input: {
    readonly context: RequestContext;
    readonly support_case_id: UuidV7;
    readonly evidence_reference: string;
    readonly classification: 'INTERNAL' | 'RESTRICTED';
    readonly reason_code: string;
  }) {
    const who = admin(input.context);
    return tx(this.#pool, async (client) => {
      const exists = await client.query(
        'SELECT 1 FROM marketplace.support_cases WHERE support_case_id=$1',
        [input.support_case_id],
      );
      if (!exists.rows[0]) throw new AdminControlNotFoundError();
      const evidenceId = createUuidV7();
      await client.query(
        `INSERT INTO marketplace.support_case_evidence(support_case_evidence_id,support_case_id,evidence_reference,classification,attached_by_user_id) VALUES($1,$2,$3,$4,$5)`,
        [
          evidenceId,
          input.support_case_id,
          marked(input.evidence_reference),
          input.classification,
          who,
        ],
      );
      await client.query(
        `INSERT INTO marketplace.support_case_events(support_case_event_id,support_case_id,event_type,actor_id,reason_code,payload,request_id,correlation_id) VALUES($1,$2,'EVIDENCE_ATTACHED',$3,$4,$5,$6,$7)`,
        [
          createUuidV7(),
          input.support_case_id,
          who,
          reason(input.reason_code),
          JSON.stringify({
            evidence_reference: input.evidence_reference,
            classification: input.classification,
          }),
          parseRequestId(input.context.request_id),
          parseUuidV7(input.context.correlation_id),
        ],
      );
      return { support_case_evidence_id: evidenceId };
    });
  }
  async mergeSupportCases(input: {
    readonly context: RequestContext;
    readonly source_case_id: UuidV7;
    readonly target_case_id: UuidV7;
    readonly reason_code: string;
  }) {
    const who = admin(input.context);
    if (input.source_case_id === input.target_case_id) throw new AdminControlInputError();
    return tx(this.#pool, async (client) => {
      const r = await client.query(
        `UPDATE marketplace.support_cases SET lifecycle_state='WITHDRAWN',merged_into_case_id=$2,updated_at=clock_timestamp() WHERE support_case_id=$1 AND lifecycle_state IN ('OPEN','IN_PROGRESS') RETURNING support_case_id`,
        [input.source_case_id, input.target_case_id],
      );
      if (!r.rows[0]) throw new AdminControlStateError();
      await client.query(
        `INSERT INTO marketplace.support_case_events(support_case_event_id,support_case_id,event_type,actor_id,reason_code,payload,request_id,correlation_id) VALUES($1,$2,'MERGED',$3,$4,$5,$6,$7)`,
        [
          createUuidV7(),
          input.source_case_id,
          who,
          reason(input.reason_code),
          JSON.stringify({ target_case_id: input.target_case_id }),
          parseRequestId(input.context.request_id),
          parseUuidV7(input.context.correlation_id),
        ],
      );
      return { merged: true };
    });
  }
  async supportAction(input: {
    readonly context: RequestContext;
    readonly support_case_id: UuidV7;
    readonly action:
      'ASSIGN' | 'NOTE' | 'MESSAGE' | 'RESOLVE' | 'REOPEN' | 'ESCALATE' | 'QUALITY_REVIEW';
    readonly reason_code: string;
    readonly body?: string;
    readonly owner_user_id?: UuidV7;
    readonly owner_team?: string;
  }) {
    const who = admin(input.context);
    return tx(this.#pool, async (client) => {
      const c = await client.query<{ lifecycle_state: string }>(
        'SELECT * FROM marketplace.support_cases WHERE support_case_id=$1 FOR UPDATE',
        [input.support_case_id],
      );
      if (!c.rows[0]) throw new AdminControlNotFoundError();
      const state =
        input.action === 'RESOLVE'
          ? 'RESOLVED'
          : input.action === 'REOPEN'
            ? 'OPEN'
            : input.action === 'ASSIGN' || input.action === 'ESCALATE'
              ? 'IN_PROGRESS'
              : c.rows[0].lifecycle_state;
      await client.query(
        `UPDATE marketplace.support_cases SET lifecycle_state=$2,owner_user_id=COALESCE($3,owner_user_id),owner_team=COALESCE($4,owner_team),updated_at=clock_timestamp() WHERE support_case_id=$1`,
        [input.support_case_id, state, input.owner_user_id ?? null, input.owner_team ?? null],
      );
      if (input.body) {
        await client.query(
          `INSERT INTO marketplace.support_case_messages(support_case_message_id,support_case_id,author_user_id,audience,body) VALUES($1,$2,$3,$4,$5)`,
          [
            createUuidV7(),
            input.support_case_id,
            who,
            input.action === 'MESSAGE' ? 'PARTICIPANT' : 'INTERNAL',
            input.body,
          ],
        );
      }
      await this.#audit(
        client,
        input.context,
        who,
        `SUPPORT_${input.action}`,
        'SUPPORT_CASE',
        input.support_case_id,
        reason(input.reason_code),
        null,
        { lifecycle_state: state },
      );
      await client.query(
        `INSERT INTO marketplace.support_case_events(support_case_event_id,support_case_id,event_type,actor_id,reason_code,request_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          createUuidV7(),
          input.support_case_id,
          input.action === 'NOTE'
            ? 'NOTE_ADDED'
            : input.action === 'MESSAGE'
              ? 'MESSAGE_SENT'
              : input.action === 'QUALITY_REVIEW'
                ? 'QUALITY_REVIEWED'
                : input.action === 'ASSIGN'
                  ? 'ASSIGNED'
                  : input.action === 'RESOLVE'
                    ? 'RESOLVED'
                    : input.action === 'REOPEN'
                      ? 'REOPENED'
                      : 'ESCALATED',
          who,
          reason(input.reason_code),
          parseRequestId(input.context.request_id),
          parseUuidV7(input.context.correlation_id),
        ],
      );
      return { support_case_id: input.support_case_id, lifecycle_state: state };
    });
  }
  async proposeTrust(input: {
    readonly context: RequestContext;
    readonly subject_kind: string;
    readonly subject_reference: string;
    readonly scope_kind: string;
    readonly scope_reference: string;
    readonly reason_code: string;
    readonly evidence_reference: string;
    readonly policy_reference: string;
    readonly effective_until: Date;
    readonly review_at: Date;
  }) {
    const who = admin(input.context);
    if (input.review_at > input.effective_until) throw new AdminControlInputError();
    const r = await this.#pool.query(
      `INSERT INTO marketplace.trust_restriction_cases(trust_restriction_case_id,subject_kind,subject_reference,scope_kind,scope_reference,reason_code,evidence_reference,policy_reference,proposed_by_user_id,effective_until,review_at,request_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        createUuidV7(),
        input.subject_kind,
        marked(input.subject_reference),
        input.scope_kind,
        marked(input.scope_reference),
        reason(input.reason_code),
        marked(input.evidence_reference),
        marked(input.policy_reference),
        who,
        input.effective_until,
        input.review_at,
        parseRequestId(input.context.request_id),
        parseUuidV7(input.context.correlation_id),
      ],
    );
    return r.rows[0];
  }
  async approveTrust(input: {
    readonly context: RequestContext;
    readonly trust_restriction_case_id: UuidV7;
    readonly expected_version: number;
    readonly reason_code: string;
  }) {
    const who = admin(input.context);
    const r = await this.#pool.query(
      `UPDATE marketplace.trust_restriction_cases SET lifecycle_state='ACTIVE',approved_by_user_id=$2::uuid,version=version+1,updated_at=clock_timestamp() WHERE trust_restriction_case_id=$1 AND lifecycle_state='PROPOSED' AND version=$3 AND proposed_by_user_id<>$2::uuid RETURNING *`,
      [input.trust_restriction_case_id, who, input.expected_version],
    );
    if (!r.rows[0]) throw new AdminControlStateError();
    await this.#pool.query(
      `INSERT INTO marketplace.operational_audit_events(operational_audit_event_id,action,target_kind,target_reference,actor_id,reason_code,request_id,correlation_id,approval_reference)VALUES($1,'TRUST_RESTRICTION_APPROVED','TRUST_RESTRICTION',$2::text,$3,$4,$5,$6,$2::uuid)`,
      [
        createUuidV7(),
        input.trust_restriction_case_id,
        who,
        reason(input.reason_code),
        parseRequestId(input.context.request_id),
        parseUuidV7(input.context.correlation_id),
      ],
    );
    return r.rows[0];
  }
  async transitionTrust(input: {
    readonly context: RequestContext;
    readonly trust_restriction_case_id: UuidV7;
    readonly expected_version: number;
    readonly action: 'REJECT' | 'REVOKE';
    readonly reason_code: string;
  }) {
    const who = admin(input.context);
    const from = input.action === 'REJECT' ? 'PROPOSED' : 'ACTIVE';
    const to = input.action === 'REJECT' ? 'REJECTED' : 'REVOKED';
    const r = await this.#pool.query(
      `UPDATE marketplace.trust_restriction_cases SET lifecycle_state=$4,version=version+1,updated_at=clock_timestamp() WHERE trust_restriction_case_id=$1 AND lifecycle_state=$2 AND version=$3 RETURNING *`,
      [input.trust_restriction_case_id, from, input.expected_version, to],
    );
    if (!r.rows[0]) throw new AdminControlStateError();
    await this.#pool.query(
      `INSERT INTO marketplace.operational_audit_events(operational_audit_event_id,action,target_kind,target_reference,actor_id,reason_code,request_id,correlation_id)VALUES($1,$2,'TRUST_RESTRICTION',$3,$4,$5,$6,$7)`,
      [
        createUuidV7(),
        `TRUST_RESTRICTION_${to}`,
        input.trust_restriction_case_id,
        who,
        reason(input.reason_code),
        parseRequestId(input.context.request_id),
        parseUuidV7(input.context.correlation_id),
      ],
    );
    return r.rows[0];
  }
  async setIncident(input: {
    readonly context: RequestContext;
    readonly control_key: string;
    readonly scope_kind: string;
    readonly scope_reference: string;
    readonly reason_code: string;
    readonly expires_at: Date;
    readonly review_at: Date;
    readonly obligations: object;
  }) {
    const who = admin(input.context);
    if (input.review_at > input.expires_at) throw new AdminControlInputError();
    const r = await this.#pool.query(
      `INSERT INTO marketplace.incident_controls(incident_control_id,control_key,scope_kind,scope_reference,reason_code,owner_user_id,expires_at,review_at,obligations,request_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(control_key,scope_kind,scope_reference) DO UPDATE SET lifecycle_state='ACTIVE',reason_code=EXCLUDED.reason_code,owner_user_id=EXCLUDED.owner_user_id,expires_at=EXCLUDED.expires_at,review_at=EXCLUDED.review_at,obligations=EXCLUDED.obligations,updated_at=clock_timestamp() RETURNING *`,
      [
        createUuidV7(),
        input.control_key,
        input.scope_kind,
        marked(input.scope_reference),
        reason(input.reason_code),
        who,
        input.expires_at,
        input.review_at,
        JSON.stringify(input.obligations),
        parseRequestId(input.context.request_id),
        parseUuidV7(input.context.correlation_id),
      ],
    );
    return r.rows[0];
  }
  async revokeIncident(input: {
    readonly context: RequestContext;
    readonly incident_control_id: UuidV7;
    readonly reason_code: string;
  }) {
    const who = admin(input.context);
    const r = await this.#pool.query(
      `UPDATE marketplace.incident_controls SET lifecycle_state='REVOKED',updated_at=clock_timestamp() WHERE incident_control_id=$1 AND lifecycle_state='ACTIVE' RETURNING *`,
      [input.incident_control_id],
    );
    if (!r.rows[0]) throw new AdminControlStateError();
    await this.#pool.query(
      `INSERT INTO marketplace.operational_audit_events(operational_audit_event_id,action,target_kind,target_reference,actor_id,reason_code,request_id,correlation_id)VALUES($1,'INCIDENT_CONTROL_REVOKED','INCIDENT_CONTROL',$2,$3,$4,$5,$6)`,
      [
        createUuidV7(),
        input.incident_control_id,
        who,
        reason(input.reason_code),
        parseRequestId(input.context.request_id),
        parseUuidV7(input.context.correlation_id),
      ],
    );
    return r.rows[0];
  }
  async expireOperationalControls(input: {
    readonly context: RequestContext;
    readonly now?: Date;
  }) {
    operator(input.context);
    const now = input.now ?? new Date();
    const trust = await this.#pool.query(
      `UPDATE marketplace.trust_restriction_cases SET lifecycle_state='EXPIRED',version=version+1,updated_at=$1 WHERE lifecycle_state='ACTIVE' AND effective_until<=$1`,
      [now],
    );
    const incidents = await this.#pool.query(
      `UPDATE marketplace.incident_controls SET lifecycle_state='EXPIRED',updated_at=$1 WHERE lifecycle_state='ACTIVE' AND expires_at<=$1`,
      [now],
    );
    return { trust: trust.rowCount ?? 0, incidents: incidents.rowCount ?? 0 };
  }
  async audit(input: { readonly context: RequestContext; readonly query?: string }) {
    admin(input.context);
    const r = await this.#pool.query(
      `SELECT * FROM marketplace.operational_audit_events WHERE ($1::text IS NULL OR action ILIKE '%'||$1||'%' OR target_reference ILIKE '%'||$1||'%' OR reason_code ILIKE '%'||$1||'%') ORDER BY occurred_at DESC LIMIT 200`,
      [input.query ?? null],
    );
    return { events: r.rows };
  }
  async report(input: { readonly context: RequestContext; readonly report_kind: string }) {
    admin(input.context);
    const queries: Record<string, string> = {
      FINANCE: `SELECT count(*) open_exceptions,COALESCE(sum(amount_at_risk_minor),0) risk_minor FROM marketplace.finance_exceptions WHERE exception_state<>'RESOLVED'`,
      SUPPORT: `SELECT lifecycle_state,count(*) count FROM marketplace.support_cases GROUP BY lifecycle_state`,
      MARKETPLACE: `SELECT lifecycle_state,count(*) count FROM marketplace.checkout_groups GROUP BY lifecycle_state`,
      DELIVERY_OPERATIONS: `SELECT assignment_state,count(*) count FROM marketplace.delivery_assignments GROUP BY assignment_state`,
      RISK: `SELECT lifecycle_state,count(*) count FROM marketplace.trust_restriction_cases GROUP BY lifecycle_state`,
      VENDOR_HEALTH: `SELECT lifecycle_state,count(*) count FROM marketplace.vendor_locations GROUP BY lifecycle_state`,
      CUSTOMER_FUNNEL: `SELECT lifecycle_state,count(*) count FROM marketplace.carts GROUP BY lifecycle_state`,
    };
    const query = queries[input.report_kind];
    if (!query) throw new AdminControlInputError();
    return {
      definition: `Synthetic ${input.report_kind} snapshot; freshness is query time.`,
      rows: (await this.#pool.query(query)).rows,
    };
  }
  async createExport(input: {
    readonly context: RequestContext;
    readonly report_kind: string;
    readonly filters: object;
    readonly classification: 'INTERNAL' | 'RESTRICTED';
  }) {
    const who = admin(input.context);
    const token = createUuidV7();
    const r = await this.#pool.query(
      `INSERT INTO marketplace.report_exports(report_export_id,report_kind,filters,classification,exported_by_user_id,expires_at,download_token_hash,request_id,correlation_id)VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '15 minutes',$6,$7,$8)RETURNING report_export_id,expires_at`,
      [
        createUuidV7(),
        input.report_kind,
        JSON.stringify(input.filters),
        input.classification,
        who,
        createHash('sha256').update(token).digest('hex'),
        parseRequestId(input.context.request_id),
        parseUuidV7(input.context.correlation_id),
      ],
    );
    return { ...r.rows[0], download_token: `synthetic-export-${token}` };
  }
  async redeemExport(input: { readonly context: RequestContext; readonly download_token: string }) {
    const who = admin(input.context);
    const raw = input.download_token.replace(/^synthetic-export-/, '');
    let token: UuidV7;
    try {
      token = parseUuidV7(raw);
    } catch {
      throw new AdminControlInputError('Export token is invalid');
    }
    return tx(this.#pool, async (client) => {
      const r = await client.query(
        `UPDATE marketplace.report_exports SET downloaded_at=clock_timestamp(),downloaded_by_user_id=$2 WHERE download_token_hash=$1 AND downloaded_at IS NULL AND expires_at>clock_timestamp() RETURNING *`,
        [createHash('sha256').update(token).digest('hex'), who],
      );
      const row = r.rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new AdminControlNotFoundError();
      const report = await this.report({
        context: input.context,
        report_kind: String(row['report_kind']),
      });
      await this.#audit(
        client,
        input.context,
        who,
        'REPORT_EXPORT_DOWNLOADED',
        'REPORT_EXPORT',
        parseUuidV7(String(row['report_export_id'])),
        'REPORT_EXPORT_DOWNLOADED',
        null,
        { classification: row['classification'] },
      );
      return {
        filename: `${String(row['report_kind']).toLowerCase()}-${String(row['report_export_id']).slice(0, 8)}.json`,
        classification: row['classification'],
        content: JSON.stringify(report),
      };
    });
  }
  async #audit(
    client: PoolClient,
    context: RequestContext,
    actor: UuidV7,
    action: string,
    targetKind: string,
    targetRef: UuidV7,
    reasonCode: string,
    before: object | null,
    after: object | null,
  ) {
    await client.query(
      `INSERT INTO marketplace.operational_audit_events(operational_audit_event_id,action,target_kind,target_reference,actor_id,reason_code,before_value,after_value,request_id,correlation_id)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        createUuidV7(),
        action,
        targetKind,
        targetRef,
        actor,
        reasonCode,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        parseRequestId(context.request_id),
        parseUuidV7(context.correlation_id),
      ],
    );
  }
}
