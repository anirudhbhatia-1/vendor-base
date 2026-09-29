'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ConfirmDialog,
  DataTable,
  DescriptionList,
  type ConfirmReason,
  type DataTableColumn,
} from '@neighbourhood-store/ui';
import { adminRequest } from './authenticated-api';

/**
 * Trust and safety review (11.4, ADM-42 to ADM-44, EXC-14).
 *
 * Signals arrive by subject and restrict nothing. A reviewer opens a subject
 * -- its signals, how good the evidence is, the objects behind them they may
 * open, and the work it has under way -- and proposes a scoped, dated
 * restriction on it. A second person approves, rejects, reviews or revokes
 * it, and decides an appeal; every decision goes through a confirmation with
 * a reason and the version on screen. The server decides what the evidence is
 * worth and what each state allows.
 */
type Subject = {
  readonly subject_kind: string;
  readonly subject_reference: string;
  readonly signals: number;
  readonly weight: number;
  readonly evidence_quality: string;
  readonly last_observed_at: string;
  readonly open_cases: number;
};

type Signal = {
  readonly trust_signal_id: string;
  readonly signal_kind: string;
  readonly source_kind: string;
  readonly weight: number;
  readonly observed_at: string;
  readonly dismissed: boolean;
  readonly source: { readonly kind: string; readonly reference: string } | null;
};

type Dossier = {
  readonly subject_kind: string;
  readonly subject_reference: string;
  readonly subject_name: string;
  readonly evidence_quality: string;
  readonly signals: readonly Signal[];
  readonly withheld_sources: Readonly<Record<string, number>>;
  readonly in_flight: {
    readonly active_orders: number;
    readonly active_assignments: number;
    readonly goods_in_custody: number;
  };
  readonly allowed_scopes: readonly string[];
};

type CaseRow = {
  readonly trust_restriction_case_id: string;
  readonly subject_kind: string;
  readonly subject_reference: string;
  readonly scope_kind: string;
  readonly lifecycle_state: string;
  readonly reason_code: string;
  readonly evidence_quality: string;
  readonly review_at: string;
  readonly next_action: string;
};

type CaseDetail = CaseRow & {
  readonly subject_name: string | null;
  readonly scope_reference: string;
  readonly policy_reference: string;
  readonly evidence_reference: string | null;
  readonly approvable: boolean;
  readonly effective_until: string;
  readonly review_due: boolean;
  readonly version: number;
  readonly in_flight: Dossier['in_flight'];
  readonly history: readonly {
    readonly event_type: string;
    readonly reason_code: string;
    readonly occurred_at: string;
  }[];
  readonly appeals: readonly {
    readonly trust_appeal_id: string;
    readonly statement: string;
    readonly lifecycle_state: string;
  }[];
  readonly allowed_actions: readonly TrustAction[];
};

export type TrustAction = 'APPROVE' | 'REJECT' | 'REVOKE' | 'REVIEW' | 'DECIDE_APPEAL';

export type ProposalForm = {
  readonly scope_kind: string;
  readonly scope_reference: string;
  readonly reason_code: string;
  readonly policy_reference: string;
  readonly evidence_reference: string;
  readonly proposal_note: string;
  readonly days: number;
  readonly review_days: number;
  readonly signal_ids: readonly string[];
};

const REASONS: readonly ConfirmReason[] = [
  { code: 'REPEATED_CONDUCT_REPORTS', label: 'Repeated conduct reports' },
  { code: 'THREAT_AT_DOOR', label: 'Threat or unsafe behaviour' },
  { code: 'PROHIBITED_GOODS', label: 'Prohibited goods' },
  { code: 'UNSAFE_PRODUCE_REPORT', label: 'Unsafe produce report' },
  { code: 'REPEATED_ITEM_COMPLAINTS', label: 'Repeated item complaints' },
];
const DECISION_REASONS: Readonly<Record<TrustAction, readonly ConfirmReason[]>> = {
  APPROVE: [
    { code: 'EVIDENCE_CORROBORATED', label: 'Evidence is corroborated' },
    { code: 'ATTACHED_EVIDENCE_REVIEWED', label: 'Attached evidence reviewed' },
  ],
  REJECT: [
    { code: 'EVIDENCE_INSUFFICIENT', label: 'Evidence is insufficient' },
    { code: 'OUT_OF_POLICY', label: 'Not covered by the policy' },
  ],
  REVOKE: [
    { code: 'RISK_RESOLVED', label: 'The risk is resolved' },
    { code: 'DECIDED_IN_ERROR', label: 'Decided in error' },
  ],
  REVIEW: [{ code: 'SCHEDULED_REVIEW', label: 'Scheduled review' }],
  DECIDE_APPEAL: [
    { code: 'APPEAL_CONSIDERED', label: 'Appeal considered on its merits' },
    { code: 'NEW_INFORMATION', label: 'New information in the appeal' },
  ],
};
const ACTION_LABEL: Readonly<Record<TrustAction, string>> = {
  APPROVE: 'Approve restriction',
  REJECT: 'Reject proposal',
  REVOKE: 'Revoke restriction',
  REVIEW: 'Record review',
  DECIDE_APPEAL: 'Decide appeal',
};

