export type ProviderDeliveryState = 'DELIVERED' | 'FAILED';
export type ProviderScenario = 'PERMANENT_FAILURE' | 'SUCCESS' | 'TRANSIENT_FAILURE';

export interface ProviderDeliveryResult {
  readonly error_code: string | null;
  readonly provider_reference: string | null;
  readonly retryable: boolean;
  readonly state: ProviderDeliveryState;
}

export interface SmsProvider {
  send(input: ProviderMessageInput): Promise<ProviderDeliveryResult>;
}

export interface PushProvider {
  send(input: ProviderMessageInput): Promise<ProviderDeliveryResult>;
}

export interface EmailProvider {
  send(input: ProviderMessageInput): Promise<ProviderDeliveryResult>;
}

export interface ProviderMessageInput {
  readonly attempt: number;
  readonly operation_reference: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly scenario: ProviderScenario;
}

export interface RouteProvider {
  route(input: {
    readonly destination: readonly [longitude: number, latitude: number];
    readonly origin: readonly [longitude: number, latitude: number];
  }): Promise<{ readonly distance_metres: number; readonly duration_seconds: number }>;
}

export interface GeocodingProvider {
  reverse(input: {
    readonly latitude: number;
    readonly longitude: number;
  }): Promise<{ readonly area_label: string }>;
}

function messageResult(input: ProviderMessageInput): ProviderDeliveryResult {
  const succeeds =
    input.scenario === 'SUCCESS' || (input.scenario === 'TRANSIENT_FAILURE' && input.attempt >= 3);
  if (succeeds) {
    return Object.freeze({
      error_code: null,
      provider_reference: `SYNTH-MESSAGE-${input.operation_reference}`,
      retryable: false,
      state: 'DELIVERED' as const,
    });
  }
  const retryable = input.scenario === 'TRANSIENT_FAILURE';
  return Object.freeze({
    error_code: retryable ? 'LOCAL_TRANSIENT_FAILURE' : 'LOCAL_PERMANENT_FAILURE',
    provider_reference: null,
    retryable,
    state: 'FAILED' as const,
  });
}

export class LocalDeterministicMessageProvider implements SmsProvider, PushProvider, EmailProvider {
  async send(input: ProviderMessageInput): Promise<ProviderDeliveryResult> {
    return messageResult(input);
  }
}

export class LocalDeterministicRouteProvider implements RouteProvider {
  async route(input: {
    readonly destination: readonly [longitude: number, latitude: number];
    readonly origin: readonly [longitude: number, latitude: number];
  }): Promise<{ readonly distance_metres: number; readonly duration_seconds: number }> {
    const [originLongitude, originLatitude] = input.origin;
    const [destinationLongitude, destinationLatitude] = input.destination;
    const values = [originLongitude, originLatitude, destinationLongitude, destinationLatitude];
    if (values.some((value) => !Number.isFinite(value))) {
      throw new RangeError('Route coordinates must be finite');
    }
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    const latitudeDelta = radians(destinationLatitude - originLatitude);
    const longitudeDelta = radians(destinationLongitude - originLongitude);
    const a =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(radians(originLatitude)) *
        Math.cos(radians(destinationLatitude)) *
        Math.sin(longitudeDelta / 2) ** 2;
    const distance = Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
    return Object.freeze({
      distance_metres: distance,
      duration_seconds: Math.max(60, Math.round(distance / 5.5)),
    });
  }
}

export class LocalDeterministicGeocodingProvider implements GeocodingProvider {
  async reverse(input: {
    readonly latitude: number;
    readonly longitude: number;
  }): Promise<{ readonly area_label: string }> {
    if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
      throw new RangeError('Geocoding coordinates must be finite');
    }
    return Object.freeze({
      area_label: `SYNTH AREA ${input.latitude.toFixed(3)},${input.longitude.toFixed(3)}`,
    });
  }
}
