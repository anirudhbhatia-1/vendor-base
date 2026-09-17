import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, createApiClient, createRawRequester, passwordSignIn } from './client.js';

type FetchInit = {
  method?: string;
  headers: Record<string, string>;
  body?: string;
};

test('customer OTP client requests transactional enrolment with the actual client platform', async () => {
  const { captures, restore } = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ tokens: null }),
  });
  try {
    const client = createApiClient({ baseUrl: 'http://api.test', getToken: () => null });
    await client.auth.verifyCustomerOtp({
      challenge_id: 'challenge',
      code: '123456',
      device_id: 'device',
      platform: 'ANDROID',
    });
    assert.equal(captures[0]?.url, 'http://api.test/auth/otp/verify');
    assert.deepEqual(JSON.parse(captures[0]?.init.body ?? '{}'), {
      challenge_id: 'challenge',
      code: '123456',
      device_id: 'device',
      platform: 'ANDROID',
      customer_enrolment: true,
    });
    await client.auth.verifyOtp({ challenge_id: 'challenge', code: '123456', device_id: 'device' });
    assert.equal(JSON.parse(captures[1]?.init.body ?? '{}').customer_enrolment, undefined);
  } finally {
    restore();
  }
});

type MockResult = {
  captures: Array<{ url: string; init: FetchInit }>;
  restore: () => void;
};

