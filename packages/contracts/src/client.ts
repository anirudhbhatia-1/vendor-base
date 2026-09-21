import { errorMessageFor } from '@neighbourhood-store/domain-types';
import type {
  CustomerDecision,
  DeclineImpact,
  Address,
  AssignmentTransition,
  DeliveryAssignment,
  Cart,
  CartLine,
  CartVendorGroup,
  CheckoutGroup,
  CheckoutQuote,
  CustomerSupportCase,
  CustomerSettings,
  FulfilmentMethod,
  InAppNotification,
  Language,
  LocaleAudience,
  LocaleBundle,
  LocaleLanguage,
  MapsConfig,
  NotificationPreference,
  PaymentMethod,
  PreferredStore,
  ShopRequestQueueEntry,
  VendorLocationSettings,
  RecentSearch,
  RevalidationOutcome,
  SearchResult,
  CheckoutGroupReceipt,
  CustomerOrderGroup,
  CustomerReceipt,
  VendorStatement,
  PartnerStatement,
  Session,
  SessionTokens,
  Store,
  Storefront,
  SupportCaseMessage,
  SubstitutionPreference,
  PartnerAvailability,
  DevicePosition,
  PartnerAttemptCompensation,
  PartnerEarningEntry,
  VendorOrder,
} from './types.js';

export type { CartLine, CartVendorGroup };

export type ApiClientOptions = {
  baseUrl: string;
  getToken: () => string | null;
  /** Browser BFFs may use a readable double-submit token; native clients omit it. */
  getCsrfToken?: () => string | null;
};

export class ApiError extends Error {
  /** The stable code from the error envelope, when the response carried one. */
  readonly code: string | null;
  /** The server's localisation key, for a caller that renders its own copy. */
  readonly messageKey: string | null;
  /** The request id to quote to support. */
  readonly requestId: string | null;

  constructor(
    readonly status: number,
    message: string,
    envelope?: {
      readonly code?: string | null;
      readonly messageKey?: string | null;
      readonly requestId?: string | null;
    },
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = envelope?.code ?? null;
    this.messageKey = envelope?.messageKey ?? null;
    this.requestId = envelope?.requestId ?? null;
  }
}

