'use client';

import { useEffect, useState, type FormEvent } from 'react';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
type Address = {
  customer_address_id: string;
  label: string;
  pin_code: string;
  landmark: string | null;
  is_selected: boolean;
};
type Store = {
  vendor_location_id: string;
  location_name: string;
  category: string;
  distance_meters: number;
  minimum_order_minor: number;
  fulfilment_modes: string[];
  is_open_now: boolean;
};
type Product = {
  catalogue_product_id: string;
  catalogue_variant_id: string;
  title: string;
  category: string;
  unit_label: string;
  variable_weight: boolean;
  price_minor: number | null;
  availability_state: string | null;
  is_stale: boolean;
  substitution_available: boolean;
};
type Storefront = Store & { profile_description: string | null; products: Product[] };
type Cart = {
  cart_id: string;
  groups: {
    cart_vendor_group_id: string;
    vendor_location_id: string;
    fulfilment_method: string;
    version: number;
    lines: { cart_line_id: string; quantity: number; lifecycle_state: string; version: number }[];
  }[];
};

export function MarketplacePanel() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [stores, setStores] = useState<Store[]>([]);
  const [storefront, setStorefront] = useState<Storefront | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [query, setQuery] = useState('tamatar');
  const [message, setMessage] = useState('Sign in, then load your Jaipur test market.');
  const [busy, setBusy] = useState(false);

  async function request(path: string, init?: RequestInit) {
    const token = sessionStorage.getItem('neighbourhood.customer.access-token');
    if (!token) throw new Error('Sign in before opening the market.');
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(problem?.message ?? `Request failed (${response.status}).`);
    }
    return response.status === 204 ? null : response.json();
  }

  async function loadAddresses() {
    setBusy(true);
    try {
      const body = (await request('/customer/addresses')) as { addresses: Address[] };
      setAddresses(body.addresses);
      const selected = body.addresses.find((address) => address.is_selected) ?? body.addresses[0];
      setSelectedAddress(selected?.customer_address_id ?? '');
      setMessage(
        selected ? `Delivering near ${selected.label}. Find a store next.` : 'Add a test address.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Addresses could not be loaded.');
    } finally {
      setBusy(false);
    }
  }

  async function addAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const created = (await request('/customer/addresses', {
        method: 'POST',
        body: JSON.stringify({
          address_reference: `SYNTH-ADDRESS-PWA-${Date.now().toString(36).toUpperCase()}`,
          label: `SYNTH ${String(data.get('label') ?? 'Home')}`,
          pin_code: String(data.get('pin_code') ?? '302020'),
          latitude: 26.8505,
          longitude: 75.7628,
          coordinate_source: 'MANUAL_PIN',
          landmark: 'SYNTH Mansarovar sector',
          delivery_instructions: 'SYNTH Ring the test bell',
        }),
      })) as Address;
      await request(`/customer/addresses/${created.customer_address_id}/select`, {
        method: 'POST',
      });
      await loadAddresses();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Address could not be saved.');
      setBusy(false);
    }
  }

  async function discover(term?: string) {
    if (!selectedAddress) return setMessage('Select an address first.');
    setBusy(true);
    try {
      if (term) {
        const body = (await request(
          `/customer/discovery/search?customer_address_id=${selectedAddress}&term=${encodeURIComponent(term)}`,
        )) as { results: { vendor_location_id: string }[] };
        const ids = new Set(body.results.map((item) => item.vendor_location_id));
        const all = (await request(
          `/customer/discovery/stores?customer_address_id=${selectedAddress}`,
        )) as { stores: Store[] };
        setStores(all.stores.filter((store) => ids.has(store.vendor_location_id)));
        setMessage(
          body.results.length
            ? `${body.results.length} matching products found.`
            : 'No matches. Try tomato, potato, onion or a store name.',
        );
      } else {
        const body = (await request(
          `/customer/discovery/stores?customer_address_id=${selectedAddress}`,
        )) as { stores: Store[] };
        setStores(body.stores);
        setMessage(
          body.stores.length
            ? `${body.stores.length} nearby stores can serve this address.`
            : 'No store serves this test address yet.',
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The market could not be loaded.');
    } finally {
      setBusy(false);
    }
  }

  async function openStore(store: Store) {
    setBusy(true);
    try {
      const detail = (await request(
        `/customer/discovery/stores/${store.vendor_location_id}`,
      )) as Storefront;
      setStorefront({ ...store, ...detail });
      setMessage(`${detail.location_name} opened. Products never mix with another store here.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Store could not be opened.');
    } finally {
      setBusy(false);
    }
  }

  async function preference(storeId: string, kind: 'favourites' | 'preferred-store') {
    try {
      await request(`/customer/discovery/${kind}/${storeId}`, { method: 'POST' });
      setMessage(kind === 'favourites' ? 'Store saved to favourites.' : 'Preferred store updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Preference could not be saved.');
    }
  }

  async function addToCart(product: Product) {
    if (!storefront) return;
    setBusy(true);
    try {
      await request('/customer/cart/lines', {
        method: 'POST',
        body: JSON.stringify({
          vendor_location_id: storefront.vendor_location_id,
          catalogue_variant_id: product.catalogue_variant_id,
          quantity: 1,
          fulfilment_method: storefront.fulfilment_modes.includes('PLATFORM_DELIVERY')
            ? 'PLATFORM_DELIVERY'
            : storefront.fulfilment_modes[0],
          substitution_preference: product.substitution_available
            ? 'ASK_CUSTOMER'
            : 'NO_SUBSTITUTION',
        }),
      });
      if (selectedAddress) {
        await request('/customer/cart/address', {
          method: 'PUT',
          body: JSON.stringify({ customer_address_id: selectedAddress }),
        });
      }
      await loadCart();
      setMessage(`${product.title.replace('SYNTH ', '')} added. The store group remains isolated.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Item could not be added.');
      setBusy(false);
    }
  }

  async function loadCart() {
    try {
      const next = (await request('/customer/cart')) as Cart;
      setCart(next);
      return next;
    } finally {
      setBusy(false);
    }
  }

  async function revalidate() {
    setBusy(true);
    try {
      const result = (await request('/customer/cart/revalidate', { method: 'POST' })) as {
        outcomes: { invalidated: boolean }[];
      };
      await loadCart();
      setMessage(
        result.outcomes.some((item) => item.invalidated)
          ? 'Changed items are marked only in their affected store group.'
          : 'Prices, publication, stock, address and store state are current.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cart could not be refreshed.');
      setBusy(false);
    }
  }

  useEffect(() => {
    const onOnline = () =>
      void loadCart().then(() => setMessage('Back online. Cart restored from the server.'));
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  return (
    <section className="marketplace-panel" aria-labelledby="market-title">
      <header className="market-heading">
        <div>
          <p className="step-label">Jaipur market lane</p>
          <h2 id="market-title">From a known shop to your basket.</h2>
        </div>
        <button className="secondary" disabled={busy} onClick={loadAddresses}>
          Open my market
        </button>
      </header>
      <p className="market-status" aria-live="polite">
        {message}
      </p>

      {addresses.length === 0 ? (
        <form className="address-form" onSubmit={addAddress}>
          <label>
            Address label
            <input name="label" defaultValue="Home" required />
          </label>
          <label>
            PIN code
            <input name="pin_code" defaultValue="302020" pattern="[1-9][0-9]{5}" required />
          </label>
          <button disabled={busy}>Save test address</button>
        </form>
      ) : (
        <div className="market-tools">
          <label>
            Deliver to
            <select
              value={selectedAddress}
              onChange={(event) => setSelectedAddress(event.target.value)}
            >
              {addresses.map((address) => (
                <option key={address.customer_address_id} value={address.customer_address_id}>
                  {address.label} · {address.pin_code}
                </option>
              ))}
            </select>
          </label>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void discover(query);
            }}
          >
            <label>
              Find fruit, sabzi or a store
              <input value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <button disabled={busy}>Search</button>
          </form>
          <button className="secondary" disabled={busy} onClick={() => discover()}>
            Browse nearby stores
          </button>
        </div>
      )}

      <div className="store-rail">
        {stores.map((store) => (
          <article key={store.vendor_location_id}>
            <span className={store.is_open_now ? 'open-dot' : 'closed-dot'}>
              {store.is_open_now ? 'Open' : 'Closed'}
            </span>
            <h3>{store.location_name.replace('SYNTH ', '')}</h3>
            <p>
              {store.category.replaceAll('_', ' ')} · {(store.distance_meters / 1000).toFixed(1)} km
            </p>
            <small>
              Minimum ₹{(store.minimum_order_minor / 100).toFixed(0)} ·{' '}
              {store.fulfilment_modes.map((mode) => mode.replaceAll('_', ' ')).join(' / ')}
            </small>
            <div>
              <button onClick={() => openStore(store)}>Shop here</button>
              <button
                className="secondary"
                onClick={() => preference(store.vendor_location_id, 'favourites')}
              >
                Save
              </button>
            </div>
          </article>
        ))}
      </div>

      {storefront && (
        <section className="storefront">
          <header>
            <div>
              <p className="step-label">One-store aisle</p>
              <h3>{storefront.location_name.replace('SYNTH ', '')}</h3>
              <p>
                {storefront.profile_description ??
                  'Fresh local essentials, prepared for this company test.'}
              </p>
            </div>
            <button
              className="secondary"
              onClick={() => preference(storefront.vendor_location_id, 'preferred-store')}
            >
              Make preferred
            </button>
          </header>
          <div className="product-grid">
            {storefront.products.map((product) => (
              <article
                key={product.catalogue_product_id}
                className={product.is_stale ? 'is-stale' : ''}
              >
                <div className="produce-mark" aria-hidden="true">
                  {product.category.slice(0, 2)}
                </div>
                <small>{product.category.replaceAll('_', ' ')}</small>
                <h4>{product.title.replace('SYNTH ', '')}</h4>
                <p>
                  {product.unit_label} ·{' '}
                  {product.variable_weight ? 'Final weight confirmed by store' : 'Fixed quantity'}
                </p>
                <strong>
                  {product.price_minor === null
                    ? 'Price unavailable'
                    : `₹${(product.price_minor / 100).toFixed(2)}`}
                </strong>
                <span>
                  {product.is_stale
                    ? 'Availability needs refresh'
                    : (product.availability_state ?? 'Vendor confirms')}
                </span>
                <button
                  disabled={busy || product.price_minor === null || product.is_stale}
                  onClick={() => addToCart(product)}
                >
                  Add to basket
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {cart && (
        <aside className="basket-dock">
          <div>
            <small>Grouped basket</small>
            <strong>
              {cart.groups.reduce((sum, group) => sum + group.lines.length, 0)} items across{' '}
              {cart.groups.length} stores
            </strong>
          </div>
          <button className="secondary" onClick={revalidate}>
            Refresh basket
          </button>
          <a href="#checkout-title">Go to checkout</a>
        </aside>
      )}
    </section>
  );
}
