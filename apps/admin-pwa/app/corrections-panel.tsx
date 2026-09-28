'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './authenticated-api';

/**
 * Financial corrections (10.6, ADM-31, EXC-13).
 *
 * A correction names the ledger posting it corrects and the posting that
 * should stand instead; approving it reverses the original whole and posts
 * the replacement, so history is appended, never edited. Before anything is
 * proposed the operator sees what it would move, per account and per shop or
 * partner, and whether a second person must approve it. The panel this
 * replaces sent a body the API refused, so no correction was ever proposed
 * from the console.
 */
export type CorrectionEntryDraft = {
  account_reference: string;
  component: string;
  debit_minor: number;
  credit_minor: number;
  vendor_location_id?: string;
  partner_user_id?: string;
  source_order_reference?: string;
};

export type ImpactRow = {
  readonly account_reference: string;
  readonly vendor_location_id: string | null;
  readonly partner_user_id: string | null;
  readonly change_debit_minor: number;
};

type Preview = {
  readonly impact: readonly ImpactRow[];
  readonly impact_minor: number;
  readonly single_approval_limit_minor: number;
  readonly second_approval_required: boolean;
};

type Correction = {
  readonly financial_correction_id: string;
  readonly correction_reference: string;
  readonly lifecycle_state: string;
  readonly reason_code: string;
  readonly evidence_reference: string;
  readonly impact: readonly ImpactRow[];
  readonly impact_minor: string;
  readonly second_approval_required: boolean;
  readonly closing_reason_code: string | null;
  readonly version: number;
  readonly events: readonly {
    readonly event_type: string;
    readonly actor_id: string;
    readonly reason_code: string;
    readonly occurred_at: string;
  }[];
};

type LedgerEntry = {
  readonly account_reference: string;
  readonly component: string;
  readonly debit_minor: string;
  readonly credit_minor: string;
  readonly vendor_location_id: string | null;
  readonly partner_user_id: string | null;
  readonly source_order_reference: string | null;
};

function rupees(minor: number): string {
  return `₹${(minor / 100).toFixed(2)}`;
}

/** The proposal's amount: what the replacement debits, which the API checks. */
export function correctionAmount(entries: readonly CorrectionEntryDraft[]): number {
  return entries.reduce((sum, entry) => sum + entry.debit_minor, 0);
}

/** One line of a correction's impact, in words an operator can check. */
export function impactSentence(row: ImpactRow): string {
  const account = row.account_reference
    .replace(/^SYNTH-ACCOUNT-/, '')
    .replaceAll('-', ' ')
    .toLowerCase();
  const owner = row.vendor_location_id
    ? ` for shop ${row.vendor_location_id.slice(0, 8)}`
    : row.partner_user_id
      ? ` for partner ${row.partner_user_id.slice(0, 8)}`
      : '';
  const side = row.change_debit_minor > 0 ? 'debited' : 'credited';
  return `${account}${owner} ${side} ${rupees(Math.abs(row.change_debit_minor))} more`;
}