function mockFetch(response: {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}): MockResult {
  const captures: Array<{ url: string; init: FetchInit }> = [];
  const original = globalThis.fetch;
  // @ts-expect-error — test double replaces global fetch
  globalThis.fetch = async (url: string, init: FetchInit) => {
    captures.push({ url, init });
    return response;
  };
  return {
    captures,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test('injects Bearer token from getToken into every request', async () => {
  const { captures, restore } = mockFetch({ ok: true, status: 200, json: async () => ({}) });
  try {
    await createApiClient({
      baseUrl: 'http://api.test',
      getToken: () => 'tok-abc',
    }).auth.customerPreferences();
    assert.equal(captures.length, 1);
    assert.equal(captures[0]?.init.headers['authorization'], 'Bearer tok-abc');
  } finally {
    restore();
  }
});

test('omits Authorization header when getToken returns null', async () => {
  const { captures, restore } = mockFetch({ ok: true, status: 200, json: async () => ({}) });
  try {
    await createApiClient({
      baseUrl: 'http://api.test',
      getToken: () => null,
    }).auth.customerPreferences();
    assert.equal(captures[0]?.init.headers['authorization'], undefined);
  } finally {
    restore();
  }
});

test('attaches a unique x-request-id UUID on every request', async () => {
  const { captures, restore } = mockFetch({ ok: true, status: 200, json: async () => ({}) });
  try {
    const client = createApiClient({ baseUrl: 'http://api.test', getToken: () => null });
    await Promise.all([
      client.auth.customerPreferences(),
      client.auth.customerPreferences(),
      client.auth.customerPreferences(),
    ]);
    const ids = captures.map((c) => c.init.headers['x-request-id'] ?? '');
    const unique = new Set(ids);
    assert.equal(unique.size, 3, 'each request must carry a distinct x-request-id');
    for (const id of unique) {
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    }
  } finally {
    restore();
  }
});

test('throws ApiError with the server status on a 4xx response', async () => {
  const { restore } = mockFetch({
    ok: false,
    status: 404,
    json: async () => ({ message: 'not found' }),
  });
  try {
    await assert.rejects(
      () =>
        createApiClient({
          baseUrl: 'http://api.test',
          getToken: () => null,
        }).auth.customerPreferences(),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 404);
        assert.match(err.message, /not found/i);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('throws ApiError on 5xx with a fallback message when the body is not JSON', async () => {
  const { restore } = mockFetch({
    ok: false,
    status: 503,
    json: async () => {
      throw new Error('not json');
    },
  });
  try {
    await assert.rejects(
      () =>
        createApiClient({
          baseUrl: 'http://api.test',
          getToken: () => null,
        }).auth.customerPreferences(),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 503);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('returns null for 204 No Content without attempting JSON parse', async () => {
  let jsonCalled = false;
  const original = globalThis.fetch;
  // @ts-expect-error — test double
  globalThis.fetch = async () => ({
    ok: true,
    status: 204,
    json: async () => {
      jsonCalled = true;
      return null;
    },
  });
  try {
    const result = await createRawRequester({ baseUrl: 'http://api.test', getToken: () => null })(
      '/some/path',
      { method: 'DELETE' },
    );
    assert.equal(result, null);
    assert.equal(jsonCalled, false);
  } finally {
    globalThis.fetch = original;
  }
});

test('serializes the json option to a JSON body with content-type header', async () => {
  const { captures, restore } = mockFetch({ ok: true, status: 200, json: async () => ({}) });
  try {
    await createRawRequester({ baseUrl: 'http://api.test', getToken: () => null })('/items', {
      method: 'POST',
      json: { quantity: 3 },
    });
    assert.equal(captures[0]?.init.body, JSON.stringify({ quantity: 3 }));
    assert.equal(captures[0]?.init.headers['content-type'], 'application/json');
  } finally {
    restore();
  }
});

test('admin.onboarding.createVendor posts to the admin onboarding route', async () => {
  const { captures, restore } = mockFetch({
    ok: true,
    status: 201,
    json: async () => ({
      user_id: 'uid',
      vendor_id: 'vid',
      vendor_location_id: 'vloc',
      role_assignment_id: 'rid',
      password_set: true,
    }),
  });
  try {
    const result = await createApiClient({
      baseUrl: 'http://api.test',
      getToken: () => 'admin-tok',
    }).admin.onboarding.createVendor({
      phone_identifier: 'SYNTH-PHONE-VENDOR-1',
      business_name: 'X',
      location_name: 'Y',
      latitude: 26.85,
      longitude: 75.76,
      password: 'test-pass',
    });
    assert.equal(captures[0]?.url, 'http://api.test/admin/onboarding/vendors');
    assert.equal(captures[0]?.init.method, 'POST');
    assert.equal(result.password_set, true);
  } finally {
    restore();
  }
});

test('admin.onboarding.createPartner posts to the admin onboarding route', async () => {
  const { captures, restore } = mockFetch({
    ok: true,
    status: 201,
    json: async () => ({ user_id: 'uid', role_assignment_id: 'rid', password_set: false }),
  });
  try {
    const result = await createApiClient({
      baseUrl: 'http://api.test',
      getToken: () => 't',
    }).admin.onboarding.createPartner({
      phone_identifier: 'SYNTH-PHONE-PARTNER-1',
      display_name: 'Rider',
    });
    assert.equal(captures[0]?.url, 'http://api.test/admin/onboarding/partners');
    assert.equal(result.password_set, false);
  } finally {
    restore();
  }
});

test('passwordSignIn posts to /auth/password/verify with the platform in body', async () => {
  const { captures, restore } = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({
      tokens: {
        access_token: 'nsa_x',
        access_expires_at: '2100-01-01T00:00:00Z',
        refresh_token: 'nsr_x',
        refresh_expires_at: '2100-02-01T00:00:00Z',
        session_id: 'sid',
        user_id: 'uid',
      },
    }),
  });
  try {
    const result = await passwordSignIn(
      { baseUrl: 'http://api.test', getToken: () => null },
      {
        phone_identifier: 'SYNTH-PHONE-VENDOR-1',
        password: 'test-pass',
        device_id: 'dev-1',
        platform: 'WEB',
      },
    );
    assert.equal(captures[0]?.url, 'http://api.test/auth/password/verify');
    const body = JSON.parse(captures[0]?.init.body ?? '{}') as { platform?: string };
    assert.equal(body.platform, 'WEB');
    assert.equal(result.tokens.access_token, 'nsa_x');
  } finally {
    restore();
  }
});

test('partner.offers issues a GET to /partner/offers', async () => {
  const { captures, restore } = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ offers: [] }),
  });
  try {
    const result = await createApiClient({
      baseUrl: 'http://api.test',
      getToken: () => 't',
    }).partner.offers();
    assert.equal(captures[0]?.url, 'http://api.test/partner/offers');
    assert.deepEqual(result.offers, []);
  } finally {
    restore();
  }
});

test('decisions.pending issues a GET to /customer/decisions/pending', async () => {
  const { captures, restore } = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ decisions: [] }),
  });
  try {
    const result = await createApiClient({
      baseUrl: 'http://api.test',
      getToken: () => 't',
    }).decisions.pending();
    assert.equal(captures[0]?.url, 'http://api.test/customer/decisions/pending');
    assert.deepEqual(result.decisions, []);
  } finally {
    restore();
  }
});

