import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from './health.controller.js';
import { LifecycleService } from './lifecycle.service.js';
import { RequestExceptionFilter } from './request-exception.filter.js';
import { RequestReferenceInterceptor } from './request-reference.interceptor.js';
import { loadRuntimeConfig, RUNTIME_CONFIG } from './runtime-config.js';
import {
  IdentityAccessService,
  IdentityPreferencesService,
  IdentitySessionService,
  LocalProtectedObjectStorage,
  OtpIdentityService,
  VendorOnboardingService,
  VendorPublicationService,
  InventoryReservationService,
  AssignmentCustodyService,
  MoneyLifecycleService,
  CatalogueFreshnessModerationService,
  CatalogueProductService,
  CustomerAddressService,
  CustomerDiscoveryService,
  CustomerCartService,
  GroupedCheckoutService,
  VendorStaffService,
  VendorFulfilmentService,
  PartnerLifecycleService,
  PartnerFieldOpsService,
} from '@neighbourhood-store/database';
import { OtpController } from './otp.controller.js';
import { OtpLifecycleService } from './otp-lifecycle.service.js';
import { ACCESS_IDENTITY, OTP_IDENTITY, SESSION_IDENTITY } from './tokens.js';
import { AuthorizationGuard } from './authorization.guard.js';
import { AuthenticatedActorInterceptor } from './authenticated-actor.interceptor.js';
import { AuthorizationEnforcementService } from './authorization-enforcement.service.js';
import { CustomerPreferencesController } from './customer-preferences.controller.js';
import { IDENTITY_PREFERENCES } from './tokens.js';
import { PROTECTED_OBJECT_STORAGE, VENDOR_ONBOARDING, VENDOR_PUBLICATION } from './tokens.js';
import { VendorOnboardingController } from './vendor-onboarding.controller.js';
import { VendorPublicationController } from './vendor-publication.controller.js';
import { VendorInventoryController } from './vendor-inventory.controller.js';
import { INVENTORY_RESERVATIONS } from './tokens.js';
import { ASSIGNMENT_CUSTODY } from './tokens.js';
import {
  AdminAssignmentController,
  PartnerAssignmentController,
} from './assignment-custody.controller.js';
import { MoneyLifecycleController } from './money-lifecycle.controller.js';
import { MONEY_LIFECYCLE } from './tokens.js';
import { CATALOGUE_FRESHNESS_MODERATION } from './tokens.js';
import {
  CATALOGUE_PRODUCTS,
  CUSTOMER_ADDRESSES,
  CUSTOMER_DISCOVERY,
  CUSTOMER_CART,
  GROUPED_CHECKOUT,
  VENDOR_STAFF,
  VENDOR_FULFILMENT,
  PARTNER_LIFECYCLE,
  PARTNER_FIELD_OPS,
} from './tokens.js';
import { CustomerAddressesController } from './customer-addresses.controller.js';
import { CustomerDiscoveryController } from './customer-discovery.controller.js';
import { CustomerCartController } from './customer-cart.controller.js';
import { GroupedCheckoutController } from './grouped-checkout.controller.js';
import {
  VendorStaffController,
  VendorAccessController,
  VendorSettingsController,
} from './vendor-staff.controller.js';
import {
  VendorOrderFulfilmentController,
  CustomerDecisionsController,
  CustomerOrderHistoryController,
} from './vendor-fulfilment.controller.js';
import {
  PartnerApplicationController,
  AdminPartnerApplicationController,
  PartnerEarningsController,
  AdminPartnerDisputeController,
  PartnerFieldOpsController,
} from './partner-lifecycle.controller.js';
import { CatalogueImportController } from './catalogue-import.controller.js';
import { CatalogueProductsController } from './catalogue-products.controller.js';
import {
  AdminCatalogueModerationController,
  CustomerAvailabilityController,
} from './catalogue-freshness-moderation.controller.js';

