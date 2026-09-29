'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ConfirmDialog,
  DataTable,
  DescriptionList,
  formatMoneyMinor,
  type ConfirmReason,
  type DataTableColumn,
} from '@neighbourhood-store/ui';
import { adminRequest } from './authenticated-api';

/**
 * The finance queues (11.5): eleven owned queues, each row with what was
 * expected and what happened, its references, risk, age, last retry, next
 * safe action, correction, approval and evidence; a row opens to its history
 * and the steps its state allows, each confirmed with a reason against the
 * version on screen. The server decides what is allowed.
 */
type QueueSummary = {
  readonly key: string;
  readonly title: string;
  readonly owner: string;
  readonly open: number;
  readonly at_risk_minor: number;
  readonly oldest_age_seconds: number | null;
};

export type ExceptionRow = {
  readonly finance_exception_id: string;
  readonly queue: string;
  readonly exception_kind: string;
  readonly exception_state: string;
  readonly expected_minor: number | null;
  readonly actual_minor: number | null;
  readonly amount_at_risk_minor: number;
  readonly provider_reference: string;
  readonly provider_state: string | null;
  readonly business_reference: string | null;
  readonly risk: string;
  readonly age_seconds: number;
  readonly attempts: number;
  readonly last_retry_at: string | null;
  readonly next_safe_action: string;
  readonly correction: {
    readonly financial_correction_id: string;
    readonly state: string | null;
  } | null;
  readonly approval: string;
  readonly evidence_count: number;
  readonly allowed_actions: readonly FinanceAction[];
  readonly version: number;
};

type Detail = ExceptionRow & {
  readonly history: readonly {
    readonly event_type: string;
    readonly reason_code: string;
    readonly occurred_at: string;
    readonly payload: Record<string, unknown>;
  }[];
};

type Dispute = {
  readonly dispute_kind: string;
  readonly dispute_id: string;
  readonly business_reference: string;
  readonly expected_minor: number;
  readonly actual_minor: number;
  readonly age_seconds: number;
  readonly deadline_at: string;
};

export type FinanceAction =
  | 'ASSIGN'
  | 'NOTE'
  | 'EVIDENCE'
  | 'RECONCILE'
  | 'LINK_CORRECTION'
  | 'RESOLVE'
  | 'PROPOSE_WRITE_OFF'
  | 'APPROVE_WRITE_OFF'
  | 'REOPEN';

const LABEL: Readonly<Record<FinanceAction, string>> = {
  ASSIGN: 'Take it',
  NOTE: 'Add a note',
  EVIDENCE: 'Attach evidence',
  RECONCILE: "Reconcile with the provider's answer",
  LINK_CORRECTION: 'Link a correction',
  RESOLVE: 'Resolve',
  PROPOSE_WRITE_OFF: 'Propose a write-off',
  APPROVE_WRITE_OFF: 'Approve the write-off',
  REOPEN: 'Reopen',
};
const REASONS: readonly ConfirmReason[] = [
  { code: 'PROVIDER_STATEMENT_CHECKED', label: 'Provider statement checked' },
  { code: 'PROVIDER_CONTACTED', label: 'Provider contacted' },
  { code: 'LEDGER_REVIEWED', label: 'Ledger reviewed' },
  { code: 'SECOND_LOOK', label: 'Second look' },
];

/** Whole seconds as the largest sensible unit. */
export function ageText(seconds: number): string {
  if (seconds < 3_600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 172_800) return `${Math.round(seconds / 3_600)} h`;
  return `${Math.round(seconds / 86_400)} d`;
}

/** Expected against actual, in rupees, or a dash when the queue has no amount. */
export function valuesText(row: Pick<ExceptionRow, 'expected_minor' | 'actual_minor'>): string {
  const show = (value: number | null) => (value === null ? '—' : formatMoneyMinor(value));
  return `${show(row.expected_minor)} expected · ${show(row.actual_minor)} actual`;
}

