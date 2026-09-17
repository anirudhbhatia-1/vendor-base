'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './authenticated-api';

/**
 * The two things that go wrong quietly.
 *
 * A domain event that failed every retry stops in the dead-letter path rather
 * than being lost — but nothing showed that path to a person, so a side effect
 * that never ran was invisible: a payment uncaptured, a partner unpaid, a
 * customer untold, with nothing anywhere to look at. And every deadline in the
 * platform already existed without anything asking which of them had run out,
 * so an order could sit unanswered indefinitely with no queue naming it.
 *
 * Recovery re-runs a side effect that moves real state, so it asks for a reason
 * and records who asked.
 */
type DeadLetter = {
  readonly event_id: string;
  readonly event_type: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly attempt_count: number;
  readonly last_error_code: string;
};

type StalledOrder = {
  readonly vendor_order_id: string;
  readonly order_reference: string;
  readonly lifecycle_state: string;
  readonly stall_reason: string;
  readonly stalled_seconds: string;
};

function elapsed(seconds: string): string {
  const total = Number(seconds);
  if (!Number.isFinite(total)) return 'unknown';
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

export function OperationsHealthPanel() {
  const [deadLetters, setDeadLetters] = useState<DeadLetter[]>([]);
  const [stalled, setStalled] = useState<StalledOrder[]>([]);
  const [message, setMessage] = useState('Loading operational health…');

  const load = useCallback(async () => {
    try {
      const [events, orders] = await Promise.all([
        adminRequest<{ events?: DeadLetter[] }>('admin/control/dead-letters'),
        adminRequest<{ stalled_orders?: StalledOrder[] }>('admin/control/orders?stalled_only=true'),
      ]);
      const stuck = events.events ?? [];
      const waiting = orders.stalled_orders ?? [];
      setDeadLetters(stuck);
      setStalled(waiting);
      setMessage(
        stuck.length === 0 && waiting.length === 0
          ? 'Nothing is stuck. Every domain event was delivered and no order is past a deadline.'
          : `${stuck.length} undelivered event${stuck.length === 1 ? '' : 's'} and ${waiting.length} stalled order${waiting.length === 1 ? '' : 's'}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Operational health failed to load.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function recover(event: DeadLetter) {
    try {
      await adminRequest(`admin/control/dead-letters/${event.event_id}/recover`, {
        method: 'POST',
        body: JSON.stringify({ reason_code: 'OPERATOR_REDELIVERY' }),
      });
      setMessage(
        `${event.event_type} returned for redelivery. The worker retries it on its next tick.`,
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The event could not be recovered.');
    }
  }

  return (
    <section className="catalogue-oversight" id="operations-health">
      <div>
        <p className="eyebrow">OPERATIONAL HEALTH</p>
        <h2>
          {deadLetters.length} undelivered · {stalled.length} stalled
        </h2>
        <p>
          An event here means something the platform owed somebody never happened. An order here
          means a deadline passed with nobody answering it.
        </p>
      </div>
      <p aria-live="polite">{message}</p>
      <div className="catalogue-flag">
        <div className="actions">
          <button type="button" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>

      <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
        {deadLetters.length === 0 && <p>No domain event is undelivered.</p>}
        {deadLetters.map((event) => (
          <article key={event.event_id}>
            <span>{event.last_error_code}</span>
            <strong>{event.event_type}</strong>
            <p>
              {event.aggregate_type} {event.aggregate_id.slice(0, 8)}… · {event.attempt_count}{' '}
              attempts
            </p>
            <button type="button" onClick={() => void recover(event)}>
              Return for redelivery
            </button>
          </article>
        ))}
      </div>

      <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
        {stalled.length === 0 && <p>No order is past a deadline.</p>}
        {stalled.map((order) => (
          <article key={order.vendor_order_id}>
            <span>{order.stall_reason.replaceAll('_', ' ').toLowerCase()}</span>
            <strong>{order.order_reference}</strong>
            <p>
              {order.lifecycle_state} · waiting {elapsed(order.stalled_seconds)}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
