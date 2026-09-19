// ─── Locale ──────────────────────────────────────────────────────────────────

export type LocaleLanguage = 'en' | 'hi';
export type LocaleAudience = 'CUSTOMER' | 'VENDOR' | 'PARTNER' | 'ADMIN' | 'SHARED';

export type LocaleBundle = {
  language: LocaleLanguage;
  audience?: LocaleAudience;
  bundle: Record<string, string>;
};

// ─── Auth ─────────────────────────────────────────────────────────────────────

export type Language = 'EN' | 'HI';

export type SessionTokens = {
  access_expires_at: string;
  access_token: string;
  refresh_token: string;
  session_id: string;
};

export type Consent = {
  consent_kind: string;
  decision: 'GRANTED' | 'WITHDRAWN';
};

export type NotificationPreference = {
  channel: 'PUSH' | 'SMS';
  effective_enabled: boolean;
  notification_kind: 'MARKETING' | 'ORDER_STATUS' | 'SECURITY' | 'SUPPORT';
  preference_enabled: boolean | null;
  user_controllable: boolean;
  version: number;
};

export type CustomerProfile = {
  display_name: string | null;
  language: Language;
  version: number;
};

export type CustomerSettings = {
  consents: Consent[];
  notifications: NotificationPreference[];
  profile: CustomerProfile;
};

export type Session = {
  session_id: string;
  device_id: string;
  created_at: string;
  current: boolean;
  device_label: string;
  platform: string;
  state: string;
  access_expires_at: string | null;
};

// ─── Addresses ────────────────────────────────────────────────────────────────

export type Address = {
  customer_address_id: string;
  address_reference: string;
  label: string;
  pin_code: string;
  latitude: number;
  longitude: number;
  coordinate_source: 'DEVICE_LOCATION' | 'MANUAL_PIN';
  landmark: string | null;
  delivery_instructions: string | null;
  is_selected: boolean;
  lifecycle_state: 'ACTIVE' | 'ARCHIVED';
  version: number;
};

// ─── Discovery ────────────────────────────────────────────────────────────────

export type FulfilmentMethod = 'CUSTOMER_PICKUP' | 'PLATFORM_DELIVERY' | 'VENDOR_DELIVERY';
export type SubstitutionPreference = 'ALLOW_SAME_STORE' | 'ASK_CUSTOMER' | 'NO_SUBSTITUTION';

export type OperatingHours = {
  weekday: number;
  opens_at: string;
  closes_at: string;
};

/** The customer's preferred store, with whether it can serve the address asked about. */
export type PreferredStore = {
  vendor_location_id: string;
  location_name: string;
  is_currently_eligible: boolean;
};

/** A nearby-shop request as the operator queue shows it: the place, never the customer. */
export type ShopRequestQueueEntry = {
  customer_shop_request_id: string;
  store_name: string;
  lifecycle_state: 'CLOSED' | 'OPEN' | 'TRIAGED';
  pin_code: string;
  note: string | null;
  latitude: number;
  longitude: number;
  onboarding_case_id: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string;
};

export type Store = {
  vendor_location_id: string;
  location_name: string;
  category: string;
  distance_meters: number;
  minimum_order_minor: number;
  currency: string;
  fulfilment_modes: string[];
  is_open_now: boolean;
};

export type Product = {
  catalogue_product_id: string;
  catalogue_variant_id: string;
  product_reference: string;
  title: string;
  category: string;
  unit_label: string;
  variable_weight: boolean;
  price_minor: number | null;
  availability_state: string | null;
  /** No inventory row at all: the shop has never said whether it has this. */
  is_stale: boolean;
  /**
   * How recently the shop confirmed the stock: FRESH within fifteen minutes,
   * STALE within an hour, EXPIRED beyond; null when there is no inventory row.
   * Shown, never used to refuse an add — the shop confirms at acceptance.
   */
  freshness: 'EXPIRED' | 'FRESH' | 'STALE' | null;
  last_confirmed_at: string | null;
  /** Variable weight only: how far the final weight may differ, in basis points. */
  permitted_weight_variance_bps: number | null;
  substitution_available: boolean;
  /**
   * Identifiers of this product's servable images, in display order.
   *
   * The discovery service has always returned an image column and the
   * controller passes its result through unchanged, so the API was already
   * emitting it — this type simply did not admit it existed, which is one
   * reason no surface has ever shown a product photograph. Resolve one to a URL
   * with `catalogueImageUrl`; an empty list means the store has uploaded
   * nothing and the category placeholder is the correct rendering.
   */
  image_ids: string[];
};

/**
 * A store page.
 *
 * Deliberately *not* `Store & {...}`. The storefront endpoint returns no
 * distance and no open/closed flag — those are computed against a specific
 * customer address by the discovery query, and the storefront query has no
 * address. Declaring the intersection made `storefront.is_open_now` typecheck
 * everywhere while being `undefined` at runtime.
 */
