'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { loadMapboxGl, type MapboxMap, type MapboxMarker } from './mapbox-gl-loader.js';
import { Button } from './button.js';
import { cx } from './classnames.js';
import { Field } from './field.js';
import {
  circleRing,
  formatPoint,
  forwardGeocodeUrl,
  isFinitePoint,
  parseGeocodeCandidates,
  parseReversePlace,
  type ReversePlace,
  reverseGeocodeUrl,
  type GeoPoint,
  type GeocodeCandidate,
} from './location-picker-support.js';

/** Where the chosen point came from; the address record keeps this so a pin and a device fix can be told apart later. */
export type LocationSource = 'DEVICE' | 'MANUAL' | 'MAP' | 'SEARCH';

export interface LocationPickerCopy {
  readonly searchLabel: string;
  readonly searchPlaceholder: string;
  readonly deviceLabel: string;
  readonly manualSummary: string;
  readonly latitudeLabel: string;
  readonly longitudeLabel: string;
  readonly chosenLabel: string;
  readonly unavailable: string;
  readonly mapHint: string;
}

const DEFAULT_COPY: LocationPickerCopy = {
  searchLabel: 'Search for a place or address',
  searchPlaceholder: 'Shop name, street, landmark or area',
  deviceLabel: 'Use my location',
  manualSummary: 'Enter coordinates by hand',
  latitudeLabel: 'Latitude',
  longitudeLabel: 'Longitude',
  chosenLabel: 'Chosen location',
  unavailable: 'Maps are not available here. Enter the coordinates by hand.',
  mapHint: 'Tap the map or drag the pin to the exact spot.',
};

/** Jaipur, the synthetic launch area, when nothing better is known. */
export const DEFAULT_MAP_CENTRE: GeoPoint = Object.freeze({
  latitude: 26.9124,
  longitude: 75.7873,
});

const MAPBOX_STYLE = 'mapbox://styles/mapbox/streets-v12';

export interface LocationPickerProps {
  /** The public Mapbox token from the API's maps configuration; null means no map, only the hand-entered fallback. */
  readonly accessToken: string | null;
  readonly value: GeoPoint | null;
  readonly onChange: (point: GeoPoint, source: LocationSource) => void;
  /**
   * What the pin landed on, once the reverse geocode answers: the address in
   * words and its postcode. A form can fill the PIN from it rather than have
   * the person read it off the map and type it back.
   */
  readonly onPlace?: ((place: ReversePlace | null) => void) | undefined;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | null | undefined;
  readonly copy?: Partial<LocationPickerCopy> | undefined;
  /** Where the map opens before a point is chosen. */
  readonly initialCentre?: GeoPoint | undefined;
  /** Draws this radius around the pin -- the service zone a shop is choosing. */
  readonly radiusMetres?: number | undefined;
  readonly country?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
  readonly children?: ReactNode | undefined;
}

/**
 * Choose a place on a map.
 *
 * Every role used to type latitude and longitude into two number fields, or
 * had them guessed from the device with a hard-coded fallback in Jaipur when
 * permission was refused -- so a shop could be "at" a point nobody chose. Now
 * a person searches for the place, taps the map, drags the pin, or asks for
 * their own position, and the coordinates are read back to them. The hand
 * fields remain behind a disclosure for anyone without WebGL, without a token,
 * or with a screen reader who would rather type.
 */
