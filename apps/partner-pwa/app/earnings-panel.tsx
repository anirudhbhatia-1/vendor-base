'use client';

import { useState } from 'react';
import type { PartnerStatement } from '@neighbourhood-store/contracts';
import { partnerApiClient } from './authenticated-api';

/**
 * The statement as a file the partner can keep (DLP-52).
 *
 * Someone querying a week's pay needs the lines, not a screen they have to
 * photograph. Rupees are derived once from the integer paise the ledger holds.
 */
export function earningsToCsv(statement: PartnerStatement): string {
  const header = ['reference', 'lifecycle_state', 'posted_at', 'total_inr'];
  const rows = statement.earnings.map((entry) => [
    entry.reference,
    entry.lifecycle_state,
    entry.posted_at,
    (entry.total_minor / 100).toFixed(2),
  ]);
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return [header, ...rows]
    .map((row) => row.map((cell) => escape(String(cell))).join(','))
    .join('\n');
}

export function EarningsPanel() {
  const [statement, setStatement] = useState<PartnerStatement | null>(null);
  const [message, setMessage] = useState('Load your live earnings statement after signing in.');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const client = await partnerApiClient();
      const data = await client.partner.finance.statement();
      setStatement(data);
      setMessage(`Statement loaded. ${data.earnings.length} earning record(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Statement could not be loaded.');
    } finally {
      setBusy(false);
    }
  }

  const fmt = (minor: number) => `₹${(minor / 100).toFixed(2)}`;

  function download() {
    if (!statement) return;
    const blob = new Blob([earningsToCsv(statement)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'earnings-statement.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * A line-level dispute (DLP-53). A partner who believes one trip paid the
   * wrong amount can say so against that record, with the amount they expected
   * — not a free-text complaint that nobody can reconcile.
   */
  async function dispute(recordId: string, currentMinor: number) {
    const expected = window.prompt('What should this trip have paid, in rupees?');
    if (expected === null) return;
    const proposed = Math.round(Number(expected) * 100);
    if (!Number.isFinite(proposed) || proposed < 0) {
      setMessage('Enter the amount in rupees.');
      return;
    }
    setBusy(true);
    try {
      const client = await partnerApiClient();
      await client.partner.earnings.raiseDispute({
        partner_earnings_record_id: recordId,
        disputed_component: 'TOTAL',
        proposed_amount_minor: proposed,
        evidence_note: `Recorded ${fmt(currentMinor)}; expected ${fmt(proposed)}.`,
      });
      setMessage('Dispute raised. Operations will review this line.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The dispute could not be raised.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={() => void load()} disabled={busy}>
        {busy ? 'Loading…' : 'Refresh earnings'}
      </button>
      <button type="button" onClick={() => download()} disabled={busy || !statement}>
        Download CSV
      </button>
      <span aria-live="polite" style={{ display: 'block', marginTop: '0.5rem' }}>
        {message}
      </span>

      {statement && (
        <>
          <section className="money-strip" aria-label="Earnings summary">
            <div>
              <span>Total earned</span>
              <strong>{fmt(statement.total_earned_minor)}</strong>
            </div>
            <div>
              <span>Pending</span>
              <strong>{fmt(statement.pending_minor)}</strong>
            </div>
            <div>
              <span>Paid out</span>
              <strong>{fmt(statement.paid_minor)}</strong>
            </div>
          </section>

          <div className="earnings-ledger">
            {statement.earnings.length === 0 ? (
              <div>
                <strong>No earnings yet</strong>
                <span>Complete your first delivery to start earning.</span>
              </div>
            ) : (
              statement.earnings.map((e) => (
                <div key={e.partner_earnings_record_id}>
                  <strong>{e.reference}</strong>
                  <span>{e.lifecycle_state.toLowerCase()}</span>
                  <em>{fmt(e.total_minor)}</em>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void dispute(e.partner_earnings_record_id, e.total_minor)}
                  >
                    Query this amount
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
