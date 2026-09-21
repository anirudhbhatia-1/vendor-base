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
  /**
   * A uniqueness clash, which is a value the user can change rather than a state
   * they must wait out. Without it every 409 read as VERSION_CONFLICT, whose
   * client wording tells people to refresh and retry -- advice that cannot work
   * when the name they typed is simply taken.
   */
  RESOURCE_ALREADY_EXISTS: {
    http_status: 409,
    message_key: 'common.resource_already_exists',
    retryable: false,
  },
  /**
   * The pick list still has unresolved lines. Distinct from a state conflict
   * because the vendor can act on it immediately, and distinct from a version
   * conflict because refreshing does nothing.
   */
  PICKING_INCOMPLETE: {
    http_status: 409,
    message_key: 'vendor.picking_incomplete',
    retryable: false,
  },
  /**
   * Not enough stock. Carries how many are actually available, which is the
   * number the person needs and the reason this is not a generic rule violation.
   */
  INVENTORY_UNAVAILABLE: {
    http_status: 422,
    message_key: 'inventory.unavailable',
    retryable: false,
  },
  /**
   * Publication is blocked by outstanding checks. The list of which ones is the
   * entire point of the checklist, so it travels with the error.
   */
  PUBLICATION_INCOMPLETE: {
    http_status: 422,
    message_key: 'vendor.publication_incomplete',
    retryable: false,
  },
  /**
   * Handover codes, one code per outcome.
   *
   * A wrong code is worth retyping; an expired one needs a fresh code; an
   * exhausted one is locked until re-issued; a missing one has not been minted
   * yet. All four were reported as ORDER_STATE_CONFLICT -- "that step is not
   * available yet" -- and the shopkeeper had no way to tell which. The same
   * three outcomes on the delivery side were declared by their controller but
   * never registered here, so the filter discarded them.
   */
  PICKUP_OTP_MISSING: {
    http_status: 409,
    message_key: 'orders.pickup_otp_missing',
    retryable: false,
  },
  PICKUP_OTP_MISMATCH: {
    http_status: 400,
    message_key: 'orders.pickup_otp_mismatch',
    retryable: false,
  },
  PICKUP_OTP_EXPIRED: {
    http_status: 409,
    message_key: 'orders.pickup_otp_expired',
    retryable: false,
  },
  PICKUP_OTP_EXHAUSTED: {
    http_status: 409,
    message_key: 'orders.pickup_otp_exhausted',
    retryable: false,
  },
  /** A fallback code cannot displace the live code the collector already holds. */
  CUSTOMER_OTP_ACTIVE: {
    http_status: 409,
    message_key: 'orders.customer_otp_active',
    retryable: false,
  },
  /**
   * The customer's substitution rule for this line is "refund, never replace"
   * (8.3). The shop's console reaches this only by racing its own list; the
   * sentence tells the picker what to do instead.
   */
  SUBSTITUTION_NOT_ALLOWED: {
    http_status: 409,
    message_key: 'vendor.substitution_not_allowed',
    retryable: false,
  },
  /**
   * The line is with the customer, or the customer has answered on it: a
   * proposal is pending, or was approved. Distinct from a state conflict
   * because the order is in the right state; it is this line that is spoken
   * for.
   */
  LINE_AWAITING_CUSTOMER: {
    http_status: 409,
    message_key: 'vendor.line_awaiting_customer',
    retryable: false,
  },
  /**
   * A platform-delivery order is handed to its partner, and only once the
   * partner has marked arrival. The console offered handover while the job was
   * still being offered, and the refusal read as a generic state conflict.
   */
  PARTNER_NOT_PRESENT: {
    http_status: 409,
    message_key: 'orders.partner_not_present',
    retryable: false,
  },
  DELIVERY_OTP_MISMATCH: {
    http_status: 400,
    message_key: 'delivery.otp_mismatch',
    retryable: false,
  },
  DELIVERY_OTP_EXPIRED: {
    http_status: 409,
    message_key: 'delivery.otp_expired',
    retryable: false,
  },
  DELIVERY_OTP_EXHAUSTED: {
    http_status: 409,
    message_key: 'delivery.otp_exhausted',
    retryable: false,
  },
  /**
   * The store does not offer the way the customer asked to receive the order.
   * Carries the modes it does offer, because the fix is to choose one of them;
   * a generic rule violation would leave the customer guessing which.
   */
  FULFILMENT_METHOD_UNAVAILABLE: {
    http_status: 422,
    message_key: 'cart.fulfilment_method_unavailable',
    retryable: false,
  },
  BUSINESS_RULE_VIOLATION: {
    http_status: 422,
    message_key: 'common.business_rule_violation',
    retryable: false,
  },
  /**
   * The three answers a checkout gives that are not "placed". They reported
   * ORDER_STATE_CONFLICT, whose sentence is written for a shop's console, so
   * a customer whose bank had declined read "That step is not available yet".
   */
  PAYMENT_DECLINED: {
    http_status: 409,
    message_key: 'checkout.payment_declined',
    retryable: false,
  },
  QUOTE_EXPIRED: { http_status: 409, message_key: 'checkout.quote_expired', retryable: false },
  QUOTE_CHANGED: { http_status: 409, message_key: 'checkout.quote_changed', retryable: false },
  RATE_LIMITED: { http_status: 429, message_key: 'common.rate_limited', retryable: true },
  SERVICE_UNAVAILABLE: {
    http_status: 503,
    message_key: 'common.service_unavailable',
    retryable: true,
  },
  INTERNAL_ERROR: { http_status: 500, message_key: 'common.internal_error', retryable: false },
} as const;