/** The request body for one step, against the version on screen. */
export function exceptionActionBody(
  action: FinanceAction,
  reason: string,
  version: number,
  fields: {
    readonly note?: string;
    readonly evidence_reference?: string;
    readonly financial_correction_id?: string;
    readonly resolution_code?: string;
    readonly provider_state?: string;
  },
): Record<string, unknown> {
  const body: Record<string, unknown> = { expected_version: version, reason_code: reason };
  const trimmed = (value?: string) => value?.trim() || undefined;
  if (action === 'NOTE' || action === 'PROPOSE_WRITE_OFF') body.note = trimmed(fields.note);
  if (action === 'EVIDENCE' || action === 'RECONCILE')
    body.evidence_reference = trimmed(fields.evidence_reference);
  if (action === 'RECONCILE') body.provider_state = fields.provider_state ?? 'SUCCEEDED';
  if (action === 'LINK_CORRECTION')
    body.financial_correction_id = trimmed(fields.financial_correction_id);
  if (action === 'RESOLVE') body.resolution_code = fields.resolution_code ?? 'NO_MONEY_MOVED';
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

const COLUMNS: readonly DataTableColumn<ExceptionRow>[] = [
  { key: 'risk', header: 'Risk', render: (row) => row.risk },
  {
    key: 'kind',
    header: 'Kind',
    render: (row) => row.exception_kind.replaceAll('_', ' ').toLowerCase(),
  },
  { key: 'values', header: 'Expected / actual', render: (row) => valuesText(row) },
  { key: 'provider', header: 'Provider reference', render: (row) => row.provider_reference },
  { key: 'business', header: 'Business reference', render: (row) => row.business_reference ?? '—' },
  { key: 'age', header: 'Age', render: (row) => ageText(row.age_seconds) },
  {
    key: 'retry',
    header: 'Last retry',
    render: (row) =>
      row.last_retry_at ? `${new Date(row.last_retry_at).toLocaleString()} (${row.attempts})` : '—',
  },
  {
    key: 'next',
    header: 'Next safe action',
    render: (row) => row.next_safe_action.replaceAll('_', ' ').toLowerCase(),
  },
  {
    key: 'approval',
    header: 'Approval',
    render: (row) => row.approval.replaceAll('_', ' ').toLowerCase(),
  },
  { key: 'evidence', header: 'Evidence', numeric: true, render: (row) => row.evidence_count },
];

export function FinanceExceptionsQueue() {
  const [summary, setSummary] = useState<readonly QueueSummary[]>([]);
  const [queue, setQueue] = useState<string>('');
  const [rows, setRows] = useState<readonly ExceptionRow[]>([]);
  const [disputes, setDisputes] = useState<readonly Dispute[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [action, setAction] = useState<FinanceAction | null>(null);
  const [fields, setFields] = useState({
    note: '',
    evidence_reference: '',
    financial_correction_id: '',
    resolution_code: 'NO_MONEY_MOVED',
    provider_state: 'SUCCEEDED',
  });
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [message, setMessage] = useState('Loading the finance queues…');

  const load = useCallback(async () => {
    try {
      const result = await adminRequest<{
        summary: QueueSummary[];
        rows: ExceptionRow[];
        disputes: Dispute[];
      }>(queue ? `admin/finance/queues?queue=${queue}` : 'admin/finance/queues');
      setSummary(result.summary);
      setRows(result.rows);
      setDisputes(result.disputes);
      setMessage(
        `${result.summary.reduce((sum, entry) => sum + entry.open, 0)} open across eleven queues.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The finance queues failed to load.');
    }
  }, [queue]);
  useEffect(() => {
    void load();
  }, [load]);

  async function open(row: ExceptionRow) {
    try {
      setDetail(
        await adminRequest<Detail>(`admin/finance/queues/exceptions/${row.finance_exception_id}`),
      );
      setAction(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The exception could not be read.');
    }
  }

  const input = (key: keyof typeof fields, label: string, placeholder?: string) => (
    <label>
      {label}
      <input
        placeholder={placeholder}
        value={fields[key]}
        onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
      />
    </label>
  );

  return (
    <div className="catalogue-flag" style={{ marginTop: '1rem' }}>
      <p className="eyebrow">FINANCE QUEUES</p>
      <p aria-live="polite">{message}</p>
      <div className="admin-card-grid">
        {summary.map((entry) => (
          <article key={entry.key}>
            <span>{entry.owner.replaceAll('_', ' ').toLowerCase()}</span>
            <strong>
              {entry.title}: {entry.open}
            </strong>
            <p>
              {formatMoneyMinor(entry.at_risk_minor)} at risk
              {entry.oldest_age_seconds !== null
                ? ` · oldest ${ageText(entry.oldest_age_seconds)}`
                : ''}
            </p>
            <button
              type="button"
              aria-pressed={queue === entry.key}
              onClick={() => setQueue(entry.key)}
            >
              Open queue
            </button>
          </article>
        ))}
      </div>
      {queue ? (
        <button type="button" onClick={() => setQueue('')}>
          Show every queue
        </button>
      ) : null}
      {queue === 'DISPUTE' || !queue ? (
        <ul aria-label="Disputes">
          {disputes.map((dispute) => (
            <li key={dispute.dispute_id}>
              {dispute.dispute_kind.replaceAll('_', ' ').toLowerCase()} ·{' '}
              {formatMoneyMinor(dispute.expected_minor)} expected ·{' '}
              {formatMoneyMinor(dispute.actual_minor)} disputed · {dispute.business_reference} ·{' '}
              {ageText(dispute.age_seconds)} · answer by{' '}
              {new Date(dispute.deadline_at).toLocaleDateString()}
            </li>
          ))}
        </ul>
      ) : null}
      {queue !== 'DISPUTE' ? (
        <DataTable
          caption="Finance exceptions"
          columns={COLUMNS}
          empty="Nothing waiting in this queue."
          onOpen={(row) => void open(row)}
          openLabel={() => 'Open exception'}
          rowKey={(row) => row.finance_exception_id}
          rows={rows}
        />
      ) : null}

      {detail ? (
        <div className="catalogue-flag">
          <p className="eyebrow">
            {detail.queue.replaceAll('_', ' ')} · VERSION {detail.version}
          </p>
          <DescriptionList
            items={[
              { label: 'Kind', value: detail.exception_kind },
              { label: 'State', value: detail.exception_state },
              { label: 'Values', value: valuesText(detail) },
              { label: 'At risk', value: formatMoneyMinor(detail.amount_at_risk_minor) },
              {
                label: 'Provider',
                value: `${detail.provider_reference} (${detail.provider_state ?? 'no operation'})`,
              },
              { label: 'Business', value: detail.business_reference ?? '—' },
              { label: 'Next safe action', value: detail.next_safe_action },
              {
                label: 'Correction',
                value: detail.correction
                  ? `${detail.correction.financial_correction_id.slice(0, 13)} (${detail.correction.state})`
                  : 'none',
              },
              { label: 'Approval', value: detail.approval },
            ]}
          />
          <ol>
            {detail.history.map((event, index) => (
              <li key={`${event.event_type}-${index}`}>
                {new Date(event.occurred_at).toLocaleString()} · {event.event_type} (
                {event.reason_code})
              </li>
            ))}
          </ol>
          <div className="actions">
            {detail.allowed_actions.map((allowed) => (
              <button key={allowed} type="button" onClick={() => setAction(allowed)}>
                {LABEL[allowed]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        busy={busy}
        confirmLabel={action ? LABEL[action] : 'Confirm'}
        error={dialogError}
        onCancel={() => setAction(null)}
        onConfirm={({ reason_code }) => {
          if (!detail || !action) return;
          setBusy(true);
          setDialogError(null);
          void adminRequest(
            `admin/finance/queues/exceptions/${detail.finance_exception_id}/actions/${action}`,
            {
              method: 'POST',
              body: JSON.stringify(
                exceptionActionBody(action, reason_code ?? 'SECOND_LOOK', detail.version, fields),
              ),
            },
          )
            .then(async () => {
              setAction(null);
              setMessage(`${LABEL[action]} recorded.`);
              await load();
              await open(detail);
            })
            .catch((error: unknown) =>
              setDialogError(error instanceof Error ? error.message : 'That step failed.'),
            )
            .finally(() => setBusy(false));
        }}
        open={action !== null}
        reasons={REASONS}
        title={action && detail ? `${LABEL[action]} (version ${detail.version})` : ''}
        tone={action === 'APPROVE_WRITE_OFF' || action === 'RESOLVE' ? 'danger' : 'primary'}
      >
        {action === 'NOTE' || action === 'PROPOSE_WRITE_OFF' ? input('note', 'Why') : null}
        {action === 'EVIDENCE' || action === 'RECONCILE'
          ? input('evidence_reference', 'Evidence reference', 'SYNTH-EVIDENCE-…')
          : null}
        {action === 'RECONCILE' ? (
          <label>
            {"Provider's answer"}
            <select
              value={fields.provider_state}
              onChange={(event) => setFields({ ...fields, provider_state: event.target.value })}
            >
              <option value="SUCCEEDED">Succeeded</option>
              <option value="FAILED">Failed</option>
              <option value="UNKNOWN">Still unknown</option>
            </select>
          </label>
        ) : null}
        {action === 'LINK_CORRECTION' ? input('financial_correction_id', 'Correction id') : null}
        {action === 'RESOLVE' ? (
          <label>
            Resolution
            <select
              value={fields.resolution_code}
              onChange={(event) => setFields({ ...fields, resolution_code: event.target.value })}
            >
              <option value="NO_MONEY_MOVED">No money moved</option>
              <option value="PROVIDER_CONFIRMED">The provider confirmed it</option>
              <option value="CORRECTED">Corrected (posted correction)</option>
            </select>
          </label>
        ) : null}
        {action === 'APPROVE_WRITE_OFF' ? (
          <p>
            The money is accepted as not recovered. You cannot approve a write-off you proposed.
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
