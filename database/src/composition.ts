import { createClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import { AdminControlPlaneService } from './admin-control-plane.js';
import { AdminOnboardingService } from './admin-onboarding.js';
import { AssignmentCustodyService } from './assignment-custody.js';
import { CatalogueFreshnessModerationService } from './catalogue-freshness-moderation.js';
import { CatalogueProductService } from './catalogue-products.js';
import { CompleteMoneyLifecycleService } from './complete-money-lifecycle.js';
import { CustomerAddressService } from './customer-addresses.js';
import { CustomerCartService } from './customer-cart.js';
import { CustomerDiscoveryService } from './customer-discovery.js';
import { createDatabasePool } from './database-pool.js';
import { DeliveryDispatchOrchestrator } from './delivery-dispatch.js';
import { GatedCapabilityService } from './gated-capabilities.js';
import { GroupedCheckoutService } from './grouped-checkout.js';
import { IdentityAccessService } from './identity-access.js';
import { IdentityPasswordService } from './identity-password.js';
import { IdentityPreferencesService } from './identity-preferences.js';
import { IdentitySessionService } from './identity-sessions.js';
import { InventoryReservationService } from './inventory-reservations.js';
import { LocalNotificationService } from './local-notifications.js';
import { LocaleRegistryService } from './locale-registry.js';
import { LocalFakeMoneyProvider } from './money-policy.js';
import { MoneyLifecycleService } from './money-lifecycle.js';
import { OrderMoneyOrchestrator } from './order-money-orchestrator.js';
import { OrderMonitorService } from './order-monitor.js';
import { OtpIdentityService } from './otp-identity.js';
import { PartnerAvailabilityService } from './partner-availability.js';
import { PartnerFieldOpsService } from './partner-field-ops.js';
import { PartnerLifecycleService } from './partner-lifecycle.js';
import { PartnerWaitPolicyService } from './partner-wait-policy.js';
import {
  LocalProtectedObjectStorage,
  SupabaseProtectedObjectStorage,
  type ProtectedObjectStorage,
} from './protected-object-storage.js';
import { createRoutingService, type RoutingService } from './routing.js';
import type { SharedRuntimeConfig } from './runtime-config.js';
import { SupportCaseService } from './support-cases.js';
import { TrustReviewService } from './trust-review.js';
import { ConfigurationAdminService } from './versioned-configuration.js';
import { VendorFulfilmentService } from './vendor-fulfilment.js';
import { VendorNetworkService } from './vendor-network.js';
import { VendorOnboardingService } from './vendor-onboarding.js';
import { VendorPublicationService } from './vendor-publication.js';
import { VendorSettingsService } from './vendor-settings.js';
import { VendorStaffService } from './vendor-staff.js';

/**
 * Builds the protected object storage the shared runtime config names: the
 * filesystem driver, or the Supabase driver with the caller's admin client.
 * Both composition roots use this one factory so the worker serves and stores
 * evidence exactly where the API does.
 */
export function createProtectedObjectStorage(input: {
  readonly config: SharedRuntimeConfig;
  readonly supabase_service_role_key?: string;
  readonly supabase_url?: string;
}): ProtectedObjectStorage {
  const { config } = input;
  if (config.objectStorageDriver === 'filesystem') {
    return new LocalProtectedObjectStorage({
      grant_key: config.objectStorageGrantKey,
      root_directory: config.objectStorageRoot,
    });
  }
  // loadSharedRuntimeConfig has already refused this driver without buckets;
  // the check is here so a future edit cannot reach the client with none.
  if (!config.objectStorageBuckets || !input.supabase_url || !input.supabase_service_role_key) {
    throw new Error('The supabase object-storage driver needs its buckets, URL and key');
  }
  return new SupabaseProtectedObjectStorage({
    buckets: config.objectStorageBuckets,
    grant_key: config.objectStorageGrantKey,
    storage: createClient(input.supabase_url, input.supabase_service_role_key, {
      auth: { persistSession: false },
    }).storage,
  });
}

export interface DomainCompositionOptions {
  /** Names the process on pg_stat_activity, e.g. neighbourhood-store-api. */
  readonly application_name: string;
  readonly config: SharedRuntimeConfig;
  readonly log?: (event: string, fields: Record<string, unknown>) => void;
  /** Size of the one pool every domain service shares. */
  readonly max_connections?: number;
  readonly otp_hash_key: string;
  readonly session_token_hash_key: string;
  readonly storage: ProtectedObjectStorage;
}

export interface DomainServices {
  readonly access: IdentityAccessService;
  readonly adminControl: AdminControlPlaneService;
  readonly adminOnboarding: AdminOnboardingService;
  readonly assignments: AssignmentCustodyService;
  readonly availability: PartnerAvailabilityService;
  readonly cart: CustomerCartService;
  readonly catalogueModeration: CatalogueFreshnessModerationService;
  readonly catalogueProducts: CatalogueProductService;
  readonly checkout: GroupedCheckoutService;
  readonly completeMoney: CompleteMoneyLifecycleService;
  readonly configuration: ConfigurationAdminService;
  readonly customerAddresses: CustomerAddressService;
  readonly discovery: CustomerDiscoveryService;
  readonly dispatch: DeliveryDispatchOrchestrator;
  readonly fulfilment: VendorFulfilmentService;
  readonly gatedCapabilities: GatedCapabilityService;
  readonly inventory: InventoryReservationService;
  readonly localeRegistry: LocaleRegistryService;
  readonly money: MoneyLifecycleService;
  readonly moneyProvider: LocalFakeMoneyProvider;
  readonly notifications: LocalNotificationService;
  readonly onboarding: VendorOnboardingService;
  readonly orderMoney: OrderMoneyOrchestrator;
  readonly orderMonitor: OrderMonitorService;
  readonly otp: OtpIdentityService;
  readonly partnerField: PartnerFieldOpsService;
  readonly partnerLifecycle: PartnerLifecycleService;
  readonly partnerWait: PartnerWaitPolicyService;
  readonly password: IdentityPasswordService;
  /** The one pool every service above runs on; ended only by close(). */
  readonly pool: Pool;
  readonly preferences: IdentityPreferencesService;
  readonly publication: VendorPublicationService;
  readonly routing: RoutingService;
  readonly sessions: IdentitySessionService;
  readonly storage: ProtectedObjectStorage;
  readonly supportCases: SupportCaseService;
  readonly trust: TrustReviewService;
  readonly vendorNetwork: VendorNetworkService;
  readonly vendorSettings: VendorSettingsService;
  readonly vendorStaff: VendorStaffService;
  close(): Promise<void>;
}

/**
 * The one composition of every domain service, on one shared pool.
 *
 * Both the API and the worker build their services here so the two processes
 * cannot drift apart in wiring — the worker used to omit the custody and
 * fulfilment hash keys, always use filesystem storage, and build checkout
 * without routing. Per-service pools also summed to more connections than a
 * hosted pooler grants one process; every service now shares this pool and
 * close() is the only place it ends.
 */
export function createDomainServices(options: DomainCompositionOptions): DomainServices {
  const { config, log, otp_hash_key, session_token_hash_key, storage } = options;
  const connection_string = config.databaseUrl;
  const pool = createDatabasePool({
    application_name: options.application_name,
    connectionString: connection_string,
    max: options.max_connections ?? 24,
  });
  const shared = { connection_string, pool } as const;

  const moneyProvider = new LocalFakeMoneyProvider({
    clearing_account_reference: config.providerClearingAccountReference,
    webhook_key: config.paymentWebhookKey,
  });
  const routing = createRoutingService({
    ...(log ? { log } : {}),
    pool,
    routing: config.routing,
  });

  const otp = new OtpIdentityService({ ...shared, hash_key: otp_hash_key });
  const sessions = new IdentitySessionService({
    ...shared,
    otp_service: otp,
    token_hash_key: session_token_hash_key,
  });
  const access = new IdentityAccessService(shared);
  const preferences = new IdentityPreferencesService(shared);
  const password = new IdentityPasswordService({ ...shared, hash_key: otp_hash_key });

  const inventory = new InventoryReservationService(shared);
  const availability = new PartnerAvailabilityService(shared);
  const assignments = new AssignmentCustodyService({ ...shared, hash_key: otp_hash_key });
  const money = new MoneyLifecycleService({ ...shared, provider: moneyProvider });
  const completeMoney = new CompleteMoneyLifecycleService({ ...shared, provider: moneyProvider });
  const fulfilment = new VendorFulfilmentService({
    ...shared,
    // Collection and delivery codes are keyed under the OTP material, with
    // their own domain label (8.6).
    hash_key: otp_hash_key,
    inventory,
  });

  const services: DomainServices = {
    access,
    adminControl: new AdminControlPlaneService(shared),
    adminOnboarding: new AdminOnboardingService({
      ...shared,
      hash_key: otp_hash_key,
      password_service: password,
    }),
    assignments,
    availability,
    cart: new CustomerCartService(shared),
    catalogueModeration: new CatalogueFreshnessModerationService(shared),
    catalogueProducts: new CatalogueProductService({ ...shared, storage }),
    checkout: new GroupedCheckoutService({ ...shared, provider: moneyProvider, routing }),
    completeMoney,
    configuration: new ConfigurationAdminService(shared),
    customerAddresses: new CustomerAddressService(shared),
    discovery: new CustomerDiscoveryService({ ...shared, routing }),
    dispatch: new DeliveryDispatchOrchestrator({ ...shared, assignments, availability }),
    fulfilment,
    gatedCapabilities: new GatedCapabilityService(shared),
    inventory,
    localeRegistry: new LocaleRegistryService(shared),
    money,
    moneyProvider,
    notifications: new LocalNotificationService(shared),
    onboarding: new VendorOnboardingService({ ...shared, storage }),
    orderMoney: new OrderMoneyOrchestrator({ ...shared, complete_money: completeMoney, money }),
    orderMonitor: new OrderMonitorService({ ...shared, assignments, fulfilment, money }),
    otp,
    partnerField: new PartnerFieldOpsService(shared),
    partnerLifecycle: new PartnerLifecycleService(shared),
    partnerWait: new PartnerWaitPolicyService(shared),
    password,
    pool,
    preferences,
    publication: new VendorPublicationService(shared),
    routing,
    sessions,
    storage,
    supportCases: new SupportCaseService(shared),
    trust: new TrustReviewService(shared),
    vendorNetwork: new VendorNetworkService(shared),
    vendorSettings: new VendorSettingsService(shared),
    vendorStaff: new VendorStaffService({ ...shared, access, hash_key: otp_hash_key }),
    close: async () => {
      // Every service's own close() is a no-op for the shared pool; closing
      // them first still lets one that holds another resource release it.
      const members = Object.values(services).filter(
        (member): member is { close(): Promise<void> } =>
          typeof member === 'object' &&
          member !== null &&
          member !== (pool as unknown) &&
          'close' in member &&
          typeof (member as { close?: unknown }).close === 'function',
      );
      await Promise.all(members.map((member) => member.close()));
      await pool.end();
    },
  };
  return services;
}
