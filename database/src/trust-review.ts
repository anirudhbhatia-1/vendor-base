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
import { transaction as tx } from './transaction.js';

export class TrustReviewInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}
export class TrustReviewNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';
}
export class TrustReviewStateError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
}
export class TrustReviewAuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
}

export const TRUST_SUBJECT_KINDS = Object.freeze([
  'CUSTOMER',
  'VENDOR_LOCATION',
  'PARTNER',
  'CATEGORY',
] as const);
export type TrustSubjectKind = (typeof TRUST_SUBJECT_KINDS)[number];
type TrustScopeKind = 'GLOBAL' | 'ZONE' | 'VENDOR_LOCATION' | 'CATEGORY';

/**
 * Where each kind of subject can be restricted, and so what a restriction
 * stops (only new work): a partner is not offered deliveries (and, globally,
 * does not go online); a customer does not place orders; a shop takes no new
 * orders, or none in one category; a category is not sold.
 */
export const TRUST_SCOPES: Readonly<Record<TrustSubjectKind, readonly TrustScopeKind[]>> =
  Object.freeze({
    CUSTOMER: ['GLOBAL', 'ZONE', 'VENDOR_LOCATION'],
    PARTNER: ['GLOBAL', 'ZONE', 'VENDOR_LOCATION'],
    VENDOR_LOCATION: ['GLOBAL', 'CATEGORY'],
    CATEGORY: ['GLOBAL', 'ZONE', 'VENDOR_LOCATION'],
  });

/** Longest a restriction may run, and longest before a person must look again. */
export const MAX_RESTRICTION_DAYS = 90;
export const MAX_REVIEW_DAYS = 30;
/** How far back the queue and a dossier weigh signals. */
export const SIGNAL_WINDOW_DAYS = 90;
const DAY = 86_400_000;

export type EvidenceQuality =
  'NONE' | 'SINGLE_SIGNAL' | 'UNCORROBORATED' | 'CORROBORATED' | 'STRONG';

/**
 * How much the signals behind a case prove (EXC-14). One signal is one
 * signal; several from the same person are one account; two people are
 * corroboration; three, or two with a serious report, are strong.
 */
export function evidenceQuality(
  signals: readonly { readonly reporter_user_id: string | null; readonly weight: number }[],
): EvidenceQuality {
  if (signals.length === 0) return 'NONE';
  if (signals.length === 1) return 'SINGLE_SIGNAL';
  const reporters = new Set(signals.map((signal) => signal.reporter_user_id ?? 'UNATTRIBUTED'));
  const serious = signals.some((signal) => signal.weight >= 3);
  if (reporters.size >= 3 || (reporters.size >= 2 && serious)) return 'STRONG';
  if (reporters.size >= 2) return 'CORROBORATED';
  return 'UNCORROBORATED';
}

/**
 * A restriction is approved only on corroborated signals or evidence a
 * person attached; one account, however often repeated, is a reason to look,
 * not a reason to restrict.
 */
export function approvable(quality: EvidenceQuality, evidenceReference: string | null): boolean {
  return quality === 'CORROBORATED' || quality === 'STRONG' || evidenceReference !== null;
}

export const TRUST_ACTIONS = Object.freeze([
  'APPROVE',
  'REJECT',
  'REVOKE',
  'REVIEW',
  'DECIDE_APPEAL',
] as const);
export type TrustAction = (typeof TRUST_ACTIONS)[number];

export function trustActionsFor(row: {
  readonly lifecycle_state: string;
  readonly open_appeal: boolean;
}): readonly TrustAction[] {
  const base: TrustAction[] =
    row.lifecycle_state === 'PROPOSED'
      ? ['APPROVE', 'REJECT']
      : row.lifecycle_state === 'ACTIVE'
        ? ['REVOKE', 'REVIEW']
        : [];
  return row.open_appeal && base.length > 0 ? [...base, 'DECIDE_APPEAL'] : base;
}