test('discovery.categories issues a GET to /customer/discovery/categories', async () => {
  const { captures, restore } = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ categories: [] }),
  });
  try {
    const result = await createApiClient({
      baseUrl: 'http://api.test',
      getToken: () => 't',
    }).discovery.categories();
    assert.equal(captures[0]?.url, 'http://api.test/customer/discovery/categories');
    assert.deepEqual(result.categories, []);
  } finally {
    restore();
  }
});

test('vendor.catalogue.createProduct posts to the vendor-scoped catalogue route', async () => {
  const { captures, restore } = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({
      catalogue_product_id: 'p',
      catalogue_variant_id: 'v',
      version: 1,
    }),
  });
  try {
    await createApiClient({
      baseUrl: 'http://api.test',
      getToken: () => 't',
    }).vendor.catalogue.createProduct('vloc-1', {
      product_reference: 'PROD-XYZ',
      title: 'Tomato',
      category: 'VEGETABLES',
      unit_label: 'KG',
      tax_basis: 'INCLUSIVE',
      variable_weight: false,
      sku: 'SKU-XYZ',
      variant_title: 'Tomato',
      price_minor: 8000,
      initial_stock_quantity: 20,
    });
    assert.equal(captures[0]?.url, 'http://api.test/vendor/locations/vloc-1/catalogue/products');
    assert.equal(captures[0]?.init.method, 'POST');
    const body = JSON.parse(captures[0]?.init.body ?? '{}') as { initial_stock_quantity?: number };
    assert.equal(body.initial_stock_quantity, 20);
  } finally {
    restore();
  }
});

test('vendor.catalogue.setVariantPrice PUTs to the variant price route', async () => {
  const { captures, restore } = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ catalogue_price_id: 'p' }),
  });
  try {
    await createApiClient({
      baseUrl: 'http://api.test',
      getToken: () => 't',
    }).vendor.catalogue.setVariantPrice('vloc-1', 'var-1', { price_minor: 9500 });
    assert.equal(
      captures[0]?.url,
      'http://api.test/vendor/locations/vloc-1/catalogue/products/variants/var-1/price',
    );
    assert.equal(captures[0]?.init.method, 'PUT');
  } finally {
    restore();
  }
});

/**
 * Path regressions.
 *
 * Whole namespaces of this client addressed routes the API does not serve, so
 * calls 404ed while every layer type-checked. `tooling/scripts/verify-api-contracts.mjs`
 * now diffs the declared paths against the controllers; these assertions pin the
 * specific paths that were wrong.
 */
test('vendor fulfilment addresses the location-scoped order routes', async () => {
  const { captures, restore } = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ orders: [] }),
  });
  try {
    const client = createApiClient({ baseUrl: 'http://api.test', getToken: () => 't' });
    await client.vendor.fulfilment.pendingOrders('loc-1');
    await client.vendor.fulfilment.accept('loc-1', 'order-1', { expected_version: 1 });
    assert.equal(captures[0]?.url, 'http://api.test/vendor/locations/loc-1/orders');
    assert.equal(captures[1]?.url, 'http://api.test/vendor/locations/loc-1/orders/order-1/accept');
  } finally {
    restore();
  }
});

