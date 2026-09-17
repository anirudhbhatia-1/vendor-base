'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
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
  parseRupeesToMinor,
} from '@neighbourhood-store/ui';
import { vendorRequest } from './authenticated-api';
import { displayName } from './display';

type RemoteProduct = {
  readonly catalogue_product_id: string;
  readonly category: string;
  readonly lifecycle_state: 'ACTIVE' | 'INACTIVE';
  readonly product_reference: string;
  readonly title: string;
  readonly unit_label: string;
  readonly variable_weight: boolean;
  readonly version: number;
  readonly variants: readonly {
    readonly catalogue_variant_id: string;
    readonly lifecycle_state: 'ACTIVE' | 'INACTIVE';
    readonly price_minor: number | null;
    readonly sku: string;
    readonly title: string;
  }[];
};

function productList(
  response: readonly RemoteProduct[] | { readonly data?: readonly RemoteProduct[] },
): readonly RemoteProduct[] {
  if (Array.isArray(response)) return response as readonly RemoteProduct[];
  return (response as { readonly data?: readonly RemoteProduct[] }).data ?? [];
}

/**
 * The marketplace taxonomy, as choices.
 *
 * Category was a free-text box whose value was upper-cased and sent, so a typo
 * created a category of one product that no customer filter would ever show
 * (ADM-17 makes the taxonomy an administered, versioned thing — a vendor
 * inventing one is not a feature).
 */
const CATEGORIES = [
  ['FRUIT_VEGETABLE', 'Fruit and vegetables'],
  ['KIRANA', 'Kirana and grocery'],
  ['DAIRY', 'Dairy'],
  ['BAKERY', 'Bakery'],
  ['MEAT_AND_SEAFOOD', 'Meat and seafood'],
  ['HOUSEHOLD', 'Household'],
  ['SNACKS', 'Snacks'],
  ['SPECIALTY', 'Specialty'],
] as const;

const UNITS = [
  ['KG', 'Kilogram'],
  ['GRAM', 'Gram'],
  ['LITRE', 'Litre'],
  ['BUNCH', 'Bunch'],
  ['PACK', 'Pack'],
  ['BOTTLE', 'Bottle'],
  ['DOZEN', 'Dozen'],
  ['EACH', 'Each'],
] as const;

