import type { ReactNode } from 'react';
import { cx } from './classnames.js';
import { humaniseEnum } from './format.js';

export type StatusTone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger' | 'information';

/**
 * Every lifecycle state the four surfaces display, mapped to a tone, a glyph
 * and customer-readable copy.
 *
 * The apps were printing raw constants — `AWAITING_CUSTOMER_DECISION`,
 * `RETURN_AUTHORIZED` — straight at customers, vendors and partners. Colour on
 * its own is also not allowed to carry state (UX-07), so every entry supplies a
 * glyph and a word, and the pill renders both.
 */
const STATE_PRESENTATION: Readonly<
  Record<
    string,
    {
      readonly tone: StatusTone;
      readonly glyph: string;
      readonly label: string;
      readonly key: string;
    }
  >
> = {
  // Checkout group
  PROCESSING: { tone: 'progress', glyph: '◐', label: 'Processing', key: 'state.processing' },
  ACTIVE: { tone: 'progress', glyph: '◐', label: 'In progress', key: 'state.active' },
  PARTIALLY_COMPLETED: {
    tone: 'progress',
    glyph: '◑',
    label: 'Partly delivered',
    key: 'state.partially_completed',
  },
  PARTIALLY_CANCELLED: {
    tone: 'warning',
    glyph: '⚠',
    label: 'Partly cancelled',
    key: 'state.partially_cancelled',
  },
  COMPLETED: { tone: 'success', glyph: '✓', label: 'Completed', key: 'state.completed' },
  PAYMENT_UNKNOWN: {
    tone: 'warning',
    glyph: '⏳',
    label: 'Confirming payment',
    key: 'state.payment_unknown',
  },

  // Vendor order
  PLACED: { tone: 'progress', glyph: '◷', label: 'Waiting for the store', key: 'state.placed' },
  ACCEPTED: { tone: 'progress', glyph: '✓', label: 'Store accepted', key: 'state.accepted' },
  PICKING: { tone: 'progress', glyph: '◍', label: 'Being packed', key: 'state.picking' },
  AWAITING_CUSTOMER_DECISION: {
    tone: 'warning',
    glyph: '?',
    label: 'Needs your answer',
    key: 'state.awaiting_customer_decision',
  },
  READY: { tone: 'success', glyph: '◉', label: 'Ready', key: 'state.ready' },
  OUT_FOR_DELIVERY: {
    tone: 'progress',
    glyph: '→',
    label: 'On the way',
    key: 'state.out_for_delivery',
  },
  DELIVERED: { tone: 'success', glyph: '✓', label: 'Delivered', key: 'state.delivered' },
  PICKED_UP: { tone: 'success', glyph: '✓', label: 'Collected', key: 'state.picked_up' },
  EXPIRED: { tone: 'danger', glyph: '✕', label: 'Store did not respond', key: 'state.expired' },
  CANCELLED: { tone: 'danger', glyph: '✕', label: 'Cancelled', key: 'state.cancelled' },
  REJECTED: { tone: 'danger', glyph: '✕', label: 'Declined by store', key: 'state.rejected' },
  REFUNDED: { tone: 'information', glyph: '↩', label: 'Refunded', key: 'state.refunded' },
  RETURNED: { tone: 'information', glyph: '↩', label: 'Returned', key: 'state.returned' },

  // Assignment and custody
  UNASSIGNED: { tone: 'neutral', glyph: '○', label: 'Not assigned', key: 'state.unassigned' },
  OFFERED: { tone: 'progress', glyph: '◷', label: 'Offered', key: 'state.offered' },
  ASSIGNED: { tone: 'progress', glyph: '◍', label: 'Assigned', key: 'state.assigned' },
  AT_VENDOR: { tone: 'progress', glyph: '⌂', label: 'At the store', key: 'state.at_vendor' },
  WAITING: { tone: 'warning', glyph: '◷', label: 'Waiting at the store', key: 'state.waiting' },
  EN_ROUTE_TO_CUSTOMER: {
    tone: 'progress',
    glyph: '→',
    label: 'On the way',
    key: 'state.en_route_to_customer',
  },
  ARRIVED: { tone: 'progress', glyph: '◉', label: 'Arrived', key: 'state.arrived' },
  DELIVERY_FAILED: {
    tone: 'danger',
    glyph: '✕',
    label: 'Delivery failed',
    key: 'state.delivery_failed',
  },
  RETURN_REQUIRED: {
    tone: 'warning',
    glyph: '↩',
    label: 'Return needed',
    key: 'state.return_required',
  },
  RETURN_AUTHORIZED: {
    tone: 'information',
    glyph: '↩',
    label: 'Return authorised',
    key: 'state.return_authorized',
  },
  RETURNING: { tone: 'progress', glyph: '↩', label: 'Returning', key: 'state.returning' },
  IN_CUSTODY: { tone: 'progress', glyph: '▣', label: 'With the partner', key: 'state.in_custody' },
  PICKUP_VERIFIED: {
    tone: 'success',
    glyph: '✓',
    label: 'Pickup verified',
    key: 'state.pickup_verified',
  },

  // Availability and inventory
  AVAILABLE: { tone: 'success', glyph: '✓', label: 'In stock', key: 'state.available' },
  LOW_STOCK: { tone: 'warning', glyph: '⚠', label: 'Low stock', key: 'state.low_stock' },
  VENDOR_CONFIRMS: {
    tone: 'information',
    glyph: '?',
    label: 'Store confirms',
    key: 'state.vendor_confirms',
  },
  OUT_OF_STOCK: { tone: 'danger', glyph: '✕', label: 'Out of stock', key: 'state.out_of_stock' },
  SOFT_HELD: { tone: 'progress', glyph: '◷', label: 'Held briefly', key: 'state.soft_held' },
  PROVISIONAL: { tone: 'progress', glyph: '◐', label: 'Provisional', key: 'state.provisional' },
  COMMITTED: { tone: 'success', glyph: '✓', label: 'Committed', key: 'state.committed' },
  RELEASED: { tone: 'neutral', glyph: '○', label: 'Released', key: 'state.released' },

  // Support and review
  OPEN: { tone: 'warning', glyph: '◉', label: 'Open', key: 'state.open' },
  RESOLVED: { tone: 'success', glyph: '✓', label: 'Resolved', key: 'state.resolved' },
  CLOSED: { tone: 'neutral', glyph: '○', label: 'Closed', key: 'state.closed' },
  PENDING_APPROVAL: {
    tone: 'warning',
    glyph: '◷',
    label: 'Awaiting approval',
    key: 'state.pending_approval',
  },
};

