import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import type { Pool } from 'pg';
import { globalAdminCapabilities } from './admin-capabilities.js';
import { releaseServicePool, resolveServicePool } from './database-pool.js';

export class AuditSearchInputError extends Error {}
export class AuditSearchNotFoundError extends Error {}
export class AuditSearchAuthorizationError extends Error {}

const READ = 'admin.audit.read';
/** Financial fields are shown to the people who manage the ledger. */
export const FINANCIAL_READERS = ['admin.finance.ledger_manage'] as const;
/** Evidence and personal detail are shown to the people who handle cases and restrictions. */
export const EVIDENCE_READERS = [
  'admin.support.case_manage',
  'admin.trust.restriction_propose',
  'admin.trust.restriction_approve',
] as const;

/** Never shown to anyone: a secret is not evidence of what someone did. */
const SECRET = /(token|hash|otp|secret|password|signature|api_key|private_key)/i;
const FINANCIAL = /(_minor$|amount|price|fee|commission|earning|balance|payout|refund_total)/i;
const EVIDENCE =
  /(evidence|statement|note|description|message|comment|coordinates|latitude|longitude|phone|email|address|name$)/i;

export type Visibility = { readonly financial: boolean; readonly evidence: boolean };
export type FieldClass = 'SECRET' | 'FINANCIAL' | 'EVIDENCE' | 'PLAIN';

export function classifyField(key: string): FieldClass {
  if (SECRET.test(key)) return 'SECRET';
  if (FINANCIAL.test(key)) return 'FINANCIAL';
  if (EVIDENCE.test(key)) return 'EVIDENCE';
  return 'PLAIN';
}

/**
 * A before or after value as this reader may see it: secrets always
 * withheld, financial fields and evidence withheld from those whose work
 * does not need them. Every withheld path is listed, so the reader knows
 * something is there. A field's class is inherited by everything under it.
 */
export function redact(
  value: unknown,
  visibility: Visibility,
  path = '',
  inherited: FieldClass = 'PLAIN',
): { readonly value: unknown; readonly withheld: readonly string[] } {
  if (value === null || value === undefined) return { value: value ?? null, withheld: [] };
  const withheldAs = (fieldClass: FieldClass) =>
    fieldClass === 'SECRET'
      ? '[secret: never shown]'
      : fieldClass === 'FINANCIAL' && !visibility.financial
        ? '[financial: shown to ledger managers]'
        : fieldClass === 'EVIDENCE' && !visibility.evidence
          ? '[evidence: shown to case and restriction handlers]'
          : null;
  const hidden = withheldAs(inherited);
  if (hidden) return { value: hidden, withheld: [path || '(value)'] };
  if (Array.isArray(value)) {
    const withheld: string[] = [];
    const items = value.map((item, index) => {
      const result = redact(item, visibility, `${path}[${index}]`, inherited);
      withheld.push(...result.withheld);
      return result.value;
    });
    return { value: items, withheld };
  }
  if (typeof value === 'object') {
    const withheld: string[] = [];
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const own = classifyField(key);
      // A secret is withheld wherever it sits, even inside a field this reader may see.
      const fieldClass = own === 'SECRET' ? own : inherited !== 'PLAIN' ? inherited : own;
      const result = redact(child, visibility, path ? `${path}.${key}` : key, fieldClass);
      withheld.push(...result.withheld);
      out[key] = result.value;
    }
    return { value: out, withheld };
  }
  return { value, withheld: [] };
}

