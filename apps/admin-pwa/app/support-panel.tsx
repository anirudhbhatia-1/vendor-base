'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './authenticated-api';

/**
 * Support cases (11.3, ADM-36 to ADM-40).
 *
 * The queue is the server's, ranked the way the dashboard ranks all work. A
 * case opens to its participant thread and its internal notes side by side
 * -- the customer reads only the first -- with its evidence and history, and
 * offers only the steps its state allows. Each step is sent against the
 * version on screen with a reason, so two operators cannot overwrite each
 * other, and the server decides the deadline, the owner and what is allowed.
 */
type QueueRow = {
  readonly support_case_id: string;
  readonly order_reference: string;
  readonly category: string;
  readonly subject_kind: 'LINE' | 'DELIVERY' | 'ORDER';
  readonly line_title: string | null;
  readonly severity: string;
  readonly lifecycle_state: string;
  readonly awaiting: string;
  readonly owner_team: string | null;
  readonly owner_user_id: string | null;
  readonly mine: boolean;
  readonly response_due_at: string | null;
  readonly next_action: string;
  readonly overdue?: boolean;
  readonly escalation_due?: boolean;
  readonly resolution_code: string | null;
  readonly created_at: string;
};

type Message = {
  readonly support_case_message_id: string;
  readonly author_role: 'CUSTOMER' | 'SUPPORT';
  readonly message_kind: string;
  readonly body: string;
  readonly created_at: string;
};

type CaseDetail = {
  readonly support_case_id: string;
  readonly order_reference: string;
  readonly category: string;
  readonly description: string;
  readonly subject: { readonly kind: string; readonly title?: string | null };
  readonly severity: string;
  readonly lifecycle_state: string;
  readonly awaiting: string;
  readonly owner_user_id: string | null;
  readonly owner_team: string | null;
  readonly response_due_at: string | null;
  readonly merged_into_case_id: string | null;
  readonly merged_cases: readonly string[];
  readonly resolution: { readonly code: string; readonly refund_id: string | null } | null;
  readonly quality_review: { readonly outcome: string } | null;
  readonly reopen_count: number;
  readonly version: number;
  readonly next_action: string;
  readonly allowed_actions: readonly SupportAction[];
  readonly participant_thread: readonly Message[];
  readonly internal_notes: readonly Message[];
  readonly evidence: readonly {
    readonly support_case_evidence_id: string;
    readonly evidence_reference: string;
    readonly classification: string;
  }[];
  readonly history: readonly {
    readonly support_case_event_id: string;
    readonly event_type: string;
    readonly reason_code: string;
    readonly occurred_at: string;
  }[];
};

export type SupportAction =
  | 'ASSIGN'
  | 'NOTE'
  | 'MESSAGE'
  | 'REQUEST_RESPONSE'
  | 'ESCALATE'
  | 'RESOLVE'
  | 'REOPEN'
  | 'QUALITY_REVIEW'
  | 'EVIDENCE'
  | 'MERGE';

export type ActionForm = {
  readonly reason_code: string;
  readonly body: string;
  readonly owner_user_id: string;
  readonly owner_team: string;
  readonly severity: string;
  readonly respond_within_hours: string;
  readonly resolution_code: string;
  readonly refund_id: string;
  readonly outcome: string;
  readonly evidence_reference: string;
  readonly classification: string;
  readonly target_case_id: string;
};

const categories = [
  'MISSING_ITEM',
  'DAMAGED_ITEM',
  'WRONG_ITEM',
  'LATE_DELIVERY',
  'CANCELLATION_AFTER_PICKUP',
  'ORDER_HELP',
  'PAYMENT_ISSUE',
  'DELIVERY_RETURNED',
  'PARTNER_CONDUCT',
] as const;
const severities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const teams = ['SUPPORT_AGENT', 'QUEUE_OWNER', 'OPERATIONS_LEAD', 'INCIDENT_COMMANDER'] as const;
const resolutions = [
  'REFUNDED',
  'REPLACED',
  'EXPLAINED',
  'FIXED_BY_STORE',
  'FIXED_BY_DELIVERY',
  'NO_FAULT_FOUND',
  'CUSTOMER_UNRESPONSIVE',
] as const;
const actionLabels: Readonly<Record<SupportAction, string>> = {
  ASSIGN: 'Assign',
  NOTE: 'Internal note',
  MESSAGE: 'Reply to customer',
  REQUEST_RESPONSE: 'Ask the customer',
  ESCALATE: 'Escalate',
  RESOLVE: 'Resolve',
  REOPEN: 'Reopen',
  QUALITY_REVIEW: 'Quality review',
  EVIDENCE: 'Attach evidence',
  MERGE: 'Merge into another case',
};

