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
import { partnerRequest } from './authenticated-api';
import { displayArea, shortReference } from './display';

/**
 * Standing, verification and past work (DLP-03, DLP-04, DLP-16, DLP-47, DLP-54, DLP-56).
 *
 * The screen used to state "ID verified · 184 days" from nothing at all, and
 * then — after that was fixed — asked the partner to type their own
 * application UUID into a text box before it would show anything. The session
 * identifies the application, so it simply loads.
 */
type Assignment = {
  readonly delivery_assignment_id: string;
  readonly assignment_state: string;
  readonly source_order_reference: string;
  readonly approximate_drop_area?: string;
};

type Availability = {
  readonly availability_state?: string;
  readonly trips_today?: string;
  readonly earnings_today_minor?: string;
  readonly warning_codes?: readonly string[];
};

type Application = {
  readonly partner_application_id: string;
  readonly lifecycle_state: string;
  readonly vehicle_kind: string;
  readonly home_zone_name: string;
  readonly reason_code: string | null;
  readonly reason_note: string | null;
};

type Restriction = {
  readonly trust_restriction_case_id: string;
  readonly lifecycle_state: string;
  readonly scope_kind: string;
  readonly reason_code: string;
  readonly policy_reference: string;
  readonly effective_until: string;
  readonly review_at: string;
  readonly appealable: boolean;
};

/**
 * Warning codes in the partner's own words.
 *
 * These drive whether someone can work, so `DOCUMENT_EXPIRING` is not an
 * adequate thing to show the person it stops (DLP-04).
 */
const WARNINGS: Readonly<Record<string, string>> = {
  DOCUMENT_EXPIRING: 'One of your documents expires soon — renew it to keep working.',
  DOCUMENT_EXPIRED: 'A document has expired. You cannot take work until it is renewed.',
  INSURANCE_EXPIRING: 'Your insurance expires soon.',
  INSURANCE_EXPIRED: 'Your insurance has expired.',
  TRAINING_INCOMPLETE: 'Some required training is still outstanding.',
  BANK_DETAILS_MISSING: 'We have no payout account for you, so earnings cannot be paid out.',
  LOW_BATTERY: 'Your phone battery was low at your last update.',
  STALE_LOCATION: 'We have not had a location update from you recently.',
};

const TERMINAL_ASSIGNMENTS = new Set([
  'DELIVERED',
  'RETURNED',
  'CANCELLED',
  'DECLINED',
  'OFFER_EXPIRED',
]);

