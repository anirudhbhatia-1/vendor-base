'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  Field,
  LoadingState,
  Notice,
  Panel,
  SelectField,
  Sheet,
  StatusPill,
  formatCountdown,
  humaniseEnum,
  formatMoneyMinor,
  parseRupeesToMinor,
} from '@neighbourhood-store/ui';
import { vendorApiClient, vendorRequest } from './authenticated-api';
import { displayName, shortReference } from './display';
import { drain, enqueue, queuedActions } from './offline-queue';

type Order = {
  vendor_order_id: string;
  order_reference: string;
  lifecycle_state: string;
  total_minor: number;
  version: number;
  accept_by: string | null;
  package_count: number | null;
  /** CUSTOMER_PICKUP, VENDOR_DELIVERY or PLATFORM_DELIVERY. */
  fulfilment_method: string;
  /** When the shop's own staff left with a self-delivered order (VEN-37). */
  out_for_delivery_at: string | null;
  delivery_otp_attempts: number;
  collection: {
    readonly assignment_state: string;
    readonly partner_waiting_since: string | null;
    readonly wait_state: string | null;
  } | null;
  resolution: {
    readonly reason_code: string;
    readonly ended_by: string;
    readonly occurred_at: string;
  } | null;
};

/**
 * What the delivery side is doing, said the way a shopkeeper would.
 *
 * The vendor previously had no signal at all: a packed order showed READY
 * whether the partner was still riding over, standing at the counter, or had
 * already left after waiting — so an order needing re-dispatch looked exactly
 * like one about to be collected.
 */
const COLLECTION_LABEL: Record<string, string> = {
  UNASSIGNED: 'Finding a delivery partner',
  OFFERED: 'Offered to a delivery partner',
  DECLINED: 'Finding another delivery partner',
  OFFER_EXPIRED: 'Finding another delivery partner',
  ASSIGNED: 'Partner on the way to you',
  AT_VENDOR: 'Partner is here',
  PICKED_UP: 'Collected',
  EN_ROUTE_TO_CUSTOMER: 'On the way to the customer',
  ARRIVED: 'At the customer',
  DELIVERED: 'Delivered',
  RETURN_REQUIRED: 'Coming back to you',
  RETURN_IN_PROGRESS: 'Coming back to you',
  RETURNED: 'Returned to you',
  ENDED_BEFORE_PICKUP: 'Partner left before collecting',
};

/** The partner has left, or is about to — the shop needs to know now. */
const WAIT_WARNING: Record<string, string> = {
  THRESHOLD_ONE: 'The partner has been waiting a while.',
  THRESHOLD_TWO: 'The partner may leave shortly and still be paid for waiting.',
  LEFT_POLICY: 'The partner left after waiting. This order needs a new partner.',
};

const ENDED_BY_LABEL: Record<string, string> = {
  customer: 'the customer',
  vendor_staff: 'this store',
  system: 'the system',
};

type Pick = {
  pick_id: string;
  vendor_order_line_id: string;
  /**
   * PROPOSED_* means the customer has been asked and has not answered;
   * *_APPROVED / *_REJECTED is their decision coming back (VEN-32).
   */
  pick_state: string;
  decision_deadline_at?: string | null;
  actual_quantity: number | null;
  actual_unit_price_minor: number | null;
  product_title: string | null;
  ordered_quantity: number | null;
  ordered_unit_price_minor: number | null;
};

type Variant = {
  readonly catalogue_variant_id: string;
  readonly title: string;
  readonly price_minor: number | null;
};

/**
 * Standardised decline reasons (VEN-27).
 *
 * Decline previously sent one hardcoded `VENDOR_UNAVAILABLE` for every case, so
 * the vendor-health reporting that reads these could not tell a stock problem
 * from a closed shop from a pricing error.
 */
const DECLINE_REASONS = [
  ['VENDOR_CLOSED', 'We are closed right now'],
  ['STOCK_MISMATCH', 'We do not have these items'],
  ['WORKLOAD', 'Too busy to prepare this in time'],
  ['SERVICEABILITY', 'We cannot serve that address'],
  ['PRICING_ERROR', 'The listed price is wrong'],
  ['PROHIBITED_ITEM', 'Something here we may not sell'],
  ['TECHNICAL_ISSUE', 'A technical problem at our end'],
] as const;

