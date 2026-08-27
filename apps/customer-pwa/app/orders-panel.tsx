'use client';

import { useState } from 'react';
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
type Order = {
  vendor_order_id: string;
  order_reference: string;
  lifecycle_state: string;
  total_minor: number;
};
type Group = {
  checkout_group_id: string;
  checkout_reference: string;
  created_at: string;
  vendor_orders: Order[];
};
type Receipt = {
  order: Order;
  lines: {
    catalogue_variant_id: string;
    vendor_location_id: string;
    title: string;
    quantity: number;
    unit_price_minor: number;
    line_total_minor: number;
  }[];
};

export function OrdersPanel() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [message, setMessage] = useState('Load persisted order history after signing in.');
  async function request(path: string, init?: RequestInit) {
    const token = sessionStorage.getItem('neighbourhood.customer.access-token');
    if (!token) throw new Error('Sign in first.');
    const r = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    const b: unknown = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Order request failed (${r.status}).`);
    return b;
  }
  async function load() {
    try {
      const b = (await request('/customer/orders')) as { groups: Group[] };
      setGroups(b.groups);
      setMessage(b.groups.length ? 'History refreshed.' : 'No orders yet.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'History failed.');
    }
  }
  async function open(id: string) {
    try {
      setReceipt((await request(`/customer/orders/${id}/receipt`)) as Receipt);
      setMessage('Receipt loaded from immutable order snapshots.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Receipt failed.');
    }
  }
  async function reorder() {
    if (!receipt) return;
    try {
      for (const line of receipt.lines) {
        await request('/customer/cart/lines', {
          method: 'POST',
          body: JSON.stringify({
            vendor_location_id: line.vendor_location_id,
            catalogue_variant_id: line.catalogue_variant_id,
            quantity: line.quantity,
            fulfilment_method: 'CUSTOMER_PICKUP',
            substitution_preference: 'ASK_CUSTOMER',
          }),
        });
      }
      setMessage(
        'Current catalogue versions were added to the cart; refresh the basket to resolve changes.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Reorder needs attention.');
    }
  }
  async function rate(id: string) {
    try {
      await request(`/customer/orders/${id}/rating`, {
        method: 'POST',
        body: JSON.stringify({ stars: 5, review_note: 'SYNTH Company-test rating' }),
      });
      setMessage('Rating recorded once.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Rating failed.');
    }
  }
  async function support(id: string) {
    try {
      await request(`/customer/orders/${id}/support`, {
        method: 'POST',
        body: JSON.stringify({
          category: 'ORDER_HELP',
          description: 'SYNTH Customer requested help from order history.',
        }),
      });
      setMessage('Support case opened and routed to the admin queue.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Support request failed.');
    }
  }
  return (
    <section className="marketplace-panel" aria-labelledby="orders-title">
      <header className="market-heading">
        <div>
          <p className="step-label">After checkout</p>
          <h2 id="orders-title">Orders, receipts and help.</h2>
        </div>
        <button className="secondary" onClick={() => void load()}>
          Load order history
        </button>
      </header>
      <p className="market-status" aria-live="polite">
        {message}
      </p>
      <div className="store-rail">
        {groups
          .flatMap((g) => g.vendor_orders)
          .map((o) => (
            <article key={o.vendor_order_id}>
              <small>{o.lifecycle_state.replaceAll('_', ' ')}</small>
              <h3>{o.order_reference}</h3>
              <p>₹{(o.total_minor / 100).toFixed(2)}</p>
              <div>
                <button onClick={() => void open(o.vendor_order_id)}>Receipt</button>
                <button className="secondary" onClick={() => void rate(o.vendor_order_id)}>
                  Rate 5★
                </button>
                <button className="secondary" onClick={() => void support(o.vendor_order_id)}>
                  Get help
                </button>
              </div>
            </article>
          ))}
      </div>
      {receipt && (
        <section className="storefront">
          <header>
            <div>
              <p className="step-label">Immutable receipt</p>
              <h3>{receipt.order.order_reference}</h3>
            </div>
            <button onClick={() => void reorder()}>Order again</button>
          </header>
          {receipt.lines.map((l) => (
            <div className="catalogue-flag" key={l.catalogue_variant_id}>
              <strong>{l.title}</strong>
              <span>
                {l.quantity} × ₹{(l.unit_price_minor / 100).toFixed(2)} = ₹
                {(l.line_total_minor / 100).toFixed(2)}
              </span>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
