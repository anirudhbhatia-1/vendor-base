'use client';

import { useState } from 'react';
import type { VendorSettlementDispute, VendorStatement } from '@neighbourhood-store/contracts';
import { vendorApiClient } from './authenticated-api';

/**
 * Turns the statement into a CSV the vendor can actually keep (VEN-49).
 *
 * "Download" used to be `window.print()`, which produces a page, not a
 * statement: nothing a shop can hand to an accountant or reconcile against
 * their own books. Amounts are written in rupees with two decimals from the
 * integer paise the ledger holds — the division happens once, here, for display
 * only.
 */
export function statementToCsv(statement: VendorStatement): string {
  // Sale, platform fee, payment costs, refund/adjustment, tax and payout
  // status, per order (VEN-48): the columns the catalogue asks for, from the
  // settlement's own policy-versioned lines.
  const header = [
    'settlement_reference',
    'lifecycle_state',
    'eligible_at',
    'gross_inr',
    'platform_fee_inr',
    'payment_fee_inr',
    'tax_inr',
    'refund_inr',
    'adjustment_inr',
    'net_inr',
    'payout_state',
    'paid_at',
  ];
  const rows = statement.settlements.map((entry) => [
    entry.reference,
    entry.lifecycle_state,
    entry.eligible_at,
    (entry.gross_minor / 100).toFixed(2),
    (entry.platform_fee_minor / 100).toFixed(2),
    ((entry.payment_fee_minor ?? 0) / 100).toFixed(2),
    ((entry.tax_minor ?? 0) / 100).toFixed(2),
    ((entry.refund_minor ?? 0) / 100).toFixed(2),
    ((entry.adjustment_minor ?? 0) / 100).toFixed(2),
    (entry.net_minor / 100).toFixed(2),
    entry.payout_state ?? 'not scheduled',
    entry.paid_at ?? '',
  ]);
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return [header, ...rows]
    .map((row) => row.map((cell) => escape(String(cell))).join(','))
    .join('\n');
}

