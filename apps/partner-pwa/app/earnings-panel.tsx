'use client';

import { useState } from 'react';
import type {
  PartnerAttemptCompensation,
  PartnerDisputeCase,
  PartnerEarningEntry,
  PartnerStatement,
} from '@neighbourhood-store/contracts';
import { partnerApiClient } from './authenticated-api';
import { shortReference } from './display';

/**
 * The statement as a file the partner can keep (DLP-52).
 *
 * Someone querying a week's pay needs the lines, not a screen they have to
 * photograph. Rupees are derived once from the integer paise the ledger holds.
 */
export function earningsToCsv(statement: PartnerStatement): string {
  // Every component of the line (9.10, DLP-49), so a query can name the one
  // it is about.
  const header = [
    'reference',
    'outcome',
    'lifecycle_state',
    'posted_at',
    'day',
    'base_inr',
    'distance_inr',
    'time_inr',
    'wait_inr',
    'return_inr',
    'incentive_inr',
    'tip_inr',
    'adjustment_inr',
    'total_inr',
  ];
  const inr = (minor: number | undefined) => ((minor ?? 0) / 100).toFixed(2);
  const rows = statement.earnings.map((entry) => [
    entry.reference,
    entry.outcome ?? '',
    entry.lifecycle_state,
    entry.posted_at,
    entry.day ?? '',
    inr(entry.base_minor),
    inr(entry.distance_minor),
    inr(entry.time_minor),
    inr(entry.wait_minor),
    inr(entry.return_minor),
    inr(entry.incentive_minor),
    inr(entry.tip_minor),
    inr(entry.adjustment_minor),
    inr(entry.total_minor),
  ]);
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return [header, ...rows]
    .map((row) => row.map((cell) => escape(String(cell))).join(','))
    .join('\n');
}

/** The components a line is made of, in the partner's words, with the dispute key each carries. */
export const LINE_COMPONENTS: readonly (readonly [
  keyof PartnerEarningEntry,
  string,
  'BASE' | 'DISTANCE' | 'TIME' | 'WAIT' | 'RETURN' | 'INCENTIVE' | 'TIP' | 'ADJUSTMENT',
])[] = [
  ['base_minor', 'Base', 'BASE'],
  ['distance_minor', 'Distance', 'DISTANCE'],
  ['time_minor', 'Time', 'TIME'],
  ['wait_minor', 'Waiting', 'WAIT'],
  ['return_minor', 'Return', 'RETURN'],
  ['incentive_minor', 'Incentive', 'INCENTIVE'],
  ['tip_minor', 'Tip', 'TIP'],
  ['adjustment_minor', 'Adjustment', 'ADJUSTMENT'],
];

/** How a dispute reads: who has it, when it is due, and how it ended (9.10). */
export function disputeSentence(dispute: PartnerDisputeCase, now: number): string {
  const component = dispute.disputed_component.toLowerCase();
  const fmt = (minor: number) => `₹${(minor / 100).toFixed(2)}`;
  const asked = `${component}: recorded ${fmt(dispute.disputed_amount_minor)}, you say ${fmt(dispute.proposed_amount_minor)}`;
  if (dispute.lifecycle_state === 'WITHDRAWN') return `${asked} — withdrawn.`;
  if (dispute.lifecycle_state === 'RESOLVED') {
    const outcome = dispute.resolved_amount_minor ?? dispute.disputed_amount_minor;
    const reason = (dispute.resolution_reason_code ?? '').toLowerCase().replaceAll('_', ' ');
    return `${asked} — operations decided ${fmt(outcome)}${reason ? ` (${reason})` : ''}.`;
  }
  const due = Math.max(0, Math.ceil((Date.parse(dispute.deadline_at) - now) / 86_400_000));
  return `${asked} — with operations, answer due in ${due} day${due === 1 ? '' : 's'}.`;
}

