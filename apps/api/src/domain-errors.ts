import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AccessConflictError,
  AccessInputError,
  AdminControlAuthorizationError,
  AdminControlInputError,
  AdminControlNotFoundError,
  AdminControlStateError,
  OrderMonitorAuthorizationError,
  OrderMonitorInputError,
  OrderMonitorNotFoundError,
  OrderMonitorStateError,
  SupportCaseAuthorizationError,
  SupportCaseInputError,
  SupportCaseNotFoundError,
  SupportCaseStateError,
  TrustReviewAuthorizationError,
  TrustReviewInputError,
  TrustReviewNotFoundError,
  TrustReviewStateError,
  FinanceQueueAuthorizationError,
  FinanceQueueInputError,
  FinanceQueueNotFoundError,
  FinanceQueueStateError,
  ConfigurationPublicationAuthorizationError,
  ConfigurationPublicationInputError,
  ConfigurationPublicationNotFoundError,
  ConfigurationPublicationStateError,
  IncidentControlAuthorizationError,
  IncidentControlInputError,
  IncidentControlNotFoundError,
  IncidentControlStateError,
  ReportingAuthorizationError,
  ReportingInputError,
  ReportingNotFoundError,
  ReportingStateError,
  AuditSearchAuthorizationError,
  AuditSearchInputError,
  AuditSearchNotFoundError,
  AdminOnboardingActiveObligationsError,
  AdminOnboardingConflictError,
  AdminOnboardingInputError,
  AssignmentAuthorizationError,
  AssignmentConflictError,
  AssignmentInputError,
  AssignmentNotFoundError,
  AssignmentVersionError,
  CatalogueModerationAuthorizationError,
  CatalogueModerationConflictError,
  CatalogueModerationInputError,
  CatalogueModerationNotFoundError,
  CheckoutConflictError,
  CheckoutInputError,
  CheckoutNotFoundError,
  CheckoutPaymentDeclinedError,
  CheckoutUnfulfillableError,
  ConfigurationApprovalConflictError,
  ConfigurationNotFoundError,
  ConfigurationOverlapError,
  ConfigurationTransitionConflictError,
  CustomerAddressAuthorizationError,
  CustomerAddressConflictError,
  CustomerAddressInputError,
  CustomerAddressNotFoundError,
  CustomerCartAuthorizationError,
  CustomerCartConflictError,
  CustomerCartFulfilmentMethodError,
  CustomerCartInputError,
  CustomerCartNotFoundError,
  CustomerDiscoveryAuthorizationError,
  CustomerDiscoveryConflictError,
  CustomerDiscoveryInputError,
  CustomerDiscoveryNotFoundError,
  CustomerEnrolmentDeniedError,
  DeliveryOtpExhaustedError,
  DeliveryOtpExpiredError,
  DeliveryOtpMismatchError,
  FieldOpsAuthorizationError,
  FieldOpsConflictError,
  FieldOpsInputError,
  FieldOpsNotFoundError,
  FulfilmentAuthorizationError,
  FulfilmentConflictError,
  FulfilmentInputError,
  FulfilmentNotFoundError,
  GatedCapabilityAuthorizationError,
  GatedCapabilityInputError,
  GatedCapabilityNotFoundError,
  IdempotencyKeyReusedError,
  InventoryAuthorizationError,
  InventoryConflictError,
  InventoryInputError,
  InventoryNotFoundError,
  InventoryUnavailableError,
  InventoryVersionError,
  LocaleConflictError,
  LocaleInputError,
  LocaleNotFoundError,
  MoneyAuthorizationError,
  MoneyInputError,
  MoneyNotFoundError,
  MoneyStateError,
  OtpInvalidError,
  OtpRateLimitedError,
  OtpUnavailableError,
  OtpVerificationRejectedError,
  PartnerAvailabilityAuthorizationError,
  PartnerAvailabilityConflictError,
  PartnerAvailabilityInputError,
  PartnerLifecycleAuthorizationError,
  PartnerLifecycleConflictError,
  PartnerLifecycleInputError,
  PartnerLifecycleNotFoundError,
  PartnerWaitAuthorizationError,
  PartnerWaitConflictError,
  PartnerWaitInputError,
  PartnerWaitNotFoundError,
  PickupOtpAlreadyIssuedError,
  PickupOtpExhaustedError,
  PickupOtpExpiredError,
  PickupOtpMismatchError,
  PickupOtpMissingError,
  VendorDeliveryOtpExhaustedError,
  VendorDeliveryOtpExpiredError,
  VendorDeliveryOtpMismatchError,
  VendorDeliveryOtpMissingError,
  PreferenceIdentityError,
  PreferenceInputError,
  PreferenceVersionConflictError,
  ProtectedObjectInputError,
  ProtectedObjectNotFoundError,
  ProtectedObjectPermissionError,
  ProtectedObjectRejectedError,
  RequiredNotificationError,
  SessionForbiddenError,
  SessionInputError,
  SessionInvalidError,
  SessionReplayDetectedError,
  VendorOnboardingAuthorizationError,
  VendorOnboardingConflictError,
  VendorOnboardingIncompleteError,
  VendorOnboardingInputError,
  VendorOnboardingNotFoundError,
  VendorPublicationAuthorizationError,
  VendorPublicationConflictError,
  VendorPublicationIncompleteError,
  VendorPublicationInputError,
  VendorPublicationNotFoundError,
  VendorPublicationVersionError,
  VendorSettingsAuthorizationError,
  VendorSettingsConflictError,
  VendorSettingsInputError,
  VendorSettingsNotFoundError,
  VendorStaffAuthorizationError,
  VendorStaffConflictError,
  VendorStaffInputError,
  VendorStaffNotFoundError,
} from '@neighbourhood-store/database';