/** Products the store sells, and the form that creates one. */
export function CatalogueStudio({ vendorLocationId }: { readonly vendorLocationId: string }) {
  const [products, setProducts] = useState<readonly RemoteProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>('FRUIT_VEGETABLE');
  const [unit, setUnit] = useState<string>('KG');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [threshold, setThreshold] = useState('0');
  const [variableWeight, setVariableWeight] = useState(false);
  const [variancePercent, setVariancePercent] = useState('10');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await vendorRequest<
        readonly RemoteProduct[] | { readonly data?: readonly RemoteProduct[] }
      >(`vendor/locations/${vendorLocationId}/catalogue/products`);
      setProducts(productList(response));
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Your catalogue could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [vendorLocationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setPriceError(null);

    // Integer minor units from the typed digits. The previous form used
    // `Math.round(Number(price) * 100)` — floating-point money arithmetic,
    // which the repository prohibits and which silently mis-prices some inputs.
    const priceMinor = parseRupeesToMinor(price);
    if (priceMinor === null) {
      setPriceError('Enter a price like 45 or 45.50.');
      return;
    }
    const stockQuantity = Number(stock);
    const lowStockThreshold = Number(threshold);
    if (!title.trim()) return setFormError('Give the product a name.');
    if (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0) {
      return setFormError('Stock must be a whole number.');
    }
    if (!Number.isSafeInteger(lowStockThreshold) || lowStockThreshold < 0) {
      return setFormError('The low-stock alert must be a whole number.');
    }
    const varianceBps = variableWeight ? Math.round(Number(variancePercent) * 100) : null;
    if (
      variableWeight &&
      (!Number.isSafeInteger(varianceBps) ||
        varianceBps === null ||
        varianceBps < 0 ||
        varianceBps > 10_000)
    ) {
      return setFormError('Permitted weight variance must be between 0 and 100 percent.');
    }

    setBusy(true);
    const reference = Date.now().toString(36).toUpperCase();
    try {
      await vendorRequest(`vendor/locations/${vendorLocationId}/catalogue/products`, {
        method: 'POST',
        body: JSON.stringify({
          category,
          initial_stock_quantity: stockQuantity,
          low_stock_threshold: lowStockThreshold,
          permitted_weight_variance_bps: varianceBps,
          price_minor: priceMinor,
          product_reference: `SYNTH-PROD-${reference}`,
          sku: `SYNTH-SKU-${reference}`,
          tax_basis: 'INCLUSIVE',
          title: `SYNTH ${title.trim()}`,
          unit_label: unit,
          variable_weight: variableWeight,
          variant_title: `SYNTH ${title.trim()}`,
        }),
      });
      setTitle('');
      setPrice('');
      setStock('');
      setThreshold('0');
      setVariableWeight(false);
      await load();
      setNotice('Product created and published to customer discovery.');
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'The product could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(product: RemoteProduct) {
    setBusy(true);
    try {
      const action = product.lifecycle_state === 'ACTIVE' ? 'deactivate' : 'activate';
      await vendorRequest(
        `vendor/locations/${vendorLocationId}/catalogue/products/${product.catalogue_product_id}/${action}`,
        { method: 'POST', body: JSON.stringify({ expected_version: product.version }) },
      );
      await load();
      setNotice(
        action === 'activate'
          ? 'Product is visible to customers.'
          : 'Product is hidden from customer discovery.',
      );
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'The status could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  const published = products.filter((item) => item.lifecycle_state === 'ACTIVE').length;

  return (
    <Panel
      actions={<span className="ns-eyebrow">{published} published</span>}
      description="Create a listing, set real stock, and control whether customers can see it."
      eyebrow="Catalogue"
      id="catalogue"
      level={2}
      title="Products customers can buy"
    >
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <div className="catalogue-layout">
        <div className="catalogue-list">
          {loading ? (
            <LoadingState label="Loading your catalogue…" lines={4} />
          ) : loadError ? (
            <ErrorState onRetry={() => void load()} title={loadError} />
          ) : products.length === 0 ? (
            <EmptyState
              description="Add your first product with the form beside this list."
              glyph="◌"
              title="Your catalogue is empty"
            />
          ) : (
            products.map((product) => {
              const variant = product.variants[0];
              return (
                <Card as="article" key={product.catalogue_product_id} tone="sunken">
                  <div className="catalogue-row">
                    <div>
                      <strong>{displayName(product.title)}</strong>
                      <p className="catalogue-row__meta">
                        {variant?.price_minor == null
                          ? 'Price unavailable'
                          : formatMoneyMinor(variant.price_minor)}{' '}
                        · {product.unit_label}
                        {product.variable_weight ? ' · sold loose' : ''}
                      </p>
                    </div>
                    <div className="catalogue-row__actions">
                      <StatusPill
                        label={product.lifecycle_state === 'ACTIVE' ? 'Published' : 'Hidden'}
                        state={product.lifecycle_state === 'ACTIVE' ? 'AVAILABLE' : 'CLOSED'}
                      />
                      <Button
                        busy={busy}
                        onClick={() => void toggle(product)}
                        size="small"
                        variant="secondary"
                      >
                        {product.lifecycle_state === 'ACTIVE' ? 'Hide' : 'Publish'}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>

        <Card as="section" className="catalogue-form" tone="raised">
          <h2 className="ns-panel__title">Add a product</h2>
          <form className="ns-stack" onSubmit={createProduct}>
            <Field
              autoComplete="off"
              label="Product name"
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
            <SelectField
              label="Category"
              onChange={(event) => setCategory(event.target.value)}
              value={category}
            >
              {CATEGORIES.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Sold as"
              onChange={(event) => setUnit(event.target.value)}
              value={unit}
            >
              {UNITS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </SelectField>
            <Field
              error={priceError}
              hint="Rupees, with up to two decimal places."
              inputMode="decimal"
              label="Price (₹)"
              onChange={(event) => setPrice(event.target.value)}
              required
              value={price}
            />
            <Field
              inputMode="numeric"
              label="Stock on hand"
              onChange={(event) => setStock(event.target.value)}
              required
              value={stock}
            />
            <Field
              hint="You are warned when stock falls to this number."
              inputMode="numeric"
              label="Low-stock alert"
              onChange={(event) => setThreshold(event.target.value)}
              value={threshold}
            />
            <label className="checkbox-row">
              <input
                checked={variableWeight}
                onChange={(event) => setVariableWeight(event.target.checked)}
                type="checkbox"
              />
              <span>Sold loose — weighed at the counter</span>
            </label>
            {variableWeight ? (
              <Field
                hint="How far the weighed amount may differ before the customer has to approve it (CUS-27)."
                inputMode="decimal"
                label="Permitted weight variance (%)"
                onChange={(event) => setVariancePercent(event.target.value)}
                value={variancePercent}
              />
            ) : null}
            {formError ? <Notice tone="danger">{formError}</Notice> : null}
            <Button block busy={busy} size="large" type="submit">
              Create and publish
            </Button>
          </form>
        </Card>
      </div>
    </Panel>
  );
}