function uuidV7(): string {
  const now = Date.now();
  const r = (): number => Math.floor(Math.random() * 256);
  const b = [
    Math.floor(now / 0x10000000000) & 0xff,
    Math.floor(now / 0x100000000) & 0xff,
    Math.floor(now / 0x1000000) & 0xff,
    Math.floor(now / 0x10000) & 0xff,
    Math.floor(now / 0x100) & 0xff,
    now & 0xff,
    0x70 | (r() & 0x0f),
    r(),
    0x80 | (r() & 0x3f),
    r(),
    r(),
    r(),
    r(),
    r(),
    r(),
    r(),
  ];
  const h = (n: number): string => (n & 0xff).toString(16).padStart(2, '0');
  const v = b.map(h).join('');
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20)}`;
}

type RequestOptions = {
  method?: string | undefined;
  body?: unknown;
  headers?: unknown;
  json?: Record<string, unknown> | readonly unknown[] | null | undefined;
};

function makeRequest(options: ApiClientOptions) {
  return async function request<T>(path: string, init?: RequestOptions): Promise<T> {
    const token = options.getToken();
    const headers: Record<string, string> = { 'x-request-id': uuidV7() };
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (init?.method && init.method !== 'GET' && options.getCsrfToken) {
      const csrfToken = options.getCsrfToken();
      if (csrfToken) headers['x-csrf-token'] = csrfToken;
    }
    let body: string | null | undefined = init?.body as string | null | undefined;
    if (init?.json !== undefined) {
      body = JSON.stringify(init.json);
      headers['content-type'] = 'application/json';
    } else if (typeof init?.body === 'string' && init.body.length > 0) {
      headers['content-type'] = 'application/json';
    }
    const extraHeaders: Record<string, string> = {};
    if (Array.isArray(init?.headers)) {
      for (const pair of init.headers as [string, string][])
        extraHeaders[pair[0] ?? ''] = pair[1] ?? '';
    } else if (init?.headers && typeof init.headers === 'object') {
      Object.assign(extraHeaders, init.headers);
    }
    const response = await fetch(`${options.baseUrl}${path}`, {
      ...(init?.method !== undefined ? { method: init.method } : {}),
      headers: { ...headers, ...extraHeaders },
      ...(body !== undefined && body !== null ? { body } : {}),
      credentials: 'same-origin',
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as {
        message?: string;
        error?: { code?: string; message_key?: string; request_id?: string };
      } | null;
      const envelope = problem?.error;
      const code = envelope?.code ?? null;
      throw new ApiError(
        response.status,
        problem?.message ?? errorMessageFor(code) ?? `Request failed (${response.status})`,
        {
          code,
          messageKey: envelope?.message_key ?? null,
          requestId: envelope?.request_id ?? null,
        },
      );
    }
    if (response.status === 204) return null as T;
    return response.json() as Promise<T>;
  };
}

export function createApiClient(options: ApiClientOptions) {
  const r = makeRequest(options);

  return {
    auth: {
      requestOtp: (body: { device_id: string; phone_identifier: string; request_key: string }) =>
        r<{ challenge_id: string }>('/auth/otp/request', { method: 'POST', json: body }),

      verifyOtp: (body: { challenge_id: string; code: string; device_id: string }) =>
        r<{ tokens: SessionTokens | null }>('/auth/otp/verify', { method: 'POST', json: body }),

      verifyCustomerOtp: (body: {
        challenge_id: string;
        code: string;
        device_id: string;
        platform: 'ANDROID' | 'WEB';
      }) =>
        r<{ tokens: SessionTokens | null; customer_enrolled?: boolean }>('/auth/otp/verify', {
          method: 'POST',
          json: { ...body, customer_enrolment: true },
        }),

      enrollCustomer: () => r<Record<string, never>>('/auth/customer/enrol', { method: 'POST' }),

      customerPreferences: () => r<CustomerSettings>('/auth/customer/preferences'),

      updateProfile: (body: {
        display_name: string | null;
        expected_version: number;
        language: Language;
      }) => r<CustomerSettings>('/auth/customer/profile', { method: 'PUT', json: body }),

      updateConsent: (body: {
        consent_kind: string;
        decision: 'GRANTED' | 'WITHDRAWN';
        policy_version: string;
        source: string;
      }) => r<CustomerSettings>('/auth/customer/consents', { method: 'POST', json: body }),

      updateNotification: (
        kind: string,
        channel: string,
        body: { enabled: boolean; expected_version: number },
      ) =>
        r<NotificationPreference>(`/auth/customer/notifications/${kind}/${channel}`, {
          method: 'PUT',
          json: body,
        }),

      // The API returns the rotated tokens directly (IdentitySessionService
      // .refresh resolves to SessionTokens). It is not wrapped like the OTP
      // verification response, which also has to express the already-verified
      // replay case.
      refresh: (refreshToken: string) =>
        r<SessionTokens>('/auth/sessions/refresh', {
          method: 'POST',
          json: { refresh_token: refreshToken },
        }),

      signOut: () => r<Record<string, never>>('/auth/sessions/sign-out', { method: 'POST' }),

      sessions: () => r<{ sessions: Session[] }>('/auth/sessions'),

      revokeSession: (sessionId: string) =>
        r<{ revoked_session_id: string }>(`/auth/sessions/${sessionId}/revoke`, {
          method: 'POST',
        }),

      privacyRequests: () =>
        r<{ requests: Record<string, unknown>[] }>('/auth/customer/privacy-requests'),

      requestPrivacy: (requestKind: 'ACCOUNT_DELETION' | 'DATA_EXPORT') =>
        r<Record<string, unknown>>('/auth/customer/privacy-requests', {
          method: 'POST',
          json: { request_kind: requestKind },
        }),
    },

    addresses: {
      list: () => r<{ addresses: Address[] }>('/customer/addresses'),

      create: (body: {
        address_reference: string;
        label: string;
        pin_code: string;
        latitude: number;
        longitude: number;
        coordinate_source: string;
        landmark?: string | null;
        delivery_instructions?: string | null;
      }) => r<Address>('/customer/addresses', { method: 'POST', json: body }),

      update: (id: string, body: Record<string, unknown>) =>
        r<Address>(`/customer/addresses/${id}`, { method: 'PUT', json: body }),

      remove: (id: string) =>
        r<Record<string, never>>(`/customer/addresses/${id}`, { method: 'DELETE' }),

      select: (id: string) =>
        r<Record<string, never>>(`/customer/addresses/${id}/select`, { method: 'POST' }),

      eligibleVendorLocations: (id: string) =>
        r<{ vendor_location_ids: string[] }>(`/customer/addresses/${id}/eligible-vendor-locations`),
    },

    /**
     * The pre-sign-in catalogue.
     *
     * Separate from `discovery` on purpose: these take a coordinate rather than
     * a saved address and require no session, so a visitor can browse before
     * creating an account (architecture.md §6.1). Nothing personal is returned
     * — favourites, the preferred store and recent searches stay on the
     * authenticated `discovery` calls below.
     */
    catalogue: {
      /** The map provider and its public token, or none -- the picker falls back to hand entry. */
      mapsConfig: () => r<MapsConfig>('/catalogue/maps/config'),

      stores: (params: {
        latitude: number;
        longitude: number;
        limit?: number;
        offset?: number;
      }) => {
        const q = new URLSearchParams({
          latitude: String(params.latitude),
          longitude: String(params.longitude),
        });
        if (params.limit !== undefined) q.set('limit', String(params.limit));
        if (params.offset !== undefined) q.set('offset', String(params.offset));
        return r<{ stores: Store[] }>(`/catalogue/stores?${q.toString()}`);
      },

      search: (params: {
        latitude: number;
        longitude: number;
        term: string;
        limit?: number;
        category?: string;
        available_only?: boolean;
        fulfilment_mode?: string;
        max_distance_meters?: number;
      }) => {
        const q = new URLSearchParams({
          latitude: String(params.latitude),
          longitude: String(params.longitude),
          term: params.term,
        });
        if (params.limit !== undefined) q.set('limit', String(params.limit));
        if (params.category) q.set('category', params.category);
        if (params.available_only !== undefined)
          q.set('available_only', String(params.available_only));
        if (params.fulfilment_mode) q.set('fulfilment_mode', params.fulfilment_mode);
        if (params.max_distance_meters !== undefined)
          q.set('max_distance_meters', String(params.max_distance_meters));
        return r<{ results: SearchResult[] }>(`/catalogue/search?${q.toString()}`);
      },

      storefront: (vendorLocationId: string) =>
        r<Storefront>(`/catalogue/stores/${vendorLocationId}`),
    },

    discovery: {
      stores: (params: { customer_address_id: string; limit?: number; offset?: number }) => {
        const q = new URLSearchParams({ customer_address_id: params.customer_address_id });
        if (params.limit !== undefined) q.set('limit', String(params.limit));
        if (params.offset !== undefined) q.set('offset', String(params.offset));
        return r<{ stores: Store[] }>(`/customer/discovery/stores?${q.toString()}`);
      },

      search: (params: {
        customer_address_id: string;
        term: string;
        limit?: number;
        category?: string;
        available_only?: boolean;
        max_distance_meters?: number;
      }) => {
        const q = new URLSearchParams({
          customer_address_id: params.customer_address_id,
          term: params.term,
        });
        if (params.limit !== undefined) q.set('limit', String(params.limit));
        if (params.category) q.set('category', params.category);
        if (params.available_only !== undefined)
          q.set('available_only', String(params.available_only));
        if (params.max_distance_meters !== undefined)
          q.set('max_distance_meters', String(params.max_distance_meters));
        return r<{ results: SearchResult[] }>(`/customer/discovery/search?${q.toString()}`);
      },

      storefront: (vendorLocationId: string) =>
        r<Storefront>(`/customer/discovery/stores/${vendorLocationId}`),

      categories: () =>
        r<{ categories: { category: string; product_count: number }[] }>(
          '/customer/discovery/categories',
        ),

      recentSearches: () =>
        r<{ recent_searches: RecentSearch[] }>('/customer/discovery/recent-searches'),

      deleteRecentSearch: (term: string) =>
        r<{ deleted: boolean }>(`/customer/discovery/recent-searches/${encodeURIComponent(term)}`, {
          method: 'DELETE',
        }),

      favourites: (params?: { customer_address_id?: string }) => {
        const qs = params?.customer_address_id
          ? `?customer_address_id=${params.customer_address_id}`
          : '';
        return r<{ favourites: Store[] }>(`/customer/discovery/favourites${qs}`);
      },

      addFavourite: (vendorLocationId: string) =>
        r<{ favourited: boolean }>(`/customer/discovery/favourites/${vendorLocationId}`, {
          method: 'POST',
        }),

      removeFavourite: (vendorLocationId: string) =>
        r<{ favourited: boolean }>(`/customer/discovery/favourites/${vendorLocationId}`, {
          method: 'DELETE',
        }),

      setPreferredStore: (vendorLocationId: string) =>
        r<{ set: boolean }>(`/customer/discovery/preferred-store/${vendorLocationId}`, {
          method: 'POST',
        }),

      clearPreferredStore: () =>
        r<{ cleared: boolean }>('/customer/discovery/preferred-store', { method: 'DELETE' }),

      preferredStore: (params?: { customer_address_id?: string }) => {
        const qs = params?.customer_address_id
          ? `?customer_address_id=${params.customer_address_id}`
          : '';
        return r<{ preferred_store: PreferredStore | null }>(
          `/customer/discovery/preferred-store${qs}`,
        );
      },

      requestShop: (body: {
        pin_code: string;
        latitude: number;
        longitude: number;
        store_name: string;
        note?: string | null;
      }) =>
        r<Record<string, unknown>>('/customer/discovery/shop-requests', {
          method: 'POST',
          json: body,
        }),
    },

    cart: {
      current: () => r<Cart>('/customer/cart'),

      setAddress: (body: { customer_address_id: string }) =>
        r<Cart>('/customer/cart/address', { method: 'PUT', json: body }),

      addLine: (body: {
        vendor_location_id: string;
        catalogue_variant_id: string;
        quantity: number;
        fulfilment_method?: FulfilmentMethod;
        substitution_preference?: SubstitutionPreference;
      }) => r<Cart>('/customer/cart/lines', { method: 'POST', json: body }),

      setQuantity: (
        cartLineId: string,
        body: {
          expected_version: number;
          quantity: number;
          /** Optional: changes the line's substitution rule in the same command (CUS-34). */
          substitution_preference?: SubstitutionPreference;
        },
      ) => r<Cart>(`/customer/cart/lines/${cartLineId}`, { method: 'PUT', json: body }),

      removeLine: (cartLineId: string) =>
        r<Cart>(`/customer/cart/lines/${cartLineId}/remove`, { method: 'POST' }),

      setGroupFulfilmentMethod: (
        groupId: string,
        body: {
          expected_version: number;
          fulfilment_method: FulfilmentMethod;
          customer_note?: string | null;
        },
      ) =>
        r<Cart>(`/customer/cart/groups/${groupId}/fulfilment-method`, {
          method: 'PUT',
          json: body,
        }),

      revalidate: () =>
        r<{ outcomes: RevalidationOutcome[] }>('/customer/cart/revalidate', {
          method: 'POST',
        }),
    },

    checkout: {
      quote: (body: { cart_id: string }) =>
        r<CheckoutQuote>('/customer/checkout/quotes', { method: 'POST', json: body }),

      place: (body: {
        checkout_quote_id: string;
        /** The prepaid method the customer selected. COD is gated (GAT-01). */
        payment_method?: PaymentMethod;
        idempotency_key?: string;
      }) => r<CheckoutGroup>('/customer/checkout/groups', { method: 'POST', json: body }),

      get: (checkoutGroupId: string) =>
        r<CheckoutGroup>(`/customer/checkout/groups/${checkoutGroupId}`),

      history: (checkoutGroupId: string, params?: { cursor?: string; limit?: number }) => {
        const q = new URLSearchParams();
        if (params?.cursor) q.set('cursor', params.cursor);
        if (params?.limit !== undefined) q.set('limit', String(params.limit));
        const qs = q.toString();
        return r<{ events: Record<string, unknown>[] }>(
          `/customer/checkout/groups/${checkoutGroupId}/history${qs ? `?${qs}` : ''}`,
        );
      },
    },

    orders: {
      list: () => r<{ groups: CustomerOrderGroup[] }>('/customer/orders'),

      receipt: (vendorOrderId: string) =>
        r<CustomerReceipt>(`/customer/orders/${vendorOrderId}/receipt`),

      rate: (vendorOrderId: string, body: { stars: number; review_note?: string | null }) =>
        r<{ rated: boolean }>(`/customer/orders/${vendorOrderId}/rating`, {
          method: 'POST',
          json: body,
        }),

      /**
       * Rates the delivery, which is a different service from the shop.
       *
       * One score across both meant a shop that packed a perfect order carried
       * a late rider on its record, and neither could act on the signal.
       */
      rateDelivery: (
        deliveryAssignmentId: string,
        body: { stars: number; review_note?: string | null },
      ) =>
        r<{ rated: boolean }>(`/customer/deliveries/${deliveryAssignmentId}/rating`, {
          method: 'POST',
          json: body,
        }),

      openSupport: (
        vendorOrderId: string,
        body: { category: string; description: string; vendor_order_line_id?: string },
      ) =>
        r<Record<string, unknown>>(`/customer/orders/${vendorOrderId}/support`, {
          method: 'POST',
          json: body,
        }),

      /** What cancelling would do, before the customer commits to it. */
      cancellationPreview: (vendorOrderId: string) =>
        r<{
          allowed: boolean;
          lifecycle_state: string;
          reason: string;
          refund_expectation: string;
          next_step: 'CANCEL' | 'SUPPORT_CASE' | 'NONE';
          version: number;
        }>(`/customer/orders/${vendorOrderId}/cancellation-preview`),

      cancel: (vendorOrderId: string, body: { expected_version: number; reason_code: string }) =>
        r<VendorOrder>(`/customer/orders/${vendorOrderId}/cancel`, { method: 'POST', json: body }),

      /** Coarse delivery stage; never the partner's identity or position. */
      /** Mints the customer's collection code for a pickup order (CUS-51). */
      pickupOtp: (vendorOrderId: string) =>
        r<{ plaintext_otp: string; expires_at: string }>(
          `/customer/orders/${vendorOrderId}/pickup-otp`,
          { method: 'POST' },
        ),

      /**
       * Mints the customer's delivery code (CUS-56).
       *
       * Each call replaces the previous one, so the code the partner is read is
       * always the current one.
       */
      deliveryOtp: (vendorOrderId: string) =>
        r<{ plaintext_otp: string; expires_at: string }>(
          `/customer/orders/${vendorOrderId}/delivery-otp`,
          { method: 'POST' },
        ),

      tracking: (vendorOrderId: string) =>
        r<{
          lifecycle_state: string;
          fulfilment_method: string;
          stage: string;
          approximate_drop_area: string | null;
          in_custody: boolean;
        }>(`/customer/orders/${vendorOrderId}/tracking`),

      supportCases: () => r<{ cases: CustomerSupportCase[] }>('/customer/support-cases'),

      supportCase: (supportCaseId: string) =>
        r<CustomerSupportCase>(`/customer/support-cases/${supportCaseId}`),

      sendSupportMessage: (supportCaseId: string, body: string) =>
        r<SupportCaseMessage>(`/customer/support-cases/${supportCaseId}/messages`, {
          method: 'POST',
          json: { body },
        }),

      /**
       * The money view of a checkout group, including any refunds against it.
       * A partially refunded order otherwise shows only its original total,
       * which reads as though the money went nowhere.
       */
      financeReceipt: (checkoutGroupId: string) =>
        r<CheckoutGroupReceipt>(`/customer/finance/receipts/${checkoutGroupId}`),
    },

    decisions: {
      pending: () => r<{ decisions: CustomerDecision[] }>('/customer/decisions/pending'),

      answer: (decisionId: string, answer: 'APPROVED' | 'REJECTED') =>
        r<Record<string, unknown>>(`/customer/decisions/${decisionId}/answer`, {
          method: 'POST',
          json: { answer },
        }),
    },

    locale: {
      bundle: (params: { language: LocaleLanguage; audience?: LocaleAudience }) => {
        const q = new URLSearchParams({ language: params.language });
        if (params.audience) q.set('audience', params.audience);
        return r<LocaleBundle>(`/locale/bundle?${q.toString()}`);
      },
    },

    notifications: {
      list: (params?: { unread_only?: boolean }) => {
        const qs = params?.unread_only === true ? '?unread_only=true' : '';
        return r<{ notifications: InAppNotification[] }>(`/notifications${qs}`);
      },

      markRead: (notificationId: string) =>
        r<InAppNotification>(`/notifications/${notificationId}/read`, { method: 'POST' }),
    },

    vendor: {
      onboarding: {
        createApplication: () =>
          r<{ onboarding_case_id: string }>('/vendor/onboarding/applications', { method: 'POST' }),

        claimInvitation: (body: { invitation_reference: string; expected_version: number }) =>
          r<{ version: number }>('/vendor/onboarding/invitations/claim', {
            method: 'POST',
            json: body,
          }),

        submitProfile: (
          caseId: string,
          body: {
            expected_version: number;
            business_name: string;
            business_profile_reference: string;
            category: string;
            latitude: number;
            longitude: number;
            location_name: string;
            minimum_order_minor: number;
            operating_timezone: string;
            payout_profile_reference: string;
            preparation_seconds: number;
            profile_description?: string | null;
          },
        ) =>
          r<{ version: number }>(`/vendor/onboarding/${caseId}/profile`, {
            method: 'PUT',
            json: body,
          }),

        uploadDocument: (
          caseId: string,
          body: {
            expected_version: number;
            document_kind: string;
            affected_capability: string;
            content_base64: string;
            media_type: string;
            expires_on?: string | null;
            test_scan_scenario?: 'clean' | 'rejected';
          },
        ) =>
          r<Record<string, unknown>>(`/vendor/onboarding/${caseId}/documents`, {
            method: 'POST',
            json: body,
          }),

        get: (caseId: string) => r<Record<string, unknown>>(`/vendor/onboarding/${caseId}`),

        appeal: (caseId: string, body: { expected_version: number; reason_note: string }) =>
          r<Record<string, unknown>>(`/vendor/onboarding/${caseId}/appeals`, {
            method: 'POST',
            json: body,
          }),
      },

      fulfilment: {
        pendingOrders: (vendorLocationId: string) =>
          r<{ orders: VendorOrder[] }>(`/vendor/locations/${vendorLocationId}/orders`),

        accept: (
          vendorLocationId: string,
          orderId: string,
          body: { expected_version: number; preparation_estimate_seconds: number },
        ) =>
          r<VendorOrder>(`/vendor/locations/${vendorLocationId}/orders/${orderId}/accept`, {
            method: 'POST',
            json: body,
          }),

        declinePreview: (vendorLocationId: string, orderId: string) =>
          r<DeclineImpact>(
            `/vendor/locations/${vendorLocationId}/orders/${orderId}/decline-preview`,
          ),

        decline: (
          vendorLocationId: string,
          orderId: string,
          body: { expected_version: number; reason_code: string; note?: string | null },
        ) =>
          r<VendorOrder>(`/vendor/locations/${vendorLocationId}/orders/${orderId}/decline`, {
            method: 'POST',
            json: body,
          }),

        markReady: (
          vendorLocationId: string,
          orderId: string,
          body: {
            expected_version: number;
            package_count: number;
            package_condition_note?: string;
            handling_flags?: readonly string[];
          },
        ) =>
          r<VendorOrder>(`/vendor/locations/${vendorLocationId}/orders/${orderId}/ready`, {
            method: 'POST',
            json: body,
          }),
      },

      inventory: {
        list: (vendorLocationId: string) =>
          r<{ items: Record<string, unknown>[] }>(
            `/vendor/locations/${vendorLocationId}/inventory`,
          ),

        create: (
          vendorLocationId: string,
          body: {
            display_name: string;
            product_reference: string;
            quantity_basis: 'COUNTED' | 'VENDOR_CONFIRMS';
            reason_code: string;
            exact_available_quantity?: number;
            low_stock_threshold?: number;
          },
        ) =>
          r<Record<string, unknown>>(`/vendor/locations/${vendorLocationId}/inventory`, {
            method: 'POST',
            json: body,
          }),

        setStock: (
          vendorLocationId: string,
          inventoryItemId: string,
          body: {
            exact_available_quantity: number;
            expected_version: number;
            low_stock_threshold: number;
            reason_code: string;
          },
        ) =>
          r<Record<string, unknown>>(
            `/vendor/locations/${vendorLocationId}/inventory/${inventoryItemId}/stock`,
            { method: 'PUT', json: body },
          ),

        confirmAvailability: (
          vendorLocationId: string,
          inventoryItemId: string,
          body: { expected_version: number; reason_code: string },
        ) =>
          r<Record<string, unknown>>(
            `/vendor/locations/${vendorLocationId}/inventory/${inventoryItemId}/confirm`,
            { method: 'POST', json: body },
          ),

        reservations: (vendorLocationId: string, inventoryItemId: string) =>
          r<{ reservations: Record<string, unknown>[] }>(
            `/vendor/locations/${vendorLocationId}/inventory/${inventoryItemId}/reservations`,
          ),
      },

      catalogue: {
        listProducts: (vendorLocationId: string) =>
          r<Record<string, unknown>>(`/vendor/locations/${vendorLocationId}/catalogue/products`),

        createProduct: (
          vendorLocationId: string,
          body: {
            product_reference: string;
            title: string;
            category: string;
            unit_label: string;
            tax_basis: 'INCLUSIVE' | 'EXCLUSIVE' | 'EXEMPT';
            variable_weight: boolean;
            permitted_weight_variance_bps?: number | null;
            sku: string;
            variant_title: string;
            price_minor: number;
            initial_stock_quantity?: number;
            low_stock_threshold?: number;
          },
        ) =>
          r<{
            catalogue_product_id: string;
            catalogue_variant_id: string;
            version: number;
          }>(`/vendor/locations/${vendorLocationId}/catalogue/products`, {
            method: 'POST',
            json: body,
          }),

        setVariantPrice: (
          vendorLocationId: string,
          variantId: string,
          body: { price_minor: number; reason_code?: string },
        ) =>
          r<{ catalogue_price_id: string }>(
            `/vendor/locations/${vendorLocationId}/catalogue/products/variants/${variantId}/price`,
            { method: 'PUT', json: body },
          ),

        setLifecycle: (
          vendorLocationId: string,
          productId: string,
          action: 'activate' | 'deactivate',
          body: { expected_version: number },
        ) =>
          r<{ version: number; lifecycle_state: string }>(
            `/vendor/locations/${vendorLocationId}/catalogue/products/${productId}/${action}`,
            { method: 'POST', json: body },
          ),

        addImage: (
          vendorLocationId: string,
          productId: string,
          body: { object_reference: string; alt_text: string; position: number },
        ) =>
          r<Record<string, unknown>>(
            `/vendor/locations/${vendorLocationId}/catalogue/products/${productId}/images`,
            { method: 'POST', json: body },
          ),

        uploadImage: (
          vendorLocationId: string,
          productId: string,
          body: {
            content_base64: string;
            media_type: 'image/png' | 'image/jpeg';
            alt_text: string;
            position: number;
          },
        ) =>
          r<{ catalogue_image_id: string; object_reference: string }>(
            `/vendor/locations/${vendorLocationId}/catalogue/products/${productId}/image-upload`,
            { method: 'POST', json: body },
          ),
      },

      settings: {
        /**
         * The store's current settings and the version an edit must carry.
         *
         * Without this the settings form had nothing to populate from, so it
         * started on hardcoded defaults and overwrote the real values on save —
         * and `expected_version` had to be typed by hand.
         */
        readLocation: (vendorLocationId: string) =>
          r<VendorLocationSettings>(`/vendor/locations/${vendorLocationId}/settings`),

        updateLocation: (
          vendorLocationId: string,
          body: {
            expected_version: number;
            location_name?: string;
            profile_description?: string | null;
            landmark?: string | null;
            preparation_seconds?: number;
            minimum_order_minor?: number;
            operating_timezone?: string;
            hours?: readonly {
              weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
              opens_at: string;
              closes_at: string;
            }[];
          },
        ) =>
          r<{ version: number }>(`/vendor/locations/${vendorLocationId}/settings`, {
            method: 'PUT',
            json: body,
          }),

        setLifecycle: (
          vendorLocationId: string,
          body: { state: 'ACTIVE' | 'PAUSED'; expected_version: number },
        ) =>
          r<{ version: number; lifecycle_state: 'ACTIVE' | 'PAUSED' }>(
            `/vendor/locations/${vendorLocationId}/settings/lifecycle`,
            { method: 'POST', json: body },
          ),
      },

      finance: {
        statement: (vendorLocationId: string) =>
          r<VendorStatement>(`/vendor/locations/${vendorLocationId}/finance/statement`),
      },
    },

    partner: {
      offers: () =>
        r<{
          offers: {
            delivery_assignment_id: string;
            source_order_reference: string;
            vendor_location_id: string;
            assignment_state: string;
            custody_state: string;
            package_count: number;
            approximate_pickup_area: string;
            approximate_drop_area: string;
            offer_expires_at: string | null;
            version: number;
          }[];
        }>('/partner/offers'),

      applications: {
        create: (body: {
          identity_reference: string;
          vehicle_reference: string;
          vehicle_kind: string;
          bank_account_reference: string;
          insurance_reference: string;
          emergency_contact_reference: string;
          training_reference: string;
          home_zone_name: string;
          identity_expires_at: string;
          vehicle_expires_at: string;
          insurance_expires_at: string;
        }) =>
          r<{ partner_application_id: string }>('/partner/applications', {
            method: 'POST',
            json: body,
          }),

        submit: (applicationId: string, body: { expected_version: number }) =>
          r<Record<string, unknown>>(`/partner/applications/${applicationId}/submit`, {
            method: 'POST',
            json: body,
          }),

        get: (applicationId: string) =>
          r<Record<string, unknown>>(`/partner/applications/${applicationId}`),
      },

      availability: {
        current: () => r<PartnerAvailability>('/partner/availability'),

        set: (
          body:
            | {
                state: 'ONLINE';
                reason_code: string;
                latitude: number;
                longitude: number;
                accuracy_meters: number;
                battery_percent: number;
              }
            | { state: 'OFFLINE' | 'PAUSED'; reason_code: string },
        ) => r<PartnerAvailability>('/partner/availability', { method: 'POST', json: body }),
      },

      assignments: {
        list: () => r<{ assignments: DeliveryAssignment[] }>('/partner/assignments'),

        get: (assignmentId: string) =>
          r<DeliveryAssignment>(`/partner/assignments/${assignmentId}`),

        accept: (assignmentId: string, body: AssignmentTransition) =>
          r<DeliveryAssignment>(`/partner/offers/${assignmentId}/accept`, {
            method: 'POST',
            json: body,
          }),

        decline: (assignmentId: string, body: AssignmentTransition) =>
          r<DeliveryAssignment>(`/partner/offers/${assignmentId}/decline`, {
            method: 'POST',
            json: body,
          }),

        arriveAtVendor: (
          assignmentId: string,
          body: AssignmentTransition & Partial<DevicePosition>,
        ) =>
          r<DeliveryAssignment>(`/partner/assignments/${assignmentId}/arrive-vendor`, {
            method: 'POST',
            json: body,
          }),

        confirmPickup: (
          assignmentId: string,
          body: AssignmentTransition & {
            package_count: number;
            proof_reference: string;
            vendor_confirmed: boolean;
          },
        ) =>
          r<DeliveryAssignment>(`/partner/assignments/${assignmentId}/pickup`, {
            method: 'POST',
            json: body,
          }),

        beginRoute: (assignmentId: string, body: AssignmentTransition) =>
          r<DeliveryAssignment>(`/partner/assignments/${assignmentId}/begin-route`, {
            method: 'POST',
            json: body,
          }),

        arriveAtCustomer: (assignmentId: string, body: AssignmentTransition) =>
          r<DeliveryAssignment>(`/partner/assignments/${assignmentId}/arrive-customer`, {
            method: 'POST',
            json: body,
          }),

        /**
         * Completion needs the customer's code (CUS-56), not only a proof
         * reference the app invented from its own clock. The route has required
         * `otp` since the OTP control landed; leaving it off this type meant a
         * typed client could not express the correct call at all.
         */
        deliver: (
          assignmentId: string,
          body: AssignmentTransition & { otp: string; proof_reference: string },
        ) =>
          r<DeliveryAssignment>(`/partner/assignments/${assignmentId}/deliver`, {
            method: 'POST',
            json: body,
          }),

        fail: (assignmentId: string, body: AssignmentTransition) =>
          r<DeliveryAssignment>(`/partner/assignments/${assignmentId}/fail`, {
            method: 'POST',
            json: body,
          }),

        requireReturn: (assignmentId: string, body: AssignmentTransition) =>
          r<DeliveryAssignment>(`/partner/assignments/${assignmentId}/require-return`, {
            method: 'POST',
            json: body,
          }),

        beginReturn: (assignmentId: string, body: AssignmentTransition) =>
          r<DeliveryAssignment>(`/partner/assignments/${assignmentId}/begin-return`, {
            method: 'POST',
            json: body,
          }),

        completeReturn: (
          assignmentId: string,
          body: AssignmentTransition & { proof_reference: string },
        ) =>
          r<DeliveryAssignment>(`/partner/assignments/${assignmentId}/complete-return`, {
            method: 'POST',
            json: body,
          }),
      },

      earnings: {
        list: () => r<{ earnings: PartnerEarningEntry[] }>('/partner/earnings'),

        compensations: () =>
          r<{ compensations: PartnerAttemptCompensation[] }>('/partner/compensations'),

        raiseDispute: (body: {
          partner_earnings_record_id: string;
          disputed_component: string;
          proposed_amount_minor: number;
          evidence_note: string;
        }) =>
          r<Record<string, unknown>>('/partner/earnings/disputes', {
            method: 'POST',
            json: body,
          }),

        withdrawDispute: (disputeCaseId: string) =>
          r<Record<string, unknown>>(`/partner/earnings/disputes/${disputeCaseId}/withdraw`, {
            method: 'POST',
          }),
      },

      finance: {
        statement: () => r<PartnerStatement>('/partner/finance/statement'),
      },
    },

    admin: {
      vendorOnboarding: {
        get: (caseId: string) => r<Record<string, unknown>>(`/admin/vendor-onboarding/${caseId}`),

        startReview: (caseId: string, body: { expected_version: number }) =>
          r<{ version: number }>(`/admin/vendor-onboarding/${caseId}/review/start`, {
            method: 'POST',
            json: body,
          }),

        approve: (
          caseId: string,
          body: {
            expected_version: number;
            reason_code: string;
            reviewer_note: string;
            evidence_reference: string;
          },
        ) =>
          r<{ version: number }>(`/admin/vendor-onboarding/${caseId}/approve`, {
            method: 'POST',
            json: body,
          }),

        reject: (
          caseId: string,
          body: { expected_version: number; reason_code: string; reviewer_note: string },
        ) =>
          r<{ version: number }>(`/admin/vendor-onboarding/${caseId}/reject`, {
            method: 'POST',
            json: body,
          }),
      },

      partnerApplications: {
        startReview: (id: string, body: { expected_version: number }) =>
          r<Record<string, unknown>>(`/admin/partner-applications/${id}/start-review`, {
            method: 'POST',
            json: body,
          }),

        requestChanges: (
          id: string,
          body: { expected_version: number; reason_note: string; required_changes: string[] },
        ) =>
          r<Record<string, unknown>>(`/admin/partner-applications/${id}/request-changes`, {
            method: 'POST',
            json: body,
          }),

        approve: (id: string, body: { expected_version: number; reviewer_note: string }) =>
          r<Record<string, unknown>>(`/admin/partner-applications/${id}/approve`, {
            method: 'POST',
            json: body,
          }),

        reject: (id: string, body: { expected_version: number; reason_note: string }) =>
          r<Record<string, unknown>>(`/admin/partner-applications/${id}/reject`, {
            method: 'POST',
            json: body,
          }),
      },

      shopRequests: {
        list: (params?: { state?: 'CLOSED' | 'OPEN' | 'TRIAGED' }) => {
          const qs = params?.state ? `?state=${params.state}` : '';
          return r<{ shop_requests: ShopRequestQueueEntry[] }>(`/admin/shop-requests${qs}`);
        },

        triage: (id: string, body: { onboarding_case_id?: string } = {}) =>
          r<ShopRequestQueueEntry>(`/admin/shop-requests/${id}/triage`, {
            method: 'POST',
            json: body,
          }),

        close: (id: string, body: { resolution: string }) =>
          r<ShopRequestQueueEntry>(`/admin/shop-requests/${id}/close`, {
            method: 'POST',
            json: body,
          }),
      },

      locale: {
        coverage: () => r<Record<string, unknown>>('/admin/locale/coverage'),

        upsertKey: (body: {
          locale_key: string;
          namespace: string;
          audience: string;
          description: string;
        }) => r<Record<string, unknown>>('/admin/locale/keys', { method: 'POST', json: body }),

        setTranslation: (body: {
          locale_key: string;
          language_code: LocaleLanguage;
          translation: string;
        }) =>
          r<Record<string, unknown>>('/admin/locale/translations', {
            method: 'POST',
            json: body,
          }),
      },

      zones: {
        list: () =>
          r<{
            zones: {
              service_zone_id: string;
              vendor_location_id: string;
              zone_name: string;
              lifecycle_state: 'ACTIVE' | 'RETIRED';
              operating_timezone: string;
              location_name: string;
              location_lifecycle_state: string;
              latitude: number;
              longitude: number;
            }[];
          }>('/admin/zones'),
      },

      onboarding: {
        createVendor: (
          body: {
            email?: string;
            phone_identifier?: string;
            password?: string;
            business_name: string;
            location_name: string;
            latitude: number;
            longitude: number;
            profile_description?: string;
            category?: string;
            timezone?: string;
            minimum_order_minor?: number;
            fulfilment_modes?: readonly (
              'CUSTOMER_PICKUP' | 'PLATFORM_DELIVERY' | 'VENDOR_DELIVERY'
            )[];
          },
          idempotencyKey = uuidV7(),
        ) =>
          r<{
            user_id: string;
            vendor_id: string;
            vendor_location_id: string;
            role_assignment_id: string;
            supabase_user_id?: string;
            email?: string;
            password_set: boolean;
          }>('/admin/onboarding/vendors', {
            method: 'POST',
            headers: { 'idempotency-key': idempotencyKey },
            json: body,
          }),

        createPartner: (
          body: {
            email?: string;
            phone_identifier?: string;
            password?: string;
            display_name: string;
          },
          idempotencyKey = uuidV7(),
        ) =>
          r<{
            user_id: string;
            role_assignment_id: string;
            supabase_user_id?: string;
            email?: string;
            password_set: boolean;
          }>('/admin/onboarding/partners', {
            method: 'POST',
            headers: { 'idempotency-key': idempotencyKey },
            json: body,
          }),
      },
    },
  };
}

// Extend the auth namespace with a password-verify helper. This lives after
// createApiClient so we can layer it without adjusting the initial return object.
export function passwordSignIn(
  options: ApiClientOptions,
  body: {
    phone_identifier: string;
    password: string;
    device_id: string;
    platform: 'WEB' | 'ANDROID';
    device_label?: string | null;
    notification_token?: string | null;
  },
): Promise<{ tokens: SessionTokens }> {
  const r = makeRequest(options);
  return r<{ tokens: SessionTokens }>('/auth/password/verify', { method: 'POST', json: body });
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function createRawRequester(options: ApiClientOptions) {
  return makeRequest(options);
}
export type RawRequester = ReturnType<typeof createRawRequester>;

/**
 * The URL of a published catalogue image.
 *
 * A plain URL, not a fetch: the browser loads it as an `<img src>` so it is
 * cached, lazily loaded and streamed by the platform rather than pulled into
 * JavaScript memory. The route is public and immutable per id, so no token is
 * involved and none should be added — a signed URL in markup is a credential in
 * the DOM.
 */
export function catalogueImageUrl(apiUrl: string, catalogueImageId: string): string {
  return `${apiUrl.replace(/\/$/, '')}/customer/catalogue/images/${encodeURIComponent(catalogueImageId)}`;
}
