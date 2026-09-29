'use client';
import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './authenticated-api';

/**
 * Incident controls (11.7; ADM-33, ADM-34, ADM-35).
 *
 * A pause names one flow in a scope the server can act on. Before it is
 * engaged the operator sees what stops and what carries on, with counts; it
 * carries an owner, a reason, the banner people see, an expiry and a review;
 * a broad or money-touching pause waits for a second commander; and it is
 * lifted only once its recovery checklist is worked. Until audit run 79 this
 * screen previewed by searching live orders for the scope's text, offered
 * pauses nothing enforced, and "revoked" by overwriting the last engagement.
 */
export type IncidentCatalogueEntry = {
  readonly key: string;
  readonly title: string;
  readonly scopes: readonly string[];
  readonly approval: 'ALWAYS' | 'WHEN_GLOBAL';
  readonly stops: string;
  readonly continues: readonly string[];
  readonly checklist: readonly string[];
};

type Count = { readonly label: string; readonly count: number };

type Preview = {
  readonly title: string;
  readonly approval_required: boolean;
  readonly stops: { readonly rule: string; readonly counts: readonly Count[] };
  readonly continues: { readonly rules: readonly string[]; readonly counts: readonly Count[] };
  readonly checklist: readonly string[];
};

export type IncidentControl = {
  readonly incident_control_id: string;
  readonly title: string;
  readonly scope: { readonly kind: string; readonly reference: string };
  readonly state: string;
  readonly reason_code: string;
  readonly banner: string | null;
  readonly expires_at: string;
  readonly review_at: string;
  readonly review_overdue: boolean;
  readonly closing_reason_code: string | null;
  readonly continues: readonly string[];
  readonly recovery_checklist: readonly {
    readonly item: string;
    readonly done_at: string | null;
  }[];
  readonly checklist_open: number;
  readonly actions: readonly string[];
  readonly version: number;
};

const SCOPE_LABELS: Record<string, string> = {
  GLOBAL: 'Everywhere',
  ZONE: 'A service zone (id or name)',
  VENDOR_LOCATION: 'One shop (location id)',
  CATEGORY: 'A category',
  PAYMENT_METHOD: 'A payment method',
  PAYOUT_BENEFICIARY: 'Payouts to',
};

/** The fixed choices a scope takes; other scopes take typed text. */
export function scopeChoices(kind: string): readonly string[] | null {
  switch (kind) {
    case 'GLOBAL':
      return ['global'];
    case 'PAYMENT_METHOD':
      return ['UPI', 'CARD', 'WALLET'];
    case 'PAYOUT_BENEFICIARY':
      return ['VENDOR', 'PARTNER'];
    default:
      return null;
  }
}

/** Whether a second commander must approve before it takes force. */
export function approvalNeeded(entry: Pick<IncidentCatalogueEntry, 'approval'>, kind: string) {
  return entry.approval === 'ALWAYS' || kind === 'GLOBAL';
}

