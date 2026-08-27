'use client';
import { useState } from 'react';

type Quote = {
  checkout_quote_id: string;
  expires_at: string;
  total_minor: number;
  authorization_buffer_minor: number;
  blocked_groups: readonly {
    vendor_location_id: string;
    reason_code: string;
  }[];
  groups: readonly {
    vendor_location_id: string;
    item_minor: number;
    delivery_minor: number;
    tip_minor: number;
    total_minor: number;
    fulfilment_method: string;
    promise: string;
    decision_rule: string;
  }[];
};
type Checkout = {
  checkout_group_id: string;
  lifecycle_state: string;
  total_minor: number;
  orders: readonly {
    vendor_order_id: string;
    vendor_location_id: string;
    lifecycle_state: string;
    total_minor: number;
  }[];
};
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
export function CheckoutPanel() {
  const [cartId, setCartId] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [result, setResult] = useState<Checkout | null>(null);
  const [state, setState] = useState('Load a validated cart to create a five-minute local quote.');
  const [busy, setBusy] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'CARD' | 'WALLET'>('UPI');
  async function call(path: string, body: unknown) {
    const token = sessionStorage.getItem('neighbourhood.customer.access-token');
    if (!token) throw new Error('Sign in before checkout.');
    const response = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(
        response.status === 409
          ? 'The cart, price, stock, address, or payment state changed. Refresh the cart and quote again.'
          : 'Checkout could not continue.',
      );
    return response.json();
  }
  async function loadCart() {
    setBusy(true);
    try {
      const token = sessionStorage.getItem('neighbourhood.customer.access-token');
      if (!token) throw new Error('Sign in before checkout.');
      const response = await fetch(`${apiUrl}/customer/cart`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('The active cart could not be loaded.');
      const cart = (await response.json()) as { cart_id: string };
      setCartId(cart.cart_id);
      setState('Active cart loaded. Create a quote when you are ready.');
    } catch (error) {
      setState(error instanceof Error ? error.message : 'Cart load failed.');
    } finally {
      setBusy(false);
    }
  }
  async function createQuote() {
    setBusy(true);
    try {
      const next = (await call('/customer/checkout/quotes', { cart_id: cartId })) as Quote;
      setQuote(next);
      setResult(null);
      setState(`Quote held until ${new Date(next.expires_at).toLocaleTimeString()}.`);
    } catch (error) {
      setState(error instanceof Error ? error.message : 'Quote failed.');
    } finally {
      setBusy(false);
    }
  }
  async function place(scenario: 'SUCCESS' | 'DECLINE' | 'UNKNOWN') {
    if (!quote) return;
    setBusy(true);
    try {
      const next = (await call('/customer/checkout/groups', {
        checkout_quote_id: quote.checkout_quote_id,
        provider_scenario: scenario,
        idempotency_key: `pwa-${quote.checkout_quote_id}`,
        payment_method: paymentMethod,
      })) as Checkout;
      setResult(next);
      setState(
        next.lifecycle_state === 'PAYMENT_UNKNOWN'
          ? 'Payment result is unknown. Do not pay again; this same checkout will reconcile.'
          : 'Checkout placed once. Each store has its own order.',
      );
    } catch (error) {
      setState(error instanceof Error ? error.message : 'Checkout failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="checkout-panel" aria-labelledby="checkout-title">
      <div className="checkout-heading">
        <div>
          <p className="step-label">Grouped checkout · local synthetic</p>
          <h2 id="checkout-title">One payment. Clear store-by-store promises.</h2>
        </div>
        {quote && <strong>₹{(quote.total_minor / 100).toFixed(2)}</strong>}
      </div>
      <button className="secondary" disabled={busy} onClick={loadCart}>
        Load my active cart
      </button>
      {cartId && <small className="checkout-reference">Cart {cartId.slice(0, 8)}</small>}
      <button disabled={busy || !cartId} onClick={createQuote}>
        Quote and hold stock
      </button>
      <p aria-live="polite">{state}</p>
      {quote && (
        <div className="quote-groups">
          {quote.groups.map((group) => (
            <article key={group.vendor_location_id}>
              <span>{group.vendor_location_id.slice(0, 8)}</span>
              <small>
                {group.fulfilment_method.replaceAll('_', ' ')} · {group.promise}
              </small>
              <small>
                Items ₹{(group.item_minor / 100).toFixed(2)} · Delivery ₹
                {(group.delivery_minor / 100).toFixed(2)} · Tip ₹
                {(group.tip_minor / 100).toFixed(2)}
              </small>
              <strong>₹{(group.total_minor / 100).toFixed(2)}</strong>
              <small>{group.decision_rule}</small>
            </article>
          ))}
        </div>
      )}
      {quote && quote.blocked_groups.length > 0 && (
        <div className="blocked-groups" role="status">
          <strong>{quote.blocked_groups.length} store group blocked</strong>
          {quote.blocked_groups.map((group) => (
            <small key={group.vendor_location_id}>
              {group.vendor_location_id.slice(0, 8)} · {group.reason_code.replaceAll('_', ' ')}
            </small>
          ))}
        </div>
      )}
      {quote && !result && (
        <div className="checkout-actions">
          <fieldset className="payment-methods">
            <legend>Prepaid method</legend>
            {(['UPI', 'CARD', 'WALLET'] as const).map((method) => (
              <label key={method}>
                <input
                  type="radio"
                  name="payment-method"
                  checked={paymentMethod === method}
                  onChange={() => setPaymentMethod(method)}
                />
                {method}
              </label>
            ))}
            <small>Cash on delivery is unavailable.</small>
          </fieldset>
          <p>
            Authorization buffer ₹{(quote.authorization_buffer_minor / 100).toFixed(2)} · You
            authorize exactly ₹{(quote.total_minor / 100).toFixed(2)} in this local test.
          </p>
          <button disabled={busy} onClick={() => place('SUCCESS')}>
            Pay and place test order
          </button>
          <button className="secondary" disabled={busy} onClick={() => place('UNKNOWN')}>
            Test unknown result
          </button>
          <button className="secondary" disabled={busy} onClick={() => place('DECLINE')}>
            Test decline
          </button>
        </div>
      )}
      {result && (
        <div className={`checkout-result ${result.lifecycle_state.toLowerCase()}`}>
          <strong>{result.lifecycle_state.replaceAll('_', ' ')}</strong>
          <span>{result.orders.length} store orders</span>
          {result.orders.map((order) => (
            <small key={order.vendor_order_id}>
              {order.vendor_location_id.slice(0, 8)} · {order.lifecycle_state} · ₹
              {(order.total_minor / 100).toFixed(2)}
            </small>
          ))}
        </div>
      )}
    </section>
  );
}