/**
 * Every domain error the API can answer with, and what it answers.
 *
 * Each controller kept its own `translate()` or `map()` -- twenty-four of them,
 * 118 `instanceof` branches -- and the exception filter builds the response
 * from the stable code alone. So a branch that named no code, or a code not in
 * `ERROR_DEFINITIONS`, answered with the status-derived fallback and the client
 * read "refresh and try again" for a refusal refreshing could not fix. Batch 07
 * found 28 such sites; B09-07 found the same check written two different ways
 * in two modules. One table means one place to read what a domain error means
 * over HTTP, and one place a control can check that every code it names is
 * real.
 *
 * Order matters only where one class extends another; none here do. `coded`
 * reads the stable code a domain error carries itself, which is how the
 * fulfilment, money and onboarding modules already distinguish a stale version
 * from a state that has moved on.
 *
 * Two entries preserve behaviour that looks wrong and is recorded rather than
 * changed here: `AdminControlAuthorizationError` and `ConfigurationNotFoundError`
 * answer 400, and `LocaleConflictError` answers 400 -- see the tech-debt audit.
 */

type ErrorClass = abstract new (...args: never[]) => Error;

type Translation =
  | { readonly status: 'bad_request'; readonly code?: string }
  | { readonly status: 'not_found' }
  | { readonly status: 'forbidden' }
  | { readonly status: 'unauthorized' }
  | { readonly status: 'rate_limited' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'conflict'; readonly code: string | typeof coded }
  | {
      readonly status: 'unprocessable';
      readonly code?: string;
      readonly details?: (error: Error) => Readonly<Record<string, unknown>>;
    };

/** The stable code a domain error carries on itself. */
function coded(error: Error): string {
  return (error as unknown as { readonly code: string }).code;
}

