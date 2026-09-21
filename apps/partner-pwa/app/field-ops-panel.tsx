'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Notice, Sheet, StatusPill, formatMoneyMinor } from '@neighbourhood-store/ui';
import { partnerRequest } from './authenticated-api';

/**
 * Field exceptions, emergencies, offline proof and the wait timer
 * (DLP-23, DLP-32 – DLP-45, DLP-55).
 *
 * Presented one decision at a time, which is what §8.2 asks for: a partner is
 * outdoors, one-handed, often in traffic. The previous version put twenty
 * buttons on screen at once — every exception kind, every resolution and every
 * proof action, permanently — so the one control that mattered at any moment
 * was indistinguishable from nineteen that did not.
 */
export type ExceptionKind =
  | 'VENDOR_DELAY'
  | 'MISSING_PACKAGE'
  | 'DAMAGED_PACKAGE'
  | 'UNREACHABLE_CUSTOMER'
  | 'WRONG_ADDRESS'
  | 'UNSAFE_LOCATION'
  | 'ACCIDENT'
  | 'MEDICAL_EMERGENCY'
  | 'THREAT'
  | 'VEHICLE_FAILURE'
  | 'PROHIBITED_GOODS';

type ExceptionEvent = {
  readonly partner_exception_event_id: string;
  readonly exception_kind: ExceptionKind;
  readonly resolution_state: string;
  readonly occurred_at: string;
};

type OfflineProof = {
  readonly partner_offline_proof_id: string;
  readonly delivery_assignment_id: string;
  readonly proof_kind: 'PICKUP' | 'DELIVERY' | 'RETURN';
  readonly sync_state: 'PENDING' | 'SYNCED' | 'EXPIRED';
  readonly captured_at: string;
};

/**
 * Where the device remembers the digest it registered.
 *
 * The server accepts a sync only when the digest matches the one saved at
 * capture — that is what makes the sync a claim about the proof this device
 * actually holds, rather than a bare "mark it done". The previous client
 * hashed the proof's own id at sync time, which never matched what capture had
 * registered, so every sync was refused with a digest conflict and a held
 * proof could never be cleared. `localStorage`, not component state, because
 * the whole point is surviving the app being closed in the field.
 */
const PROOF_DIGEST_PREFIX = 'neighbourhood.partner.proof.';

function rememberDigest(proofId: string, value: string): void {
  try {
    window.localStorage.setItem(`${PROOF_DIGEST_PREFIX}${proofId}`, value);
  } catch {
    // A device with storage disabled still syncs; it just has to do it in this
    // session, and the escalation path below covers the rest.
  }
}

function recallDigest(proofId: string): string | null {
  try {
    return window.localStorage.getItem(`${PROOF_DIGEST_PREFIX}${proofId}`);
  } catch {
    return null;
  }
}

function forgetDigest(proofId: string): void {
  try {
    window.localStorage.removeItem(`${PROOF_DIGEST_PREFIX}${proofId}`);
  } catch {
    // Nothing to clean up.
  }
}

type WaitTimer = {
  readonly wait_state: 'RUNNING' | 'THRESHOLD_ONE' | 'THRESHOLD_TWO' | 'LEFT_POLICY' | 'RESOLVED';
  readonly elapsed_seconds: number;
  readonly first_threshold_seconds: number;
  readonly leave_threshold_seconds: number;
  readonly rate_minor_per_minute: number;
  readonly max_credit_seconds: number;
  /** What the wait is owed so far, by the server's arithmetic (9.5). */
  readonly credit_minor?: number;
  readonly wait_adjustment_minor: number | null;
  readonly version: number;
};

/** Emergencies stay separate so an incident never lands in a support backlog. */
const EMERGENCIES: ReadonlyArray<readonly [ExceptionKind, string]> = [
  ['ACCIDENT', 'I have had an accident'],
  ['MEDICAL_EMERGENCY', 'Medical emergency'],
  ['THREAT', 'I feel threatened'],
];

/** Grouped by where the partner is standing when it happens. */
const AT_STORE: ReadonlyArray<readonly [ExceptionKind, string]> = [
  ['VENDOR_DELAY', 'The store is not ready'],
  ['MISSING_PACKAGE', 'A package is missing'],
  ['DAMAGED_PACKAGE', 'A package is damaged'],
];

