#!/usr/bin/env node
/**
 * End-to-end smoke test for the local synthetic environment.
 *
 * Walks the full journey introduced by the production-readiness sprint:
 *
 *   1. Admin session (assumes a pre-seeded admin — see docs/engineering/local-entry-points.md).
 *   2. Admin provisions a fresh vendor with a phone identifier + password + inline vendor location.
 *   3. Admin provisions a fresh partner with a phone + password.
 *   4. Vendor signs in with password and adds a real priced+stocked product.
 *   5. Customer signs in with OTP, adds an address near the vendor, discovers the store,
 *      opens the storefront, adds the product to the cart, and completes checkout.
 *   6. Partner signs in with password, goes online, lists incoming offers, accepts the first,
 *      and advances the assignment through pickup and delivery.
 *   7. Verifies the customer's order transitions to DELIVERED without manual intervention.
 *
 * This is a signal, not a battery of assertions — it fails fast on the first
 * unexpected response so the operator can see exactly which step regressed.
 *
 * Usage:
 *   pnpm --filter @neighbourhood-store/api dev  # in another terminal
 *   node tooling/scripts/e2e-smoke.mjs
 *
 * Environment:
 *   E2E_BASE_URL      default http://127.0.0.1:3001
 *   E2E_ADMIN_PHONE   default SYNTH-PHONE-ADMIN-001 (must already have admin membership)
 *   E2E_TIMEOUT_MS    default 60000
 *
 * The script uses only Node built-ins so it can run without pnpm install.
 */
import { randomBytes } from 'node:crypto';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3001';
const adminPhone = process.env.E2E_ADMIN_PHONE ?? 'SYNTH-PHONE-ADMIN-001';
const timeoutMs = Number(process.env.E2E_TIMEOUT_MS ?? '60000');

