/**
 * The slice of Mapbox GL JS the location picker uses, typed by hand.
 *
 * The library is loaded from Mapbox's CDN when a picker first mounts, pinned
 * to one version, and read from `window.mapboxgl`: nothing here is bundled,
 * so the four shells stay the size they were and a page without a map never
 * pays for one. The vendor's own declarations do not compile under this
 * repository's `exactOptionalPropertyTypes` and `skipLibCheck: false`, and a
 * tsconfig path mapping to a local declaration also redirects the bundler, so
 * the picker is typed against exactly what it calls.
 */
export interface LngLat {
  readonly lng: number;
  readonly lat: number;
}
export type LngLatLike = readonly [number, number] | LngLat;

export interface MapMouseEvent {
  readonly lngLat: LngLat;
}

export interface GeoJsonSourceLike {
  setData(data: unknown): void;
}

export interface MapboxMap {
  addControl(control: unknown, position?: string): this;
  on(event: 'click', listener: (event: MapMouseEvent) => void): this;
  on(event: 'load' | 'error', listener: () => void): this;
  getCenter(): LngLat;
  getZoom(): number;
  easeTo(options: { readonly center: LngLatLike; readonly zoom?: number }): this;
  getSource(id: string): GeoJsonSourceLike | undefined;
  getLayer(id: string): unknown;
  addSource(id: string, source: { readonly type: 'geojson'; readonly data: unknown }): this;
  addLayer(layer: {
    readonly id: string;
    readonly type: 'fill' | 'line';
    readonly source: string;
    readonly paint: Readonly<Record<string, string | number>>;
  }): this;
  removeLayer(id: string): this;
  removeSource(id: string): this;
  remove(): void;
}

export interface MapboxMarker {
  setLngLat(position: LngLatLike): this;
  getLngLat(): LngLat;
  addTo(map: MapboxMap): this;
  remove(): this;
  on(event: 'dragend', listener: () => void): this;
}

export interface MapboxGl {
  accessToken: string;
  supported(): boolean;
  Map: new (options: {
    readonly container: HTMLElement;
    readonly style: string;
    readonly center: LngLatLike;
    readonly zoom: number;
    readonly attributionControl?: boolean;
  }) => MapboxMap;
  Marker: new (options?: { readonly draggable?: boolean; readonly color?: string }) => MapboxMarker;
  NavigationControl: new (options?: { readonly showCompass?: boolean }) => unknown;
}

/** Mapbox GL JS, pinned. Script and stylesheet are loaded from the CDN together. */
export const MAPBOX_GL_VERSION = '3.31.0';
export const MAPBOX_GL_SCRIPT = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.js`;
export const MAPBOX_GL_STYLESHEET = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.css`;

let loading: Promise<MapboxGl> | null = null;

/**
 * Loads the library once per page and resolves to the global it defines.
 * A second picker on the same page shares the first load; a failed load is
 * forgotten so the next attempt can try again.
 */
export function loadMapboxGl(): Promise<MapboxGl> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Mapbox GL needs a browser'));
  }
  const existing = (window as unknown as { mapboxgl?: MapboxGl }).mapboxgl;
  if (existing) return Promise.resolve(existing);
  if (loading) return loading;
  loading = new Promise<MapboxGl>((resolve, reject) => {
    if (!document.querySelector(`link[href="${MAPBOX_GL_STYLESHEET}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = MAPBOX_GL_STYLESHEET;
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = MAPBOX_GL_SCRIPT;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      const loaded = (window as unknown as { mapboxgl?: MapboxGl }).mapboxgl;
      if (loaded) resolve(loaded);
      else reject(new Error('Mapbox GL loaded but defined no global'));
    };
    script.onerror = () => reject(new Error('Mapbox GL could not be loaded'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}