export type Storefront = {
  vendor_location_id: string;
  location_name: string;
  profile_description: string | null;
  category: string;
  minimum_order_minor: number;
  fulfilment_modes: string[];
  operating_hours: OperatingHours[];
  rating_average: number | null;
  rating_count: number;
  products: Product[];
};

export type SearchResult = {
  vendor_location_id: string;
  catalogue_product_id: string;
  catalogue_variant_id: string;
  title: string;
  price_minor: number | null;
};

export type RecentSearch = {
  display_term: string;
  last_searched_at: string;
};

// ─── Cart ─────────────────────────────────────────────────────────────────────

export type CartLine = {
  cart_line_id: string;
  catalogue_variant_id: string;
  catalogue_product_id: string;
  quantity: number;
  substitution_preference: SubstitutionPreference;
  lifecycle_state: string;
  version: number;
  /** Current catalogue facts. A cart holds no price snapshot; the quote does. */
  title: string;
  unit_label: string;
  category: string;
  variable_weight: boolean;
  image_reference: string | null;
  unit_price_minor: number | null;
  line_total_minor: number | null;
};

export type CartVendorGroup = {
  cart_vendor_group_id: string;
  vendor_location_id: string;
  fulfilment_method: FulfilmentMethod;
  customer_note: string | null;
  tip_minor: number;
  lifecycle_state: string;
  version: number;
  lines: CartLine[];
  /** The named store (MKT-01) and whether this group can be ordered from. */
  location_name: string;
  minimum_order_minor: number;
  /** Null when any line has no active price — a guessed subtotal is worse than none. */
  subtotal_minor: number | null;
  minimum_met: boolean;
  fulfilment_modes: string[];
  /**
   * False only when the store withdrew `fulfilment_method` after this group
   * chose it. The quote blocks such a group; the repair is one of `fulfilment_modes`.
   */
  fulfilment_method_offered: boolean;
};

export type Cart = {
  cart_id: string;
  /**
   * The address every group in this cart will be quoted against.
   *
   * Null until one is attached. Checkout refuses to quote without it, so the
   * client has to be able to see whether the cart has one.
   */
  customer_address_id: string | null;
  lifecycle_state: string;
  version: number;
  groups: CartVendorGroup[];
};

// ─── Checkout ─────────────────────────────────────────────────────────────────

/**
 * Prepaid methods offered at checkout.
 *
 * Cash on delivery is gated (GAT-01) and absent from this union, the API
 * validator and the database constraint — hiding it in the UI alone would not
 * be a control.
 */
export type PaymentMethod = 'UPI' | 'CARD' | 'WALLET';

export type CheckoutGroupQuote = {
  vendor_location_id: string;
  location_name: string;
  item_minor: number;
  delivery_minor: number;
  tip_minor: number;
  total_minor: number;
  fulfilment_method: string;
  promise: string;
  decision_rule: string;
};

export type CheckoutQuote = {
  checkout_quote_id: string;
  expires_at: string;
  total_minor: number;
  authorization_buffer_minor: number;
  blocked_groups: readonly { vendor_location_id: string; reason_code: string }[];
  groups: readonly CheckoutGroupQuote[];
};

export type VendorOrderSummary = {
  vendor_order_id: string;
  vendor_location_id: string;
  location_name: string;
  order_reference: string;
  lifecycle_state: string;
  total_minor: number;
};

export type CheckoutGroup = {
  checkout_group_id: string;
  lifecycle_state: string;
  total_minor: number;
  orders: readonly VendorOrderSummary[];
};

// ─── Customer Orders ──────────────────────────────────────────────────────────

export type CustomerOrderEntry = {
  vendor_order_id: string;
  vendor_location_id: string;
  location_name: string;
  order_reference: string;
  lifecycle_state: string;
  total_minor: number;
  fulfilment_method: FulfilmentMethod | null;
};

export type CustomerOrderGroup = {
  checkout_group_id: string;
  checkout_reference: string;
  created_at: string;
  /** The projection across children — never a state a child can be set from. */
  lifecycle_state: string;
  total_minor: number;
  vendor_orders: readonly CustomerOrderEntry[];
};

export type CustomerReceiptLine = {
  catalogue_variant_id: string;
  vendor_location_id: string;
  title: string;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
};

export type CustomerRefundEntry = {
  refund_id: string;
  order_reference: string;
  refund_state: string;
  trigger_code: string;
  refund_total_minor: number;
  item_minor: number;
  tax_minor: number;
  delivery_minor: number;
  tip_minor: number;
};

/**
 * The money view of a checkout group. `refunded_total_minor` counts only
 * refunds that are actually in flight or settled, so a proposal a reviewer
 * later rejects never appears as money returned.
 */
export type CheckoutGroupReceipt = {
  checkout_group_id: string;
  checkout_reference: string;
  total_minor: number;
  currency: string;
  lifecycle_state: string;
  orders: readonly {
    order_reference: string;
    vendor_location_id: string;
    total_minor: number;
    state: string;
  }[];
  refunds: readonly CustomerRefundEntry[];
  refunded_total_minor: number;
};

