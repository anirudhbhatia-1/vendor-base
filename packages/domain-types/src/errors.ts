import type { Brand } from './brand.js';
import {
  parsePublicReference,
  parseRequestId,
  type PublicReference,
  type RequestId,
} from './identifiers.js';

export type LocalizationKey = Brand<string, 'LocalizationKey'>;
export type FieldErrorCode = Brand<string, 'FieldErrorCode'>;

export const ERROR_DEFINITIONS = {
  INVALID_ARGUMENT: { http_status: 400, message_key: 'common.invalid_argument', retryable: false },
  UNAUTHENTICATED: { http_status: 401, message_key: 'auth.unauthenticated', retryable: false },
  FORBIDDEN: { http_status: 403, message_key: 'auth.forbidden', retryable: false },
  RESOURCE_NOT_FOUND: {
    http_status: 404,
    message_key: 'common.resource_not_found',
    retryable: false,
  },
  ORDER_STATE_CONFLICT: {
    http_status: 409,
    message_key: 'orders.state_conflict',
    retryable: false,
  },
  VERSION_CONFLICT: { http_status: 409, message_key: 'common.version_conflict', retryable: false },
  IDEMPOTENCY_KEY_REUSED: {
    http_status: 409,
    message_key: 'common.idempotency_key_reused',
    retryable: false,
  },
  BUSINESS_RULE_VIOLATION: {
    http_status: 422,
    message_key: 'common.business_rule_violation',
    retryable: false,
  },
  RATE_LIMITED: { http_status: 429, message_key: 'common.rate_limited', retryable: true },
  SERVICE_UNAVAILABLE: {
    http_status: 503,
    message_key: 'common.service_unavailable',
    retryable: true,
  },
  INTERNAL_ERROR: { http_status: 500, message_key: 'common.internal_error', retryable: false },
} as const;

export type StableErrorCode = keyof typeof ERROR_DEFINITIONS;

export interface FieldError {
  readonly field: string;
  readonly code: FieldErrorCode;
  readonly message_key: LocalizationKey;
}

export interface StandardError {
  readonly code: StableErrorCode;
  readonly message_key: LocalizationKey;
  readonly request_id: RequestId;
  readonly retryable: boolean;
  readonly field_errors: readonly FieldError[];
  readonly current_state: string | null;
  readonly support_reference: PublicReference | null;
}

export interface StandardErrorResponse {
  readonly error: StandardError;
}

const LOCALIZATION_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const FIELD_PATH_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\[(?:\d+)\]|\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;

export function createLocalizationKey(value: string): LocalizationKey {
  if (!LOCALIZATION_KEY_PATTERN.test(value)) {
    throw new TypeError('Localization key must use stable lowercase dotted notation');
  }
  return value as LocalizationKey;
}

export function createFieldError(input: {
  readonly field: string;
  readonly code: string;
  readonly message_key: string;
}): FieldError {
  if (!FIELD_PATH_PATTERN.test(input.field)) throw new TypeError('Field error path is invalid');
  if (!ERROR_CODE_PATTERN.test(input.code)) throw new TypeError('Field error code is invalid');
  return Object.freeze({
    field: input.field,
    code: input.code as FieldErrorCode,
    message_key: createLocalizationKey(input.message_key),
  });
}

export function createStandardError(
  code: StableErrorCode,
  requestId: RequestId | string,
  options: {
    readonly field_errors?: readonly FieldError[];
    readonly current_state?: string | null;
    readonly support_reference?: string | null;
  } = {},
): StandardErrorResponse {
  const definition = ERROR_DEFINITIONS[code];
  return Object.freeze({
    error: Object.freeze({
      code,
      message_key: createLocalizationKey(definition.message_key),
      request_id: parseRequestId(requestId),
      retryable: definition.retryable,
      field_errors: Object.freeze([...(options.field_errors ?? [])]),
      current_state: options.current_state ?? null,
      support_reference:
        options.support_reference === null || options.support_reference === undefined
          ? null
          : parsePublicReference(options.support_reference),
    }),
  });
}

export function errorHttpStatus(code: StableErrorCode): number {
  return ERROR_DEFINITIONS[code].http_status;
}
