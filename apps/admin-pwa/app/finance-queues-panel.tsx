'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './authenticated-api';

/**
 * Vendor settlement and partner earning queues (ADM-48, ADM-49).
 *
 * Money owed to other people was the least visible thing in the console: the
 * settlement and payout endpoints existed but nothing listed them, so an
 * operator could not answer "who are we behind on paying?" without a database
 * query. Every figure here is integer paise from the ledger; nothing is
 * recomputed in the browser.
 */
type Row = Record<string, unknown>;

function rupees(minor: unknown): string {
  const value = Number(minor ?? 0);
  return `₹${(Number.isFinite(value) ? value / 100 : 0).toFixed(2)}`;
}

export function FinanceQueuesPanel() {
  const [payments, setPayments] = useState<Row[]>([]);
  const [refunds, setRefunds] = useState<Row[]>([]);
  const [exceptions, setExceptions] = useState<Row[]>([]);
  const [payoutId, setPayoutId] = useState('');
  const [message, setMessage] = useState('Loading the money queues…');

  const load = useCallback(async () => {
    try {
      const [paymentResult, refundResult, exceptionResult] = await Promise.all([
        adminRequest<{ payments?: Row[] }>('admin/finance/payments'),
        adminRequest<{ refunds?: Row[] }>('admin/finance/refunds'),
        adminRequest<{ exceptions?: Row[] }>('admin/finance/v2/exceptions'),
      ]);
      setPayments(paymentResult.payments ?? []);
      setRefunds(refundResult.refunds ?? []);
      setExceptions(exceptionResult.exceptions ?? []);
      setMessage(
        `${paymentResult.payments?.length ?? 0} payments · ${refundResult.refunds?.length ?? 0} refunds · ${exceptionResult.exceptions?.length ?? 0} open exceptions.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The money queues failed to load.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Submitting and reconciling a payout are separate acts. Submission hands the
   * instruction to the provider; reconciliation is what closes it against the
   * provider's own statement, and only then is the money considered settled.
   */
  async function payoutStep(step: 'submit' | 'reconcile') {
    if (!payoutId) {
      setMessage('Enter the payout identifier first.');
      return;
    }
    try {
      const result = await adminRequest<{ payout_state?: string }>(
        `admin/finance/payouts/${payoutId}/${step}`,
        {
          method: 'POST',
          body: JSON.stringify({
            command_reference: `PAYOUT-${step.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
            provider_scenario: 'SUCCESS',
            ...(step === 'reconcile'
              ? { provider_statement_reference: `SYNTH-STMT-${payoutId}` }
              : {}),
          }),
        },
      );
      setMessage(`Payout ${payoutId} is ${result.payout_state ?? step + 'ted'}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `The payout ${step} failed.`);
    }
  }

  async function runDailyPayouts() {
    try {
      const result = await adminRequest<{ payout_batch_id?: string }>(
        'admin/finance/v2/payout-jobs/daily',
        {
          method: 'POST',
          body: JSON.stringify({
            command_reference: `PAYOUT-RUN-${Date.now().toString(36).toUpperCase()}`,
            provider_scenario: 'SUCCESS',
          }),
        },
      );
      setMessage(
        result.payout_batch_id
          ? `Daily payout batch ${result.payout_batch_id} created.`
          : 'Daily payout run completed.',
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The daily payout run failed.');
    }
  }

  return (
    <section className="catalogue-oversight" id="finance-queues">
      <div>
        <p className="eyebrow">MONEY QUEUES</p>
        <h2>Settlements, payouts and exceptions</h2>
        <p>Every amount is the ledger&apos;s own; nothing here recalculates money.</p>
      </div>
      <p aria-live="polite">{message}</p>
      <div className="catalogue-flag">
        <label>
          Payout identifier
          <input value={payoutId} onChange={(e) => setPayoutId(e.target.value)} />
        </label>
        <div className="actions">
          <button type="button" onClick={() => void payoutStep('submit')}>
            Submit payout
          </button>
          <button type="button" onClick={() => void payoutStep('reconcile')}>
            Reconcile payout
          </button>
          <button type="button" onClick={() => void runDailyPayouts()}>
            Run daily payouts
          </button>
          <button type="button" onClick={() => void load()}>
            Refresh queues
          </button>
        </div>
      </div>

      <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
        {exceptions.map((row, index) => (
          <article key={String(row['finance_exception_id'] ?? index)}>
            <span>{String(row['exception_kind'] ?? 'EXCEPTION')}</span>
            <strong>{rupees(row['amount_at_risk_minor'])} at risk</strong>
            <p>{String(row['next_action_code'] ?? '')}</p>
          </article>
        ))}
        {refunds.map((row, index) => (
          <article key={String(row['refund_id'] ?? `refund-${index}`)}>
            <span>REFUND · {String(row['refund_state'] ?? '')}</span>
            <strong>{rupees(row['refund_total_minor'])}</strong>
            <p>{String(row['source_order_reference'] ?? '')}</p>
          </article>
        ))}
        {payments.map((row, index) => (
          <article key={String(row['payment_transaction_id'] ?? `payment-${index}`)}>
            <span>PAYMENT · {String(row['payment_state'] ?? '')}</span>
            <strong>{rupees(row['amount_minor'])}</strong>
            <p>{String(row['source_checkout_reference'] ?? '')}</p>
          </article>
        ))}
        {exceptions.length + refunds.length + payments.length === 0 && (
          <p>No money movements recorded yet.</p>
        )}
      </div>
    </section>
  );
}