/** Why the customer's own code could not be used. Recorded on the order event. */
const PICKUP_FALLBACK_REASONS = [
  ['CUSTOMER_DEVICE_UNAVAILABLE', 'Their phone is off or out of battery'],
  ['CUSTOMER_NO_CONNECTIVITY', 'They cannot get online to see it'],
  ['CUSTOMER_APP_UNAVAILABLE', 'They do not have the app'],
  ['COLLECTED_BY_SOMEONE_ELSE', 'Someone else is collecting for them'],
] as const;

/**
 * Why the delivery partner's own code could not be used.
 *
 * The partner has already marked arrival from their device, so "no app" is not
 * among these; what remains is a phone that died at the counter or a code that
 * will not load.
 */
const PARTNER_FALLBACK_REASONS = [
  ['PARTNER_DEVICE_UNAVAILABLE', 'Their phone is off or out of battery'],
  ['PARTNER_NO_CONNECTIVITY', 'They cannot get online to see it'],
] as const;

/**
 * Who the shop hands the order to, and the words for it.
 *
 * One handover control served every order and called the code the
 * "customer's collection code" -- on a platform delivery, where the customer is
 * at home holding a delivery code for their door and a rider is the one at the
 * counter. The shopkeeper was asked for a number nobody had.
 */
function handoverCopy(method: string) {
  if (method === 'PLATFORM_DELIVERY') {
    return {
      label: 'Delivery partner’s pickup code',
      hint: 'Ask the partner to read it from their job screen.',
      proofNote: 'Handed to the delivery partner.',
      fallbackPrompt: 'Partner can’t show their code',
      fallbackQuestion: 'Why can’t they show their code?',
      reasons: PARTNER_FALLBACK_REASONS,
    };
  }
  return {
    label: 'Customer’s collection code',
    hint: 'Ask the customer to read it from their order screen.',
    proofNote: 'Handed to the customer.',
    fallbackPrompt: 'Customer can’t show their code',
    fallbackQuestion: 'Why can’t they show their code?',
    reasons: PICKUP_FALLBACK_REASONS,
  };
}

const ACTIVE_STATES = new Set([
  'PLACED',
  'ACCEPTED',
  'PICKING',
  'AWAITING_CUSTOMER_DECISION',
  'READY',
]);

/**
 * Whether the shop still has something to do with this order. A collected or
 * partner-delivered order is finished for the shop at PICKED_UP; a self-delivered
 * one is not -- its own staff are on the road and the door is still to come.
 */
function isActiveForShop(order: Order): boolean {
  return (
    ACTIVE_STATES.has(order.lifecycle_state) ||
    (order.lifecycle_state === 'PICKED_UP' && order.fulfilment_method === 'VENDOR_DELIVERY')
  );
}