/** The proposal body: a scope, dates from now, and the evidence chosen. */
export function proposalBody(
  subject: { readonly subject_kind: string; readonly subject_reference: string },
  form: ProposalForm,
  now: Date,
): Record<string, unknown> {
  const day = 86_400_000;
  return {
    subject_kind: subject.subject_kind,
    subject_reference: subject.subject_reference,
    scope_kind: form.scope_kind,
    scope_reference: form.scope_kind === 'GLOBAL' ? 'GLOBAL' : form.scope_reference.trim(),
    reason_code: form.reason_code,
    policy_reference: form.policy_reference.trim(),
    signal_ids: form.signal_ids,
    ...(form.evidence_reference.trim()
      ? { evidence_reference: form.evidence_reference.trim() }
      : {}),
    ...(form.proposal_note.trim() ? { proposal_note: form.proposal_note.trim() } : {}),
    effective_until: new Date(now.getTime() + form.days * day).toISOString(),
    review_at: new Date(now.getTime() + Math.min(form.review_days, form.days) * day).toISOString(),
  };
}

/** A decision body, against the version on screen. */
export function decisionBody(
  action: TrustAction,
  reason: string,
  version: number,
  extra: { readonly outcome?: string; readonly date?: string },
): Record<string, unknown> {
  const base = { expected_version: version, reason_code: reason };
  if (action === 'REVIEW') {
    const at = extra.date ? new Date(extra.date).toISOString() : undefined;
    return {
      ...base,
      outcome: extra.outcome ?? 'KEEP',
      ...(extra.outcome === 'KEEP' && at ? { review_at: at } : {}),
      ...(extra.outcome === 'SHORTEN' && at ? { effective_until: at } : {}),
    };
  }
  if (action === 'DECIDE_APPEAL') return { ...base, outcome: extra.outcome ?? 'UPHOLD' };
  return base;
}

const SUBJECT_COLUMNS: readonly DataTableColumn<Subject>[] = [
  { key: 'kind', header: 'Subject', render: (row) => row.subject_kind.replaceAll('_', ' ') },
  { key: 'reference', header: 'Reference', render: (row) => row.subject_reference.slice(0, 13) },
  { key: 'signals', header: 'Signals', numeric: true, render: (row) => row.signals },
  {
    key: 'quality',
    header: 'Evidence',
    render: (row) => row.evidence_quality.replaceAll('_', ' '),
  },
  { key: 'cases', header: 'Open cases', numeric: true, render: (row) => row.open_cases },
];
const CASE_COLUMNS: readonly DataTableColumn<CaseRow>[] = [
  {
    key: 'next',
    header: 'Next',
    render: (row) => row.next_action.replaceAll('_', ' ').toLowerCase(),
  },
  { key: 'subject', header: 'Subject', render: (row) => row.subject_kind.replaceAll('_', ' ') },
  { key: 'scope', header: 'Scope', render: (row) => row.scope_kind },
  { key: 'state', header: 'State', render: (row) => row.lifecycle_state },
  { key: 'reason', header: 'Reason', render: (row) => row.reason_code.replaceAll('_', ' ') },
  {
    key: 'review',
    header: 'Review',
    render: (row) => new Date(row.review_at).toLocaleDateString(),
  },
];

