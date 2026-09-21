'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CheckoutGroupReceipt,
  CustomerOrderEntry,
  CustomerOrderGroup,
  CustomerReceipt,
} from '@neighbourhood-store/contracts';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  ErrorState,
  LoadingState,
  Notice,
  PageHeader,
  Panel,
  SelectField,
  Sheet,
  TextAction,
  formatCountdown,
  formatMoneyMinor,
} from '@neighbourhood-store/ui';
import { customerApiClient } from './customer-session';
import { displayLabel, shortReference } from './display';
import { useLocale } from './locale';
import { displayedOrderState, orderCodeAvailable } from './order-code-policy';
import { StatePill } from './state-pill';

type DecisionItem = {
  product_title: string;
  variant_title: string;
  quantity: number;
  unit_price_minor: number;
  total_minor: number;
};

type PendingDecision = {
  decision_id: string;
  vendor_order_id: string;
  order_reference: string;
  location_name: string;
  proposal_kind: 'SUBSTITUTION' | 'WEIGHT';
  ordered: DecisionItem;
  offered: DecisionItem;
  difference_minor: number;
  reason_note: string;
  decision_deadline_at: string;
};

type CancelPreview = {
  allowed: boolean;
  reason: string;
  refund_expectation: string;
  next_step: 'CANCEL' | 'SUPPORT_CASE' | 'NONE';
  version: number;
};

type Tracking = {
  lifecycle_state: string;
  fulfilment_method: string;
  stage: string;
  approximate_drop_area: string | null;
  in_custody: boolean;
  /** Null for a collected order, which has no delivery to rate. */
  delivery_assignment_id?: string | null;
};

const TERMINAL = new Set([
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
  'RETURNED',
  'REJECTED',
  'EXPIRED',
]);
const POLL_INTERVAL_MS = 10_000;

const SUPPORT_CATEGORIES = [
  ['MISSING_ITEM', 'Something is missing'],
  ['DAMAGED_ITEM', 'Something arrived damaged'],
  ['WRONG_ITEM', 'I received the wrong thing'],
  ['LATE_DELIVERY', 'It is very late'],
  ['ORDER_HELP', 'Something else'],
] as const;

/** A star control that actually asks for a rating (CUS-66). */
function StarRating({
  onRate,
  value,
}: {
  readonly value: number;
  readonly onRate: (stars: number) => void;
}) {
  return (
    <div aria-label="Rating" className="star-rating" role="radiogroup">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          aria-checked={value === star}
          aria-label={`${star} ${star === 1 ? 'star' : 'stars'}`}
          className={star <= value ? 'star-rating__star is-set' : 'star-rating__star'}
          key={star}
          onClick={() => onRate(star)}
          role="radio"
          type="button"
        >
          <Icon name={star <= value ? 'star-filled' : 'star'} />
        </button>
      ))}
    </div>
  );
}

/**
 * One child order.
 *
 * Its tracking, receipt, cancellation preview and support form are its own
 * state. They were previously held once for the whole panel, so opening
 * "Where is it?" on one order rendered that answer underneath every other
 * order on the screen — which for a multi-store checkout is not a cosmetic
 * problem: it tells a customer the wrong thing about the wrong shop.
 */
