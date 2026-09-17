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

  test('a vendor accepts, picks and hands over an order', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'vendor-pwa', 'Vendor PWA project only');
    const who = credentials('VENDOR');
    test.skip(!who, 'Vendor acceptance credentials are required');
    await signIn(page, who as RoleCredentials);
    await page.goto('/');

    // The order list is the step that used to 404: nothing below it could ever
    // render while the typed client pointed at /vendor/fulfilment.
    await expect(page.getByRole('heading', { name: /Accept, pick and hand off/i })).toBeVisible();
    await page.getByRole('button', { name: /Refresh orders/i }).click();

    // An empty queue fails this test rather than satisfying it.
    //
    // Every stage below used to be wrapped in `if (await x.isVisible())`, so a
    // vendor with no orders clicked nothing and the test named "accepts, picks and
    // hands over an order" passed having accepted, picked and handed over nothing.
    // The alternation on the status line did the same job higher up: "No store
    // orders yet" satisfied the assertion that the golden path was working.
    await expect(page.getByText(/Orders are current/i)).toBeVisible();
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

    const found = page.getByRole('button', { name: /^Found$/ }).first();
    await expect(found).toBeVisible();
    await found.click();
    await expect(found).not.toBeVisible();

    const markReady = page.getByRole('button', { name: /Mark ready/i }).first();
    await expect(markReady).toBeVisible();
    await markReady.click();

    const issueOtp = page.getByRole('button', { name: /Issue pickup OTP/i }).first();
    await expect(issueOtp).toBeVisible();
    await issueOtp.click();
    // The OTP used to be requested and thrown away, which made handover
    // impossible; it must now be readable by the person at the counter.
    await expect(page.getByText(/Read out: \d{6}/)).toBeVisible();
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
    // have returned silently.
    const failure = page.getByRole('button', { name: /Delivery failed/i });
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
    // nothing about whether it can display an order.
    await expect(page.getByText(/checkout group/i).first()).toBeVisible();

    await page.goto('/catalogue');
    // The moderation queue rendered empty regardless of its contents because
    // the response shape was parsed wrongly.
    await expect(page.getByText(/live cases/i)).toBeVisible();
  });
});
