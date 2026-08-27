'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { OrdersPanel } from './orders-panel';

type Filter = 'All' | 'Counted' | 'Vendor confirms' | 'Needs attention';
type Item = {
  id: string;
  name: string;
  reference: string;
  basis: 'COUNTED' | 'VENDOR_CONFIRMS';
  available: number | null;
  held: number;
  provisional: number;
  committed: number;
  confirmed: string;
  threshold: number | null;
};
type RemoteProduct = {
  readonly catalogue_product_id: string;
  readonly category: string;
  readonly images: readonly {
    readonly catalogue_image_id: string;
    readonly object_reference: string;
  }[];
  readonly lifecycle_state: 'ACTIVE' | 'INACTIVE';
  readonly product_reference: string;
  readonly tax_basis: string;
  readonly title: string;
  readonly unit_label: string;
  readonly variable_weight: boolean;
  readonly variants: readonly {
    readonly catalogue_variant_id: string;
    readonly lifecycle_state: 'ACTIVE' | 'INACTIVE';
    readonly price_minor: number | null;
    readonly sku: string;
    readonly title: string;
  }[];
  readonly version: number;
};
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

const seedItems: readonly [Item, ...Item[]] = [
  {
    id: 'tomato',
    name: 'SYNTH Jaipur Tomato',
    reference: 'SYNTH-PROD-TOMATO-0001',
    basis: 'COUNTED',
    available: 18,
    held: 4,
    provisional: 3,
    committed: 6,
    confirmed: '8 min ago',
    threshold: 8,
  },
  {
    id: 'potato',
    name: 'SYNTH New Potato',
    reference: 'SYNTH-PROD-POTATO-0002',
    basis: 'COUNTED',
    available: 5,
    held: 2,
    provisional: 0,
    committed: 9,
    confirmed: '21 min ago',
    threshold: 6,
  },
  {
    id: 'coriander',
    name: 'SYNTH Seasonal Coriander',
    reference: 'SYNTH-PROD-CORIANDER-0001',
    basis: 'VENDOR_CONFIRMS',
    available: null,
    held: 2,
    provisional: 1,
    committed: 0,
    confirmed: '46 min ago',
    threshold: null,
  },
] as const;

const filters: readonly Filter[] = ['All', 'Counted', 'Vendor confirms', 'Needs attention'];