export function LocationPicker({
  accessToken,
  value,
  onChange,
  onPlace,
  label,
  hint,
  error,
  copy,
  initialCentre,
  radiusMetres,
  country = 'in',
  disabled = false,
  className,
  children,
}: LocationPickerProps) {
  const text = { ...DEFAULT_COPY, ...copy };
  const id = useId();
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapboxMap | null>(null);
  const marker = useRef<MapboxMarker | null>(null);
  const latest = useRef<{
    onChange: typeof onChange;
    onPlace: typeof onPlace;
    value: GeoPoint | null;
  }>({ onChange, onPlace, value });
  latest.current = { onChange, onPlace, value };
  const [ready, setReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [query, setQuery] = useState('');
  // The name of the place just chosen from the list: typing it back into the
  // box must not reopen the list it came from.
  const chosenName = useRef<string | null>(null);
  const [candidates, setCandidates] = useState<readonly GeocodeCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualLatitude, setManualLatitude] = useState(value ? String(value.latitude) : '');
  const [manualLongitude, setManualLongitude] = useState(value ? String(value.longitude) : '');

  // The map. Loaded on the client only, once, and torn down with the element.
  useEffect(() => {
    if (!accessToken || !container.current || map.current) return;
    let cancelled = false;
    loadMapboxGl()
      .then((mapboxgl) => {
        if (cancelled || !container.current) return;
        if (!mapboxgl.supported()) {
          setMapFailed(true);
          return;
        }
        mapboxgl.accessToken = accessToken;
        const start = latest.current.value ?? initialCentre ?? DEFAULT_MAP_CENTRE;
        const instance = new mapboxgl.Map({
          container: container.current,
          style: MAPBOX_STYLE,
          center: [start.longitude, start.latitude],
          zoom: latest.current.value ? 16 : 12,
          attributionControl: true,
        });
        instance.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
        const pin = new mapboxgl.Marker({ draggable: !disabled, color: '#c2410c' });
        if (latest.current.value) {
          pin.setLngLat([latest.current.value.longitude, latest.current.value.latitude]);
          pin.addTo(instance);
        }
        pin.on('dragend', () => {
          const at = pin.getLngLat();
          latest.current.onChange({ latitude: at.lat, longitude: at.lng }, 'MAP');
        });
        instance.on('click', (event) => {
          if (disabled) return;
          latest.current.onChange(
            { latitude: event.lngLat.lat, longitude: event.lngLat.lng },
            'MAP',
          );
        });
        instance.on('load', () => {
          if (cancelled) return;
          map.current = instance;
          marker.current = pin;
          setReady(true);
        });
        instance.on('error', () => setMapFailed(true));
      })
      .catch(() => setMapFailed(true));
    return () => {
      cancelled = true;
      marker.current?.remove();
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
    // The token and the starting centre are fixed for the life of the picker.
  }, [accessToken]);

  // The pin follows the value, wherever the value came from.
  useEffect(() => {
    if (!ready || !map.current || !marker.current) return;
    if (!value) {
      marker.current.remove();
      return;
    }
    marker.current.setLngLat([value.longitude, value.latitude]).addTo(map.current);
    const centre = map.current.getCenter();
    if (
      Math.abs(centre.lat - value.latitude) > 0.0005 ||
      Math.abs(centre.lng - value.longitude) > 0.0005
    ) {
      map.current.easeTo({
        center: [value.longitude, value.latitude],
        zoom: Math.max(map.current.getZoom(), 15),
      });
    }
    setManualLatitude(String(Number(value.latitude.toFixed(6))));
    setManualLongitude(String(Number(value.longitude.toFixed(6))));
  }, [ready, value]);

  // The service-zone circle, redrawn when the pin or the radius moves.
  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    const sourceId = `${id}-zone`;
    const existing = instance.getSource(sourceId);
    if (!value || !radiusMetres) {
      if (existing) {
        if (instance.getLayer(`${sourceId}-fill`)) instance.removeLayer(`${sourceId}-fill`);
        if (instance.getLayer(`${sourceId}-line`)) instance.removeLayer(`${sourceId}-line`);
        instance.removeSource(sourceId);
      }
      return;
    }
    const data = {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          circleRing(value, radiusMetres).map(([longitude, latitude]) => [longitude, latitude]),
        ],
      },
    };
    if (existing && 'setData' in existing) {
      (existing as { setData: (next: typeof data) => void }).setData(data);
      return;
    }
    instance.addSource(sourceId, { type: 'geojson', data });
    instance.addLayer({
      id: `${sourceId}-fill`,
      type: 'fill',
      source: sourceId,
      paint: { 'fill-color': '#c2410c', 'fill-opacity': 0.12 },
    });
    instance.addLayer({
      id: `${sourceId}-line`,
      type: 'line',
      source: sourceId,
      paint: { 'line-color': '#c2410c', 'line-width': 2 },
    });
  }, [ready, value, radiusMetres, id]);

  // Where the pin landed, in words.
  useEffect(() => {
    if (!accessToken || !value) {
      setPlaceLabel(null);
      return;
    }
    const controller = new AbortController();
    fetch(reverseGeocodeUrl({ point: value, accessToken }), { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        const place = parseReversePlace(body);
        setPlaceLabel(place?.label ?? null);
        latest.current.onPlace?.(place);
      })
      .catch(() => setPlaceLabel(null));
    return () => controller.abort();
  }, [accessToken, value]);

  // Search as the person types, a little behind the keystrokes.
  useEffect(() => {
    if (!accessToken || query.trim().length < 3 || query === chosenName.current) {
      setCandidates([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      const proximity = latest.current.value ?? initialCentre ?? DEFAULT_MAP_CENTRE;
      fetch(forwardGeocodeUrl({ query, accessToken, proximity, country }), {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: unknown) => setCandidates(parseGeocodeCandidates(body)))
        .catch(() => setCandidates([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [accessToken, query, country, initialCentre]);

  function choose(candidate: GeocodeCandidate) {
    setCandidates([]);
    chosenName.current = candidate.name;
    setQuery(candidate.name);
    setNotice(null);
    onChange(candidate.point, 'SEARCH');
  }

  function locate() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setNotice('This device cannot report its location.');
      return;
    }
    setNotice(null);
    navigator.geolocation.getCurrentPosition(
      (position) =>
        onChange(
          { latitude: position.coords.latitude, longitude: position.coords.longitude },
          'DEVICE',
        ),
      () => setNotice('Location permission was refused. Search or tap the map instead.'),
      { maximumAge: 60_000, timeout: 8_000, enableHighAccuracy: true },
    );
  }

  function applyManual() {
    const point = { latitude: Number(manualLatitude), longitude: Number(manualLongitude) };
    if (!isFinitePoint(point)) {
      setNotice('Latitude must be between -90 and 90 and longitude between -180 and 180.');
      return;
    }
    setNotice(null);
    onChange(point, 'MANUAL');
  }

  const mapAvailable = Boolean(accessToken) && !mapFailed;

  return (
    <fieldset
      className={cx('ns-location', className, error ? 'ns-location--invalid' : null)}
      disabled={disabled}
    >
      <legend className="ns-field__label">{label}</legend>
      {hint ? <p className="ns-field__hint">{hint}</p> : null}
      {mapAvailable ? (
        <>
          <div className="ns-location__search">
            <label className="ns-field" htmlFor={`${id}-search`}>
              <span className="ns-field__label">{text.searchLabel}</span>
              <input
                autoComplete="off"
                className="ns-input"
                id={`${id}-search`}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={text.searchPlaceholder}
                type="search"
                value={query}
              />
            </label>
            {candidates.length > 0 ? (
              <ul aria-label={text.searchLabel} className="ns-location__results" role="listbox">
                {candidates.map((candidate) => (
                  <li key={candidate.id} role="option" aria-selected={false}>
                    <button
                      className="ns-location__result"
                      onClick={() => choose(candidate)}
                      type="button"
                    >
                      <strong>{candidate.name}</strong>
                      {candidate.address && candidate.address !== candidate.name ? (
                        <span>{candidate.address}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {searching ? <p className="ns-field__hint">…</p> : null}
          </div>
          <div aria-label={label} className="ns-location__map" ref={container} role="application" />
          <p className="ns-field__hint">{text.mapHint}</p>
        </>
      ) : (
        <p className="ns-field__hint">{text.unavailable}</p>
      )}
      <div className="ns-row">
        <Button onClick={locate} size="small" type="button" variant="secondary">
          {text.deviceLabel}
        </Button>
      </div>
      <p aria-live="polite" className="ns-location__chosen">
        <strong>{text.chosenLabel}:</strong> {formatPoint(value)}
        {placeLabel ? ` · ${placeLabel}` : ''}
      </p>
      <details className="ns-location__manual" open={!mapAvailable}>
        <summary>{text.manualSummary}</summary>
        <div className="ns-row">
          <Field
            inputMode="decimal"
            label={text.latitudeLabel}
            onChange={(event) => setManualLatitude(event.target.value)}
            value={manualLatitude}
          />
          <Field
            inputMode="decimal"
            label={text.longitudeLabel}
            onChange={(event) => setManualLongitude(event.target.value)}
            value={manualLongitude}
          />
          <Button onClick={applyManual} size="small" type="button" variant="ghost">
            OK
          </Button>
        </div>
      </details>
      {notice ? <p className="ns-field__error">{notice}</p> : null}
      {error ? <p className="ns-field__error">{error}</p> : null}
      {children}
    </fieldset>
  );
}