const emptyForm: ActionForm = {
  reason_code: '',
  body: '',
  owner_user_id: '',
  owner_team: '',
  severity: '',
  respond_within_hours: '48',
  resolution_code: 'EXPLAINED',
  refund_id: '',
  outcome: 'PASS',
  evidence_reference: '',
  classification: 'INTERNAL',
  target_case_id: '',
};

/** The request body for one step, against the version on screen. */
export function supportActionBody(
  action: SupportAction,
  form: ActionForm,
  version: number,
): Record<string, unknown> {
  const reason = form.reason_code.trim() || `SUPPORT_${action}`;
  const base = { expected_version: version, reason_code: reason };
  const body = form.body.trim();
  switch (action) {
    case 'ASSIGN':
      return {
        ...base,
        ...(form.owner_user_id.trim() ? { owner_user_id: form.owner_user_id.trim() } : {}),
        ...(form.owner_team ? { owner_team: form.owner_team } : {}),
      };
    case 'NOTE':
    case 'MESSAGE':
      return { ...base, body };
    case 'REQUEST_RESPONSE':
      return {
        ...base,
        body,
        respond_within_seconds: Math.round(Number(form.respond_within_hours) * 3600),
      };
    case 'ESCALATE':
      return { ...base, ...(form.severity ? { severity: form.severity } : {}) };
    case 'RESOLVE':
      return {
        ...base,
        body,
        resolution_code: form.resolution_code,
        ...(form.resolution_code === 'REFUNDED' ? { refund_id: form.refund_id.trim() } : {}),
      };
    case 'REOPEN':
      return base;
    case 'QUALITY_REVIEW':
      return { ...base, outcome: form.outcome, ...(body ? { body } : {}) };
    case 'EVIDENCE':
      return {
        ...base,
        evidence_reference: form.evidence_reference.trim(),
        classification: form.classification,
      };
    case 'MERGE':
      return { ...base, target_case_id: form.target_case_id.trim() };
  }
}

/** Whose turn it is and when, in words. */
export function turnSentence(
  row: { readonly awaiting: string; readonly response_due_at: string | null },
  now: Date,
): string {
  if (row.awaiting === 'NONE' || !row.response_due_at) return 'Nobody owes a reply.';
  const due = new Date(row.response_due_at);
  const minutes = Math.round((due.getTime() - now.getTime()) / 60_000);
  const when =
    minutes < 0
      ? `${Math.abs(minutes)} min overdue`
      : minutes < 120
        ? `due in ${minutes} min`
        : `due ${due.toLocaleString()}`;
  return row.awaiting === 'PARTICIPANT'
    ? `Waiting on the customer; follow up ${when}.`
    : `Support owes a reply, ${when}.`;
}

