import { expect, test } from '@playwright/test';
import { supabaseConfigured } from '../playwright.config';

/**
 * These specs cover route protection, so what they prove depends on how the
 * build under test is configured. With no Supabase environment the PWA proxies
 * redirect everything to /login through their "not configured" branch — which
 * looks identical to a working auth gate but authenticates nobody. The
 * configured run is the one that actually exercises the gate.
 */
test('each PWA exposes exactly its intended unauthenticated entry path', async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  if (project === 'customer-pwa') {
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    // A signed-out visitor lands on the location gate, not the product feed: the
    // feed cannot say what is available until it knows where the visitor is. This
    // asserted the feed heading, which is only reached after an address is set.
    await expect(page.getByRole('heading', { name: /Where are you shopping from/i })).toBeVisible();

    // `/cart` is deliberately public -- `proxy.ts` keeps it out of the protected
    // routes so a guest basket renders for a visitor who was just encouraged to
    // fill it. Paying is what demands a session, and the API enforces that. This
    // asserted the old redirect, so it required the very regression that change
    // was made to fix.
    await page.goto('/cart');
    await expect(page).toHaveURL(/\/cart$/);

    // An account page is gated, and that is what proves the gate works.
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);
    await expect(
      page.getByRole('heading', { name: /Sign in with your mobile number/i }),
    ).toBeVisible();
    return;
  }

  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
});

test('a signed-out visitor never reaches a workspace shell', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  // `/cart` is not in this list any more: it is public by design, so requiring it
  // to redirect asserted the opposite of the intended behaviour. The paths here
  // mirror `protectedRoutes` in the customer proxy.
  const protectedPaths = project === 'customer-pwa' ? ['/account', '/orders'] : ['/', '/login'];
  for (const path of protectedPaths) {
    if (path === '/login') continue;
    await page.goto(path);
    // Either the proxy redirected, or the client-side gate is holding the
    // shell back. Both are acceptable; rendering the workspace is not.
    const url = page.url();
    if (!/\/login/.test(url)) {
      await expect(page.getByText(/Checking your session|sign in/i).first()).toBeVisible();
    }
  }
});

test('the deployed build cannot rely on the proxy alone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'customer-pwa', 'Role PWAs only');
  await page.goto('/');
  // The static export runs no proxy, so the browser-side gate must exist in the
  // shipped bundle. Its presence is observable from the gate's own copy.
  const body = await page.content();
  expect(body).toMatch(/sign in|Checking your session/i);
});

test('login surfaces support keyboard focus and 200% zoom', async ({ page }, testInfo) => {
  await page.goto('/login');
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('main')).toBeVisible();
  await testInfo.attach('login-200-percent', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test.describe('with real Supabase credentials', () => {
  test.skip(!supabaseConfigured, 'Set NEXT_PUBLIC_SUPABASE_URL and _ANON_KEY to run');

  test('an unauthenticated session is refused by the real gate, not the fallback', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'customer-pwa', 'Role PWAs only');
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    // The fallback branch fires only when the env is absent; reaching /login
    // here means getUser() rejected an absent session.
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });
});