@Module({
  controllers: [
    HealthController,
    OtpController,
    CustomerPreferencesController,
    VendorOnboardingController,
    VendorPublicationController,
    VendorInventoryController,
    PartnerAssignmentController,
    AdminAssignmentController,
    MoneyLifecycleController,
    CustomerAvailabilityController,
    AdminCatalogueModerationController,
    CatalogueImportController,
    CatalogueProductsController,
    CustomerAddressesController,
    CustomerDiscoveryController,
    CustomerCartController,
    GroupedCheckoutController,
    VendorStaffController,
    VendorAccessController,
    VendorSettingsController,
    VendorOrderFulfilmentController,
    CustomerDecisionsController,
    CustomerOrderHistoryController,
    PartnerApplicationController,
    AdminPartnerApplicationController,
    PartnerEarningsController,
    AdminPartnerDisputeController,
    PartnerFieldOpsController,
  ],
  providers: [
    LifecycleService,
    OtpLifecycleService,
    AuthorizationEnforcementService,
    { provide: APP_FILTER, useClass: RequestExceptionFilter },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
    { provide: APP_INTERCEPTOR, useClass: AuthenticatedActorInterceptor },
    { provide: APP_INTERCEPTOR, useClass: RequestReferenceInterceptor },
    {
      provide: RUNTIME_CONFIG,
      useFactory: loadRuntimeConfig,
    },
    {
      provide: OTP_IDENTITY,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new OtpIdentityService({
          connection_string: config.databaseUrl,
          hash_key: config.otpHashKey,
        }),
    },
    {
      provide: SESSION_IDENTITY,
      inject: [RUNTIME_CONFIG, OTP_IDENTITY],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>, otpService: OtpIdentityService) =>
        new IdentitySessionService({
          connection_string: config.databaseUrl,
          otp_service: otpService,
          token_hash_key: config.sessionTokenHashKey,
        }),
    },
    {
      provide: ACCESS_IDENTITY,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new IdentityAccessService({ connection_string: config.databaseUrl }),
    },
    {
      provide: IDENTITY_PREFERENCES,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new IdentityPreferencesService({ connection_string: config.databaseUrl }),
    },
    {
      provide: PROTECTED_OBJECT_STORAGE,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new LocalProtectedObjectStorage({
          grant_key: config.objectStorageGrantKey,
          root_directory: config.objectStorageRoot,
        }),
    },
    {
      provide: VENDOR_ONBOARDING,
      inject: [RUNTIME_CONFIG, PROTECTED_OBJECT_STORAGE],
      useFactory: (
        config: ReturnType<typeof loadRuntimeConfig>,
        storage: LocalProtectedObjectStorage,
      ) => new VendorOnboardingService({ connection_string: config.databaseUrl, storage }),
    },
    {
      provide: VENDOR_PUBLICATION,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new VendorPublicationService({ connection_string: config.databaseUrl }),
    },
    {
      provide: INVENTORY_RESERVATIONS,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new InventoryReservationService({ connection_string: config.databaseUrl }),
    },
    {
      provide: CATALOGUE_FRESHNESS_MODERATION,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new CatalogueFreshnessModerationService({ connection_string: config.databaseUrl }),
    },
    {
      provide: CATALOGUE_PRODUCTS,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new CatalogueProductService({ connection_string: config.databaseUrl }),
    },
    {
      provide: CUSTOMER_ADDRESSES,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new CustomerAddressService({ connection_string: config.databaseUrl }),
    },
    {
      provide: CUSTOMER_DISCOVERY,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new CustomerDiscoveryService({ connection_string: config.databaseUrl }),
    },
    {
      provide: CUSTOMER_CART,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new CustomerCartService({ connection_string: config.databaseUrl }),
    },
    {
      provide: GROUPED_CHECKOUT,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new GroupedCheckoutService({ connection_string: config.databaseUrl }),
    },
    {
      provide: VENDOR_STAFF,
      inject: [RUNTIME_CONFIG, ACCESS_IDENTITY],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>, access: IdentityAccessService) =>
        new VendorStaffService({ connection_string: config.databaseUrl, access }),
    },
    {
      provide: VENDOR_FULFILMENT,
      inject: [RUNTIME_CONFIG, INVENTORY_RESERVATIONS],
      useFactory: (
        config: ReturnType<typeof loadRuntimeConfig>,
        inventory: InventoryReservationService,
      ) => new VendorFulfilmentService({ connection_string: config.databaseUrl, inventory }),
    },
    {
      provide: PARTNER_LIFECYCLE,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new PartnerLifecycleService({ connection_string: config.databaseUrl }),
    },
    {
      provide: PARTNER_FIELD_OPS,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new PartnerFieldOpsService({ connection_string: config.databaseUrl }),
    },
    {
      provide: ASSIGNMENT_CUSTODY,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new AssignmentCustodyService({ connection_string: config.databaseUrl }),
    },
    {
      provide: MONEY_LIFECYCLE,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new MoneyLifecycleService({ connection_string: config.databaseUrl }),
    },
  ],
})
export class AppModule {}
