'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './authenticated-api';

type Vendor = {
  readonly business_name: string;
  readonly email: string;
  readonly lifecycle_state: string;
  readonly location_name: string;
  readonly user_id: string;
  readonly vendor_id: string;
  readonly vendor_location_id: string;
  readonly version: number;
};
type Partner = {
  readonly email: string;
  readonly lifecycle_state: string;
  readonly user_id: string;
  readonly version: number;
};

export function LifecyclePanel({ kind }: { kind: 'partners' | 'vendors' }) {
  const [vendors, setVendors] = useState<readonly Vendor[]>([]);
  const [partners, setPartners] = useState<readonly Partner[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState(`Loading ${kind}…`);

  const load = useCallback(async () => {
    try {
      if (kind === 'vendors') {
        const body = await adminRequest<{ readonly items: readonly Vendor[] }>(
          'admin/onboarding/vendors',
        );
        setVendors(body.items);
        setMessage(`${body.items.length} vendor account${body.items.length === 1 ? '' : 's'}.`);
      } else {
        const body = await adminRequest<{ readonly items: readonly Partner[] }>(
          'admin/onboarding/partners',
        );
        setPartners(body.items);
        setMessage(`${body.items.length} partner account${body.items.length === 1 ? '' : 's'}.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `The ${kind} could not be loaded.`);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  async function transition(input: {
    readonly id: string;
    readonly version: number;
    readonly action: 'reinstate' | 'suspend';
  }) {
    setBusyId(input.id);
    try {
      await adminRequest(`admin/onboarding/${kind}/${input.id}/${input.action}`, {
        method: 'POST',
        body: JSON.stringify({
          expected_version: input.version,
          reason_code:
            input.action === 'suspend'
              ? 'ADMIN_LIFECYCLE_SUSPENSION'
              : 'ADMIN_LIFECYCLE_REINSTATEMENT',
        }),
      });
      await load();
      setMessage(
        `${kind === 'vendors' ? 'Vendor' : 'Partner'} ${input.action}d. Access and active sessions were updated together.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : `The account could not be ${input.action}d.`,
      );
    } finally {
      setBusyId(null);
    }
  }

  const items =
    kind === 'vendors'
      ? vendors.map((item) => ({
          id: item.vendor_id,
          title: item.business_name.replace(/^SYNTH\s+/i, ''),
          subtitle: `${item.location_name.replace(/^SYNTH\s+/i, '')} · ${item.email}`,
          state: item.lifecycle_state,
          version: item.version,
        }))
      : partners.map((item) => ({
          id: item.user_id,
          title: item.email,
          subtitle: 'Delivery partner account',
          state: item.lifecycle_state,
          version: item.version,
        }));

  return (
    <article className="case-workbench" aria-labelledby={`${kind}-lifecycle-title`}>
      <div className="catalogue-heading">
        <div>
          <p className="eyebrow">ACCOUNT LIFECYCLE</p>
          <h2 id={`${kind}-lifecycle-title`}>Active access, without deleting history.</h2>
        </div>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <p aria-live="polite">{message}</p>
      {items.map((item) => {
        const suspended = item.state === 'SUSPENDED';
        return (
          <div className="catalogue-flag" key={item.id}>
            <span>
              <strong>{item.title}</strong>
              <small>{item.subtitle}</small>
            </span>
            <em className={suspended ? 'state-inactive' : 'state-active'}>{item.state}</em>
            <button
              type="button"
              disabled={busyId === item.id}
              onClick={() =>
                void transition({
                  id: item.id,
                  version: item.version,
                  action: suspended ? 'reinstate' : 'suspend',
                })
              }
            >
              {busyId === item.id ? 'Updating…' : suspended ? 'Reinstate' : 'Suspend'}
            </button>
          </div>
        );
      })}
      {!items.length && <p className="empty-state">No accounts have been provisioned.</p>}
    </article>
  );
}
