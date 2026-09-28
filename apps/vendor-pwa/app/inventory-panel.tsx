'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  actionErrorText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Notice,
  Panel,
  SelectField,
  StatusPill,
  formatMoneyMinor,
  formatRelativeTime,
} from '@neighbourhood-store/ui';
import { vendorRequest } from './authenticated-api';
import { displayName } from './display';

/**
 * Stock, availability and holds (VEN-19, VEN-20).
 *
 * The important thing this screen has to get right is which lines a customer
 * can actually buy. `inventory_items` is keyed by `(location, product
 * reference)` with no foreign key to the catalogue, and the checkout quote
 * joins the two on that pair with an inner join — so a stock line whose
 * reference matches no catalogue product is unsellable, silently. The old
 * screen let a vendor type any reference into a free-text box and then
 * displayed the result identically to a real one, which is the most expensive
 * kind of wrong: the shopkeeper believes they are selling something they are
 * not.
 *
 * Stock is now started from a catalogue product, and any line that cannot be
 * sold says so and says why.
 */
type StockLine = {
  readonly inventory_item_id: string;
  readonly product_reference: string;
  readonly display_name: string;
  readonly quantity_basis: 'COUNTED' | 'VENDOR_CONFIRMS';
  readonly availability_state: string;
  readonly exact_available_quantity: number | null;
  readonly low_stock_threshold: number | null;
  readonly last_confirmed_at: string;
  readonly version: number;
  readonly catalogue_product_id: string | null;
  readonly catalogue_title: string | null;
  readonly catalogue_lifecycle_state: string | null;
  readonly unit_label: string | null;
  readonly price_minor: number | null;
  readonly held_quantity: number;
};

type Hold = {
  readonly reservation_id: string;
  readonly reservation_state: string;
  readonly quantity: number;
  readonly expires_at: string;
};

/**
 * `GET catalogue/products` returns the row array directly rather than wrapping
 * it, so the shape has to be handled rather than assumed — reading `.products`
 * off a bare array yields undefined and takes the whole panel down.
 */
function productList(response: unknown): readonly CatalogueProduct[] {
  if (Array.isArray(response)) return response as readonly CatalogueProduct[];
  const wrapped = response as { readonly products?: readonly CatalogueProduct[] } | null;
  return wrapped?.products ?? [];
}

type CatalogueProduct = {
  readonly catalogue_product_id: string;
  readonly product_reference: string;
  readonly title: string;
  readonly unit_label: string;
  readonly lifecycle_state: string;
};

/**
 * Every condition the checkout quote's inner joins impose, stated in the
 * vendor's language rather than the query's.
 */
function blockingReason(line: StockLine): string | null {
  if (!line.catalogue_product_id)
    return `Nothing in your catalogue uses the reference ${line.product_reference}, so this never reaches a customer. Add the product in Catalogue, or remove this line.`;
  if (line.catalogue_lifecycle_state !== 'ACTIVE')
    return 'The catalogue product is not live yet, so customers cannot see this.';
  if (line.price_minor === null) return 'This has no price, so it cannot be added to a basket.';
  return null;
}