export type CustomerReceipt = {
  order: CustomerOrderEntry;
  lines: readonly CustomerReceiptLine[];
};

// ─── Notifications ────────────────────────────────────────────────────────────

export type InAppNotification = {
  in_app_notification_id: string;
  template_key: string;
  template_payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export type SupportCaseMessage = {
  support_case_message_id: string;
  author_user_id: string;
  body: string;
  created_at: string;
};

export type CustomerSupportCase = {
  support_case_id: string;
  category: string;
  description: string;
  lifecycle_state: string;
  severity?: string;
  response_due_at?: string | null;
  order_reference: string;
  created_at: string;
  updated_at: string;
  messages?: SupportCaseMessage[];
};

// ─── Vendor Finance ───────────────────────────────────────────────────────────

export type VendorSettlementEntry = {
  settlement_id: string;
  reference: string;
  eligible_at: string;
  lifecycle_state: string;
  gross_minor: number;
  platform_fee_minor: number;
  net_minor: number;
};

export type VendorStatement = {
  vendor_location_id: string;
  pending_minor: number;
  eligible_minor: number;
  settled_minor: number;
  settlements: readonly VendorSettlementEntry[];
};

// ─── Vendor ───────────────────────────────────────────────────────────────────

export type VendorOrderLine = {
  catalogue_variant_id: string;
  title: string;
  quantity: number;
  price_minor: number;
};

/** A store's own settings, as its staff may read and edit them (VEN-05, VEN-06, VEN-08). */
export type VendorLocationSettings = {
  vendor_location_id: string;
  location_name: string;
  profile_description: string | null;
  category: string;
  lifecycle_state: string;
  operating_timezone: string;
  preparation_seconds: number | null;
  minimum_order_minor: number;
  currency: string;
  /** Carried back on an edit so a stale write conflicts instead of overwriting. */
  version: number;
  fulfilment_modes: string[];
  hours: OperatingHours[];
};

export type VendorOrder = {
  vendor_order_id: string;
  checkout_group_id: string;
  status: string;
  fulfilment_method: FulfilmentMethod;
  lines: VendorOrderLine[];
  total_minor: number;
  placed_at: string;
};

// ─── Partner ──────────────────────────────────────────────────────────────────

export type AssignmentState =
  | 'OFFERED'
  | 'ASSIGNED'
  | 'AT_VENDOR'
  | 'PICKED_UP'
  | 'EN_ROUTE_TO_CUSTOMER'
  | 'ARRIVED_AT_CUSTOMER'
  | 'DELIVERED'
  | 'FAILED'
  | 'DECLINED'
  | 'OFFER_EXPIRED'
  | 'RETURN_REQUIRED'
  | 'RETURN_IN_PROGRESS'
  | 'RETURNED';

export type DeliveryAssignment = {
  delivery_assignment_id: string;
  source_order_reference: string;
  vendor_location_id: string;
  partner_user_id: string | null;
  assignment_state: AssignmentState;
  custody_state: string;
  package_count: number;
  handling_flags: readonly string[];
  approximate_pickup_area: string;
  approximate_drop_area: string;
  offer_expires_at: string | null;
  version: number;
  /**
   * Route distance and expected earning, present on an offer (DLP-11, DLP-48).
   *
   * Null when the address behind the assignment cannot be resolved, so a card
   * says the amount is unavailable rather than showing a plausible guess.
   */
  route_metres?: number | null;
  expected_earning_minor?: number | null;
};

/**
 * Every partner custody transition is an idempotent, version-checked command.
 * `command_reference` is the idempotency key and `expected_version` is the
 * aggregate version the caller believes it is acting on.
 */
export type AssignmentTransition = {
  command_reference: string;
  expected_version: number;
  reason_code: string;
};

export type PartnerAvailability = {
  partner_user_id: string;
  availability_state: 'ONLINE' | 'OFFLINE' | 'PAUSED';
  trips_today: string;
  earnings_today_minor: string;
};

export type PartnerEarningEntry = {
  partner_earnings_record_id: string;
  reference: string;
  lifecycle_state: string;
  total_minor: number;
  posted_at: string;
};

export type PartnerStatement = {
  pending_minor: number;
  paid_minor: number;
  total_earned_minor: number;
  earnings: readonly PartnerEarningEntry[];
};

// ─── Authentication context ────────────────────────────────────────────────────

export type AuthenticatedRole = {
  role_assignment_id: string;
  role_key: string;
  scope_id: string | null;
  scope_kind: 'GLOBAL' | 'VENDOR_LOCATION' | 'ZONE' | null;
  vendor_location_id: string | null;
};

export type PrimaryWorkspaceRole = 'admin' | 'customer' | 'partner' | 'vendor';

export type WhoAmI = {
  user_id: string;
  session_id: string;
  device_registration_id: string;
  email: string | null;
  roles: readonly AuthenticatedRole[];
  vendor_location_ids: readonly string[];
  primary_role: PrimaryWorkspaceRole;
  redirect_hint: string;
};
