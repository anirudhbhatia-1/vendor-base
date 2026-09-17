'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './authenticated-api';

/**
 * Incident controls (ADM-33, ADM-34, ADM-35).
 *
 * A kill switch is only safe if the operator can see what it will affect before
 * throwing it, and can put it back afterwards. All three endpoints existed with
 * no caller, so the only way to stop a misbehaving zone or vendor was a database
 * intervention — exactly what EXC-12 forbids.
 */
type WorkItem = {
  readonly kind: string;
  readonly object_id: string;
  readonly title: string;
  readonly risk_minor: number;
  readonly next_action: string;
  readonly created_at: string;
};

/** The controls the schema recognises. Anything else is rejected on write. */
const controlKeys = [
  ['GROUPED_CHECKOUT_PAUSE', 'Pause grouped checkout'],
  ['DELIVERY_PAUSE', 'Pause delivery'],
  ['PARTNER_ASSIGNMENT_PAUSE', 'Pause partner assignment'],
  ['PAYMENT_PAUSE', 'Pause payment capture'],
  ['PAYOUT_PAUSE', 'Pause payouts'],
  ['SUBSTITUTION_PAUSE', 'Pause substitutions'],
  ['PROMOTION_PAUSE', 'Pause promotions'],
  ['VENDOR_PAUSE', 'Pause a vendor'],
  ['CATEGORY_PAUSE', 'Pause a category'],
  ['ZONE_PAUSE', 'Pause a zone'],
] as const;

const scopeKinds = ['GLOBAL', 'ZONE', 'VENDOR_LOCATION'] as const;

export function IncidentsPanel() {
  const [active, setActive] = useState<WorkItem[]>([]);
  const [controlKey, setControlKey] = useState<string>('GROUPED_CHECKOUT_PAUSE');
  const [scopeKind, setScopeKind] = useState<string>('GLOBAL');
  const [scopeReference, setScopeReference] = useState('GLOBAL');
  const [message, setMessage] = useState('Load the control-plane queue to see active controls.');

  const load = useCallback(async () => {
    try {
      const result = await adminRequest<{ items?: WorkItem[] }>('admin/control/dashboard');
      const items = (result.items ?? []).filter((item) => item.kind === 'INCIDENT');
      setActive(items);
      setMessage(`${items.length} incident control${items.length === 1 ? '' : 's'} active.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Active controls failed to load.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The impact preview (ADM-34). Nothing is changed here: it reports what the
   * control would currently apply to, so the operator sees the blast radius
   * before committing.
   */
  async function previewImpact() {
    try {
      const orders = await adminRequest<{ checkout_groups?: Record<string, unknown>[] }>(
        'admin/control/orders',
      );
      const groups = orders.checkout_groups ?? [];
      const affected =
        scopeKind === 'GLOBAL'
          ? groups
          : groups.filter((group) =>
              JSON.stringify(group['orders'] ?? '').includes(scopeReference),
            );
      setMessage(
        `${controlKey} over ${scopeKind} ${scopeReference} currently covers ${affected.length} of ${groups.length} live checkout groups.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The impact preview failed.');
    }
  }

  async function engage() {
    try {
      const now = Date.now();
      await adminRequest('admin/control/incidents', {
        method: 'POST',
        body: JSON.stringify({
          control_key: controlKey,
          scope_kind: scopeKind,
          scope_reference: scopeReference,
          reason_code: 'ADMIN_INCIDENT_CONTROL',
          expires_at: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
          review_at: new Date(now + 30 * 60 * 1000).toISOString(),
          obligations: { review_owner: 'operations', communicate_to: 'affected_vendors' },
        }),
      });
      setMessage(`${controlKey} engaged over ${scopeKind} ${scopeReference}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The control could not be engaged.');
    }
  }

  /** Recovery is a reversal, never a deletion: the control keeps its history. */
  async function revoke(item: WorkItem) {
    try {
      await adminRequest(`admin/control/incidents/${item.object_id}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ reason_code: 'ADMIN_INCIDENT_RECOVERED' }),
      });
      setMessage(`${item.title} revoked. Normal operation resumes.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The control could not be revoked.');
    }
  }

  async function expireDue() {
    try {
      const result = await adminRequest<{ trust?: number; incidents?: number }>(
        'admin/control/maintenance/expire',
        { method: 'POST' },
      );
      setMessage(
        `Expiry sweep: ${result.incidents ?? 0} incident and ${result.trust ?? 0} trust controls closed.`,
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The expiry sweep failed.');
    }
  }

  return (
    <section className="catalogue-oversight" id="incidents">
      <div>
        <p className="eyebrow">INCIDENT CONTROLS</p>
        <h2>{active.length} active</h2>
        <p>
          Controls are bounded: each carries an expiry, a review time and the obligations that come
          with using it. Recovery reverses a control, it does not erase it.
        </p>
      </div>
      <p aria-live="polite">{message}</p>
      <div className="catalogue-flag">
        <label>
          Control
          <select value={controlKey} onChange={(event) => setControlKey(event.target.value)}>
            {controlKeys.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scope
          <select value={scopeKind} onChange={(event) => setScopeKind(event.target.value)}>
            {scopeKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scope reference
          <input value={scopeReference} onChange={(e) => setScopeReference(e.target.value)} />
        </label>
        <div className="actions">
          <button type="button" onClick={() => void previewImpact()}>
            Preview impact
          </button>
          <button type="button" onClick={() => void engage()}>
            Engage control
          </button>
          <button type="button" onClick={() => void expireDue()}>
            Expire due controls
          </button>
          <button type="button" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>
      <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
        {active.length === 0 && <p>No incident control is engaged.</p>}
        {active.map((item) => (
          <article key={item.object_id}>
            <span>{item.next_action}</span>
            <strong>{item.title}</strong>
            <p>Engaged {new Date(item.created_at).toLocaleString()}</p>
            <button type="button" onClick={() => void revoke(item)}>
              Revoke and recover
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