export function PartnerProfilePanel() {
  const [assignments, setAssignments] = useState<readonly Assignment[]>([]);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [ratings, setRatings] = useState<{
    readonly rating_average: number | null;
    readonly rating_count: number;
  } | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [restrictions, setRestrictions] = useState<readonly Restriction[]>([]);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [history, current, own, standing, delivery] = await Promise.all([
        partnerRequest<{ assignments?: readonly Assignment[] }>('partner/assignments'),
        partnerRequest<Availability>('partner/availability'),
        partnerRequest<{ application: Application | null }>('partner/standing/application').catch(
          () => ({ application: null }),
        ),
        partnerRequest<{ restrictions: readonly Restriction[] }>(
          'partner/standing/restrictions',
        ).catch(() => ({ restrictions: [] as readonly Restriction[] })),
        partnerRequest<{ rating_average: number | null; rating_count: number }>(
          'partner/ratings',
        ).catch(() => ({ rating_average: null, rating_count: 0 })),
      ]);
      setAssignments(history.assignments ?? []);
      setAvailability(current);
      setApplication(own.application);
      setRestrictions(standing.restrictions);
      setRatings(delivery);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your record could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <LoadingState label="Loading your record…" lines={4} />;
  }

  const warnings = availability?.warning_codes ?? [];
  const active = restrictions.filter((entry) => entry.lifecycle_state === 'ACTIVE');
  const completed = assignments.filter((entry) =>
    TERMINAL_ASSIGNMENTS.has(entry.assignment_state.toUpperCase()),
  ).length;

  return (
    <div className="ns-stack">
      <Panel
        actions={
          <Button onClick={() => void load()} variant="secondary">
            Refresh
          </Button>
        }
        description="What you can do right now, and why."
        eyebrow="Your record"
        id="standing"
        level={1}
        title="Standing and verification"
      >
        {error ? <Notice tone="danger">{error}</Notice> : null}

        {/* DLP-47, DLP-56, SEC-14: a restriction is owed a reason, a review
            date and a route to challenge it. It was previously visible only
            inside the admin console. */}
        {active.map((entry) => (
          <Card className="restriction-card" key={entry.trust_restriction_case_id} tone="sunken">
            <StatusPill label="Restricted" state="CANCELLED" />
            <p className="restriction-card__reason">
              {entry.reason_code.replaceAll('_', ' ').toLowerCase()} ·{' '}
              {entry.scope_kind === 'GLOBAL' ? 'all work' : entry.scope_kind.toLowerCase()}
            </p>
            <p className="ns-field__hint">
              Reviewed on {new Date(entry.review_at).toLocaleDateString()}; in force until{' '}
              {new Date(entry.effective_until).toLocaleDateString()}. Policy{' '}
              {shortReference(entry.policy_reference)}.
            </p>
            {entry.appealable ? (
              <Notice tone="information">
                You can ask for this to be looked at again. Raise it under “Something is wrong” on
                your job, or through partner support, quoting{' '}
                {shortReference(entry.trust_restriction_case_id)}.
              </Notice>
            ) : null}
          </Card>
        ))}

        <Card className="standing-card" tone="sunken">
          <div className="ns-row">
            <StatusPill
              label={
                availability?.availability_state === 'ONLINE'
                  ? 'Online for offers'
                  : availability?.availability_state === 'PAUSED'
                    ? 'Paused'
                    : 'Offline'
              }
              state={availability?.availability_state === 'ONLINE' ? 'AVAILABLE' : 'CLOSED'}
            />
            {application ? (
              <StatusPill
                label={`Application ${application.lifecycle_state.replaceAll('_', ' ').toLowerCase()}`}
                state={application.lifecycle_state === 'APPROVED' ? 'AVAILABLE' : 'OPEN'}
              />
            ) : null}
          </div>
          {application ? (
            <p className="ns-field__hint">
              {application.vehicle_kind.toLowerCase()} · {displayArea(application.home_zone_name)}
              {application.reason_note ? ` — ${application.reason_note}` : ''}
            </p>
          ) : (
            <p className="ns-field__hint">
              No application is on record for this account, so you cannot be offered work yet.
            </p>
          )}
        </Card>

        {warnings.length > 0 ? (
          <Notice tone="warning">
            <span className="sr-only">Needs attention. </span>
            {warnings
              .map((code) => WARNINGS[code] ?? code.replaceAll('_', ' ').toLowerCase())
              .join(' ')}
          </Notice>
        ) : null}
      </Panel>

      {/* DLP-44, DLP-45: what is collected, when it stops, and a control that
          actually stops it. The disclosure describes what the app really does
          — a position recorded when you go online and when you update it — not
          continuous tracking, which this build does not perform. */}
      <Panel eyebrow="Privacy" id="location" level={2} title="Your location">
        <p>
          Your position is recorded when you go online and each time you update your availability,
          so dispatch can offer you work that is actually near you. It is not recorded while you are
          offline, and it is not shared with customers.
        </p>
        <Button
          busy={stopping}
          disabled={availability?.availability_state !== 'ONLINE'}
          onClick={() =>
            void (async () => {
              setStopping(true);
              setError(null);
              try {
                // Withdrawing sharing takes the partner offline, because
                // dispatch cannot offer work to someone whose position is
                // unknown. Saying so plainly is the point — a silent downgrade
                // would look like a bug.
                await partnerRequest('partner/availability', {
                  method: 'POST',
                  body: JSON.stringify({
                    state: 'OFFLINE',
                    reason_code: 'LOCATION_SHARING_WITHDRAWN',
                  }),
                });
                await load();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Sharing could not be stopped.');
              } finally {
                setStopping(false);
              }
            })()
          }
          variant="secondary"
        >
          {availability?.availability_state === 'ONLINE'
            ? 'Stop sharing and go offline'
            : 'Not sharing — you are offline'}
        </Button>
      </Panel>

      {/* DLP-54: counts a partner can check against their own memory, with no
          score they cannot see the workings of. */}
      <Panel
        description="Straight counts from your own record — no hidden score."
        eyebrow="How you are doing"
        id="performance"
        level={2}
        title="Your work"
      >
        <div className="performance-grid">
          <Card tone="sunken">
            <p className="ns-eyebrow">Trips today</p>
            <strong>{availability?.trips_today ?? '0'}</strong>
          </Card>
          <Card tone="sunken">
            <p className="ns-eyebrow">Earned today</p>
            <strong>{formatMoneyMinor(Number(availability?.earnings_today_minor ?? '0'))}</strong>
          </Card>
          <Card tone="sunken">
            <p className="ns-eyebrow">Completed on record</p>
            <strong>{completed}</strong>
          </Card>
          {/* The delivery rating, separate from the shop's own. Shown as an
              average over a window rather than a list, so no single rating can
              be traced back to one customer at one door. */}
          <Card tone="sunken">
            <p className="ns-eyebrow">Delivery rating · 90 days</p>
            <strong>
              {ratings && ratings.rating_count > 0
                ? `${ratings.rating_average} ★`
                : 'Not yet rated'}
            </strong>
          </Card>
        </div>
        <p className="ns-field__hint">
          If any of this looks wrong, raise it from the trip on your earnings screen — a
          disagreement about your work is answered against the record, not by a rating.
        </p>
      </Panel>

      <Panel eyebrow="History" id="history" level={2} title="Past assignments">
        {assignments.length === 0 ? (
          <EmptyState
            description="Work you accept will be listed here with what happened to it."
            glyph="◌"
            title="Nothing on record yet"
          />
        ) : (
          <ul className="assignment-history">
            {assignments.map((assignment) => (
              <li key={assignment.delivery_assignment_id}>
                <Card tone="sunken">
                  <div className="ns-row">
                    <span className="ns-eyebrow">
                      {shortReference(assignment.source_order_reference)}
                    </span>
                    <StatusPill state={assignment.assignment_state} />
                  </div>
                  {assignment.approximate_drop_area ? (
                    <p className="ns-field__hint">
                      to {displayArea(assignment.approximate_drop_area)}
                    </p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