/**
 * The English sentence for each stable code, as a person should read it.
 *
 * The API answers with a code and a `message_key`; the sentence is rendered
 * client-side. Two clients each kept their own table of these, and they
 * drifted: twelve codes added in one were never added to the other, so the
 * customer app read its generic fallback for every one of them. This is the
 * one table, and it is typed over every code, so a code without a sentence
 * does not compile.
 *
 * Wording rules that the field reports taught: name the next action, and never
 * say "try again" for a refusal that repeating cannot change.
 */
export const ERROR_MESSAGES_EN: Readonly<Record<StableErrorCode, string>> = Object.freeze({
  INVALID_ARGUMENT: 'Something in that request was not valid.',
  UNAUTHENTICATED: 'Your session has expired. Sign in again.',
  FORBIDDEN: 'You do not have permission to do that.',
  RESOURCE_NOT_FOUND: 'That is no longer available.',
  ORDER_STATE_CONFLICT:
    'That step is not available yet. Check the job for what still has to happen first.',
  VERSION_CONFLICT: 'Something changed while you were working. Refresh and try again.',
  IDEMPOTENCY_KEY_REUSED: 'That request was already sent. Refresh to see its result.',
  RESOURCE_ALREADY_EXISTS: 'Something with that name already exists. Choose a different one.',
  PICKING_INCOMPLETE: 'Finish the pick list first. Every item needs to be marked found or missing.',
  INVENTORY_UNAVAILABLE: 'There is not enough stock left for that quantity.',
  PUBLICATION_INCOMPLETE:
    'This store cannot go live yet. Some readiness checks are still outstanding.',
  PICKUP_OTP_MISSING:
    'No collection code has been issued for this order yet. Ask the person collecting to open theirs.',
  PICKUP_OTP_MISMATCH: 'That code does not match. Check it and try again.',
  PICKUP_OTP_EXPIRED:
    'That collection code has expired. Ask the person collecting to open a fresh one.',
  PICKUP_OTP_EXHAUSTED:
    'Too many wrong attempts. A fresh collection code has to be issued before trying again.',
  CUSTOMER_OTP_ACTIVE:
    'They already have a live collection code. Ask them to read it from their screen.',
  SUBSTITUTION_NOT_ALLOWED:
    'The customer asked for no replacements on this item. Mark it not available and they are refunded for it.',
  LINE_AWAITING_CUSTOMER:
    'The customer is deciding on this item, or has already answered. It cannot be changed from here.',
  PARTNER_NOT_PRESENT: 'Hand this order over when the delivery partner is at your counter.',
  DELIVERY_OTP_MISMATCH: 'That delivery code does not match. Check it and try again.',
  DELIVERY_OTP_EXPIRED: 'That delivery code has expired. Ask the customer to open a fresh one.',
  DELIVERY_OTP_EXHAUSTED:
    'Too many wrong attempts. Ask the customer to open a fresh delivery code.',
  FULFILMENT_METHOD_UNAVAILABLE:
    'This store does not offer that option. Choose one of the ways it can get the order to you.',
  BUSINESS_RULE_VIOLATION: 'That is not allowed in the current state.',
  PAYMENT_DECLINED:
    'Your bank declined the payment. Nothing was charged and your basket is unchanged.',
  QUOTE_EXPIRED: 'This quote expired before the order was placed. Get a fresh one.',
  QUOTE_CHANGED: 'Your basket changed since this quote. Get a fresh one before paying.',
  RATE_LIMITED: 'Too many attempts. Wait a moment and try again.',
  SERVICE_UNAVAILABLE: 'That service is briefly unavailable. Try again shortly.',
  INTERNAL_ERROR: 'Something went wrong at our end.',
});

/** The sentence for a code the response carried, or nothing for a code this build does not know. */
export function errorMessageFor(code: string | null | undefined): string | undefined {
  return code !== null && code !== undefined && code in ERROR_MESSAGES_EN
    ? ERROR_MESSAGES_EN[code as StableErrorCode]
    : undefined;
}

/**
 * Localization keys used by field errors rather than by a stable error code.
 *
 * Declared here rather than written inline at the throw site so that something can
 * enumerate them: the eleven `ERROR_DEFINITIONS` keys were unregistered in the locale
 * registry precisely because nothing could list what the code asks for, and these two
 * were in the same position for the same reason.
 */
export const FIELD_ERROR_MESSAGE_KEYS = {
  INVALID_REQUEST_ID: 'validation.invalid_request_id',
  INVALID_TRACEPARENT: 'validation.invalid_traceparent',
} as const;

export type StableErrorCode = keyof typeof ERROR_DEFINITIONS;

export interface FieldError {
  readonly field: string;
  readonly code: FieldErrorCode;
  readonly message_key: LocalizationKey;
}

/**
 * Structured detail a refusal may carry.
 *
 * Deliberately narrow. `available_quantity` and `missing_checks` were attached to
 * their exceptions and thrown away by the filter, which rebuilds every response
 * from a code alone -- so a vendor blocked from publishing was told "That is not
 * allowed in the current state" instead of which checks were outstanding, and a
 * shopper was never told how many were left.
 *
 * Only keys the filter allowlists reach a client, so this cannot become a channel
 * for whatever a controller happens to attach.
 */
export type ErrorDetailValue = number | string | readonly string[];

export interface StandardError {
  readonly code: StableErrorCode;
  readonly message_key: LocalizationKey;
  readonly request_id: RequestId;
  readonly retryable: boolean;
  readonly field_errors: readonly FieldError[];
  readonly current_state: string | null;
  readonly details: Readonly<Record<string, ErrorDetailValue>>;
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
    readonly details?: Readonly<Record<string, ErrorDetailValue>>;
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
      details: Object.freeze({ ...(options.details ?? {}) }),
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
