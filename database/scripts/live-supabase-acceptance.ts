import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { loadProductionRuntimeDatabaseConfig } from '../src/config.js';

const baseUrl = process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:3001';
const supabaseUrl = requiredEnvironment('SUPABASE_URL');
const supabaseAnonKey = requiredEnvironment('SUPABASE_ANON_KEY');
const adminEmail = requiredEnvironment('ACCEPTANCE_ADMIN_EMAIL');
const adminPassword = requiredEnvironment('ACCEPTANCE_ADMIN_PASSWORD');
const timeoutMs = Number(process.env['E2E_TIMEOUT_MS'] ?? '120000');

type JsonObject = Record<string, unknown>;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function suffix(length = 10): string {
  return randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length)
    .toLowerCase();
}

function uuidV7(): string {
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

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} did not return an object`);
  }
  return value as JsonObject;
}

function text(value: JsonObject, key: string): string {
  const found = value[key];
  if (typeof found !== 'string' || found.length === 0) {
    throw new Error(`Response field ${key} is missing`);
  }
  return found;
}

function array(value: JsonObject, key: string): readonly unknown[] {
  const found = value[key];
  if (!Array.isArray(found)) throw new Error(`Response field ${key} is missing`);
  return found;
}

let step = 0;
function log(message: string): void {
  step += 1;
  console.log(`step ${step}: ${message}`);
}

async function apiCall(
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

async function supabasePasswordSignIn(email: string, password: string): Promise<string> {
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

async function withDatabase<Result>(work: (client: Client) => Promise<Result>): Promise<Result> {
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

async function customerOtpSignIn(phone: string): Promise<string> {
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

async function pollForOffer(token: string, orderReference: string): Promise<JsonObject> {
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

async function main(): Promise<void> {
  const runId = suffix();
  const coordinateSeed = Number.parseInt(runId.slice(0, 8), 16);
  const latitude = 18 + (coordinateSeed % 6_000) / 1_000;
  const longitude = 73 + (Math.floor(coordinateSeed / 6_000) % 5_000) / 1_000;
  const temporaryPassword = process.env['ACCEPTANCE_TEMPORARY_PASSWORD'] ?? `Accept-${suffix(10)}!`;
  const vendorEmail = `acceptance.vendor.${runId}@example.com`;
  const partnerEmail = `acceptance.partner.${runId}@example.com`;
  const customerPhone = `+919${randomBytes(5).readUIntBE(0, 5).toString().padStart(11, '0').slice(0, 9)}`;
  {
    console.log(`live acceptance run: ${runId}`);
    log('Admin signs in with Supabase email/password');
    const adminToken = await supabasePasswordSignIn(adminEmail, adminPassword);
    const adminWho = object(await apiCall(adminToken, 'GET', '/auth/whoami'), 'Admin whoami');
    if (adminWho['primary_role'] !== 'admin')
      throw new Error('Seeded account did not resolve as admin');

    log('Admin provisions a vendor with a replay-safe command');
    const vendorKey = uuidV7();
    const vendorBody: JsonObject = {
      email: vendorEmail,
      password: temporaryPassword,
      business_name: `SYNTH Acceptance Grocer ${runId}`,
      location_name: `SYNTH Acceptance Store ${runId}`,
      latitude,
      longitude,
      category: 'FRUIT_VEGETABLE',
      minimum_order_minor: 100,
      fulfilment_modes: ['CUSTOMER_PICKUP', 'PLATFORM_DELIVERY'],
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

    log('Admin provisions a delivery partner');
    const partner = object(
      await apiCall(
        adminToken,
        'POST',
        '/admin/onboarding/partners',
        {
          email: partnerEmail,
          password: temporaryPassword,
          display_name: `Acceptance Rider ${runId}`,
        },
        { 'idempotency-key': uuidV7() },
      ),
      'Partner provisioning',
    );
    const partnerUserId = text(partner, 'user_id');

    log('Vendor signs in, resolves its own location, and publishes a stocked product');
    const vendorToken = await supabasePasswordSignIn(vendorEmail, temporaryPassword);
    const vendorWho = object(await apiCall(vendorToken, 'GET', '/auth/whoami'), 'Vendor whoami');
    if (
      vendorWho['primary_role'] !== 'vendor' ||
      !array(vendorWho, 'vendor_location_ids').includes(vendorLocationId)
    ) {
      throw new Error('Vendor identity did not resolve its provisioned location');
    }
    const product = object(
      await apiCall(
        vendorToken,
        'POST',
        `/vendor/locations/${vendorLocationId}/catalogue/products`,
        {
          product_reference: `SYNTH-PROD-ACCEPT-${runId.toUpperCase()}`,
          title: 'SYNTH Fresh tomatoes',
          category: 'FRUIT_VEGETABLE',
          unit_label: 'KG',
          tax_basis: 'INCLUSIVE',
          variable_weight: false,
          permitted_weight_variance_bps: null,
          sku: `SYNTH-SKU-ACCEPT-${runId.toUpperCase()}`,
          variant_title: 'SYNTH Fresh tomatoes',
          price_minor: 8000,
          initial_stock_quantity: 20,
          low_stock_threshold: 3,
        },
      ),
      'Product creation',
    );
    const variantId = text(product, 'catalogue_variant_id');

    log('Partner signs in and goes online near the vendor');
    const partnerToken = await supabasePasswordSignIn(partnerEmail, temporaryPassword);
    const partnerWho = object(await apiCall(partnerToken, 'GET', '/auth/whoami'), 'Partner whoami');
    if (partnerWho['primary_role'] !== 'partner' || partnerWho['user_id'] !== partnerUserId) {
      throw new Error('Partner identity did not resolve its marketplace role');
    }
    await apiCall(partnerToken, 'POST', '/partner/availability', {
      state: 'ONLINE',
      reason_code: 'ACCEPTANCE_READY',
      latitude: latitude + 0.0002,
      longitude: longitude + 0.0002,
      accuracy_meters: 10,
      battery_percent: 90,
    });

    log('Customer signs in with OTP and discovers the published product');
    const customerToken = await customerOtpSignIn(customerPhone);
    await apiCall(customerToken, 'POST', '/auth/customer/enrol');
    const address = object(
      await apiCall(customerToken, 'POST', '/customer/addresses', {
        address_reference: `SYNTH-ADDRESS-ACCEPT-${runId.toUpperCase()}`,
        label: 'SYNTH Home',
        pin_code: '302020',
        latitude: latitude + 0.0005,
        longitude: longitude + 0.0004,
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

    log('Customer adds the product and completes grouped checkout');
    await apiCall(customerToken, 'POST', '/customer/cart/lines', {
      vendor_location_id: vendorLocationId,
      catalogue_variant_id: variantId,
      quantity: 1,
      fulfilment_method: 'PLATFORM_DELIVERY',
      substitution_preference: 'ASK_CUSTOMER',
    });
    await apiCall(customerToken, 'PUT', '/customer/cart/address', {
      customer_address_id: addressId,
    });
    const cart = object(await apiCall(customerToken, 'GET', '/customer/cart'), 'Customer cart');
    const quote = object(
      await apiCall(customerToken, 'POST', '/customer/checkout/quotes', {
        cart_id: text(cart, 'cart_id'),
      }),
      'Checkout quote',
    );
    const checkout = object(
      await apiCall(customerToken, 'POST', '/customer/checkout/groups', {
        checkout_quote_id: text(quote, 'checkout_quote_id'),
        provider_scenario: 'SUCCESS',
        idempotency_key: `accept-${runId}`,
        payment_method: 'UPI',
      }),
      'Grouped checkout',
    );
    const order = object(array(checkout, 'orders')[0], 'Placed order');
    const orderReference = text(order, 'order_reference');
    const vendorOrderId = text(order, 'vendor_order_id');

    log('Worker creates a distinct offer and the partner accepts it');
    const offer = await pollForOffer(partnerToken, orderReference);
    const assignmentId = text(offer, 'delivery_assignment_id');
    if (assignmentId === vendorOrderId) throw new Error('Delivery assignment reused the order ID');
    const accepted = object(
      await apiCall(
        partnerToken,
        'POST',
        `/partner/offers/${assignmentId}/accept`,
        {
          command_reference: `SYNTH-CMD-ACCEPT-${runId.toUpperCase()}`,
          expected_version: offer['version'],
          reason_code: 'PARTNER_ACCEPTED',
        },
        { 'idempotency-key': uuidV7() },
      ),
      'Offer acceptance',
    );
    if (accepted['assignment_state'] !== 'ASSIGNED') throw new Error('Offer was not accepted');

    log('Acceptance invariants are present once under retry-safe processing');
    const invariant = await withDatabase((client) =>
      client.query<{
        assignment_count: string;
        inbox_count: string;
        order_count: string;
        placed_event_count: string;
      }>(
        `SELECT
           (SELECT count(*) FROM marketplace.vendor_orders WHERE vendor_order_id = $1)::text AS order_count,
           (SELECT count(*) FROM marketplace.delivery_assignments WHERE source_order_reference = $2)::text AS assignment_count,
           (SELECT count(*) FROM marketplace.outbox_events WHERE aggregate_id = $1 AND event_type = 'order.placed')::text AS placed_event_count,
           (SELECT count(*) FROM marketplace.inbox_receipts inbox
              JOIN marketplace.outbox_events event ON event.event_id = inbox.event_id
             WHERE event.aggregate_id = $1 AND event.event_type = 'order.placed'
               AND inbox.consumer_scope = 'worker.domain_event')::text AS inbox_count`,
        [vendorOrderId, orderReference],
      ),
    );
    const counts = invariant.rows[0];
    if (!counts || Object.values(counts).some((value) => value !== '1')) {
      throw new Error(`Acceptance invariants failed: ${JSON.stringify(counts)}`);
    }

    console.log(
      JSON.stringify(
        {
          run_id: runId,
          vendor_email: vendorEmail,
          vendor_location_id: vendorLocationId,
          partner_email: partnerEmail,
          partner_user_id: partnerUserId,
          order_reference: orderReference,
          delivery_assignment_id: assignmentId,
          result: 'PASSED',
        },
        null,
        2,
      ),
    );
  }
}

const timer = setTimeout(() => {
  console.error(`Live Supabase acceptance exceeded ${timeoutMs}ms`);
  process.exit(2);
}, timeoutMs);

void main()
  .then(() => {
    clearTimeout(timer);
  })
  .catch((error: unknown) => {
    clearTimeout(timer);
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
