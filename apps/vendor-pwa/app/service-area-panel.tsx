'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  LocationPicker,
  Notice,
  Panel,
  StatusPill,
  circleWkt,
  humaniseEnum,
  type GeoPoint,
} from '@neighbourhood-store/ui';
import { vendorRequest } from './authenticated-api';
import { useMapsConfig } from './maps-config';

/**
 * Service zones, fulfilment modes and temporary closures (VEN-07, VEN-09, VEN-06).
 *
 * These decide who can even see the store, so a screen that displayed them
 * without letting anyone change them left the vendor unable to open, close or
 * change where they deliver.
 *
 * Zones are polygons. A vendor draws one as a circle on the map -- the
 * centre they place and a radius in metres -- which becomes the WKT the API
 * stores (D-17). The corner editor remains behind a disclosure for anyone
 * without a map; its coordinates are longitude/latitude in that order, which
 * is what PostGIS expects and the most common way to get a polygon silently
 * wrong.
 */
/**
 * `GET settings/fulfilment-modes` returns a plain array of mode names — the
 * table only holds the modes a location actually offers, so presence is the
 * enablement. The panel used to type this as objects with an optional
 * `fulfilment_method` and render `?? 'MODE'`, which printed the literal word
 * "MODE" once per row and never once said what the store does.
 */
type FulfilmentMode = string;

type ServiceZone = {
  readonly service_zone_id: string;
  readonly zone_name: string;
  readonly lifecycle_state: string;
  readonly area_square_metres: number;
  readonly created_at: string;
};

type TemporaryClosure = {
  readonly temporary_closure_id: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly reason_code: string;
};

/** Said the way a shopkeeper would say it, not the way the column stores it. */
const MODE_LABEL: Record<string, string> = {
  CUSTOMER_PICKUP: 'Customer collects from the shop',
  PLATFORM_DELIVERY: 'A delivery partner brings it',
  VENDOR_DELIVERY: 'You deliver it yourself',
};

