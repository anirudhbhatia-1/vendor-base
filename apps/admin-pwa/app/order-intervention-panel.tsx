'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './authenticated-api';

/**
 * The live order monitor and its interventions (11.2; ADM-26, ADM-28, ADM-30,
 * ADM-31, ADM-32).
 *
 * EXC-12 rules out fixing an order by editing the database, so operations act
 * through five commands. Each is previewed by the server from the order as it
 * stands -- whether it is allowed, the money and custody it touches, what it
 * leaves alone, who is told, whether a second person must approve -- and then
 * confirmed with a reason, against the versions the preview read. Until audit
 * run 74 the previews were sentences written here, the timeline read the
 * customer's receipt route (which an operator cannot call), and no command
 * stood behind any of it.
 */
type MonitorOrder = {
  readonly vendor_order_id: string;
  readonly order_reference: string;
  readonly lifecycle_state: string;
  readonly location_name: string;
  readonly fulfilment_method: string;
  readonly time_in_state_seconds: number;
  readonly exceptions: readonly string[];
};
type MonitorGroup = {
  readonly checkout_group_id: string;
  readonly derived_lifecycle_state: string;
  readonly payment_state: string;
  readonly orders: readonly MonitorOrder[];
  readonly sibling_orders_not_shown: number;
};
type TimelineEntry = {
  readonly kind: string;
  readonly at: string;
  readonly summary: string;
  readonly reference: string;
};
export type InterventionKind = 'CANCEL' | 'REFUND' | 'REASSIGN' | 'RETURN' | 'COMMUNICATE';
export type Preview = {
  readonly kind: InterventionKind;
  readonly allowed: boolean;
  readonly blocked_reason: string | null;
  readonly effects: readonly string[];
  readonly notifies: readonly string[];
  readonly required_capability: string;
  readonly approval: 'NONE' | 'SECOND_PERSON';
  readonly expected: { readonly order_version: number; readonly assignment_version: number | null };
};

const KINDS: readonly [InterventionKind, string][] = [
  ['CANCEL', 'Cancel the order'],
  ['REFUND', 'Propose a refund'],
  ['REASSIGN', 'Reassign the partner'],
  ['RETURN', 'Direct a return'],
  ['COMMUNICATE', 'Message the customer'],
];
const MESSAGES: readonly [string, string][] = [
  ['UNDER_REVIEW', 'We are looking into your order'],
  ['DELAY_ACKNOWLEDGED', 'We know your order is late'],
  ['SUPPORT_WILL_CONTACT', 'Support will contact you'],
];

/** How long an order has sat in its state, in the operator's terms. */
export function timeInState(seconds: number): string {
  if (seconds < 90) return `${seconds}s in state`;
  if (seconds < 5_400) return `${Math.round(seconds / 60)} min in state`;
  return `${Math.round(seconds / 3_600)} h in state`;
}

/** The body an intervention is confirmed with: the preview's versions and a reason. */
export function interventionBody(
  preview: Preview,
  reasonCode: string,
  params: Record<string, string | number>,
): Record<string, unknown> {
  return {
    confirm: true,
    reason_code: reasonCode,
    expected_order_version: preview.expected.order_version,
    ...(preview.expected.assignment_version !== null
      ? { expected_assignment_version: preview.expected.assignment_version }
      : {}),
    ...params,
  };
}