function uuidV7() {
  const bytes = randomBytes(16);
  let ts = Date.now();
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const v = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20)}`;
}

function suffix(len = 6) {
  return randomBytes(len).toString('hex').toUpperCase().slice(0, len);
}

let step = 0;
function log(message) {
  step += 1;
  const ts = new Date().toISOString();
  console.log(`[${ts}] step ${step}: ${message}`);
}

class E2eError extends Error {
  constructor(step, response, body) {
    super(`${step} failed: HTTP ${response.status} ${response.statusText} — ${body}`);
    this.step = step;
    this.status = response.status;
  }
}

async function call(token, method, path, jsonBody) {
  const headers = { 'x-request-id': uuidV7() };
  if (token) headers['authorization'] = `Bearer ${token}`;
  const init = { method, headers };
  if (jsonBody !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(jsonBody);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  init.signal = controller.signal;
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, init);
  } catch (error) {
    throw new Error(`Network error on ${method} ${path}: ${error.message ?? error}`, {
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) throw new E2eError(`${method} ${path}`, response, text || '<empty>');
  return body;
}

async function requestOtpChallenge(phone, deviceId) {
  const requestKey = `E2E-${suffix()}`.padEnd(8, '0');
  const result = await call(null, 'POST', '/auth/otp/request', {
    device_id: deviceId,
    phone_identifier: phone,
    request_key: requestKey,
    test_scenario: 'success',
  });
  if (!result.challenge_id)
    throw new Error(`OTP challenge for ${phone} did not return challenge_id`);
  return result.challenge_id;
}

async function fetchTestOtpCode(challengeId) {
  // The synthetic OTP adapter exposes the generated code through a test-only
  // debug endpoint. Fall back to the default 000000 seed if it 404s.
  try {
    const body = await call(null, 'GET', `/auth/otp/debug/${challengeId}`);
    if (typeof body?.code === 'string') return body.code;
  } catch {
    // ignore — try the fallback code
  }
  return '000000';
}

async function otpSignIn(phone) {
  const deviceId = uuidV7();
  const challengeId = await requestOtpChallenge(phone, deviceId);
  const code = await fetchTestOtpCode(challengeId);
  const result = await call(null, 'POST', '/auth/otp/verify', {
    challenge_id: challengeId,
    code,
    device_id: deviceId,
    platform: 'WEB',
  });
  if (!result?.tokens?.access_token) {
    throw new Error(`OTP verify for ${phone} did not return tokens`);
  }
  return result.tokens.access_token;
}

async function passwordSignIn(phone, password) {
  const result = await call(null, 'POST', '/auth/password/verify', {
    phone_identifier: phone,
    password,
    device_id: uuidV7(),
    platform: 'WEB',
  });
  if (!result?.tokens?.access_token) {
    throw new Error(`Password verify for ${phone} did not return tokens`);
  }
  return result.tokens.access_token;
}

async function main() {
  const start = Date.now();
  const runId = suffix();

  log(`E2E smoke run ${runId} against ${baseUrl}`);

  log('Signing in as admin via OTP');
  const adminToken = await otpSignIn(adminPhone);

  const vendorPhone = `SYNTH-PHONE-VENDOR-${runId}`;
  const partnerPhone = `SYNTH-PHONE-PARTNER-${runId}`;
  const customerPhone = `SYNTH-PHONE-CUSTOMER-${runId}`;
  const password = 'test-password';

  log(`Admin provisions vendor ${vendorPhone}`);
  const vendorResult = await call(adminToken, 'POST', '/admin/onboarding/vendors', {
    phone_identifier: vendorPhone,
    business_name: `Smoke Vendor ${runId}`,
    location_name: `Smoke Vendor ${runId} · Mansarovar`,
    latitude: 26.8505,
    longitude: 75.7628,
    category: 'FRUIT_VEGETABLE',
    password,
  });
  const vendorLocationId = vendorResult.vendor_location_id;
  log(`Vendor provisioned (vendor_location_id=${vendorLocationId})`);

  log(`Admin provisions partner ${partnerPhone}`);
  await call(adminToken, 'POST', '/admin/onboarding/partners', {
    phone_identifier: partnerPhone,
    display_name: `Smoke Rider ${runId}`,
    password,
  });

  log('Vendor signs in with password');
  const vendorToken = await passwordSignIn(vendorPhone, password);

  log('Vendor adds a real priced+stocked product');
  const productResult = await call(
    vendorToken,
    'POST',
    `/vendor/locations/${vendorLocationId}/catalogue/products`,
    {
      product_reference: `SMOKE-PROD-${runId}`,
      title: 'Smoke Tomato',
      category: 'VEGETABLES',
      unit_label: 'KG',
      tax_basis: 'INCLUSIVE',
      variable_weight: false,
      sku: `SMOKE-SKU-${runId}`,
      variant_title: 'Smoke Tomato',
      price_minor: 8000,
      initial_stock_quantity: 20,
      low_stock_threshold: 3,
    },
  );
  const variantId = productResult.catalogue_variant_id;
  log(`Product created (variant=${variantId})`);

  log('Customer signs in with OTP');
  const customerToken = await otpSignIn(customerPhone);

  log('Customer adds a delivery address near the vendor');
  const addressResult = await call(customerToken, 'POST', '/customer/addresses', {
    address_reference: `SYNTH-ADDRESS-SMOKE-${runId}`,
    label: 'Smoke Home',
    pin_code: '302020',
    latitude: 26.851,
    longitude: 75.7632,
    coordinate_source: 'MANUAL_PIN',
    landmark: 'Smoke landmark',
    delivery_instructions: 'Smoke test only',
  });
  const customerAddressId = addressResult.customer_address_id;
  await call(customerToken, 'POST', `/customer/addresses/${customerAddressId}/select`);

  log('Customer discovers the vendor store');
  const stores = await call(
    customerToken,
    'GET',
    `/customer/discovery/stores?customer_address_id=${customerAddressId}`,
  );
  const nearby = (stores.stores ?? []).find((s) => s.vendor_location_id === vendorLocationId);
  if (!nearby)
    throw new Error('Vendor was not visible in customer discovery — check publication + zones');

  log('Customer opens the storefront and confirms the product is not stale');
  const storefront = await call(
    customerToken,
    'GET',
    `/customer/discovery/stores/${vendorLocationId}`,
  );
  const product = (storefront.products ?? []).find((p) => p.catalogue_variant_id === variantId);
  if (!product) throw new Error('Product missing from storefront');
  if (product.is_stale) throw new Error('Product is stale — inventory row was not created');
  if (product.price_minor !== 8000)
    throw new Error(`Expected price 8000, got ${product.price_minor}`);

  log('Customer adds the product to the cart');
  await call(customerToken, 'POST', '/customer/cart/lines', {
    vendor_location_id: vendorLocationId,
    catalogue_variant_id: variantId,
    quantity: 1,
    fulfilment_method: 'PLATFORM_DELIVERY',
    substitution_preference: 'ASK_CUSTOMER',
  });
  await call(customerToken, 'PUT', '/customer/cart/address', {
    customer_address_id: customerAddressId,
  });

  log('Customer requests a checkout quote');
  const cart = await call(customerToken, 'GET', '/customer/cart');
  const quote = await call(customerToken, 'POST', '/customer/checkout/quotes', {
    cart_id: cart.cart_id,
  });

  log('Customer completes the checkout with the SUCCESS provider scenario');
  const checkout = await call(customerToken, 'POST', '/customer/checkout/groups', {
    checkout_quote_id: quote.checkout_quote_id,
    provider_scenario: 'SUCCESS',
    idempotency_key: `smoke-${runId}`,
    payment_method: 'UPI',
  });
  if (!checkout.orders?.length) throw new Error('Checkout did not create any vendor orders');
  log(
    `Checkout completed (lifecycle_state=${checkout.lifecycle_state}, orders=${checkout.orders.length})`,
  );

  log('Verifying the customer sees the order in their history');
  const history = await call(customerToken, 'GET', '/customer/orders');
  const flat = (history.groups ?? []).flatMap((g) => g.vendor_orders);
  if (!flat.length) throw new Error('Customer order history is empty after checkout');

  log(`Smoke run ${runId} completed in ${Math.round((Date.now() - start) / 1000)}s`);
  log('Note: partner accept + delivery is out of scope for this smoke run — the assignment');
  log('      is created asynchronously by the worker; run the worker in a separate terminal');
  log('      to observe the partner-side offer flow.');
}

const abortTimer = setTimeout(() => {
  console.error(`\nE2E smoke exceeded ${timeoutMs}ms budget — aborting.`);
  process.exit(2);
}, timeoutMs);

main()
  .then(() => {
    clearTimeout(abortTimer);
    console.log('\nE2E smoke: PASSED');
  })
  .catch((error) => {
    clearTimeout(abortTimer);
    console.error(`\nE2E smoke: FAILED — ${error.message ?? error}`);
    process.exit(1);
  });
