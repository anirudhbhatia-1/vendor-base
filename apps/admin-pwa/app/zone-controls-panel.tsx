'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './authenticated-api';

/**
 * Closing and reopening a neighbourhood.
 *
 * The zones route was a single read, so a neighbourhood that became
 * undeliverable — a storm, a festival, a closed road — could only be taken out
 * of service by editing the database, which EXC-12 forbids. Discovery filters
 * on the zone's state, so a suspension reaches customers on their next read
 * with nothing to invalidate.
 *
 * Deliberately not zone editing. Redrawing a boundary changes who a shop can
 * ever serve; closing one changes who it can serve today, and only the second
 * is a thing to do under pressure.
 */
type Zone = {
  readonly service_zone_id: string;
  readonly zone_name: string;
  readonly location_name: string;
  readonly lifecycle_state: 'ACTIVE' | 'INACTIVE';
  readonly version: number;
};

export function ZoneControlsPanel() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [reason, setReason] = useState('WEATHER_INCIDENT');
  const [message, setMessage] = useState('Loading service zones…');

  const load = useCallback(async () => {
    try {
      const result = await adminRequest<{ zones?: Zone[] }>('admin/zones');
      const list = result.zones ?? [];
      setZones(list);
      const closed = list.filter((zone) => zone.lifecycle_state !== 'ACTIVE').length;
      setMessage(
        closed === 0
          ? `${list.length} service zone${list.length === 1 ? '' : 's'}, all serving.`
          : `${closed} of ${list.length} service zones are closed.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Service zones failed to load.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function transition(zone: Zone) {
    const action = zone.lifecycle_state === 'ACTIVE' ? 'suspend' : 'resume';
    if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(reason)) {
      setMessage('A reason code is required, in SHOUTING_SNAKE_CASE.');
      return;
    }
    try {
      await adminRequest(`admin/zones/${zone.service_zone_id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ expected_version: zone.version, reason_code: reason }),
      });
      setMessage(
        action === 'suspend'
          ? `${zone.zone_name} closed. Shops stop being offered there on the next customer read.`
          : `${zone.zone_name} reopened.`,
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The zone could not be changed.');
    }
  }

  return (
    <section className="catalogue-oversight" id="zone-controls">
      <div>
        <p className="eyebrow">SERVICE ZONES</p>
        <h2>{zones.filter((zone) => zone.lifecycle_state === 'ACTIVE').length} serving</h2>
        <p>
          Closing a zone stops every shop being offered there, immediately and reversibly. Orders
          already placed are unaffected; this changes what customers are shown next.
        </p>
      </div>
      <p aria-live="polite">{message}</p>
      <div className="catalogue-flag">
        <label>
          Reason
          <input value={reason} onChange={(event) => setReason(event.target.value.toUpperCase())} />
        </label>
        <div className="actions">
          <button type="button" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>
      <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
        {zones.length === 0 && <p>No service zone is defined.</p>}
        {zones.map((zone) => (
          <article key={zone.service_zone_id}>
            <span>{zone.lifecycle_state === 'ACTIVE' ? 'serving' : 'closed'}</span>
            <strong>{zone.zone_name}</strong>
            <p>{zone.location_name}</p>
            <button type="button" onClick={() => void transition(zone)}>
              {zone.lifecycle_state === 'ACTIVE' ? 'Close this zone' : 'Reopen this zone'}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
