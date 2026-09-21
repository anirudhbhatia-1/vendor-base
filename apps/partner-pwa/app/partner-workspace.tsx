'use client';

import type { WhoAmI } from '@neighbourhood-store/contracts';
import { revokeAndSignOut } from '@neighbourhood-store/pwa-auth';
import { RequireWorkspaceRole } from '@neighbourhood-store/pwa-auth/guard';
import {
  ActionDock,
  AppShell,
  Button,
  Card,
  LocationPicker,
  type GeoPoint,
  EmptyState,
  Field,
  Icon,
  LoadingState,
  Notice,
  Panel,
  StatusPill,
  TabBar,
  TopBar,
  formatCountdown,
  formatDistanceMeters,
  formatTravelSeconds,
  formatMoneyMinor,
} from '@neighbourhood-store/ui';
import Link from 'next/link';
import { useMapsConfig } from './maps-config';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl, partnerRequest } from './authenticated-api';
import { PartnerApplicationPanel } from './application-panel';
import { displayArea, offerDeadlineSentence, shortReference, waitPolicySentence } from './display';
import {
  directionSentence,
  forgetAssignments,
  recallAssignments,
  rememberAssignments,
  staleSentence,
} from './active-job-cache';
import { EarningsPanel } from './earnings-panel';
import { FieldOpsPanel } from './field-ops-panel';
import { PartnerProfilePanel } from './profile-panel';
import { getSupabase, supabaseConfigured } from './supabase-client';
import {
  deliveryProofAllowed,
  offerIsCurrent,
  transitionCommandReference,
} from './job-action-policy';
import {
  proofQueueAllowsNewWork,
  proofQueueMessage,
  readProofQueue,
  type ProofQueueState,
} from './proof-queue-policy';

/** The shop's handling needs in the partner's words (8.5). */
export function handlingSentence(flags: readonly string[] | undefined): string {
  const words: Record<string, string> = {
    FRAGILE: 'fragile',
    KEEP_COLD: 'keep cold',
    KEEP_FROZEN: 'keep frozen',
    KEEP_UPRIGHT: 'keep upright',
    HEAVY: 'heavy',
    LEAK_RISK: 'may leak',
  };
  return (flags ?? [])
    .map((flag) => words[flag] ?? flag.toLowerCase().replaceAll('_', ' '))
    .join(', ');
}

type Assignment = {
  readonly approximate_drop_area: string;
  readonly approximate_pickup_area: string;
  readonly assignment_state: string;
  readonly delivery_assignment_id: string;
  readonly offer_expires_at: string | null;
  readonly package_count: number;
  /** What the shop said the package needs on the way (8.5). */
  readonly handling_flags?: readonly string[];
  readonly source_order_reference: string;
  readonly version: number;
  readonly route_metres?: number | null;
  readonly route_seconds?: number | null;
  readonly route_source?: 'ESTIMATE' | 'MAPBOX' | null;
  readonly expected_earning_minor?: number | null;
  /** When the bag is, or is expected to be, ready at the store (9.3). */
  readonly expected_ready_at?: string | null;
  readonly promise_at?: string | null;
  readonly wait_policy?: {
    readonly included_seconds: number;
    readonly per_completed_minute_minor: number;
    readonly cap_minor: number;
  } | null;
  /**
   * Present only while this partner is holding the goods. The API decides that,
   * not this screen: before custody and after completion the field is absent.
   */
  readonly drop_address?: {
    readonly label: string;
    readonly pin_code: string;
    readonly landmark: string | null;
    readonly delivery_instructions: string | null;
    readonly latitude: number;
    readonly longitude: number;
  } | null;
  /** True while a safety report on this job is open. Decided by the server. */
  readonly open_emergency?: boolean;
  /** The store to collect from, once the job is this partner's (9.4). */
  readonly pickup_location?: {
    readonly name: string;
    readonly landmark: string | null;
    readonly description: string | null;
    readonly latitude: number;
    readonly longitude: number;
  } | null;
  readonly arrival_kind?: 'TRUSTED_LOCATION' | 'VENDOR_CONFIRMED' | null;
  /** An arrival the phone could not vouch for, waiting for the store to confirm. */
  readonly arrival_claim?: {
    readonly claimed_at: string;
    readonly reason: 'NO_LOCATION' | 'POOR_ACCURACY' | 'OUT_OF_RANGE';
  } | null;
};

type Availability = {
  readonly availability_state: string;
  readonly trips_today: string;
  readonly earnings_today_minor: string;
  readonly online_seconds_today?: number;
  readonly active_zones?: readonly string[];
  readonly warning_codes: readonly string[];
};

type Notice_ = { readonly in_app_notification_id: string; readonly template_key: string };

/** The one forward step available in each assignment state. */
const NEXT_STEP: Readonly<Record<string, readonly [string, string]>> = {
  ASSIGNED: ['Confirm arrival at the store', 'arrive-vendor'],
  AT_VENDOR: ['Check packages and pick up', 'pickup'],
  PICKED_UP: ['Begin the route', 'begin-route'],
  EN_ROUTE_TO_CUSTOMER: ['Confirm arrival at the customer', 'arrive-customer'],
  ARRIVED: ['Record the delivery', 'deliver'],
};