const PROPOSE = 'admin.trust.restriction_propose';
const APPROVE = 'admin.trust.restriction_approve';
/** A signal's source is shown only to someone who may open it; ratings never. */
const LINK_CAPABILITY: Readonly<Record<string, string | null>> = Object.freeze({
  DELIVERY_RATING: null,
  ORDER_RATING: null,
  PARTNER_EXCEPTION: 'admin.control.dashboard_read',
  SUPPORT_CASE: 'admin.support.case_manage',
});
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;
const POLICY = /^SYNTH-POLICY-[A-Z0-9-]{4,64}$/;
const EVIDENCE = /^SYNTH-EVIDENCE-[A-Z0-9-]{4,64}$/;
const CATEGORY = /^[A-Z][A-Z0-9_]{2,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type CaseRow = {
  trust_restriction_case_id: string;
  subject_kind: TrustSubjectKind;
  subject_reference: string;
  scope_kind: TrustScopeKind;
  scope_reference: string;
  lifecycle_state: 'PROPOSED' | 'ACTIVE' | 'REJECTED' | 'EXPIRED' | 'REVOKED';
  reason_code: string;
  evidence_reference: string | null;
  evidence_quality: EvidenceQuality;
  policy_reference: string;
  proposal_note: string | null;
  proposed_by_user_id: string;
  approved_by_user_id: string | null;
  decided_by_user_id: string | null;
  decision_reason_code: string | null;
  effective_until: Date;
  review_at: Date;
  last_review_outcome: string | null;
  last_reviewed_at: Date | null;
  version: number;
  created_at: Date;
};

type SignalRow = {
  trust_signal_id: string;
  signal_kind: string;
  source_kind: string;
  source_id: string;
  reporter_user_id: string | null;
  weight: number;
  observed_at: Date;
  dismissed: boolean;
};

function ids(context: RequestContext) {
  return {
    request: parseRequestId(context.request_id),
    correlation: parseUuidV7(context.correlation_id),
  };
}

function reasonCode(value: string): string {
  if (!REASON.test(value))
    throw new TrustReviewInputError('Reason code must be shouting-snake-case');
  return value;
}

function subjectKind(value: string): TrustSubjectKind {
  if (!(TRUST_SUBJECT_KINDS as readonly string[]).includes(value)) {
    throw new TrustReviewInputError(`Subject must be one of ${TRUST_SUBJECT_KINDS.join(', ')}`);
  }
  return value as TrustSubjectKind;
}

function snapshot(row: CaseRow) {
  return {
    lifecycle_state: row.lifecycle_state,
    effective_until: row.effective_until.toISOString(),
    review_at: row.review_at.toISOString(),
    version: row.version,
  };
}

/**
 * Trust and safety review (11.4).
 *
 * Signals are collected from what already happened -- low ratings, what
 * partners reported at the door, complaints -- and restrict nothing: they
 * form a queue by subject. A reviewer opens a subject's dossier (its signals,
 * how good that evidence is, the objects behind the signals they may open,
 * the work it has under way) and proposes a restriction on a real subject,
 * within the scopes that subject allows, for a bounded time with a review
 * date. A second person approves it only on corroborated signals or attached
 * evidence. In force, it stops only new work -- `marketplace.trust_restricts`
 * is read where work starts -- so orders and goods already moving finish.
 * Every step records who, why, under which policy and version; a review
 * keeps, shortens or lifts it; and the person restricted can appeal, decided
 * by someone who neither proposed nor approved it.
 */
export class TrustReviewService {
  readonly #pool: Pool;

  constructor(input: { readonly connection_string: string; readonly pool?: Pool }) {
    this.#pool = resolveServicePool(input, {
      application_name: 'neighbourhood-store-trust-review',
      max: 4,
    });
  }

  async close() {
    await releaseServicePool(this.#pool);
  }

  /**
   * Reads new signals from the marketplace's own records (requirement 1).
   * Idempotent: a source yields a signal once. It writes nothing but signals.
   */
  async collectSignals(input: {
    readonly context: RequestContext;
    readonly now?: Date;
    readonly lookback_days?: number;
  }): Promise<{ readonly collected: number }> {
    const kind = input.context.actor?.actor_kind;
    if (kind !== 'system' && kind !== 'admin') throw new TrustReviewAuthorizationError();
    const now = input.now ?? new Date();
    const since = new Date(now.getTime() - (input.lookback_days ?? 30) * DAY);
    const result = await this.#pool.query(
      `WITH found AS (
         SELECT 'PARTNER' AS subject_kind, r.partner_user_id::text AS subject_reference,
                'LOW_DELIVERY_RATING' AS signal_kind, 'DELIVERY_RATING' AS source_kind,
                r.delivery_assignment_id AS source_id, r.customer_user_id AS reporter_user_id,
                CASE WHEN r.stars = 1 THEN 2 ELSE 1 END AS weight, r.created_at AS observed_at
           FROM marketplace.delivery_assignment_ratings r
          WHERE r.stars <= 2 AND r.created_at >= $1
         UNION ALL
         SELECT 'VENDOR_LOCATION', o.vendor_location_id::text, 'LOW_ORDER_RATING', 'ORDER_RATING',
                r.vendor_order_id, r.customer_user_id, CASE WHEN r.stars = 1 THEN 2 ELSE 1 END,
                r.created_at
           FROM marketplace.vendor_order_ratings r
           JOIN marketplace.vendor_orders o USING (vendor_order_id)
          WHERE r.stars <= 2 AND r.created_at >= $1
         UNION ALL
         SELECT CASE WHEN e.exception_kind IN ('PROHIBITED_GOODS','VENDOR_DELAY')
                     THEN 'VENDOR_LOCATION' ELSE 'CUSTOMER' END,
                CASE WHEN e.exception_kind IN ('PROHIBITED_GOODS','VENDOR_DELAY')
                     THEN a.vendor_location_id::text ELSE grouping.customer_user_id::text END,
                CASE e.exception_kind
                  WHEN 'PROHIBITED_GOODS' THEN 'PARTNER_REPORTED_PROHIBITED_GOODS'
                  WHEN 'VENDOR_DELAY' THEN 'PARTNER_REPORTED_VENDOR_DELAY'
                  WHEN 'UNREACHABLE_CUSTOMER' THEN 'PARTNER_REPORTED_UNREACHABLE_CUSTOMER'
                  ELSE 'PARTNER_REPORTED_THREAT' END,
                'PARTNER_EXCEPTION', e.delivery_assignment_id, e.partner_user_id,
                CASE WHEN e.exception_kind IN ('THREAT','UNSAFE_LOCATION','PROHIBITED_GOODS')
                     THEN 3 ELSE 1 END,
                e.occurred_at
           FROM marketplace.partner_exception_events e
           JOIN marketplace.delivery_assignments a USING (delivery_assignment_id)
           LEFT JOIN marketplace.vendor_orders o ON o.vendor_order_id = a.vendor_order_id
           LEFT JOIN marketplace.checkout_groups grouping ON grouping.checkout_group_id = o.checkout_group_id
          WHERE e.exception_kind IN ('THREAT','UNSAFE_LOCATION','PROHIBITED_GOODS','VENDOR_DELAY',
                                     'UNREACHABLE_CUSTOMER')
            AND e.occurred_at >= $1
            AND (e.exception_kind IN ('PROHIBITED_GOODS','VENDOR_DELAY')
                 OR grouping.customer_user_id IS NOT NULL)
         UNION ALL
         SELECT 'PARTNER', a.partner_user_id::text, 'PARTNER_CONDUCT_CASE', 'SUPPORT_CASE',
                c.support_case_id, c.opened_by_user_id, 2, c.created_at
           FROM marketplace.support_cases c
           JOIN marketplace.delivery_assignments a USING (delivery_assignment_id)
          WHERE c.category = 'PARTNER_CONDUCT' AND a.partner_user_id IS NOT NULL
            AND c.merged_into_case_id IS NULL AND c.created_at >= $1
         UNION ALL
         SELECT 'VENDOR_LOCATION', o.vendor_location_id::text, 'ITEM_COMPLAINT_CASE', 'SUPPORT_CASE',
                c.support_case_id, c.customer_user_id, 1, c.created_at
           FROM marketplace.support_cases c
           JOIN marketplace.vendor_orders o USING (vendor_order_id)
          WHERE c.category IN ('MISSING_ITEM','DAMAGED_ITEM','WRONG_ITEM')
            AND c.merged_into_case_id IS NULL AND c.created_at >= $1
       )
       INSERT INTO marketplace.trust_signals
         (trust_signal_id, subject_kind, subject_reference, signal_kind, source_kind, source_id,
          reporter_user_id, weight, observed_at, collected_at)
       SELECT gen_random_uuid(), subject_kind, subject_reference, signal_kind, source_kind,
              source_id, reporter_user_id, weight, observed_at, $2
         FROM found
       ON CONFLICT (source_kind, source_id, signal_kind) DO NOTHING`,
      [since, now],
    );
    return { collected: result.rowCount ?? 0 };
  }

  /** Subjects with signals, weightiest first, with how good the evidence is. */
  async queue(input: { readonly context: RequestContext; readonly now?: Date }) {
    const now = input.now ?? new Date();
    await this.#reader(this.#pool, input.context, now);
    const rows = await this.#pool.query<{
      subject_kind: TrustSubjectKind;
      subject_reference: string;
      signals: string;
      weight: string;
      last_observed_at: Date;
      evidence: { reporter_user_id: string | null; weight: number }[];
      open_cases: string;
    }>(
      `SELECT s.subject_kind, s.subject_reference, count(*)::text AS signals,
              sum(s.weight)::text AS weight, max(s.observed_at) AS last_observed_at,
              jsonb_agg(jsonb_build_object('reporter_user_id', s.reporter_user_id,
                                           'weight', s.weight)) AS evidence,
              (SELECT count(*)::text FROM marketplace.trust_restriction_cases c
                WHERE c.subject_kind = s.subject_kind AND c.subject_reference = s.subject_reference
                  AND c.lifecycle_state IN ('PROPOSED','ACTIVE')) AS open_cases
         FROM marketplace.trust_signals s
        WHERE s.observed_at >= $1
          AND NOT EXISTS (SELECT 1 FROM marketplace.trust_signal_dismissals d
                           WHERE d.trust_signal_id = s.trust_signal_id)
        GROUP BY s.subject_kind, s.subject_reference
        ORDER BY sum(s.weight) DESC, max(s.observed_at) DESC
        LIMIT 200`,
      [new Date(now.getTime() - SIGNAL_WINDOW_DAYS * DAY)],
    );
    return {
      subjects: rows.rows.map((row) => ({
        subject_kind: row.subject_kind,
        subject_reference: row.subject_reference,
        signals: Number(row.signals),
        weight: Number(row.weight),
        evidence_quality: evidenceQuality(row.evidence),
        last_observed_at: row.last_observed_at.toISOString(),
        open_cases: Number(row.open_cases),
      })),
    };
  }

  /**
   * One subject as a reviewer weighs it (requirement 2): its signals, the
   * objects behind them that this reviewer may open (the rest counted, not
   * shown; ratings never traced to a customer), the quality of the evidence,
   * the work it has under way, and its cases. The look is on the audit.
   */
  async dossier(input: {
    readonly context: RequestContext;
    readonly subject_kind: string;
    readonly subject_reference: string;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const actor = await this.#reader(this.#pool, input.context, now);
    const kind = subjectKind(input.subject_kind);
    const name = await this.#subjectName(this.#pool, kind, input.subject_reference);
    const held = await globalAdminCapabilities(this.#pool, actor, now);
    const signals = await this.#signals(this.#pool, kind, input.subject_reference, now);
    const live = signals.filter((signal) => !signal.dismissed);
    const cases = await this.#pool.query<CaseRow>(
      `SELECT * FROM marketplace.trust_restriction_cases
        WHERE subject_kind = $1 AND subject_reference = $2 ORDER BY created_at DESC LIMIT 50`,
      [kind, input.subject_reference],
    );
    const withheld: Record<string, number> = {};
    const shown = signals.map((signal) => {
      const needed = LINK_CAPABILITY[signal.source_kind];
      const visible = needed !== null && needed !== undefined && held.has(needed);
      if (!visible) withheld[signal.source_kind] = (withheld[signal.source_kind] ?? 0) + 1;
      return {
        trust_signal_id: signal.trust_signal_id,
        signal_kind: signal.signal_kind,
        source_kind: signal.source_kind,
        weight: signal.weight,
        observed_at: signal.observed_at.toISOString(),
        dismissed: signal.dismissed,
        source: visible ? { kind: signal.source_kind, reference: signal.source_id } : null,
      };
    });
    await this.#audit(this.#pool, input.context, actor, {
      action: 'TRUST_SUBJECT_VIEWED',
      target_kind: 'TRUST_SUBJECT',
      target_reference: `${kind}:${input.subject_reference}`,
      reason_code: 'OPERATOR_VIEW',
      before: null,
      after: null,
    });
    return {
      subject_kind: kind,
      subject_reference: input.subject_reference,
      subject_name: name,
      evidence_quality: evidenceQuality(live),
      signals: shown,
      withheld_sources: withheld,
      in_flight: await this.#inFlight(this.#pool, kind, input.subject_reference),
      allowed_scopes: TRUST_SCOPES[kind],
      cases: cases.rows.map((row) => ({
        trust_restriction_case_id: row.trust_restriction_case_id,
        lifecycle_state: row.lifecycle_state,
        scope_kind: row.scope_kind,
        scope_reference: row.scope_reference,
        reason_code: row.reason_code,
        effective_until: row.effective_until.toISOString(),
        review_at: row.review_at.toISOString(),
      })),
    };
  }

  /** Cases waiting on someone: proposals, reviews due, open appeals. */
  async cases(input: {
    readonly context: RequestContext;
    readonly view?: 'WORK' | 'ALL';
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    await this.#reader(this.#pool, input.context, now);
    const rows = await this.#pool.query<CaseRow & { open_appeal: boolean; next_action: string }>(
      `SELECT c.*,
              EXISTS (SELECT 1 FROM marketplace.trust_appeals a
                       WHERE a.trust_restriction_case_id = c.trust_restriction_case_id
                         AND a.lifecycle_state = 'OPEN') AS open_appeal,
              CASE
                WHEN EXISTS (SELECT 1 FROM marketplace.trust_appeals a
                              WHERE a.trust_restriction_case_id = c.trust_restriction_case_id
                                AND a.lifecycle_state = 'OPEN') THEN 'DECIDE_APPEAL'
                WHEN c.lifecycle_state = 'PROPOSED' THEN 'APPROVE_OR_REJECT'
                WHEN c.lifecycle_state = 'ACTIVE' AND c.review_at <= $1 THEN 'REVIEW_DUE'
                WHEN c.lifecycle_state = 'ACTIVE' THEN 'IN_FORCE'
                ELSE 'NONE'
              END AS next_action
         FROM marketplace.trust_restriction_cases c
        WHERE ($2::text = 'ALL' OR c.lifecycle_state IN ('PROPOSED','ACTIVE'))
        ORDER BY c.review_at, c.created_at
        LIMIT 200`,
      [now, input.view ?? 'WORK'],
    );
    return {
      cases: rows.rows.map((row) => ({
        trust_restriction_case_id: row.trust_restriction_case_id,
        subject_kind: row.subject_kind,
        subject_reference: row.subject_reference,
        scope_kind: row.scope_kind,
        scope_reference: row.scope_reference,
        lifecycle_state: row.lifecycle_state,
        reason_code: row.reason_code,
        evidence_quality: row.evidence_quality,
        effective_until: row.effective_until.toISOString(),
        review_at: row.review_at.toISOString(),
        next_action: row.next_action,
        version: row.version,
      })),
    };
  }

  /** One case: its evidence, history, appeals, what it would stop, and what is allowed. */
  async detail(input: {
    readonly context: RequestContext;
    readonly trust_restriction_case_id: UuidV7;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const actor = await this.#reader(this.#pool, input.context, now);
    const found = await this.#pool.query<CaseRow>(
      'SELECT * FROM marketplace.trust_restriction_cases WHERE trust_restriction_case_id = $1',
      [input.trust_restriction_case_id],
    );
    const row = found.rows[0];
    if (!row) throw new TrustReviewNotFoundError();
    const [linked, events, appeals] = await Promise.all([
      this.#pool.query<{
        trust_signal_id: string;
        signal_kind: string;
        weight: number;
        reporter_user_id: string | null;
      }>(
        `SELECT s.trust_signal_id, s.signal_kind, s.weight, s.reporter_user_id
           FROM marketplace.trust_restriction_signals l
           JOIN marketplace.trust_signals s USING (trust_signal_id)
          WHERE l.trust_restriction_case_id = $1 ORDER BY s.observed_at`,
        [row.trust_restriction_case_id],
      ),
      this.#pool.query<{
        event_type: string;
        actor_id: string;
        reason_code: string;
        case_version: number;
        payload: Record<string, unknown>;
        occurred_at: Date;
      }>(
        `SELECT event_type, actor_id, reason_code, case_version, payload, occurred_at
           FROM marketplace.trust_case_events WHERE trust_restriction_case_id = $1
          ORDER BY occurred_at, trust_case_event_id`,
        [row.trust_restriction_case_id],
      ),
      this.#pool.query<{
        trust_appeal_id: string;
        appellant_user_id: string;
        statement: string;
        lifecycle_state: string;
        case_version: number;
        created_at: Date;
      }>(
        `SELECT trust_appeal_id, appellant_user_id, statement, lifecycle_state, case_version, created_at
           FROM marketplace.trust_appeals WHERE trust_restriction_case_id = $1 ORDER BY created_at`,
        [row.trust_restriction_case_id],
      ),
    ]);
    await this.#audit(this.#pool, input.context, actor, {
      action: 'TRUST_RESTRICTION_VIEWED',
      target_kind: 'TRUST_RESTRICTION',
      target_reference: row.trust_restriction_case_id,
      reason_code: 'OPERATOR_VIEW',
      before: null,
      after: null,
    });
    const openAppeal = appeals.rows.some((appeal) => appeal.lifecycle_state === 'OPEN');
    return {
      trust_restriction_case_id: row.trust_restriction_case_id,
      subject_kind: row.subject_kind,
      subject_reference: row.subject_reference,
      subject_name: await this.#subjectName(
        this.#pool,
        row.subject_kind,
        row.subject_reference,
      ).catch(() => null),
      scope_kind: row.scope_kind,
      scope_reference: row.scope_reference,
      lifecycle_state: row.lifecycle_state,
      reason_code: row.reason_code,
      policy_reference: row.policy_reference,
      evidence_reference: row.evidence_reference,
      evidence_quality: row.evidence_quality,
      approvable: approvable(row.evidence_quality, row.evidence_reference),
      proposal_note: row.proposal_note,
      proposed_by_user_id: row.proposed_by_user_id,
      approved_by_user_id: row.approved_by_user_id,
      decided_by_user_id: row.decided_by_user_id,
      decision_reason_code: row.decision_reason_code,
      effective_until: row.effective_until.toISOString(),
      review_at: row.review_at.toISOString(),
      review_due: row.lifecycle_state === 'ACTIVE' && row.review_at.getTime() <= now.getTime(),
      last_review_outcome: row.last_review_outcome,
      version: row.version,
      signals: linked.rows.map((signal) => ({
        trust_signal_id: signal.trust_signal_id,
        signal_kind: signal.signal_kind,
        weight: signal.weight,
      })),
      // What it stops is new work only; this is what it leaves running.
      in_flight: await this.#inFlight(this.#pool, row.subject_kind, row.subject_reference),
      history: events.rows.map((event) => ({
        ...event,
        occurred_at: event.occurred_at.toISOString(),
      })),
      appeals: appeals.rows.map((appeal) => ({
        ...appeal,
        created_at: appeal.created_at.toISOString(),
      })),
      allowed_actions: trustActionsFor({
        lifecycle_state: row.lifecycle_state,
        open_appeal: openAppeal,
      }),
    };
  }

  /**
   * Proposes a restriction (requirement 3): a real subject, a scope that
   * subject allows, a bounded time and a review within it, a reason and a
   * policy, and the signals or evidence it rests on.
   */
  async propose(input: {
    readonly context: RequestContext;
    readonly subject_kind: string;
    readonly subject_reference: string;
    readonly scope_kind: string;
    readonly scope_reference: string;
    readonly reason_code: string;
    readonly policy_reference: string;
    readonly signal_ids?: readonly UuidV7[];
    readonly evidence_reference?: string;
    readonly proposal_note?: string;
    readonly effective_until: Date;
    readonly review_at: Date;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const kind = subjectKind(input.subject_kind);
    const scopes = TRUST_SCOPES[kind];
    if (!(scopes as readonly string[]).includes(input.scope_kind)) {
      throw new TrustReviewInputError(
        `A ${kind.toLowerCase()} restriction is scoped ${scopes.join(', ')}`,
      );
    }
    const scope = input.scope_kind as TrustScopeKind;
    reasonCode(input.reason_code);
    if (!POLICY.test(input.policy_reference)) {
      throw new TrustReviewInputError('Policy is a SYNTH-POLICY reference');
    }
    if (input.evidence_reference !== undefined && !EVIDENCE.test(input.evidence_reference)) {
      throw new TrustReviewInputError('Evidence is a SYNTH-EVIDENCE reference');
    }
    const note = input.proposal_note?.trim();
    if (note !== undefined && (note.length < 1 || note.length > 1000)) {
      throw new TrustReviewInputError('The note must be between 1 and 1000 characters');
    }
    this.#window(input.effective_until, input.review_at, now);
    const signalIds = [...new Set(input.signal_ids ?? [])];
    if (signalIds.length === 0 && input.evidence_reference === undefined) {
      throw new TrustReviewInputError('A restriction rests on signals or on attached evidence');
    }
    const context = ids(input.context);
    return tx(this.#pool, async (client) => {
      const actor = await this.#require(client, input.context, now, PROPOSE);
      await this.#subjectName(client, kind, input.subject_reference);
      const scopeReference = await this.#scope(client, scope, input.scope_reference);
      // One open case per subject and scope, taken in turn.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1118))', [
        `trust:${kind}:${input.subject_reference}:${scope}:${scopeReference}`,
      ]);
      const open = await client.query(
        `SELECT 1 FROM marketplace.trust_restriction_cases
          WHERE subject_kind = $1 AND subject_reference = $2 AND scope_kind = $3
            AND scope_reference = $4 AND lifecycle_state IN ('PROPOSED','ACTIVE')`,
        [kind, input.subject_reference, scope, scopeReference],
      );
      if (open.rows.length > 0) {
        throw new TrustReviewStateError('A restriction on this subject and scope is already open');
      }
      const signals = await client.query<{
        trust_signal_id: string;
        reporter_user_id: string | null;
        weight: number;
      }>(
        `SELECT s.trust_signal_id, s.reporter_user_id, s.weight
           FROM marketplace.trust_signals s
          WHERE s.trust_signal_id = ANY($1::uuid[]) AND s.subject_kind = $2
            AND s.subject_reference = $3
            AND NOT EXISTS (SELECT 1 FROM marketplace.trust_signal_dismissals d
                             WHERE d.trust_signal_id = s.trust_signal_id)`,
        [signalIds, kind, input.subject_reference],
      );
      if (signals.rows.length !== signalIds.length) {
        throw new TrustReviewInputError(
          'Every signal must be about this subject and not set aside',
        );
      }
      const quality = evidenceQuality(signals.rows);
      const caseId = createUuidV7({ now_ms: now.getTime() });
      const inserted = await client.query<CaseRow>(
        `INSERT INTO marketplace.trust_restriction_cases
           (trust_restriction_case_id, subject_kind, subject_reference, scope_kind, scope_reference,
            reason_code, evidence_reference, evidence_quality, policy_reference, proposal_note,
            proposed_by_user_id, effective_until, review_at, request_id, correlation_id,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
         RETURNING *`,
        [
          caseId,
          kind,
          input.subject_reference,
          scope,
          scopeReference,
          input.reason_code,
          input.evidence_reference ?? null,
          quality,
          input.policy_reference,
          note ?? null,
          actor,
          input.effective_until,
          input.review_at,
          context.request,
          context.correlation,
          now,
        ],
      );
      for (const signal of signals.rows) {
        await client.query(
          `INSERT INTO marketplace.trust_restriction_signals (trust_restriction_case_id, trust_signal_id)
           VALUES ($1,$2)`,
          [caseId, signal.trust_signal_id],
        );
      }
      const row = inserted.rows[0] as CaseRow;
      await this.#event(client, row, 'PROPOSED', actor, input.reason_code, context, now, {
        evidence_quality: quality,
        signals: signals.rows.length,
      });
      await this.#audit(client, input.context, actor, {
        action: 'TRUST_RESTRICTION_PROPOSED',
        target_kind: 'TRUST_RESTRICTION',
        target_reference: caseId,
        reason_code: input.reason_code,
        before: null,
        after: { ...snapshot(row), evidence_quality: quality },
      });
      return {
        trust_restriction_case_id: caseId,
        lifecycle_state: row.lifecycle_state,
        evidence_quality: quality,
        approvable: approvable(quality, row.evidence_reference),
        version: row.version,
      };
    });
  }

  /**
   * A decision on a case (requirements 4-5): approve, reject, revoke, review,
   * or decide an appeal -- against the version read, with a reason.
   */
  async act(input: {
    readonly context: RequestContext;
    readonly trust_restriction_case_id: UuidV7;
    readonly action: string;
    readonly expected_version: number;
    readonly reason_code: string;
    readonly outcome?: string;
    readonly review_at?: Date;
    readonly effective_until?: Date;
    readonly now?: Date;
  }) {
    if (!(TRUST_ACTIONS as readonly string[]).includes(input.action)) {
      throw new TrustReviewInputError(`Action must be one of ${TRUST_ACTIONS.join(', ')}`);
    }
    const action = input.action as TrustAction;
    reasonCode(input.reason_code);
    if (!Number.isSafeInteger(input.expected_version) || input.expected_version < 1) {
      throw new TrustReviewInputError('Expected version must be a positive integer');
    }
    const now = input.now ?? new Date();
    const context = ids(input.context);
    return tx(this.#pool, async (client) => {
      const actor = await this.#require(client, input.context, now, APPROVE);
      const found = await client.query<CaseRow>(
        'SELECT * FROM marketplace.trust_restriction_cases WHERE trust_restriction_case_id = $1 FOR UPDATE',
        [input.trust_restriction_case_id],
      );
      const row = found.rows[0];
      if (!row) throw new TrustReviewNotFoundError();
      if (row.version !== input.expected_version) {
        throw new TrustReviewStateError('The case changed since it was read; reload it');
      }
      const appeal = await client.query<{ trust_appeal_id: string; appellant_user_id: string }>(
        `SELECT trust_appeal_id, appellant_user_id FROM marketplace.trust_appeals
          WHERE trust_restriction_case_id = $1 AND lifecycle_state = 'OPEN' FOR UPDATE`,
        [row.trust_restriction_case_id],
      );
      const openAppeal = appeal.rows[0];
      if (
        !trustActionsFor({
          lifecycle_state: row.lifecycle_state,
          open_appeal: Boolean(openAppeal),
        }).includes(action)
      ) {
        throw new TrustReviewStateError(
          `${action.replaceAll('_', ' ').toLowerCase()} is not allowed on a ${row.lifecycle_state.toLowerCase()} case`,
        );
      }
      const decided = {
        decided_by_user_id: actor,
        decision_reason_code: input.reason_code,
        decided_at: now,
      };
      let patch: Record<string, unknown> = {};
      let event: string = action;
      let payload: Record<string, unknown> = {};
      switch (action) {
        case 'APPROVE': {
          if (row.proposed_by_user_id === actor) {
            throw new TrustReviewStateError(
              'A restriction is approved by someone who did not propose it',
            );
          }
          if (!approvable(row.evidence_quality, row.evidence_reference)) {
            throw new TrustReviewStateError(
              'The evidence is one account; corroborate it or attach evidence before approving',
            );
          }
          if (row.review_at.getTime() <= now.getTime()) {
            throw new TrustReviewStateError(
              'The proposal is past its review date; propose it again',
            );
          }
          patch = { lifecycle_state: 'ACTIVE', approved_by_user_id: actor, ...decided };
          event = 'APPROVED';
          // What it will not touch, on the record at the moment it takes force.
          payload = {
            in_flight: await this.#inFlight(client, row.subject_kind, row.subject_reference),
          };
          break;
        }
        case 'REJECT':
          patch = { lifecycle_state: 'REJECTED', ...decided };
          event = 'REJECTED';
          break;
        case 'REVOKE':
          patch = { lifecycle_state: 'REVOKED', ...decided };
          event = 'REVOKED';
          break;
        case 'REVIEW': {
          const outcome = input.outcome;
          if (outcome === 'KEEP') {
            if (!input.review_at)
              throw new TrustReviewInputError('Keeping it sets the next review');
            this.#window(row.effective_until, input.review_at, now, row.effective_until);
            patch = { review_at: input.review_at };
          } else if (outcome === 'SHORTEN') {
            const until = input.effective_until;
            if (
              !until ||
              until.getTime() <= now.getTime() ||
              until.getTime() >= row.effective_until.getTime()
            ) {
              throw new TrustReviewInputError('Shortening ends it earlier, but not in the past');
            }
            patch = { effective_until: until, review_at: until };
          } else if (outcome === 'LIFT') {
            patch = { lifecycle_state: 'REVOKED', ...decided };
          } else {
            throw new TrustReviewInputError('A review keeps, shortens or lifts the restriction');
          }
          patch = {
            ...patch,
            last_review_outcome: outcome,
            last_reviewed_by_user_id: actor,
            last_reviewed_at: now,
          };
          event = 'REVIEWED';
          payload = { outcome };
          break;
        }
        case 'DECIDE_APPEAL': {
          if (!openAppeal) throw new TrustReviewStateError('There is no open appeal');
          if (actor === row.proposed_by_user_id || actor === row.approved_by_user_id) {
            throw new TrustReviewStateError(
              'An appeal is decided by someone who neither proposed nor approved the restriction',
            );
          }
          const outcome = input.outcome;
          if (outcome !== 'UPHOLD' && outcome !== 'OVERTURN') {
            throw new TrustReviewInputError('An appeal is upheld or overturned');
          }
          await client.query(
            `UPDATE marketplace.trust_appeals
                SET lifecycle_state = $2, decided_by_user_id = $3, decision_reason_code = $4, decided_at = $5
              WHERE trust_appeal_id = $1`,
            [
              openAppeal.trust_appeal_id,
              outcome === 'UPHOLD' ? 'UPHELD' : 'OVERTURNED',
              actor,
              input.reason_code,
              now,
            ],
          );
          if (outcome === 'OVERTURN') {
            patch = {
              lifecycle_state: row.lifecycle_state === 'PROPOSED' ? 'REJECTED' : 'REVOKED',
              ...decided,
            };
          }
          event = outcome === 'UPHOLD' ? 'APPEAL_UPHELD' : 'APPEAL_OVERTURNED';
          payload = { trust_appeal_id: openAppeal.trust_appeal_id };
          break;
        }
      }
      const updated = await this.#update(client, row, patch, now);
      await this.#event(client, row, event, actor, input.reason_code, context, now, payload);
      await this.#audit(client, input.context, actor, {
        action: `TRUST_RESTRICTION_${event}`,
        target_kind: 'TRUST_RESTRICTION',
        target_reference: row.trust_restriction_case_id,
        reason_code: input.reason_code,
        before: snapshot(row),
        after: { ...snapshot(updated), ...payload },
        approval_reference: action === 'APPROVE' ? row.trust_restriction_case_id : null,
      });
      return {
        trust_restriction_case_id: row.trust_restriction_case_id,
        action,
        lifecycle_state: updated.lifecycle_state,
        effective_until: updated.effective_until.toISOString(),
        review_at: updated.review_at.toISOString(),
        version: updated.version,
        ...payload,
      };
    });
  }

  /** Sets a signal aside as not credible; it stays, and stops counting. */
  async dismissSignal(input: {
    readonly context: RequestContext;
    readonly trust_signal_id: UuidV7;
    readonly reason_code: string;
    readonly now?: Date;
  }) {
    reasonCode(input.reason_code);
    const now = input.now ?? new Date();
    const context = ids(input.context);
    return tx(this.#pool, async (client) => {
      const actor = await this.#reader(client, input.context, now);
      const signal = await client.query(
        'SELECT 1 FROM marketplace.trust_signals WHERE trust_signal_id = $1',
        [input.trust_signal_id],
      );
      if (signal.rows.length === 0) throw new TrustReviewNotFoundError();
      const dismissed = await client.query(
        `INSERT INTO marketplace.trust_signal_dismissals
           (trust_signal_id, dismissed_by_user_id, reason_code, request_id, correlation_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (trust_signal_id) DO NOTHING RETURNING 1`,
        [
          input.trust_signal_id,
          actor,
          input.reason_code,
          context.request,
          context.correlation,
          now,
        ],
      );
      if (dismissed.rows.length === 0)
        throw new TrustReviewStateError('That signal is already set aside');
      await this.#audit(client, input.context, actor, {
        action: 'TRUST_SIGNAL_DISMISSED',
        target_kind: 'TRUST_SIGNAL',
        target_reference: input.trust_signal_id,
        reason_code: input.reason_code,
        before: null,
        after: null,
      });
      return { trust_signal_id: input.trust_signal_id, dismissed: true };
    });
  }

  /**
   * The restrictions on the person asking -- a customer, a partner, or the
   * owner or manager of a shop -- that affected them, with the reason, the
   * policy, the dates and whether they can appeal (SEC-14, DLP-47).
   */
  async ownRestrictions(input: {
    readonly context: RequestContext;
    readonly vendor_location_id?: UuidV7;
    readonly now?: Date;
  }) {
    const subject = await this.#self(this.#pool, input.context, input.vendor_location_id);
    const rows = await this.#pool.query<CaseRow & { appeal_state: string | null }>(
      `SELECT c.*,
              (SELECT a.lifecycle_state FROM marketplace.trust_appeals a
                WHERE a.trust_restriction_case_id = c.trust_restriction_case_id
                ORDER BY a.created_at DESC LIMIT 1) AS appeal_state
         FROM marketplace.trust_restriction_cases c
        WHERE c.subject_kind = $1 AND c.subject_reference = $2
          AND c.lifecycle_state IN ('ACTIVE','EXPIRED','REVOKED')
        ORDER BY c.created_at DESC LIMIT 25`,
      [subject.kind, subject.reference],
    );
    const now = input.now ?? new Date();
    return {
      restrictions: rows.rows.map((row) => ({
        trust_restriction_case_id: row.trust_restriction_case_id,
        lifecycle_state: row.lifecycle_state,
        in_force: row.lifecycle_state === 'ACTIVE' && row.effective_until.getTime() > now.getTime(),
        scope_kind: row.scope_kind,
        reason_code: row.reason_code,
        policy_reference: row.policy_reference,
        effective_until: row.effective_until.toISOString(),
        review_at: row.review_at.toISOString(),
        appeal_state: row.appeal_state,
        appealable: row.lifecycle_state === 'ACTIVE' && row.appeal_state !== 'OPEN',
      })),
    };
  }

  /** The person restricted appeals, against the case as it stands. */
  async appeal(input: {
    readonly context: RequestContext;
    readonly trust_restriction_case_id: UuidV7;
    readonly statement: string;
    readonly vendor_location_id?: UuidV7;
    readonly now?: Date;
  }) {
    const statement = input.statement.trim();
    if (statement.length < 1 || statement.length > 2000) {
      throw new TrustReviewInputError('The appeal must be between 1 and 2000 characters');
    }
    const now = input.now ?? new Date();
    const context = ids(input.context);
    return tx(this.#pool, async (client) => {
      const subject = await this.#self(client, input.context, input.vendor_location_id);
      const found = await client.query<CaseRow>(
        `SELECT * FROM marketplace.trust_restriction_cases
          WHERE trust_restriction_case_id = $1 AND subject_kind = $2 AND subject_reference = $3
          FOR UPDATE`,
        [input.trust_restriction_case_id, subject.kind, subject.reference],
      );
      const row = found.rows[0];
      if (!row) throw new TrustReviewNotFoundError();
      if (row.lifecycle_state !== 'ACTIVE') {
        throw new TrustReviewStateError('Only a restriction in force can be appealed');
      }
      const appealId = createUuidV7({ now_ms: now.getTime() });
      const inserted = await client.query(
        `INSERT INTO marketplace.trust_appeals
           (trust_appeal_id, trust_restriction_case_id, case_version, appellant_user_id, statement,
            request_id, correlation_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (trust_restriction_case_id) WHERE lifecycle_state = 'OPEN' DO NOTHING
         RETURNING 1`,
        [
          appealId,
          row.trust_restriction_case_id,
          row.version,
          subject.person,
          statement,
          context.request,
          context.correlation,
          now,
        ],
      );
      if (inserted.rows.length === 0) throw new TrustReviewStateError('An appeal is already open');
      await this.#event(
        client,
        row,
        'APPEAL_FILED',
        subject.person,
        'SUBJECT_APPEALED',
        context,
        now,
        {
          trust_appeal_id: appealId,
        },
      );
      return { trust_appeal_id: appealId, lifecycle_state: 'OPEN', case_version: row.version };
    });
  }

  /** Marks lapsed restrictions EXPIRED, on the case history. */
  async expireLapsed(input: { readonly context: RequestContext; readonly now?: Date }) {
    const kind = input.context.actor?.actor_kind;
    if (kind !== 'system' && kind !== 'admin') throw new TrustReviewAuthorizationError();
    const actor = input.context.actor?.actor_id as UuidV7;
    const now = input.now ?? new Date();
    const context = ids(input.context);
    const expired = await this.#pool.query(
      `WITH lapsed AS (
         UPDATE marketplace.trust_restriction_cases
            SET lifecycle_state = 'EXPIRED', version = version + 1, updated_at = $1,
                decided_by_user_id = $2, decision_reason_code = 'EFFECTIVE_PERIOD_ENDED', decided_at = $1
          WHERE lifecycle_state = 'ACTIVE' AND effective_until <= $1
          RETURNING trust_restriction_case_id, version
       )
       INSERT INTO marketplace.trust_case_events
         (trust_case_event_id, trust_restriction_case_id, event_type, actor_id, reason_code,
          case_version, request_id, correlation_id, occurred_at)
       SELECT gen_random_uuid(), trust_restriction_case_id, 'EXPIRED', $2, 'EFFECTIVE_PERIOD_ENDED',
              version - 1, $3, $4, $1
         FROM lapsed`,
      [now, actor, context.request, context.correlation],
    );
    return { expired: expired.rowCount ?? 0 };
  }

  // -----------------------------------------------------------------------

  #window(effectiveUntil: Date, reviewAt: Date, now: Date, cap?: Date) {
    const until = effectiveUntil.getTime();
    if (until <= now.getTime() || until > now.getTime() + MAX_RESTRICTION_DAYS * DAY) {
      if (!cap) {
        throw new TrustReviewInputError(
          `A restriction ends in the future and within ${MAX_RESTRICTION_DAYS} days`,
        );
      }
    }
    const review = reviewAt.getTime();
    if (
      review <= now.getTime() ||
      review > until ||
      review > now.getTime() + MAX_REVIEW_DAYS * DAY
    ) {
      throw new TrustReviewInputError(
        `The review falls after now, by the end of the restriction, and within ${MAX_REVIEW_DAYS} days`,
      );
    }
  }

  /** The subject must be something that exists; returns a name a reviewer can read. */
  async #subjectName(
    queryable: Pick<Pool | PoolClient, 'query'>,
    kind: TrustSubjectKind,
    reference: string,
  ): Promise<string> {
    if (kind === 'CATEGORY') {
      if (!CATEGORY.test(reference))
        throw new TrustReviewInputError('A category is a catalogue category code');
      const found = await queryable.query(
        'SELECT 1 FROM marketplace.catalogue_products WHERE category = $1 LIMIT 1',
        [reference],
      );
      if (found.rows.length === 0)
        throw new TrustReviewNotFoundError('No product is in that category');
      return reference;
    }
    if (!UUID.test(reference)) throw new TrustReviewInputError('The subject is named by its id');
    const query =
      kind === 'VENDOR_LOCATION'
        ? 'SELECT location_name AS name FROM marketplace.vendor_locations WHERE vendor_location_id = $1'
        : kind === 'PARTNER'
          ? `SELECT 'Partner ' || left(user_id::text, 8) AS name FROM marketplace.partner_eligibilities WHERE user_id = $1`
          : `SELECT 'Customer ' || left(person.user_id::text, 8) AS name
               FROM marketplace.users person
              WHERE person.user_id = $1
                AND EXISTS (SELECT 1 FROM marketplace.role_assignments assignment
                             WHERE assignment.user_id = person.user_id AND assignment.role_key = 'CUSTOMER')`;
    const found = await queryable.query<{ name: string }>(query, [reference]);
    const name = found.rows[0]?.name;
    if (!name)
      throw new TrustReviewNotFoundError(`No such ${kind.toLowerCase().replace('_', ' ')}`);
    return name;
  }

  async #scope(client: PoolClient, scope: TrustScopeKind, reference: string): Promise<string> {
    if (scope === 'GLOBAL') return 'GLOBAL';
    if (scope === 'CATEGORY') {
      if (!CATEGORY.test(reference))
        throw new TrustReviewInputError('The scope is a category code');
      return reference;
    }
    if (!UUID.test(reference)) throw new TrustReviewInputError('The scope is named by its id');
    const found =
      scope === 'VENDOR_LOCATION'
        ? await client.query(
            'SELECT 1 FROM marketplace.vendor_locations WHERE vendor_location_id = $1',
            [reference],
          )
        : await client.query(
            `SELECT 1 FROM marketplace.vendor_service_zones WHERE service_zone_id = $1 AND lifecycle_state = 'ACTIVE'`,
            [reference],
          );
    if (found.rows.length === 0) throw new TrustReviewNotFoundError('No such scope');
    return reference;
  }

  async #signals(
    queryable: Pick<Pool | PoolClient, 'query'>,
    kind: TrustSubjectKind,
    reference: string,
    now: Date,
  ): Promise<SignalRow[]> {
    const rows = await queryable.query<SignalRow>(
      `SELECT s.trust_signal_id, s.signal_kind, s.source_kind, s.source_id, s.reporter_user_id,
              s.weight, s.observed_at,
              EXISTS (SELECT 1 FROM marketplace.trust_signal_dismissals d
                       WHERE d.trust_signal_id = s.trust_signal_id) AS dismissed
         FROM marketplace.trust_signals s
        WHERE s.subject_kind = $1 AND s.subject_reference = $2 AND s.observed_at >= $3
        ORDER BY s.observed_at DESC LIMIT 200`,
      [kind, reference, new Date(now.getTime() - SIGNAL_WINDOW_DAYS * DAY)],
    );
    return rows.rows;
  }

  /** The work a subject has under way, which a restriction leaves running (requirement 4). */
  async #inFlight(
    queryable: Pick<Pool | PoolClient, 'query'>,
    kind: TrustSubjectKind,
    reference: string,
  ) {
    const ended = `('DELIVERED','RETURNED','CANCELLED','EXPIRED')`;
    if (kind === 'PARTNER') {
      const rows = await queryable.query<{ assignments: string; in_custody: string }>(
        `SELECT count(*)::text AS assignments,
                count(*) FILTER (WHERE a.custody_state = 'IN_CUSTODY')::text AS in_custody
           FROM marketplace.delivery_assignments a
          WHERE a.partner_user_id::text = $1
            AND a.assignment_state IN ('ASSIGNED','AT_VENDOR','PICKED_UP','EN_ROUTE_TO_CUSTOMER',
                                       'ARRIVED','DELIVERY_FAILED','RETURN_REQUIRED',
                                       'RETURN_AUTHORIZED','RETURNING')`,
        [reference],
      );
      return {
        active_orders: 0,
        active_assignments: Number(rows.rows[0]?.assignments ?? 0),
        goods_in_custody: Number(rows.rows[0]?.in_custody ?? 0),
      };
    }
    if (kind === 'CUSTOMER' || kind === 'VENDOR_LOCATION') {
      const rows = await queryable.query<{ orders: string; in_custody: string }>(
        `SELECT count(DISTINCT o.vendor_order_id)::text AS orders,
                count(DISTINCT a.delivery_assignment_id) FILTER (WHERE a.custody_state = 'IN_CUSTODY')::text AS in_custody
           FROM marketplace.vendor_orders o
           JOIN marketplace.checkout_groups grouping USING (checkout_group_id)
           LEFT JOIN marketplace.delivery_assignments a ON a.vendor_order_id = o.vendor_order_id
          WHERE o.lifecycle_state NOT IN ${ended}
            AND ${kind === 'CUSTOMER' ? 'grouping.customer_user_id::text' : 'o.vendor_location_id::text'} = $1`,
        [reference],
      );
      return {
        active_orders: Number(rows.rows[0]?.orders ?? 0),
        active_assignments: 0,
        goods_in_custody: Number(rows.rows[0]?.in_custody ?? 0),
      };
    }
    return { active_orders: 0, active_assignments: 0, goods_in_custody: 0 };
  }

  /** Who is asking about their own restrictions, as a subject. */
  async #self(
    queryable: Pick<Pool | PoolClient, 'query'>,
    context: RequestContext,
    vendorLocationId: UuidV7 | undefined,
  ): Promise<{ kind: TrustSubjectKind; reference: string; person: UuidV7 }> {
    const actor = context.actor;
    if (actor?.actor_kind === 'customer') {
      return { kind: 'CUSTOMER', reference: String(actor.actor_id), person: actor.actor_id };
    }
    if (actor?.actor_kind === 'delivery_partner') {
      return { kind: 'PARTNER', reference: String(actor.actor_id), person: actor.actor_id };
    }
    if (actor?.actor_kind === 'vendor_staff' && vendorLocationId) {
      const member = await queryable.query(
        `SELECT 1 FROM marketplace.staff_memberships membership
           JOIN marketplace.role_assignments assignment USING (role_assignment_id)
          WHERE membership.user_id = $1 AND membership.vendor_location_id = $2
            AND assignment.state = 'ACTIVE' AND assignment.role_key IN ('VENDOR_OWNER','VENDOR_MANAGER')`,
        [actor.actor_id, vendorLocationId],
      );
      if (member.rows.length > 0) {
        return {
          kind: 'VENDOR_LOCATION',
          reference: String(vendorLocationId),
          person: actor.actor_id,
        };
      }
    }
    throw new TrustReviewNotFoundError();
  }

  async #reader(
    queryable: Pick<Pool | PoolClient, 'query'>,
    context: RequestContext,
    now: Date,
  ): Promise<UuidV7> {
    if (context.actor?.actor_kind !== 'admin') throw new TrustReviewAuthorizationError();
    const held = await globalAdminCapabilities(queryable, context.actor.actor_id, now);
    if (!held.has(PROPOSE) && !held.has(APPROVE)) throw new TrustReviewAuthorizationError();
    return context.actor.actor_id;
  }

  async #require(
    queryable: Pick<Pool | PoolClient, 'query'>,
    context: RequestContext,
    now: Date,
    capability: string,
  ): Promise<UuidV7> {
    if (context.actor?.actor_kind !== 'admin') throw new TrustReviewAuthorizationError();
    const held = await globalAdminCapabilities(queryable, context.actor.actor_id, now);
    if (!held.has(capability)) throw new TrustReviewAuthorizationError();
    return context.actor.actor_id;
  }

  async #update(
    client: PoolClient,
    row: CaseRow,
    patch: Record<string, unknown>,
    now: Date,
  ): Promise<CaseRow> {
    const allowed = new Set([
      'lifecycle_state',
      'approved_by_user_id',
      'decided_by_user_id',
      'decision_reason_code',
      'decided_at',
      'review_at',
      'effective_until',
      'last_review_outcome',
      'last_reviewed_by_user_id',
      'last_reviewed_at',
    ]);
    const keys = Object.keys(patch);
    for (const key of keys)
      if (!allowed.has(key)) throw new Error(`Not a trust case column: ${key}`);
    const sets = keys.map((key, index) => `${key} = $${index + 4}`);
    const updated = await client.query<CaseRow>(
      `UPDATE marketplace.trust_restriction_cases
          SET ${[...sets, 'version = version + 1', 'updated_at = $3'].join(', ')}
        WHERE trust_restriction_case_id = $1 AND version = $2
        RETURNING *`,
      [row.trust_restriction_case_id, row.version, now, ...keys.map((key) => patch[key])],
    );
    const next = updated.rows[0];
    if (!next) throw new TrustReviewStateError('The case changed since it was read; reload it');
    return next;
  }

  async #event(
    client: PoolClient,
    row: CaseRow,
    type: string,
    actor: string,
    reason: string,
    context: ReturnType<typeof ids>,
    now: Date,
    payload: Record<string, unknown>,
  ) {
    await client.query(
      `INSERT INTO marketplace.trust_case_events
         (trust_case_event_id, trust_restriction_case_id, event_type, actor_id, reason_code,
          case_version, payload, request_id, correlation_id, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        createUuidV7({ now_ms: now.getTime() }),
        row.trust_restriction_case_id,
        type,
        actor,
        reason,
        row.version,
        JSON.stringify(payload),
        context.request,
        context.correlation,
        now,
      ],
    );
  }

  async #audit(
    queryable: Pick<Pool | PoolClient, 'query'>,
    context: RequestContext,
    actor: string,
    input: {
      readonly action: string;
      readonly target_kind: string;
      readonly target_reference: string;
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
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        createUuidV7(),
        input.action,
        input.target_kind,
        input.target_reference,
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
