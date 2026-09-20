import { createClient } from '@supabase/supabase-js';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from './health.controller.js';
import { apiLogger } from './json-logger.js';
import { LifecycleService } from './lifecycle.service.js';
import { RequestExceptionFilter } from './request-exception.filter.js';
import { RequestReferenceInterceptor } from './request-reference.interceptor.js';
import { loadRuntimeConfig, RUNTIME_CONFIG } from './runtime-config.js';
import {
  IdentityAccessService,
  IdentityPreferencesService,
  IdentitySessionService,
  IdentityPasswordService,
  LocalProtectedObjectStorage,
  type ProtectedObjectStorage,
  SupabaseProtectedObjectStorage,
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
  CompleteMoneyLifecycleService,
  AdminControlPlaneService,
  LocaleRegistryService,
  PartnerAvailabilityService,
  PartnerWaitPolicyService,
  LocalNotificationService,
  LocalFakeMoneyProvider,
  RoutingService,
  createDatabasePool,
  createRoutingService,
  ConfigurationAdminService,
  AdminOnboardingService,
  VendorSettingsService,
  GatedCapabilityService,
  VendorNetworkService,
} from '@neighbourhood-store/database';
import { OtpController } from './otp.controller.js';
import { OtpLifecycleService } from './otp-lifecycle.service.js';
import { AdminOnboardingController } from './admin-onboarding.controller.js';
import { PasswordAuthController } from './password-auth.controller.js';
import { VendorLocationSettingsController } from './vendor-settings.controller.js';
import { AdminZonesController } from './admin-zones.controller.js';
import { GatedCapabilitiesController } from './gated-capabilities.controller.js';
import { SupabaseAuthService } from './supabase-auth.service.js';
import { WhoAmIController } from './whoami.controller.js';
import {
  ACCESS_IDENTITY,
  ADMIN_ONBOARDING,
  GATED_CAPABILITIES,
  IDENTITY_PASSWORD,
  OTP_IDENTITY,
  ROUTING,
  SESSION_IDENTITY,
  VENDOR_NETWORK,
  VENDOR_SETTINGS,
} from './tokens.js';
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
  CustomerDeliveryRatingController,
  PartnerAssignmentController,
} from './assignment-custody.controller.js';
import { MoneyLifecycleController } from './money-lifecycle.controller.js';
import { MONEY_LIFECYCLE } from './tokens.js';
import { COMPLETE_MONEY_LIFECYCLE } from './tokens.js';
import { ADMIN_CONTROL_PLANE } from './tokens.js';
import { AdminControlPlaneController } from './admin-control-plane.controller.js';
import {
  CompleteMoneyAdminController,
  CustomerFinanceController,
  PartnerFinanceController,
  VendorFinanceController,
} from './complete-money-lifecycle.controller.js';
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
  LOCALE_REGISTRY,
  PARTNER_AVAILABILITY,
  PARTNER_WAIT_POLICY,
  LOCAL_NOTIFICATIONS,
  CONFIGURATION_ADMIN,
} from './tokens.js';
import { CustomerAddressesController } from './customer-addresses.controller.js';
import {
  AdminShopRequestController,
  CustomerDiscoveryController,
} from './customer-discovery.controller.js';
import { CustomerCartController } from './customer-cart.controller.js';
import { GroupedCheckoutController } from './grouped-checkout.controller.js';
import {
  VendorStaffController,
  VendorAccessController,
  VendorSettingsController,
} from './vendor-staff.controller.js';
import {
  VendorInsightsController,
  VendorOrderFulfilmentController,
  CustomerDecisionsController,
  CustomerOrderHistoryController,
  CustomerSupportCaseController,
  PartnerHandoverController,
} from './vendor-fulfilment.controller.js';
import {
  PartnerApplicationController,
  AdminPartnerApplicationController,
  AdminPartnerExceptionsController,
  PartnerEarningsController,
  PartnerStandingController,
  AdminPartnerDisputeController,
  PartnerFieldOpsController,
} from './partner-lifecycle.controller.js';
import { AdminLocaleController, LocaleController } from './locale.controller.js';
import {
  AdminPartnerDispatchController,
  PartnerAvailabilityController,
} from './partner-availability.controller.js';
import { PartnerWaitPolicyController } from './partner-wait-policy.controller.js';
import { AdminAccessController } from './admin-access.controller.js';
import { NotificationsController } from './notifications.controller.js';
import { ConfigurationController } from './configuration.controller.js';
import { CatalogueImportController } from './catalogue-import.controller.js';
import { CatalogueProductsController } from './catalogue-products.controller.js';
import {
  AdminCatalogueModerationController,
  CustomerAvailabilityController,
} from './catalogue-freshness-moderation.controller.js';
import {
  CustomerCatalogueImageController,
  CustomerCategoriesController,
  MapsConfigController,
  PublicDiscoveryController,
} from './customer-catalogue.controller.js';