function downloadStatement(statement: VendorStatement): void {
  const blob = new Blob([statementToCsv(statement)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `settlement-statement-${statement.vendor_location_id.slice(0, 8)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/** The lines a shop may challenge, in the words it reads them by (VEN-50). */
const DISPUTABLE = [
  ['ITEM_PROCEEDS', 'What we were paid for the goods'],
  ['PLATFORM_FEE', 'The platform fee'],
  ['REFUND', 'A refund taken off this order'],
] as const;

export function PayoutsPanel({ vendorLocationId }: { vendorLocationId: string }) {
  const [statement, setStatement] = useState<VendorStatement | null>(null);
  const [disputes, setDisputes] = useState<readonly VendorSettlementDispute[]>([]);
  const [message, setMessage] = useState('Load your live settlement statement.');
  const [busy, setBusy] = useState(false);
  // The line being challenged, if any: the settlement, which part of it, the
  // figure the shop expected, and why.
  const [challenge, setChallenge] = useState<{
    settlementId: string;
    component: string;
    expected: string;
    note: string;
  } | null>(null);

  async function load() {
    setBusy(true);
    try {
      const client = await vendorApiClient();
      const [data, raised] = await Promise.all([
        client.vendor.finance.statement(vendorLocationId),
        client.vendor.finance.disputes(vendorLocationId),
      ]);
      setStatement(data);
      setDisputes(raised.disputes ?? []);
      setMessage(`Statement loaded. ${data.settlements.length} settlement record(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Statement could not be loaded.');
    } finally {
      setBusy(false);
    }
  }

  async function sendChallenge() {
    if (!challenge) return;
    const rupees = Number(challenge.expected);
    if (!Number.isFinite(rupees) || rupees < 0) {
      setMessage('Enter the amount you expected, in rupees.');
      return;
    }
    setBusy(true);
    try {
      const client = await vendorApiClient();
      await client.vendor.finance.openDispute(vendorLocationId, {
        disputed_component: challenge.component,
        evidence_note: challenge.note,
        expected_amount_minor: Math.round(rupees * 100),
        settlement_id: challenge.settlementId,
      });
      setChallenge(null);
      setMessage('Sent. Finance will answer this within seven days.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That challenge could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(disputeId: string) {
    setBusy(true);
    try {
      const client = await vendorApiClient();
      await client.vendor.finance.withdrawDispute(vendorLocationId, disputeId);
      setMessage('Withdrawn.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That could not be withdrawn.');
    } finally {
      setBusy(false);
    }
  }

  const fmt = (minor: number) => `₹${(minor / 100).toFixed(2)}`;

  return (
    <div>
      <div className="local-access">
        <button type="button" onClick={() => void load()} disabled={busy}>
          {busy ? 'Loading…' : 'Load statement'}
        </button>
        <span aria-live="polite" style={{ display: 'block', marginTop: '0.5rem' }}>
          {message}
        </span>
      </div>

      {statement && (
        <>
          <section className="money-strip" aria-label="Settlement summary">
            <div>
              <span>Pending</span>
              <strong>{fmt(statement.pending_minor)}</strong>
            </div>
            <div>
              <span>Eligible</span>
              <strong>{fmt(statement.eligible_minor)}</strong>
            </div>
            <div>
              <span>Settled</span>
              <strong>{fmt(statement.settled_minor)}</strong>
            </div>
          </section>

          <div className="payout-ledger">
            {statement.settlements.length === 0 ? (
              <p className="field-help">
                No settlements yet. Orders complete and settle overnight.
              </p>
            ) : (
              statement.settlements.map((s) => (
                <div key={s.settlement_id}>
                  <strong>{s.reference}</strong>
                  <span>
                    Sale {fmt(s.gross_minor)} · fee {fmt(s.platform_fee_minor)}
                    {s.refund_minor ? ` · refunded ${fmt(s.refund_minor)}` : ''}
                    {s.adjustment_minor
                      ? ` · adjusted ${s.adjustment_minor > 0 ? '+' : '−'}${fmt(Math.abs(s.adjustment_minor))}`
                      : ''}
                    {s.tax_minor ? ` · tax ${fmt(s.tax_minor)}` : ''}
                    {s.payment_fee_minor ? ` · payment ${fmt(s.payment_fee_minor)}` : ''}
                  </span>
                  <em>
                    {fmt(s.net_minor)}{' '}
                    {s.payout_state
                      ? `${s.payout_state.toLowerCase().replaceAll('_', ' ')}${s.paid_at ? ` on ${new Date(s.paid_at).toLocaleDateString()}` : ''}`
                      : s.lifecycle_state.toLowerCase()}
                  </em>
                  <button
                    type="button"
                    onClick={() =>
                      setChallenge({
                        component: 'ITEM_PROCEEDS',
                        expected: (s.net_minor / 100).toFixed(2),
                        note: '',
                        settlementId: s.settlement_id,
                      })
                    }
                  >
                    Query this line
                  </button>
                </div>
              ))
            )}
          </div>
          {challenge ? (
            <div className="catalogue-flag">
              <p className="field-help">
                Tell finance which part of this settlement is wrong and what you expected. They
                answer within seven days.
              </p>
              <label>
                Which part
                <select
                  value={challenge.component}
                  onChange={(event) =>
                    setChallenge({ ...challenge, component: event.target.value })
                  }
                >
                  {DISPUTABLE.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                What you expected (₹)
                <input
                  inputMode="decimal"
                  value={challenge.expected}
                  onChange={(event) => setChallenge({ ...challenge, expected: event.target.value })}
                />
              </label>
              <label>
                What happened
                <textarea
                  maxLength={500}
                  value={challenge.note}
                  onChange={(event) => setChallenge({ ...challenge, note: event.target.value })}
                />
              </label>
              <div className="order-actions">
                <button type="button" disabled={busy} onClick={() => void sendChallenge()}>
                  Send to finance
                </button>
                <button type="button" onClick={() => setChallenge(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {disputes.length > 0 ? (
            <div className="payout-ledger" aria-label="Queries you have raised">
              {disputes.map((dispute) => (
                <div key={dispute.vendor_settlement_dispute_id}>
                  <strong>{dispute.source_order_reference}</strong>
                  <span>
                    {dispute.disputed_component.toLowerCase().replaceAll('_', ' ')}:{' '}
                    {fmt(Number(dispute.disputed_amount_minor))} recorded, you expected{' '}
                    {fmt(Number(dispute.expected_amount_minor))}.{' '}
                    {dispute.lifecycle_state === 'OPEN'
                      ? `Answer due ${new Date(dispute.deadline_at).toLocaleDateString()}.`
                      : dispute.lifecycle_state === 'WITHDRAWN'
                        ? 'You withdrew this.'
                        : `Settled at ${fmt(Number(dispute.resolved_amount_minor ?? '0'))}${
                            dispute.adjustment_delta_minor
                              ? `, ${Number(dispute.adjustment_delta_minor) > 0 ? 'paying you' : 'taking back'} ${fmt(Math.abs(Number(dispute.adjustment_delta_minor)))}`
                              : ', changing nothing'
                          }.`}
                  </span>
                  {dispute.lifecycle_state === 'OPEN' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void withdraw(dispute.vendor_settlement_dispute_id)}
                    >
                      Withdraw
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="order-actions">
            <button type="button" onClick={() => downloadStatement(statement)}>
              Download CSV
            </button>
            <button type="button" onClick={() => window.print()}>
              Print statement
            </button>
          </div>
        </>
      )}
    </div>
  );
}