export function CorrectionsPanel() {
  const [transactionId, setTransactionId] = useState('');
  const [original, setOriginal] = useState<readonly LedgerEntry[]>([]);
  const [entries, setEntries] = useState<CorrectionEntryDraft[]>([]);
  const [reasonCode, setReasonCode] = useState('');
  const [evidence, setEvidence] = useState('SYNTH-EVIDENCE-');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [corrections, setCorrections] = useState<readonly Correction[]>([]);
  const [message, setMessage] = useState('Load the ledger posting a correction is for.');

  const loadCorrections = useCallback(async () => {
    try {
      const result = await adminRequest<{ corrections: Correction[] }>(
        'admin/finance/v2/corrections',
      );
      setCorrections(result.corrections);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Corrections could not be loaded.');
    }
  }, []);

  useEffect(() => {
    void loadCorrections();
  }, [loadCorrections]);

  async function loadOriginal() {
    try {
      const posting = await adminRequest<{ entries: LedgerEntry[] }>(
        `admin/finance/v2/ledger/transactions/${transactionId.trim()}`,
      );
      setOriginal(posting.entries);
      // The replacement starts as the original: the operator changes only
      // what was wrong, and the preview shows exactly that difference.
      setEntries(
        posting.entries.map((entry) => ({
          account_reference: entry.account_reference,
          component: entry.component,
          debit_minor: Number(entry.debit_minor),
          credit_minor: Number(entry.credit_minor),
          ...(entry.vendor_location_id ? { vendor_location_id: entry.vendor_location_id } : {}),
          ...(entry.partner_user_id ? { partner_user_id: entry.partner_user_id } : {}),
          ...(entry.source_order_reference
            ? { source_order_reference: entry.source_order_reference }
            : {}),
        })),
      );
      setPreview(null);
      setMessage('Change the replacement entries, then preview what the correction moves.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The posting could not be loaded.');
    }
  }

  function update(index: number, change: Partial<CorrectionEntryDraft>) {
    setEntries((current) =>
      current.map((entry, at) => (at === index ? { ...entry, ...change } : entry)),
    );
    setPreview(null);
  }

  async function previewCorrection() {
    try {
      const result = await adminRequest<Preview>('admin/finance/v2/corrections/preview', {
        method: 'POST',
        body: JSON.stringify({ original_ledger_transaction_id: transactionId.trim(), entries }),
      });
      setPreview(result);
      setMessage(
        result.second_approval_required
          ? 'Over the single-approval limit: a second operator must approve it.'
          : 'Within the single-approval limit: you may post it yourself once proposed.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The correction could not be previewed.');
    }
  }

  async function propose() {
    if (!preview) {
      setMessage('Preview the correction before proposing it.');
      return;
    }
    try {
      await adminRequest('admin/finance/v2/corrections', {
        method: 'POST',
        body: JSON.stringify({
          amount_minor: correctionAmount(entries),
          correction_reference: `SYNTH-CORRECTION-${Date.now().toString(36).toUpperCase()}`,
          entries,
          evidence_reference: evidence.trim(),
          original_ledger_transaction_id: transactionId.trim(),
          reason_code: reasonCode.trim(),
        }),
      });
      setMessage('Correction proposed. It is listed below until it is approved or rejected.');
      setPreview(null);
      await loadCorrections();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The correction could not be proposed.');
    }
  }

  async function decide(correction: Correction, decision: 'approve-post' | 'reject') {
    try {
      const id = correction.financial_correction_id;
      await adminRequest(
        decision === 'reject'
          ? `admin/finance/v2/corrections/${id}/reject`
          : `admin/finance/v2/corrections/${id}/approve-post`,
        {
          method: 'POST',
          body: JSON.stringify({
            expected_version: correction.version,
            ...(decision === 'reject' ? { reason_code: 'CORRECTION_DECLINED' } : {}),
          }),
        },
      );
      setMessage(
        decision === 'reject'
          ? `Correction ${correction.correction_reference} rejected.`
          : `Correction ${correction.correction_reference} posted: the original reversed and the replacement posted.`,
      );
      await loadCorrections();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The decision could not be recorded.');
    }
  }

  return (
    <section className="catalogue-oversight" id="financial-corrections">
      <div>
        <p className="eyebrow">FINANCIAL CORRECTIONS</p>
        <h2>
          {corrections.filter((c) => c.lifecycle_state === 'PROPOSED').length} awaiting approval
        </h2>
      </div>
      <p aria-live="polite">{message}</p>
      <div className="catalogue-flag">
        <label>
          Ledger posting to correct
          <input
            value={transactionId}
            onChange={(e) => setTransactionId(e.target.value)}
            placeholder="Ledger transaction ID"
          />
        </label>
        <div className="actions">
          <button type="button" onClick={() => void loadOriginal()} disabled={!transactionId}>
            Load posting
          </button>
        </div>
      </div>
      {original.length > 0 && (
        <div className="catalogue-flag">
          <h3>Replacement entries (paise)</h3>
          {entries.map((entry, index) => (
            <div key={index} className="actions">
              <input
                aria-label="Account"
                value={entry.account_reference}
                onChange={(e) => update(index, { account_reference: e.target.value })}
              />
              <input
                aria-label="Debit (paise)"
                inputMode="numeric"
                value={entry.debit_minor}
                onChange={(e) =>
                  update(index, {
                    debit_minor: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                  })
                }
              />
              <input
                aria-label="Credit (paise)"
                inputMode="numeric"
                value={entry.credit_minor}
                onChange={(e) =>
                  update(index, {
                    credit_minor: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                  })
                }
              />
              <button
                type="button"
                onClick={() => {
                  setEntries((current) => current.filter((_, at) => at !== index));
                  setPreview(null);
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="actions">
            <button
              type="button"
              onClick={() =>
                setEntries((current) => [
                  ...current,
                  {
                    account_reference: '',
                    component: 'ADJUSTMENT',
                    debit_minor: 0,
                    credit_minor: 0,
                  },
                ])
              }
            >
              Add entry
            </button>
          </div>
          <label>
            Reason code
            <input
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value.toUpperCase())}
              placeholder="PROVIDER_FEE_CORRECTION"
            />
          </label>
          <label>
            Evidence reference
            <input value={evidence} onChange={(e) => setEvidence(e.target.value.toUpperCase())} />
          </label>
          <div className="actions">
            <button type="button" onClick={() => void previewCorrection()}>
              Preview
            </button>
            <button type="button" onClick={() => void propose()} disabled={!preview}>
              Propose
            </button>
          </div>
          {preview && (
            <div>
              <p>
                Moves {rupees(preview.impact_minor)}; single-approval limit{' '}
                {rupees(preview.single_approval_limit_minor)}.
              </p>
              <ul>
                {preview.impact.map((row, index) => (
                  <li key={index}>{impactSentence(row)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <div className="admin-card-grid">
        {corrections.map((correction) => (
          <article key={correction.financial_correction_id} className="catalogue-flag">
            <strong>{correction.correction_reference}</strong>
            <p>
              {correction.lifecycle_state.toLowerCase()} · {correction.reason_code} · evidence{' '}
              {correction.evidence_reference} · moves {rupees(Number(correction.impact_minor))}
              {correction.second_approval_required ? ' · needs a second approver' : ''}
              {correction.closing_reason_code ? ` · ${correction.closing_reason_code}` : ''}
            </p>
            <ul>
              {correction.impact.map((row, index) => (
                <li key={index}>{impactSentence(row)}</li>
              ))}
            </ul>
            <ol>
              {correction.events.map((event) => (
                <li key={`${event.event_type}-${event.occurred_at}`}>
                  {event.event_type.toLowerCase().replaceAll('_', ' ')} by{' '}
                  {event.actor_id.slice(0, 8)} at {new Date(event.occurred_at).toLocaleString()}
                </li>
              ))}
            </ol>
            {correction.lifecycle_state === 'PROPOSED' && (
              <div className="actions">
                <button type="button" onClick={() => void decide(correction, 'approve-post')}>
                  Approve and post
                </button>
                <button type="button" onClick={() => void decide(correction, 'reject')}>
                  Reject
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