export const DOMAIN_ERROR_TRANSLATIONS: ReadonlyArray<readonly [ErrorClass, Translation]> = [
  [AccessInputError, { status: 'bad_request' }],
  [AccessConflictError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [AdminControlInputError, { status: 'bad_request' }],
  [AdminControlNotFoundError, { status: 'not_found' }],
  [AdminControlStateError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [AdminControlAuthorizationError, { status: 'bad_request' }],
  // The order monitor (11.2): a stale preview is a conflict, a missing
  // capability is forbidden.
  [OrderMonitorInputError, { status: 'bad_request' }],
  [OrderMonitorNotFoundError, { status: 'not_found' }],
  [OrderMonitorStateError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [OrderMonitorAuthorizationError, { status: 'forbidden' }],
  [SupportCaseInputError, { status: 'bad_request' }],
  [SupportCaseNotFoundError, { status: 'not_found' }],
  [SupportCaseStateError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [SupportCaseAuthorizationError, { status: 'forbidden' }],
  [TrustReviewInputError, { status: 'bad_request' }],
  [TrustReviewNotFoundError, { status: 'not_found' }],
  [TrustReviewStateError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [TrustReviewAuthorizationError, { status: 'forbidden' }],
  [FinanceQueueInputError, { status: 'bad_request' }],
  [FinanceQueueNotFoundError, { status: 'not_found' }],
  [FinanceQueueStateError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [FinanceQueueAuthorizationError, { status: 'forbidden' }],
  [ConfigurationPublicationInputError, { status: 'bad_request' }],
  [ConfigurationPublicationNotFoundError, { status: 'not_found' }],
  [ConfigurationPublicationStateError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [ConfigurationPublicationAuthorizationError, { status: 'forbidden' }],
  // Incident controls (11.7).
  [IncidentControlInputError, { status: 'bad_request' }],
  [IncidentControlNotFoundError, { status: 'not_found' }],
  [IncidentControlStateError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [IncidentControlAuthorizationError, { status: 'forbidden' }],
  // Reports and exports (11.8).
  [ReportingInputError, { status: 'bad_request' }],
  [ReportingNotFoundError, { status: 'not_found' }],
  [ReportingStateError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [ReportingAuthorizationError, { status: 'forbidden' }],
  // The audit search (11.9).
  [AuditSearchInputError, { status: 'bad_request' }],
  [AuditSearchNotFoundError, { status: 'not_found' }],
  [AuditSearchAuthorizationError, { status: 'forbidden' }],
  [AdminOnboardingInputError, { status: 'bad_request' }],
  [AdminOnboardingActiveObligationsError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [AdminOnboardingConflictError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [IdempotencyKeyReusedError, { status: 'conflict', code: 'IDEMPOTENCY_KEY_REUSED' }],
  [AssignmentInputError, { status: 'bad_request' }],
  [AssignmentNotFoundError, { status: 'not_found' }],
  [AssignmentVersionError, { status: 'conflict', code: coded }],
  [DeliveryOtpMismatchError, { status: 'bad_request', code: 'DELIVERY_OTP_MISMATCH' }],
  [DeliveryOtpExpiredError, { status: 'conflict', code: 'DELIVERY_OTP_EXPIRED' }],
  [DeliveryOtpExhaustedError, { status: 'conflict', code: 'DELIVERY_OTP_EXHAUSTED' }],
  // The same four outcomes at a self-delivered door, raised by vendor-fulfilment.
  [VendorDeliveryOtpMissingError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [VendorDeliveryOtpMismatchError, { status: 'bad_request', code: 'DELIVERY_OTP_MISMATCH' }],
  [VendorDeliveryOtpExpiredError, { status: 'conflict', code: 'DELIVERY_OTP_EXPIRED' }],
  [VendorDeliveryOtpExhaustedError, { status: 'conflict', code: 'DELIVERY_OTP_EXHAUSTED' }],
  [AssignmentConflictError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [AssignmentAuthorizationError, { status: 'forbidden' }],
  [CatalogueModerationInputError, { status: 'bad_request' }],
  [CatalogueModerationNotFoundError, { status: 'not_found' }],
  [CatalogueModerationConflictError, { status: 'conflict', code: coded }],
  [CatalogueModerationAuthorizationError, { status: 'forbidden' }],
  [MoneyInputError, { status: 'bad_request' }],
  [MoneyNotFoundError, { status: 'not_found' }],
  [MoneyStateError, { status: 'conflict', code: coded }],
  [MoneyAuthorizationError, { status: 'forbidden' }],
  [ConfigurationNotFoundError, { status: 'bad_request' }],
  [ConfigurationTransitionConflictError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [ConfigurationApprovalConflictError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [ConfigurationOverlapError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [CustomerAddressInputError, { status: 'bad_request' }],
  [CustomerAddressNotFoundError, { status: 'not_found' }],
  [CustomerAddressConflictError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [CustomerAddressAuthorizationError, { status: 'forbidden' }],
  [CustomerCartInputError, { status: 'bad_request' }],
  [CustomerCartNotFoundError, { status: 'not_found' }],
  [CustomerCartConflictError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [
    CustomerCartFulfilmentMethodError,
    {
      status: 'unprocessable',
      code: 'FULFILMENT_METHOD_UNAVAILABLE',
      details: (error) => ({
        offered_modes: (error as CustomerCartFulfilmentMethodError).offered_modes,
      }),
    },
  ],
  [CustomerCartAuthorizationError, { status: 'forbidden' }],
  [CustomerDiscoveryInputError, { status: 'bad_request' }],
  [CustomerDiscoveryNotFoundError, { status: 'not_found' }],
  [CustomerDiscoveryConflictError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [CustomerDiscoveryAuthorizationError, { status: 'forbidden' }],
  [PreferenceInputError, { status: 'bad_request' }],
  [PreferenceVersionConflictError, { status: 'conflict', code: 'VERSION_CONFLICT' }],
  [RequiredNotificationError, { status: 'unprocessable' }],
  [PreferenceIdentityError, { status: 'forbidden' }],
  [GatedCapabilityInputError, { status: 'bad_request' }],
  [GatedCapabilityNotFoundError, { status: 'not_found' }],
  [GatedCapabilityAuthorizationError, { status: 'forbidden' }],
  [CheckoutInputError, { status: 'bad_request' }],
  [CheckoutNotFoundError, { status: 'not_found' }],
  [CheckoutConflictError, { status: 'conflict', code: coded }],
  [CheckoutPaymentDeclinedError, { status: 'conflict', code: coded }],
  [CheckoutUnfulfillableError, { status: 'unprocessable', code: 'INVENTORY_UNAVAILABLE' }],
  [LocaleInputError, { status: 'bad_request' }],
  [LocaleNotFoundError, { status: 'not_found' }],
  [LocaleConflictError, { status: 'bad_request' }],
  [OtpRateLimitedError, { status: 'rate_limited' }],
  [OtpUnavailableError, { status: 'unavailable' }],
  [OtpVerificationRejectedError, { status: 'unauthorized' }],
  [SessionInvalidError, { status: 'unauthorized' }],
  [SessionReplayDetectedError, { status: 'unauthorized' }],
  [SessionForbiddenError, { status: 'forbidden' }],
  [CustomerEnrolmentDeniedError, { status: 'forbidden' }],
  [SessionInputError, { status: 'bad_request' }],
  [OtpInvalidError, { status: 'bad_request' }],
  [PartnerAvailabilityInputError, { status: 'bad_request' }],
  [PartnerAvailabilityConflictError, { status: 'conflict', code: coded }],
  [PartnerAvailabilityAuthorizationError, { status: 'forbidden' }],
  [PartnerLifecycleInputError, { status: 'bad_request' }],
  [PartnerLifecycleNotFoundError, { status: 'not_found' }],
  [PartnerLifecycleConflictError, { status: 'conflict', code: coded }],
  [PartnerLifecycleAuthorizationError, { status: 'forbidden' }],
  [FieldOpsInputError, { status: 'bad_request' }],
  [FieldOpsNotFoundError, { status: 'not_found' }],
  [FieldOpsConflictError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [FieldOpsAuthorizationError, { status: 'forbidden' }],
  [PartnerWaitInputError, { status: 'bad_request' }],
  [PartnerWaitNotFoundError, { status: 'not_found' }],
  [PartnerWaitConflictError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [PartnerWaitAuthorizationError, { status: 'forbidden' }],
  [FulfilmentInputError, { status: 'bad_request' }],
  [FulfilmentNotFoundError, { status: 'not_found' }],
  [FulfilmentConflictError, { status: 'conflict', code: coded }],
  [FulfilmentAuthorizationError, { status: 'forbidden' }],
  [PickupOtpAlreadyIssuedError, { status: 'conflict', code: 'CUSTOMER_OTP_ACTIVE' }],
  [PickupOtpMissingError, { status: 'conflict', code: 'PICKUP_OTP_MISSING' }],
  [PickupOtpMismatchError, { status: 'bad_request', code: 'PICKUP_OTP_MISMATCH' }],
  [PickupOtpExhaustedError, { status: 'conflict', code: 'PICKUP_OTP_EXHAUSTED' }],
  [PickupOtpExpiredError, { status: 'conflict', code: 'PICKUP_OTP_EXPIRED' }],
  [InventoryInputError, { status: 'bad_request' }],
  [InventoryNotFoundError, { status: 'not_found' }],
  [InventoryVersionError, { status: 'conflict', code: coded }],
  [InventoryConflictError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [InventoryAuthorizationError, { status: 'forbidden' }],
  [
    InventoryUnavailableError,
    {
      status: 'unprocessable',
      code: 'INVENTORY_UNAVAILABLE',
      details: (error) => ({
        available_quantity: (error as unknown as { available_quantity: number }).available_quantity,
      }),
    },
  ],
  [VendorOnboardingInputError, { status: 'bad_request' }],
  [ProtectedObjectInputError, { status: 'bad_request' }],
  [VendorOnboardingNotFoundError, { status: 'not_found' }],
  [ProtectedObjectNotFoundError, { status: 'not_found' }],
  [VendorOnboardingConflictError, { status: 'conflict', code: coded }],
  [VendorOnboardingAuthorizationError, { status: 'forbidden' }],
  [ProtectedObjectPermissionError, { status: 'forbidden' }],
  [VendorOnboardingIncompleteError, { status: 'unprocessable' }],
  [ProtectedObjectRejectedError, { status: 'unprocessable' }],
  [VendorPublicationInputError, { status: 'bad_request' }],
  [VendorPublicationNotFoundError, { status: 'not_found' }],
  [VendorPublicationVersionError, { status: 'conflict', code: coded }],
  [VendorPublicationConflictError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],
  [VendorPublicationAuthorizationError, { status: 'forbidden' }],
  [
    VendorPublicationIncompleteError,
    {
      status: 'unprocessable',
      code: 'PUBLICATION_INCOMPLETE',
      details: (error) => ({
        missing_checks: (error as unknown as { missing_checks: readonly string[] }).missing_checks,
      }),
    },
  ],
  [VendorSettingsInputError, { status: 'bad_request' }],
  [VendorSettingsConflictError, { status: 'conflict', code: 'VERSION_CONFLICT' }],
  [VendorSettingsNotFoundError, { status: 'not_found' }],
  [VendorSettingsAuthorizationError, { status: 'forbidden' }],
  [VendorStaffInputError, { status: 'bad_request' }],
  [VendorStaffNotFoundError, { status: 'not_found' }],
  [VendorStaffConflictError, { status: 'conflict', code: coded }],
  [VendorStaffAuthorizationError, { status: 'forbidden' }],
];

function toHttpException(translation: Translation, error: Error): HttpException {
  switch (translation.status) {
    case 'bad_request':
      return new BadRequestException(
        translation.code === undefined ? undefined : { error_code: translation.code },
      );
    case 'not_found':
      return new NotFoundException();
    case 'forbidden':
      return new ForbiddenException();
    case 'unauthorized':
      return new UnauthorizedException();
    case 'rate_limited':
      return new HttpException('Rate limited', 429);
    case 'unavailable':
      return new ServiceUnavailableException();
    case 'conflict':
      return new ConflictException({
        error_code:
          typeof translation.code === 'string' ? translation.code : translation.code(error),
      });
    case 'unprocessable':
      return new UnprocessableEntityException({
        ...(translation.code === undefined ? {} : { error_code: translation.code }),
        ...(translation.details ? translation.details(error) : {}),
      });
  }
}

/**
 * Turns a domain error into the HTTP answer the table declares, or rethrows
 * anything the table does not know so it reaches the exception filter as the
 * internal error it is.
 */
export function translateDomainError(error: unknown): never {
  if (error instanceof Error) {
    for (const [kind, translation] of DOMAIN_ERROR_TRANSLATIONS) {
      if (error instanceof kind) throw toHttpException(translation, error);
    }
  }
  throw error;
}
