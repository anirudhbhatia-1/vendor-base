import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { loadProductionRuntimeDatabaseConfig } from '../src/config.js';

/**
 * What the live acceptance walks share: the API client, the two ways a
 * person signs in, and the provisioning steps that put a store, a rider and
 * a placed order into a synthetic Supabase project.
 *
 * `live-supabase-acceptance.ts` walks one order through to an accepted offer
 * and checks the retry-safety invariants. `live-supabase-fixtures.ts` uses the
 * same steps to leave data behind for the Playwright journeys instead of
 * consuming it. Both talk only to the API and to Supabase Auth, the way a
 * person would; the one database read is the protected OTP outbox, which is
 * the only way a fake-adapter code can be read at all.
 */
export const baseUrl = process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:3001';
const supabaseUrl = requiredEnvironment('SUPABASE_URL');
const supabaseAnonKey = requiredEnvironment('SUPABASE_ANON_KEY');

export type JsonObject = Record<string, unknown>;

export function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function suffix(length = 10): string {
  return randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length)
    .toLowerCase();
}

export function uuidV7(): string {
  const bytes = randomBytes(16);
  let timestamp = Date.now();
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} did not return an object`);
  }
  return value as JsonObject;
}

export function text(value: JsonObject, key: string): string {
  const found = value[key];
  if (typeof found !== 'string' || found.length === 0) {
    throw new Error(`Response field ${key} is missing`);
  }
  return found;
}

export function integer(value: JsonObject, key: string): number {
  const found = value[key];
  if (typeof found !== 'number' || !Number.isSafeInteger(found)) {
    throw new Error(`Response field ${key} is not an integer`);
  }
  return found;
}

export function array(value: JsonObject, key: string): readonly unknown[] {
  const found = value[key];
  if (!Array.isArray(found)) throw new Error(`Response field ${key} is missing`);
  return found;
}

let step = 0;
/** Progress goes to stderr so a caller that parses stdout sees only the result. */
export function log(message: string): void {
  step += 1;
  console.error(`step ${step}: ${message}`);
}

export async function apiCall(
  token: string | null,
  method: string,
  path: string,
  body?: JsonObject,
  headers: Readonly<Record<string, string>> = {},
): Promise<unknown> {
  const requestHeaders: Record<string, string> = {
    'x-request-id': uuidV7(),
    ...headers,
  };
  if (token) requestHeaders['authorization'] = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { ...requestHeaders, 'content-type': 'application/json' },
        }
      : {}),
  });
  const responseText = await response.text();
  let parsed: unknown = null;
  if (responseText) {
    try {
      parsed = JSON.parse(responseText) as unknown;
    } catch {
      parsed = responseText;
    }
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} failed with HTTP ${response.status}: ${responseText}`);
  }
  return parsed;
}

export async function supabasePasswordSignIn(email: string, password: string): Promise<string> {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: supabaseAnonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const result = object(await response.json(), 'Supabase sign-in');
  if (!response.ok)
    throw new Error(`Supabase sign-in for ${email} failed with HTTP ${response.status}`);
  return text(result, 'access_token');
}