export function InventoryPanel({ vendorLocationId }: { readonly vendorLocationId: string }) {
  const [lines, setLines] = useState<readonly StockLine[]>([]);
  const [products, setProducts] = useState<readonly CatalogueProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [newProductReference, setNewProductReference] = useState('');
  const [newQuantity, setNewQuantity] = useState('10');
  const [newThreshold, setNewThreshold] = useState('2');
  const [newBasis, setNewBasis] = useState<'COUNTED' | 'VENDOR_CONFIRMS'>('COUNTED');
  const [holds, setHolds] = useState<Record<string, readonly Hold[]>>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    if (!vendorLocationId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [stock, catalogue] = await Promise.all([
        vendorRequest<{ items: readonly StockLine[] }>(
          `vendor/locations/${vendorLocationId}/inventory`,
        ),
        vendorRequest<unknown>(`vendor/locations/${vendorLocationId}/catalogue/products`),
      ]);
      setLines(stock.items);
      setProducts(productList(catalogue));
    } catch (error) {
      setLoadError(actionErrorText(error, 'Stock failed to load.'));
    } finally {
      setLoading(false);
    }
  }, [vendorLocationId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Catalogue products with no stock line yet — the only valid things to add. */
  const untracked = useMemo(() => {
    const tracked = new Set(lines.map((line) => line.product_reference));
    return products.filter((product) => !tracked.has(product.product_reference));
  }, [lines, products]);

  useEffect(() => {
    if (untracked.length > 0 && !untracked.some((p) => p.product_reference === newProductReference))
      setNewProductReference(untracked[0]?.product_reference ?? '');
  }, [untracked, newProductReference]);

  async function run(key: string, work: () => Promise<void>, success: string) {
    setPending(key);
    setNotice(null);
    try {
      await work();
      await load();
      setNotice({ tone: 'success', text: success });
    } catch (error) {
      // A version conflict means someone else — a colleague, or a customer's
      // checkout taking a hold — moved this line first. Reloading is the
      // recovery, so do it rather than leaving a stale number on screen.
      await load();
      setNotice({
        tone: 'danger',
        text: actionErrorText(error, 'That change did not save.'),
      });
    } finally {
      setPending(null);
    }
  }

  async function startTracking() {
    const product = untracked.find((item) => item.product_reference === newProductReference);
    if (!product) {
      setNotice({ tone: 'danger', text: 'Choose a product from your catalogue first.' });
      return;
    }
    await run(
      'create',
      async () => {
        await vendorRequest(`vendor/locations/${vendorLocationId}/inventory`, {
          method: 'POST',
          body: JSON.stringify({
            display_name: product.title,
            product_reference: product.product_reference,
            quantity_basis: newBasis,
            reason_code: 'VENDOR_STOCK_ADDED',
            ...(newBasis === 'COUNTED'
              ? {
                  exact_available_quantity: Number(newQuantity) || 0,
                  low_stock_threshold: Number(newThreshold) || 0,
                }
              : {}),
          }),
        });
      },
      `Now tracking stock for ${displayName(product.title)}.`,
    );
  }

  /**
   * Which orders are holding this stock, and until when.
   *
   * The count sits on the row because it is the number that explains "8 on
   * hand but only 6 buyable"; the detail is on demand because a soft hold
   * expires on its own and rarely needs acting on.
   */
  async function toggleHolds(line: StockLine) {
    if (holds[line.inventory_item_id]) {
      setHolds((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) => key !== line.inventory_item_id),
        ),
      );
      return;
    }
    setPending(line.inventory_item_id);
    try {
      const result = await vendorRequest<{ reservations: readonly Hold[] }>(
        `vendor/locations/${vendorLocationId}/inventory/${line.inventory_item_id}/reservations`,
      );
      setHolds((current) => ({ ...current, [line.inventory_item_id]: result.reservations }));
    } catch (error) {
      setNotice({
        tone: 'danger',
        text: actionErrorText(error, 'The holds could not be loaded.'),
      });
    } finally {
      setPending(null);
    }
  }

  async function setStock(line: StockLine, next: number) {
    await run(
      line.inventory_item_id,
      async () => {
        await vendorRequest(
          `vendor/locations/${vendorLocationId}/inventory/${line.inventory_item_id}/stock`,
          {
            method: 'PUT',
            body: JSON.stringify({
              exact_available_quantity: Math.max(0, next),
              // The real version, not a fabricated 1: optimistic concurrency
              // only protects anything if the number came from the server.
              expected_version: line.version,
              low_stock_threshold: line.low_stock_threshold ?? 0,
              reason_code: 'VENDOR_STOCK_COUNTED',
            }),
          },
        );
      },
      'Stock updated.',
    );
  }

  async function confirmAvailability(line: StockLine) {
    await run(
      line.inventory_item_id,
      async () => {
        await vendorRequest(
          `vendor/locations/${vendorLocationId}/inventory/${line.inventory_item_id}/confirm`,
          {
            method: 'POST',
            body: JSON.stringify({
              expected_version: line.version,
              reason_code: 'VENDOR_AVAILABILITY_CONFIRMED',
            }),
          },
        );
      },
      'Confirmed. Customers see this as freshly checked.',
    );
  }

  const unsellable = lines.filter((line) => blockingReason(line) !== null).length;

  return (
    <Panel
      description={
        lines.length === 0
          ? 'Nothing tracked yet.'
          : `${lines.length} tracked${unsellable > 0 ? ` · ${unsellable} customers cannot buy` : ''}`
      }
      eyebrow="Stock"
      id="inventory-panel"
      title="What you actually have"
    >
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {loading && <LoadingState label="Loading your stock…" />}
      {loadError && !loading && (
        <ErrorState description={loadError} onRetry={() => void load()} title="Cannot show stock" />
      )}

      {!loading && !loadError && (
        <Card className="stock-add">
          <h3>Start tracking a product</h3>
          {untracked.length === 0 ? (
            <p className="stock-add__hint">
              Every product in your catalogue already has a stock line. Add a product in Catalogue
              first.
            </p>
          ) : (
            <>
              <p className="stock-add__hint">
                Stock belongs to a product you already sell — that link is what lets a customer buy
                it.
              </p>
              <SelectField
                label="Product"
                onChange={(event) => setNewProductReference(event.target.value)}
                value={newProductReference}
              >
                {untracked.map((product) => (
                  <option key={product.catalogue_product_id} value={product.product_reference}>
                    {displayName(product.title)}
                  </option>
                ))}
              </SelectField>
              <SelectField
                hint={
                  newBasis === 'COUNTED'
                    ? 'You keep a count, and it goes down as customers buy.'
                    : 'No count. You confirm it is available when you pick the order.'
                }
                label="How you track it"
                onChange={(event) =>
                  setNewBasis(event.target.value as 'COUNTED' | 'VENDOR_CONFIRMS')
                }
                value={newBasis}
              >
                <option value="COUNTED">Counted</option>
                <option value="VENDOR_CONFIRMS">Confirmed when picking</option>
              </SelectField>
              {newBasis === 'COUNTED' && (
                <div className="stock-add__counts">
                  <Field
                    inputMode="numeric"
                    label="How many now"
                    min={0}
                    onChange={(event) => setNewQuantity(event.target.value)}
                    type="number"
                    value={newQuantity}
                  />
                  <Field
                    hint="Below this you get a low-stock warning."
                    inputMode="numeric"
                    label="Warn me at"
                    min={0}
                    onChange={(event) => setNewThreshold(event.target.value)}
                    type="number"
                    value={newThreshold}
                  />
                </div>
              )}
              <Button
                disabled={pending !== null}
                onClick={() => void startTracking()}
                variant="primary"
              >
                Start tracking
              </Button>
            </>
          )}
        </Card>
      )}

      {!loading && !loadError && lines.length === 0 && (
        <EmptyState
          description="Once you track stock, customers stop ordering things you have run out of."
          title="No stock recorded yet"
        />
      )}

      <div className="stock-list">
        {!loading &&
          !loadError &&
          lines.map((line) => {
            const blocked = blockingReason(line);
            const counted = line.quantity_basis === 'COUNTED';
            const onHand = line.exact_available_quantity ?? 0;
            const busy = pending === line.inventory_item_id;
            return (
              <Card
                className={blocked ? 'stock-row stock-row--blocked' : 'stock-row'}
                key={line.inventory_item_id}
              >
                <div className="stock-row__identity">
                  <h3>{displayName(line.catalogue_title ?? line.display_name)}</h3>
                  <p className="stock-row__meta">
                    {line.price_minor !== null && <span>{formatMoneyMinor(line.price_minor)}</span>}
                    {line.unit_label && <span>per {line.unit_label}</span>}
                  </p>
                </div>

                <div className="stock-row__state">
                  <StatusPill state={line.availability_state} />
                  {counted ? (
                    <span>
                      {onHand} on hand
                      {line.held_quantity > 0 ? ` · ${line.held_quantity} held for orders` : ''}
                    </span>
                  ) : (
                    <span>
                      Confirmed when picking · last checked{' '}
                      {formatRelativeTime(line.last_confirmed_at, now)}
                    </span>
                  )}
                </div>

                {blocked && <Notice tone="warning">{blocked}</Notice>}

                <div className="stock-row__actions">
                  {counted ? (
                    <>
                      <Button
                        disabled={busy}
                        onClick={() => void setStock(line, onHand + 1)}
                        size="small"
                        variant="secondary"
                      >
                        Add one
                      </Button>
                      <Button
                        disabled={busy || onHand === 0}
                        onClick={() => void setStock(line, onHand - 1)}
                        size="small"
                        variant="secondary"
                      >
                        Remove one
                      </Button>
                      <Button
                        disabled={busy || onHand === 0}
                        onClick={() => void setStock(line, 0)}
                        size="small"
                        variant="danger"
                      >
                        Sold out
                      </Button>
                    </>
                  ) : (
                    <Button
                      disabled={busy}
                      onClick={() => void confirmAvailability(line)}
                      size="small"
                      variant="secondary"
                    >
                      Still available
                    </Button>
                  )}
                  {line.held_quantity > 0 && (
                    <Button
                      disabled={busy}
                      onClick={() => void toggleHolds(line)}
                      size="small"
                      variant="ghost"
                    >
                      {holds[line.inventory_item_id] ? 'Hide holds' : 'What is held?'}
                    </Button>
                  )}
                </div>

                {holds[line.inventory_item_id] && (
                  <ul className="stock-row__holds">
                    {(holds[line.inventory_item_id] ?? []).length === 0 && (
                      <li>Nothing is held right now.</li>
                    )}
                    {(holds[line.inventory_item_id] ?? []).map((hold) => (
                      <li key={hold.reservation_id}>
                        <StatusPill state={hold.reservation_state} />
                        <span>
                          {hold.quantity} held · releases {formatRelativeTime(hold.expires_at, now)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
      </div>
    </Panel>
  );
}