function OrderCard({
  initialView,
  onChanged,
  order,
}: {
  readonly order: CustomerOrderEntry;
  readonly onChanged: () => void;
  readonly initialView?: 'receipt' | 'tracking';
}) {
  const { t } = useLocale();
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [receipt, setReceipt] = useState<CustomerReceipt | null>(null);
  const [preview, setPreview] = useState<CancelPreview | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportCategory, setSupportCategory] = useState<string>('MISSING_ITEM');
  const [supportDescription, setSupportDescription] = useState('');
  const [rating, setRating] = useState(0);
  const [deliveryRating, setDeliveryRating] = useState(0);
  const [deliveryOtp, setDeliveryOtp] = useState<{ code: string; expiresAt: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const terminal = TERMINAL.has(order.lifecycle_state.toUpperCase());
  const codeAvailable = !terminal && orderCodeAvailable(order) !== null;

  async function run(
    work: (client: Awaited<ReturnType<typeof customerApiClient>>) => Promise<void>,
  ) {
    setError(null);
    try {
      await work(await customerApiClient());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work. Try again.');
    }
  }

  useEffect(() => {
    if (!initialView) return;
    void run(async (client) => {
      if (initialView === 'tracking')
        setTracking(await client.orders.tracking(order.vendor_order_id));
      else setReceipt(await client.orders.receipt(order.vendor_order_id));
    });
  }, [initialView, order.vendor_order_id]);

  return (
    <Card as="article" className="order-card" tone="raised">
      <header className="order-card__head">
        <div>
          <h4 className="order-card__store">
            <Link href={`/orders/${order.vendor_order_id}`}>
              {displayLabel(order.location_name)}
            </Link>
          </h4>
          <p className="ns-eyebrow">{shortReference(order.order_reference)}</p>
        </div>
        <div className="order-card__state">
          <StatePill state={displayedOrderState(order)} />
          <strong>{formatMoneyMinor(order.total_minor)}</strong>
        </div>
      </header>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      {/* The code the partner must be read to complete the handoff (CUS-56).
          Shown only while the order is actually on its way — before custody it
          would mean nothing, and afterwards it would be a way to re-open a
          closed delivery. */}
      {deliveryOtp ? (
        <Card className="delivery-code" tone="sunken">
          <p className="ns-eyebrow">
            {order.fulfilment_method === 'CUSTOMER_PICKUP'
              ? t('customer.order.otp.label_pickup', 'Show this at the counter')
              : t('customer.order.otp.label', 'Read this to the delivery partner')}
          </p>
          <strong className="delivery-code__value">{deliveryOtp.code}</strong>
          <p className="ns-field__hint">
            {t(
              'customer.order.otp.hint',
              'Only give it once they are with you and you have your order.',
            )}{' '}
            {t('customer.order.otp.expires', 'Valid until')}{' '}
            {new Date(deliveryOtp.expiresAt).toLocaleTimeString()}.
          </p>
          <TextAction onClick={() => setDeliveryOtp(null)}>
            {t('customer.order.otp.hide', 'Hide it')}
          </TextAction>
        </Card>
      ) : null}

      <div className="ns-row order-card__actions">
        {/* A code exists only once there is something to prove: the order is
            packed and waiting at the counter, or it is on its way to the door.
            Offering it earlier produced a "no longer available" error on a
            perfectly healthy order. */}
        {codeAvailable ? (
          <Button
            onClick={() =>
              void run(async (client) => {
                // A pickup order proves collection at the counter (CUS-51); a
                // delivered one proves the handoff at the door (CUS-56). Same
                // control, and the order's own fulfilment method decides which.
                const issued =
                  order.fulfilment_method === 'CUSTOMER_PICKUP'
                    ? await client.orders.pickupOtp(order.vendor_order_id)
                    : await client.orders.deliveryOtp(order.vendor_order_id);
                setDeliveryOtp({ code: issued.plaintext_otp, expiresAt: issued.expires_at });
              })
            }
          >
            {order.fulfilment_method === 'CUSTOMER_PICKUP'
              ? t('customer.order.otp.show_pickup', 'Show my collection code')
              : t('customer.order.otp.show', 'Show my delivery code')}
          </Button>
        ) : null}
        {!terminal ? (
          <Link
            className="ns-button ns-button--secondary ns-button--medium"
            href={`/orders/${order.vendor_order_id}/track`}
          >
            <span className="ns-button__label">{t('customer.order.where', 'Where is it?')}</span>
          </Link>
        ) : null}
        <Link
          className="ns-button ns-button--secondary ns-button--medium"
          href={`/orders/${order.vendor_order_id}/receipt`}
        >
          <span className="ns-button__label">{t('customer.order.receipt', 'Receipt')}</span>
        </Link>
        <Button onClick={() => setSupportOpen(true)} variant="secondary">
          {t('customer.order.help', 'Get help')}
        </Button>
        {!terminal ? (
          <Button
            onClick={() =>
              void run(async (client) => {
                setPreview(await client.orders.cancellationPreview(order.vendor_order_id));
              })
            }
            variant="ghost"
          >
            {t('customer.order.cancel', 'Cancel')}
          </Button>
        ) : null}
      </div>

      {tracking ? (
        <Card className="order-tracking" tone="sunken">
          <div className="ns-row">
            <StatePill state={tracking.stage} />
            {tracking.in_custody ? (
              <span>{t('customer.order.in_custody', 'A partner is carrying it now')}</span>
            ) : null}
          </div>
          {tracking.approximate_drop_area ? (
            <p>
              {t('customer.order.heading_for', 'Heading for')} {tracking.approximate_drop_area}
            </p>
          ) : null}
          {/* Never a map alone: the text is the primary account of where it is (UX-12). */}
          <TextAction onClick={() => setTracking(null)}>{t('customer.close', 'Close')}</TextAction>
        </Card>
      ) : null}

      {preview ? (
        <Card className="order-cancel" tone="sunken">
          <strong>{preview.reason}</strong>
          <p>{preview.refund_expectation}</p>
          <div className="ns-row">
            {preview.next_step === 'CANCEL' && preview.allowed ? (
              <Button
                onClick={() =>
                  void run(async (client) => {
                    await client.orders.cancel(order.vendor_order_id, {
                      expected_version: preview.version,
                      reason_code: 'CUSTOMER_CANCELLED',
                    });
                    setPreview(null);
                    setMessage(t('customer.order.cancelled', 'This order is cancelled.'));
                    onChanged();
                  })
                }
                variant="danger"
              >
                {t('customer.order.cancel_confirm', 'Cancel this order only')}
              </Button>
            ) : null}
            {preview.next_step === 'SUPPORT_CASE' ? (
              // Post-custody, cancellation is a return that support arranges,
              // not a status a customer may set (CUS-58).
              <Button
                onClick={() =>
                  void run(async (client) => {
                    await client.orders.openSupport(order.vendor_order_id, {
                      category: 'CANCELLATION_AFTER_PICKUP',
                      description: 'I need to cancel this order after it was collected.',
                    });
                    setPreview(null);
                    setMessage(
                      t('customer.order.return_opened', 'We will arrange the return with you.'),
                    );
                  })
                }
              >
                {t('customer.order.arrange_return', 'Arrange a return')}
              </Button>
            ) : null}
            <Button onClick={() => setPreview(null)} variant="secondary">
              {t('customer.order.keep', 'Keep the order')}
            </Button>
          </div>
          <p className="ns-field__hint">
            {t(
              'customer.order.sibling_isolation',
              'Only this store’s order is affected. Your other orders continue.',
            )}
          </p>
        </Card>
      ) : null}

      {terminal && order.lifecycle_state.toUpperCase() !== 'CANCELLED' ? (
        <div className="order-rating">
          <span>{t('customer.order.rate', 'How was this store?')}</span>
          <StarRating
            onRate={(stars) =>
              void run(async (client) => {
                setRating(stars);
                await client.orders.rate(order.vendor_order_id, {
                  stars,
                  review_note: 'Customer rating submitted.',
                });
                setMessage(t('customer.order.rated', 'Thank you — your rating is recorded.'));
              })
            }
            value={rating}
          />
        </div>
      ) : null}

      {/* The shop and the delivery are two services. Rating them together meant
          a late rider lowered a good shop's score and neither could act on it.
          Only shown when there was a delivery — a collected order has none. */}
      {terminal &&
      order.lifecycle_state.toUpperCase() !== 'CANCELLED' &&
      tracking?.delivery_assignment_id ? (
        <div className="order-rating">
          <span>{t('customer.order.rate_delivery', 'And how was the delivery?')}</span>
          <StarRating
            onRate={(stars) =>
              void run(async (client) => {
                setDeliveryRating(stars);
                await client.orders.rateDelivery(tracking.delivery_assignment_id as string, {
                  stars,
                });
                setMessage(
                  t('customer.order.rated_delivery', 'Thank you — the delivery is rated too.'),
                );
              })
            }
            value={deliveryRating}
          />
        </div>
      ) : null}

      <Sheet
        footer={
          <Button
            block
            disabled={supportDescription.trim().length < 4}
            onClick={() =>
              void run(async (client) => {
                await client.orders.openSupport(order.vendor_order_id, {
                  category: supportCategory,
                  description: supportDescription.trim(),
                });
                setSupportOpen(false);
                setSupportDescription('');
                setMessage(
                  t('customer.support.opened', 'Your case is open. We will come back to you here.'),
                );
              })
            }
          >
            {t('customer.support.submit', 'Open a support case')}
          </Button>
        }
        onClose={() => setSupportOpen(false)}
        open={supportOpen}
        title={`${t('customer.support.title', 'Help with')} ${displayLabel(order.location_name)}`}
      >
        <SelectField
          hint={t(
            'customer.support.category.hint',
            'Choosing the right one gets your case to the team that can settle it.',
          )}
          label={t('customer.support.category', 'What went wrong?')}
          onChange={(event) => setSupportCategory(event.target.value)}
          value={supportCategory}
        >
          {SUPPORT_CATEGORIES.map(([id, label]) => (
            <option key={id} value={id}>
              {t(`customer.support.category.${id.toLowerCase()}`, label)}
            </option>
          ))}
        </SelectField>
        <label className="ns-field">
          <span className="ns-field__label">
            {t('customer.support.detail', 'Tell us what happened')}
          </span>
          <textarea
            className="ns-input"
            maxLength={600}
            onChange={(event) => setSupportDescription(event.target.value)}
            rows={4}
            value={supportDescription}
          />
        </label>
        <p className="ns-field__hint">
          {t(
            'customer.support.scope',
            'This case is about this store’s order only. Your other orders are not affected.',
          )}
        </p>
      </Sheet>

      <Sheet
        onClose={() => setReceipt(null)}
        open={receipt !== null}
        title={t('customer.receipt.title', 'Receipt')}
      >
        {receipt ? (
          <>
            <p className="ns-eyebrow">{shortReference(receipt.order.order_reference)}</p>
            <ul className="receipt-lines">
              {receipt.lines.map((line) => (
                <li key={line.catalogue_variant_id}>
                  <span>{displayLabel(line.title)}</span>
                  <span>
                    {line.quantity} × {formatMoneyMinor(line.unit_price_minor)} ={' '}
                    {formatMoneyMinor(line.line_total_minor)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="ns-row receipt-total">
              <strong>{t('customer.receipt.total', 'Total')}</strong>
              <strong>{formatMoneyMinor(receipt.order.total_minor)}</strong>
            </div>
            <Button
              block
              onClick={() =>
                void run(async (client) => {
                  for (const line of receipt.lines) {
                    await client.cart.addLine({
                      vendor_location_id: line.vendor_location_id,
                      catalogue_variant_id: line.catalogue_variant_id,
                      quantity: line.quantity,
                      substitution_preference: 'ASK_CUSTOMER',
                    });
                  }
                  setReceipt(null);
                  setMessage(
                    t(
                      'customer.order.reordered',
                      'Added to your basket at today’s prices — check it before paying.',
                    ),
                  );
                })
              }
              variant="secondary"
            >
              {t('customer.order.reorder', 'Order this again')}
            </Button>
          </>
        ) : null}
      </Sheet>
    </Card>
  );
}

/**
 * Orders, grouped as they were bought (CUS-46).
 *
 * A checkout group is one payment across several shops, and each child order
 * has its own life. The previous screen rendered the groups and the children as
 * two flat, unrelated lists, so nothing on screen said which store belonged to
 * which payment.
 */
export function OrdersPanel({
  initialView,
  vendorOrderId,
}: {
  readonly initialView?: 'receipt' | 'tracking';
  readonly vendorOrderId?: string;
}) {
  const { t } = useLocale();
  const [groups, setGroups] = useState<readonly CustomerOrderGroup[]>([]);
  const [decisions, setDecisions] = useState<readonly PendingDecision[]>([]);
  const [finance, setFinance] = useState<CheckoutGroupReceipt | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const displayedGroups = useMemo(
    () =>
      vendorOrderId
        ? groups
            .map((group) => ({
              ...group,
              vendor_orders: group.vendor_orders.filter(
                (order) => order.vendor_order_id === vendorOrderId,
              ),
            }))
            .filter((group) => group.vendor_orders.length > 0)
        : groups,
    [groups, vendorOrderId],
  );

  const load = useCallback(async () => {
    try {
      const client = await customerApiClient();
      const [history, pending] = await Promise.all([
        client.orders.list(),
        client.decisions.pending().catch(() => ({ decisions: [] as PendingDecision[] })),
      ]);
      setGroups(history.groups);
      setDecisions(pending.decisions);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your orders could not be loaded.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Polls only while something can still change. A history of finished orders
  // does not need a request every ten seconds for as long as the tab is open.
  useEffect(() => {
    const live = groups
      .flatMap((group) => group.vendor_orders)
      .some((order) => !TERMINAL.has(order.lifecycle_state.toUpperCase()));
    if (!live && loaded) return;
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [groups, load, loaded]);

  if (!loaded) {
    return <LoadingState label={t('customer.orders.loading', 'Loading your orders…')} lines={4} />;
  }
  if (error) {
    return (
      <ErrorState
        onRetry={() => void load()}
        retryLabel={t('customer.retry', 'Try again')}
        title={error}
      />
    );
  }

  return (
    <div className="ns-stack">
      <PageHeader
        actions={
          <Button onClick={() => void load()} variant="secondary">
            {t('customer.refresh', 'Refresh')}
          </Button>
        }
        description={t(
          'customer.orders.description',
          'One payment can cover several shops. Each shop’s order moves on its own.',
        )}
        eyebrow={t('customer.orders.eyebrow', 'After checkout')}
        title={
          vendorOrderId
            ? t('customer.order.title', 'Order detail')
            : t('customer.orders.title', 'Your orders')
        }
      />

      {decisions.length > 0 ? (
        <Panel
          description={t(
            'customer.decisions.description',
            'A shop wants to change something before it packs your order.',
          )}
          eyebrow={t('customer.decisions.eyebrow', 'Waiting for you')}
          id="decisions"
          level={2}
          title={t('customer.decisions.title', 'Decisions needed')}
        >
          {decisions.map((decision) => {
            const remaining = formatCountdown(decision.decision_deadline_at, now);
            return (
              <Card as="article" key={decision.decision_id} tone="sunken">
                <strong>
                  {decision.proposal_kind === 'SUBSTITUTION'
                    ? t('customer.decisions.substitution', 'A replacement item')
                    : t('customer.decisions.weight', 'A different weight')}
                  {' · '}
                  {displayLabel(decision.location_name)}
                </strong>
                {/* What the answer is about (8.4): the item as ordered, what is
                    offered instead, and what it does to the amount. */}
                <p>
                  {t('customer.decisions.ordered', 'You ordered')}{' '}
                  <strong>{displayLabel(decision.ordered.product_title)}</strong>{' '}
                  {decision.ordered.quantity} ×{' '}
                  {formatMoneyMinor(decision.ordered.unit_price_minor)}
                </p>
                <p>
                  {t('customer.decisions.offered', 'The shop offers')}{' '}
                  <strong>{displayLabel(decision.offered.product_title)}</strong>{' '}
                  {decision.offered.quantity} ×{' '}
                  {formatMoneyMinor(decision.offered.unit_price_minor)}
                  {' — '}
                  {decision.difference_minor > 0
                    ? `${formatMoneyMinor(decision.difference_minor)} ${t('customer.decisions.more', 'more than you authorised, added if you approve')}`
                    : decision.difference_minor < 0
                      ? `${formatMoneyMinor(-decision.difference_minor)} ${t('customer.decisions.less', 'less; the difference is not charged')}`
                      : t('customer.decisions.same_price', 'at the same price')}
                </p>
                <p className="decision-reason">{decision.reason_note}</p>
                {/* The deadline is the server's, so a wrong device clock or a
                    reopened tab still shows the real time left (CUS-48). */}
                <p aria-live="polite" className="decision-countdown">
                  {remaining === null
                    ? t(
                        'customer.decisions.expired',
                        'Time is up — the shop has been told you did not reply.',
                      )
                    : `${remaining} ${t('customer.decisions.left', 'left to answer')}`}
                </p>
                {remaining === null ? null : (
                  <div className="ns-row">
                    <Button
                      onClick={() =>
                        void customerApiClient()
                          .then((client) =>
                            client.decisions.answer(decision.decision_id, 'APPROVED'),
                          )
                          .then(() => load())
                      }
                    >
                      {t('customer.decisions.approve', 'Yes, that is fine')}
                    </Button>
                    <Button
                      onClick={() =>
                        void customerApiClient()
                          .then((client) =>
                            client.decisions.answer(decision.decision_id, 'REJECTED'),
                          )
                          .then(() => load())
                      }
                      variant="secondary"
                    >
                      {t('customer.decisions.reject', 'No, refund me instead')}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </Panel>
      ) : null}

      {displayedGroups.length === 0 ? (
        <EmptyState
          description={t(
            'customer.orders.empty.description',
            'Your orders will appear here, grouped by the payment that made them.',
          )}
          glyph="◷"
          title={t('customer.orders.empty.title', 'No orders yet')}
        />
      ) : (
        displayedGroups.map((group) => (
          <Panel
            actions={
              <Button
                onClick={() =>
                  void customerApiClient()
                    .then((client) => client.orders.financeReceipt(group.checkout_group_id))
                    .then(setFinance)
                    .catch(() => undefined)
                }
                variant="ghost"
              >
                {t('customer.orders.payment', 'Payment & refunds')}
              </Button>
            }
            description={new Date(group.created_at).toLocaleString()}
            eyebrow={`${shortReference(group.checkout_reference)} · ${formatMoneyMinor(group.total_minor)}`}
            id={group.checkout_group_id}
            key={group.checkout_group_id}
            level={2}
            title={
              <span className="ns-row">
                {group.vendor_orders.length === 1
                  ? t('customer.orders.one_store', 'One store')
                  : `${group.vendor_orders.length} ${t('customer.orders.stores', 'stores')}`}
                <StatePill state={group.lifecycle_state} />
              </span>
            }
          >
            {group.vendor_orders.map((order) => (
              <OrderCard
                {...(initialView ? { initialView } : {})}
                key={order.vendor_order_id}
                onChanged={() => void load()}
                order={order}
              />
            ))}
          </Panel>
        ))
      )}

      <Sheet
        onClose={() => setFinance(null)}
        open={finance !== null}
        title={t('customer.finance.title', 'Payment and refunds')}
      >
        {finance ? (
          <>
            <div className="ns-row">
              <strong>{t('customer.finance.paid', 'Paid')}</strong>
              <strong>{formatMoneyMinor(finance.total_minor)}</strong>
            </div>
            {finance.refunded_total_minor > 0 ? (
              <>
                <Notice tone="information">
                  {t('customer.finance.refunded', 'Refunded')}{' '}
                  {formatMoneyMinor(finance.refunded_total_minor)}
                </Notice>
                <ul className="refund-lines">
                  {finance.refunds.map((refund) => (
                    <li key={refund.refund_id}>
                      <span>{shortReference(refund.order_reference)}</span>
                      <span>{formatMoneyMinor(refund.refund_total_minor)}</span>
                      <StatePill state={refund.refund_state} />
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>{t('customer.finance.no_refunds', 'No refunds against this order.')}</p>
            )}
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