/** A reason as the server records it. */
export function reasonCode(text: string): string {
  return text
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The engagement request, with review and expiry the server accepts by default. */
export function engageBody(
  input: {
    readonly control_key: string;
    readonly scope_kind: string;
    readonly scope_reference: string;
    readonly reason: string;
    readonly banner: string;
    readonly hours: number;
    readonly review_minutes: number;
  },
  nowMs: number,
) {
  const hours = Math.min(Math.max(input.hours, 1), 7 * 24);
  const reviewMinutes = Math.min(Math.max(input.review_minutes, 5), 24 * 60, hours * 60);
  return {
    control_key: input.control_key,
    scope_kind: input.scope_kind,
    scope_reference: input.scope_kind === 'GLOBAL' ? 'global' : input.scope_reference.trim(),
    reason_code: reasonCode(input.reason),
    banner: input.banner.trim(),
    expires_at: new Date(nowMs + hours * 3_600_000).toISOString(),
    review_at: new Date(nowMs + reviewMinutes * 60_000).toISOString(),
  };
}

export function IncidentsPanel() {
  const [catalogue, setCatalogue] = useState<IncidentCatalogueEntry[]>([]);
  const [controls, setControls] = useState<IncidentControl[]>([]);
  const [controlKey, setControlKey] = useState('');
  const [scopeKind, setScopeKind] = useState('');
  const [scopeReference, setScopeReference] = useState('');
  const [reason, setReason] = useState('');
  const [banner, setBanner] = useState('');
  const [hours, setHours] = useState(2);
  const [reviewMinutes, setReviewMinutes] = useState(30);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState('Loading incident controls.');

  const entry = catalogue.find((candidate) => candidate.key === controlKey);

  const load = useCallback(async () => {
    try {
      const [listed, register] = await Promise.all([
        adminRequest<{ controls: IncidentCatalogueEntry[] }>('admin/incidents/catalogue'),
        adminRequest<{ controls: IncidentControl[] }>('admin/incidents'),
      ]);
      setCatalogue(listed.controls);
      setControls(register.controls);
      setControlKey((current) => current || listed.controls[0]?.key || '');
      setScopeKind((current) => current || listed.controls[0]?.scopes[0] || '');
      const live = register.controls.filter((control) =>
        ['ACTIVE', 'PENDING_APPROVAL'].includes(control.state),
      ).length;
      setMessage(`${live} pause${live === 1 ? '' : 's'} engaged or awaiting approval.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Incident controls failed to load.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function chooseControl(key: string) {
    const next = catalogue.find((candidate) => candidate.key === key);
    setControlKey(key);
    setScopeKind(next?.scopes[0] ?? '');
    setScopeReference(scopeChoices(next?.scopes[0] ?? '')?.[0] ?? '');
    setPreview(null);
  }

  function chooseScope(kind: string) {
    setScopeKind(kind);
    setScopeReference(scopeChoices(kind)?.[0] ?? '');
    setPreview(null);
  }

  async function previewImpact() {
    try {
      setPreview(
        await adminRequest<Preview>('admin/incidents/preview', {
          method: 'POST',
          body: JSON.stringify({
            control_key: controlKey,
            scope_kind: scopeKind,
            scope_reference: scopeKind === 'GLOBAL' ? 'global' : scopeReference.trim(),
          }),
        }),
      );
      setMessage('Preview ready. Nothing has changed yet.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The preview failed.');
    }
  }

  async function engage() {
    if (!preview) {
      setMessage('Preview what the pause stops and what carries on first.');
      return;
    }
    if (!reasonCode(reason)) {
      setMessage('Say why this pause is needed.');
      return;
    }
    try {
      const control = await adminRequest<IncidentControl>('admin/incidents', {
        method: 'POST',
        body: JSON.stringify(
          engageBody(
            {
              control_key: controlKey,
              scope_kind: scopeKind,
              scope_reference: scopeReference,
              reason,
              banner,
              hours,
              review_minutes: reviewMinutes,
            },
            Date.now(),
          ),
        ),
      });
      setMessage(
        control.state === 'PENDING_APPROVAL'
          ? `${control.title} is proposed; a second commander approves it before it takes force.`
          : `${control.title} is engaged.`,
      );
      setPreview(null);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The pause could not be engaged.');
    }
  }

  async function act(control: IncidentControl, action: string, extra: object = {}) {
    try {
      await adminRequest(`admin/incidents/${control.incident_control_id}/actions/${action}`, {
        method: 'POST',
        body: JSON.stringify({
          expected_version: control.version,
          reason_code: reasonCode(reason) || `INCIDENT_${action}`,
          ...extra,
        }),
      });
      setMessage(`${control.title}: ${action.toLowerCase()} recorded.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `The ${action.toLowerCase()} failed.`);
    }
  }

  const choices = scopeChoices(scopeKind);

  return (
    <section className="catalogue-oversight" id="incidents">
      <div>
        <p className="eyebrow">INCIDENT CONTROLS</p>
        <h2>Pause one flow, see what carries on, lift it safely</h2>
        <p>
          A pause stops new work only: orders already placed, goods with partners and money already
          moving carry on. Each engagement keeps its own record.
        </p>
      </div>
      <p aria-live="polite">{message}</p>
      <div className="catalogue-flag">
        <label>
          Pause
          <select value={controlKey} onChange={(event) => chooseControl(event.target.value)}>
            {catalogue.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {candidate.title}
              </option>
            ))}
          </select>
        </label>
        {entry && <small>Stops: {entry.stops}</small>}
        <label>
          Scope
          <select value={scopeKind} onChange={(event) => chooseScope(event.target.value)}>
            {(entry?.scopes ?? []).map((kind) => (
              <option key={kind} value={kind}>
                {SCOPE_LABELS[kind] ?? kind}
              </option>
            ))}
          </select>
        </label>
        {scopeKind !== 'GLOBAL' && (
          <label>
            Which
            {choices ? (
              <select
                value={scopeReference}
                onChange={(event) => setScopeReference(event.target.value)}
              >
                {choices.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={scopeReference}
                onChange={(event) => setScopeReference(event.target.value)}
              />
            )}
          </label>
        )}
        <label>
          Reason
          <input
            placeholder="e.g. store power cut"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <label>
          Banner people see
          <input
            maxLength={200}
            placeholder="e.g. This shop is not taking new orders for now."
            value={banner}
            onChange={(event) => setBanner(event.target.value)}
          />
        </label>
        <label>
          Expires after (hours, at most a week)
          <input
            inputMode="numeric"
            type="number"
            min={1}
            max={168}
            value={hours}
            onChange={(event) => setHours(Number(event.target.value))}
          />
        </label>
        <label>
          First review in (minutes, within a day)
          <input
            inputMode="numeric"
            type="number"
            min={5}
            max={1440}
            value={reviewMinutes}
            onChange={(event) => setReviewMinutes(Number(event.target.value))}
          />
        </label>
        {entry && approvalNeeded(entry, scopeKind) && (
          <small>A second incident commander approves this before it takes force.</small>
        )}
        <div className="actions">
          <button type="button" disabled={!entry} onClick={() => void previewImpact()}>
            Preview impact
          </button>
          <button type="button" disabled={!preview} onClick={() => void engage()}>
            {entry && approvalNeeded(entry, scopeKind) ? 'Propose pause' : 'Engage pause'}
          </button>
          <button type="button" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>

      {preview && (
        <article className="catalogue-flag" aria-label="Impact preview">
          <h3>{preview.title}</h3>
          <p>
            <strong>Stops:</strong> {preview.stops.rule}
          </p>
          <ul>
            {preview.stops.counts.map((count) => (
              <li key={count.label}>
                {count.label}: {count.count}
              </li>
            ))}
          </ul>
          <p>
            <strong>Carries on:</strong>
          </p>
          <ul>
            {preview.continues.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
            {preview.continues.counts.map((count) => (
              <li key={count.label}>
                {count.label}: {count.count}
              </li>
            ))}
          </ul>
          <p>
            <strong>Before lifting:</strong> {preview.checklist.join('; ')}.
          </p>
        </article>
      )}

      <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
        {controls.length === 0 && <p>No incident control has been engaged.</p>}
        {controls.map((control) => (
          <article key={control.incident_control_id}>
            <span>
              {control.state}
              {control.review_overdue ? ' · review overdue' : ''}
            </span>
            <strong>{control.title}</strong>
            <p>
              {SCOPE_LABELS[control.scope.kind] ?? control.scope.kind}{' '}
              {control.scope.kind === 'GLOBAL' ? '' : control.scope.reference} ·{' '}
              {control.reason_code}
            </p>
            {control.banner && <p>“{control.banner}”</p>}
            <small>
              Review by {new Date(control.review_at).toLocaleString()}; expires{' '}
              {new Date(control.expires_at).toLocaleString()}
            </small>
            {control.closing_reason_code && <small>Closed: {control.closing_reason_code}</small>}
            {control.state === 'ACTIVE' && (
              <ol aria-label="Recovery checklist">
                {control.recovery_checklist.map((item, index) => (
                  <li key={item.item}>
                    {item.done_at ? '✓ ' : ''}
                    {item.item}
                    {!item.done_at && (
                      <button
                        type="button"
                        onClick={() => void act(control, 'CHECK', { item_index: index })}
                      >
                        Done
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <div className="actions">
              {control.actions.includes('APPROVE') && (
                <button type="button" onClick={() => void act(control, 'APPROVE')}>
                  Approve
                </button>
              )}
              {control.actions.includes('REJECT') && (
                <button type="button" onClick={() => void act(control, 'REJECT')}>
                  Reject
                </button>
              )}
              {control.actions.includes('REVIEW') && (
                <button
                  type="button"
                  onClick={() =>
                    void act(control, 'REVIEW', {
                      review_at: new Date(
                        Math.min(Date.now() + 60 * 60_000, new Date(control.expires_at).getTime()),
                      ).toISOString(),
                    })
                  }
                >
                  Reviewed — next in an hour
                </button>
              )}
              {control.actions.includes('REVOKE') && (
                <button
                  type="button"
                  disabled={control.checklist_open > 0}
                  onClick={() => void act(control, 'REVOKE')}
                >
                  Lift pause
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