export type PartnerView = 'home' | 'active' | 'alerts' | 'earnings' | 'profile' | 'application';

const tabs = [
  { href: '/', glyph: <Icon name="truck" />, label: 'Work', relatedPaths: ['/active'] },
  { href: '/earnings', glyph: <Icon name="basket" />, label: 'Earnings' },
  {
    href: '/profile',
    glyph: <Icon name="person" />,
    label: 'Account',
    relatedPaths: ['/alerts', '/applications'],
  },
];

/**
 * The workspace shell is gated in the browser, not only in `proxy.ts`: the
 * Cloudflare Pages build is a static export where no proxy runs, and the proxy
 * never checked the caller's role in any build.
 */
export function PartnerWorkspace({ view }: { view: PartnerView }) {
  return (
    <RequireWorkspaceRole
      apiUrl={apiUrl}
      client={getSupabase()}
      configured={supabaseConfigured()}
      workspaceRole="partner"
    >
      <PartnerWorkspaceContent view={view} />
    </RequireWorkspaceRole>
  );
}

/** One live assignment: the current step, its proof, and the ways out. */
function ActiveJob({
  assignment,
  busy,
  lastFix,
  onAct,
  onRefresh,
}: {
  readonly assignment: Assignment;
  readonly busy: boolean;
  /** Where the phone last placed the partner, for the written route (9.4). */
  readonly lastFix: { readonly latitude: number; readonly longitude: number } | null;
  readonly onRefresh: () => void;
  readonly onAct: (
    assignment: Assignment,
    action: string,
    extra?: Record<string, unknown>,
    describedAs?: string,
  ) => Promise<void>;
}) {
  const [otp, setOtp] = useState('');
  const [packageCount, setPackageCount] = useState(String(assignment.package_count));
  const [packagesChecked, setPackagesChecked] = useState(false);
  const [pickupCode, setPickupCode] = useState<{
    readonly code: string;
    readonly expiresAt: string;
  } | null>(null);
  const [pickupCodeError, setPickupCodeError] = useState<string | null>(null);
  const [mintingCode, setMintingCode] = useState(false);
  // A job with an open safety report does not move. The partner reported an
  // accident and the app kept offering "pick up" and "record the delivery"
  // underneath it, which is the platform asking somebody to carry on working
  // through the thing they just asked for help with.
  const blocked = assignment.open_emergency === true;
  const step = blocked
    ? undefined
    : assignment.arrival_claim && assignment.assignment_state === 'ASSIGNED'
      ? (['Try arrival again with location', 'arrive-vendor'] as const)
      : NEXT_STEP[assignment.assignment_state];
  const arrived = deliveryProofAllowed(assignment.assignment_state, blocked);
  const atVendor = assignment.assignment_state === 'AT_VENDOR';
  // Before custody the partner is heading for the store, and only the area is
  // known. Once they are holding the goods the API sends the address itself —
  // an area name alone is not something anyone can deliver to. It is
  // stage-gated server-side and never reaches an offer (SEC-03).
  const dropAddress = assignment.drop_address ?? null;
  const headingToStore = ['ASSIGNED', 'AT_VENDOR'].includes(assignment.assignment_state);
  // The store itself once the job is theirs (9.4): the API sends its name,
  // landmark and point between acceptance and pickup, and only then.
  const store = headingToStore ? (assignment.pickup_location ?? null) : null;
  const heading = headingToStore
    ? store
      ? displayArea(store.name)
      : displayArea(assignment.approximate_pickup_area)
    : (dropAddress?.label ?? displayArea(assignment.approximate_drop_area));
  // Coordinates beat a text query every time: the store's point on the way
  // there, the customer's on the way back. A rough area is all an offer has.
  const mapQuery = store
    ? `geo:${store.latitude},${store.longitude}?q=${encodeURIComponent(
        `${displayArea(store.name)}${store.landmark ? `, ${displayArea(store.landmark)}` : ''}`,
      )}`
    : dropAddress && !headingToStore
      ? `geo:${dropAddress.latitude},${dropAddress.longitude}?q=${encodeURIComponent(
          `${dropAddress.label}, ${dropAddress.pin_code}`,
        )}`
      : `geo:0,0?q=${encodeURIComponent(heading)}`;
  const written = store ? directionSentence(lastFix, store) : null;

  return (
    <Card as="section" className="job-card" tone="raised">
      <header className="job-card__head">
        <div>
          <p className="ns-eyebrow">{shortReference(assignment.source_order_reference)}</p>
          <StatusPill state={assignment.assignment_state} />
        </div>
        <span className="job-card__packages">
          {assignment.package_count} package{assignment.package_count === 1 ? '' : 's'}
        </span>
      </header>
      {(assignment.handling_flags ?? []).length > 0 ? (
        <Notice tone="warning">
          Handle with care: {handlingSentence(assignment.handling_flags)}
        </Notice>
      ) : null}

      {/* Text and landmark first; a map is never the only account of a route
          (DLP-46, UX-12). */}
      <div className="route-strip">
        <div>
          <p className="ns-eyebrow">Pick up near</p>
          <strong>{displayArea(assignment.approximate_pickup_area)}</strong>
        </div>
        <span aria-hidden="true">→</span>
        <div>
          <p className="ns-eyebrow">Drop near</p>
          <strong>{displayArea(assignment.approximate_drop_area)}</strong>
        </div>
      </div>

      {/* DLP-21, DLP-46, UX-12: the written destination is the primary account
          of where to go; the map is an optional handoff to whatever app the
          partner already uses, never the only representation. */}
      <div className="nav-handoff">
        <div>
          <p className="ns-eyebrow">Heading for</p>
          <strong>{heading}</strong>
        </div>
        <a
          className="ns-button ns-button--secondary ns-button--medium"
          href={mapQuery}
          rel="noreferrer"
        >
          <span className="ns-button__label">Open in maps</span>
        </a>
      </div>

      {store ? (
        // 9.4 / DLP-21 / DLP-46: the store, in words first. The landmark is
        // what finds a shop in a lane; the map is the handoff, not the account.
        <Card className="drop-address" tone="sunken">
          <p className="ns-eyebrow">Collect from</p>
          <strong>{displayArea(store.name)}</strong>
          {store.landmark ? <p>Near {displayArea(store.landmark)}</p> : null}
          {store.description ? (
            <p className="drop-address__instructions">{store.description}</p>
          ) : null}
          {written ? <p>{written}</p> : null}
        </Card>
      ) : null}

      {assignment.arrival_claim ? (
        // 9.4: the phone could not place the partner at the store, so the
        // arrival is the store's to confirm. Nothing is lost -- the claim is
        // on record -- but the handover waits for the counter.
        <Notice live="polite" tone="warning">
          {assignment.arrival_claim.reason === 'NO_LOCATION'
            ? 'Your phone shared no location, so the store has to confirm you are at the counter.'
            : assignment.arrival_claim.reason === 'POOR_ACCURACY'
              ? 'Your phone could not place you precisely, so the store has to confirm you are at the counter.'
              : 'Your phone places you away from the store, so the store has to confirm you are at the counter.'}{' '}
          Ask them to confirm, or try again once your location is on.
        </Notice>
      ) : null}

      {dropAddress ? (
        // DLP-21: what the partner is holding has to reach a specific door.
        // The written address stays primary; the landmark and the customer's
        // own instructions are what actually resolve the last hundred metres.
        <Card className="drop-address" tone="sunken">
          <p className="ns-eyebrow">Deliver to</p>
          <strong>{dropAddress.label}</strong>
          <p>{dropAddress.pin_code}</p>
          {dropAddress.landmark ? <p>Near {dropAddress.landmark}</p> : null}
          {dropAddress.delivery_instructions ? (
            <p className="drop-address__instructions">{dropAddress.delivery_instructions}</p>
          ) : null}
        </Card>
      ) : null}

      {atVendor && !blocked ? (
        // DLP-24: the shop hands the order over against this code. The partner
        // had nothing to present before -- the console asked the shopkeeper for
        // a "customer's collection code" on an order the customer was not
        // collecting -- so the handover could not happen honestly.
        <Card className="pickup-code" tone="sunken">
          <p className="ns-eyebrow">Your pickup code</p>
          {pickupCode ? (
            <>
              <p className="pickup-code__value" aria-live="polite">
                <strong>{pickupCode.code}</strong>
              </p>
              <p>
                Read it to the store. Valid until{' '}
                {new Date(pickupCode.expiresAt).toLocaleTimeString()}.
              </p>
            </>
          ) : (
            <p>The store needs this to hand the order to you.</p>
          )}
          {pickupCodeError ? <Notice tone="danger">{pickupCodeError}</Notice> : null}
          <Button
            busy={mintingCode}
            onClick={() =>
              void (async () => {
                setMintingCode(true);
                setPickupCodeError(null);
                try {
                  const issued = await partnerRequest<{
                    readonly plaintext_otp: string;
                    readonly expires_at: string;
                  }>(`partner/assignments/${assignment.delivery_assignment_id}/pickup-otp`, {
                    method: 'POST',
                    body: '{}',
                  });
                  setPickupCode({ code: issued.plaintext_otp, expiresAt: issued.expires_at });
                } catch (cause) {
                  setPickupCodeError(
                    cause instanceof Error ? cause.message : 'The code could not be issued.',
                  );
                } finally {
                  setMintingCode(false);
                }
              })()
            }
            variant={pickupCode ? 'ghost' : 'secondary'}
          >
            {pickupCode ? 'Get a fresh code' : 'Show my pickup code'}
          </Button>
        </Card>
      ) : null}

      {atVendor && !blocked ? (
        // DLP-25: counts and condition are agreed before custody starts, not
        // asserted by the app. The count sent is the one the partner confirms.
        <Card className="package-check" tone="sunken">
          <p className="ns-eyebrow">Check before you take it</p>
          <Field
            hint={`The order says ${assignment.package_count}. Change it if what you are handed differs.`}
            inputMode="numeric"
            label="Packages you are taking"
            min={1}
            onChange={(event) => setPackageCount(event.target.value)}
            type="number"
            value={packageCount}
          />
          <label className="checkbox-row">
            <input
              checked={packagesChecked}
              onChange={(event) => setPackagesChecked(event.target.checked)}
              type="checkbox"
            />
            <span>Counted with the store, and nothing is damaged</span>
          </label>
        </Card>
      ) : null}

      {arrived ? (
        <>
          {/* DLP-30. Completion used to send a reference the app invented from
              the clock, so a delivery could be recorded without the partner
              ever reaching the customer. */}
          <Field
            hint="Ask the customer to read it from their order screen."
            inputMode="numeric"
            label="Customer’s delivery code"
            maxLength={6}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
            value={otp}
          />
          <Button
            block
            busy={busy}
            disabled={!/^\d{6}$/.test(otp)}
            onClick={() =>
              void onAct(
                assignment,
                'deliver',
                {
                  otp,
                  proof_reference: `SYNTH-PROOF-DELIVERY-${Date.now().toString(36).toUpperCase()}`,
                },
                'delivery',
              ).then(() => setOtp(''))
            }
            size="large"
          >
            Record the delivery
          </Button>
        </>
      ) : blocked ? (
        <Notice tone="danger">
          This job is on hold while your safety report is open. Operations decide what happens to
          the order — you do not have to move it on. Mark the report resolved once you are safe.
        </Notice>
      ) : step ? (
        <Button
          block
          busy={busy}
          disabled={atVendor && (!packagesChecked || !(Number(packageCount) >= 1))}
          onClick={() =>
            void onAct(
              assignment,
              step[1],
              atVendor
                ? {
                    package_count: Math.max(1, Number(packageCount) || assignment.package_count),
                    proof_reference: `SYNTH-PROOF-PICKUP-${Date.now().toString(36).toUpperCase()}`,
                    vendor_confirmed: true,
                  }
                : {},
              step[0],
            )
          }
          size="large"
        >
          {step[0]}
        </Button>
      ) : (
        <Notice tone="information">
          This job is waiting on operations. Support can tell you what happens next.
        </Notice>
      )}

      <FieldOpsPanel
        assignmentId={assignment.delivery_assignment_id}
        atVendor={assignment.assignment_state === 'AT_VENDOR'}
        onChanged={onRefresh}
      />

      {/* The unhappy paths. `fail`, `require-return`, `begin-return` and
          `complete-return` existed in the API with no caller at all. */}
      {!blocked ? (
        <div className="ns-row">
          {['EN_ROUTE_TO_CUSTOMER', 'ARRIVED'].includes(assignment.assignment_state) ? (
            <Button
              busy={busy}
              onClick={() =>
                void onAct(
                  assignment,
                  'fail',
                  { reason_code: 'DELIVERY_FAILED' },
                  'failed delivery',
                )
              }
              variant="danger"
            >
              I cannot deliver this
            </Button>
          ) : null}
          {assignment.assignment_state === 'DELIVERY_FAILED' ? (
            <Button
              busy={busy}
              onClick={() =>
                void onAct(
                  assignment,
                  'require-return',
                  { reason_code: 'RETURN_REQUIRED' },
                  'return required',
                )
              }
            >
              Return it to the store
            </Button>
          ) : null}
          {assignment.assignment_state === 'RETURN_AUTHORIZED' ? (
            <Button
              busy={busy}
              onClick={() =>
                void onAct(
                  assignment,
                  'begin-return',
                  { reason_code: 'RETURN_STARTED' },
                  'return started',
                )
              }
            >
              Start the return
            </Button>
          ) : null}
          {assignment.assignment_state === 'RETURNING' ? (
            <Button
              busy={busy}
              onClick={() =>
                void onAct(
                  assignment,
                  'complete-return',
                  {
                    reason_code: 'RETURN_COMPLETED',
                    proof_reference: `SYNTH-PROOF-RETURN-${Date.now().toString(36).toUpperCase()}`,
                  },
                  'return completed',
                )
              }
            >
              Complete the return
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function PartnerWorkspaceContent({ view }: { view: PartnerView }) {
  const pathname = usePathname();
  const router = useRouter();
  const [identity, setIdentity] = useState<WhoAmI | null>(null);
  const [offers, setOffers] = useState<readonly Assignment[]>([]);
  const [assignments, setAssignments] = useState<readonly Assignment[]>([]);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [notices, setNotices] = useState<readonly Notice_[]>([]);
  const [alertsState, setAlertsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [connected, setConnected] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Where the rider says they are when the device will not say (D-17). It used
  // to be a hard-coded point in Jaipur, so a rider whose phone refused
  // location went online somewhere they were not and was offered jobs there.
  const [positionNeeded, setPositionNeeded] = useState(false);
  const [manualPosition, setManualPosition] = useState<GeoPoint | null>(null);
  const maps = useMapsConfig();
  const [proofQueue, setProofQueue] = useState<ProofQueueState>({ status: 'unknown' });
  const proofReadSequence = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  // When the server last confirmed the assignments shown; null while live (9.4).
  const [staleSince, setStaleSince] = useState<number | null>(null);
  const [lastFix, setLastFix] = useState<{ latitude: number; longitude: number } | null>(null);

  const loadAlerts = useCallback(async () => {
    setAlertsState('loading');
    try {
      setNotices(await partnerRequest<readonly Notice_[]>('notifications?unread_only=true'));
      setAlertsState('ready');
    } catch {
      setAlertsState('error');
    }
  }, []);
  useEffect(() => {
    if (view === 'alerts') void loadAlerts();
  }, [view, loadAlerts]);

  const loadProofQueue = useCallback(async () => {
    const sequence = ++proofReadSequence.current;
    setProofQueue({ status: 'loading' });
    const state = await readProofQueue(() =>
      partnerRequest<unknown>('partner/field/offline-proofs'),
    );
    if (sequence !== proofReadSequence.current) return { status: 'unknown' } as const;
    setProofQueue(state);
    return state;
  }, []);

  const refresh = useCallback(async () => {
    const [who, offerBody, assignmentBody, availabilityBody] = await Promise.all([
      partnerRequest<WhoAmI>('auth/whoami'),
      partnerRequest<{ readonly offers: readonly Assignment[] }>('partner/offers'),
      partnerRequest<{ readonly assignments: readonly Assignment[] }>('partner/assignments'),
      partnerRequest<Availability>('partner/availability').catch(() => null),
      loadProofQueue(),
    ]);
    setIdentity(who);
    setOffers(offerBody.offers);
    setAssignments(assignmentBody.assignments);
    setAvailability(availabilityBody);
    setError(null);
    setLoading(false);
    setStaleSince(null);
    rememberAssignments(
      typeof window === 'undefined' ? null : window.localStorage,
      assignmentBody.assignments,
      Date.now(),
    );
  }, [loadProofQueue]);

  useEffect(() => {
    setConnected(navigator.onLine);
    const online = () => {
      setConnected(true);
      void loadProofQueue();
    };
    const offline = () => {
      setConnected(false);
      ++proofReadSequence.current;
      setProofQueue({ status: 'unknown' });
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    void refresh().catch((cause: unknown) => {
      // Nothing fresh: show the job as the server last confirmed it (9.4),
      // said as such, rather than an empty screen in a lane with no signal.
      const cached = recallAssignments<Assignment>(
        typeof window === 'undefined' ? null : window.localStorage,
      );
      if (cached && cached.assignments.length > 0) {
        setAssignments(cached.assignments);
        setStaleSince(cached.confirmed_at);
      }
      setError(cause instanceof Error ? cause.message : 'Dispatch could not be loaded.');
      setLoading(false);
    });
    return () => {
      ++proofReadSequence.current;
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [refresh, loadProofQueue]);

  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 15_000);
    return () => window.clearInterval(timer);
  }, [connected, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const isOnline = availability?.availability_state === 'ONLINE';
  // Presence. Dispatch offers work only to partners whose device has confirmed
  // itself within the last few minutes; going online once is not enough,
  // because a tab closed without going offline stayed "online" for ever and
  // kept being offered jobs ahead of partners who were actually there. A
  // refusal means the server no longer has this partner online -- reload the
  // state rather than keep insisting.
  useEffect(() => {
    if (!isOnline || !connected) return;
    const beat = async () => {
      let position: { latitude: number; longitude: number; accuracy_meters: number } | null = null;
      if (navigator.geolocation) {
        position = await new Promise((resolve) =>
          navigator.geolocation.getCurrentPosition(
            (found) =>
              resolve({
                accuracy_meters: Math.max(1, Math.round(found.coords.accuracy)),
                latitude: found.coords.latitude,
                longitude: found.coords.longitude,
              }),
            () => resolve(null),
            { timeout: 5_000, maximumAge: 60_000 },
          ),
        );
      }
      if (position) setLastFix({ latitude: position.latitude, longitude: position.longitude });
      try {
        await partnerRequest('partner/availability/heartbeat', {
          method: 'POST',
          body: JSON.stringify(position ?? {}),
        });
      } catch {
        void refresh().catch(() => undefined);
      }
    };
    void beat();
    const timer = window.setInterval(() => void beat(), 60_000);
    return () => window.clearInterval(timer);
  }, [isOnline, connected, refresh]);

  async function accept(offer: Assignment) {
    if (busy || !proofQueueAllowsNewWork(proofQueue, connected, Date.now())) {
      setError(proofQueueMessage(proofQueue));
      return;
    }
    if (!offerIsCurrent(offer.offer_expires_at, Date.now())) {
      setError('This offer has expired. Refresh to see current offers.');
      return;
    }
    setBusy(true);
    try {
      const latest = await loadProofQueue();
      if (
        !proofQueueAllowsNewWork(latest, navigator.onLine, Date.now()) ||
        !offerIsCurrent(offer.offer_expires_at, Date.now())
      ) {
        setError(
          'Could not confirm current proof and offer eligibility. Refresh before accepting.',
        );
        return;
      }
      await partnerRequest(`partner/offers/${offer.delivery_assignment_id}/accept`, {
        method: 'POST',
        body: JSON.stringify({
          command_reference: transitionCommandReference('accept', Date.now()),
          expected_version: offer.version,
          reason_code: 'PARTNER_ACCEPTED',
        }),
      });
      await refresh();
      setMessage('Offer accepted. The delivery is yours.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The offer could not be accepted.');
    } finally {
      setBusy(false);
    }
  }

  async function decline(offer: Assignment) {
    setBusy(true);
    try {
      await partnerRequest(`partner/offers/${offer.delivery_assignment_id}/decline`, {
        method: 'POST',
        body: JSON.stringify({
          command_reference: transitionCommandReference('decline', Date.now()),
          expected_version: offer.version,
          reason_code: 'PARTNER_DECLINED',
        }),
      });
      await refresh();
      // DLP-12: declining is a legitimate choice, not misconduct, and the
      // wording should not imply otherwise.
      setMessage('Declined. It goes back to the pool for another partner.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The offer could not be declined.');
    } finally {
      setBusy(false);
    }
  }

  async function act(
    assignment: Assignment,
    action: string,
    extra: Record<string, unknown> = {},
    describedAs?: string,
  ) {
    if (assignment.open_emergency === true) {
      setError('This job is on hold. Use the safety and support controls below.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // An arrival carries the phone's fix (9.4); the server decides whether
      // it places the partner at the store. Without one it is a claim.
      let fix: Record<string, number> = {};
      if (action === 'arrive-vendor') {
        const position = await devicePosition();
        if (position) {
          setLastFix({ latitude: position.latitude, longitude: position.longitude });
          fix = { ...position };
        }
      }
      const outcome = await partnerRequest<Assignment>(
        `partner/assignments/${assignment.delivery_assignment_id}/${action}`,
        {
          method: 'POST',
          body: JSON.stringify({
            command_reference: transitionCommandReference(action, Date.now()),
            expected_version: assignment.version,
            reason_code: 'PARTNER_CONFIRMED',
            ...fix,
            ...extra,
          }),
        },
      );
      await refresh();
      if (action === 'arrive-vendor' && outcome.arrival_claim) {
        setMessage('Arrival noted. The store has to confirm you are at the counter.');
      } else {
        setMessage(`${describedAs ?? action.replaceAll('-', ' ')} recorded.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That step could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  async function devicePosition(): Promise<{
    latitude: number;
    longitude: number;
    accuracy_meters: number;
  } | null> {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
    return new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        (position) =>
          resolve({
            accuracy_meters: Math.max(1, Math.round(position.coords.accuracy)),
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          }),
        () => resolve(null),
        { timeout: 5_000, maximumAge: 60_000 },
      ),
    );
  }

  async function setDispatch(state: 'ONLINE' | 'OFFLINE') {
    setBusy(true);
    try {
      let coordinates: { latitude: number; longitude: number; accuracy_meters: number } | null =
        null;
      if (state === 'ONLINE') {
        coordinates =
          (await devicePosition()) ??
          (manualPosition ? { ...manualPosition, accuracy_meters: 250 } : null);
        if (!coordinates) {
          // No position is not a position. Ask for one rather than invent it.
          setPositionNeeded(true);
          setError(
            'Your phone did not share its location. Place yourself on the map, then go online.',
          );
          return;
        }
        setPositionNeeded(false);
      }
      await partnerRequest('partner/availability', {
        method: 'POST',
        body: JSON.stringify({
          state,
          reason_code: state === 'ONLINE' ? 'PARTNER_AVAILABLE' : 'PARTNER_OFFLINE',
          ...(state === 'ONLINE' ? { ...coordinates, battery_percent: 80 } : {}),
        }),
      });
      await refresh();
      setMessage(
        state === 'ONLINE'
          ? 'You are online for delivery offers.'
          : 'You are offline and will not receive new offers.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Availability could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      const client = getSupabase();
      if (client) await revokeAndSignOut({ apiUrl, client });
      forgetAssignments(window.localStorage);
      router.replace('/login');
      router.refresh();
    } catch {
      setError('Sign-out could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const activeJob =
    assignments.find((job) => job.delivery_assignment_id === selectedJobId) ?? assignments[0];

  return (
    <AppShell
      surface="partner"
      /* DLP-20: the way back to the active job is always on screen, from
         anywhere in the app. */
      {...(activeJob && view !== 'active'
        ? {
            dock: (
              <ActionDock
                action={
                  <Link className="ns-button ns-button--primary ns-button--medium" href="/active">
                    <span className="ns-button__label">Resume</span>
                  </Link>
                }
                detail={displayArea(activeJob.approximate_drop_area)}
                title="Active job"
              />
            ),
          }
        : {})}
      tabs={
        <TabBar
          currentPath={pathname}
          items={tabs}
          label="Delivery partner navigation"
          renderLink={(item, active, content) => (
            <Link aria-current={active ? 'page' : undefined} href={item.href}>
              {content}
            </Link>
          )}
        />
      }
      topBar={
        <TopBar
          actions={
            <Button busy={busy} onClick={() => void signOut()} size="small" variant="secondary">
              Sign out
            </Button>
          }
          brand={
            <span className="workspace-brand">
              <span aria-hidden="true" className="workspace-mark">
                DP
              </span>
              <span>
                <strong>Delivery partner</strong>
                <small>{identity?.email ?? 'Dispatch workspace'}</small>
              </span>
            </span>
          }
          context={
            <div className="availability-strip">
              <StatusPill
                label={isOnline ? 'Online for offers' : 'Offline'}
                state={isOnline ? 'AVAILABLE' : 'CLOSED'}
              />
              {!connected ? <StatusPill label="No connection" state="WAITING" /> : null}
              <Button
                busy={busy}
                onClick={() => void setDispatch(isOnline ? 'OFFLINE' : 'ONLINE')}
                size="small"
                variant={isOnline ? 'secondary' : 'primary'}
              >
                {isOnline ? 'Go offline' : 'Go online'}
              </Button>
            </div>
          }
        />
      }
    >
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {positionNeeded && !isOnline ? (
        <Card tone="raised">
          <LocationPicker
            accessToken={maps?.access_token ?? null}
            copy={{
              searchLabel: 'Search for where you are',
              searchPlaceholder: 'A landmark, street or area near you',
              deviceLabel: 'Try my phone again',
              chosenLabel: 'Your position',
              mapHint: 'Tap the map where you are; offers are matched to this spot.',
            }}
            initialCentre={maps?.default_centre}
            label="Where are you right now?"
            onChange={(next) => {
              setManualPosition(next);
              setError(null);
            }}
            value={manualPosition}
          />
        </Card>
      ) : null}
      {['profile', 'alerts', 'application'].includes(view) ? (
        <nav className="partner-task-nav" aria-label="Account tasks">
          <Link href="/profile" aria-current={view === 'profile' ? 'page' : undefined}>
            Profile and standing
          </Link>
          <Link href="/alerts" aria-current={view === 'alerts' ? 'page' : undefined}>
            Alerts
          </Link>
          <Link href="/applications" aria-current={view === 'application' ? 'page' : undefined}>
            Application
          </Link>
        </nav>
      ) : null}

      {view === 'active' ? (
        <section className="ns-stack">
          <Link href="/">← Work and offers</Link>
          <h1>Your active delivery</h1>
          {loading ? (
            <LoadingState label="Loading your delivery…" lines={4} />
          ) : activeJob ? (
            <>
              {staleSince !== null ? (
                // 9.4: the picture is the server's last, not a live one. The
                // job stays readable; the next step waits for a connection.
                <Notice live="polite" tone="warning">
                  {staleSentence(staleSince, now)}{' '}
                  <Button
                    onClick={() =>
                      void refresh().catch(() =>
                        setError('Still no connection. The job is shown as last confirmed.'),
                      )
                    }
                    size="small"
                    variant="secondary"
                  >
                    Try again
                  </Button>
                </Notice>
              ) : null}
              {assignments.length > 1 ? (
                <label>
                  Choose a delivery
                  <select
                    value={activeJob.delivery_assignment_id}
                    onChange={(event) => setSelectedJobId(event.target.value)}
                  >
                    {assignments.map((job) => (
                      <option key={job.delivery_assignment_id} value={job.delivery_assignment_id}>
                        {shortReference(job.source_order_reference)} ·{' '}
                        {displayArea(job.approximate_pickup_area)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <ActiveJob
                assignment={activeJob}
                busy={busy || staleSince !== null}
                key={`${activeJob.delivery_assignment_id}:${activeJob.assignment_state}`}
                lastFix={lastFix}
                onAct={act}
                onRefresh={() =>
                  void refresh().catch(() =>
                    setError('Could not refresh this delivery. Try again.'),
                  )
                }
              />
            </>
          ) : (
            <EmptyState
              title="No active delivery"
              description="Accepted delivery offers will appear here."
              action={<Link href="/">View available work</Link>}
            />
          )}
        </section>
      ) : null}

      {view === 'home' ? (
        loading ? (
          <LoadingState label="Loading dispatch…" lines={4} />
        ) : (
          <>
            <Card className="today-strip" tone="sunken">
              <div>
                <p className="ns-eyebrow">Today</p>
                <strong>
                  {availability?.trips_today ?? '0'} trips ·{' '}
                  {formatMoneyMinor(Number(availability?.earnings_today_minor ?? '0'))}
                  {' · '}
                  {Math.floor((availability?.online_seconds_today ?? 0) / 60)} min online
                </strong>
                {/* The active zone (9.2): where the position falls, by name,
                    which is as much of the position as the screen says. */}
                {(availability?.active_zones ?? []).length > 0 ? (
                  <p className="ns-eyebrow">In {(availability?.active_zones ?? []).join(', ')}</p>
                ) : null}
              </div>
              <Button onClick={() => void refresh()} variant="secondary">
                Refresh
              </Button>
            </Card>

            {/* DLP-14: an unresolved proof is exactly what should stop a
                partner taking more work — otherwise a delivery sits unconfirmed
                while they start the next one. */}
            {!proofQueueAllowsNewWork(proofQueue, connected, now) ? (
              <Notice tone="warning">
                {proofQueueMessage(proofQueue)}{' '}
                <Button
                  variant="secondary"
                  disabled={!connected || proofQueue.status === 'loading'}
                  onClick={() => void loadProofQueue()}
                >
                  Retry proof check
                </Button>
              </Notice>
            ) : null}

            <Panel
              eyebrow="Dispatch"
              id="offers"
              level={2}
              title={offers.length === 1 ? 'One offer waiting' : `${offers.length} offers waiting`}
            >
              {offers.length === 0 ? (
                <EmptyState
                  description={
                    isOnline
                      ? 'Stay online — new offers arrive here on their own.'
                      : 'Go online to start receiving offers.'
                  }
                  glyph="◌"
                  title="No offers right now"
                />
              ) : (
                offers.map((offer) => {
                  const remaining = offer.offer_expires_at
                    ? formatCountdown(offer.offer_expires_at, now)
                    : null;
                  return (
                    <Card
                      as="article"
                      className="offer-card"
                      key={offer.delivery_assignment_id}
                      tone="raised"
                    >
                      {/* Everything DLP-11 and DLP-48 require before a decision:
                          what it pays, how far it is, how long is left. The
                          card previously showed a package count and two areas. */}
                      <div className="offer-card__earning">
                        <strong>
                          {offer.expected_earning_minor == null
                            ? 'Earning unavailable'
                            : formatMoneyMinor(offer.expected_earning_minor)}
                        </strong>
                        <small>expected for this trip</small>
                      </div>
                      {/* The rest of what an honest offer states (9.3): when
                          the bag will be ready to collect, and the waiting
                          terms if it is not. */}
                      <p className="offer-card__meta">
                        {offerDeadlineSentence(offer.expected_ready_at, now)}
                        {offer.wait_policy ? ` · ${waitPolicySentence(offer.wait_policy)}` : ''}
                      </p>
                      <div className="route-strip">
                        <div>
                          <p className="ns-eyebrow">Pick up near</p>
                          <strong>{displayArea(offer.approximate_pickup_area)}</strong>
                        </div>
                        <span aria-hidden="true">→</span>
                        <div>
                          <p className="ns-eyebrow">Drop near</p>
                          <strong>{displayArea(offer.approximate_drop_area)}</strong>
                        </div>
                      </div>
                      <p className="offer-card__meta">
                        {offer.route_metres == null
                          ? 'Distance unavailable'
                          : formatDistanceMeters(offer.route_metres)}
                        {offer.route_seconds == null
                          ? ''
                          : ` · ${formatTravelSeconds(offer.route_seconds, offer.route_source)}`}{' '}
                        · {offer.package_count} package{offer.package_count === 1 ? '' : 's'}
                        {(offer.handling_flags ?? []).length > 0
                          ? ` · ${handlingSentence(offer.handling_flags)}`
                          : ''}
                        {remaining === null ? '' : ` · ${remaining} to decide`}
                      </p>
                      <div className="ns-row">
                        <Button
                          block
                          busy={busy}
                          disabled={
                            !proofQueueAllowsNewWork(proofQueue, connected, now) ||
                            !offerIsCurrent(offer.offer_expires_at, now)
                          }
                          onClick={() => void accept(offer)}
                          size="large"
                        >
                          {!offerIsCurrent(offer.offer_expires_at, now)
                            ? 'Offer expired or unavailable'
                            : !proofQueueAllowsNewWork(proofQueue, connected, now)
                              ? 'Resolve proof check first'
                              : 'Accept'}
                        </Button>
                        <Button busy={busy} onClick={() => void decline(offer)} variant="secondary">
                          Not this one
                        </Button>
                      </div>
                    </Card>
                  );
                })
              )}
            </Panel>

            {assignments.length > 0 ? (
              <Panel eyebrow="In progress" id="active" level={2} title="Your delivery">
                <p>
                  {assignments.length}{' '}
                  {assignments.length === 1 ? 'delivery in progress' : 'deliveries in progress'}.
                  Open a delivery for navigation, package checks, proof and support.
                </p>
                <Link className="ns-button ns-button--primary ns-button--medium" href="/active">
                  Open active delivery
                </Link>
              </Panel>
            ) : null}
          </>
        )
      ) : null}

      {view === 'earnings' ? (
        <Panel
          description="Completed work, pending earnings and payouts, from your account."
          eyebrow="Earnings"
          id="earnings"
          level={1}
          title="What every trip paid"
        >
          <EarningsPanel />
        </Panel>
      ) : null}

      {view === 'profile' ? <PartnerProfilePanel /> : null}
      {view === 'alerts' ? (
        <>
          <Panel
            actions={
              <Button
                busy={alertsState === 'loading'}
                onClick={() => void loadAlerts()}
                variant="secondary"
              >
                Refresh alerts
              </Button>
            }
            description={identity?.email ?? ''}
            eyebrow="Partner account"
            id="account"
            level={2}
            title="Your alerts"
          >
            {alertsState === 'loading' ? (
              <LoadingState label="Loading alerts…" lines={3} />
            ) : alertsState === 'error' ? (
              <Notice tone="danger">
                Alerts could not be loaded. Use Refresh alerts to try again.
              </Notice>
            ) : notices.length === 0 ? (
              <EmptyState glyph="◔" title="No unread alerts" />
            ) : (
              notices.map((notice) => (
                <Card key={notice.in_app_notification_id} tone="sunken">
                  {notice.template_key.replaceAll('.', ' ')}
                </Card>
              ))
            )}
          </Panel>
        </>
      ) : null}

      {view === 'application' ? <PartnerApplicationPanel /> : null}
    </AppShell>
  );
}