/** One order, with everything that can be done to it in its current state. */
function OrderCard({
  now,
  onChanged,
  order,
  vendorLocationId,
  variants,
}: {
  readonly order: Order;
  readonly now: number;
  readonly vendorLocationId: string;
  readonly variants: readonly Variant[];
  readonly onChanged: (message: string) => void;
}) {
  const [picks, setPicks] = useState<readonly Pick[] | null>(null);
  const [pickSheet, setPickSheet] = useState(false);
  const [declineSheet, setDeclineSheet] = useState(false);
  const [declineReason, setDeclineReason] = useState<string>('STOCK_MISMATCH');
  const [weightFor, setWeightFor] = useState<Pick | null>(null);
  const [weightValue, setWeightValue] = useState('');
  const [weightPrice, setWeightPrice] = useState('');
  const [substituteFor, setSubstituteFor] = useState<Pick | null>(null);
  const [substituteVariant, setSubstituteVariant] = useState('');
  const [preparationMinutes, setPreparationMinutes] = useState('15');
  const [packageCount, setPackageCount] = useState('1');
  const [pickupOtp, setPickupOtp] = useState<string | null>(null);
  const [otpEntry, setOtpEntry] = useState('');
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const copy = handoverCopy(order.fulfilment_method);
  const [fallbackReason, setFallbackReason] = useState<string>(copy.reasons[0][0] as string);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const base = `vendor/locations/${vendorLocationId}/orders/${order.vendor_order_id}`;

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    return vendorRequest<T>(`${base}${path}`, init);
  }

  async function act(path: string, body: object = {}, describedAs?: string) {
    setBusy(true);
    setError(null);
    const payload = JSON.stringify(body);
    try {
      await call(`/${path}`, { method: 'POST', body: payload });
      onChanged(`${(describedAs ?? path).replaceAll('-', ' ')} recorded.`);
    } catch (cause) {
      // A dropped connection is not a refusal. The action is held with the
      // version it was built against, so replaying it later either applies once
      // or is rejected as stale — never applied twice.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueue({
          path: `${base}/${path}`,
          method: 'POST',
          body: payload,
          describedAs: `${(describedAs ?? path).replaceAll('-', ' ')} on ${order.order_reference}`,
        });
        onChanged(`Saved offline: it will send when you reconnect.`);
        return;
      }
      setError(cause instanceof Error ? cause.message : 'That action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function openPicks() {
    setError(null);
    try {
      const body = await call<{ picks: Pick[] }>('/picks');
      setPicks(body.picks);
      setPickSheet(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The pick list could not be loaded.');
    }
  }

  async function refreshPicks() {
    try {
      const body = await call<{ picks: Pick[] }>('/picks');
      setPicks(body.picks);
    } catch {
      // The sheet keeps the list it has rather than emptying itself.
    }
  }

  const remaining = order.accept_by ? formatCountdown(order.accept_by, now) : null;
  const unresolved = (picks ?? []).filter((pick) => pick.pick_state === 'PENDING').length;

  return (
    <Card as="article" className="order-card" tone="raised">
      <header className="order-card__head">
        <div>
          <StatusPill state={order.lifecycle_state} />
          <p className="ns-eyebrow">{shortReference(order.order_reference)}</p>
        </div>
        <strong className="order-card__total">{formatMoneyMinor(order.total_minor)}</strong>
      </header>

      {/* Why a finished order finished, and who ended it (item 5). */}
      {order.resolution ? (
        <Notice tone={order.resolution.ended_by === 'customer' ? 'warning' : 'information'}>
          {order.lifecycle_state === 'EXPIRED' ? 'Timed out' : 'Cancelled'} by{' '}
          {ENDED_BY_LABEL[order.resolution.ended_by] ?? order.resolution.ended_by} ·{' '}
          {humaniseEnum(order.resolution.reason_code)}
        </Notice>
      ) : null}

      {/* Where the delivery partner is (item 4). Never their identity or position. */}
      {order.collection ? (
        <p className="order-card__collection">
          <StatusPill
            label={
              COLLECTION_LABEL[order.collection.assignment_state] ??
              humaniseEnum(order.collection.assignment_state)
            }
            state={order.collection.assignment_state}
          />
          {order.collection.partner_waiting_since ? (
            <span>
              waiting {formatCountdown(order.collection.partner_waiting_since, now) ?? 'a while'}
            </span>
          ) : null}
        </p>
      ) : null}
      {order.collection?.wait_state && WAIT_WARNING[order.collection.wait_state] ? (
        <Notice
          live="polite"
          tone={order.collection.wait_state === 'LEFT_POLICY' ? 'danger' : 'warning'}
        >
          {WAIT_WARNING[order.collection.wait_state]}
        </Notice>
      ) : null}

      {order.lifecycle_state === 'PLACED' && order.accept_by ? (
        // The deadline is the server's (VEN-28) — a wrong clock on the till
        // cannot make a shop think it has longer than it does.
        <Notice live="polite" tone={remaining === null ? 'danger' : 'warning'}>
          {remaining === null
            ? 'The acceptance window has closed.'
            : `${remaining} left to respond`}
        </Notice>
      ) : null}

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="order-card__actions">
        {order.lifecycle_state === 'PLACED' ? (
          <>
            <Field
              className="order-card__prep"
              inputMode="numeric"
              label="Preparation (minutes)"
              max={240}
              min={1}
              onChange={(event) => setPreparationMinutes(event.target.value)}
              type="number"
              value={preparationMinutes}
            />
            <Button
              busy={busy}
              onClick={() =>
                void act(
                  'accept',
                  {
                    expected_version: order.version,
                    preparation_estimate_seconds:
                      Math.max(1, Number(preparationMinutes) || 15) * 60,
                  },
                  'accept',
                )
              }
            >
              Accept
            </Button>
            <Button onClick={() => setDeclineSheet(true)} variant="danger">
              Decline
            </Button>
          </>
        ) : null}

        {order.lifecycle_state === 'ACCEPTED' ? (
          <Button
            busy={busy}
            onClick={() => void act('start-picking', { expected_version: order.version })}
          >
            Start picking
          </Button>
        ) : null}

        {order.lifecycle_state === 'PICKING' ||
        order.lifecycle_state === 'AWAITING_CUSTOMER_DECISION' ? (
          <>
            <Button onClick={() => void openPicks()} variant="secondary">
              Open pick list
            </Button>
            <Field
              className="order-card__prep"
              inputMode="numeric"
              label="Packages"
              max={100}
              min={1}
              onChange={(event) => setPackageCount(event.target.value)}
              type="number"
              value={packageCount}
            />
            <Button
              busy={busy}
              onClick={() =>
                void act('ready', {
                  expected_version: order.version,
                  package_count: Math.max(1, Number(packageCount) || 1),
                })
              }
            >
              Mark ready
            </Button>
          </>
        ) : null}

        {order.lifecycle_state === 'READY' && order.fulfilment_method === 'VENDOR_DELIVERY' ? (
          // The self-delivery leg (workflow 6.7, VEN-37): the shop's own staff
          // leave with the order. Nothing is validated at the counter -- the
          // customer's code is for the door.
          <>
            <Notice tone="information">
              This order is delivered by your own staff. Start the delivery when it leaves the shop;
              the customer will show a delivery code at the door.
            </Notice>
            <Button
              busy={busy}
              onClick={() =>
                void act(
                  'self-delivery/start',
                  { expected_version: order.version, proof_note: 'Left with store staff.' },
                  'delivery start',
                )
              }
            >
              Start delivery
            </Button>
          </>
        ) : null}

        {order.lifecycle_state === 'PICKED_UP' && order.fulfilment_method === 'VENDOR_DELIVERY' ? (
          // At the door. The customer opens their delivery code (CUS-56) once the
          // order is on its way; staff type it here and the server ends the order.
          <>
            <Notice live="polite" tone="information">
              Out for delivery
              {order.out_for_delivery_at
                ? ` since ${new Date(order.out_for_delivery_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : ''}
              . Ask the customer for their delivery code at the door.
            </Notice>
            <Field
              className="order-card__prep"
              hint="Ask the customer to read it from their order screen."
              inputMode="numeric"
              label="Customer’s delivery code"
              maxLength={6}
              onChange={(event) => setOtpEntry(event.target.value.replace(/\D/g, '').slice(0, 6))}
              value={otpEntry}
            />
            <Button
              busy={busy}
              disabled={!/^\d{6}$/.test(otpEntry)}
              onClick={() =>
                void act(
                  'self-delivery/complete',
                  { otp: otpEntry, proof_note: 'Delivered by store staff.' },
                  'delivery',
                )
              }
            >
              Mark delivered
            </Button>
          </>
        ) : null}

        {order.lifecycle_state === 'READY' &&
        order.fulfilment_method === 'PLATFORM_DELIVERY' &&
        order.collection?.assignment_state !== 'AT_VENDOR' ? (
          // Nobody is at the counter yet. The server refuses handover until the
          // partner has marked arrival (PARTNER_NOT_PRESENT), so the control is
          // not offered; what is shown instead is where the partner is.
          <Notice live="polite" tone="information">
            Hand this order over when the delivery partner is at your counter.
            {order.collection
              ? ` Right now: ${(
                  COLLECTION_LABEL[order.collection.assignment_state] ??
                  humaniseEnum(order.collection.assignment_state)
                ).toLowerCase()}.`
              : ' A partner has not been found yet.'}
          </Notice>
        ) : null}

        {order.lifecycle_state === 'READY' &&
        order.fulfilment_method !== 'VENDOR_DELIVERY' &&
        (order.fulfilment_method !== 'PLATFORM_DELIVERY' ||
          order.collection?.assignment_state === 'AT_VENDOR') ? (
          <>
            {/*
              The collector's own code is the one to ask for -- the customer's
              on a pickup (CUS-51), the partner's on a platform delivery
              (DLP-24); staff validate it (VEN-35). This entry field is
              therefore the primary action, and issuing a code here is the
              fallback below it — the two used to write the same column, so a
              vendor-issued code silently invalidated the code the collector was
              already holding.
            */}
            <Field
              className="order-card__prep"
              hint={copy.hint}
              inputMode="numeric"
              label={copy.label}
              maxLength={6}
              onChange={(event) => setOtpEntry(event.target.value.replace(/\D/g, '').slice(0, 6))}
              value={otpEntry}
            />
            <Button
              busy={busy}
              disabled={!/^\d{6}$/.test(otpEntry)}
              onClick={() =>
                void act(
                  'complete-pickup',
                  { otp: otpEntry, proof_note: copy.proofNote },
                  'handover',
                )
              }
            >
              Complete handover
            </Button>

            {/*
              The alternative-proof path (CUS-51): a customer with a dead phone
              or no signal still has to be able to collect. It is secondary,
              reason-coded, and the server refuses it while the customer's own
              code is live — so it can no longer strand someone at the counter.
            */}
            {fallbackOpen ? (
              <div className="pickup-fallback">
                <SelectField
                  label={copy.fallbackQuestion}
                  onChange={(event) => setFallbackReason(event.target.value)}
                  value={fallbackReason}
                >
                  {copy.reasons.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </SelectField>
                <Button
                  busy={busy}
                  onClick={() =>
                    void (async () => {
                      try {
                        const body = await call<{ plaintext_otp: string; expires_at: string }>(
                          '/pickup-otp',
                          {
                            method: 'POST',
                            body: JSON.stringify({ reason_code: fallbackReason }),
                          },
                        );
                        setPickupOtp(body.plaintext_otp);
                        setFallbackOpen(false);
                      } catch (cause) {
                        setError(
                          cause instanceof Error ? cause.message : 'The code could not be issued.',
                        );
                      }
                    })()
                  }
                  variant="secondary"
                >
                  Issue a fallback code
                </Button>
                <Button onClick={() => setFallbackOpen(false)} variant="ghost">
                  Cancel
                </Button>
              </div>
            ) : (
              <Button onClick={() => setFallbackOpen(true)} variant="ghost">
                {copy.fallbackPrompt}
              </Button>
            )}
            {pickupOtp ? (
              <Notice live="polite" tone="warning">
                Fallback code <strong className="pickup-otp">{pickupOtp}</strong>. Type it into the
                field above to complete the handover. This is recorded as an exception.
              </Notice>
            ) : null}
          </>
        ) : null}
      </div>

      {/* ── Decline, with its consequences stated first (VEN-27) ───────────── */}
      <Sheet
        footer={
          <Button
            block
            busy={busy}
            onClick={() =>
              void (async () => {
                await act(
                  'decline',
                  {
                    expected_version: order.version,
                    reason_code: declineReason,
                    note:
                      DECLINE_REASONS.find(([id]) => id === declineReason)?.[1] ??
                      'Store cannot fulfil this order.',
                  },
                  'decline',
                );
                setDeclineSheet(false);
              })()
            }
            variant="danger"
          >
            Decline this order
          </Button>
        }
        onClose={() => setDeclineSheet(false)}
        open={declineSheet}
        title="Decline this order"
      >
        <Notice tone="warning">
          The customer is refunded {formatMoneyMinor(order.total_minor)} for this order, its stock
          hold is released, and no completion fee is charged to you. Their orders from other shops
          are unaffected.
        </Notice>
        <SelectField
          hint="This is recorded against your store’s acceptance record, so the reason matters."
          label="Why can you not fulfil it?"
          onChange={(event) => setDeclineReason(event.target.value)}
          value={declineReason}
        >
          {DECLINE_REASONS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </SelectField>
      </Sheet>

      {/* ── Pick list ─────────────────────────────────────────────────────── */}
      <Sheet
        onClose={() => setPickSheet(false)}
        open={pickSheet}
        title={`Pick list · ${unresolved} to resolve`}
      >
        {(picks ?? []).length === 0 ? (
          <EmptyState glyph="◌" title="No lines on this order" />
        ) : (
          <ul className="pick-list">
            {(picks ?? []).map((pick) => {
              const proposed = pick.pick_state.startsWith('PROPOSED_');
              const deadline = pick.decision_deadline_at
                ? formatCountdown(pick.decision_deadline_at, now)
                : null;
              return (
                <li key={pick.pick_id}>
                  <Card tone="sunken">
                    <strong>{displayName(pick.product_title ?? 'Line')}</strong>
                    <p className="pick-list__meta">
                      {pick.ordered_quantity ?? '?'} ordered
                      {pick.ordered_unit_price_minor === null
                        ? ''
                        : ` · ${formatMoneyMinor(pick.ordered_unit_price_minor)} each`}
                    </p>
                    <StatusPill
                      label={
                        proposed
                          ? deadline === null
                            ? 'Customer did not answer in time'
                            : `Waiting on the customer · ${deadline}`
                          : pick.pick_state.replaceAll('_', ' ').toLowerCase()
                      }
                      state={proposed ? 'AWAITING_CUSTOMER_DECISION' : pick.pick_state}
                    />
                    {pick.pick_state === 'PENDING' ? (
                      <div className="ns-row">
                        <Button
                          onClick={() =>
                            void (async () => {
                              await act(
                                `lines/${pick.vendor_order_line_id}/found`,
                                {
                                  actual_quantity:
                                    pick.actual_quantity ?? pick.ordered_quantity ?? 1,
                                  actual_unit_price_minor:
                                    pick.actual_unit_price_minor ??
                                    pick.ordered_unit_price_minor ??
                                    0,
                                },
                                'line found',
                              );
                              await refreshPicks();
                            })()
                          }
                          size="small"
                        >
                          Found it
                        </Button>
                        <Button
                          onClick={() => {
                            setWeightFor(pick);
                            setWeightValue(String(pick.ordered_quantity ?? 1));
                            setWeightPrice(
                              pick.ordered_unit_price_minor === null
                                ? ''
                                : (pick.ordered_unit_price_minor / 100).toFixed(2),
                            );
                          }}
                          size="small"
                          variant="secondary"
                        >
                          Weigh
                        </Button>
                        <Button
                          onClick={() => {
                            setSubstituteFor(pick);
                            setSubstituteVariant(variants[0]?.catalogue_variant_id ?? '');
                          }}
                          size="small"
                          variant="secondary"
                        >
                          Substitute
                        </Button>
                        <Button
                          onClick={() =>
                            void (async () => {
                              await act(
                                `lines/${pick.vendor_order_line_id}/missing`,
                                {},
                                'line missing',
                              );
                              await refreshPicks();
                            })()
                          }
                          size="small"
                          variant="danger"
                        >
                          Not available
                        </Button>
                      </div>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>

      {/* ── Weight entry (VEN-30) ─────────────────────────────────────────── */}
      <Sheet
        footer={
          <Button
            block
            busy={busy}
            disabled={parseRupeesToMinor(weightPrice) === null || !(Number(weightValue) > 0)}
            onClick={() =>
              void (async () => {
                const unitPrice = parseRupeesToMinor(weightPrice);
                if (weightFor === null || unitPrice === null) return;
                await act(
                  `lines/${weightFor.vendor_order_line_id}/propose-weight`,
                  {
                    proposed_quantity: Math.round(Number(weightValue)),
                    proposed_unit_price_minor: unitPrice,
                    reason_note: 'Weighed at the counter; customer decides.',
                  },
                  'weight proposal',
                );
                setWeightFor(null);
                await refreshPicks();
              })()
            }
          >
            Send to the customer
          </Button>
        }
        onClose={() => setWeightFor(null)}
        open={weightFor !== null}
        title={`Weigh ${displayName(weightFor?.product_title ?? 'this line')}`}
      >
        {/* Replaces a `window.prompt`, which cannot be used one-handed on a
            phone, carries no label a screen reader can read, and offered no way
            to correct a mistyped number before it was sent. */}
        <Field
          hint="As measured at the counter."
          inputMode="numeric"
          label="Measured quantity"
          onChange={(event) => setWeightValue(event.target.value)}
          type="number"
          value={weightValue}
        />
        <Field
          hint="Rupees per unit, with up to two decimal places."
          inputMode="decimal"
          label="Price per unit (₹)"
          onChange={(event) => setWeightPrice(event.target.value)}
          value={weightPrice}
        />
        <Notice tone="information">
          The customer sees the difference and approves or rejects it before you pack.
        </Notice>
      </Sheet>

      {/* ── Substitution (VEN-31) ─────────────────────────────────────────── */}
      <Sheet
        footer={
          <Button
            block
            busy={busy}
            disabled={substituteVariant === ''}
            onClick={() =>
              void (async () => {
                if (substituteFor === null) return;
                await act(
                  `lines/${substituteFor.vendor_order_line_id}/propose-substitution`,
                  {
                    substitution_variant_id: substituteVariant,
                    proposed_quantity: substituteFor.ordered_quantity ?? 1,
                    proposed_unit_price_minor:
                      variants.find((v) => v.catalogue_variant_id === substituteVariant)
                        ?.price_minor ??
                      substituteFor.ordered_unit_price_minor ??
                      0,
                    reason_note: 'Ordered item unavailable; replacement offered.',
                  },
                  'substitution proposal',
                );
                setSubstituteFor(null);
                await refreshPicks();
              })()
            }
          >
            Offer this replacement
          </Button>
        }
        onClose={() => setSubstituteFor(null)}
        open={substituteFor !== null}
        title={`Replace ${displayName(substituteFor?.product_title ?? 'this line')}`}
      >
        {/* Chosen from this store's own catalogue. The previous flow asked a
            shopkeeper to type a variant UUID into a `window.prompt`. */}
        {variants.length === 0 ? (
          <Notice tone="warning">
            This store has no other published products to offer as a replacement.
          </Notice>
        ) : (
          <SelectField
            hint="Only products this store already publishes can be offered."
            label="Replacement product"
            onChange={(event) => setSubstituteVariant(event.target.value)}
            value={substituteVariant}
          >
            {variants.map((variant) => (
              <option key={variant.catalogue_variant_id} value={variant.catalogue_variant_id}>
                {displayName(variant.title)}
                {variant.price_minor === null ? '' : ` — ${formatMoneyMinor(variant.price_minor)}`}
              </option>
            ))}
          </SelectField>
        )}
        <Notice tone="information">
          The customer decides. Their recorded preference may reject it automatically.
        </Notice>
      </Sheet>
    </Card>
  );
}

/** The live fulfilment queue for one store location. */
export function OrdersPanel({ vendorLocationId }: { readonly vendorLocationId: string }) {
  const [orders, setOrders] = useState<readonly Order[]>([]);
  const [variants, setVariants] = useState<readonly Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const loadOrders = useCallback(async () => {
    try {
      const client = await vendorApiClient();
      const body = (await client.vendor.fulfilment.pendingOrders(vendorLocationId)) as unknown as {
        orders: Order[];
      };
      setOrders(body.orders);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Orders could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [vendorLocationId]);

  // The store's own published variants, so a substitution is a choice rather
  // than a typed identifier.
  const loadVariants = useCallback(async () => {
    type CatalogueProduct = {
      readonly title: string;
      readonly variants: readonly {
        readonly catalogue_variant_id: string;
        readonly price_minor: number | null;
        readonly title: string;
        readonly lifecycle_state: string;
      }[];
    };
    try {
      const response = await vendorRequest<
        readonly CatalogueProduct[] | { readonly data?: readonly CatalogueProduct[] }
      >(`vendor/locations/${vendorLocationId}/catalogue/products`);
      // The endpoint has been seen to answer both bare and envelope-wrapped.
      const products: readonly CatalogueProduct[] = Array.isArray(response)
        ? (response as readonly CatalogueProduct[])
        : ((response as { readonly data?: readonly CatalogueProduct[] }).data ?? []);
      setVariants(
        products.flatMap((product) =>
          product.variants
            .filter((variant) => variant.lifecycle_state === 'ACTIVE')
            .map((variant) => ({
              catalogue_variant_id: variant.catalogue_variant_id,
              price_minor: variant.price_minor,
              title: product.title,
            })),
        ),
      );
    } catch {
      // Without the list the substitution sheet says so, rather than offering
      // an empty picker that silently sends nothing.
      setVariants([]);
    }
  }, [vendorLocationId]);

  useEffect(() => {
    void loadOrders();
    void loadVariants();
  }, [loadOrders, loadVariants]);

  /**
   * New orders arrive without anyone pressing refresh (VEN-24).
   *
   * A shop cannot watch a screen and click; an order that sits unnoticed runs
   * down the acceptance deadline and auto-declines. Polling is the honest
   * mechanism here — the local stack has no push channel — and it stops while
   * the tab is hidden so a backgrounded till does not hammer the API.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadOrders();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [loadOrders]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const flushQueue = useCallback(async () => {
    const result = await drain(async (action) => {
      await vendorRequest(action.path, {
        method: action.method,
        ...(action.body === null ? {} : { body: action.body }),
      });
    });
    setPending(result.remaining);
    if (result.sent > 0) {
      setNotice(`${result.sent} offline action${result.sent === 1 ? '' : 's'} sent.`);
      await loadOrders();
    }
  }, [loadOrders]);

  useEffect(() => {
    setPending(queuedActions().length);
    const reconnected = () => void flushQueue();
    window.addEventListener('online', reconnected);
    if (typeof navigator !== 'undefined' && navigator.onLine) void flushQueue();
    return () => window.removeEventListener('online', reconnected);
  }, [flushQueue]);

  // `active` used to be computed and then ignored: the heading counted active
  // orders while the list rendered every order ever placed, so a busy shop read
  // "2 active orders" above a wall of twenty finished ones. Splitting them keeps
  // the handed-off and cancelled history — a shopkeeper needs to see that an
  // order was cancelled and why — without burying the work in front of them.
  const active = orders.filter((order) => isActiveForShop(order));
  const finished = orders.filter((order) => !isActiveForShop(order));

  return (
    <Panel
      actions={
        <Button onClick={() => void loadOrders()} variant="secondary">
          Refresh
        </Button>
      }
      description="Orders needing a decision come first. New orders arrive on their own."
      eyebrow="Live fulfilment"
      id="orders"
      level={2}
      title={`${active.length} active ${active.length === 1 ? 'order' : 'orders'}`}
    >
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {pending > 0 ? (
        <Notice tone="warning">
          {pending} action{pending === 1 ? '' : 's'} waiting to send.{' '}
          <button className="ns-text-action" onClick={() => void flushQueue()} type="button">
            Try now
          </button>
        </Notice>
      ) : null}

      {loading ? (
        <LoadingState label="Loading store orders…" lines={3} />
      ) : error ? (
        <Notice tone="danger">{error}</Notice>
      ) : orders.length === 0 ? (
        <EmptyState
          description="New orders appear here as soon as a customer places one."
          glyph="◷"
          title="No orders yet"
        />
      ) : (
        <>
          {active.length === 0 ? (
            <EmptyState
              description="Everything is handled. New orders appear here on their own."
              glyph="✓"
              title="Nothing needs you right now"
            />
          ) : (
            <div className="order-list">
              {active.map((order) => (
                <OrderCard
                  key={order.vendor_order_id}
                  now={now}
                  onChanged={(message) => {
                    setNotice(message);
                    void loadOrders();
                  }}
                  order={order}
                  variants={variants}
                  vendorLocationId={vendorLocationId}
                />
              ))}
            </div>
          )}

          {finished.length > 0 ? (
            <details className="order-history">
              <summary>
                Finished today · {finished.length}
                {finished.some((order) => order.resolution?.ended_by === 'customer')
                  ? ' · includes a customer cancellation'
                  : ''}
              </summary>
              <div className="order-list">
                {finished.map((order) => (
                  <OrderCard
                    key={order.vendor_order_id}
                    now={now}
                    onChanged={(message) => {
                      setNotice(message);
                      void loadOrders();
                    }}
                    order={order}
                    variants={variants}
                    vendorLocationId={vendorLocationId}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </>
      )}
    </Panel>
  );
}
