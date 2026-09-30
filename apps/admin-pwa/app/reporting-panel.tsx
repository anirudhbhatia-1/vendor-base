'use client';
import { useState } from 'react';
import { adminRequest } from './authenticated-api';

/**
 * The searchable audit (11.9; ADM-51, ADM-52).
 *
 * Search by who, what, which record, why, when, under which request and on
 * whose approval; read each entry's before and after as the server allows
 * this reader to see it, with every withheld field named; follow the other
 * entries made under the same request. There is nothing here that changes an
 * entry, because nothing can. Until audit run 81 this was a single substring
 * box whose results showed every field of every row to every reader.
 */
export type AuditSearchForm = {
  readonly actor_id: string;
  readonly action: string;
  readonly action_prefix: string;
  readonly target_kind: string;
  readonly target_reference: string;
  readonly reason_code: string;
  readonly request_id: string;
  readonly approval_reference: string;
  readonly from: string;
  readonly to: string;
  readonly text: string;
};

export const EMPTY_AUDIT_SEARCH: AuditSearchForm = {
  actor_id: '',
  action: '',
  action_prefix: '',
  target_kind: '',
  target_reference: '',
  reason_code: '',
  request_id: '',
  approval_reference: '',
  from: '',
  to: '',
  text: '',
};

type AuditEntry = {
  readonly operational_audit_event_id: string;
  readonly occurred_at: string;
  readonly actor_id: string;
  readonly action: string;
  readonly target: { readonly kind: string; readonly reference: string };
  readonly reason_code: string;
  readonly request_id: string;
  readonly approval_reference: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly changed_fields: readonly string[];
  readonly withheld: readonly string[];
};

type AuditDetail = AuditEntry & {
  readonly same_request: readonly {
    readonly operational_audit_event_id: string;
    readonly action: string;
    readonly occurred_at: string;
  }[];
};

/** The search as the API takes it: only the fields given, days as whole days. */
export function auditQuery(form: AuditSearchForm, before?: string): string {
  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(form)) {
    const value = raw.trim();
    if (!value) continue;
    if (key === 'from') query.set('from', new Date(`${value}T00:00:00`).toISOString());
    else if (key === 'to') query.set('to', new Date(`${value}T23:59:59`).toISOString());
    else if (['action', 'action_prefix', 'target_kind', 'reason_code'].includes(key))
      query.set(key, value.toUpperCase());
    else query.set(key, value);
  }
  if (before) query.set('before', before);
  const text = query.toString();
  return text ? `?${text}` : '';
}

/** A before or after value laid out for reading; withheld fields keep their notice. */
export function describeValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

const FIELDS: readonly (readonly [keyof AuditSearchForm, string])[] = [
  ['actor_id', 'Actor id'],
  ['action', 'Action'],
  ['action_prefix', 'Action starts with'],
  ['target_kind', 'Target kind'],
  ['target_reference', 'Target reference'],
  ['reason_code', 'Reason'],
  ['request_id', 'Request id'],
  ['approval_reference', 'Approval reference'],
  ['text', 'Text (action, target or reason)'],
];

export function ReportingPanel({ view }: { view: 'audit' }) {
  const [form, setForm] = useState<AuditSearchForm>(EMPTY_AUDIT_SEARCH);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [message, setMessage] = useState('Search the audit trail by any field.');

  async function search(more = false) {
    try {
      const page = await adminRequest<{
        entries: AuditEntry[];
        next: string | null;
        window: { from: string; to: string };
      }>(`admin/audit${auditQuery(form, more ? (next ?? undefined) : undefined)}`);
      setEntries((current) => (more ? [...current, ...page.entries] : page.entries));
      setNext(page.next);
      setMessage(
        `${more ? 'More' : page.entries.length} entr${page.entries.length === 1 ? 'y' : 'ies'} from ${new Date(page.window.from).toLocaleDateString()} to ${new Date(page.window.to).toLocaleDateString()}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The audit search failed.');
    }
  }

  async function open(id: string) {
    try {
      setDetail(await adminRequest<AuditDetail>(`admin/audit/${id}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The entry failed to load.');
    }
  }

  return (
    <section className="catalogue-oversight" id={view}>
      <div>
        <p className="eyebrow">IMMUTABLE AUDIT LOG</p>
        <h2>Who changed what, and why</h2>
        <p>
          Entries cannot be changed or removed by anyone, including the person who made them. Money
          and evidence are shown to the people whose work needs them; secrets to nobody.
        </p>
      </div>
      <p aria-live="polite">{message}</p>
      <div className="catalogue-flag">
        {FIELDS.map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              value={form[key]}
              onChange={(event) => setForm({ ...form, [key]: event.target.value })}
            />
          </label>
        ))}
        <label>
          From
          <input
            type="date"
            value={form.from}
            onChange={(event) => setForm({ ...form, from: event.target.value })}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={form.to}
            onChange={(event) => setForm({ ...form, to: event.target.value })}
          />
        </label>
        <div className="actions">
          <button type="button" onClick={() => void search()}>
            Search audit trail
          </button>
          <button type="button" onClick={() => setForm(EMPTY_AUDIT_SEARCH)}>
            Clear
          </button>
        </div>
      </div>

      {detail && (
        <article className="catalogue-flag" aria-label="Audit entry">
          <p className="eyebrow">
            {detail.action} · {new Date(detail.occurred_at).toLocaleString()}
          </p>
          <p>
            {detail.target.kind} {detail.target.reference} · by {detail.actor_id} · because{' '}
            {detail.reason_code}
          </p>
          <small>
            Request {detail.request_id}
            {detail.approval_reference ? ` · approval ${detail.approval_reference}` : ''}
          </small>
          {detail.changed_fields.length > 0 && <p>Changed: {detail.changed_fields.join(', ')}</p>}
          <table>
            <thead>
              <tr>
                <th>Before</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <pre>{describeValue(detail.before)}</pre>
                </td>
                <td>
                  <pre>{describeValue(detail.after)}</pre>
                </td>
              </tr>
            </tbody>
          </table>
          {detail.withheld.length > 0 && (
            <small>Withheld from you: {detail.withheld.join(', ')}</small>
          )}
          {detail.same_request.length > 0 && (
            <ol aria-label="Other entries under the same request">
              {detail.same_request.map((event) => (
                <li key={event.operational_audit_event_id}>
                  <button type="button" onClick={() => void open(event.operational_audit_event_id)}>
                    {event.action} · {new Date(event.occurred_at).toLocaleString()}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </article>
      )}

      <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
        {entries.length === 0 && <p>No audit entries loaded yet.</p>}
        {entries.map((entry) => (
          <article key={entry.operational_audit_event_id}>
            <span>{entry.action}</span>
            <strong>
              {entry.target.kind} {entry.target.reference}
            </strong>
            <p>
              {entry.reason_code} · {new Date(entry.occurred_at).toLocaleString()}
            </p>
            {entry.withheld.length > 0 && <small>{entry.withheld.length} field(s) withheld</small>}
            <button type="button" onClick={() => void open(entry.operational_audit_event_id)}>
              Open
            </button>
          </article>
        ))}
      </div>
      {next && (
        <button type="button" onClick={() => void search(true)}>
          Older entries
        </button>
      )}
    </section>
  );
}