/** Square metres are unreadable at neighbourhood scale; square kilometres are. */
function area(squareMetres: number): string {
  const squareKm = squareMetres / 1_000_000;
  return squareKm < 0.1
    ? `${Math.round(squareMetres / 1000) / 10} hectares`
    : `${squareKm.toFixed(squareKm < 10 ? 1 : 0)} km²`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

type Vertex = { readonly longitude: string; readonly latitude: string };

const emptyVertices: readonly Vertex[] = [
  { longitude: '75.7628', latitude: '26.8505' },
  { longitude: '75.7728', latitude: '26.8505' },
  { longitude: '75.7728', latitude: '26.8605' },
  { longitude: '75.7628', latitude: '26.8605' },
];

/** Closes the ring: PostGIS requires the first and last vertex to match. */
export function verticesToWkt(vertices: readonly Vertex[]): string {
  const points = vertices
    .map((vertex) => `${Number(vertex.longitude)} ${Number(vertex.latitude)}`)
    .filter((point) => !point.includes('NaN'));
  if (points.length < 3) throw new Error('A zone needs at least three vertices.');
  const first = points[0] as string;
  const ring = points[points.length - 1] === first ? points : [...points, first];
  return `POLYGON((${ring.join(', ')}))`;
}

export function ServiceAreaPanel({ vendorLocationId }: { readonly vendorLocationId: string }) {
  const [modes, setModes] = useState<readonly FulfilmentMode[]>([]);
  const [zones, setZones] = useState<readonly ServiceZone[]>([]);
  const [closures, setClosures] = useState<readonly TemporaryClosure[]>([]);
  const [vertices, setVertices] = useState<Vertex[]>([...emptyVertices]);
  const [zoneName, setZoneName] = useState('Neighbourhood');
  const [zoneCentre, setZoneCentre] = useState<GeoPoint | null>(null);
  const [zoneRadiusMetres, setZoneRadiusMetres] = useState('2000');
  const [cornersByHand, setCornersByHand] = useState(false);
  const maps = useMapsConfig();
  const [editingBoundary, setEditingBoundary] = useState(false);
  const [closureStart, setClosureStart] = useState('');
  const [closureEnd, setClosureEnd] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!vendorLocationId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [modeResult, zoneResult, closureResult] = await Promise.all([
        vendorRequest<{ fulfilment_modes: readonly FulfilmentMode[] }>(
          `vendor/locations/${vendorLocationId}/settings/fulfilment-modes`,
        ),
        vendorRequest<{ zones: readonly ServiceZone[] }>(
          `vendor/locations/${vendorLocationId}/settings/zones`,
        ),
        vendorRequest<{ closures: readonly TemporaryClosure[] }>(
          `vendor/locations/${vendorLocationId}/settings/closures`,
        ),
      ]);
      setModes(modeResult.fulfilment_modes);
      setZones(zoneResult.zones);
      setClosures(closureResult.closures);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'The service area failed to load.');
    } finally {
      setLoading(false);
    }
  }, [vendorLocationId]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateVertex(index: number, key: keyof Vertex, value: string) {
    setVertices((current) =>
      current.map((vertex, position) =>
        position === index ? { ...vertex, [key]: value } : vertex,
      ),
    );
  }

  async function act(work: () => Promise<void>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      await work();
      await load();
      setNotice({ tone: 'success', text: success });
    } catch (error) {
      setNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'That change did not save.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function addZone() {
    let boundary: string;
    try {
      if (cornersByHand) {
        boundary = verticesToWkt(vertices);
      } else {
        if (!zoneCentre)
          throw new Error('Place the centre of your delivery area on the map first.');
        const radius = Number(zoneRadiusMetres);
        if (!Number.isFinite(radius) || radius < 200 || radius > 25_000) {
          throw new Error('The radius must be between 200 m and 25 km.');
        }
        boundary = circleWkt(zoneCentre, radius);
      }
    } catch (error) {
      setNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'The boundary is not a polygon.',
      });
      return;
    }
    await act(async () => {
      await vendorRequest(`vendor/locations/${vendorLocationId}/settings/zones`, {
        method: 'POST',
        body: JSON.stringify({ zone_name: zoneName, boundary_wkt: boundary }),
      });
      setEditingBoundary(false);
    }, `“${zoneName}” added. Customers inside it can now find you.`);
  }

  async function deactivateZone(zone: ServiceZone) {
    await act(async () => {
      await vendorRequest(
        `vendor/locations/${vendorLocationId}/settings/zones/${zone.service_zone_id}/deactivate`,
        { method: 'POST', body: JSON.stringify({}) },
      );
    }, `“${zone.zone_name}” switched off. Customers there can no longer order.`);
  }

  /**
   * A closure is bounded in time on purpose: an indefinite "closed" flag is how
   * stores quietly disappear from the marketplace and never come back.
   */
  async function addClosure() {
    if (!closureStart || !closureEnd) {
      setNotice({ tone: 'danger', text: 'A closure needs both a start and an end.' });
      return;
    }
    const startsAt = new Date(closureStart);
    const endsAt = new Date(closureEnd);
    if (endsAt <= startsAt) {
      setNotice({ tone: 'danger', text: 'The closure has to end after it starts.' });
      return;
    }
    await act(async () => {
      await vendorRequest(`vendor/locations/${vendorLocationId}/settings/closures`, {
        method: 'POST',
        body: JSON.stringify({
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          reason_code: 'VENDOR_TEMPORARY_CLOSURE',
        }),
      });
      setClosureStart('');
      setClosureEnd('');
    }, 'Closure saved. You show as closed for that window only.');
  }

  const activeZones = zones.filter((zone) => zone.lifecycle_state === 'ACTIVE');

  return (
    <Panel
      description={
        activeZones.length === 0
          ? 'No delivery area is switched on, so nobody can find this store.'
          : `${activeZones.length} area${activeZones.length === 1 ? '' : 's'} switched on.`
      }
      eyebrow="Where and when you trade"
      id="service-area-panel"
      title="Service area, modes and closures"
    >
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {loading && <LoadingState label="Loading your service area…" />}
      {loadError && !loading && (
        <ErrorState
          description={loadError}
          onRetry={() => void load()}
          title="Cannot show the service area"
        />
      )}

      {!loading && !loadError && (
        <>
          {/* Discoverability depends on an active zone covering the customer's
              address, so an empty list is a trading outage, not an empty state. */}
          {activeZones.length === 0 && zones.length > 0 && (
            <Notice tone="warning">
              Every delivery area is switched off. Customers cannot find this store until one is
              back on.
            </Notice>
          )}

          <Card className="area-block">
            <h3>How customers get their order</h3>
            {modes.length === 0 ? (
              <Notice tone="warning">
                No fulfilment mode is set, so there is no way for a customer to receive an order. An
                admin sets these when the store is approved.
              </Notice>
            ) : (
              <ul className="mode-list">
                {modes.map((mode) => (
                  <li key={mode}>
                    <span>{MODE_LABEL[mode] ?? humaniseEnum(mode)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="area-block">
            <h3>Where you deliver</h3>
            {zones.length === 0 && (
              <EmptyState
                description="Draw the area you deliver to. Only customers inside it can order from you."
                title="No delivery area yet"
              />
            )}
            <ul className="zone-list">
              {zones.map((zone) => (
                <li key={zone.service_zone_id}>
                  <div>
                    <strong>{zone.zone_name}</strong>
                    <span>{area(zone.area_square_metres)}</span>
                  </div>
                  <StatusPill state={zone.lifecycle_state} />
                  {zone.lifecycle_state === 'ACTIVE' && (
                    <Button
                      disabled={busy}
                      onClick={() => void deactivateZone(zone)}
                      size="small"
                      variant="danger"
                    >
                      Switch off
                    </Button>
                  )}
                </li>
              ))}
            </ul>

            {editingBoundary ? (
              <div className="zone-editor">
                <Field
                  hint="Something you would say out loud, like “Mansarovar east”."
                  label="Area name"
                  onChange={(event) => setZoneName(event.target.value)}
                  value={zoneName}
                />
                <LocationPicker
                  accessToken={maps?.access_token ?? null}
                  copy={{
                    searchLabel: 'Search for the middle of your delivery area',
                    searchPlaceholder: 'A landmark, street or colony',
                    deviceLabel: 'Centre it on me',
                    chosenLabel: 'Centre',
                    mapHint: 'Tap the map to place the centre; the shaded circle is your area.',
                  }}
                  hint="Customers inside the circle can find you and order."
                  initialCentre={maps?.default_centre}
                  label="Where do you deliver?"
                  onChange={(next) => setZoneCentre(next)}
                  radiusMetres={
                    cornersByHand ? undefined : Math.max(1, Number(zoneRadiusMetres) || 0)
                  }
                  value={zoneCentre}
                />
                <Field
                  hint="How far from the centre you deliver. 2000 m is about a 10-minute ride."
                  inputMode="numeric"
                  label="Radius in metres"
                  onChange={(event) => setZoneRadiusMetres(event.target.value)}
                  value={zoneRadiusMetres}
                />
                <details onToggle={(event) => setCornersByHand(event.currentTarget.open)}>
                  <summary>Set the corners by hand instead</summary>
                  {/* The boundary as the corner points it actually is. Longitude
                    first, which is what PostGIS expects and the most common
                    way to get this silently wrong (UX-12 keeps a text route
                    to every map anyway). */}
                  <p className="zone-editor__hint">
                    Each row is a corner of your delivery area, as it appears on a map.
                  </p>
                  {vertices.map((vertex, index) => (
                    <div className="zone-editor__vertex" key={index}>
                      <Field
                        label={`Corner ${index + 1} — longitude`}
                        onChange={(event) => updateVertex(index, 'longitude', event.target.value)}
                        value={vertex.longitude}
                      />
                      <Field
                        label={`Corner ${index + 1} — latitude`}
                        onChange={(event) => updateVertex(index, 'latitude', event.target.value)}
                        value={vertex.latitude}
                      />
                    </div>
                  ))}
                  <div className="zone-editor__actions">
                    <Button
                      onClick={() =>
                        setVertices((current) => [
                          ...current,
                          { longitude: '75.76', latitude: '26.85' },
                        ])
                      }
                      size="small"
                      variant="secondary"
                    >
                      Add a corner
                    </Button>
                    <Button
                      disabled={vertices.length <= 3}
                      onClick={() =>
                        setVertices((current) => current.slice(0, Math.max(3, current.length - 1)))
                      }
                      size="small"
                      variant="secondary"
                    >
                      Remove a corner
                    </Button>
                  </div>
                </details>
                <div className="zone-editor__actions">
                  <Button disabled={busy} onClick={() => void addZone()} variant="primary">
                    Save this area
                  </Button>
                  <Button onClick={() => setEditingBoundary(false)} variant="ghost">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button onClick={() => setEditingBoundary(true)} variant="secondary">
                Add a delivery area
              </Button>
            )}
          </Card>

          <Card className="area-block">
            <h3>Closing for a while</h3>
            {closures.length === 0 ? (
              <p className="area-block__hint">
                Nothing scheduled. You are open to your usual hours.
              </p>
            ) : (
              <ul className="closure-list">
                {closures.map((closure) => (
                  <li key={closure.temporary_closure_id}>
                    <span>
                      {when(closure.starts_at)} → {when(closure.ends_at)}
                    </span>
                    <StatusPill
                      label={new Date(closure.starts_at) > new Date() ? 'Scheduled' : 'Closed now'}
                      state={new Date(closure.starts_at) > new Date() ? 'SCHEDULED' : 'CLOSED'}
                    />
                  </li>
                ))}
              </ul>
            )}
            <div className="closure-form">
              <Field
                label="From"
                onChange={(event) => setClosureStart(event.target.value)}
                type="datetime-local"
                value={closureStart}
              />
              <Field
                label="Until"
                onChange={(event) => setClosureEnd(event.target.value)}
                type="datetime-local"
                value={closureEnd}
              />
            </div>
            <Button disabled={busy} onClick={() => void addClosure()} variant="primary">
              Save closure
            </Button>
          </Card>
        </>
      )}
    </Panel>
  );
}