export function OrderInterventionPanel() {
  const [filters, setFilters] = useState({
    state: '',
    fulfilment_method: '',
    exception: '',
    min_minutes: '',
    vendor_location_id: '',
    checkout_group_id: '',
  });
  const [groups, setGroups] = useState<readonly MonitorGroup[]>([]);
  const [selected, setSelected] = useState<MonitorOrder | null>(null);
  const [timeline, setTimeline] = useState<readonly TimelineEntry[]>([]);
  const [kind, setKind] = useState<InterventionKind>('COMMUNICATE');
  const [params, setParams] = useState({
    amount: '',
    compensation: '',
    message: 'UNDER_REVIEW',
    note: '',
  });
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState('Loading the order monitor…');

  const load = useCallback(async () => {
    const query = new URLSearchParams();
    if (filters.state) query.set('state', filters.state);
    if (filters.fulfilment_method) query.set('fulfilment_method', filters.fulfilment_method);
    if (filters.exception) query.set('exception', filters.exception);
    if (filters.min_minutes)
      query.set('min_time_in_state_seconds', String(Math.max(0, Number(filters.min_minutes) * 60)));
    if (filters.vendor_location_id.trim())
      query.set('vendor_location_id', filters.vendor_location_id.trim());
    if (filters.checkout_group_id.trim())
      query.set('checkout_group_id', filters.checkout_group_id.trim());
    try {
      const result = await adminRequest<{ checkout_groups: MonitorGroup[] }>(
        `admin/orders/monitor${query.size ? `?${query.toString()}` : ''}`,
      );
      setGroups(result.checkout_groups);
      setMessage(
        `${result.checkout_groups.length} checkout group${result.checkout_groups.length === 1 ? '' : 's'} match.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The order monitor failed to load.');
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(order: MonitorOrder) {
    setSelected(order);
    setPreview(null);
    try {
      const result = await adminRequest<{ entries: TimelineEntry[] }>(
        `admin/orders/${order.vendor_order_id}/timeline`,
      );
      setTimeline(result.entries);
      setMessage(`${result.entries.length} events on ${order.order_reference}.`);
    } catch (error) {
      setTimeline([]);
      setMessage(error instanceof Error ? error.message : 'The timeline could not be loaded.');
    }
  }

  function interventionParams(): Record<string, string | number> {
    if (kind === 'REFUND' && params.amount)
      return { amount_minor: Math.round(Number(params.amount) * 100) };
    if (kind === 'REASSIGN' && params.compensation)
      return { compensation_minor: Math.round(Number(params.compensation) * 100) };
    if (kind === 'COMMUNICATE') return { message: params.message };
    if (kind === 'RETURN' && params.note.trim()) return { destination_note: params.note.trim() };
    return {};
  }

  async function previewIntervention() {
    if (!selected) return;
    const query = new URLSearchParams(
      Object.entries(interventionParams()).map(([key, value]) => [key, String(value)]),
    );
    try {
      const result = await adminRequest<Preview>(
        `admin/orders/${selected.vendor_order_id}/interventions/${kind}/preview${query.size ? `?${query.toString()}` : ''}`,
      );
      setPreview(result);
      setMessage(
        result.allowed
          ? 'Preview only. Nothing has changed yet.'
          : (result.blocked_reason ?? 'Not allowed.'),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The preview could not be loaded.');
    }
  }

  async function confirmIntervention() {
    if (!selected || !preview?.allowed) return;
    try {
      const result = await adminRequest<{ audit_event_id: string }>(
        `admin/orders/${selected.vendor_order_id}/interventions/${preview.kind}`,
        {
          method: 'POST',
          body: JSON.stringify(interventionBody(preview, reason.trim(), interventionParams())),
        },
      );
      setMessage(
        `${preview.kind.toLowerCase()} recorded (audit ${result.audit_event_id.slice(0, 8)}).${preview.approval === 'SECOND_PERSON' ? ' A second person must approve the money before it moves.' : ''}`,
      );
      setPreview(null);
      await load();
      await open(selected);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The intervention was refused.');
    }
  }

  return (
    <section className="catalogue-oversight" id="order-interventions">
      <div>
        <p className="eyebrow">LIVE ORDER MONITOR</p>
        <h2>{groups.length} checkout groups</h2>
        <p>
          Every action is previewed by the server, confirmed with a reason, and recorded. Money
          moves only after a second person approves it.
        </p>
      </div>
      <p aria-live="polite">{message}</p>
      <div className="catalogue-flag">
        <label>
          State
          <select
            value={filters.state}
            onChange={(e) => setFilters({ ...filters, state: e.target.value })}
          >
            <option value="">Any</option>
            {[
              'PLACED',
              'ACCEPTED',
              'PICKING',
              'AWAITING_CUSTOMER_DECISION',
              'READY',
              'PICKED_UP',
              'DELIVERED',
              'RETURNED',
              'CANCELLED',
              'EXPIRED',
            ].map((state) => (
              <option key={state} value={state}>
                {state.toLowerCase().replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fulfilment
          <select
            value={filters.fulfilment_method}
            onChange={(e) => setFilters({ ...filters, fulfilment_method: e.target.value })}
          >
            <option value="">Any</option>
            <option value="PLATFORM_DELIVERY">Platform delivery</option>
            <option value="CUSTOMER_PICKUP">Customer pickup</option>
            <option value="VENDOR_DELIVERY">Shop delivery</option>
          </select>
        </label>
        <label>
          Exception
          <select
            value={filters.exception}
            onChange={(e) => setFilters({ ...filters, exception: e.target.value })}
          >
            <option value="">Any or none</option>
            <option value="ANY">Any exception</option>
            <option value="STALLED">Stalled past a deadline</option>
            <option value="PARTNER_EXCEPTION">Partner report open</option>
            <option value="SUPPORT_CASE">Support case open</option>
            <option value="PAYMENT">Payment or refund unresolved</option>
          </select>
        </label>
        <label>
          At least (minutes in state)
          <input
            inputMode="numeric"
            value={filters.min_minutes}
            onChange={(e) =>
              setFilters({ ...filters, min_minutes: e.target.value.replace(/\D/g, '') })
            }
          />
        </label>
        <label>
          Shop (location ID)
          <input
            value={filters.vendor_location_id}
            onChange={(e) => setFilters({ ...filters, vendor_location_id: e.target.value })}
          />
        </label>
        <label>
          Checkout group ID
          <input
            value={filters.checkout_group_id}
            onChange={(e) => setFilters({ ...filters, checkout_group_id: e.target.value })}
          />
        </label>
      </div>

      <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
        {groups.length === 0 && <p>No checkout groups match.</p>}
        {groups.map((group) => (
          <article key={group.checkout_group_id} className="catalogue-flag">
            <strong>
              Group {group.checkout_group_id.slice(0, 8)} ·{' '}
              {group.derived_lifecycle_state.toLowerCase().replaceAll('_', ' ')}
            </strong>
            <p>Payment {group.payment_state.toLowerCase()}</p>
            {group.orders.map((order) => (
              <div key={order.vendor_order_id} className="actions">
                <button type="button" onClick={() => void open(order)}>
                  {order.order_reference.slice(-8)} ·{' '}
                  {order.lifecycle_state.toLowerCase().replaceAll('_', ' ')} · {order.location_name}{' '}
                  · {order.fulfilment_method.toLowerCase().replaceAll('_', ' ')} ·{' '}
                  {timeInState(order.time_in_state_seconds)}
                  {order.exceptions.length > 0
                    ? ` · ${order.exceptions.join(', ').toLowerCase()}`
                    : ''}
                </button>
              </div>
            ))}
            {group.sibling_orders_not_shown > 0 && (
              <small>
                {group.sibling_orders_not_shown} other order(s) in this group do not match and are
                not shown.
              </small>
            )}
          </article>
        ))}
      </div>

      {selected && (
        <div className="catalogue-flag" style={{ marginTop: '1rem' }}>
          <h3>
            {selected.order_reference} ·{' '}
            {selected.lifecycle_state.toLowerCase().replaceAll('_', ' ')}
          </h3>
          <ol>
            {timeline.map((entry) => (
              <li key={`${entry.kind}-${entry.reference}`}>
                <strong>{entry.kind.toLowerCase()}</strong> · {new Date(entry.at).toLocaleString()}{' '}
                · {entry.summary}
              </li>
            ))}
          </ol>
          <label>
            Intervention
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as InterventionKind);
                setPreview(null);
              }}
            >
              {KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {kind === 'REFUND' && (
            <label>
              Amount (₹, blank for everything refundable)
              <input
                value={params.amount}
                onChange={(e) => setParams({ ...params, amount: e.target.value })}
              />
            </label>
          )}
          {kind === 'REASSIGN' && (
            <label>
              Compensation for the displaced partner (₹)
              <input
                value={params.compensation}
                onChange={(e) => setParams({ ...params, compensation: e.target.value })}
              />
            </label>
          )}
          {kind === 'COMMUNICATE' && (
            <label>
              Message
              <select
                value={params.message}
                onChange={(e) => setParams({ ...params, message: e.target.value })}
              >
                {MESSAGES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === 'RETURN' && (
            <label>
              Somewhere other than the shop (optional)
              <input
                value={params.note}
                onChange={(e) => setParams({ ...params, note: e.target.value })}
              />
            </label>
          )}
          <div className="actions">
            <button type="button" onClick={() => void previewIntervention()}>
              Preview
            </button>
          </div>
          {preview && (
            <div>
              <p>
                <strong>
                  {preview.allowed ? 'Allowed' : `Not allowed: ${preview.blocked_reason}`}
                </strong>
              </p>
              <ul>
                {preview.effects.map((effect) => (
                  <li key={effect}>{effect}</li>
                ))}
              </ul>
              <p>
                Tells: {preview.notifies.join(', ') || 'nobody'} · needs{' '}
                {preview.required_capability}
                {preview.approval === 'SECOND_PERSON'
                  ? ' · a second person approves the money'
                  : ''}
              </p>
              {preview.allowed && (
                <>
                  <label>
                    Reason code
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value.toUpperCase())}
                      placeholder="CUSTOMER_REQUESTED_BY_PHONE"
                    />
                  </label>
                  <div className="actions">
                    <button
                      type="button"
                      disabled={!/^[A-Z][A-Z0-9_]{2,63}$/.test(reason.trim())}
                      onClick={() => void confirmIntervention()}
                    >
                      Confirm {preview.kind.toLowerCase()}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
