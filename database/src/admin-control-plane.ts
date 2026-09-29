import { deriveCheckoutGroupState } from './checkout-group-state.js';
import { releaseServicePool, resolveServicePool } from './database-pool.js';
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
import { supportNextAction } from './support-cases.js';

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
  constructor(input: { readonly connection_string: string; readonly pool?: Pool }) {
    this.#pool = resolveServicePool(input, {
      application_name: 'neighbourhood-store-admin-control',
      max: 10,
    });
  }
  async close() {
    await releaseServicePool(this.#pool);
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
        // A proposal to decide, a review that has come due, or an appeal to
        // answer (11.4): each is a person's decision the case is waiting on.
        const rows = await this.#pool.query<{
          trust_restriction_case_id: string;
          reason_code: string;
          review_at: Date;
          created_at: Date;
          next_action: 'DECIDE_APPEAL' | 'DECIDE_RESTRICTION' | 'REVIEW_RESTRICTION';
          waiting_since: Date;
        }>(
          `SELECT c.trust_restriction_case_id, c.reason_code, c.review_at, c.created_at,
                  CASE WHEN appeal.created_at IS NOT NULL THEN 'DECIDE_APPEAL'
                       WHEN c.lifecycle_state = 'PROPOSED' THEN 'DECIDE_RESTRICTION'
                       ELSE 'REVIEW_RESTRICTION' END AS next_action,
                  COALESCE(appeal.created_at, c.created_at) AS waiting_since
             FROM marketplace.trust_restriction_cases c
             LEFT JOIN marketplace.trust_appeals appeal
               ON appeal.trust_restriction_case_id = c.trust_restriction_case_id
              AND appeal.lifecycle_state = 'OPEN'
            WHERE c.lifecycle_state = 'PROPOSED'
               OR (c.lifecycle_state = 'ACTIVE' AND (c.review_at <= $1 OR appeal.created_at IS NOT NULL))
            LIMIT 200`,
          [now],
        );
        return rows.rows.map((row) => ({
          kind: 'TRUST',
          tier: 'SAFETY_SECURITY' as const,
          severity: 'HIGH' as const,
          object_kind: 'TRUST_RESTRICTION_CASE',
          object_id: row.trust_restriction_case_id,
          title: row.reason_code,
          owner: 'TRUST_APPROVERS',
          next_action: row.next_action,
          created_at: row.waiting_since,
          due_at: row.next_action === 'DECIDE_APPEAL' ? null : row.review_at,
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
        response_clock_started_at: Date | null;
        first_responded_at: Date | null;
        awaiting: string;
        lifecycle_state: string;
        quality_review_outcome: string | null;
        created_at: Date;
      }>(
        `SELECT support_case_id, category, severity, owner_user_id, owner_team, response_due_at,
                response_clock_started_at, first_responded_at, awaiting, lifecycle_state,
                quality_review_outcome, created_at
           FROM marketplace.support_cases
          WHERE lifecycle_state IN ('OPEN','IN_PROGRESS')
          LIMIT 500`,
      );
      // The deadline is whoever's turn it is (11.3): the first response, the
      // next update, or the follow-up of a question the customer has not
      // answered; escalation runs from when that clock started.
      return rows.rows.map((row) => ({
        kind: 'SUPPORT',
        tier: 'LIVE_ORDER' as const,
        severity: row.severity,
        object_kind: 'SUPPORT_CASE',
        object_id: row.support_case_id,
        title: row.category,
        owner: row.owner_user_id ? `USER-${row.owner_user_id}` : (row.owner_team ?? 'SUPPORT'),
        next_action: supportNextAction(row, now),
        created_at: row.created_at,
        due_at: row.response_due_at,
        due_since: row.response_clock_started_at,
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
    // Lapsed trust restrictions expire through TrustReviewService.expireLapsed
    // (11.4), which writes the decision and the case history.
    const incidents = await this.#pool.query(
      `UPDATE marketplace.incident_controls SET lifecycle_state='EXPIRED',updated_at=$1 WHERE lifecycle_state='ACTIVE' AND expires_at<=$1`,
      [now],
    );
    return { incidents: incidents.rowCount ?? 0 };
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
