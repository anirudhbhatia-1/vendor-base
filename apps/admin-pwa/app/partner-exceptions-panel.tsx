'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  LoadingState,
  Notice,
  Panel,
  SelectField,
  StatusPill,
} from '@neighbourhood-store/ui';
import { adminRequest } from './authenticated-api';

/**
 * The operations side of a partner's guided exception (DLP-37 – DLP-42, ADM-05).
 *
 * The partner app tells someone reporting an unsafe address or a missing
 * package that operations have it and will send an instruction. Nothing here
 * could read those reports — they were listable only per assignment, behind a
 * capability that grants to the partner working it — so the report went into a
 * void and the person waiting in the field was promised a reply nobody could
 * compose.
 */
type OpenException = {
  readonly partner_exception_event_id: string;
  readonly delivery_assignment_id: string;
  readonly exception_kind: string;
  readonly occurred_at: string;
  readonly is_emergency: boolean;
  readonly source_order_reference: string;
  readonly assignment_state: string;
};

/**
 * What operations may direct.
 *
 * The partner can record that they retried, carried on, or still need help.
 * These three move custody and money, so the service refuses them from a
 * partner session and they belong only here.
 */
const DIRECTED = [
  ['RETURN_TO_VENDOR', 'Return it to the store'],
  ['REASSIGN', 'Reassign to another partner'],
  ['CANCEL', 'Cancel this delivery'],
  ['CONTINUE', 'Carry on as planned'],
  ['RETRY', 'Try again'],
  ['SUPPORT', 'Keep with support'],
] as const;

const KIND_COPY: Readonly<Record<string, string>> = {
  ACCIDENT: 'Accident',
  MEDICAL_EMERGENCY: 'Medical emergency',
  THREAT: 'Threat to the partner',
  VENDOR_DELAY: 'Store not ready',
  MISSING_PACKAGE: 'Package missing',
  DAMAGED_PACKAGE: 'Package damaged',
  UNREACHABLE_CUSTOMER: 'Customer unreachable',
  WRONG_ADDRESS: 'Wrong address',
  UNSAFE_LOCATION: 'Unsafe location',
  VEHICLE_FAILURE: 'Vehicle failure',
  PROHIBITED_GOODS: 'Possible prohibited goods',
};

function shortReference(value: string): string {
  const tail = value.split('-').at(-1) ?? value;
  return tail.slice(-8).toUpperCase();
}

export function PartnerExceptionsPanel() {
  const [open, setOpen] = useState<readonly OpenException[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await adminRequest<{ exceptions?: readonly OpenException[] }>(
        'admin/partner-exceptions',
      );
      setOpen(body.exceptions ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Partner reports could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // A partner standing in an unsafe place is not going to press refresh for
    // us, so the queue keeps itself current while the tab is visible.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function direct(entry: OpenException) {
    const resolution = choice[entry.partner_exception_event_id] ?? 'SUPPORT';
    setBusy(entry.partner_exception_event_id);
    setError(null);
    try {
      await adminRequest(`admin/partner-exceptions/${entry.delivery_assignment_id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          exception_kind: entry.exception_kind,
          resolution_state: resolution,
          reason_code: 'OPERATIONS_DIRECTED',
        }),
      });
      setMessage(
        `Instruction sent for ${shortReference(entry.source_order_reference)}: ${resolution
          .replaceAll('_', ' ')
          .toLowerCase()}.`,
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That instruction could not be sent.');
    } finally {
      setBusy(null);
    }
  }

  const emergencies = open.filter((entry) => entry.is_emergency);

  return (
    <Panel
      actions={
        <Button onClick={() => void load()} variant="secondary">
          Refresh
        </Button>
      }
      description="A partner reported this from the field and is waiting for an instruction."
      eyebrow="Live delivery"
      id="partner-exceptions"
      level={2}
      title={`${open.length} partner ${open.length === 1 ? 'report' : 'reports'} open`}
    >
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {emergencies.length > 0 ? (
        <Notice live="assertive" tone="danger">
          {emergencies.length === 1
            ? 'One partner has raised an emergency.'
            : `${emergencies.length} partners have raised an emergency.`}{' '}
          Safety comes before every other item in this queue.
        </Notice>
      ) : null}

      {loading ? (
        <LoadingState label="Loading partner reports…" lines={3} />
      ) : open.length === 0 ? (
        <EmptyState
          description="Reports from partners in the field appear here, emergencies first."
          glyph="◌"
          title="Nothing waiting"
        />
      ) : (
        <ul className="exception-queue">
          {open.map((entry) => (
            <li key={entry.partner_exception_event_id}>
              <Card tone={entry.is_emergency ? 'raised' : 'sunken'}>
                <div className="queue-heading">
                  <div>
                    <StatusPill
                      label={KIND_COPY[entry.exception_kind] ?? entry.exception_kind}
                      state={entry.is_emergency ? 'CANCELLED' : 'OPEN'}
                    />
                    <p className="eyebrow">
                      {shortReference(entry.source_order_reference)} ·{' '}
                      {entry.assignment_state.replaceAll('_', ' ').toLowerCase()} · reported{' '}
                      {new Date(entry.occurred_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                <div className="actions">
                  <SelectField
                    label="Instruction"
                    onChange={(event) =>
                      setChoice((current) => ({
                        ...current,
                        [entry.partner_exception_event_id]: event.target.value,
                      }))
                    }
                    value={choice[entry.partner_exception_event_id] ?? 'SUPPORT'}
                  >
                    {DIRECTED.map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </SelectField>
                  <Button
                    busy={busy === entry.partner_exception_event_id}
                    onClick={() => void direct(entry)}
                  >
                    Send instruction
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