/** The top-level fields a change touched, by name only. */
export function changedFields(before: unknown, after: unknown): readonly string[] {
  const record = (value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const left = record(before);
  const right = record(after);
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
    .sort();
}

export type AuditFilters = {
  readonly actor_id?: string;
  readonly action?: string;
  readonly action_prefix?: string;
  readonly target_kind?: string;
  readonly target_reference?: string;
  readonly reason_code?: string;
  readonly request_id?: string;
  readonly approval_reference?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly text?: string;
};

type Row = {
  operational_audit_event_id: string;
  action: string;
  target_kind: string;
  target_reference: string;
  actor_id: string;
  reason_code: string;
  before_value: unknown;
  after_value: unknown;
  request_id: string;
  correlation_id: string;
  approval_reference: string | null;
  occurred_at: Date;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
export const MAX_SEARCH_WINDOW_MS = 366 * 24 * 60 * 60_000;

/**
 * The searchable audit (11.9). It reads; the only thing it writes is a
 * record that someone viewed withheld-by-default fields, appended like
 * every other audit row. Rows cannot be changed or removed by anyone: the
 * table refuses UPDATE, DELETE and TRUNCATE, and no route offers to.
 */
export class AuditSearchService {
  readonly #pool: Pool;

  constructor(input: { readonly connection_string: string; readonly pool?: Pool }) {
    this.#pool = resolveServicePool(input, {
      application_name: 'neighbourhood-store-audit-search',
      max: 4,
    });
  }

  async close() {
    await releaseServicePool(this.#pool);
  }

  /** Newest first, by any combination of the fields an investigation starts from. */
  async search(input: {
    readonly context: RequestContext;
    readonly filters: AuditFilters;
    readonly limit?: number;
    readonly before?: string;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const visibility = await this.#visibility(input.context, now);
    const f = input.filters;
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw new AuditSearchInputError('A page holds 1 to 200 entries');
    for (const [key, value] of [
      ['actor_id', f.actor_id],
      ['request_id', f.request_id],
      ['approval_reference', f.approval_reference],
    ] as const)
      if (value !== undefined && !UUID.test(value))
        throw new AuditSearchInputError(`${key} is an id`);
    for (const [key, value] of [
      ['action', f.action],
      ['action_prefix', f.action_prefix],
      ['target_kind', f.target_kind],
      ['reason_code', f.reason_code],
    ] as const)
      if (value !== undefined && !CODE.test(value))
        throw new AuditSearchInputError(`${key} is an upper-case code`);
    if (f.text !== undefined && (f.text.trim().length < 3 || f.text.length > 100))
      throw new AuditSearchInputError('A text search is 3 to 100 characters');
    const to = f.to ?? now;
    const from = f.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60_000);
    if (from.getTime() > to.getTime())
      throw new AuditSearchInputError('A search window starts before it ends');
    if (to.getTime() - from.getTime() > MAX_SEARCH_WINDOW_MS)
      throw new AuditSearchInputError('A search window is at most a year');
    let cursor: { at: Date; id: string } | null = null;
    if (input.before !== undefined) {
      const [at, id] = input.before.split('|');
      if (!at || !id || !UUID.test(id) || Number.isNaN(new Date(at).getTime()))
        throw new AuditSearchInputError('The page cursor is not one this search gave');
      cursor = { at: new Date(at), id };
    }
    const escaped = f.text?.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
    const rows = await this.#pool.query<Row>(
      `SELECT operational_audit_event_id::text, action, target_kind, target_reference, actor_id::text,
              reason_code, before_value, after_value, request_id::text, correlation_id::text,
              approval_reference::text, occurred_at
         FROM marketplace.operational_audit_events
        WHERE occurred_at >= $1 AND occurred_at <= $2
          AND ($3::uuid IS NULL OR actor_id = $3)
          AND ($4::text IS NULL OR action = $4)
          AND ($5::text IS NULL OR action LIKE $5 || '%')
          AND ($6::text IS NULL OR target_kind = $6)
          AND ($7::text IS NULL OR target_reference = $7)
          AND ($8::text IS NULL OR reason_code = $8)
          AND ($9::uuid IS NULL OR request_id = $9)
          AND ($10::uuid IS NULL OR approval_reference = $10)
          AND ($11::text IS NULL OR action ILIKE '%' || $11 || '%'
               OR target_reference ILIKE '%' || $11 || '%' OR reason_code ILIKE '%' || $11 || '%')
          AND ($12::timestamptz IS NULL
               OR (occurred_at, operational_audit_event_id) < ($12, $13::uuid))
        ORDER BY occurred_at DESC, operational_audit_event_id DESC
        LIMIT $14`,
      [
        from,
        to,
        f.actor_id ?? null,
        f.action ?? null,
        f.action_prefix ?? null,
        f.target_kind ?? null,
        f.target_reference ?? null,
        f.reason_code ?? null,
        f.request_id ?? null,
        f.approval_reference ?? null,
        escaped ?? null,
        cursor?.at ?? null,
        cursor?.id ?? null,
        limit + 1,
      ],
    );
    const page = rows.rows.slice(0, limit);
    const last = page.at(-1);
    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      visibility,
      entries: page.map((row) => this.#project(row, visibility)),
      next:
        rows.rows.length > limit && last
          ? `${last.occurred_at.toISOString()}|${last.operational_audit_event_id}`
          : null,
    };
  }

  /**
   * One entry, with the others made under the same request. Viewing fields
   * withheld by default is itself recorded.
   */
  async detail(input: {
    readonly context: RequestContext;
    readonly operational_audit_event_id: string;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const visibility = await this.#visibility(input.context, now);
    if (!UUID.test(input.operational_audit_event_id))
      throw new AuditSearchNotFoundError('No such audit entry');
    const found = await this.#pool.query<Row>(
      `SELECT operational_audit_event_id::text, action, target_kind, target_reference, actor_id::text,
              reason_code, before_value, after_value, request_id::text, correlation_id::text,
              approval_reference::text, occurred_at
         FROM marketplace.operational_audit_events WHERE operational_audit_event_id = $1`,
      [input.operational_audit_event_id],
    );
    const row = found.rows[0];
    if (!row) throw new AuditSearchNotFoundError('No such audit entry');
    const related = await this.#pool.query<{
      operational_audit_event_id: string;
      action: string;
      occurred_at: Date;
    }>(
      `SELECT operational_audit_event_id::text, action, occurred_at
         FROM marketplace.operational_audit_events
        WHERE (request_id = $1 OR correlation_id = $2) AND operational_audit_event_id <> $3
        ORDER BY occurred_at, operational_audit_event_id LIMIT 50`,
      [row.request_id, row.correlation_id, row.operational_audit_event_id],
    );
    const entry = this.#project(row, visibility);
    const revealed = this.#revealed(row, visibility);
    if (revealed.length > 0) {
      await this.#pool.query(
        `INSERT INTO marketplace.operational_audit_events
           (operational_audit_event_id, action, target_kind, target_reference, actor_id, reason_code,
            after_value, request_id, correlation_id)
         VALUES ($1,'AUDIT_ENTRY_VIEWED','OPERATIONAL_AUDIT_EVENT',$2,$3,'SENSITIVE_FIELDS_SHOWN',$4,$5,$6)`,
        [
          createUuidV7(),
          row.operational_audit_event_id,
          actor(input.context),
          JSON.stringify({ fields: revealed }),
          parseRequestId(input.context.request_id),
          parseUuidV7(input.context.correlation_id),
        ],
      );
    }
    return {
      ...entry,
      same_request: related.rows.map((event) => ({
        operational_audit_event_id: event.operational_audit_event_id,
        action: event.action,
        occurred_at: event.occurred_at.toISOString(),
      })),
    };
  }

  #project(row: Row, visibility: Visibility) {
    const before = redact(row.before_value, visibility);
    const after = redact(row.after_value, visibility);
    return {
      operational_audit_event_id: row.operational_audit_event_id,
      occurred_at: row.occurred_at.toISOString(),
      actor_id: row.actor_id,
      action: row.action,
      target: { kind: row.target_kind, reference: row.target_reference },
      reason_code: row.reason_code,
      request_id: row.request_id,
      correlation_id: row.correlation_id,
      approval_reference: row.approval_reference,
      before: before.value,
      after: after.value,
      changed_fields: changedFields(row.before_value, row.after_value),
      withheld: [
        ...before.withheld.map((path) => `before.${path}`),
        ...after.withheld.map((path) => `after.${path}`),
      ],
    };
  }

  /** The financial and evidence paths this reader was shown, that others would not be. */
  #revealed(row: Row, visibility: Visibility): string[] {
    if (!visibility.financial && !visibility.evidence) return [];
    const none = { financial: false, evidence: false };
    const hiddenForAll = new Set([
      ...redact(row.before_value, none).withheld.map((p) => `before.${p}`),
      ...redact(row.after_value, none).withheld.map((p) => `after.${p}`),
    ]);
    const hiddenHere = new Set([
      ...redact(row.before_value, visibility).withheld.map((p) => `before.${p}`),
      ...redact(row.after_value, visibility).withheld.map((p) => `after.${p}`),
    ]);
    return [...hiddenForAll].filter((path) => !hiddenHere.has(path)).sort();
  }

  async #visibility(context: RequestContext, now: Date): Promise<Visibility> {
    const held = await globalAdminCapabilities(this.#pool, actor(context), now);
    if (!held.has(READ)) throw new AuditSearchAuthorizationError();
    return {
      financial: FINANCIAL_READERS.some((capability) => held.has(capability)),
      evidence: EVIDENCE_READERS.some((capability) => held.has(capability)),
    };
  }
}

function actor(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'admin') throw new AuditSearchAuthorizationError();
  return context.actor.actor_id;
}