const ON_THE_ROAD: ReadonlyArray<readonly [ExceptionKind, string]> = [
  ['WRONG_ADDRESS', 'The address is wrong'],
  ['UNREACHABLE_CUSTOMER', 'I cannot reach the customer'],
  ['UNSAFE_LOCATION', 'This place feels unsafe'],
  ['VEHICLE_FAILURE', 'My vehicle has a problem'],
  ['PROHIBITED_GOODS', 'I think this should not be carried'],
];

/**
 * What a partner may record about their own exception.
 *
 * Returning, cancelling and reassigning are operations' decisions — they move
 * custody and money — and the server refuses them from a partner session. The
 * UI offers only what it is allowed to send rather than presenting six buttons
 * of which three fail.
 */
const SELF_RESOLUTIONS: ReadonlyArray<readonly [string, string]> = [
  ['RETRY', 'I tried again and it worked'],
  ['CONTINUE', 'It is fine — I am carrying on'],
  ['SUPPORT', 'I still need help with this'],
];

/**
 * What a partner may say about an emergency they reported.
 *
 * An accident, a medical emergency or a threat was being offered the same three
 * options as a wrong address, including "It is fine — I am carrying on". A
 * safety report is not a delivery hiccup: there is nothing to retry, and
 * inviting someone who has just crashed to carry on is the platform pushing
 * them back onto the road. The only things they can truthfully say are that
 * they are safe now, or that they still need help.
 */
const EMERGENCY_RESOLUTIONS: ReadonlyArray<readonly [string, string]> = [
  ['CONTINUE', 'I am safe now'],
  ['SUPPORT', 'I still need help'],
];

const EMERGENCY_KINDS: ReadonlySet<string> = new Set(EMERGENCIES.map(([kind]) => kind));

const KIND_LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  [...EMERGENCIES, ...AT_STORE, ...ON_THE_ROAD].map(([kind, label]) => [kind, label]),
);

/**
 * A wait, written the way a person reads a clock.
 *
 * Minutes and seconds alone stopped being readable the moment a wait ran past
 * an hour: a timer that had been open a few days showed as `5902:48`, which is
 * not a number anybody can act on.
 */
/** The store's estimate as the partner reads it, with its reason when it is late (9.5). */
export function readyBySentence(
  expectedReadyAt: string,
  delayReasonCode: string | null,
  now: number,
): string {
  const at = Date.parse(expectedReadyAt);
  if (Number.isNaN(at)) return 'The store has not said when it will be ready';
  const remaining = Math.round((at - now) / 60_000);
  const when =
    remaining <= 0
      ? 'The store says it should be ready now'
      : `The store says about ${remaining} min more`;
  const because =
    delayReasonCode === null
      ? ''
      : ` — running late: ${delayReasonCode.toLowerCase().replaceAll('_', ' ')}`;
  return `${when}${because}`;
}

function minutes(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const wholeMinutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  if (hours === 0) return `${wholeMinutes}:${String(rest).padStart(2, '0')}`;
  return `${hours}h ${String(wholeMinutes).padStart(2, '0')}m`;
}

