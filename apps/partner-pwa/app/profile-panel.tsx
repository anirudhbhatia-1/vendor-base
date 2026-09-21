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
  /** Seconds on shift today, from the availability history (9.2). */
  readonly online_seconds_today?: number;
  /** The service zones the current position falls in, by name (9.2). */
  readonly active_zones?: readonly string[];
  readonly warning_codes?: readonly string[];
};

/** Seconds on shift as hours and minutes. */
export function onlineTimeSentence(seconds: number | undefined): string {
  const total = Math.max(0, Math.floor(seconds ?? 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${minutes} min`;
}

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

/** A blocker's sentence: what stops going online, and what to do (9.1). */
export function blockerSentence(blocker: {
  readonly code: string;
  readonly detail: string | null;
  readonly until: string | null;
}): string {
  const document = (blocker.detail ?? 'document').toLowerCase().replaceAll('_', ' ');
  switch (blocker.code) {
    case 'NO_APPLICATION':
      return 'You have not applied yet. Complete your application to be offered work.';
    case 'APPLICATION_NOT_APPROVED':
      return `Your application is ${document}. You can be offered work once it is approved.`;
    case 'DOCUMENT_EXPIRED':
      return `Your ${document} document has expired${
        blocker.until ? ` (on ${new Date(blocker.until).toLocaleDateString()})` : ''
      }. Submit the renewed document below to keep working.`;
    case 'ELIGIBILITY_RESTRICTED':
      return `You are restricted from new work${blocker.detail ? ` (${document})` : ''}${
        blocker.until ? ` until ${new Date(blocker.until).toLocaleDateString()}` : ''
      }.`;
    case 'ELIGIBILITY_SUSPENDED':
      return `Your account is suspended${blocker.detail ? ` (${document})` : ''}. Contact support.`;
    case 'ELIGIBILITY_PENDING':
      return 'Your eligibility is still being set up. Check back shortly.';
    case 'RESTRICTION_ACTIVE':
      return `A restriction is in force (${document})${
        blocker.until ? ` until ${new Date(blocker.until).toLocaleDateString()}` : ''
      }. See it below to appeal.`;
    case 'OFFLINE_PROOF_PENDING':
      return 'A delivery proof saved offline has not synced yet. Sync it before going online.';
    default:
      return blocker.code.replaceAll('_', ' ').toLowerCase();
  }
}

type Eligibility = {
  readonly can_go_online: boolean;
  readonly blockers: readonly { code: string; detail: string | null; until: string | null }[];
  readonly warnings: readonly { code: string; detail: string; until: string }[];
  readonly documents: readonly {
    document_kind: string;
    document_reference: string;
    expires_at: string | null;
    state: string;
    renewal_pending: boolean;
  }[];
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
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [renewKind, setRenewKind] = useState('IDENTITY');
  const [renewReference, setRenewReference] = useState('');
  const [renewExpires, setRenewExpires] = useState('');
  const [renewMessage, setRenewMessage] = useState<string | null>(null);
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
      // The exact blockers (9.1): why going online is refused, and what is
      // about to lapse.
      setEligibility(
        await partnerRequest<Eligibility>('partner/standing/eligibility').catch(() => null),
      );
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

        {/* Exactly what stops going online (9.1), one line each, and what is
            about to. Until audit run 56 going online failed with "not
            eligible" and nothing said why. */}
        {eligibility && eligibility.blockers.length > 0 ? (
          <Notice tone="danger">
            <span className="sr-only">You cannot go online. </span>
            <ul className="blocker-list">
              {eligibility.blockers.map((blocker) => (
                <li key={`${blocker.code}:${blocker.detail ?? ''}`}>{blockerSentence(blocker)}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
        {eligibility && eligibility.warnings.length > 0 ? (
          <Notice tone="warning">
            {eligibility.warnings
              .map(
                (warning) =>
                  `Your ${warning.detail.toLowerCase()} document expires on ${new Date(warning.until).toLocaleDateString()} — renew it below to keep working.`,
              )
              .join(' ')}
          </Notice>
        ) : null}
      </Panel>

      {eligibility && eligibility.documents.length > 0 ? (
        <Panel
          description="The documents on your record, when they lapse, and how to renew one."
          eyebrow="Documents"
          id="documents"
          level={2}
          title="Identity, vehicle and insurance"
        >
          <ul className="document-list">
            {eligibility.documents.map((document) => (
              <li key={document.document_kind}>
                <strong>{document.document_kind.toLowerCase()}</strong> ·{' '}
                {shortReference(document.document_reference)} ·{' '}
                {document.expires_at
                  ? `${document.state.toLowerCase()}, ${document.state === 'EXPIRED' ? 'expired' : 'expires'} ${new Date(document.expires_at).toLocaleDateString()}`
                  : 'no expiry on record'}
                {document.renewal_pending ? ' · renewal in review' : ''}
              </li>
            ))}
          </ul>
          <form
            className="ns-stack"
            onSubmit={(event) => {
              event.preventDefault();
              setRenewMessage(null);
              void partnerRequest('partner/standing/documents/renewals', {
                method: 'POST',
                body: JSON.stringify({
                  document_kind: renewKind,
                  document_reference: renewReference.trim(),
                  expires_at: new Date(renewExpires).toISOString(),
                }),
              })
                .then(() => {
                  setRenewMessage('Sent for review. You will see the result here.');
                  setRenewReference('');
                  setRenewExpires('');
                  void load();
                })
                .catch((cause: unknown) =>
                  setRenewMessage(cause instanceof Error ? cause.message : 'Could not send it.'),
                );
            }}
          >
            <label>
              Which document
              <select onChange={(event) => setRenewKind(event.target.value)} value={renewKind}>
                <option value="IDENTITY">Identity document</option>
                <option value="VEHICLE">Vehicle registration</option>
                <option value="INSURANCE">Insurance</option>
              </select>
            </label>
            <label>
              New reference
              <input
                onChange={(event) => setRenewReference(event.target.value)}
                required
                value={renewReference}
              />
            </label>
            <label>
              Expires on
              <input
                onChange={(event) => setRenewExpires(event.target.value)}
                required
                type="date"
                value={renewExpires}
              />
            </label>
            <Button type="submit" variant="secondary">
              Send the renewed document for review
            </Button>
            {renewMessage ? <Notice tone="information">{renewMessage}</Notice> : null}
          </form>
        </Panel>
      ) : null}

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
            <p className="ns-eyebrow">Online today</p>
            <strong>{onlineTimeSentence(availability?.online_seconds_today)}</strong>
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
