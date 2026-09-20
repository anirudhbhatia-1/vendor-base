import { expect, test } from '@playwright/test';
import { createDatabasePool } from '../database/src/database-pool.js';
import { loadProductionRuntimeDatabaseConfig } from '../database/src/config.js';

async function readProtectedOtp(challengeId: string): Promise<string> {
  const pool = createDatabasePool({
    connectionString: loadProductionRuntimeDatabaseConfig().connectionString,
    max: 1,
  });
  try {
    const result = await pool.query<{ otp_code: string }>(
      `SELECT otp_code
         FROM marketplace.otp_protected_test_outbox
        WHERE challenge_id = $1 AND expires_at > clock_timestamp()`,
      [challengeId],
    );
    const code = result.rows[0]?.otp_code;
    if (!code) throw new Error('Protected OTP acceptance outbox did not contain the challenge');
    return code;
  } finally {
    await pool.end();
  }
}

async function vendorCoordinates(vendorLocationId: string): Promise<{
  readonly latitude: number;
  readonly longitude: number;
}> {
  const pool = createDatabasePool({
    connectionString: loadProductionRuntimeDatabaseConfig().connectionString,
    max: 1,
  });
  try {
    const result = await pool.query<{ latitude: string; longitude: string }>(
      `SELECT ST_Y(coordinates::geometry)::text AS latitude,
              ST_X(coordinates::geometry)::text AS longitude
         FROM marketplace.vendor_locations
        WHERE vendor_location_id = $1 AND lifecycle_state = 'ACTIVE'`,
      [vendorLocationId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Acceptance vendor location is not active');
    return { latitude: Number(row.latitude), longitude: Number(row.longitude) };
  } finally {
    await pool.end();
  }
}

test.describe('Supabase-backed marketplace acceptance', () => {
  test.skip(
    process.env.LIVE_SUPABASE_ACCEPTANCE !== 'true',
    'Set LIVE_SUPABASE_ACCEPTANCE=true with configured API, worker, database, and role credentials.',
  );

  test('admin can sign in through Supabase', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'admin-pwa', 'Admin PWA project only');
    const email = process.env.ACCEPTANCE_ADMIN_EMAIL;
    const password = process.env.ACCEPTANCE_ADMIN_PASSWORD;
    test.skip(!email || !password, 'Admin acceptance credentials are required');
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email ?? '');
    await page.getByLabel(/password/i).fill(password ?? '');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.reload();
    await expect(page).not.toHaveURL(/\/login$/);
    // Asserted against the shell's structure rather than its copy. The previous
    // assertion named the heading "Authenticated control room", which no longer
    // exists -- the root heading is marketing copy and had already been rewritten
    // once. A landmark and the session controls are what "signed in as an admin"
    // actually means.
    await expect(page.getByRole('navigation', { name: 'Admin modules' })).toBeVisible();
    await expect(page.getByText('Secure session')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('customer signs in with OTP and completes grouped checkout', async ({
    context,
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'customer-pwa', 'Customer PWA project only');
    const vendorLocationId = process.env.ACCEPTANCE_VENDOR_LOCATION_ID;
    test.skip(!vendorLocationId, 'ACCEPTANCE_VENDOR_LOCATION_ID is required');

    const coordinates = await vendorCoordinates(vendorLocationId ?? '');
    await context.grantPermissions(['geolocation'], { origin: 'http://localhost:3100' });
    await context.setGeolocation({
      latitude: coordinates.latitude + 0.0005,
      longitude: coordinates.longitude + 0.0004,
    });

    const phone = `+919${Date.now().toString().slice(-9)}`;
    await page.goto('/login');
    await page.getByLabel(/mobile number/i).fill(phone);
    // The browser talks to the BFF, not the API. OTP request moved behind
    // `/api/session/otp/request` so the session cookie is issued server-side; the
    // upstream `/auth/otp/request` call happens inside that route and never
    // appears as a browser response. Waiting on the old URL matched nothing and
    // would have hung until the test timed out -- invisible because this suite is
    // opt-in and had not been run since the move.
    const otpResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/session/otp/request' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /send verification code/i }).click();
    const challenge = (await (await otpResponse).json()) as { readonly challenge_id?: unknown };
    if (typeof challenge.challenge_id !== 'string') {
      throw new Error('OTP request did not return a challenge ID');
    }
    await page
      .getByLabel(/six-digit verification code/i)
      .fill(await readProtectedOtp(challenge.challenge_id));
    await page.getByRole('button', { name: /verify code/i }).click();
    await expect(page).toHaveURL(/\/$/);

    // Customer OTP sessions are tab-scoped by design and must survive refresh.
    await page.reload();
    await expect(page).not.toHaveURL(/\/login/);
    // The delivery point is chosen on the map (D-17); the device position the
    // test granted above is what "use my current location" places the pin at.
    await page.getByRole('button', { name: /use my current location/i }).click();
    await expect(page.getByText(/Delivery point:/)).not.toContainText('—');
    await page.getByRole('button', { name: /save and find stores/i }).click();
    await expect(page.getByRole('button', { name: /see nearby stores/i })).toBeVisible();
    await page.getByRole('button', { name: /see nearby stores/i }).click();
    await expect(
      page.getByRole('heading', { name: /available from this store/i }).first(),
    ).toBeVisible();
    const addPublishedItem = page.getByRole('button', { name: /^Add .+ from .+$/ }).first();
    await expect(addPublishedItem).toBeVisible();
    await addPublishedItem.click();
    await expect(page.getByText(/added\. The store group remains isolated\./i)).toBeVisible();
    await expect(page.getByRole('link', { name: /go to checkout/i })).toBeVisible();
    await page.getByRole('link', { name: /go to checkout/i }).click();
    await page.getByRole('button', { name: /load my active cart/i }).click();
    await page.getByRole('button', { name: /quote and hold stock/i }).click();
    await expect(page.getByRole('button', { name: /pay and place order/i })).toBeVisible();
    await page.getByRole('button', { name: /pay and place order/i }).click();
    await expect(page.getByText('ORDER PLACED', { exact: true })).toBeVisible();
    await expect(page.getByText('1 store orders', { exact: true })).toBeVisible();
  });
});
