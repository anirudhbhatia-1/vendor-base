'use client';
import { useState } from 'react';
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
type Order = {
  vendor_order_id: string;
  order_reference: string;
  lifecycle_state: string;
  total_minor: number;
  version: number;
  accept_by: string | null;
  package_count: number | null;
};
type Pick = {
  pick_id: string;
  vendor_order_line_id: string;
  pick_state: string;
  actual_quantity: number | null;
  actual_unit_price_minor: number | null;
  product_title: string | null;
  ordered_quantity: number | null;
  ordered_unit_price_minor: number | null;
};
export function OrdersPanel() {
  const [token, setToken] = useState('');
  const [location, setLocation] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [picks, setPicks] = useState<Record<string, Pick[]>>({});
  const [message, setMessage] = useState('Connect the store order desk.');
  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`${apiUrl}/vendor/locations/${location}/orders${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (!response.ok)
      throw new Error(`Order action failed (${response.status}). Refresh before retrying.`);
    return response.json();
  }
  async function load() {
    try {
      const body = (await request('')) as { orders: Order[] };
      setOrders(body.orders);
      sessionStorage.setItem('neighbourhood.vendor.access-token', token);
      sessionStorage.setItem('neighbourhood.vendor.location-id', location);
      setMessage(
        body.orders.length ? 'Live server orders loaded.' : 'No active or historical store orders.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Orders failed.');
    }
  }
  async function act(order: Order, path: string, body: object = {}) {
    try {
      await request(`/${order.vendor_order_id}/${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await load();
      setMessage(`${path.replaceAll('-', ' ')} recorded.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Action failed.');
    }
  }
  async function loadPicks(order: Order) {
    try {
      const body = (await request(`/${order.vendor_order_id}/picks`)) as { picks: Pick[] };
      setPicks((current) => ({ ...current, [order.vendor_order_id]: body.picks }));
      setMessage('Pick list loaded. Confirm each line before ready.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Pick list failed.');
    }
  }
  async function found(order: Order, pick: Pick) {
    try {
      await request(`/${order.vendor_order_id}/lines/${pick.vendor_order_line_id}/found`, {
        method: 'POST',
        body: JSON.stringify({
          actual_quantity: pick.actual_quantity ?? pick.ordered_quantity ?? 1,
          actual_unit_price_minor:
            pick.actual_unit_price_minor ?? pick.ordered_unit_price_minor ?? 0,
        }),
      });
      await loadPicks(order);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Line confirmation failed.');
    }
  }
  return (
    <section className="orders-panel">
      <header>
        <div>
          <p className="eyebrow">Live fulfilment</p>
          <h2>Accept, pick and hand off.</h2>
        </div>
        <strong>
          {
            orders.filter((o) => !['CANCELLED', 'PICKED_UP', 'EXPIRED'].includes(o.lifecycle_state))
              .length
          }{' '}
          active
        </strong>
      </header>
      <div className="order-connect">
        <label>
          Vendor access token
          <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="nsa_…" />
        </label>
        <label>
          Location ID
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="UUID"
          />
        </label>
        <button onClick={load}>Load orders</button>
      </div>
      <p aria-live="polite">{message}</p>
      <div className="order-grid">
        {orders.map((order) => (
          <article key={order.vendor_order_id}>
            <small>{order.order_reference}</small>
            <h3>{order.lifecycle_state.replaceAll('_', ' ')}</h3>
            <strong>₹{(order.total_minor / 100).toFixed(2)}</strong>
            {order.accept_by && (
              <span>Respond by {new Date(order.accept_by).toLocaleTimeString()}</span>
            )}
            <div className="order-actions">
              {order.lifecycle_state === 'PLACED' && (
                <>
                  <button
                    onClick={() =>
                      act(order, 'accept', {
                        expected_version: order.version,
                        preparation_estimate_seconds: 900,
                      })
                    }
                  >
                    Accept · 15 min
                  </button>
                  <button
                    className="danger"
                    onClick={() =>
                      act(order, 'decline', {
                        expected_version: order.version,
                        reason_code: 'VENDOR_UNAVAILABLE',
                        note: 'SYNTH Store cannot fulfil',
                      })
                    }
                  >
                    Decline
                  </button>
                </>
              )}
              {order.lifecycle_state === 'ACCEPTED' && (
                <button
                  onClick={() => act(order, 'start-picking', { expected_version: order.version })}
                >
                  Start picking
                </button>
              )}
              {order.lifecycle_state === 'PICKING' && (
                <>
                  <button onClick={() => loadPicks(order)}>Open pick list</button>
                  <button
                    onClick={() =>
                      act(order, 'ready', {
                        expected_version: order.version,
                        package_count: 1,
                        package_condition_note: 'SYNTH Sealed package',
                      })
                    }
                  >
                    Mark ready
                  </button>
                </>
              )}
              {order.lifecycle_state === 'READY' && (
                <button onClick={() => act(order, 'pickup-otp')}>Issue pickup OTP</button>
              )}
            </div>
            {picks[order.vendor_order_id]?.map((pick) => (
              <div className="pick-row" key={pick.pick_id}>
                <span>
                  {(pick.product_title ?? pick.vendor_order_line_id).replace('SYNTH ', '')} ·{' '}
                  {pick.ordered_quantity ?? '?'} ordered · {pick.pick_state.replaceAll('_', ' ')}
                </span>
                {pick.pick_state === 'PENDING' && (
                  <>
                    <button onClick={() => found(order, pick)}>Found</button>
                    <button
                      className="danger"
                      onClick={() => act(order, `lines/${pick.vendor_order_line_id}/missing`)}
                    >
                      Missing
                    </button>
                  </>
                )}
              </div>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}