export function TrustPanel() {
  const [subjects, setSubjects] = useState<readonly Subject[]>([]);
  const [cases, setCases] = useState<readonly CaseRow[]>([]);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [form, setForm] = useState<ProposalForm | null>(null);
  const [confirming, setConfirming] = useState<TrustAction | 'PROPOSE' | 'DISMISS' | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [outcome, setOutcome] = useState('KEEP');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [message, setMessage] = useState('Loading trust work…');

  const load = useCallback(async () => {
    try {
      const [queue, work] = await Promise.all([
        adminRequest<{ subjects: Subject[] }>('admin/trust/signals'),
        adminRequest<{ cases: CaseRow[] }>('admin/trust/cases?view=WORK'),
      ]);
      setSubjects(queue.subjects);
      setCases(work.cases);
      setMessage(
        `${queue.subjects.length} subjects with signals · ${work.cases.length} open cases.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Trust work failed to load.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function openSubject(subject: Subject) {
    try {
      const view = await adminRequest<Dossier>(
        `admin/trust/subjects/${subject.subject_kind}/${subject.subject_reference}`,
      );
      setDossier(view);
      setDetail(null);
      setForm({
        scope_kind: view.allowed_scopes[0] ?? 'GLOBAL',
        scope_reference: '',
        reason_code: REASONS[0]?.code ?? 'REPEATED_CONDUCT_REPORTS',
        policy_reference: 'SYNTH-POLICY-TRUST-0001',
        evidence_reference: '',
        proposal_note: '',
        days: 14,
        review_days: 7,
        signal_ids: view.signals
          .filter((signal) => !signal.dismissed)
          .map((s) => s.trust_signal_id),
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The subject could not be read.');
    }
  }

  async function openCase(row: CaseRow) {
    try {
      setDetail(
        await adminRequest<CaseDetail>(`admin/trust/cases/${row.trust_restriction_case_id}`),
      );
      setDossier(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The case could not be read.');
    }
  }

  async function run(work: () => Promise<void>, done: string) {
    setBusy(true);
    setDialogError(null);
    try {
      await work();
      setConfirming(null);
      setMessage(done);
      await load();
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : 'That step failed.');
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof ProposalForm) => ({
    value: form ? String(form[key]) : '',
    onChange: (event: { target: { value: string } }) =>
      form &&
      setForm({
        ...form,
        [key]:
          key === 'days' || key === 'review_days' ? Number(event.target.value) : event.target.value,
      }),
  });

  return (
    <section className="catalogue-oversight" id="trust-review">
      <div>
        <p className="eyebrow">TRUST AND SAFETY</p>
        <h2>Signals are evidence, not decisions</h2>
        <p>
          Nothing is restricted automatically. A restriction needs corroborated signals or evidence
          a person attached, a second person to approve it, and it stops only new work.
        </p>
      </div>
      <p aria-live="polite">{message}</p>
      <div className="actions">
        <button
          type="button"
          onClick={() =>
            void run(async () => {
              const result = await adminRequest<{ collected: number }>(
                'admin/trust/signals/collect',
                {
                  method: 'POST',
                },
              );
              setMessage(`${result.collected} new signals collected.`);
            }, 'Signals collected.')
          }
        >
          Collect new signals
        </button>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <DataTable
        caption="Subjects with signals"
        columns={SUBJECT_COLUMNS}
        empty="No signals in the last 90 days."
        onOpen={(row) => void openSubject(row)}
        openLabel={() => 'Open subject'}
        rowKey={(row) => `${row.subject_kind}:${row.subject_reference}`}
        rows={subjects}
      />
      <DataTable
        caption="Cases waiting on a decision"
        columns={CASE_COLUMNS}
        empty="No proposals, reviews or appeals waiting."
        onOpen={(row) => void openCase(row)}
        openLabel={() => 'Open case'}
        rowKey={(row) => row.trust_restriction_case_id}
        rows={cases}
      />

      {dossier && form ? (
        <div className="catalogue-flag">
          <p className="eyebrow">
            {dossier.subject_kind.replaceAll('_', ' ')} · {dossier.subject_name}
          </p>
          <DescriptionList
            items={[
              { label: 'Evidence', value: dossier.evidence_quality.replaceAll('_', ' ') },
              { label: 'Orders under way', value: dossier.in_flight.active_orders, numeric: true },
              {
                label: 'Deliveries under way',
                value: dossier.in_flight.active_assignments,
                numeric: true,
              },
              {
                label: 'Goods in custody',
                value: dossier.in_flight.goods_in_custody,
                numeric: true,
              },
            ]}
          />
          <p>Work already under way is never stopped by a restriction.</p>
          <ul>
            {dossier.signals.map((signal) => (
              <li key={signal.trust_signal_id}>
                <label>
                  <input
                    checked={form.signal_ids.includes(signal.trust_signal_id)}
                    disabled={signal.dismissed}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        signal_ids: event.target.checked
                          ? [...form.signal_ids, signal.trust_signal_id]
                          : form.signal_ids.filter((id) => id !== signal.trust_signal_id),
                      })
                    }
                    type="checkbox"
                  />{' '}
                  {signal.signal_kind.replaceAll('_', ' ').toLowerCase()} · weight {signal.weight} ·{' '}
                  {new Date(signal.observed_at).toLocaleDateString()}
                  {signal.source
                    ? ` · ${signal.source.kind} ${signal.source.reference.slice(0, 8)}`
                    : ''}
                  {signal.dismissed ? ' · set aside' : ''}
                </label>{' '}
                {!signal.dismissed ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDismissing(signal.trust_signal_id);
                      setConfirming('DISMISS');
                    }}
                  >
                    Set aside
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {Object.entries(dossier.withheld_sources).map(([kind, count]) => (
            <p key={kind}>
              {count} {kind.replaceAll('_', ' ').toLowerCase()} source{count === 1 ? '' : 's'} not
              shown:{' '}
              {kind.endsWith('RATING')
                ? 'ratings are never traced to a customer'
                : 'you may not open them'}
              .
            </p>
          ))}
          <p className="eyebrow">PROPOSE A RESTRICTION</p>
          <label>
            Scope
            <select {...field('scope_kind')}>
              {dossier.allowed_scopes.map((scope) => (
                <option key={scope} value={scope}>
                  {scope.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          {form.scope_kind !== 'GLOBAL' ? (
            <label>
              {form.scope_kind === 'CATEGORY'
                ? 'Category code'
                : `${form.scope_kind.replaceAll('_', ' ')} id`}
              <input {...field('scope_reference')} />
            </label>
          ) : null}
          <label>
            Reason
            <select {...field('reason_code')}>
              {REASONS.map((reason) => (
                <option key={reason.code} value={reason.code}>
                  {reason.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Policy
            <input {...field('policy_reference')} />
          </label>
          <label>
            Attached evidence (optional)
            <input placeholder="SYNTH-EVIDENCE-…" {...field('evidence_reference')} />
          </label>
          <label>
            In force for
            <select {...field('days')}>
              {[3, 7, 14, 30, 90].map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </select>
          </label>
          <label>
            Review after
            <select {...field('review_days')}>
              {[1, 3, 7, 14, 30].map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </select>
          </label>
          <label>
            Note for the approver
            <textarea rows={2} {...field('proposal_note')} />
          </label>
          <div className="actions">
            <button type="button" onClick={() => setConfirming('PROPOSE')}>
              Propose restriction
            </button>
          </div>
        </div>
      ) : null}

      {detail ? (
        <div className="catalogue-flag">
          <p className="eyebrow">
            CASE {detail.trust_restriction_case_id.slice(0, 13)} · VERSION {detail.version}
          </p>
          <DescriptionList
            items={[
              {
                label: 'Subject',
                value: `${detail.subject_kind} · ${detail.subject_name ?? detail.subject_reference}`,
              },
              {
                label: 'Scope',
                value: `${detail.scope_kind} ${detail.scope_kind === 'GLOBAL' ? '' : detail.scope_reference}`,
              },
              { label: 'State', value: detail.lifecycle_state },
              {
                label: 'Evidence',
                value: `${detail.evidence_quality.replaceAll('_', ' ')}${detail.evidence_reference ? ` + ${detail.evidence_reference}` : ''}`,
              },
              { label: 'Policy', value: detail.policy_reference },
              {
                label: 'Review',
                value: `${new Date(detail.review_at).toLocaleString()}${detail.review_due ? ' (due)' : ''}`,
              },
              { label: 'Ends', value: new Date(detail.effective_until).toLocaleString() },
              {
                label: 'Goods in custody left running',
                value: detail.in_flight.goods_in_custody,
                numeric: true,
              },
            ]}
          />
          {!detail.approvable && detail.lifecycle_state === 'PROPOSED' ? (
            <p>
              This rests on one account. It cannot be approved until it is corroborated or evidence
              is attached.
            </p>
          ) : null}
          {detail.appeals.map((appeal) => (
            <blockquote key={appeal.trust_appeal_id}>
              Appeal ({appeal.lifecycle_state.toLowerCase()}): {appeal.statement}
            </blockquote>
          ))}
          <ol>
            {detail.history.map((event, index) => (
              <li key={`${event.event_type}-${index}`}>
                {new Date(event.occurred_at).toLocaleString()} · {event.event_type} (
                {event.reason_code})
              </li>
            ))}
          </ol>
          <div className="actions">
            {detail.allowed_actions.length === 0 ? <p>This case is history.</p> : null}
            {detail.allowed_actions.map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => {
                  setOutcome(action === 'DECIDE_APPEAL' ? 'UPHOLD' : 'KEEP');
                  setDate('');
                  setConfirming(action);
                }}
              >
                {ACTION_LABEL[action]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        busy={busy}
        confirmLabel={
          confirming === 'PROPOSE'
            ? 'Propose'
            : confirming === 'DISMISS'
              ? 'Set aside'
              : confirming
                ? ACTION_LABEL[confirming]
                : 'Confirm'
        }
        error={dialogError}
        onCancel={() => setConfirming(null)}
        onConfirm={({ reason_code }) => {
          if (confirming === 'PROPOSE' && dossier && form) {
            void run(async () => {
              await adminRequest('admin/trust/cases', {
                method: 'POST',
                body: JSON.stringify(proposalBody(dossier, form, new Date())),
              });
            }, 'Restriction proposed for a second person to decide.');
          } else if (confirming === 'DISMISS' && dismissing) {
            void run(async () => {
              await adminRequest(`admin/trust/signals/${dismissing}/dismiss`, {
                method: 'POST',
                body: JSON.stringify({ reason_code: reason_code ?? 'NOT_CREDIBLE' }),
              });
              if (dossier)
                await openSubject({
                  subject_kind: dossier.subject_kind,
                  subject_reference: dossier.subject_reference,
                } as Subject);
            }, 'Signal set aside.');
          } else if (confirming && confirming !== 'PROPOSE' && confirming !== 'DISMISS' && detail) {
            const action = confirming;
            void run(async () => {
              await adminRequest(
                `admin/trust/cases/${detail.trust_restriction_case_id}/actions/${action}`,
                {
                  method: 'POST',
                  body: JSON.stringify(
                    decisionBody(action, reason_code ?? '', detail.version, { outcome, date }),
                  ),
                },
              );
              await openCase(detail);
            }, `${ACTION_LABEL[action]} recorded.`);
          }
        }}
        open={confirming !== null}
        reasons={
          confirming === 'PROPOSE'
            ? undefined
            : confirming === 'DISMISS'
              ? [
                  { code: 'NOT_CREDIBLE', label: 'Not credible' },
                  { code: 'ABOUT_SOMEONE_ELSE', label: 'About someone else' },
                ]
              : confirming
                ? DECISION_REASONS[confirming]
                : undefined
        }
        title={
          confirming === 'PROPOSE'
            ? `Propose a ${form?.scope_kind.toLowerCase() ?? ''} restriction for ${form?.days ?? 0} days`
            : confirming === 'DISMISS'
              ? 'Set this signal aside; it stays on record and stops counting'
              : confirming
                ? `${ACTION_LABEL[confirming]} (version ${detail?.version ?? '?'})`
                : ''
        }
        tone={confirming === 'APPROVE' || confirming === 'REVOKE' ? 'danger' : 'primary'}
      >
        {confirming === 'REVIEW' ? (
          <>
            <label>
              Outcome
              <select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
                <option value="KEEP">Keep, and review again</option>
                <option value="SHORTEN">Shorten</option>
                <option value="LIFT">Lift now</option>
              </select>
            </label>
            {outcome !== 'LIFT' ? (
              <label>
                {outcome === 'KEEP' ? 'Next review' : 'New end'}
                <input
                  type="datetime-local"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
            ) : null}
          </>
        ) : null}
        {confirming === 'DECIDE_APPEAL' ? (
          <label>
            Outcome
            <select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
              <option value="UPHOLD">Uphold: the restriction stands</option>
              <option value="OVERTURN">Overturn: lift it</option>
            </select>
          </label>
        ) : null}
        {confirming === 'APPROVE' && detail ? (
          <p>
            It takes force at once for new work. {detail.in_flight.goods_in_custody} item(s) in
            custody and {detail.in_flight.active_orders} order(s) under way carry on.
          </p>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
