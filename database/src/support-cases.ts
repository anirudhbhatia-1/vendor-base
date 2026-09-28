import { releaseServicePool, resolveServicePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import type { Pool, PoolClient } from 'pg';
import { globalAdminCapabilities } from './admin-capabilities.js';
import { transaction as tx } from './transaction.js';
import { resolveConfiguration } from './versioned-configuration.js';
import {
  ESCALATION_OWNER,
  RESPONSE_WINDOW_MS,
  rankWork,
  type WorkSeverity,
} from './work-ranking.js';

export class SupportCaseInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}
export class SupportCaseNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';
}
export class SupportCaseStateError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
}
export class SupportCaseAuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
}

/** Lowest first, so escalation is one step along. */
export const SUPPORT_SEVERITIES: readonly WorkSeverity[] = Object.freeze([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

type SupportSubject = 'LINE' | 'DELIVERY' | 'ORDER';

/**
 * What a case may be about, the smallest object it attaches to, the severity
 * it opens at (D-09), and whether a customer may raise it. A case about an
 * item names the line when the customer knows it; a case about the delivery
 * attaches to the delivery attempt; everything else to the order.
 */
export const SUPPORT_CATEGORIES = Object.freeze({
  MISSING_ITEM: { subject: 'LINE', severity: 'MEDIUM', customer: true },
  DAMAGED_ITEM: { subject: 'LINE', severity: 'MEDIUM', customer: true },
  WRONG_ITEM: { subject: 'LINE', severity: 'MEDIUM', customer: true },
  LATE_DELIVERY: { subject: 'DELIVERY', severity: 'MEDIUM', customer: true },
  // The goods are with a partner and the customer wants out: a live order
  // blocked, which D-09 calls high.
  CANCELLATION_AFTER_PICKUP: { subject: 'DELIVERY', severity: 'HIGH', customer: true },
  ORDER_HELP: { subject: 'ORDER', severity: 'MEDIUM', customer: true },
  PAYMENT_ISSUE: { subject: 'ORDER', severity: 'MEDIUM', customer: false },
  DELIVERY_RETURNED: { subject: 'DELIVERY', severity: 'HIGH', customer: false },
  PARTNER_CONDUCT: { subject: 'DELIVERY', severity: 'HIGH', customer: false },
} as const satisfies Record<
  string,
  { subject: SupportSubject; severity: WorkSeverity; customer: boolean }
>);
export type SupportCategory = keyof typeof SUPPORT_CATEGORIES;
export const CUSTOMER_SUPPORT_CATEGORIES: readonly SupportCategory[] = Object.freeze(
  (Object.keys(SUPPORT_CATEGORIES) as SupportCategory[]).filter(
    (category) => SUPPORT_CATEGORIES[category].customer,
  ),
);

/** Medium's first response is the configured P2 acknowledgement; four hours by default. */
export const DEFAULT_SUPPORT_RESPONSE_SECONDS = 14_400;

/** How often an open case owes the customer an update after the first reply (D-09). */
export const UPDATE_CADENCE_MS: Readonly<Record<WorkSeverity, number>> = Object.freeze({
  CRITICAL: 15 * 60_000,
  HIGH: 30 * 60_000,
  MEDIUM: 24 * 3_600_000,
  LOW: 48 * 3_600_000,
});

/** The teams a case can sit with: the D-09 resolution owners. */
export const SUPPORT_TEAMS: readonly string[] = Object.freeze([
  ...new Set(Object.values(ESCALATION_OWNER)),
]);

export const RESOLUTION_CODES = Object.freeze([
  'REFUNDED',
  'REPLACED',
  'EXPLAINED',
  'FIXED_BY_STORE',
  'FIXED_BY_DELIVERY',
  'NO_FAULT_FOUND',
  'CUSTOMER_UNRESPONSIVE',
] as const);
export type ResolutionCode = (typeof RESOLUTION_CODES)[number];

export const QUALITY_OUTCOMES = Object.freeze(['PASS', 'NEEDS_COACHING', 'FAIL'] as const);

export const SUPPORT_ACTIONS = Object.freeze([
  'ASSIGN',
  'NOTE',
  'MESSAGE',
  'REQUEST_RESPONSE',
  'ESCALATE',
  'RESOLVE',
  'REOPEN',
  'QUALITY_REVIEW',
  'EVIDENCE',
  'MERGE',
] as const);
export type SupportAction = (typeof SUPPORT_ACTIONS)[number];

const EVENT_FOR: Readonly<Record<SupportAction, string>> = Object.freeze({
  ASSIGN: 'ASSIGNED',
  NOTE: 'NOTE_ADDED',
  MESSAGE: 'MESSAGE_SENT',
  REQUEST_RESPONSE: 'RESPONSE_REQUESTED',
  ESCALATE: 'ESCALATED',
  RESOLVE: 'RESOLVED',
  REOPEN: 'REOPENED',
  QUALITY_REVIEW: 'QUALITY_REVIEWED',
  EVIDENCE: 'EVIDENCE_ATTACHED',
  MERGE: 'MERGED',
});

const MANAGE = 'admin.support.case_manage';
const QUALITY = 'admin.support.quality_review';
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;
const EVIDENCE = /^SYNTH-EVIDENCE-[A-Z0-9-]{4,64}$/;
const RESPONSE_REQUEST_DEFAULT_SECONDS = 172_800;
const ACTIVE = ['OPEN', 'IN_PROGRESS'];

type CaseRow = {
  support_case_id: string;
  vendor_order_id: string;
  vendor_order_line_id: string | null;
  delivery_assignment_id: string | null;
  customer_user_id: string;
  opened_by_user_id: string;
  category: string;
  description: string;
  lifecycle_state: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'WITHDRAWN';
  severity: WorkSeverity;
  owner_user_id: string | null;
  owner_team: string | null;
  awaiting: 'OPERATIONS' | 'PARTICIPANT' | 'NONE';
  response_due_at: Date | null;
  response_clock_started_at: Date | null;
  first_responded_at: Date | null;
  merged_into_case_id: string | null;
  resolution_code: string | null;
  resolution_refund_id: string | null;
  resolved_at: Date | null;
  resolved_by_user_id: string | null;
  reopen_count: number;
  quality_review_outcome: string | null;
  quality_reviewed_by_user_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  order_reference: string;
};

/**
 * What can be done to a case in its state. Open work can be taken, answered,
 * asked, escalated, resolved, evidenced or merged away; a resolved case can
 * be noted, evidenced, reopened, or reviewed once; a merged case is history.
 */
export function supportActionsFor(row: {
  readonly lifecycle_state: string;
  readonly severity: string;
  readonly quality_review_outcome: string | null;
}): readonly SupportAction[] {
  if (ACTIVE.includes(row.lifecycle_state)) {
    return SUPPORT_ACTIONS.filter(
      (action) =>
        !['REOPEN', 'QUALITY_REVIEW'].includes(action) &&
        (action !== 'ESCALATE' || row.severity !== 'CRITICAL'),
    );
  }
  if (row.lifecycle_state === 'RESOLVED') {
    return SUPPORT_ACTIONS.filter(
      (action) =>
        ['NOTE', 'EVIDENCE', 'REOPEN'].includes(action) ||
        (action === 'QUALITY_REVIEW' && row.quality_review_outcome === null),
    );
  }
  return [];
}

/** What operations should do next with a case. */
export function supportNextAction(
  row: {
    readonly lifecycle_state: string;
    readonly awaiting: string;
    readonly first_responded_at: Date | null;
    readonly response_due_at: Date | null;
    readonly quality_review_outcome: string | null;
  },
  now: Date,
): string {
  if (ACTIVE.includes(row.lifecycle_state)) {
    if (row.awaiting === 'PARTICIPANT') {
      return row.response_due_at && row.response_due_at.getTime() <= now.getTime()
        ? 'FOLLOW_UP'
        : 'AWAIT_CUSTOMER';
    }
    return row.first_responded_at === null ? 'FIRST_RESPONSE' : 'RESPOND';
  }
  if (row.lifecycle_state === 'RESOLVED' && row.quality_review_outcome === null) {
    return 'QUALITY_REVIEW';
  }
  return 'NONE';
}

function contextIds(context: RequestContext) {
  return {
    request: parseRequestId(context.request_id),
    correlation: parseUuidV7(context.correlation_id),
  };
}

function severity(value: string): WorkSeverity {
  if (!(SUPPORT_SEVERITIES as readonly string[]).includes(value)) {
    throw new SupportCaseInputError(`Severity must be one of ${SUPPORT_SEVERITIES.join(', ')}`);
  }
  return value as WorkSeverity;
}

function text(value: string | undefined, max: number, what: string): string {
  const trimmed = (value ?? '').trim();
  if (trimmed.length < 1 || trimmed.length > max) {
    throw new SupportCaseInputError(`${what} must be between 1 and ${max} characters`);
  }
  return trimmed;
}

function later(now: Date, ms: number): Date {
  return new Date(now.getTime() + ms);
}

function snapshot(row: CaseRow) {
  return {
    lifecycle_state: row.lifecycle_state,
    awaiting: row.awaiting,
    severity: row.severity,
    owner_user_id: row.owner_user_id,
    owner_team: row.owner_team,
    response_due_at: row.response_due_at?.toISOString() ?? null,
    version: row.version,
  };
}

const CASE_COLUMNS = new Set([
  'lifecycle_state',
  'severity',
  'owner_user_id',
  'owner_team',
  'awaiting',
  'response_due_at',
  'response_clock_started_at',
  'first_responded_at',
  'merged_into_case_id',
  'resolution_code',
  'resolution_refund_id',
  'resolved_at',
  'resolved_by_user_id',
  'reopen_count',
  'quality_review_outcome',
  'quality_reviewed_by_user_id',
  'quality_reviewed_at',
]);

/**
 * Support cases (11.3), from the customer's report to the quality review.
 *
 * A case is opened by the customer, by operations or by the worker, and
 * always belongs to the order's customer, who reads its participant thread
 * and answers it; a second report of the same trouble is added to the open
 * case rather than opening another. It attaches to the smallest object it is
 * about, sits with the D-09 owner of its severity, and carries the deadline
 * of whoever's turn it is: the first response, the next update, or the time
 * operations follow up a question the customer has not answered. Internal
 * notes and evidence never reach the customer. Every step is versioned, on
 * the case history and on the operational audit, and resolving names what
 * was done -- a refund only when one was approved.
 */
export class SupportCaseService {
  readonly #pool: Pool;

  constructor(input: { readonly connection_string: string; readonly pool?: Pool }) {
    this.#pool = resolveServicePool(input, {
      application_name: 'neighbourhood-store-support-cases',
      max: 6,
    });
  }

  async close() {
    await releaseServicePool(this.#pool);
  }

  /** First response by severity (D-09); medium reads the configured P2 acknowledgement. */
  async firstResponseMs(level: WorkSeverity, at: Date): Promise<number> {
    if (level !== 'MEDIUM') return RESPONSE_WINDOW_MS[level];
    const resolved = await resolveConfiguration(this.#pool, {
      configuration_key: 'support.p2_staffed_ack_seconds',
      configuration_kind: 'SETTING',
      at,
    });
    const value = resolved?.configuration_value;
    const seconds =
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 60 && value <= 604_800
        ? value
        : DEFAULT_SUPPORT_RESPONSE_SECONDS;
    return seconds * 1000;
  }

  /**
   * Opens a case, or adds the report to the open case about the same order,
   * category and item (requirements 1-3).
   */
  async open(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly category: string;
    readonly description: string;
    readonly vendor_order_line_id?: UuidV7 | null;
    readonly delivery_assignment_id?: UuidV7 | null;
    readonly severity?: string;
    readonly now?: Date;
  }): Promise<{
    readonly support_case_id: UuidV7;
    readonly deduplicated: boolean;
    readonly version: number;
  }> {
    const actor = input.context.actor;
    const kind = actor?.actor_kind;
    if (!actor || (kind !== 'customer' && kind !== 'admin' && kind !== 'system')) {
      throw new SupportCaseAuthorizationError();
    }
    if (!Object.hasOwn(SUPPORT_CATEGORIES, input.category)) {
      throw new SupportCaseInputError(
        `Category must be one of ${Object.keys(SUPPORT_CATEGORIES).join(', ')}`,
      );
    }
    const category = input.category as SupportCategory;
    const rule = SUPPORT_CATEGORIES[category];
    if (kind === 'customer' && !rule.customer) {
      throw new SupportCaseInputError(
        `Category must be one of ${CUSTOMER_SUPPORT_CATEGORIES.join(', ')}`,
      );
    }
    const description = text(input.description, 1000, 'Description');
    let level: WorkSeverity = rule.severity;
    if (input.severity !== undefined) {
      if (kind === 'customer') {
        throw new SupportCaseInputError('The severity of a case is not the customer to choose');
      }
      level = severity(input.severity);
    }
    const lineId = input.vendor_order_line_id ?? null;
    if (lineId !== null && rule.subject !== 'LINE') {
      throw new SupportCaseInputError(
        `${category} is about the ${rule.subject.toLowerCase()}, not an item`,
      );
    }
    if ((input.delivery_assignment_id ?? null) !== null && rule.subject !== 'DELIVERY') {
      throw new SupportCaseInputError(`${category} is not about a delivery`);
    }
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    return tx(this.#pool, async (client) => {
      if (kind === 'admin') await this.#require(client, actor.actor_id, now, MANAGE);
      const order = await client.query<{ customer_user_id: string; order_reference: string }>(
        `SELECT grouping.customer_user_id, o.order_reference
           FROM marketplace.vendor_orders o
           JOIN marketplace.checkout_groups grouping USING (checkout_group_id)
          WHERE o.vendor_order_id = $1`,
        [input.vendor_order_id],
      );
      const found = order.rows[0];
      if (!found || (kind === 'customer' && found.customer_user_id !== actor.actor_id)) {
        throw new SupportCaseNotFoundError();
      }
      if (lineId !== null) {
        const line = await client.query(
          `SELECT 1 FROM marketplace.vendor_order_lines
            WHERE vendor_order_line_id = $1 AND vendor_order_id = $2`,
          [lineId, input.vendor_order_id],
        );
        if (line.rows.length === 0) throw new SupportCaseNotFoundError();
      }
      let assignmentId: string | null = input.delivery_assignment_id ?? null;
      if (assignmentId !== null) {
        const attempt = await client.query(
          `SELECT 1 FROM marketplace.delivery_assignments
            WHERE delivery_assignment_id = $1 AND vendor_order_id = $2`,
          [assignmentId, input.vendor_order_id],
        );
        if (attempt.rows.length === 0) throw new SupportCaseNotFoundError();
      } else if (rule.subject === 'DELIVERY') {
        const latest = await client.query<{ delivery_assignment_id: string }>(
          `SELECT delivery_assignment_id FROM marketplace.delivery_assignments
            WHERE vendor_order_id = $1 ORDER BY created_at DESC, delivery_assignment_id DESC LIMIT 1`,
          [input.vendor_order_id],
        );
        assignmentId = latest.rows[0]?.delivery_assignment_id ?? null;
      }

      // One open case per order, category and item: two reports racing in
      // take turns here, and the unique index is the backstop.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1117))', [
        `support:${input.vendor_order_id}:${category}:${lineId ?? 'ORDER'}`,
      ]);
      const existing = await client.query<CaseRow>(
        `SELECT c.*, $4::text AS order_reference FROM marketplace.support_cases c
          WHERE c.vendor_order_id = $1 AND c.category = $2
            AND c.vendor_order_line_id IS NOT DISTINCT FROM $3::uuid
            AND c.lifecycle_state IN ('OPEN','IN_PROGRESS')
          FOR UPDATE`,
        [input.vendor_order_id, category, lineId, found.order_reference],
      );
      const current = existing.rows[0];
      if (current) {
        const fromCustomer = kind === 'customer';
        await this.#message(client, {
          case_id: current.support_case_id,
          author: actor.actor_id,
          audience: fromCustomer ? 'PARTICIPANT' : 'INTERNAL',
          kind: 'DUPLICATE_REPORT',
          body: description,
          now,
        });
        const turn = fromCustomer ? await this.#customerTurn(current, now) : {};
        const updated = await this.#update(client, current, turn, now);
        await this.#event(
          client,
          current.support_case_id,
          'DUPLICATE_REPORTED',
          actor.actor_id,
          category,
          ids,
          now,
          {
            reported_by: kind,
          },
        );
        await this.#audit(client, input.context, actor.actor_id, {
          action: 'SUPPORT_CASE_DUPLICATE_REPORTED',
          case_id: current.support_case_id,
          reason_code: category,
          before: snapshot(current),
          after: snapshot(updated),
        });
        return {
          support_case_id: parseUuidV7(current.support_case_id),
          deduplicated: true,
          version: updated.version,
        };
      }

      const caseId = createUuidV7({ now_ms: now.getTime() });
      const due = later(now, await this.firstResponseMs(level, now));
      const inserted = await client.query<CaseRow>(
        `INSERT INTO marketplace.support_cases
           (support_case_id, vendor_order_id, vendor_order_line_id, delivery_assignment_id,
            customer_user_id, opened_by_user_id, category, description, severity, owner_team,
            awaiting, response_due_at, response_clock_started_at, request_id, correlation_id,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'OPERATIONS',$11,$12,$13,$14,$12,$12)
         RETURNING *, $15::text AS order_reference`,
        [
          caseId,
          input.vendor_order_id,
          lineId,
          assignmentId,
          found.customer_user_id,
          actor.actor_id,
          category,
          description,
          level,
          ESCALATION_OWNER[level],
          due,
          now,
          ids.request,
          ids.correlation,
          found.order_reference,
        ],
      );
      const opened = inserted.rows[0] as CaseRow;
      const subject = lineId !== null ? 'LINE' : assignmentId !== null ? 'DELIVERY' : 'ORDER';
      await this.#event(client, caseId, 'OPENED', actor.actor_id, category, ids, now, {
        severity: level,
        subject,
      });
      // The order's own history says a case was opened, whoever opened it;
      // the customer is told from there.
      await client.query(
        `INSERT INTO marketplace.vendor_order_events
           (event_id, vendor_order_id, event_type, actor_id, actor_kind, previous_state,
            resulting_state, reason_code, request_id, correlation_id, occurred_at)
         VALUES ($1,$2,'SUPPORT_CASE_OPENED',$3,$4,NULL,NULL,$5,$6,$7,$8)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          input.vendor_order_id,
          actor.actor_id,
          kind,
          category,
          ids.request,
          ids.correlation,
          now,
        ],
      );
      await this.#audit(client, input.context, actor.actor_id, {
        action: 'SUPPORT_CASE_OPENED',
        case_id: caseId,
        reason_code: category,
        before: null,
        after: { ...snapshot(opened), subject },
      });
      return { support_case_id: caseId, deduplicated: false, version: opened.version };
    });
  }

  /**
   * The support queue, ranked the way the dashboard ranks all work (11.1),
   * or the resolved cases waiting for someone else's quality review, or the
   * closed ones.
   */
  async queue(input: {
    readonly context: RequestContext;
    readonly view?: 'ACTIVE' | 'QUALITY_SAMPLE' | 'CLOSED';
    readonly owner?: 'ANY' | 'ME' | 'UNASSIGNED';
    readonly team?: string;
    readonly severity?: string;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const actor = await this.#admin(this.#pool, input.context, now);
    const view = input.view ?? 'ACTIVE';
    if (!['ACTIVE', 'QUALITY_SAMPLE', 'CLOSED'].includes(view)) {
      throw new SupportCaseInputError('View must be ACTIVE, QUALITY_SAMPLE or CLOSED');
    }
    const owner = input.owner ?? 'ANY';
    if (!['ANY', 'ME', 'UNASSIGNED'].includes(owner)) {
      throw new SupportCaseInputError('Owner must be ANY, ME or UNASSIGNED');
    }
    if (input.team !== undefined && !SUPPORT_TEAMS.includes(input.team)) {
      throw new SupportCaseInputError(`Team must be one of ${SUPPORT_TEAMS.join(', ')}`);
    }
    const level = input.severity === undefined ? null : severity(input.severity);
    const rows = await this.#pool.query<CaseRow & { line_title: string | null }>(
      `SELECT c.*, o.order_reference, line.product_title_snapshot AS line_title
         FROM marketplace.support_cases c
         JOIN marketplace.vendor_orders o USING (vendor_order_id)
         LEFT JOIN marketplace.vendor_order_lines line
           ON line.vendor_order_line_id = c.vendor_order_line_id
        WHERE CASE $1::text
                WHEN 'ACTIVE' THEN c.lifecycle_state IN ('OPEN','IN_PROGRESS')
                WHEN 'QUALITY_SAMPLE' THEN c.lifecycle_state = 'RESOLVED'
                  AND c.quality_review_outcome IS NULL AND c.resolved_by_user_id <> $2
                ELSE c.lifecycle_state IN ('RESOLVED','WITHDRAWN')
              END
          AND CASE $3::text
                WHEN 'ME' THEN c.owner_user_id = $2
                WHEN 'UNASSIGNED' THEN c.owner_user_id IS NULL
                ELSE true
              END
          AND ($4::text IS NULL OR c.owner_team = $4)
          AND ($5::text IS NULL OR c.severity = $5)
        ORDER BY COALESCE(c.resolved_at, c.updated_at) DESC
        LIMIT 500`,
      [view, actor, owner, input.team ?? null, level],
    );
    const byId = new Map(rows.rows.map((row) => [row.support_case_id, row]));
    const shape = (row: CaseRow & { line_title: string | null }) => ({
      support_case_id: row.support_case_id,
      vendor_order_id: row.vendor_order_id,
      order_reference: row.order_reference,
      category: row.category,
      subject_kind: row.vendor_order_line_id
        ? 'LINE'
        : row.delivery_assignment_id
          ? 'DELIVERY'
          : 'ORDER',
      line_title: row.line_title,
      severity: row.severity,
      lifecycle_state: row.lifecycle_state,
      awaiting: row.awaiting,
      owner_user_id: row.owner_user_id,
      owner_team: row.owner_team,
      mine: row.owner_user_id === actor,
      response_due_at: row.response_due_at?.toISOString() ?? null,
      next_action: supportNextAction(row, now),
      resolution_code: row.resolution_code,
      resolved_at: row.resolved_at?.toISOString() ?? null,
      reopen_count: row.reopen_count,
      version: row.version,
      created_at: row.created_at.toISOString(),
    });
    if (view !== 'ACTIVE') {
      return { view, cases: rows.rows.slice(0, 100).map(shape) };
    }
    const ranked = rankWork(
      rows.rows.map((row) => ({
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
      })),
      now,
    );
    return {
      view,
      cases: ranked.map((item) => {
        const row = byId.get(item.object_id) as CaseRow & { line_title: string | null };
        return {
          ...shape(row),
          rank: item.rank,
          escalate_at: item.escalate_at,
          overdue: item.overdue,
          escalation_due: item.escalation_due,
        };
      }),
    };
  }

  /**
   * One case as operations work it: the participant thread and the internal
   * notes apart, the evidence, the history, and what can be done next. The
   * look is on the audit.
   */
  async detail(input: {
    readonly context: RequestContext;
    readonly support_case_id: UuidV7;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const actor = await this.#admin(this.#pool, input.context, now);
    const found = await this.#pool.query<
      CaseRow & { line_title: string | null; assignment_state: string | null }
    >(
      `SELECT c.*, o.order_reference, line.product_title_snapshot AS line_title,
              attempt.assignment_state
         FROM marketplace.support_cases c
         JOIN marketplace.vendor_orders o USING (vendor_order_id)
         LEFT JOIN marketplace.vendor_order_lines line
           ON line.vendor_order_line_id = c.vendor_order_line_id
         LEFT JOIN marketplace.delivery_assignments attempt
           ON attempt.delivery_assignment_id = c.delivery_assignment_id
        WHERE c.support_case_id = $1`,
      [input.support_case_id],
    );
    const row = found.rows[0];
    if (!row) throw new SupportCaseNotFoundError();
    const [messages, evidence, events, merged] = await Promise.all([
      this.#pool.query<{
        support_case_message_id: string;
        author_user_id: string;
        audience: 'INTERNAL' | 'PARTICIPANT';
        message_kind: string;
        body: string;
        created_at: Date;
      }>(
        `SELECT support_case_message_id, author_user_id, audience, message_kind, body, created_at
           FROM marketplace.support_case_messages WHERE support_case_id = $1
          ORDER BY created_at, support_case_message_id`,
        [input.support_case_id],
      ),
      this.#pool.query<{
        support_case_evidence_id: string;
        evidence_reference: string;
        classification: string;
        attached_by_user_id: string;
        created_at: Date;
      }>(
        `SELECT support_case_evidence_id, evidence_reference, classification,
                attached_by_user_id, created_at
           FROM marketplace.support_case_evidence WHERE support_case_id = $1 ORDER BY created_at`,
        [input.support_case_id],
      ),
      this.#pool.query<{
        support_case_event_id: string;
        event_type: string;
        actor_id: string;
        reason_code: string;
        payload: Record<string, unknown>;
        occurred_at: Date;
      }>(
        `SELECT support_case_event_id, event_type, actor_id, reason_code, payload, occurred_at
           FROM marketplace.support_case_events WHERE support_case_id = $1
          ORDER BY occurred_at, support_case_event_id`,
        [input.support_case_id],
      ),
      this.#pool.query<{ support_case_id: string }>(
        `SELECT support_case_id FROM marketplace.support_cases
          WHERE merged_into_case_id = $1 ORDER BY created_at`,
        [input.support_case_id],
      ),
    ]);
    await this.#audit(this.#pool, input.context, actor, {
      action: 'SUPPORT_CASE_VIEWED',
      case_id: row.support_case_id,
      reason_code: 'OPERATOR_VIEW',
      before: null,
      after: null,
    });
    const message = (entry: (typeof messages.rows)[number]) => ({
      support_case_message_id: entry.support_case_message_id,
      author_role: entry.author_user_id === row.customer_user_id ? 'CUSTOMER' : 'SUPPORT',
      author_user_id: entry.author_user_id,
      message_kind: entry.message_kind,
      body: entry.body,
      created_at: entry.created_at.toISOString(),
    });
    return {
      support_case_id: row.support_case_id,
      vendor_order_id: row.vendor_order_id,
      order_reference: row.order_reference,
      category: row.category,
      description: row.description,
      subject: row.vendor_order_line_id
        ? { kind: 'LINE', vendor_order_line_id: row.vendor_order_line_id, title: row.line_title }
        : row.delivery_assignment_id
          ? {
              kind: 'DELIVERY',
              delivery_assignment_id: row.delivery_assignment_id,
              assignment_state: row.assignment_state,
            }
          : { kind: 'ORDER' },
      customer_user_id: row.customer_user_id,
      opened_by_user_id: row.opened_by_user_id,
      severity: row.severity,
      lifecycle_state: row.lifecycle_state,
      awaiting: row.awaiting,
      owner_user_id: row.owner_user_id,
      owner_team: row.owner_team,
      response_due_at: row.response_due_at?.toISOString() ?? null,
      first_responded_at: row.first_responded_at?.toISOString() ?? null,
      merged_into_case_id: row.merged_into_case_id,
      merged_cases: merged.rows.map((entry) => entry.support_case_id),
      resolution: row.resolution_code
        ? {
            code: row.resolution_code,
            refund_id: row.resolution_refund_id,
            resolved_at: row.resolved_at?.toISOString() ?? null,
            resolved_by_user_id: row.resolved_by_user_id,
          }
        : null,
      quality_review: row.quality_review_outcome
        ? {
            outcome: row.quality_review_outcome,
            reviewed_by_user_id: row.quality_reviewed_by_user_id,
          }
        : null,
      reopen_count: row.reopen_count,
      version: row.version,
      next_action: supportNextAction(row, now),
      allowed_actions: supportActionsFor(row),
      participant_thread: messages.rows.filter((m) => m.audience === 'PARTICIPANT').map(message),
      internal_notes: messages.rows.filter((m) => m.audience === 'INTERNAL').map(message),
      evidence: evidence.rows.map((entry) => ({
        ...entry,
        created_at: entry.created_at.toISOString(),
      })),
      history: events.rows.map((entry) => ({
        ...entry,
        occurred_at: entry.occurred_at.toISOString(),
      })),
      created_at: row.created_at.toISOString(),
    };
  }

  /**
   * One step on a case (requirements 3-5), against the version the operator
   * read, with a reason; refused when the case's state does not allow it.
   */
  async act(input: {
    readonly context: RequestContext;
    readonly support_case_id: UuidV7;
    readonly action: string;
    readonly expected_version: number;
    readonly reason_code: string;
    readonly body?: string;
    readonly owner_user_id?: UuidV7;
    readonly owner_team?: string;
    readonly severity?: string;
    readonly respond_within_seconds?: number;
    readonly resolution_code?: string;
    readonly refund_id?: UuidV7;
    readonly outcome?: string;
    readonly evidence_reference?: string;
    readonly classification?: string;
    readonly target_case_id?: UuidV7;
    readonly now?: Date;
  }) {
    if (!(SUPPORT_ACTIONS as readonly string[]).includes(input.action)) {
      throw new SupportCaseInputError(`Action must be one of ${SUPPORT_ACTIONS.join(', ')}`);
    }
    const action = input.action as SupportAction;
    if (!REASON.test(input.reason_code)) {
      throw new SupportCaseInputError('Reason code must be shouting-snake-case');
    }
    if (!Number.isSafeInteger(input.expected_version) || input.expected_version < 1) {
      throw new SupportCaseInputError('Expected version must be a positive integer');
    }
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    return tx(this.#pool, async (client) => {
      const actor = await this.#admin(client, input.context, now);
      if (action === 'QUALITY_REVIEW') await this.#require(client, actor, now, QUALITY);
      // A merge locks both cases, always in the same order.
      if (action === 'MERGE') {
        if (!input.target_case_id) throw new SupportCaseInputError('Name the case to merge into');
        if (input.target_case_id === input.support_case_id) {
          throw new SupportCaseInputError('A case cannot be merged into itself');
        }
        await client.query(
          `SELECT 1 FROM marketplace.support_cases WHERE support_case_id = ANY($1::uuid[])
            ORDER BY support_case_id FOR UPDATE`,
          [[input.support_case_id, input.target_case_id]],
        );
      }
      const row = await this.#lock(client, input.support_case_id);
      if (row.version !== input.expected_version) {
        throw new SupportCaseStateError('The case changed since it was read; reload it');
      }
      if (!supportActionsFor(row).includes(action)) {
        throw new SupportCaseStateError(
          `${action.replaceAll('_', ' ').toLowerCase()} is not allowed on a ${row.lifecycle_state.toLowerCase()} case`,
        );
      }
      let patch: Record<string, unknown> = {};
      let payload: Record<string, unknown> = {};
      let notify: 'replied' | 'response_requested' | 'resolved' | null = null;
      switch (action) {
        case 'ASSIGN': {
          if (input.owner_user_id === undefined && input.owner_team === undefined) {
            throw new SupportCaseInputError('Name the person or the team the case goes to');
          }
          if (input.owner_team !== undefined && !SUPPORT_TEAMS.includes(input.owner_team)) {
            throw new SupportCaseInputError(`Team must be one of ${SUPPORT_TEAMS.join(', ')}`);
          }
          if (input.owner_user_id !== undefined) {
            const theirs = await globalAdminCapabilities(client, input.owner_user_id, now);
            if (!theirs.has(MANAGE)) {
              throw new SupportCaseInputError('That person cannot work support cases');
            }
          }
          patch = {
            owner_user_id: input.owner_user_id ?? null,
            owner_team: input.owner_team ?? row.owner_team,
            lifecycle_state: input.owner_user_id !== undefined ? 'IN_PROGRESS' : 'OPEN',
          };
          payload = { owner_user_id: patch.owner_user_id, owner_team: patch.owner_team };
          break;
        }
        case 'NOTE': {
          const body = text(input.body, 2000, 'A note');
          payload = {
            support_case_message_id: await this.#message(client, {
              case_id: row.support_case_id,
              author: actor,
              audience: 'INTERNAL',
              kind: 'MESSAGE',
              body,
              now,
            }),
          };
          break;
        }
        case 'MESSAGE': {
          const body = text(input.body, 2000, 'A message');
          payload = {
            support_case_message_id: await this.#message(client, {
              case_id: row.support_case_id,
              author: actor,
              audience: 'PARTICIPANT',
              kind: 'MESSAGE',
              body,
              now,
            }),
          };
          // Answered: the next thing owed is an update at the severity's cadence.
          patch = {
            first_responded_at: row.first_responded_at ?? now,
            awaiting: 'OPERATIONS',
            response_due_at: later(now, UPDATE_CADENCE_MS[row.severity]),
            response_clock_started_at: now,
          };
          notify = 'replied';
          break;
        }
        case 'REQUEST_RESPONSE': {
          const body = text(input.body, 2000, 'The question');
          const within = input.respond_within_seconds ?? RESPONSE_REQUEST_DEFAULT_SECONDS;
          if (!Number.isSafeInteger(within) || within < 3_600 || within > 604_800) {
            throw new SupportCaseInputError(
              'A response is asked for within one hour to seven days',
            );
          }
          payload = {
            respond_within_seconds: within,
            support_case_message_id: await this.#message(client, {
              case_id: row.support_case_id,
              author: actor,
              audience: 'PARTICIPANT',
              kind: 'RESPONSE_REQUEST',
              body,
              now,
            }),
          };
          // The customer's turn; operations follow up if nothing comes back.
          patch = {
            first_responded_at: row.first_responded_at ?? now,
            awaiting: 'PARTICIPANT',
            response_due_at: later(now, within * 1000),
            response_clock_started_at: now,
          };
          notify = 'response_requested';
          break;
        }
        case 'ESCALATE': {
          const from = SUPPORT_SEVERITIES.indexOf(row.severity);
          const to =
            input.severity === undefined ? SUPPORT_SEVERITIES[from + 1] : severity(input.severity);
          if (!to || SUPPORT_SEVERITIES.indexOf(to) <= from) {
            throw new SupportCaseInputError('Escalation raises the severity');
          }
          // The case goes to the owner of the new severity (D-09), unclaimed,
          // and a reply owed now falls due on the tighter window.
          patch = {
            severity: to,
            owner_team: ESCALATION_OWNER[to],
            owner_user_id: null,
            lifecycle_state: 'OPEN',
          };
          if (row.awaiting === 'OPERATIONS') {
            const tighter = later(now, await this.firstResponseMs(to, now));
            if (!row.response_due_at || tighter.getTime() < row.response_due_at.getTime()) {
              patch = { ...patch, response_due_at: tighter, response_clock_started_at: now };
            }
          }
          payload = { from: row.severity, to };
          break;
        }
        case 'RESOLVE': {
          const code = input.resolution_code;
          if (!code || !(RESOLUTION_CODES as readonly string[]).includes(code)) {
            throw new SupportCaseInputError(
              `Resolution must be one of ${RESOLUTION_CODES.join(', ')}`,
            );
          }
          const summary = text(input.body, 2000, 'The resolution the customer reads');
          let refundId: string | null = null;
          if (code === 'REFUNDED') {
            if (!input.refund_id)
              throw new SupportCaseInputError('A refund resolution names the refund');
            const refund = await client.query<{ refund_state: string }>(
              `SELECT refund_state FROM marketplace.refunds
                WHERE refund_id = $1 AND source_order_reference = $2`,
              [input.refund_id, row.order_reference],
            );
            const state = refund.rows[0]?.refund_state;
            if (!state) throw new SupportCaseNotFoundError('No such refund on this order');
            if (!['SUBMITTED', 'SUCCEEDED'].includes(state)) {
              throw new SupportCaseStateError(
                'The refund has not been approved; it cannot resolve a case yet',
              );
            }
            refundId = input.refund_id;
          } else if (input.refund_id !== undefined) {
            throw new SupportCaseInputError('Only a refund resolution names a refund');
          }
          if (
            code === 'CUSTOMER_UNRESPONSIVE' &&
            !(
              row.awaiting === 'PARTICIPANT' &&
              row.response_due_at &&
              row.response_due_at.getTime() <= now.getTime()
            )
          ) {
            throw new SupportCaseStateError(
              'The customer was not asked, or still has time to answer',
            );
          }
          await this.#message(client, {
            case_id: row.support_case_id,
            author: actor,
            audience: 'PARTICIPANT',
            kind: 'RESOLUTION',
            body: summary,
            now,
          });
          patch = {
            lifecycle_state: 'RESOLVED',
            awaiting: 'NONE',
            response_due_at: null,
            response_clock_started_at: null,
            resolution_code: code,
            resolution_refund_id: refundId,
            resolved_at: now,
            resolved_by_user_id: actor,
          };
          payload = { resolution_code: code, refund_id: refundId };
          notify = 'resolved';
          break;
        }
        case 'REOPEN': {
          await this.#noOtherOpen(client, row);
          patch = {
            ...this.#reopened(row, now, await this.firstResponseMs(row.severity, now)),
          };
          payload = { reopen_count: row.reopen_count + 1 };
          break;
        }
        case 'QUALITY_REVIEW': {
          const outcome = input.outcome;
          if (!outcome || !(QUALITY_OUTCOMES as readonly string[]).includes(outcome)) {
            throw new SupportCaseInputError(
              `Outcome must be one of ${QUALITY_OUTCOMES.join(', ')}`,
            );
          }
          if (row.resolved_by_user_id === actor) {
            throw new SupportCaseStateError(
              'A resolution is reviewed by someone who did not resolve it',
            );
          }
          if (outcome !== 'PASS' || input.body !== undefined) {
            await this.#message(client, {
              case_id: row.support_case_id,
              author: actor,
              audience: 'INTERNAL',
              kind: 'MESSAGE',
              body: text(input.body, 2000, 'What the review found'),
              now,
            });
          }
          patch = {
            quality_review_outcome: outcome,
            quality_reviewed_by_user_id: actor,
            quality_reviewed_at: now,
          };
          payload = { outcome };
          break;
        }
        case 'EVIDENCE': {
          const reference = input.evidence_reference ?? '';
          if (!EVIDENCE.test(reference)) {
            throw new SupportCaseInputError('Evidence is a SYNTH-EVIDENCE reference');
          }
          const classification = input.classification ?? 'INTERNAL';
          if (!['INTERNAL', 'RESTRICTED'].includes(classification)) {
            throw new SupportCaseInputError('Evidence is INTERNAL or RESTRICTED');
          }
          const attached = await client.query<{ support_case_evidence_id: string }>(
            `INSERT INTO marketplace.support_case_evidence
               (support_case_evidence_id, support_case_id, evidence_reference, classification,
                attached_by_user_id, created_at)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (support_case_id, evidence_reference) DO NOTHING
             RETURNING support_case_evidence_id`,
            [
              createUuidV7({ now_ms: now.getTime() }),
              row.support_case_id,
              reference,
              classification,
              actor,
              now,
            ],
          );
          if (!attached.rows[0]) {
            throw new SupportCaseStateError('That evidence is already on the case');
          }
          payload = {
            support_case_evidence_id: attached.rows[0].support_case_evidence_id,
            evidence_reference: reference,
            classification,
          };
          break;
        }
        case 'MERGE': {
          const target = await this.#lock(client, input.target_case_id as UuidV7);
          if (!ACTIVE.includes(target.lifecycle_state)) {
            throw new SupportCaseStateError('A case is merged into an open case');
          }
          if (target.vendor_order_id !== row.vendor_order_id) {
            throw new SupportCaseStateError('Only cases about the same order are merged');
          }
          // The case that stays takes the higher severity and the earlier
          // reply owed; cases merged into this one follow it.
          const higher =
            SUPPORT_SEVERITIES.indexOf(row.severity) > SUPPORT_SEVERITIES.indexOf(target.severity)
              ? row.severity
              : target.severity;
          let targetPatch: Record<string, unknown> = { severity: higher };
          if (
            row.awaiting === 'OPERATIONS' &&
            row.response_due_at &&
            (target.awaiting !== 'OPERATIONS' ||
              !target.response_due_at ||
              row.response_due_at.getTime() < target.response_due_at.getTime())
          ) {
            targetPatch = {
              ...targetPatch,
              awaiting: 'OPERATIONS',
              response_due_at: row.response_due_at,
              response_clock_started_at: row.response_clock_started_at,
            };
          }
          const merged = await this.#update(client, target, targetPatch, now);
          await client.query(
            `UPDATE marketplace.support_cases
                SET merged_into_case_id = $2, version = version + 1, updated_at = $3
              WHERE merged_into_case_id = $1`,
            [row.support_case_id, target.support_case_id, now],
          );
          await this.#event(
            client,
            target.support_case_id,
            'MERGE_RECEIVED',
            actor,
            input.reason_code,
            ids,
            now,
            {
              source_case_id: row.support_case_id,
            },
          );
          await this.#audit(client, input.context, actor, {
            action: 'SUPPORT_CASE_MERGE_RECEIVED',
            case_id: target.support_case_id,
            reason_code: input.reason_code,
            before: snapshot(target),
            after: snapshot(merged),
          });
          patch = {
            lifecycle_state: 'WITHDRAWN',
            awaiting: 'NONE',
            merged_into_case_id: target.support_case_id,
          };
          payload = { target_case_id: target.support_case_id };
          break;
        }
      }
      const updated = await this.#update(client, row, patch, now);
      await this.#event(
        client,
        row.support_case_id,
        EVENT_FOR[action],
        actor,
        input.reason_code,
        ids,
        now,
        payload,
      );
      await this.#audit(client, input.context, actor, {
        action: `SUPPORT_CASE_${action}`,
        case_id: row.support_case_id,
        reason_code: input.reason_code,
        before: snapshot(row),
        after: { ...snapshot(updated), ...payload },
      });
      if (notify) await this.#notify(client, updated, notify, ids, now);
      return {
        support_case_id: row.support_case_id,
        action,
        lifecycle_state: updated.lifecycle_state,
        awaiting: updated.awaiting,
        severity: updated.severity,
        response_due_at: updated.response_due_at?.toISOString() ?? null,
        version: updated.version,
        ...payload,
      };
    });
  }

  /** The customer's cases: the ones about their orders, whoever opened them. */
  async customerList(input: { readonly context: RequestContext; readonly limit?: number }) {
    const customer = customerOf(input.context);
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
    const rows = await this.#pool.query<{
      support_case_id: string;
      category: string;
      description: string;
      lifecycle_state: string;
      awaiting: string;
      merged_into_case_id: string | null;
      order_reference: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT c.support_case_id, c.category, c.description, c.lifecycle_state, c.awaiting,
              c.merged_into_case_id, o.order_reference, c.created_at, c.updated_at
         FROM marketplace.support_cases c
         JOIN marketplace.vendor_orders o USING (vendor_order_id)
        WHERE c.customer_user_id = $1
        ORDER BY c.created_at DESC
        LIMIT $2`,
      [customer, limit],
    );
    return rows.rows.map((row) => ({
      support_case_id: row.support_case_id,
      category: row.category,
      description: row.description,
      lifecycle_state: row.lifecycle_state,
      awaiting_you: row.awaiting === 'PARTICIPANT',
      merged_into_case_id: row.merged_into_case_id,
      order_reference: row.order_reference,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    }));
  }

  /**
   * The customer's view of a case: its participant thread only, each message
   * as theirs or support's -- never who at support, never a note, never the
   * evidence.
   */
  async customerDetail(input: {
    readonly context: RequestContext;
    readonly support_case_id: UuidV7;
  }) {
    const customer = customerOf(input.context);
    const found = await this.#pool.query<CaseRow & { line_title: string | null }>(
      `SELECT c.*, o.order_reference, line.product_title_snapshot AS line_title
         FROM marketplace.support_cases c
         JOIN marketplace.vendor_orders o USING (vendor_order_id)
         LEFT JOIN marketplace.vendor_order_lines line
           ON line.vendor_order_line_id = c.vendor_order_line_id
        WHERE c.support_case_id = $1 AND c.customer_user_id = $2`,
      [input.support_case_id, customer],
    );
    const row = found.rows[0];
    if (!row) throw new SupportCaseNotFoundError();
    const messages = await this.#pool.query<{
      support_case_message_id: string;
      author_user_id: string;
      message_kind: string;
      body: string;
      created_at: Date;
    }>(
      `SELECT support_case_message_id, author_user_id, message_kind, body, created_at
         FROM marketplace.support_case_messages
        WHERE support_case_id = $1 AND audience = 'PARTICIPANT'
        ORDER BY created_at, support_case_message_id`,
      [input.support_case_id],
    );
    return {
      support_case_id: row.support_case_id,
      category: row.category,
      description: row.description,
      lifecycle_state: row.lifecycle_state,
      order_reference: row.order_reference,
      line_title: row.line_title,
      awaiting_you: row.awaiting === 'PARTICIPANT',
      // When support owe the next word; while the customer is being asked,
      // the deadline is support's follow-up, not the customer's.
      response_due_at:
        row.awaiting === 'OPERATIONS' ? (row.response_due_at?.toISOString() ?? null) : null,
      resolution_code: row.resolution_code,
      merged_into_case_id: row.merged_into_case_id,
      messages: messages.rows.map((entry) => ({
        support_case_message_id: entry.support_case_message_id,
        from: entry.author_user_id === customer ? 'YOU' : 'SUPPORT',
        message_kind: entry.message_kind,
        body: entry.body,
        created_at: entry.created_at.toISOString(),
      })),
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  /**
   * The customer writes on a case. It becomes support's turn; a resolved case
   * reopens on its own timeline; a case merged away sends the words to the
   * case it went into.
   */
  async customerReply(input: {
    readonly context: RequestContext;
    readonly support_case_id: UuidV7;
    readonly body: string;
    readonly now?: Date;
  }) {
    const customer = customerOf(input.context);
    const body = text(input.body, 2000, 'Message');
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    return tx(this.#pool, async (client) => {
      let row = await this.#lock(client, input.support_case_id);
      if (row.customer_user_id !== customer) throw new SupportCaseNotFoundError();
      if (row.lifecycle_state === 'WITHDRAWN') {
        if (!row.merged_into_case_id) throw new SupportCaseStateError('This case is closed');
        row = await this.#lock(client, row.merged_into_case_id as UuidV7);
        if (row.lifecycle_state === 'WITHDRAWN')
          throw new SupportCaseStateError('This case is closed');
      }
      if (row.lifecycle_state === 'RESOLVED') {
        const other = await this.#otherOpen(client, row);
        if (other) row = await this.#lock(client, other as UuidV7);
      }
      const messageId = await this.#message(client, {
        case_id: row.support_case_id,
        author: customer,
        audience: 'PARTICIPANT',
        kind: 'MESSAGE',
        body,
        now,
      });
      let patch: Record<string, unknown>;
      if (row.lifecycle_state === 'RESOLVED') {
        patch = this.#reopened(row, now, await this.firstResponseMs(row.severity, now));
        await this.#event(
          client,
          row.support_case_id,
          'REOPENED',
          customer,
          'CUSTOMER_REPLIED',
          ids,
          now,
          {
            reopen_count: row.reopen_count + 1,
          },
        );
      } else {
        patch = await this.#customerTurn(row, now);
      }
      const updated = await this.#update(client, row, patch, now);
      await this.#event(
        client,
        row.support_case_id,
        'MESSAGE_SENT',
        customer,
        'CUSTOMER_MESSAGE',
        ids,
        now,
        {
          support_case_message_id: messageId,
        },
      );
      return {
        support_case_id: row.support_case_id,
        support_case_message_id: messageId,
        from: 'YOU' as const,
        body,
        lifecycle_state: updated.lifecycle_state,
        created_at: now.toISOString(),
      };
    });
  }

  // -----------------------------------------------------------------------

  /** Support's turn after the customer speaks: a reply owed on the first-response window, or sooner if one was already due. */
  async #customerTurn(row: CaseRow, now: Date): Promise<Record<string, unknown>> {
    const due = later(now, await this.firstResponseMs(row.severity, now));
    if (
      row.awaiting === 'OPERATIONS' &&
      row.response_due_at &&
      row.response_due_at.getTime() <= due.getTime()
    ) {
      return {};
    }
    return { awaiting: 'OPERATIONS', response_due_at: due, response_clock_started_at: now };
  }

  #reopened(row: CaseRow, now: Date, firstMs: number): Record<string, unknown> {
    return {
      lifecycle_state: row.owner_user_id ? 'IN_PROGRESS' : 'OPEN',
      awaiting: 'OPERATIONS',
      response_due_at: later(now, firstMs),
      response_clock_started_at: now,
      reopen_count: row.reopen_count + 1,
      resolution_code: null,
      resolution_refund_id: null,
      resolved_at: null,
      resolved_by_user_id: null,
      quality_review_outcome: null,
      quality_reviewed_by_user_id: null,
      quality_reviewed_at: null,
    };
  }

  async #otherOpen(client: PoolClient, row: CaseRow): Promise<string | null> {
    const other = await client.query<{ support_case_id: string }>(
      `SELECT support_case_id FROM marketplace.support_cases
        WHERE vendor_order_id = $1 AND category = $2
          AND vendor_order_line_id IS NOT DISTINCT FROM $3::uuid
          AND lifecycle_state IN ('OPEN','IN_PROGRESS') AND support_case_id <> $4`,
      [row.vendor_order_id, row.category, row.vendor_order_line_id, row.support_case_id],
    );
    return other.rows[0]?.support_case_id ?? null;
  }

  async #noOtherOpen(client: PoolClient, row: CaseRow) {
    const other = await this.#otherOpen(client, row);
    if (other) {
      throw new SupportCaseStateError(
        `Case ${other} is already open about the same thing; work on that one`,
      );
    }
  }

  async #lock(client: PoolClient, caseId: UuidV7): Promise<CaseRow> {
    const found = await client.query<CaseRow>(
      `SELECT c.*, o.order_reference
         FROM marketplace.support_cases c
         JOIN marketplace.vendor_orders o USING (vendor_order_id)
        WHERE c.support_case_id = $1
        FOR UPDATE OF c`,
      [caseId],
    );
    const row = found.rows[0];
    if (!row) throw new SupportCaseNotFoundError();
    return row;
  }

  async #update(
    client: PoolClient,
    row: CaseRow,
    patch: Record<string, unknown>,
    now: Date,
  ): Promise<CaseRow> {
    const keys = Object.keys(patch);
    for (const key of keys) {
      if (!CASE_COLUMNS.has(key)) throw new Error(`Not a support case column: ${key}`);
    }
    const sets = keys.map((key, index) => `${key} = $${index + 4}`);
    const updated = await client.query<CaseRow>(
      `UPDATE marketplace.support_cases
          SET ${[...sets, 'version = version + 1', 'updated_at = $3'].join(', ')}
        WHERE support_case_id = $1 AND version = $2
        RETURNING *`,
      [row.support_case_id, row.version, now, ...keys.map((key) => patch[key])],
    );
    const next = updated.rows[0];
    if (!next) throw new SupportCaseStateError('The case changed since it was read; reload it');
    return { ...next, order_reference: row.order_reference };
  }

  async #message(
    client: PoolClient,
    input: {
      readonly case_id: string;
      readonly author: string;
      readonly audience: 'INTERNAL' | 'PARTICIPANT';
      readonly kind: 'MESSAGE' | 'RESPONSE_REQUEST' | 'RESOLUTION' | 'DUPLICATE_REPORT';
      readonly body: string;
      readonly now: Date;
    },
  ): Promise<string> {
    const id = createUuidV7({ now_ms: input.now.getTime() });
    await client.query(
      `INSERT INTO marketplace.support_case_messages
         (support_case_message_id, support_case_id, author_user_id, audience, message_kind, body,
          created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, input.case_id, input.author, input.audience, input.kind, input.body, input.now],
    );
    return id;
  }

  async #event(
    client: PoolClient,
    caseId: string,
    type: string,
    actor: string,
    reasonCode: string,
    ids: ReturnType<typeof contextIds>,
    now: Date,
    payload: Record<string, unknown>,
  ) {
    await client.query(
      `INSERT INTO marketplace.support_case_events
         (support_case_event_id, support_case_id, event_type, actor_id, reason_code, payload,
          request_id, correlation_id, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        createUuidV7({ now_ms: now.getTime() }),
        caseId,
        type,
        actor,
        reasonCode,
        JSON.stringify(payload),
        ids.request,
        ids.correlation,
        now,
      ],
    );
  }

  async #notify(
    client: PoolClient,
    row: CaseRow,
    what: 'replied' | 'response_requested' | 'resolved',
    ids: ReturnType<typeof contextIds>,
    now: Date,
  ) {
    await client.query(
      `INSERT INTO marketplace.notification_intents
         (notification_intent_id, recipient_user_id, notification_kind, template_key,
          template_payload, channels, provider_scenario, source_kind, source_id, source_event_type,
          deduplication_key, request_id, correlation_id, created_at, updated_at)
       VALUES ($1,$2,'SUPPORT',$3,$4,$5,'SUCCESS','support_case',$6,$7,$8,$9,$10,$11,$11)`,
      [
        createUuidV7({ now_ms: now.getTime() }),
        row.customer_user_id,
        `support_case.${what}`,
        JSON.stringify({
          order_reference: row.order_reference,
          support_case_id: row.support_case_id,
        }),
        ['IN_APP', 'PUSH'],
        row.support_case_id,
        `SUPPORT_${what.toUpperCase()}`,
        `support-case:${row.support_case_id}:${row.version}:${what}`,
        ids.request,
        ids.correlation,
        now,
      ],
    );
  }

  async #admin(
    queryable: Pick<Pool | PoolClient, 'query'>,
    context: RequestContext,
    now: Date,
  ): Promise<UuidV7> {
    if (context.actor?.actor_kind !== 'admin') throw new SupportCaseAuthorizationError();
    await this.#require(queryable, context.actor.actor_id, now, MANAGE);
    return context.actor.actor_id;
  }

  async #require(
    queryable: Pick<Pool | PoolClient, 'query'>,
    actor: UuidV7,
    now: Date,
    capability: string,
  ) {
    const held = await globalAdminCapabilities(queryable, actor, now);
    if (!held.has(capability)) throw new SupportCaseAuthorizationError();
  }

  async #audit(
    queryable: Pick<Pool | PoolClient, 'query'>,
    context: RequestContext,
    actor: string,
    input: {
      readonly action: string;
      readonly case_id: string;
      readonly reason_code: string;
      readonly before: Record<string, unknown> | null;
      readonly after: Record<string, unknown> | null;
    },
  ) {
    await queryable.query(
      `INSERT INTO marketplace.operational_audit_events
         (operational_audit_event_id, action, target_kind, target_reference, actor_id, reason_code,
          before_value, after_value, request_id, correlation_id)
       VALUES ($1,$2,'SUPPORT_CASE',$3,$4,$5,$6,$7,$8,$9)`,
      [
        createUuidV7(),
        input.action,
        input.case_id,
        actor,
        input.reason_code,
        input.before ? JSON.stringify(input.before) : null,
        input.after ? JSON.stringify(input.after) : null,
        parseRequestId(context.request_id),
        parseUuidV7(context.correlation_id),
      ],
    );
  }
}

function customerOf(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'customer') throw new SupportCaseAuthorizationError();
  return context.actor.actor_id;
}
