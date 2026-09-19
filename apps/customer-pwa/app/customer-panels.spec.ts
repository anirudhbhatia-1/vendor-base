import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const directory = path.resolve(import.meta.dirname);

function panel(file: string): string {
  return fs.readFileSync(path.join(directory, file), 'utf8');
}

/**
 * The file with its comments removed.
 *
 * Several assertions below are negative — "this identifier must not appear" —
 * and the comments explaining *why* it must not appear naturally quote it. Read
 * against the raw text those tests fail on their own documentation.
 */
function code(file: string): string {
  return panel(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('search sends the filters the endpoint has always accepted', () => {
  const source = panel('home-feed.tsx');
  for (const filter of ['category', 'available_only', 'max_distance_meters']) {
    assert.ok(source.includes(filter), `filter ${filter}`);
  }
});

test('recent searches are listed and can be forgotten', () => {
  const source = panel('home-feed.tsx');
  assert.ok(source.includes('recentSearches()'), 'recent searches are read');
  assert.ok(source.includes('deleteRecentSearch'), 'a term can be removed');
});

test('an address is saved at the resolved location, not a fixed point', () => {
  const source = panel('address-setup.tsx');
  assert.ok(source.includes('deviceCoordinates'));
  assert.ok(source.includes('latitude: located.latitude'));
});

test('each store keeps its own catalogue, and one failure does not hide the rest', () => {
  const source = panel('home-feed.tsx');
  assert.ok(source.includes('loadCatalogues'), 'store catalogues load with discovery');
  assert.ok(
    source.includes('Promise.allSettled'),
    'one failed catalogue does not hide other stores',
  );
  assert.ok(
    source.includes('loadedBatch[store.vendor_location_id] = result.value'),
    'a catalogue is keyed to the store it was requested for',
  );
});

test('a search answers with products, not only with a list of shops', () => {
  const source = code('home-feed.tsx');
  assert.ok(source.includes('setSearchResults(search.results)'), 'the ranked hits are kept');
  assert.ok(
    !source.includes('setMatchingProductIds(search.results'),
    'the ranking is not reduced to a store filter',
  );
  assert.ok(source.includes('const productHits'), 'the hits are resolved to products');
  assert.ok(source.includes('<ShelfTile'), 'the hits render as product tiles with an add button');
});

test('a category tile opens an aisle of products across shops', () => {
  const source = code('home-feed.tsx');
  assert.ok(source.includes('onClick={() => setAisle('), 'the tile opens an aisle');
  assert.ok(source.includes('product.category === aisle'), 'the aisle is filled from catalogues');
  assert.ok(
    !source.includes('void discover(entry.category,'),
    'a category no longer re-runs discovery as a store search',
  );
});

test('a product tile off a store page still names the shop selling it', () => {
  const source = code('home-feed.tsx');
  const shelfTile = source.slice(source.indexOf('function ShelfTile'));
  assert.ok(shelfTile.includes('displayLabel(store.location_name)'), 'the shop is named');
  assert.ok(
    shelfTile.includes('href={`/stores/${store.vendor_location_id}`}'),
    'and is a link to that shop',
  );
  assert.ok(
    shelfTile.includes('vendorLocationId={store.vendor_location_id}'),
    'the line is added against the shop shown on the tile',
  );
});

test('a product tile shows the basket quantity and can change it in place', () => {
  const source = panel('catalogue-tile.tsx');
  assert.ok(source.includes('quantityOf(product.catalogue_variant_id)'), 'reads the live basket');
  assert.ok(source.includes('onQuantityChange'), 'the quantity is changeable from the tile');
});

test('a product image falls back to a designed placeholder, never a broken image', () => {
  const source = panel('catalogue-tile.tsx');
  assert.ok(source.includes('image_ids[0]'), 'a servable image id is used when present');
  assert.ok(source.includes('catalogueImageUrl'), 'the id resolves through the shared helper');
  assert.ok(source.includes(': null'), 'absence is passed as null for the placeholder');
});

test('the basket is grouped by vendor, never flattened across stores', () => {
  const source = code('checkout-panel.tsx');
  assert.ok(source.includes('cart?.groups'), 'groups are the unit rendered');
  assert.ok(!source.includes('allLines'), 'lines are never flattened across stores');
  assert.ok(source.includes('group.location_name'), 'each group names its store');
  assert.ok(source.includes('minimum_met'), 'each group states its own minimum');
});

test('a basket line shows a product name, never an identifier', () => {
  const source = code('checkout-panel.tsx');
  assert.ok(source.includes('displayLabel(line.title)'), 'the product title is rendered');
  assert.ok(
    !source.includes('catalogue_variant_id.slice'),
    'no identifier fragment stands in for a name',
  );
});

test('the payment method the customer picks is the one that is sent', () => {
  const source = panel('checkout-panel.tsx');
  assert.ok(source.includes('payment_method: paymentMethod'), 'the selection reaches the API');
  assert.ok(source.includes('idempotency_key'), 'a repeat tap cannot place a second order');
  assert.ok(!source.includes("'COD'"), 'cash on delivery is not offered (GAT-01)');
});

test('the quote countdown is driven by the server expiry', () => {
  const source = panel('checkout-panel.tsx');
  assert.ok(source.includes('formatCountdown(quote.expires_at'), 'the deadline is the quote’s');
  assert.ok(source.includes('quoteExpired'), 'an expired quote cannot be paid');
});

test('the decision countdown is driven by the server deadline', () => {
  const source = panel('orders-panel.tsx');
  assert.ok(source.includes('decision_deadline_at'), 'deadline comes from the proposal');
  assert.ok(source.includes('formatCountdown'), 'it is displayed as time remaining');
  assert.ok(source.includes('Time is up'), 'expiry is stated plainly');
});

test('refunds are shown against the order they belong to', () => {
  const source = panel('orders-panel.tsx');
  assert.ok(source.includes('financeReceipt'), 'the money view is loaded');
  assert.ok(source.includes('refunded_total_minor'), 'the refunded amount is shown');
  assert.ok(source.includes('No refunds against this order'), 'the absence is stated too');
});

test('cancelling asks first and says what will happen', () => {
  const source = panel('orders-panel.tsx');
  assert.ok(source.includes('cancellationPreview'), 'the preview is fetched');
  assert.ok(source.includes('refund_expectation'), 'the refund position is stated');
  // After custody the answer is a return, arranged through support, not a
  // silently disabled button.
  assert.ok(source.includes('SUPPORT_CASE'), 'the post-custody path is offered');
  assert.ok(source.includes('Arrange a return'));
});

test('one order’s panels never render under another order', () => {
  const source = panel('orders-panel.tsx');
  // Tracking, receipt and the cancellation preview are per-card state. Held at
  // panel level, opening one order's tracking rendered it under every order —
  // which across a multi-store checkout tells the customer the wrong thing
  // about the wrong shop.
  assert.ok(source.includes('function OrderCard('), 'each order owns a component');
  const card = source.slice(source.indexOf('function OrderCard('));
  for (const state of ['setTracking', 'setReceipt', 'setPreview']) {
    assert.ok(card.includes(state), `${state} lives inside the card`);
  }
});

test('child orders are shown inside the checkout group that paid for them', () => {
  const source = panel('orders-panel.tsx');
  assert.ok(source.includes('group.vendor_orders.map'), 'children render inside their group');
  assert.ok(source.includes('checkout_reference'), 'the group is identified');
});

test('tracking shows a stage, never a person', () => {
  const source = panel('orders-panel.tsx');
  assert.ok(source.includes('orders.tracking'));
  assert.ok(source.includes('approximate_drop_area'));
  assert.ok(!source.includes('partner_user_id'), 'the partner is never identified to the customer');
});

test('a rating asks for a number of stars rather than assuming five', () => {
  const source = panel('orders-panel.tsx');
  assert.ok(source.includes('StarRating'), 'a real control exists');
  assert.ok(!source.includes('stars: 5,'), 'five stars is never hardcoded');
});

test('support asks what went wrong before opening a case', () => {
  const source = panel('orders-panel.tsx');
  assert.ok(source.includes('SUPPORT_CATEGORIES'), 'a category is chosen');
  assert.ok(source.includes('supportDescription'), 'the customer describes the problem');
});

test('notifications are rendered as sentences, never as serialised payloads', () => {
  const source = code('notification-inbox.tsx');
  assert.ok(!source.includes('JSON.stringify'), 'no payload is dumped at the customer');
  assert.ok(source.includes('function describe('), 'templates resolve to copy');
});

test('the language control switches language rather than navigating away', () => {
  const source = panel('customer-chrome.tsx');
  assert.ok(source.includes('setLanguage(code)'), 'the control changes the language');
  assert.ok(source.includes('aria-pressed={language === code}'), 'the current language is stated');
});

test('protected routes are gated in the browser, not only in the proxy', () => {
  // The basket is deliberately not in this list. Sign-in belongs at the till,
  // not at the basket: a visitor fills one before they have an account, and
  // gating the route hid the thing the app had just asked them to build.
  for (const route of ['account', 'orders', 'stores']) {
    const source = fs.readFileSync(path.join(directory, route, 'page.tsx'), 'utf8');
    assert.ok(source.includes('RequireCustomerSession'), `${route} is gated`);
  }
});

test('the basket is visible before sign-in, but paying is not', () => {
  const source = fs.readFileSync(path.join(directory, 'cart', 'page.tsx'), 'utf8');
  assert.ok(source.includes('GuestBasket'), 'a signed-out visitor sees their basket');
  assert.ok(source.includes('CheckoutPanel'), 'a signed-in customer still checks out');
  assert.ok(
    !source.includes('RequireCustomerSession'),
    'the basket route must not redirect a guest away from their own items',
  );
});

test('discovery does not require a session', () => {
  // Every discovery route used to demand `customer.discovery.use`, and the feed
  // needed a saved address, so nothing at all was visible before sign-in —
  // against architecture.md §6.1, which asks for public store pages.
  for (const route of ['', 'categories', 'store']) {
    const source = fs.readFileSync(path.join(directory, route, 'page.tsx'), 'utf8');
    assert.ok(
      !source.includes('RequireCustomerSession'),
      `${route || 'home'} must be browsable before sign-in`,
    );
  }
  const feed = panel('home-feed.tsx');
  assert.ok(feed.includes('client.catalogue.stores'), 'the feed can read the public store list');
  assert.ok(feed.includes('client.catalogue.search'), 'search works before sign-in');
});

test('a pre-sign-in basket is replayed through the server, not trusted', () => {
  const source = panel('cart-store.tsx');
  assert.ok(source.includes('mergeGuestCart'), 'the guest basket is merged on sign-in');
  assert.ok(
    source.includes('client.cart.addLine'),
    'lines are replayed through addLine so the server applies its own rules',
  );
  assert.ok(
    source.indexOf('clearGuestCart()') > source.indexOf('client.cart.addLine'),
    'the local basket is cleared only after the replay succeeds',
  );
});

test('the app stylesheet composes layout and declares no appearance overrides', () => {
  const css = fs
    .readFileSync(path.join(directory, 'globals.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!css.includes('!important'), 'no !important survives');
  // Colour belongs to the token layer. A hex literal here means a surface has
  // started keeping its own private palette again, which is how three fighting
  // stylesheets happened the first time.
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'no colour literals');
});

test('the shop and the delivery are rated separately', () => {
  const source = code('orders-panel.tsx');
  assert.ok(source.includes('client.orders.rate('), 'the shop is rated');
  assert.ok(source.includes('client.orders.rateDelivery('), 'the delivery is rated on its own');
  assert.ok(
    source.includes('tracking?.delivery_assignment_id'),
    'a collected order is never asked to rate a delivery it never had',
  );
});

test('a notification is a sentence, not the key that produced it', () => {
  const source = code('notification-inbox.tsx');
  // The sweep names templates after the table it read: `vendor_order_event.*`.
  // The switch used to answer a vocabulary nothing emitted, so every notice
  // fell through to its own key.
  for (const key of [
    'vendor_order_event.accepted',
    'vendor_order_event.delivered',
    'vendor_order_event.declined',
    'vendor_order_event.returned',
  ]) {
    assert.ok(source.includes(`case '${key}'`), `renders ${key}`);
  }
});

test('the basket route is reachable without a session', () => {
  const proxy = fs.readFileSync(path.join(directory, '..', 'proxy.ts'), 'utf8');
  const routes = /const protectedRoutes = \[([^\]]*)\]/.exec(proxy)?.[1] ?? '';
  assert.ok(
    !routes.includes("'/cart'"),
    'the proxy must not redirect a guest away from the basket',
  );
  assert.ok(routes.includes("'/orders'"), 'order history still needs a session');
});

test('sign-in announces a failure assertively and progress politely', () => {
  // Verification has a bounded attempt count and the code expires, so a failure a
  // screen reader queues behind other speech can cost the attempt that locks the
  // account out. Both regions must stay distinct: one `role="alert"` for failures,
  // one polite `role="status"` for progress.
  //
  // This reads the source rather than rendering the component, because the customer
  // PWA has no component test runner yet. It can prove the two regions have not
  // collapsed back into one; it cannot prove what a screen reader actually announces.
  const source = panel('sign-in-panel.tsx');
  assert.match(source, /role="alert"/, 'failures need an assertive live region');
  assert.match(source, /role="status"\s+aria-live="polite"/, 'progress stays polite');
  assert.equal(
    /setMessage\((?!text\))/.test(source),
    false,
    'every message goes through showError or showStatus so its tone is decided',
  );
  assert.ok(source.includes('showError('), 'failure paths use the assertive helper');
  assert.ok(source.includes('showStatus('), 'progress paths use the polite helper');
});

test('the basket says why a store or a line cannot be ordered, and offers the way out', () => {
  const source = code('checkout-panel.tsx');
  const groupCard = source.slice(
    source.indexOf('function GroupCard'),
    source.indexOf('export function'),
  );
  assert.ok(
    groupCard.includes("group.lifecycle_state === 'INVALID'") &&
      groupCard.includes('groupUnavailableSentence(group.invalid_reason, t)'),
    'an invalid group is explained by the reason revalidation recorded',
  );
  assert.ok(groupCard.includes('removeGroup(group)'), 'and can be removed as a whole');
  assert.ok(
    groupCard.includes("line.lifecycle_state === 'STALE'") &&
      groupCard.includes('lineStaleSentence(line.stale_reason, t)'),
    'a stale line is explained by its reason',
  );
  assert.ok(
    groupCard.includes('removeLine(line)'),
    'and can be removed without a quantity to step',
  );
  // A stale line has nothing to step: the stepper and the substitution
  // choice are for a line the store can still supply.
  assert.ok(
    /stale \? \(\s*<Button/.test(groupCard) && /stale \? null : \(\s*<SelectField/.test(groupCard),
    'the stepper and substitution choice give way to removal on a stale line',
  );
});

test('a recheck reports a change when a line went stale or something came back, not only when a group failed', () => {
  const source = code('cart-store.tsx');
  const revalidate = source.slice(source.indexOf('const revalidate = useCallback'));
  for (const field of [
    'entry.invalidated',
    'entry.recovered',
    'entry.stale_line_ids.length > 0',
    'entry.revived_line_ids.length > 0',
  ]) {
    assert.ok(revalidate.includes(field), field);
  }
});