test('partner custody addresses the offer and assignment routes the API serves', async () => {
  const { captures, restore } = mockFetch({ ok: true, status: 200, json: async () => ({}) });
  try {
    const client = createApiClient({ baseUrl: 'http://api.test', getToken: () => 't' });
    const transition = { command_reference: 'C', expected_version: 1, reason_code: 'R' };
    await client.partner.assignments.accept('a-1', transition);
    await client.partner.assignments.confirmPickup('a-1', {
      ...transition,
      package_count: 1,
      proof_reference: 'P',
      vendor_confirmed: true,
    });
    await client.partner.assignments.deliver('a-1', {
      ...transition,
      otp: '123456',
      proof_reference: 'P',
    });
    await client.partner.availability.set({ state: 'OFFLINE', reason_code: 'PARTNER_OFFLINE' });
    await client.partner.earnings.list();
    assert.deepEqual(
      captures.map((capture) => capture.url),
      [
        'http://api.test/partner/offers/a-1/accept',
        'http://api.test/partner/assignments/a-1/pickup',
        'http://api.test/partner/assignments/a-1/deliver',
        'http://api.test/partner/availability',
        'http://api.test/partner/earnings',
      ],
    );
  } finally {
    restore();
  }
});

test('vendor inventory addresses the inventory item routes', async () => {
  const { captures, restore } = mockFetch({ ok: true, status: 200, json: async () => ({}) });
  try {
    const client = createApiClient({ baseUrl: 'http://api.test', getToken: () => 't' });
    await client.vendor.inventory.list('loc-1');
    await client.vendor.inventory.setStock('loc-1', 'item-1', {
      exact_available_quantity: 4,
      expected_version: 1,
      low_stock_threshold: 1,
      reason_code: 'COUNTED',
    });
    assert.deepEqual(
      captures.map((capture) => capture.url),
      [
        'http://api.test/vendor/locations/loc-1/inventory',
        'http://api.test/vendor/locations/loc-1/inventory/item-1/stock',
      ],
    );
  } finally {
    restore();
  }
});

/**
 * The API returns the rotated tokens directly. Typing this response as
 * `{ tokens }` made every refreshed session look empty, so the customer PWA
 * cleared its session 30 seconds before the access token expired — signing the
 * customer out on the first refresh, every time.
 */
test('session refresh resolves to the tokens themselves, not a wrapper', async () => {
  const rotated = {
    access_expires_at: '2026-08-30T00:00:00.000Z',
    access_token: 'new-access',
    refresh_expires_at: '2026-09-30T00:00:00.000Z',
    refresh_token: 'new-refresh',
    session_id: 'session-1',
    user_id: 'user-1',
  };
  const { restore } = mockFetch({ ok: true, status: 200, json: async () => rotated });
  try {
    const client = createApiClient({ baseUrl: 'http://api.test', getToken: () => null });
    const result = await client.auth.refresh('old-refresh');
    assert.equal(result.access_token, 'new-access');
    assert.equal(result.refresh_token, 'new-refresh');
  } finally {
    restore();
  }
});

/**
 * The delivery route has required the customer's OTP (CUS-56) since the control
 * landed, but this type omitted it — so a client using the SDK could not send
 * it, and the partner Android app, which did not, was rejected on every single
 * delivery. Asserting the body reaches the wire keeps the two in step.
 */
test('completing a delivery carries the customer OTP to the server', async () => {
  const { captures, restore } = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ delivery_assignment_id: 'assignment-1' }),
  });
  try {
    const client = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'token' });
    await client.partner.assignments.deliver('assignment-1', {
      command_reference: 'SYNTH-CMD-DELIVER-0001',
      expected_version: 4,
      otp: '123456',
      proof_reference: 'SYNTH-PROOF-DELIVERY-0001',
      reason_code: 'PARTNER_CONFIRMED',
    });
    const sent = JSON.parse(String(captures[0]?.init?.body)) as Record<string, unknown>;
    assert.equal(sent['otp'], '123456');
    assert.equal(sent['proof_reference'], 'SYNTH-PROOF-DELIVERY-0001');
  } finally {
    restore();
  }
});
