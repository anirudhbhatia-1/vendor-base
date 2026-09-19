'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  catalogueImageUrl,
  type CartVendorGroup,
  type CheckoutGroup,
  type CheckoutQuote,
  type FulfilmentMethod,
  type PaymentMethod,
} from '@neighbourhood-store/contracts';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  PageHeader,
  Panel,
  ProductImage,
  QuantityStepper,
  SelectField,
  formatCountdown,
  formatMoneyMinor,
} from '@neighbourhood-store/ui';
import { groupUnavailableSentence, lineStaleSentence } from './basket-copy';
import { useCart } from './cart-store';
import { customerApiClient } from './customer-session';
import { displayLabel, shortReference } from './display';
import { useLocale } from './locale';
import { StatePill } from './state-pill';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

const PAYMENT_METHODS: readonly PaymentMethod[] = ['UPI', 'CARD', 'WALLET'];

const FULFILMENT_LABEL: Readonly<Record<FulfilmentMethod, string>> = {
  CUSTOMER_PICKUP: 'I will collect it',
  PLATFORM_DELIVERY: 'Delivery partner brings it',
  VENDOR_DELIVERY: 'The store delivers it',
};

/** One vendor group in the basket, with everything that is decided per store. */
function GroupCard({ group }: { readonly group: CartVendorGroup }) {
  const {
    busyVariantIds,
    removeGroup,
    removeLine,
    setGroupFulfilment,
    setQuantity,
    setSubstitutionPreference,
  } = useCart();
  const { t } = useLocale();
  const [note, setNote] = useState(group.customer_note ?? '');
  const name = displayLabel(group.location_name);
  // Revalidation used to mark a group INVALID and a line STALE and the basket
  // drew both exactly as before, so the customer learnt at the quote -- or
  // never -- that a store had dropped out. The reason is now on the row and
  // the way out is offered next to it.
  const unavailable =
    group.lifecycle_state === 'INVALID' ? groupUnavailableSentence(group.invalid_reason, t) : null;

  return (
    <Card as="article" className="basket-group" tone="raised">
      {unavailable ? (
        <Notice tone="danger">
          <strong>
            {t('customer.cart.group.unavailable', 'This store cannot take this order right now')}
          </strong>{' '}
          {unavailable}{' '}
          <Button onClick={() => void removeGroup(group)} size="small" variant="danger">
            {t('customer.cart.group.remove', 'Remove this store')}
          </Button>
        </Notice>
      ) : null}
      <header className="basket-group__head">
        <div>
          <h3 className="basket-group__name">
            <Link href={`/stores/${group.vendor_location_id}`}>{name}</Link>
          </h3>
          <p className="basket-group__meta">
            {group.subtotal_minor === null
              ? t('customer.cart.group.no_subtotal', 'Subtotal confirmed when the store is quoted')
              : `${t('customer.cart.subtotal', 'Subtotal')} ${formatMoneyMinor(group.subtotal_minor)}`}
          </p>
        </div>
        <StatePill
          label={
            group.minimum_met
              ? t('customer.cart.minimum_met', 'Minimum met')
              : `${t('customer.cart.minimum_short', 'Needs')} ${formatMoneyMinor(
                  group.minimum_order_minor - (group.subtotal_minor ?? 0),
                  'compact',
                )} ${t('customer.cart.more', 'more')}`
          }
          state={group.minimum_met ? 'AVAILABLE' : 'LOW_STOCK'}
        />
      </header>

      <ul className="basket-lines">
        {group.lines.map((line) => {
          const title = displayLabel(line.title);
          const imageId = line.image_reference;
          const stale =
            line.lifecycle_state === 'STALE' ? lineStaleSentence(line.stale_reason, t) : null;
          return (
            <li className="basket-line" key={line.cart_line_id}>
              <ProductImage
                category={line.category}
                size="thumb"
                // A cart line carries the storage reference; only an id-backed
                // image is servable, so anything else falls to the placeholder.
                src={
                  imageId && !imageId.startsWith('SYNTH-')
                    ? catalogueImageUrl(apiUrl, imageId)
                    : null
                }
                title={title}
              />
              <div className="basket-line__body">
                <strong className="basket-line__title">{title}</strong>
                <span className="basket-line__unit">
                  {line.unit_label}
                  {line.variable_weight
                    ? ` · ${t('customer.cart.variable_weight', 'final weight set by the store')}`
                    : ''}
                </span>
                <span className="basket-line__money">
                  {line.unit_price_minor === null
                    ? t('customer.cart.price_pending', 'Price confirmed at quote')
                    : `${line.quantity} × ${formatMoneyMinor(line.unit_price_minor)}`}
                  {line.line_total_minor === null
                    ? ''
                    : ` = ${formatMoneyMinor(line.line_total_minor)}`}
                </span>

                {stale ? <Notice tone="danger">{stale}</Notice> : null}
                {stale ? null : (
                  <SelectField
                    className="basket-line__substitution"
                    label={t('customer.cart.substitution', 'If it is unavailable')}
                    onChange={(event) =>
                      void setSubstitutionPreference(
                        line,
                        event.target.value as
                          'ASK_CUSTOMER' | 'ALLOW_SAME_STORE' | 'NO_SUBSTITUTION',
                      )
                    }
                    value={line.substitution_preference}
                  >
                    <option value="ASK_CUSTOMER">
                      {t('customer.substitution.ask', 'Ask me before replacing it')}
                    </option>
                    <option value="ALLOW_SAME_STORE">
                      {t('customer.substitution.allow', 'Let the store choose a close match')}
                    </option>
                    <option value="NO_SUBSTITUTION">
                      {t('customer.substitution.none', 'Do not replace it — refund me')}
                    </option>
                  </SelectField>
                )}
              </div>
              {stale ? (
                <Button
                  busy={busyVariantIds.has(line.catalogue_variant_id)}
                  onClick={() => void removeLine(line)}
                  size="small"
                  variant="danger"
                >
                  {t('customer.cart.line.remove', 'Remove')}
                </Button>
              ) : (
                <QuantityStepper
                  busy={busyVariantIds.has(line.catalogue_variant_id)}
                  itemLabel={title}
                  onChange={(next) =>
                    void setQuantity({
                      catalogueVariantId: line.catalogue_variant_id,
                      quantity: next,
                      vendorLocationId: group.vendor_location_id,
                    })
                  }
                  quantity={line.quantity}
                  size="small"
                />
              )}
            </li>
          );
        })}
      </ul>

      <div className="basket-group__options">
        <SelectField
          error={
            group.fulfilment_method_offered
              ? null
              : t(
                  'customer.cart.fulfilment.unavailable',
                  'This store no longer offers that option. Choose another way to get this order.',
                )
          }
          label={t('customer.cart.fulfilment', 'How you want this order')}
          onChange={(event) =>
            void setGroupFulfilment({
              groupId: group.cart_vendor_group_id,
              expectedVersion: group.version,
              fulfilmentMethod: event.target.value as FulfilmentMethod,
              customerNote: note.trim() || null,
            })
          }
          value={group.fulfilment_method}
        >
          {/* The bound value must be listed, or the browser shows the first
              option while the server still holds a method the store withdrew. */}
          {!group.fulfilment_method_offered && (
            <option disabled value={group.fulfilment_method}>
              {t(
                `customer.fulfilment.${group.fulfilment_method.toLowerCase()}`,
                FULFILMENT_LABEL[group.fulfilment_method] ?? group.fulfilment_method,
              )}
            </option>
          )}
          {group.fulfilment_modes.map((mode) => (
            <option key={mode} value={mode}>
              {t(
                `customer.fulfilment.${mode.toLowerCase()}`,
                FULFILMENT_LABEL[mode as FulfilmentMethod] ?? mode,
              )}
            </option>
          ))}
        </SelectField>

        {/* CUS-35. The endpoint has always accepted a note; nothing ever sent one. */}
        <label className="ns-field">
          <span className="ns-field__label">
            {t('customer.cart.note', 'A note for this store (optional)')}
          </span>
          <textarea
            className="ns-input basket-group__note"
            maxLength={240}
            onBlur={() =>
              void setGroupFulfilment({
                groupId: group.cart_vendor_group_id,
                expectedVersion: group.version,
                fulfilmentMethod: group.fulfilment_method,
                customerNote: note.trim() || null,
              })
            }
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('customer.cart.note.placeholder', 'Ripe ones please, no plastic bag…')}
            rows={2}
            value={note}
          />
          <span className="ns-field__hint">
            {t(
              'customer.cart.note.hint',
              'Seen by this store only, never by other shops in your basket.',
            )}
          </span>
        </label>
      </div>
    </Card>
  );
}