export function EarningsPanel() {
  const [statement, setStatement] = useState<PartnerStatement | null>(null);
  const [compensations, setCompensations] = useState<readonly PartnerAttemptCompensation[]>([]);
  const [disputes, setDisputes] = useState<readonly PartnerDisputeCase[]>([]);
  const [querying, setQuerying] = useState<string | null>(null);
  const [queryComponent, setQueryComponent] = useState<string>('BASE');
  const [queryRupees, setQueryRupees] = useState('');
  const [queryWhy, setQueryWhy] = useState('');
  const [message, setMessage] = useState('Load your live earnings statement after signing in.');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const client = await partnerApiClient();
      const data = await client.partner.finance.statement();
      setStatement(data);
      // Compensation for attempts operations took away (9.3) is the partner's
      // to see beside their earnings; its absence must not hide the statement.
      setCompensations(
        await client.partner.earnings
          .compensations()
          .then((result) => result.compensations)
          .catch(() => []),
      );
      setDisputes(
        await client.partner.earnings
          .disputes()
          .then((result) => result.disputes)
          .catch(() => []),
      );
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
   * A line-level dispute (DLP-53): one component of one trip, with the amount
   * the partner expected and why. Until audit run 65 the app sent a component
   * the server does not know (a whole-line total), so every query was refused.
   */
  async function dispute(entry: PartnerEarningEntry) {
    const proposed = Math.round(Number(queryRupees) * 100);
    if (!Number.isFinite(proposed) || proposed < 0) {
      setMessage('Enter the amount in rupees.');
      return;
    }
    const component = LINE_COMPONENTS.find(([, , key]) => key === queryComponent);
    const recorded = component ? (entry[component[0]] as number | undefined) : undefined;
    setBusy(true);
    try {
      const client = await partnerApiClient();
      await client.partner.earnings.raiseDispute({
        partner_earnings_record_id: entry.partner_earnings_record_id,
        disputed_component: queryComponent,
        proposed_amount_minor: proposed,
        evidence_note:
          `${queryWhy.trim() || 'No further detail.'} (recorded ${fmt(recorded ?? 0)}; expected ${fmt(proposed)})`.slice(
            0,
            500,
          ),
      });
      setMessage('Dispute raised. Operations will review this line.');
      setQuerying(null);
      setQueryRupees('');
      setQueryWhy('');
      await load();
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
                  <strong>{shortReference(e.reference)}</strong>
                  <span>
                    {(e.outcome ?? '').toLowerCase().replaceAll('_', ' ')} ·{' '}
                    {e.lifecycle_state.toLowerCase()}
                    {e.paid_at ? ` on ${new Date(e.paid_at).toLocaleDateString()}` : ''}
                  </span>
                  <em>{fmt(e.total_minor)}</em>
                  {/* The line, component by component (9.10, DLP-49). */}
                  <p className="earnings-breakdown">
                    {LINE_COMPONENTS.filter(([key]) => (e[key] as number | undefined) !== undefined)
                      .filter(([key]) => (e[key] as number) !== 0 || key === 'base_minor')
                      .map(([key, label]) => `${label} ${fmt(e[key] as number)}`)
                      .join(' · ')}
                  </p>
                  {querying === e.partner_earnings_record_id ? (
                    <div className="earnings-query">
                      <label>
                        Which part
                        <select
                          onChange={(event) => setQueryComponent(event.target.value)}
                          value={queryComponent}
                        >
                          {LINE_COMPONENTS.map(([, label, key]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Should have been (₹)
                        <input
                          inputMode="decimal"
                          onChange={(event) => setQueryRupees(event.target.value)}
                          value={queryRupees}
                        />
                      </label>
                      <label>
                        Why
                        <input
                          maxLength={400}
                          onChange={(event) => setQueryWhy(event.target.value)}
                          value={queryWhy}
                        />
                      </label>
                      <button type="button" disabled={busy} onClick={() => void dispute(e)}>
                        Send the query
                      </button>
                      <button type="button" onClick={() => setQuerying(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setQuerying(e.partner_earnings_record_id)}
                    >
                      Query a part of this
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {/* By the partner's day and week (DLP-50): the money that reconciles
              to the lines above. */}
          {(statement.days ?? []).length > 0 && (
            <section className="earnings-ledger" aria-label="By day">
              <h3>By day</h3>
              {(statement.days ?? []).slice(0, 14).map((day) => (
                <div key={day.period}>
                  <strong>{day.period}</strong>
                  <span>
                    {day.trips} trip{day.trips === 1 ? '' : 's'} · paid {fmt(day.paid_minor)}
                  </span>
                  <em>{fmt(day.net_minor)}</em>
                </div>
              ))}
            </section>
          )}
          {(statement.weeks ?? []).length > 0 && (
            <section className="earnings-ledger" aria-label="By week">
              <h3>By week</h3>
              {(statement.weeks ?? []).slice(0, 8).map((week) => (
                <div key={week.period}>
                  <strong>Week of {week.period}</strong>
                  <span>
                    {week.trips} trip{week.trips === 1 ? '' : 's'} · paid {fmt(week.paid_minor)}
                  </span>
                  <em>{fmt(week.net_minor)}</em>
                </div>
              ))}
            </section>
          )}

          {/* Every query the partner has raised, with who has it, when it is
              due and how it ended (9.10). */}
          {disputes.length > 0 && (
            <section className="earnings-ledger" aria-label="Your queries">
              <h3>Your queries</h3>
              {disputes.map((dispute) => (
                <div key={dispute.partner_dispute_case_id}>
                  <strong>
                    {shortReference(
                      statement.earnings.find(
                        (e) => e.partner_earnings_record_id === dispute.partner_earnings_record_id,
                      )?.reference ?? dispute.partner_earnings_record_id,
                    )}
                  </strong>
                  <span>{disputeSentence(dispute, Date.now())}</span>
                  <em>{dispute.lifecycle_state.toLowerCase()}</em>
                  {dispute.lifecycle_state === 'OPEN' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void (async () => {
                          setBusy(true);
                          try {
                            const client = await partnerApiClient();
                            await client.partner.earnings.withdrawDispute(
                              dispute.partner_dispute_case_id,
                            );
                            await load();
                          } finally {
                            setBusy(false);
                          }
                        })()
                      }
                    >
                      Withdraw
                    </button>
                  ) : null}
                </div>
              ))}
            </section>
          )}

          {compensations.length > 0 && (
            <section className="earnings-ledger" aria-label="Compensation for reassigned work">
              <h3>Compensation for reassigned work</h3>
              {compensations.map((c) => (
                <div key={c.partner_attempt_compensation_id}>
                  <strong>{shortReference(c.delivery_assignment_id)}</strong>
                  <span>
                    taken while {c.displaced_from.toLowerCase().replace(/_/g, ' ')} ·{' '}
                    {c.reason_code.toLowerCase().replace(/_/g, ' ')}
                  </span>
                  <em>{fmt(c.amount_minor)}</em>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