export function SupportPanel() {
  const [view, setView] = useState<'ACTIVE' | 'QUALITY_SAMPLE' | 'CLOSED'>('ACTIVE');
  const [owner, setOwner] = useState<'ANY' | 'ME' | 'UNASSIGNED'>('ANY');
  const [queue, setQueue] = useState<readonly QueueRow[]>([]);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [action, setAction] = useState<SupportAction | null>(null);
  const [form, setForm] = useState<ActionForm>(emptyForm);
  const [draft, setDraft] = useState({
    vendor_order_id: '',
    vendor_order_line_id: '',
    category: 'ORDER_HELP',
    severity: '',
    description: '',
  });
  const [message, setMessage] = useState('Loading the support queue…');

  const load = useCallback(async () => {
    try {
      const result = await adminRequest<{ cases: QueueRow[] }>(
        `admin/support/cases?view=${view}&owner=${owner}`,
      );
      setQueue(result.cases);
      setMessage(`${result.cases.length} case${result.cases.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The support queue failed to load.');
    }
  }, [view, owner]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(caseId: string) {
    try {
      setDetail(await adminRequest<CaseDetail>(`admin/support/cases/${caseId}`));
      setAction(null);
      setForm(emptyForm);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The case could not be read.');
    }
  }

  async function openCase() {
    if (!draft.vendor_order_id.trim() || !draft.description.trim()) {
      setMessage('A case needs the order it concerns and a description.');
      return;
    }
    try {
      const result = await adminRequest<{ support_case_id: string; deduplicated: boolean }>(
        'admin/support/cases',
        {
          method: 'POST',
          body: JSON.stringify({
            vendor_order_id: draft.vendor_order_id.trim(),
            category: draft.category,
            description: draft.description.trim(),
            ...(draft.vendor_order_line_id.trim()
              ? { vendor_order_line_id: draft.vendor_order_line_id.trim() }
              : {}),
            ...(draft.severity ? { severity: draft.severity } : {}),
          }),
        },
      );
      setDraft({ ...draft, description: '' });
      setMessage(
        result.deduplicated
          ? 'A case about this is already open; the report was added to it as a note.'
          : 'Case opened.',
      );
      await load();
      await openDetail(result.support_case_id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The case could not be opened.');
    }
  }

  async function submit() {
    if (!detail || !action) return;
    try {
      await adminRequest(`admin/support/cases/${detail.support_case_id}/actions/${action}`, {
        method: 'POST',
        body: JSON.stringify(supportActionBody(action, form, detail.version)),
      });
      setMessage(`${actionLabels[action]} recorded.`);
      await load();
      await openDetail(detail.support_case_id);
    } catch (error) {
      // A 409 means someone else moved the case; reload before trying again.
      setMessage(error instanceof Error ? error.message : `${actionLabels[action]} failed.`);
    }
  }

  const field = (key: keyof ActionForm) => ({
    value: form[key],
    onChange: (event: { target: { value: string } }) =>
      setForm({ ...form, [key]: event.target.value }),
  });

  return (
    <section className="catalogue-oversight" id="support-cases">
      <div>
        <p className="eyebrow">SUPPORT</p>
        <h2>{view === 'ACTIVE' ? `${queue.length} open cases` : `${queue.length} cases`}</h2>
        <p>
          Ranked like every other queue: severity, then whoever is overdue or due soonest. Every
          step is versioned, reasoned and audited.
        </p>
      </div>
      <p aria-live="polite">{message}</p>

      <div className="actions">
        <label>
          Queue
          <select value={view} onChange={(e) => setView(e.target.value as typeof view)}>
            <option value="ACTIVE">Open</option>
            <option value="QUALITY_SAMPLE">Waiting for quality review</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
        <label>
          Owner
          <select value={owner} onChange={(e) => setOwner(e.target.value as typeof owner)}>
            <option value="ANY">Anyone</option>
            <option value="ME">Mine</option>
            <option value="UNASSIGNED">Unassigned</option>
          </select>
        </label>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
        {queue.length === 0 && <p>No cases here.</p>}
        {queue.map((row) => (
          <article key={row.support_case_id}>
            <span>
              {row.severity} · {row.next_action.replaceAll('_', ' ').toLowerCase()}
              {row.overdue ? ' · overdue' : row.escalation_due ? ' · escalate' : ''}
            </span>
            <strong>{row.category.replaceAll('_', ' ')}</strong>
            <p>
              {row.order_reference}
              {row.line_title ? ` · ${row.line_title}` : ''} · {row.owner_team ?? 'unowned'}
              {row.mine ? ' (you)' : ''}
            </p>
            <p>{turnSentence(row, new Date())}</p>
            <button type="button" onClick={() => void openDetail(row.support_case_id)}>
              {detail?.support_case_id === row.support_case_id ? 'Open' : 'Work on this case'}
            </button>
          </article>
        ))}
      </div>

      {detail && (
        <div className="catalogue-flag" style={{ marginTop: '1rem' }}>
          <p className="eyebrow">
            CASE {detail.support_case_id} · VERSION {detail.version}
          </p>
          <h3>
            {detail.category.replaceAll('_', ' ')} · {detail.lifecycle_state} · {detail.severity}
          </h3>
          <p>
            Order {detail.order_reference} · about the {detail.subject.kind.toLowerCase()}
            {detail.subject.title ? ` (${detail.subject.title})` : ''} · owner{' '}
            {detail.owner_user_id ?? detail.owner_team ?? 'none'}
          </p>
          <p>{turnSentence(detail, new Date())}</p>
          {detail.merged_into_case_id && <p>Merged into {detail.merged_into_case_id}.</p>}
          {detail.merged_cases.length > 0 && (
            <p>Cases merged into this one: {detail.merged_cases.join(', ')}</p>
          )}
          {detail.resolution && (
            <p>
              Resolved: {detail.resolution.code}
              {detail.resolution.refund_id ? ` (refund ${detail.resolution.refund_id})` : ''}
              {detail.quality_review ? ` · reviewed ${detail.quality_review.outcome}` : ''}
            </p>
          )}
          <blockquote>{detail.description}</blockquote>

          <div className="admin-card-grid">
            <article aria-label="Participant thread">
              <span>What the customer sees</span>
              {detail.participant_thread.length === 0 && <p>No messages yet.</p>}
              {detail.participant_thread.map((entry) => (
                <p key={entry.support_case_message_id}>
                  <strong>
                    {entry.author_role === 'CUSTOMER' ? 'Customer' : 'Support'}
                    {entry.message_kind !== 'MESSAGE'
                      ? ` · ${entry.message_kind.toLowerCase()}`
                      : ''}
                  </strong>
                  : {entry.body}
                </p>
              ))}
            </article>
            <article aria-label="Internal notes">
              <span>Internal only</span>
              {detail.internal_notes.length === 0 && <p>No notes.</p>}
              {detail.internal_notes.map((entry) => (
                <p key={entry.support_case_message_id}>{entry.body}</p>
              ))}
              {detail.evidence.map((entry) => (
                <p key={entry.support_case_evidence_id}>
                  Evidence {entry.evidence_reference} ({entry.classification})
                </p>
              ))}
            </article>
            <article aria-label="History">
              <span>History</span>
              {detail.history.map((entry) => (
                <p key={entry.support_case_event_id}>
                  {new Date(entry.occurred_at).toLocaleString()} · {entry.event_type} (
                  {entry.reason_code})
                </p>
              ))}
            </article>
          </div>

          <div className="actions">
            {detail.allowed_actions.length === 0 && (
              <p>This case is history; nothing can be done to it.</p>
            )}
            {detail.allowed_actions.map((allowed) => (
              <button
                key={allowed}
                type="button"
                aria-pressed={action === allowed}
                onClick={() => {
                  setAction(allowed);
                  setForm(emptyForm);
                }}
              >
                {actionLabels[allowed]}
              </button>
            ))}
          </div>

          {action && (
            <div className="catalogue-flag">
              <p className="eyebrow">{actionLabels[action].toUpperCase()}</p>
              {action === 'ASSIGN' && (
                <>
                  <label>
                    Person (admin user id)
                    <input {...field('owner_user_id')} />
                  </label>
                  <label>
                    Team
                    <select {...field('owner_team')}>
                      <option value="">Keep the current team</option>
                      {teams.map((team) => (
                        <option key={team} value={team}>
                          {team.replaceAll('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {action === 'ESCALATE' && (
                <label>
                  To severity
                  <select {...field('severity')}>
                    <option value="">One step up</option>
                    {severities.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {action === 'RESOLVE' && (
                <>
                  <label>
                    Resolution
                    <select {...field('resolution_code')}>
                      {resolutions.map((code) => (
                        <option key={code} value={code}>
                          {code.replaceAll('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </label>
                  {form.resolution_code === 'REFUNDED' && (
                    <label>
                      Approved refund id
                      <input {...field('refund_id')} />
                    </label>
                  )}
                </>
              )}
              {action === 'REQUEST_RESPONSE' && (
                <label>
                  Follow up after (hours)
                  <input type="number" min={1} max={168} {...field('respond_within_hours')} />
                </label>
              )}
              {action === 'QUALITY_REVIEW' && (
                <label>
                  Outcome
                  <select {...field('outcome')}>
                    <option value="PASS">Pass</option>
                    <option value="NEEDS_COACHING">Needs coaching</option>
                    <option value="FAIL">Fail</option>
                  </select>
                </label>
              )}
              {action === 'EVIDENCE' && (
                <>
                  <label>
                    Evidence reference
                    <input {...field('evidence_reference')} />
                  </label>
                  <label>
                    Classification
                    <select {...field('classification')}>
                      <option value="INTERNAL">Internal</option>
                      <option value="RESTRICTED">Restricted</option>
                    </select>
                  </label>
                </>
              )}
              {action === 'MERGE' && (
                <label>
                  Case to merge into
                  <input {...field('target_case_id')} />
                </label>
              )}
              {['NOTE', 'MESSAGE', 'REQUEST_RESPONSE', 'RESOLVE', 'QUALITY_REVIEW'].includes(
                action,
              ) && (
                <label>
                  {action === 'NOTE' || action === 'QUALITY_REVIEW'
                    ? 'Note (internal; the customer never sees it)'
                    : 'Message (the customer reads this)'}
                  <textarea rows={3} {...field('body')} />
                </label>
              )}
              <label>
                Reason code
                <input placeholder={`SUPPORT_${action}`} {...field('reason_code')} />
              </label>
              <div className="actions">
                <button type="button" onClick={() => void submit()}>
                  Confirm {actionLabels[action].toLowerCase()}
                </button>
                <button type="button" onClick={() => setAction(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="catalogue-flag" style={{ marginTop: '1rem' }}>
        <p className="eyebrow">OPEN A CASE</p>
        <label>
          Vendor order ID
          <input
            value={draft.vendor_order_id}
            onChange={(e) => setDraft({ ...draft, vendor_order_id: e.target.value })}
          />
        </label>
        <label>
          Item (order line ID, for an item problem)
          <input
            value={draft.vendor_order_line_id}
            onChange={(e) => setDraft({ ...draft, vendor_order_line_id: e.target.value })}
          />
        </label>
        <label>
          Category
          <select
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          >
            {categories.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity
          <select
            value={draft.severity}
            onChange={(e) => setDraft({ ...draft, severity: e.target.value })}
          >
            <option value="">The category&apos;s own</option>
            {severities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          What happened
          <textarea
            rows={3}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
        <div className="actions">
          <button type="button" onClick={() => void openCase()}>
            Open case
          </button>
        </div>
      </div>
    </section>
  );
}