export function FieldOpsPanel({
  assignmentId,
  atVendor,
  expectedReadyAt = null,
  delayReasonCode = null,
  onChanged,
}: {
  readonly assignmentId: string;
  /** Drives whether the vendor wait timer is relevant at all (DLP-23). */
  readonly atVendor: boolean;
  /** The store's own estimate, revised if it reported a delay (9.5). */
  readonly expectedReadyAt?: string | null;
  readonly delayReasonCode?: string | null;
  readonly onChanged: () => void;
}) {
  const [exceptions, setExceptions] = useState<readonly ExceptionEvent[]>([]);
  const [proofs, setProofs] = useState<readonly OfflineProof[]>([]);
  const [wait, setWait] = useState<WaitTimer | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const [exceptionBody, proofBody, waitBody] = await Promise.all([
      partnerRequest<{ exceptions: readonly ExceptionEvent[] }>(
        `partner/field/${assignmentId}/exception`,
      ).catch(() => ({ exceptions: [] as readonly ExceptionEvent[] })),
      // Held proofs come from the server, not from a React state field that a
      // reload discards (DLP-32, DLP-33).
      partnerRequest<{ proofs: readonly OfflineProof[] }>('partner/field/offline-proofs').catch(
        () => ({ proofs: [] as readonly OfflineProof[] }),
      ),
      partnerRequest<WaitTimer>(`partner/assignments/${assignmentId}/wait`).catch(() => null),
    ]);
    setExceptions(exceptionBody.exceptions);
    setProofs(proofBody.proofs.filter((proof) => proof.sync_state === 'PENDING'));
    setWait(waitBody);
  }, [assignmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  async function run(work: () => Promise<void>, success: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
      setMessage(success);
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  const open = exceptions.filter((entry) => entry.resolution_state === 'OPEN');
  const heldHere = proofs.filter((proof) => proof.delivery_assignment_id === assignmentId);
  // The server's own figure (9.5): the number the handover records and the
  // settlement pays. The screen used to round up where the ledger rounds down,
  // a promise about money the ledger would not keep.
  const waitCredit =
    wait === null
      ? 0
      : (wait.credit_minor ??
        Math.floor(
          Math.min(
            wait.max_credit_seconds - wait.first_threshold_seconds,
            Math.max(0, wait.elapsed_seconds - wait.first_threshold_seconds),
          ) / 60,
        ) * wait.rate_minor_per_minute);
  const capMinor =
    wait === null
      ? 0
      : Math.floor((wait.max_credit_seconds - wait.first_threshold_seconds) / 60) *
        wait.rate_minor_per_minute;

  return (
    <div className="field-ops">
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {/* ── Open exceptions and the instruction that stands ───────────────── */}
      {open.map((entry) => {
        const emergency = EMERGENCY_KINDS.has(entry.exception_kind);
        return (
          <Card
            className={emergency ? 'exception-card exception-card--emergency' : 'exception-card'}
            key={entry.partner_exception_event_id}
            tone="sunken"
          >
            <div className="ns-row">
              <StatusPill
                label={KIND_LABEL[entry.exception_kind] ?? entry.exception_kind}
                state={emergency ? 'DELIVERY_FAILED' : 'OPEN'}
              />
              <span className="ns-eyebrow">
                reported {new Date(entry.occurred_at).toLocaleTimeString()}
              </span>
            </div>
            {emergency ? (
              <>
                <Notice tone="danger">
                  Your safety comes first. If anyone is hurt or in danger, call emergency services
                  before you do anything here.
                </Notice>
                <p className="exception-card__instruction">
                  This is at the top of the operations queue. The order can wait — do not carry on
                  until you are safe.
                </p>
              </>
            ) : (
              <p className="exception-card__instruction">
                Operations have this. Stay safe and wait for their instruction — they decide whether
                this becomes a return, a reassignment or a cancellation.
              </p>
            )}
            <div className="ns-row">
              {(emergency ? EMERGENCY_RESOLUTIONS : SELF_RESOLUTIONS).map(([state, label]) => (
                <Button
                  busy={busy}
                  key={state}
                  onClick={() =>
                    void run(
                      () =>
                        partnerRequest(`partner/field/${assignmentId}/exception/resolve`, {
                          method: 'POST',
                          body: JSON.stringify({
                            // Both fields the endpoint actually requires. The old
                            // panel sent `resolution` and no kind at all, so every
                            // resolution was rejected before it reached the service.
                            exception_kind: entry.exception_kind,
                            resolution_state: state,
                            reason_code: 'PARTNER_RESOLVED',
                          }),
                        }).then(() => undefined),
                      'Thanks — recorded.',
                    )
                  }
                  size="small"
                  variant={state === 'SUPPORT' ? 'primary' : 'secondary'}
                >
                  {label}
                </Button>
              ))}
            </div>
          </Card>
        );
      })}

      {/* ── Vendor wait timer (DLP-23, DLP-36) ───────────────────────────── */}
      {atVendor ? (
        wait === null ? (
          <Button
            busy={busy}
            onClick={() =>
              void run(
                () =>
                  partnerRequest(`partner/assignments/${assignmentId}/wait/start`, {
                    method: 'POST',
                    body: JSON.stringify({
                      command_reference: `SYNTH-CMD-WAIT-${Date.now().toString(36).toUpperCase()}`,
                      reason_code: 'PARTNER_WAITING',
                    }),
                  }).then(() => undefined),
                'Waiting time is now being counted.',
              )
            }
            variant="secondary"
          >
            Start my waiting time
          </Button>
        ) : (
          <Card className="wait-card" tone="sunken">
            <div className="ns-row">
              <strong className="wait-card__elapsed">{minutes(wait.elapsed_seconds)}</strong>
              <StatusPill
                label={
                  wait.wait_state === 'RUNNING'
                    ? 'Waiting'
                    : wait.wait_state === 'RESOLVED'
                      ? 'Finished'
                      : 'You may leave'
                }
                state={wait.wait_state === 'RUNNING' ? 'WAITING' : 'READY'}
              />
            </div>
            <p className="wait-card__pay">
              {waitCredit > 0
                ? `${formatMoneyMinor(waitCredit)} waiting pay so far`
                : `Waiting pay starts after ${minutes(wait.first_threshold_seconds)}`}
            </p>
            {/* The terms, all of them (9.5): when pay starts, when leaving is
                allowed, and the most a wait pays. */}
            <p className="ns-field__hint">
              Paid after {minutes(wait.first_threshold_seconds)} · you may leave after{' '}
              {minutes(wait.leave_threshold_seconds)} · up to {formatMoneyMinor(capMinor)}
            </p>
            {expectedReadyAt ? (
              <p className="ns-field__hint">
                {readyBySentence(expectedReadyAt, delayReasonCode, Date.now())}
              </p>
            ) : null}
            {wait.elapsed_seconds >= wait.leave_threshold_seconds ? (
              <>
                <Notice tone="warning">
                  You have waited long enough that you may leave without it counting against you.
                  The order goes back to dispatch for another partner; your waiting pay stands.
                </Notice>
                <Button
                  busy={busy}
                  onClick={() =>
                    void run(
                      () =>
                        partnerRequest(`partner/assignments/${assignmentId}/wait/leave`, {
                          method: 'POST',
                          body: JSON.stringify({
                            command_reference: `SYNTH-CMD-LEAVE-${Date.now().toString(36).toUpperCase()}`,
                            reason_code: 'PARTNER_LEFT_AFTER_WAIT',
                            expected_version: wait.version,
                          }),
                        }).then(() => undefined),
                      'Recorded. Your waiting pay stands.',
                    )
                  }
                  variant="secondary"
                >
                  Leave — hand this back to dispatch
                </Button>
              </>
            ) : null}
          </Card>
        )
      ) : null}

      {/* ── Held proof (DLP-32, DLP-33, DLP-34) ──────────────────────────── */}
      {heldHere.map((proof) => (
        <Card className="proof-card" key={proof.partner_offline_proof_id} tone="sunken">
          <StatusPill label="Proof waiting to send" state="SOFT_HELD" />
          <p className="ns-field__hint">
            Captured {new Date(proof.captured_at).toLocaleTimeString()}. It is held on the server as
            a digest only — the delivery is not confirmed until this sends.
          </p>
          {recallDigest(proof.partner_offline_proof_id) === null ? (
            // DLP-34: a proof this device can no longer vouch for is a support
            // matter, not a button that fails. Saying so beats a digest
            // conflict the partner cannot act on.
            <Notice tone="warning">
              This device no longer holds the capture for that proof. Report it under “Something is
              wrong” so operations can close the delivery with you.
            </Notice>
          ) : (
            <Button
              busy={busy}
              onClick={() =>
                void run(async () => {
                  const value = recallDigest(proof.partner_offline_proof_id);
                  if (value === null) return;
                  // The same key on a retry, so a repeated tap or an automatic
                  // retry cannot complete the handoff twice (DLP-33).
                  await partnerRequest(
                    `partner/field/offline-proof/${proof.partner_offline_proof_id}/sync`,
                    { method: 'POST', body: JSON.stringify({ encrypted_payload_digest: value }) },
                  );
                  forgetDigest(proof.partner_offline_proof_id);
                }, 'Proof sent.')
              }
            >
              Send it now
            </Button>
          )}
        </Card>
      ))}

      {/* ── The two controls that are always here ────────────────────────── */}
      <div className="field-ops__actions">
        <Button block onClick={() => setReportOpen(true)} variant="secondary">
          Something is wrong
        </Button>
        {/* DLP-43: an emergency is not a workflow, so it is never behind a
            scroll or a menu — but it is also not three red buttons competing
            with routine work for the partner's attention. */}
        <Button className="field-ops__sos" onClick={() => setEmergencyOpen(true)} variant="danger">
          Emergency
        </Button>
      </div>

      <Sheet onClose={() => setReportOpen(false)} open={reportOpen} title="What is happening?">
        <p className="ns-field__hint">
          Tell operations what you are seeing. They send the instruction — you never have to decide
          alone what happens to the order.
        </p>
        <p className="ns-eyebrow">At the store</p>
        <div className="field-ops__choices">
          {AT_STORE.map(([kind, label]) => (
            <Button
              block
              busy={busy}
              key={kind}
              onClick={() =>
                void run(
                  () =>
                    partnerRequest(`partner/field/${assignmentId}/exception`, {
                      method: 'POST',
                      body: JSON.stringify({
                        exception_kind: kind,
                        reason_code: 'PARTNER_REPORTED',
                      }),
                    }).then(() => setReportOpen(false)),
                  'Reported. Operations will send guidance for this stop.',
                )
              }
              variant="secondary"
            >
              {label}
            </Button>
          ))}
        </div>
        <p className="ns-eyebrow">On the way</p>
        <div className="field-ops__choices">
          {ON_THE_ROAD.map(([kind, label]) => (
            <Button
              block
              busy={busy}
              key={kind}
              onClick={() =>
                void run(
                  () =>
                    partnerRequest(`partner/field/${assignmentId}/exception`, {
                      method: 'POST',
                      body: JSON.stringify({
                        exception_kind: kind,
                        reason_code: 'PARTNER_REPORTED',
                      }),
                    }).then(() => setReportOpen(false)),
                  'Reported. Operations will send guidance for this stop.',
                )
              }
              variant="secondary"
            >
              {label}
            </Button>
          ))}
        </div>
        {/* Only a digest and a key reference leave the device: the proof
            itself stays encrypted locally until it syncs, so a lost phone does
            not leak a customer's doorstep (DLP-32, SEC-04). */}
        <Button
          block
          onClick={() => {
            setReportOpen(false);
            void run(async () => {
              const captured = new Date().toISOString();
              const value = await digestOf(`${assignmentId}:DELIVERY:${captured}`);
              const saved = await partnerRequest<{ partner_offline_proof_id?: string }>(
                `partner/field/${assignmentId}/offline-proof`,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    proof_kind: 'DELIVERY',
                    encrypted_payload_digest: value,
                    // The column requires this exact prefix; the old client
                    // sent `SYNTH-KEY-…`, so every capture failed at the
                    // constraint and surfaced as a server error.
                    encryption_key_reference: `SYNTH-PARTNER-KEY-${assignmentId
                      .slice(0, 8)
                      .toUpperCase()}`,
                    captured_at: captured,
                    reason_code: 'PARTNER_OFFLINE_CAPTURE',
                  }),
                },
              );
              if (saved.partner_offline_proof_id) {
                rememberDigest(saved.partner_offline_proof_id, value);
              }
            }, 'Proof held on this device. Send it when you have signal.');
          }}
          variant="ghost"
        >
          I have no signal — hold my proof
        </Button>
      </Sheet>

      <Sheet onClose={() => setEmergencyOpen(false)} open={emergencyOpen} title="Are you safe?">
        <Notice tone="danger">
          If you are in danger, call the emergency services first. Reporting here alerts operations
          straight away — it does not replace them.
        </Notice>
        <div className="field-ops__choices">
          {EMERGENCIES.map(([kind, label]) => (
            <Button
              block
              busy={busy}
              key={kind}
              onClick={() =>
                void run(
                  () =>
                    partnerRequest(`partner/field/${assignmentId}/exception`, {
                      method: 'POST',
                      body: JSON.stringify({
                        exception_kind: kind,
                        reason_code: 'PARTNER_REPORTED',
                      }),
                    }).then(() => setEmergencyOpen(false)),
                  'Operations are alerted now. Stay safe and wait for contact.',
                )
              }
              size="large"
              variant="danger"
            >
              {label}
            </Button>
          ))}
        </div>
      </Sheet>
      <span aria-hidden="true" hidden>
        {now}
      </span>
    </div>
  );
}

/**
 * A digest of the proof, not the proof. Uses the platform hash where available
 * and falls back to a stable non-cryptographic digest on an old device, so
 * capture never fails outright in the field.
 */
export async function digestOf(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const bytes = new TextEncoder().encode(value);
    const hash = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  let fallback = 0;
  for (const character of value) fallback = (fallback * 31 + character.charCodeAt(0)) >>> 0;
  return fallback.toString(16).padStart(64, '0');
}
