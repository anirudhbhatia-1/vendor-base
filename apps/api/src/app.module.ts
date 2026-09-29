import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from './health.controller.js';
import { apiLogger } from './json-logger.js';
import { LifecycleService } from './lifecycle.service.js';
import { RequestExceptionFilter } from './request-exception.filter.js';
import { RequestReferenceInterceptor } from './request-reference.interceptor.js';
import { loadRuntimeConfig, RUNTIME_CONFIG } from './runtime-config.js';
import {
  createDomainServices,
  createProtectedObjectStorage,
  type DomainServices,
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
import {
  ADMIN_CONTROL_PLANE,
  DOMAIN_SERVICES,
  ORDER_MONITOR,
  SUPPORT_CASES,
  TRUST_REVIEW,
  FINANCE_QUEUES,
  CONFIGURATION_PUBLICATION,
} from './tokens.js';
import { AdminControlPlaneController } from './admin-control-plane.controller.js';
import { AdminOrderMonitorController } from './admin-order-monitor.controller.js';
import {
  AdminSupportCaseController,
  CustomerSupportCaseController,
} from './support-case.controller.js';
import {
  AdminTrustReviewController,
  CustomerRestrictionController,
  PartnerRestrictionController,
  VendorRestrictionController,
} from './trust-review.controller.js';
import { FinanceQueuesController } from './finance-queues.controller.js';
import {
  CompleteMoneyAdminController,
  CustomerFinanceController,
  PartnerFinanceController,
  AdminVendorSettlementDisputeController,
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
  PartnerHandoverController,
} from './vendor-fulfilment.controller.js';
import {
  PartnerApplicationController,
  AdminPartnerApplicationController,
  AdminPartnerDocumentController,
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

/**
 * Each controller token resolves to its member of the one composition
 * (composition.ts): the token indirection stays so controllers and their
 * specs keep their inject sites; only the construction moved.
 */
const memberProviders: ReadonlyMap<symbol, (services: DomainServices) => unknown> = new Map<
  symbol,
  (services: DomainServices) => unknown
>([
  [ACCESS_IDENTITY, (services) => services.access],
  [ADMIN_CONTROL_PLANE, (services) => services.adminControl],
  [ADMIN_ONBOARDING, (services) => services.adminOnboarding],
  [ASSIGNMENT_CUSTODY, (services) => services.assignments],
  [CATALOGUE_FRESHNESS_MODERATION, (services) => services.catalogueModeration],
  [CATALOGUE_PRODUCTS, (services) => services.catalogueProducts],
  [COMPLETE_MONEY_LIFECYCLE, (services) => services.completeMoney],
  [CONFIGURATION_ADMIN, (services) => services.configuration],
  [CUSTOMER_ADDRESSES, (services) => services.customerAddresses],
  [CUSTOMER_CART, (services) => services.cart],
  [CUSTOMER_DISCOVERY, (services) => services.discovery],
  [GATED_CAPABILITIES, (services) => services.gatedCapabilities],
  [GROUPED_CHECKOUT, (services) => services.checkout],
  [IDENTITY_PASSWORD, (services) => services.password],
  [IDENTITY_PREFERENCES, (services) => services.preferences],
  [INVENTORY_RESERVATIONS, (services) => services.inventory],
  [LOCALE_REGISTRY, (services) => services.localeRegistry],
  [LOCAL_NOTIFICATIONS, (services) => services.notifications],
  [MONEY_LIFECYCLE, (services) => services.money],
  [ORDER_MONITOR, (services) => services.orderMonitor],
  [OTP_IDENTITY, (services) => services.otp],
  [PARTNER_AVAILABILITY, (services) => services.availability],
  [PARTNER_FIELD_OPS, (services) => services.partnerField],
  [PARTNER_LIFECYCLE, (services) => services.partnerLifecycle],
  [PARTNER_WAIT_POLICY, (services) => services.partnerWait],
  [PROTECTED_OBJECT_STORAGE, (services) => services.storage],
  [ROUTING, (services) => services.routing],
  [SESSION_IDENTITY, (services) => services.sessions],
  [SUPPORT_CASES, (services) => services.supportCases],
  [TRUST_REVIEW, (services) => services.trust],
  [FINANCE_QUEUES, (services) => services.financeQueues],
  [CONFIGURATION_PUBLICATION, (services) => services.configurationPublication],
  [VENDOR_FULFILMENT, (services) => services.fulfilment],
  [VENDOR_NETWORK, (services) => services.vendorNetwork],
  [VENDOR_ONBOARDING, (services) => services.onboarding],
  [VENDOR_PUBLICATION, (services) => services.publication],
  [VENDOR_SETTINGS, (services) => services.vendorSettings],
  [VENDOR_STAFF, (services) => services.vendorStaff],
]);

const serviceProviders = [...memberProviders].map(([token, select]) => ({
  provide: token,
  inject: [DOMAIN_SERVICES],
  useFactory: select,
}));

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
    AdminPartnerDocumentController,
    AdminPartnerExceptionsController,
    PartnerEarningsController,
    PartnerStandingController,
    AdminPartnerDisputeController,
    PartnerFieldOpsController,
    CompleteMoneyAdminController,
    CustomerFinanceController,
    PartnerFinanceController,
    AdminVendorSettlementDisputeController,
    VendorFinanceController,
    AdminControlPlaneController,
    AdminOrderMonitorController,
    AdminSupportCaseController,
    AdminTrustReviewController,
    FinanceQueuesController,
    PartnerRestrictionController,
    CustomerRestrictionController,
    VendorRestrictionController,
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
      // Every domain service, on one shared pool. The worker builds this same
      // composition, so the two processes cannot drift apart in wiring, and
      // the process stays inside a hosted pooler's connection cap.
      // LifecycleService closes it on shutdown.
      provide: DOMAIN_SERVICES,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadRuntimeConfig>): DomainServices =>
        createDomainServices({
          application_name: 'neighbourhood-store-api',
          config,
          log: (event, fields) => apiLogger.event(event, fields),
          otp_hash_key: config.otpHashKey,
          session_token_hash_key: config.sessionTokenHashKey,
          storage: createProtectedObjectStorage({
            config,
            ...(config.supabaseServiceRoleKey
              ? { supabase_service_role_key: config.supabaseServiceRoleKey }
              : {}),
            ...(config.supabaseUrl ? { supabase_url: config.supabaseUrl } : {}),
          }),
        }),
    },
    ...serviceProviders,
  ],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(DOMAIN_SERVICES) private readonly services: DomainServices) {}

  // Runs after every provider's own shutdown hook (Nest calls the module
  // class last), so nothing is still using the shared pool when it ends.
  async onApplicationShutdown(): Promise<void> {
    await this.services.close();
  }
}