/** The tone and wording for a wire state, degrading safely for anything new. */
export function describeState(state: string): {
  readonly tone: StatusTone;
  readonly glyph: string;
  readonly label: string;
  readonly key: string;
} {
  return (
    STATE_PRESENTATION[state.toUpperCase()] ?? {
      tone: 'neutral',
      glyph: '•',
      label: humaniseEnum(state),
      key: `state.${state.toLowerCase()}`,
    }
  );
}

export type StatusPillProps = {
  /** A wire lifecycle state. Presentation is looked up, never passed in raw. */
  readonly state: string;
  readonly className?: string | undefined;
  /** Overrides the looked-up copy where a screen has better context. */
  readonly label?: string | undefined;
  /**
   * The surface's translator.
   *
   * Without it the shared state vocabulary would be a hardcoded English island
   * inside an otherwise translated app (MKT-11). Each state carries a stable
   * `state.<name>` key and its English wording as the fallback.
   */
  readonly translate?: ((key: string, fallback: string) => string) | undefined;
};

/** State as glyph plus word plus colour — never colour alone (UX-07). */
export function StatusPill({ className, label, state, translate }: StatusPillProps) {
  const presentation = describeState(state);
  const wording = label ?? translate?.(presentation.key, presentation.label) ?? presentation.label;
  return (
    <span className={cx('ns-pill', `ns-pill--${presentation.tone}`, className)}>
      <span aria-hidden="true" className="ns-pill__glyph">
        {presentation.glyph}
      </span>
      {wording}
    </span>
  );
}

export type TimelineEntry = {
  readonly id: string;
  readonly state: string;
  readonly at: string;
  readonly actor?: string | undefined;
  readonly detail?: ReactNode | undefined;
};

/**
 * An order's transition history (CUS-47, VEN-39).
 *
 * An ordered list, so a screen reader announces position and count rather than
 * reading a decorative column of divs.
 */
export function Timeline({
  className,
  entries,
}: {
  readonly entries: readonly TimelineEntry[];
  readonly className?: string | undefined;
}) {
  if (entries.length === 0) return null;
  return (
    <ol className={cx('ns-timeline', className)}>
      {entries.map((entry, index) => {
        const presentation = describeState(entry.state);
        const current = index === entries.length - 1;
        return (
          <li
            className={cx('ns-timeline__item', current && 'ns-timeline__item--current')}
            key={entry.id}
          >
            <span aria-hidden="true" className="ns-timeline__marker">
              {presentation.glyph}
            </span>
            <div className="ns-timeline__body">
              <strong className="ns-timeline__label">
                {presentation.label}
                {current ? <span className="sr-only"> — current step</span> : null}
              </strong>
              <time className="ns-timeline__time" dateTime={entry.at}>
                {new Date(entry.at).toLocaleString()}
              </time>
              {entry.actor ? <span className="ns-timeline__actor">{entry.actor}</span> : null}
              {entry.detail ? <p className="ns-timeline__detail">{entry.detail}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