/**
 * Basket and grouped checkout.
 *
 * Rebuilt around the vendor group, which is what the architecture makes the
 * organising unit (MKT-05, CUS-30): the previous screen flattened every group
 * through one `allLines()` call, so a shopper buying from three shops saw one
 * undifferentiated list and could not tell which store owed them what. It also
 * showed `catalogue_variant_id.slice(0, 12)` where each product name belongs,
 * and would not load until the customer pressed a button.
 */
export function CheckoutPanel({ mode = 'checkout' }: { readonly mode?: 'cart' | 'checkout' }) {
  const { cart, error: cartError, refresh, revalidate, totalMinor } = useCart();
  const { t } = useLocale();
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [placed, setPlaced] = useState<CheckoutGroup | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const quoteGeneration = useRef(0);
  const cartSignature = cart
    ? JSON.stringify([cart.cart_id, cart.version, cart.customer_address_id, cart.groups])
    : null;

  // One second tick drives the quote countdown. The deadline itself is the
  // server's (CUS-38, CUS-48) — this only re-renders the remaining time.
  useEffect(() => {
    if (!quote) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [quote]);

  const groups = cart?.groups.filter((group) => group.lines.length > 0) ?? [];
  const remaining = quote ? formatCountdown(quote.expires_at, now) : null;
  const quoteExpired = quote !== null && remaining === null;

  async function createQuote() {
    if (!cart) return;
    const generation = ++quoteGeneration.current;
    setQuote(null);
    setBusy(true);
    setFailure(null);
    try {
      const client = await customerApiClient();
      const next = await client.checkout.quote({ cart_id: cart.cart_id });
      if (generation !== quoteGeneration.current) return;
      setQuote(next);
      setPlaced(null);
      setNow(Date.now());
    } catch (cause) {
      if (generation !== quoteGeneration.current) return;
      setFailure(cause instanceof Error ? cause.message : 'A quote could not be created.');
    } finally {
      if (generation === quoteGeneration.current) setBusy(false);
    }
  }

  useEffect(() => {
    if (mode !== 'checkout' || !cart || placed) return;
    void createQuote();
    return () => {
      quoteGeneration.current += 1;
    };
  }, [cartSignature, mode, placed]);

  async function place() {
    if (!quote) return;
    setBusy(true);
    setFailure(null);
    try {
      const client = await customerApiClient();
      const result = await client.checkout.place({
        checkout_quote_id: quote.checkout_quote_id,
        payment_method: paymentMethod,
        // Keyed to the quote, so a double tap, a retry or a reconnect resolves
        // to the same checkout group rather than a second charge (CUS-43).
        idempotency_key: `pwa-${quote.checkout_quote_id}`,
      });
      setPlaced(result);
      setQuote(null);
      await refresh();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'The order could not be placed.');
    } finally {
      setBusy(false);
    }
  }

  if (placed) {
    const unknown = placed.lifecycle_state === 'PAYMENT_UNKNOWN';
    return (
      <div className="ns-stack">
        <PageHeader
          eyebrow={t('customer.checkout.placed.eyebrow', 'Order placed')}
          title={
            unknown
              ? t('customer.checkout.unknown.title', 'We are confirming your payment')
              : t('customer.checkout.placed.title', 'Each store has your order')
          }
        />
        {unknown ? (
          <Notice live="assertive" tone="warning">
            {t(
              'customer.checkout.unknown.body',
              'Your bank has not told us the result yet. Do not pay again — this same order will settle itself either way, and you will see it in Orders.',
            )}
          </Notice>
        ) : (
          <Notice tone="success">
            {t(
              'customer.checkout.placed.body',
              'Each shop confirms separately, so your orders may arrive at different times.',
            )}
          </Notice>
        )}
        <div className="ns-stack">
          {placed.orders.map((order) => (
            <Card as="article" key={order.vendor_order_id} tone="raised">
              <div className="ns-row">
                <strong>{displayLabel(order.location_name)}</strong>
                <StatePill state={order.lifecycle_state} />
              </div>
              <p className="ns-eyebrow">{shortReference(order.order_reference)}</p>
              <strong>{formatMoneyMinor(order.total_minor)}</strong>
            </Card>
          ))}
        </div>
        <Link
          className="ns-button ns-button--primary ns-button--large ns-button--block"
          href="/orders"
        >
          <span className="ns-button__label">
            {t('customer.checkout.track', 'Track your orders')}
          </span>
        </Link>
      </div>
    );
  }

  if (!cart) {
    return <LoadingState label={t('customer.cart.loading', 'Loading your basket…')} lines={4} />;
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        action={
          <Link className="ns-button ns-button--primary ns-button--medium" href="/">
            <span className="ns-button__label">{t('customer.cart.start', 'Start shopping')}</span>
          </Link>
        }
        description={t(
          'customer.cart.empty.description',
          'Add something from a nearby store and it will appear here, grouped by shop.',
        )}
        glyph="◌"
        title={t('customer.cart.empty.title', 'Your basket is empty')}
      />
    );
  }

  return (
    <div className="ns-stack">
      <PageHeader
        description={t(
          'customer.cart.description',
          'One payment. Each shop confirms, packs and delivers its own order.',
        )}
        eyebrow={t('customer.cart.eyebrow', 'Your basket')}
        title={
          groups.length === 1
            ? t('customer.cart.title.one', 'One store')
            : `${groups.length} ${t('customer.cart.title.many', 'stores')}`
        }
      />

      {cartError ? <Notice tone="danger">{cartError}</Notice> : null}
      {notice ? <Notice tone="information">{notice}</Notice> : null}

      {groups.map((group) => (
        <GroupCard group={group} key={group.cart_vendor_group_id} />
      ))}

      <Card className="basket-total" tone="sunken">
        <div className="ns-row">
          <span>{t('customer.cart.items_total', 'Items across all stores')}</span>
          <strong>
            {totalMinor === null
              ? t('customer.cart.total_pending', 'Total confirmed at checkout')
              : formatMoneyMinor(totalMinor)}
          </strong>
        </div>
        <p className="ns-field__hint">
          {t(
            'customer.cart.fees_hint',
            'Delivery fees and each store’s arrival window are added when you get a quote.',
          )}
        </p>
        <div className="ns-row">
          <Button
            onClick={async () => {
              const outcome = await revalidate();
              setNotice(
                outcome.changed
                  ? t(
                      'customer.cart.revalidate.changed',
                      'Something changed. Only the affected store group is marked.',
                    )
                  : t(
                      'customer.cart.revalidate.clean',
                      'Prices, stock and store hours are current.',
                    ),
              );
            }}
            variant="secondary"
          >
            {t('customer.cart.recheck', 'Recheck prices and stock')}
          </Button>
          {mode === 'cart' ? (
            <Link className="ns-button ns-button--primary ns-button--large" href="/checkout">
              <span className="ns-button__label">
                {t('customer.cart.checkout', 'Continue to checkout')}
              </span>
            </Link>
          ) : (
            <Button block busy={busy} onClick={() => void createQuote()} size="large">
              {t('customer.cart.quote', 'Refresh quote')}
            </Button>
          )}
        </div>
      </Card>

      {failure ? (
        <ErrorState
          onRetry={() => void createQuote()}
          retryLabel={t('customer.retry', 'Try again')}
          title={failure}
        />
      ) : null}

      {mode === 'checkout' && quote ? (
        <Panel
          description={
            quoteExpired
              ? t(
                  'customer.quote.expired',
                  'This quote has expired. Get a fresh one before paying.',
                )
              : `${t('customer.quote.holds', 'Held for')} ${remaining}`
          }
          eyebrow={t('customer.quote.eyebrow', 'Quote')}
          id="quote"
          level={2}
          title={t('customer.quote.title', 'What each store will charge')}
        >
          {quote.groups.map((group) => (
            <Card as="article" key={group.vendor_location_id} tone="sunken">
              <div className="ns-row">
                <strong>{displayLabel(group.location_name)}</strong>
                <strong>{formatMoneyMinor(group.total_minor)}</strong>
              </div>
              <p className="quote-breakdown">
                {t('customer.quote.items', 'Items')} {formatMoneyMinor(group.item_minor)} ·{' '}
                {t('customer.quote.delivery', 'Delivery')} {formatMoneyMinor(group.delivery_minor)}
                {group.tip_minor > 0
                  ? ` · ${t('customer.quote.tip', 'Tip')} ${formatMoneyMinor(group.tip_minor)}`
                  : ''}
              </p>
              <p className="quote-promise">{group.promise}</p>
            </Card>
          ))}

          {quote.blocked_groups.length > 0 ? (
            <Notice tone="warning">
              {t(
                'customer.quote.blocked',
                'These stores cannot take your order right now. The rest of your basket is unaffected:',
              )}{' '}
              {quote.blocked_groups
                .map((blocked) => blocked.reason_code.replaceAll('_', ' ').toLowerCase())
                .join('; ')}
            </Notice>
          ) : null}

          <fieldset className="payment-methods">
            <legend>{t('customer.payment.legend', 'How would you like to pay?')}</legend>
            {PAYMENT_METHODS.map((method) => (
              <label className="payment-method" key={method}>
                <input
                  checked={paymentMethod === method}
                  name="payment-method"
                  onChange={() => setPaymentMethod(method)}
                  type="radio"
                  value={method}
                />
                <span>
                  {method === 'UPI'
                    ? t('customer.payment.upi', 'UPI')
                    : method === 'CARD'
                      ? t('customer.payment.card', 'Card')
                      : t('customer.payment.wallet', 'Wallet')}
                </span>
              </label>
            ))}
            <p className="ns-field__hint">
              {t('customer.payment.no_cod', 'Cash on delivery is not available.')}
            </p>
          </fieldset>

          <Card tone="sunken">
            <div className="ns-row">
              <strong>{t('customer.quote.authorize', 'You authorise')}</strong>
              <strong className="quote-total">{formatMoneyMinor(quote.total_minor)}</strong>
            </div>
            {quote.authorization_buffer_minor > 0 ? (
              <p className="ns-field__hint">
                {t('customer.quote.buffer', 'Includes a buffer of')}{' '}
                {formatMoneyMinor(quote.authorization_buffer_minor)}{' '}
                {t(
                  'customer.quote.buffer.detail',
                  'for loose items weighed at the shop. Anything unused is released.',
                )}
              </p>
            ) : null}
          </Card>

          {quoteExpired ? (
            <Button block busy={busy} onClick={() => void createQuote()} size="large">
              {t('customer.quote.refresh', 'Get a fresh quote')}
            </Button>
          ) : (
            <Button block busy={busy} onClick={() => void place()} size="large">
              {t('customer.checkout.pay', 'Pay and place orders')}
            </Button>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