export default function VendorHome() {
  const [activeFilter, setActiveFilter] = useState<Filter>('All');
  const [selectedId, setSelectedId] = useState(seedItems[0].id);
  const [confirmedIds, setConfirmedIds] = useState<ReadonlySet<string>>(new Set());
  const [catalogueState, setCatalogueState] = useState<Record<string, 'ACTIVE' | 'INACTIVE'>>({
    tomato: 'ACTIVE',
    potato: 'ACTIVE',
    coriander: 'ACTIVE',
  });
  const [variableWeight, setVariableWeight] = useState(false);
  const [imageAttached, setImageAttached] = useState(false);
  const [substitutionEnabled, setSubstitutionEnabled] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [vendorLocationId, setVendorLocationId] = useState('');
  const [remoteProducts, setRemoteProducts] = useState<readonly RemoteProduct[]>([]);
  const [selectedRemoteId, setSelectedRemoteId] = useState<string | null>(null);
  const [connectionMessage, setConnectionMessage] = useState(
    'Connect a local vendor session to persist catalogue changes.',
  );
  const [csvContent, setCsvContent] = useState('');
  const [stagedImportId, setStagedImportId] = useState<string | null>(null);
  const selectedRemote =
    remoteProducts.find((product) => product.catalogue_product_id === selectedRemoteId) ?? null;

  useEffect(() => {
    setAccessToken(window.sessionStorage.getItem('neighbourhood.vendor.access-token') ?? '');
    setVendorLocationId(window.sessionStorage.getItem('neighbourhood.vendor.location-id') ?? '');
  }, []);

  async function vendorFetch(path: string, init?: RequestInit) {
    if (!accessToken || !vendorLocationId)
      throw new Error('Paste the local access token and location ID first.');
    const response = await fetch(
      `${apiUrl}/vendor/locations/${vendorLocationId}/catalogue${path}`,
      {
        ...init,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(init?.body ? { 'content-type': 'application/json' } : {}),
          ...init?.headers,
        },
      },
    );
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'This local session cannot manage this store.'
          : 'The catalogue request could not be completed.',
      );
    return response.json() as Promise<unknown>;
  }

  async function loadRemoteProducts() {
    try {
      const payload = (await vendorFetch('/products')) as
        readonly RemoteProduct[] | { readonly data: readonly RemoteProduct[] };
      const data = 'data' in payload ? payload.data : payload;
      setRemoteProducts(data);
      setSelectedRemoteId(data[0]?.catalogue_product_id ?? null);
      setConnectionMessage(
        data.length
          ? 'Connected to the local server catalogue.'
          : 'Connected. Create the first synthetic product below.',
      );
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : 'Catalogue connection failed.');
    }
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    window.sessionStorage.setItem('neighbourhood.vendor.access-token', accessToken);
    window.sessionStorage.setItem('neighbourhood.vendor.location-id', vendorLocationId);
    await loadRemoteProducts();
  }

  async function createRemoteProduct() {
    try {
      await vendorFetch('/products', {
        method: 'POST',
        body: JSON.stringify({
          product_reference: `SYNTH-PROD-LOCAL-${Date.now().toString(36).toUpperCase()}`,
          title: 'SYNTH Local Test Tomato',
          category: 'VEGETABLES',
          unit_label: 'KG',
          tax_basis: 'INCLUSIVE',
          variable_weight: true,
          permitted_weight_variance_bps: 500,
          sku: `SYNTH-SKU-LOCAL-${Date.now().toString(36).toUpperCase()}`,
          variant_title: 'SYNTH Local Test Tomato',
          price_minor: 4800,
        }),
      });
      await loadRemoteProducts();
      setConnectionMessage('Synthetic product created on the local server.');
    } catch (error) {
      setConnectionMessage(
        error instanceof Error ? error.message : 'Product could not be created.',
      );
    }
  }

  async function toggleRemoteLifecycle() {
    if (!selectedRemote) return;
    try {
      await vendorFetch(
        `/products/${selectedRemote.catalogue_product_id}/${selectedRemote.lifecycle_state === 'ACTIVE' ? 'deactivate' : 'activate'}`,
        { method: 'POST', body: JSON.stringify({ expected_version: selectedRemote.version }) },
      );
      await loadRemoteProducts();
    } catch (error) {
      setConnectionMessage(
        error instanceof Error ? error.message : 'Listing state could not be changed.',
      );
    }
  }

  async function attachRemoteImage() {
    if (!selectedRemote) return;
    try {
      await vendorFetch(`/products/${selectedRemote.catalogue_product_id}/images`, {
        method: 'POST',
        body: JSON.stringify({
          object_reference: `SYNTH-OBJECT-LOCAL-${Date.now().toString(36).toUpperCase()}`,
          alt_text: `SYNTH ${selectedRemote.title.replace(/^SYNTH\s+/, '')}`,
          position: selectedRemote.images.length + 1,
        }),
      });
      await loadRemoteProducts();
      setConnectionMessage('Synthetic image reference persisted on the local server.');
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : 'Image could not be saved.');
    }
  }

  async function enableRemoteSubstitution() {
    const source = selectedRemote?.variants[0];
    const replacement = remoteProducts
      .flatMap((product) => product.variants)
      .find((variant) => variant.catalogue_variant_id !== source?.catalogue_variant_id);
    if (!source || !replacement) {
      setConnectionMessage('Create at least two server variants before setting a substitution.');
      return;
    }
    try {
      await vendorFetch(`/variants/${source.catalogue_variant_id}/substitutions`, {
        method: 'POST',
        body: JSON.stringify({
          replacement_variant_id: replacement.catalogue_variant_id,
          reason: 'SYNTH Local replacement preference',
          active: true,
        }),
      });
      setConnectionMessage('Server substitution preference saved.');
    } catch (error) {
      setConnectionMessage(
        error instanceof Error ? error.message : 'Substitution could not be saved.',
      );
    }
  }

  async function updateRemoteProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRemote) return;
    const data = new FormData(event.currentTarget);
    try {
      await vendorFetch(`/products/${selectedRemote.catalogue_product_id}`, {
        method: 'PUT',
        body: JSON.stringify({
          expected_version: selectedRemote.version,
          title: data.get('title'),
          category: data.get('category'),
          unit_label: data.get('unit_label'),
          tax_basis: data.get('tax_basis'),
          variable_weight: data.get('variable_weight') === 'on',
          permitted_weight_variance_bps:
            data.get('variable_weight') === 'on' ? Number(data.get('variance_bps')) : null,
        }),
      });
      await loadRemoteProducts();
      setConnectionMessage('Server product edit saved.');
    } catch (error) {
      setConnectionMessage(
        error instanceof Error ? error.message : 'Product edit could not be saved.',
      );
    }
  }

  async function stageCsvImport() {
    try {
      const result = (await vendorFetch('/imports', {
        method: 'POST',
        body: JSON.stringify({
          source_filename: 'SYNTH-VENDOR-CATALOGUE.csv',
          csv_content: csvContent,
          idempotency_key: `SYNTH-IMPORT-LOCAL-${Date.now().toString(36).toUpperCase()}`,
        }),
      })) as {
        readonly catalogue_import_id: string;
        readonly invalid_rows: number;
        readonly valid_rows: number;
      };
      setStagedImportId(result.catalogue_import_id);
      setConnectionMessage(
        `Import staged: ${result.valid_rows} valid rows, ${result.invalid_rows} invalid rows.`,
      );
    } catch (error) {
      setConnectionMessage(
        error instanceof Error ? error.message : 'CSV import could not be staged.',
      );
    }
  }

  async function commitCsvImport() {
    if (!stagedImportId) return;
    try {
      await vendorFetch(`/imports/${stagedImportId}/commit`, { method: 'POST' });
      setStagedImportId(null);
      setCsvContent('');
      await loadRemoteProducts();
      setConnectionMessage('CSV import committed to the local catalogue.');
    } catch (error) {
      setConnectionMessage(
        error instanceof Error ? error.message : 'CSV import could not be committed.',
      );
    }
  }
  const items = useMemo(
    () =>
      seedItems.filter((item) => {
        if (activeFilter === 'Counted') return item.basis === 'COUNTED';
        if (activeFilter === 'Vendor confirms') return item.basis === 'VENDOR_CONFIRMS';
        if (activeFilter === 'Needs attention')
          return item.available !== null && item.available <= (item.threshold ?? 0);
        return true;
      }),
    [activeFilter],
  );
  const selected = seedItems.find((item) => item.id === selectedId) ?? seedItems[0];

  return (
    <main className="inventory-shell">
      <header className="inventory-masthead">
        <span className="role-mark" aria-hidden="true">
          NS
        </span>
        <div>
          <p className="eyebrow">Vendor desk · Jaipur company test</p>
          <p className="product-name">Jain Stores Test · 302020</p>
        </div>
        <span className="test-chip">Local · synthetic</span>
      </header>

      <section className="inventory-intro" aria-labelledby="inventory-title">
        <div>
          <p className="kicker">Inventory reservation</p>
          <h1 id="inventory-title">Know what is free, held and promised.</h1>
          <p className="summary">
            Counted stock moves only after the server secures it. Vendor-confirms items stay honest:
            they record customer intent and still wait for a person.
          </p>
        </div>
        <dl className="shift-totals">
          <div>
            <dt>Exact units free</dt>
            <dd>23</dd>
          </div>
          <div>
            <dt>Needs attention</dt>
            <dd>1</dd>
          </div>
        </dl>
      </section>

      <div className="filter-rail" role="group" aria-label="Filter inventory">
        {filters.map((filter) => (
          <button
            aria-pressed={activeFilter === filter}
            key={filter}
            onClick={() => setActiveFilter(filter)}
            type="button"
          >
            {filter}
          </button>
        ))}
      </div>

      <section className="stock-ledger">
        <aside className="item-list" aria-label="Inventory items">
          <div className="list-heading">
            <strong>Stock ledger</strong>
            <span>{items.length} items</span>
          </div>
          {items.map((item) => (
            <button
              aria-current={selected.id === item.id ? 'true' : undefined}
              className="item-row"
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              type="button"
            >
              <span className={`stock-signal ${item.basis.toLowerCase()}`} aria-hidden="true" />
              <span>
                <strong>{item.name}</strong>
                <small>{item.reference}</small>
              </span>
              <span className="quantity-cell">
                <strong>{item.available ?? 'Ask'}</strong>
                <small>{item.available === null ? 'confirm' : 'free'}</small>
              </span>
            </button>
          ))}
          {items.length === 0 && (
            <p className="empty-state">No products match this view. Choose another filter.</p>
          )}
        </aside>

        <article className="reservation-sheet" aria-live="polite">
          <header className="sheet-heading">
            <div>
              <p className="mono-label">{selected.reference}</p>
              <h2>{selected.name}</h2>
              <p>{selected.confirmed}</p>
            </div>
            <span className={`basis-chip ${selected.basis.toLowerCase()}`}>
              {selected.basis === 'COUNTED' ? 'Counted stock' : 'Vendor confirms'}
            </span>
          </header>
          <div className="movement-strip" aria-label="Reservation movement">
            <div className="available-slot">
              <span>Free now</span>
              <strong>{selected.available ?? 'Not counted'}</strong>
            </div>
            <div>
              <span>Soft held</span>
              <strong>{selected.held}</strong>
              <small>Checkout</small>
            </div>
            <div>
              <span>Provisional</span>
              <strong>{selected.provisional}</strong>
              <small>Placed</small>
            </div>
            <div>
              <span>Committed</span>
              <strong>{selected.committed}</strong>
              <small>Accepted</small>
            </div>
          </div>
          <section className="truth-note">
            <span aria-hidden="true">{selected.basis === 'COUNTED' ? '−' : '?'}</span>
            <div>
              <h3>
                {selected.basis === 'COUNTED'
                  ? 'The free count is authoritative.'
                  : 'No exact count is claimed.'}
              </h3>
              <p>
                {selected.basis === 'COUNTED'
                  ? 'Concurrent requests use one locked stock record. Release or expiry restores the same units once.'
                  : 'Checkout records intent only. A vendor must confirm the item before acceptance.'}
              </p>
            </div>
          </section>
          <div className="sheet-actions">
            <div>
              <span>Last confirmation</span>
              <strong>
                {confirmedIds.has(selected.id) ? 'Just now · local test' : selected.confirmed}
              </strong>
            </div>
            <button
              onClick={() => setConfirmedIds((current) => new Set([...current, selected.id]))}
              type="button"
            >
              {selected.basis === 'COUNTED' ? 'Confirm this count' : 'Confirm availability'}
            </button>
          </div>
          <ol className="state-contract" aria-label="Reservation state contract">
            <li>Soft held</li>
            <li>Provisional</li>
            <li>Committed</li>
            <li>Released</li>
          </ol>
          <p className="expiry-note">Soft-held and provisional records expire on server time.</p>
        </article>
      </section>
      <OrdersPanel />
      <section className="catalogue-studio" aria-labelledby="catalogue-title">
        <div className="catalogue-heading">
          <div>
            <p className="kicker">Catalogue management</p>
            <h2 id="catalogue-title">Make every listing sellable.</h2>
            <p>
              Manual controls are wired to the local catalogue contract. They remain synthetic until
              a vendor test session is connected.
            </p>
          </div>
          <span className="test-chip">Draft workspace</span>
        </div>
        <form className="local-access" onSubmit={connect}>
          <label>
            Local vendor access token
            <input
              autoComplete="off"
              onChange={(event) => setAccessToken(event.target.value)}
              placeholder="nsa_…"
              value={accessToken}
            />
          </label>
          <label>
            Vendor location ID
            <input
              autoComplete="off"
              onChange={(event) => setVendorLocationId(event.target.value)}
              placeholder="UUIDv7"
              value={vendorLocationId}
            />
          </label>
          <button type="submit">Connect catalogue</button>
          <span aria-live="polite">{connectionMessage}</span>
        </form>
        <div className="catalogue-grid">
          <div className="catalogue-products" aria-label="Product lifecycle">
            {seedItems.map((item) => (
              <button
                className="catalogue-product"
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                type="button"
              >
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {catalogueState[item.id] === 'ACTIVE'
                      ? 'Visible to customers'
                      : 'Hidden from customers'}
                  </small>
                </span>
                <em
                  className={
                    catalogueState[item.id] === 'ACTIVE' ? 'state-active' : 'state-inactive'
                  }
                >
                  {catalogueState[item.id]}
                </em>
              </button>
            ))}
          </div>
          <form className="catalogue-form" onSubmit={(event) => event.preventDefault()}>
            <label>
              Product name
              <input defaultValue={selected.name} key={selected.id} />
            </label>
            <div className="form-pair">
              <label>
                Unit
                <select defaultValue={selected.basis === 'COUNTED' ? 'KG' : 'BUNCH'}>
                  <option>KG</option>
                  <option>BUNCH</option>
                  <option>PACK</option>
                </select>
              </label>
              <label>
                Tax basis
                <select defaultValue="INCLUSIVE">
                  <option>INCLUSIVE</option>
                  <option>EXCLUSIVE</option>
                  <option>EXEMPT</option>
                </select>
              </label>
            </div>
            <label className="toggle-line">
              <input
                checked={variableWeight}
                onChange={(event) => setVariableWeight(event.target.checked)}
                type="checkbox"
              />{' '}
              Variable-weight product
            </label>
            {variableWeight && (
              <label>
                Permitted variance (bps)
                <input defaultValue="500" inputMode="numeric" />
              </label>
            )}
            <div className="form-actions">
              <button
                onClick={() =>
                  setCatalogueState((current) => ({
                    ...current,
                    [selected.id]: catalogueState[selected.id] === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                  }))
                }
                type="button"
              >
                {catalogueState[selected.id] === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              </button>
              <button className="primary-action" type="submit">
                Save edit
              </button>
            </div>
          </form>
          <aside className="asset-panel">
            <p className="eyebrow">Images & substitutions</p>
            <h3>{selected.name}</h3>
            <button className="asset-action" onClick={() => setImageAttached(true)} type="button">
              {imageAttached ? 'SYNTH image attached' : 'Attach SYNTH image'}
            </button>
            <label className="toggle-line">
              <input
                checked={substitutionEnabled}
                onChange={(event) => setSubstitutionEnabled(event.target.checked)}
                type="checkbox"
              />{' '}
              Allow replacement
            </label>
            {substitutionEnabled && (
              <select aria-label="Replacement product" defaultValue="SYNTH New Potato">
                <option>SYNTH New Potato</option>
                <option>SYNTH Seasonal Coriander</option>
              </select>
            )}
            <small>
              Images require a synthetic object reference; replacements can only come from this
              store.
            </small>
          </aside>
        </div>
        <section className="server-catalogue" aria-label="Authenticated server catalogue">
          <div>
            <p className="eyebrow">Server catalogue</p>
            <strong>{remoteProducts.length} persisted products</strong>
          </div>
          <div className="server-list">
            {remoteProducts.map((product) => (
              <button
                aria-pressed={selectedRemote?.catalogue_product_id === product.catalogue_product_id}
                key={product.catalogue_product_id}
                onClick={() => setSelectedRemoteId(product.catalogue_product_id)}
                type="button"
              >
                <span>
                  {product.title}
                  <small>
                    {product.product_reference} ·{' '}
                    {product.variable_weight ? 'Variable weight' : 'Fixed weight'}
                  </small>
                </span>
                <em>{product.lifecycle_state}</em>
              </button>
            ))}
          </div>
          <div className="server-actions">
            <button onClick={createRemoteProduct} type="button">
              Create test product
            </button>
            <button disabled={!selectedRemote} onClick={toggleRemoteLifecycle} type="button">
              {selectedRemote?.lifecycle_state === 'ACTIVE'
                ? 'Deactivate server listing'
                : 'Activate server listing'}
            </button>
            <button disabled={!selectedRemote} onClick={attachRemoteImage} type="button">
              Attach server image
            </button>
            <button disabled={!selectedRemote} onClick={enableRemoteSubstitution} type="button">
              Allow server substitution
            </button>
          </div>
          {selectedRemote && (
            <form className="server-edit" onSubmit={updateRemoteProduct}>
              <label>
                Server product name
                <input
                  defaultValue={selectedRemote.title}
                  key={`${selectedRemote.catalogue_product_id}-title`}
                  name="title"
                />
              </label>
              <label>
                Category
                <input
                  defaultValue={selectedRemote.category}
                  key={`${selectedRemote.catalogue_product_id}-category`}
                  name="category"
                />
              </label>
              <label>
                Unit
                <input
                  defaultValue={selectedRemote.unit_label}
                  key={`${selectedRemote.catalogue_product_id}-unit`}
                  name="unit_label"
                />
              </label>
              <label>
                Tax basis
                <select defaultValue={selectedRemote.tax_basis} name="tax_basis">
                  <option>INCLUSIVE</option>
                  <option>EXCLUSIVE</option>
                  <option>EXEMPT</option>
                </select>
              </label>
              <label className="toggle-line">
                <input
                  defaultChecked={selectedRemote.variable_weight}
                  name="variable_weight"
                  type="checkbox"
                />{' '}
                Variable weight
              </label>
              <label>
                Variance (bps)
                <input defaultValue="500" inputMode="numeric" name="variance_bps" />
              </label>
              <button type="submit">Save server edit</button>
            </form>
          )}
          <div className="csv-import">
            <p className="eyebrow">CSV import review</p>
            <textarea
              aria-label="Catalogue CSV content"
              onChange={(event) => setCsvContent(event.target.value)}
              placeholder="Paste CATALOGUE_CSV_V1 content here"
              value={csvContent}
            />
            <div className="server-actions">
              <button disabled={!csvContent} onClick={stageCsvImport} type="button">
                Stage CSV review
              </button>
              <button disabled={!stagedImportId} onClick={commitCsvImport} type="button">
                Commit reviewed import
              </button>
            </div>
          </div>
        </section>
      </section>
      <section className="money-strip" aria-label="Synthetic settlement summary">
        <div>
          <span>Eligible in</span>
          <strong>23h 59m</strong>
        </div>
        <div>
          <span>Items after refund</span>
          <strong>₹240.00</strong>
        </div>
        <div>
          <span>Store fee</span>
          <strong>− ₹5.00</strong>
        </div>
        <div>
          <span>Net payable</span>
          <strong>₹235.00</strong>
        </div>
      </section>
      <p className="boundary">
        Company test mode: controls use synthetic inventory only. No production catalogue, order or
        checkout authority is enabled.
      </p>
    </main>
  );
}
