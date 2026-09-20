import { expect, test, type Page } from '@playwright/test';

/**
 * The one journey nobody walks.
 *
 * Every broken workflow this suite was written for — a vendor order list that
 * 404ed, a handover with no caller, a customer decision that could never be
 * raised, an order whose delivery was silently lost — passed unit tests and
 * type checks. They failed only when a real person tried to go from a placed
 * order to a delivered one. This spec is that walk.
 *
 * It needs a live stack: API, worker, migrated database, and one signed-in
 * account per role. Without those it skips rather than asserting something
 * weaker, because a green run against an unconfigured build is exactly the
 * false comfort that let the breakage survive.
 */
const live = process.env.LIVE_SUPABASE_ACCEPTANCE === 'true';

type RoleCredentials = { readonly email: string; readonly password: string };

function credentials(role: 'ADMIN' | 'VENDOR' | 'PARTNER'): RoleCredentials | null {
  const email = process.env[`ACCEPTANCE_${role}_EMAIL`];
  const password = process.env[`ACCEPTANCE_${role}_PASSWORD`];
  return email && password ? { email, password } : null;
}

async function signIn(page: Page, who: RoleCredentials): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe('cross-role order journey', () => {
  test.skip(!live, 'Set LIVE_SUPABASE_ACCEPTANCE=true with a migrated database and role accounts.');
  // A rider goes online from where their phone says they are (D-17). Without a
  // granted position the workspace asks them to place themselves on the map
  // rather than inventing a point, so the journey grants one near the fixture
  // store.
  test.use({
    geolocation: { latitude: 26.9124, longitude: 75.7873 },
    permissions: ['geolocation'],
  });

  test('a vendor accepts, picks and hands over an order', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'vendor-pwa', 'Vendor PWA project only');
    const who = credentials('VENDOR');
    test.skip(!who, 'Vendor acceptance credentials are required');
    await signIn(page, who as RoleCredentials);
    await page.goto('/');

    // The fulfilment desk heads its live section with the count of orders that
    // need the shop's hand; the queue used to 404 while the typed client pointed
    // at /vendor/fulfilment, so nothing below this line could render.
    await expect(
      page.getByRole('heading', { name: /^[1-9]\d* active orders?$/ }),
      'The desk must show at least one live order.',
    ).toBeVisible();
    await page
      .getByRole('button', { name: /^Refresh$/ })
      .first()
      .click();

    // An empty queue fails this test rather than satisfying it.
    //
    // Every stage below used to be wrapped in `if (await x.isVisible())`, so a
    // vendor with no orders clicked nothing and the test named "accepts, picks and
    // hands over an order" passed having accepted, picked and handed over nothing.
    await expect(
      page.getByRole('button', { name: /^Accept$/ }).first(),
      'The golden path needs one payment-confirmed order awaiting acceptance. ' +
        'Seed the fixture; an empty queue is a missing precondition, not a pass.',
    ).toBeVisible();

    // From here every stage is mandatory and ordered: each one is the precondition
    // of the next, so a break anywhere stops the walk instead of skipping it.
    await page
      .getByRole('button', { name: /^Accept$/ })
      .first()
      .click();
    const startPicking = page.getByRole('button', { name: /Start picking/i }).first();
    await expect(startPicking).toBeVisible();
    await startPicking.click();

    const openPickList = page.getByRole('button', { name: /Open pick list/i }).first();
    await expect(openPickList).toBeVisible();
    await openPickList.click();

    const found = page.getByRole('button', { name: /^Found it$/ }).first();
    await expect(found).toBeVisible();
    await found.click();
    await expect(found).not.toBeVisible();
    // The pick list is a dialog over the order card; it is closed once every
    // line is resolved, and the card's controls are reachable again.
    await page.getByRole('button', { name: /^Close$/ }).click();

    const markReady = page.getByRole('button', { name: /Mark ready/i }).first();
    await expect(markReady).toBeVisible();
    await markReady.click();

    // The counter step comes with the partner: until one is at the counter the
    // card says so and offers no code field, because the code is the partner's
    // to show. The handover with a partner present is walked at the API.
    await expect(
      page.getByText(/Hand this order over when the delivery partner is at your counter/i),
    ).toBeVisible();
    await expect(page.getByText(/Finding a delivery partner/i).first()).toBeVisible();
  });

  test('a partner takes custody only after the vendor released it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'partner-pwa', 'Partner PWA project only');
    const who = credentials('PARTNER');
    test.skip(!who, 'Partner acceptance credentials are required');
    await signIn(page, who as RoleCredentials);

    await page.getByRole('button', { name: /Go online/i }).click();
    // "not eligible" was accepted here, so a partner who could never receive an
    // offer proved the dispatch path worked. Eligibility is a fixture
    // precondition, not an acceptable outcome of going online.
    await expect(
      page.getByText(/online for delivery offers/i),
      'The partner fixture must be eligible before this journey can mean anything.',
    ).toBeVisible();

    // Every custody state must offer a way out. The shell used to fall through
    // to a disabled "Await operations" button with no unhappy path at all, and
    // guarding this assertion behind `isVisible()` meant the regression would
    // have returned silently. The control is offered on the way to the customer,
    // so the fixture leaves this rider holding an order that is en route; the
    // work screen points at it and the active-delivery screen carries the control.
    await page.getByRole('link', { name: /Open active delivery/i }).click();
    const failure = page.getByRole('button', { name: /I cannot deliver this/i });
    await expect(failure).toBeVisible();
    await expect(failure).toBeEnabled();
  });

  test('an operator can dispatch manually and act on the finance queue', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'admin-pwa', 'Admin PWA project only');
    const who = credentials('ADMIN');
    test.skip(!who, 'Admin acceptance credentials are required');
    await signIn(page, who as RoleCredentials);

    await page.goto('/orders');
    await page.getByRole('button', { name: /Refresh order monitor/i }).click();
    // "No orders loaded yet" satisfied this assertion, so the monitor proved
    // nothing about whether it can display an order -- and so did a count of
    // zero, which /entries/ matched just as happily. The count has to start
    // with a non-zero digit.
    await expect(page.getByText(/^Order monitor: [1-9]\d* entries\./)).toBeVisible();

    await page.goto('/catalogue');
    // The moderation queue rendered empty regardless of its contents because
    // the response shape was parsed wrongly. "0 live cases" is that defect's
    // exact symptom, so it is not accepted either -- and the view loads on
    // arrival, without a button (it used to open empty until "Refresh queues").
    await expect(page.getByRole('heading', { name: /^[1-9]\d* live cases$/ })).toBeVisible();
  });
});