@Module({
  controllers: [
    HealthController,
    OtpController,
    CustomerPreferencesController,
    VendorOnboardingController,
    VendorPublicationController,
    VendorInventoryController,
    CustomerDeliveryRatingController,
    PartnerAssignmentController,
    AdminAssignmentController,
    MoneyLifecycleController,
    CustomerAvailabilityController,
    AdminCatalogueModerationController,
    CatalogueImportController,
    CatalogueProductsController,
    CustomerAddressesController,
    CustomerDiscoveryController,
    AdminShopRequestController,
    CustomerCartController,
    GroupedCheckoutController,
    VendorStaffController,
    VendorAccessController,
    VendorSettingsController,
    VendorInsightsController,
    VendorOrderFulfilmentController,
    CustomerDecisionsController,
    CustomerOrderHistoryController,
    CustomerSupportCaseController,
    PartnerHandoverController,
    PartnerApplicationController,
    AdminPartnerApplicationController,
    AdminPartnerExceptionsController,
    PartnerEarningsController,
    PartnerStandingController,
    AdminPartnerDisputeController,
    PartnerFieldOpsController,
    CompleteMoneyAdminController,
    CustomerFinanceController,
    PartnerFinanceController,
    VendorFinanceController,
    AdminControlPlaneController,
    LocaleController,
    AdminLocaleController,
    PartnerAvailabilityController,
    AdminPartnerDispatchController,
    PartnerWaitPolicyController,
    AdminAccessController,
    NotificationsController,
    ConfigurationController,
    AdminOnboardingController,
    PasswordAuthController,
    CustomerCatalogueImageController,
    CustomerCategoriesController,
    PublicDiscoveryController,
    MapsConfigController,
    VendorLocationSettingsController,
    AdminZonesController,
    GatedCapabilitiesController,
    WhoAmIController,
  ],
  providers: [
    LifecycleService,
    OtpLifecycleService,
    AuthorizationEnforcementService,
    {
      provide: SupabaseAuthService,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new SupabaseAuthService({
          supabase_url: config.supabaseUrl,
          database_url: config.databaseUrl,
        }),
    },
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
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>): ProtectedObjectStorage => {
        if (config.objectStorageDriver === 'filesystem') {
          return new LocalProtectedObjectStorage({
            grant_key: config.objectStorageGrantKey,
            root_directory: config.objectStorageRoot,
          });
        }
        // loadRuntimeConfig has already refused this driver without buckets; the
        // check is here so a future edit cannot reach the client with none.
        if (!config.objectStorageBuckets || !config.supabaseUrl || !config.supabaseServiceRoleKey) {
          throw new Error('The supabase object-storage driver needs its buckets, URL and key');
        }
        return new SupabaseProtectedObjectStorage({
          buckets: config.objectStorageBuckets,
          grant_key: config.objectStorageGrantKey,
          storage: createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
            auth: { persistSession: false },
          }).storage,
        });
      },
    },
    {
      provide: VENDOR_ONBOARDING,
      inject: [RUNTIME_CONFIG, PROTECTED_OBJECT_STORAGE],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>, storage: ProtectedObjectStorage) =>
        new VendorOnboardingService({ connection_string: config.databaseUrl, storage }),
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
      inject: [RUNTIME_CONFIG, PROTECTED_OBJECT_STORAGE],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>, storage: ProtectedObjectStorage) =>
        new CatalogueProductService({
          connection_string: config.databaseUrl,
          storage,
        }),
    },
    {
      provide: CUSTOMER_ADDRESSES,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new CustomerAddressService({ connection_string: config.databaseUrl }),
    },
    {
      // One road-routing service for every module that needs a distance or a
      // travel time (D-17): Mapbox with the injected token, or the labelled
      // estimate. The cache lives in the same database.
      provide: ROUTING,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>): RoutingService =>
        createRoutingService({
          routing: config.routing,
          pool: createDatabasePool({
            connectionString: config.databaseUrl,
            application_name: 'neighbourhood-store-routing',
            max: 4,
          }),
          log: (event, fields) => apiLogger.event(event, fields),
        }),
    },
    {
      provide: CUSTOMER_DISCOVERY,
      inject: [RUNTIME_CONFIG, ROUTING],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>, routing: RoutingService) =>
        new CustomerDiscoveryService({ connection_string: config.databaseUrl, routing }),
    },
    {
      provide: CUSTOMER_CART,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new CustomerCartService({ connection_string: config.databaseUrl }),
    },
    {
      provide: GROUPED_CHECKOUT,
      inject: [RUNTIME_CONFIG, ROUTING],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>, routing: RoutingService) =>
        new GroupedCheckoutService({
          connection_string: config.databaseUrl,
          provider: new LocalFakeMoneyProvider({
            clearing_account_reference: config.providerClearingAccountReference,
            webhook_key: config.paymentWebhookKey,
          }),
          routing,
        }),
    },
    {
      provide: VENDOR_STAFF,
      inject: [RUNTIME_CONFIG, ACCESS_IDENTITY],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>, access: IdentityAccessService) =>
        new VendorStaffService({
          access,
          connection_string: config.databaseUrl,
          hash_key: config.otpHashKey,
        }),
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
      provide: LOCALE_REGISTRY,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new LocaleRegistryService({ connection_string: config.databaseUrl }),
    },
    {
      provide: PARTNER_AVAILABILITY,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new PartnerAvailabilityService({ connection_string: config.databaseUrl }),
    },
    {
      provide: PARTNER_WAIT_POLICY,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new PartnerWaitPolicyService({ connection_string: config.databaseUrl }),
    },
    {
      provide: LOCAL_NOTIFICATIONS,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new LocalNotificationService({ connection_string: config.databaseUrl }),
    },
    {
      provide: CONFIGURATION_ADMIN,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new ConfigurationAdminService({ connection_string: config.databaseUrl }),
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
        new MoneyLifecycleService({
          connection_string: config.databaseUrl,
          provider: new LocalFakeMoneyProvider({
            clearing_account_reference: config.providerClearingAccountReference,
            webhook_key: config.paymentWebhookKey,
          }),
        }),
    },
    {
      provide: COMPLETE_MONEY_LIFECYCLE,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new CompleteMoneyLifecycleService({ connection_string: config.databaseUrl }),
    },
    {
      provide: ADMIN_CONTROL_PLANE,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new AdminControlPlaneService({ connection_string: config.databaseUrl }),
    },
    {
      provide: IDENTITY_PASSWORD,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new IdentityPasswordService({
          connection_string: config.databaseUrl,
          hash_key: config.otpHashKey,
        }),
    },
    {
      provide: ADMIN_ONBOARDING,
      inject: [RUNTIME_CONFIG, IDENTITY_PASSWORD],
      useFactory: (
        config: ReturnType<typeof loadRuntimeConfig>,
        passwords: IdentityPasswordService,
      ) =>
        new AdminOnboardingService({
          connection_string: config.databaseUrl,
          hash_key: config.otpHashKey,
          password_service: passwords,
        }),
    },
    {
      provide: VENDOR_SETTINGS,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new VendorSettingsService({ connection_string: config.databaseUrl }),
    },
    {
      provide: VENDOR_NETWORK,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new VendorNetworkService({ connection_string: config.databaseUrl }),
    },
    {
      provide: GATED_CAPABILITIES,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>) =>
        new GatedCapabilityService({ connection_string: config.databaseUrl }),
    },
  ],
})
export class AppModule {}
