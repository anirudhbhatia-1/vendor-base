'use client';

import { useState } from 'react';
import type { VendorStatement } from '@neighbourhood-store/contracts';
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
  const header = [
    'settlement_reference',
    'lifecycle_state',
    'eligible_at',
    'gross_inr',
    'platform_fee_inr',
    'net_inr',
  ];
  const rows = statement.settlements.map((entry) => [
    entry.reference,
    entry.lifecycle_state,
    entry.eligible_at,
    (entry.gross_minor / 100).toFixed(2),
    (entry.platform_fee_minor / 100).toFixed(2),
    (entry.net_minor / 100).toFixed(2),
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

export function PayoutsPanel({ vendorLocationId }: { vendorLocationId: string }) {
  const [statement, setStatement] = useState<VendorStatement | null>(null);
  const [message, setMessage] = useState('Load your live settlement statement.');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const client = await vendorApiClient();
      const data = await client.vendor.finance.statement(vendorLocationId);
      setStatement(data);
      setMessage(`Statement loaded. ${data.settlements.length} settlement record(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Statement could not be loaded.');
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
                    Gross {fmt(s.gross_minor)} · fee {fmt(s.platform_fee_minor)}
                  </span>
                  <em>
                    {fmt(s.net_minor)} {s.lifecycle_state.toLowerCase()}
                  </em>
                </div>
              ))
            )}
          </div>
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