export async function withDatabase<Result>(
  work: (client: Client) => Promise<Result>,
): Promise<Result> {
  const client = new Client({
    connectionString: loadProductionRuntimeDatabaseConfig().connectionString,
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function customerOtpSignIn(phone: string): Promise<string> {
  const deviceId = uuidV7();
  const challenge = object(
    await apiCall(null, 'POST', '/auth/otp/request', {
      device_id: deviceId,
      phone_identifier: phone,
      request_key: `ACCEPT-${suffix(12)}`,
      test_scenario: 'success',
    }),
    'OTP challenge',
  );
  const challengeId = text(challenge, 'challenge_id');
  const code = await withDatabase((client) =>
    client.query<{ otp_code: string }>(
      `SELECT otp_code
         FROM marketplace.otp_protected_test_outbox
        WHERE challenge_id = $1 AND expires_at > clock_timestamp()`,
      [challengeId],
    ),
  );
  if (!code.rows[0])
    throw new Error('Protected OTP acceptance outbox did not contain the challenge');
  const verified = object(
    await apiCall(null, 'POST', '/auth/otp/verify', {
      challenge_id: challengeId,
      code: code.rows[0].otp_code,
      device_id: deviceId,
      platform: 'WEB',
    }),
    'OTP verification',
  );
  return text(object(verified['tokens'], 'OTP tokens'), 'access_token');
}

export async function pollForOffer(token: string, orderReference: string): Promise<JsonObject> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = object(await apiCall(token, 'GET', '/partner/offers'), 'Partner offers');
    const offer = array(result, 'offers')
      .map((entry) => object(entry, 'Partner offer'))
      .find((entry) => entry['source_order_reference'] === orderReference);
    if (offer) return offer;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`No partner offer arrived for ${orderReference}`);
}

/** A synthetic Indian mobile number that no real subscriber can hold. */
export function syntheticCustomerPhone(): string {
  return `+919${randomBytes(5).readUIntBE(0, 5).toString().padStart(11, '0').slice(0, 9)}`;
}

/**
 * One run's identity. The coordinates come from the run id so two concurrent
 * runs land in different neighbourhoods and never share a discovery radius.
 */
export interface AcceptanceRun {
  readonly runId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly temporaryPassword: string;
  readonly vendorEmail: string;
  readonly partnerEmail: string;
}

export function startRun(): AcceptanceRun {
  const runId = suffix();
  const coordinateSeed = Number.parseInt(runId.slice(0, 8), 16);
  return {
    runId,
    latitude: 18 + (coordinateSeed % 6_000) / 1_000,
    longitude: 73 + (Math.floor(coordinateSeed / 6_000) % 5_000) / 1_000,
    temporaryPassword: process.env['ACCEPTANCE_TEMPORARY_PASSWORD'] ?? `Accept-${suffix(10)}!`,
    vendorEmail: `acceptance.vendor.${runId}@example.com`,
    partnerEmail: `acceptance.partner.${runId}@example.com`,
  };
}

export async function adminSignIn(): Promise<string> {
  const adminToken = await supabasePasswordSignIn(
    requiredEnvironment('ACCEPTANCE_ADMIN_EMAIL'),
    requiredEnvironment('ACCEPTANCE_ADMIN_PASSWORD'),
  );
  const adminWho = object(await apiCall(adminToken, 'GET', '/auth/whoami'), 'Admin whoami');
  if (adminWho['primary_role'] !== 'admin')
    throw new Error('Seeded account did not resolve as admin');
  return adminToken;
}

/** Provisions the vendor twice under one key: the replay must return the same location. */
export async function provisionVendor(
  adminToken: string,
  run: AcceptanceRun,
  fulfilmentModes: readonly string[],
): Promise<string> {
  const vendorKey = uuidV7();
  const vendorBody: JsonObject = {
    email: run.vendorEmail,
    password: run.temporaryPassword,
    business_name: `SYNTH Acceptance Grocer ${run.runId}`,
    location_name: `SYNTH Acceptance Store ${run.runId}`,
    latitude: run.latitude,
    longitude: run.longitude,
    category: 'FRUIT_VEGETABLE',
    minimum_order_minor: 100,
    fulfilment_modes: fulfilmentModes,
  };
  const vendor = object(
    await apiCall(adminToken, 'POST', '/admin/onboarding/vendors', vendorBody, {
      'idempotency-key': vendorKey,
    }),
    'Vendor provisioning',
  );
  const vendorReplay = object(
    await apiCall(adminToken, 'POST', '/admin/onboarding/vendors', vendorBody, {
      'idempotency-key': vendorKey,
    }),
    'Vendor provisioning replay',
  );
  const vendorLocationId = text(vendor, 'vendor_location_id');
  if (text(vendorReplay, 'vendor_location_id') !== vendorLocationId) {
    throw new Error('Vendor idempotency replay returned a different location');
  }
  return vendorLocationId;
}

export async function provisionPartner(adminToken: string, run: AcceptanceRun): Promise<string> {
  const partner = object(
    await apiCall(
      adminToken,
      'POST',
      '/admin/onboarding/partners',
      {
        email: run.partnerEmail,
        password: run.temporaryPassword,
        display_name: `Acceptance Rider ${run.runId}`,
      },
      { 'idempotency-key': uuidV7() },
    ),
    'Partner provisioning',
  );
  return text(partner, 'user_id');
}

export async function vendorSignIn(run: AcceptanceRun, vendorLocationId: string): Promise<string> {
  const vendorToken = await supabasePasswordSignIn(run.vendorEmail, run.temporaryPassword);
  const vendorWho = object(await apiCall(vendorToken, 'GET', '/auth/whoami'), 'Vendor whoami');
  if (
    vendorWho['primary_role'] !== 'vendor' ||
    !array(vendorWho, 'vendor_location_ids').includes(vendorLocationId)
  ) {
    throw new Error('Vendor identity did not resolve its provisioned location');
  }
  return vendorToken;
}

export interface PublishedProduct {
  readonly productReference: string;
  readonly variantId: string;
}

export async function publishStockedProduct(
  vendorToken: string,
  run: AcceptanceRun,
  vendorLocationId: string,
): Promise<PublishedProduct> {
  const productReference = `SYNTH-PROD-ACCEPT-${run.runId.toUpperCase()}`;
  const product = object(
    await apiCall(vendorToken, 'POST', `/vendor/locations/${vendorLocationId}/catalogue/products`, {
      product_reference: productReference,
      title: 'SYNTH Fresh tomatoes',
      category: 'FRUIT_VEGETABLE',
      unit_label: 'KG',
      tax_basis: 'INCLUSIVE',
      variable_weight: false,
      permitted_weight_variance_bps: null,
      sku: `SYNTH-SKU-ACCEPT-${run.runId.toUpperCase()}`,
      variant_title: 'SYNTH Fresh tomatoes',
      price_minor: 8000,
      initial_stock_quantity: 20,
      low_stock_threshold: 3,
    }),
    'Product creation',
  );
  return { productReference, variantId: text(product, 'catalogue_variant_id') };
}

export async function partnerSignIn(run: AcceptanceRun, partnerUserId: string): Promise<string> {
  const partnerToken = await supabasePasswordSignIn(run.partnerEmail, run.temporaryPassword);
  const partnerWho = object(await apiCall(partnerToken, 'GET', '/auth/whoami'), 'Partner whoami');
  if (partnerWho['primary_role'] !== 'partner' || partnerWho['user_id'] !== partnerUserId) {
    throw new Error('Partner identity did not resolve its marketplace role');
  }
  return partnerToken;
}

export async function setPartnerAvailability(
  partnerToken: string,
  run: AcceptanceRun,
  state: 'ONLINE' | 'OFFLINE',
): Promise<void> {
  await apiCall(partnerToken, 'POST', '/partner/availability', {
    state,
    reason_code: state === 'ONLINE' ? 'ACCEPTANCE_READY' : 'ACCEPTANCE_PAUSED',
    ...(state === 'ONLINE'
      ? {
          latitude: run.latitude + 0.0002,
          longitude: run.longitude + 0.0002,
          accuracy_meters: 10,
          battery_percent: 90,
        }
      : {}),
  });
}

export interface AcceptanceCustomer {
  readonly token: string;
  readonly addressId: string;
}

/**
 * A customer who signed in with the fake OTP adapter, saved an address a few
 * hundred metres from the store, and can see the store and its product.
 */
export async function enrolCustomer(
  run: AcceptanceRun,
  vendorLocationId: string,
  variantId: string,
): Promise<AcceptanceCustomer> {
  const customerToken = await customerOtpSignIn(syntheticCustomerPhone());
  await apiCall(customerToken, 'POST', '/auth/customer/enrol');
  const address = object(
    await apiCall(customerToken, 'POST', '/customer/addresses', {
      address_reference: `SYNTH-ADDRESS-ACCEPT-${run.runId.toUpperCase()}`,
      label: 'SYNTH Home',
      pin_code: '302020',
      latitude: run.latitude + 0.0005,
      longitude: run.longitude + 0.0004,
      coordinate_source: 'MANUAL_PIN',
      landmark: 'Community park',
      delivery_instructions: 'Call on arrival',
    }),
    'Customer address',
  );
  const addressId = text(address, 'customer_address_id');
  await apiCall(customerToken, 'POST', `/customer/addresses/${addressId}/select`);
  const stores = object(
    await apiCall(
      customerToken,
      'GET',
      `/customer/discovery/stores?customer_address_id=${addressId}`,
    ),
    'Store discovery',
  );
  const storeVisible = array(stores, 'stores')
    .map((entry) => object(entry, 'Discovered store'))
    .some((entry) => entry['vendor_location_id'] === vendorLocationId);
  if (!storeVisible) throw new Error('Provisioned vendor was not visible in customer discovery');
  const storefront = object(
    await apiCall(customerToken, 'GET', `/customer/discovery/stores/${vendorLocationId}`),
    'Storefront',
  );
  const productVisible = array(storefront, 'products')
    .map((entry) => object(entry, 'Discovered product'))
    .some((entry) => entry['catalogue_variant_id'] === variantId && entry['is_stale'] === false);
  if (!productVisible) throw new Error('Published product was missing or stale in discovery');
  return { token: customerToken, addressId };
}

export interface PlacedOrder {
  readonly orderReference: string;
  readonly vendorOrderId: string;
}

/** One line in the cart, a quote, and a successful synthetic UPI payment. */
export async function placeOrder(
  customer: AcceptanceCustomer,
  vendorLocationId: string,
  variantId: string,
  idempotencyKey: string,
): Promise<PlacedOrder> {
  await apiCall(customer.token, 'POST', '/customer/cart/lines', {
    vendor_location_id: vendorLocationId,
    catalogue_variant_id: variantId,
    quantity: 1,
    fulfilment_method: 'PLATFORM_DELIVERY',
    substitution_preference: 'ASK_CUSTOMER',
  });
  await apiCall(customer.token, 'PUT', '/customer/cart/address', {
    customer_address_id: customer.addressId,
  });
  const cart = object(await apiCall(customer.token, 'GET', '/customer/cart'), 'Customer cart');
  const quote = object(
    await apiCall(customer.token, 'POST', '/customer/checkout/quotes', {
      cart_id: text(cart, 'cart_id'),
    }),
    'Checkout quote',
  );
  const checkout = object(
    await apiCall(customer.token, 'POST', '/customer/checkout/groups', {
      checkout_quote_id: text(quote, 'checkout_quote_id'),
      provider_scenario: 'SUCCESS',
      idempotency_key: idempotencyKey,
      payment_method: 'UPI',
    }),
    'Grouped checkout',
  );
  const order = object(array(checkout, 'orders')[0], 'Placed order');
  return {
    orderReference: text(order, 'order_reference'),
    vendorOrderId: text(order, 'vendor_order_id'),
  };
}

export interface VendorOrderView {
  readonly lifecycle_state: string;
  readonly version: number;
}

export async function vendorOrder(
  vendorToken: string,
  vendorLocationId: string,
  vendorOrderId: string,
): Promise<VendorOrderView> {
  const list = object(
    await apiCall(vendorToken, 'GET', `/vendor/locations/${vendorLocationId}/orders`),
    'Vendor orders',
  );
  const found = array(list, 'orders')
    .map((entry) => object(entry, 'Vendor order'))
    .find((entry) => entry['vendor_order_id'] === vendorOrderId);
  if (!found) throw new Error(`Vendor order ${vendorOrderId} is not in the store's list`);
  return { lifecycle_state: text(found, 'lifecycle_state'), version: integer(found, 'version') };
}

export async function vendorStep(
  vendorToken: string,
  vendorLocationId: string,
  vendorOrderId: string,
  action: string,
  body: JsonObject,
): Promise<VendorOrderView> {
  const current = await vendorOrder(vendorToken, vendorLocationId, vendorOrderId);
  const result = object(
    await apiCall(
      vendorToken,
      'POST',
      `/vendor/locations/${vendorLocationId}/orders/${vendorOrderId}/${action}`,
      { expected_version: current.version, ...body },
    ),
    `Vendor ${action}`,
  );
  return { lifecycle_state: text(result, 'lifecycle_state'), version: integer(result, 'version') };
}

export async function acceptOffer(
  partnerToken: string,
  run: AcceptanceRun,
  order: PlacedOrder,
): Promise<{ readonly assignmentId: string; readonly version: number }> {
  const offer = await pollForOffer(partnerToken, order.orderReference);
  const assignmentId = text(offer, 'delivery_assignment_id');
  if (assignmentId === order.vendorOrderId)
    throw new Error('Delivery assignment reused the order ID');
  const accepted = object(
    await apiCall(
      partnerToken,
      'POST',
      `/partner/offers/${assignmentId}/accept`,
      {
        command_reference: `SYNTH-CMD-ACCEPT-${run.runId.toUpperCase()}`,
        expected_version: offer['version'],
        reason_code: 'PARTNER_ACCEPTED',
      },
      { 'idempotency-key': uuidV7() },
    ),
    'Offer acceptance',
  );
  if (accepted['assignment_state'] !== 'ASSIGNED') throw new Error('Offer was not accepted');
  return { assignmentId, version: integer(accepted, 'version') };
}

/** Runs a walk under a wall-clock limit and reports its outcome through the exit code. */
export function runWalk(name: string, work: () => Promise<void>, defaultTimeoutMs = 120_000): void {
  const timeoutMs = Number(process.env['E2E_TIMEOUT_MS'] ?? defaultTimeoutMs);
  const timer = setTimeout(() => {
    console.error(`${name} exceeded ${timeoutMs}ms`);
    process.exit(2);
  }, timeoutMs);
  void work()
    .then(() => {
      clearTimeout(timer);
    })
    .catch((error: unknown) => {
      clearTimeout(timer);
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
