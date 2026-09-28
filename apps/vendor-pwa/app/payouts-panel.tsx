'use client';

import { useState } from 'react';
import type {
  VendorDisputableComponent,
  VendorSettlementDispute,
  VendorSettlementEntry,
  VendorStatement,
} from '@neighbourhood-store/contracts';
import { actionErrorText, parseRupeesToMinor } from '@neighbourhood-store/ui';
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
  // Sale, goods returned, platform fee, payment costs, tax, the customer's
  // refund, adjustments and payout status, per order (VEN-48): the sale is
  // the goods as sold, so sale − returned − fee − payment − tax ± adjustment
  // is what the shop is paid.
  const header = [
    'settlement_reference',
    'lifecycle_state',
    'eligible_at',
    'gross_inr',
    'goods_returned_inr',
    'platform_fee_inr',
    'payment_fee_inr',
    'tax_inr',
    'customer_refund_inr',
    'adjustment_inr',
    'net_inr',
    'payout_state',
    'paid_at',
  ];
  const rupees = (minor: number) => (minor / 100).toFixed(2);
  const rows = statement.settlements.map((entry) => [
    entry.reference,
    entry.lifecycle_state,
    entry.eligible_at,
    rupees(entry.gross_minor),
    rupees(entry.goods_returned_minor ?? 0),
    rupees(entry.platform_fee_minor),
    rupees(entry.payment_fee_minor ?? 0),
    rupees(entry.tax_minor ?? 0),
    rupees(entry.refund_minor ?? 0),
    rupees(entry.adjustment_minor ?? 0),
    rupees(entry.net_minor),
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
const DISPUTABLE: readonly (readonly [VendorDisputableComponent, string])[] = [
  ['ITEM_PROCEEDS', 'What we were paid for the goods we kept'],
  ['PLATFORM_FEE', 'The platform fee'],
  ['REFUND', 'Goods taken back for a return'],
];

/**
 * The figure the statement shows for a line — the same one the server
 * records when the challenge is opened — so the form starts from what the
 * shop is disputing rather than from an unrelated total.
 */
export function statementFigure(
  entry: VendorSettlementEntry,
  component: VendorDisputableComponent,
): number {
  const returned = entry.goods_returned_minor ?? 0;
  switch (component) {
    case 'ITEM_PROCEEDS':
      return entry.gross_minor - returned;
    case 'PLATFORM_FEE':
      return entry.platform_fee_minor;
    case 'REFUND':
      return returned;
    case 'PAYMENT_FEE':
      return entry.payment_fee_minor ?? 0;
    case 'TAX':
      return entry.tax_minor ?? 0;
  }
}

export function PayoutsPanel({ vendorLocationId }: { vendorLocationId: string }) {
  const [statement, setStatement] = useState<VendorStatement | null>(null);
  const [disputes, setDisputes] = useState<readonly VendorSettlementDispute[]>([]);
  const [message, setMessage] = useState('Load your live settlement statement.');
  const [busy, setBusy] = useState(false);
  // The line being challenged, if any: the settlement, which part of it, the
  // figure the shop expected, and why.
  const [challenge, setChallenge] = useState<{
    entry: VendorSettlementEntry;
    component: VendorDisputableComponent;
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
      setMessage(actionErrorText(error, 'Statement could not be loaded.'));
    } finally {
      setBusy(false);
    }
  }

  async function sendChallenge() {
    if (!challenge) return;
    // Parsed as digits, never as a float: `Number('') * 100` sent an empty
    // field as a real claim of ₹0, and `1.005 * 100` is not 100.5.
    const expectedMinor = parseRupeesToMinor(challenge.expected);
    if (expectedMinor === null) {
      setMessage('Enter the amount you expected in rupees, like 245 or 245.50.');
      return;
    }
    if (!challenge.note.trim()) {
      setMessage('Say what is wrong so finance can check it.');
      return;
    }
    setBusy(true);
    try {
      const client = await vendorApiClient();
      await client.vendor.finance.openDispute(vendorLocationId, {
        disputed_component: challenge.component,
        evidence_note: challenge.note,
        expected_amount_minor: expectedMinor,
        settlement_id: challenge.entry.settlement_id,
      });
      setChallenge(null);
      setMessage('Sent. Finance will answer this within seven days.');
      await load();
    } catch (error) {
      setMessage(actionErrorText(error, 'That challenge could not be sent.'));
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
      setMessage(actionErrorText(error, 'That could not be withdrawn.'));
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
                    Sale {fmt(s.gross_minor)}
                    {s.goods_returned_minor ? ` · returned −${fmt(s.goods_returned_minor)}` : ''}
                    {` · fee −${fmt(s.platform_fee_minor)}`}
                    {s.payment_fee_minor ? ` · payment −${fmt(s.payment_fee_minor)}` : ''}
                    {s.tax_minor ? ` · tax −${fmt(s.tax_minor)}` : ''}
                    {s.adjustment_minor
                      ? ` · adjusted ${s.adjustment_minor > 0 ? '+' : '−'}${fmt(Math.abs(s.adjustment_minor))}`
                      : ''}
                    {s.adjustment_outstanding_minor
                      ? ` (${fmt(Math.abs(s.adjustment_outstanding_minor))} settled separately)`
                      : ''}
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
                        entry: s,
                        expected: (statementFigure(s, 'ITEM_PROCEEDS') / 100).toFixed(2),
                        note: '',
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
                  onChange={(event) => {
                    const component = event.target.value as VendorDisputableComponent;
                    setChallenge({
                      ...challenge,
                      component,
                      expected: (statementFigure(challenge.entry, component) / 100).toFixed(2),
                    });
                  }}
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
                              ? `, ${Number(dispute.adjustment_delta_minor) > 0 ? 'paying you' : 'taking back'} ${fmt(Math.abs(Number(dispute.adjustment_delta_minor)))}${dispute.applied_to_settlement === false ? ' separately from this payout' : ''}`
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
