'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  LoadingState,
  Notice,
  Panel,
  StatusPill,
  formatMoneyMinor,
} from '@neighbourhood-store/ui';
import { vendorRequest } from './authenticated-api';
import { shortReference } from './display';

/**
 * A store's own numbers (VEN-45, VEN-47) and the cases open against it (VEN-43).
 *
 * Every figure is a count the shopkeeper can check against their own memory of
 * the week. The screen this replaces stated "12 orders · 96% accepted" from
 * nothing at all — a number nobody could verify and nobody should have
 * believed.
 *
 * Rates are shown as "3 of 4", not "75%": with a handful of orders a
 * percentage implies a precision the sample does not carry.
 */
type Insights = {
  readonly window_days: number;
  readonly orders_total: number;
  readonly orders_accepted: number;
  readonly orders_declined: number;
  readonly orders_expired: number;
  readonly orders_cancelled: number;
  readonly orders_completed: number;
  readonly gross_minor: number;
  readonly median_preparation_seconds: number | null;
  readonly rating_average: number | null;
  readonly rating_count: number;
  readonly decline_reasons: readonly { readonly reason_code: string; readonly count: number }[];
};

type SupportCase = {
  readonly support_case_id: string;
  readonly vendor_order_id: string;
  readonly order_reference: string;
  readonly category: string;
  readonly lifecycle_state: string;
  readonly created_at: string;
};

function minutes(seconds: number): string {
  const whole = Math.round(seconds / 60);
  return `${whole} min`;
}

export function InsightsPanel({ vendorLocationId }: { readonly vendorLocationId: string }) {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [cases, setCases] = useState<readonly SupportCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [summary, caseBody] = await Promise.all([
        vendorRequest<Insights>(`vendor/locations/${vendorLocationId}/insights`),
        vendorRequest<{ cases?: readonly SupportCase[] }>(
          `vendor/locations/${vendorLocationId}/insights/support-cases`,
        ).catch(() => ({ cases: [] as readonly SupportCase[] })),
      ]);
      setInsights(summary);
      setCases(caseBody.cases ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your numbers could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [vendorLocationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState label="Loading your numbers…" lines={4} />;

  return (
    <div className="ns-stack">
      {/* VEN-43: the instruction stays with the store until the case closes. */}
      {cases.length > 0 ? (
        <Panel
          description="Support is working these with the customer. They stay here until they close."
          eyebrow="Needs your attention"
          id="vendor-cases"
          level={2}
          title={`${cases.length} open ${cases.length === 1 ? 'case' : 'cases'}`}
        >
          <ul className="case-list">
            {cases.map((entry) => (
              <li key={entry.support_case_id}>
                <Card tone="sunken">
                  <div className="ns-row">
                    <strong>{entry.category.replaceAll('_', ' ').toLowerCase()}</strong>
                    <StatusPill state={entry.lifecycle_state} />
                  </div>
                  <p className="field-help">
                    Order {shortReference(entry.order_reference)} · raised{' '}
                    {new Date(entry.created_at).toLocaleDateString()} · case{' '}
                    {shortReference(entry.support_case_id)}
                  </p>
                  <p className="field-help">
                    Quote the case reference if you contact support about it. Do not cancel or
                    refund the order yourself — support settles it with the customer.
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel
        actions={
          <Button onClick={() => void load()} variant="secondary">
            Refresh
          </Button>
        }
        description={
          insights ? `Your last ${insights.window_days} days, from your own orders.` : undefined
        }
        eyebrow="Your store"
        id="insights"
        level={2}
        title="How trading is going"
      >
        {error ? <Notice tone="danger">{error}</Notice> : null}

        {insights === null || insights.orders_total === 0 ? (
          <EmptyState
            description="Once customers start ordering, your counts appear here."
            glyph="◌"
            title="No orders in this period"
          />
        ) : (
          <>
            <div className="insight-grid">
              <Card tone="sunken">
                <p className="eyebrow">Orders</p>
                <strong>{insights.orders_total}</strong>
                <small>{insights.orders_completed} completed</small>
              </Card>
              <Card tone="sunken">
                <p className="eyebrow">Sales completed</p>
                <strong>{formatMoneyMinor(insights.gross_minor, 'compact')}</strong>
                <small>before fees</small>
              </Card>
              <Card tone="sunken">
                <p className="eyebrow">Accepted</p>
                {/* "3 of 4", never "75%" — see the note above. */}
                <strong>
                  {insights.orders_accepted} of {insights.orders_total}
                </strong>
                <small>
                  {insights.orders_declined} declined · {insights.orders_expired} timed out
                </small>
              </Card>
              <Card tone="sunken">
                <p className="eyebrow">Typical preparation</p>
                <strong>
                  {insights.median_preparation_seconds === null
                    ? '—'
                    : minutes(insights.median_preparation_seconds)}
                </strong>
                <small>middle of your accepted orders</small>
              </Card>
              <Card tone="sunken">
                <p className="eyebrow">Rating</p>
                <strong>
                  {insights.rating_average === null
                    ? 'Not rated'
                    : `${insights.rating_average.toFixed(1)} ★`}
                </strong>
                <small>
                  {insights.rating_count === 0
                    ? 'no ratings yet'
                    : `${insights.rating_count} rating${insights.rating_count === 1 ? '' : 's'}`}
                </small>
              </Card>
              <Card tone="sunken">
                <p className="eyebrow">Cancelled</p>
                <strong>{insights.orders_cancelled}</strong>
                <small>after you accepted</small>
              </Card>
            </div>

            {insights.orders_expired > 0 ? (
              <Notice tone="warning">
                {insights.orders_expired === 1
                  ? 'One order timed out before you answered it.'
                  : `${insights.orders_expired} orders timed out before you answered them.`}{' '}
                A timed-out order is cancelled for the customer and earns you nothing — check your
                alert settings if this keeps happening.
              </Notice>
            ) : null}

            {insights.decline_reasons.length > 0 ? (
              <Card tone="sunken">
                <p className="eyebrow">Why you declined</p>
                <ul className="reason-list">
                  {insights.decline_reasons.map((reason) => (
                    <li key={reason.reason_code}>
                      <span>{reason.reason_code.replaceAll('_', ' ').toLowerCase()}</span>
                      <span>{reason.count}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </>
        )}
      </Panel>
    </div>
  );
}
