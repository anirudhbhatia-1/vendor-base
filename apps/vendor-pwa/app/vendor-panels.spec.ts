import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { statementToCsv } from './payouts-panel.js';
import { verticesToWkt } from './service-area-panel.js';

/**
 * The vendor console calls the API through raw path strings, which is where the
 * order list silently pointed at a route that never existed. The contract
 * control checks those paths on every lint; this pins the surfaces each panel
 * owns, and covers the one piece of real logic in them — turning a vertex list
 * into a polygon.
 */
const directory = path.resolve(import.meta.dirname);

function panel(file: string): string {
  return fs.readFileSync(path.join(directory, file), 'utf8');
}

/**
 * The file with its comments removed.
 *
 * Several assertions below are negative — "this must not appear" — and the
 * comments explaining why naturally quote the thing. Read against the raw text
 * those tests fail on their own documentation.
 */
function code(file: string): string {
  return panel(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const expectations: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    'staff-panel.tsx',
    ['/staff', '/staff/invite', '/staff/revoke', '/staff/activity', '/access/mine'],
  ],
  [
    'service-area-panel.tsx',
    ['/settings/fulfilment-modes', '/settings/zones', '/settings/closures', '/deactivate'],
  ],
  ['inventory-panel.tsx', ['/inventory', '/stock', '/confirm', '/reservations']],
  ['catalogue-import-panel.tsx', ['/catalogue/imports', '/catalogue/imports/template', '/commit']],
];

for (const [file, fragments] of expectations) {
  test(`${file} calls the surface it owns`, () => {
    const source = panel(file);
    for (const fragment of fragments) {
      assert.ok(source.includes(fragment), `${file} should call ${fragment}`);
    }
  });
}

test('the order list uses the location-scoped route, not the fabricated one', () => {
  const source = panel('orders-panel.tsx');
  assert.ok(!source.includes('vendor/fulfilment/'));
});

test('new orders arrive without a manual refresh, and pause when hidden', () => {
  const source = panel('orders-panel.tsx');
  assert.ok(source.includes('setInterval'), 'the order list polls');
  assert.ok(source.includes('visibilityState'), 'polling pauses on a hidden tab');
});

test('the acceptance countdown is driven by the server deadline', () => {
  const source = panel('orders-panel.tsx');
  assert.ok(source.includes('order.accept_by'), 'the countdown reads accept_by from the order');
  assert.ok(source.includes('formatCountdown'), 'it renders as time remaining');
  assert.ok(!source.includes('preparation_estimate_seconds: 900'), 'prep time is no longer fixed');
});

test('picking never asks a shopkeeper to type into a browser prompt', () => {
  const source = code('orders-panel.tsx');
  // `window.prompt` collected the weighed quantity, and — worse — the variant
  // UUID for a substitution. It carries no label, cannot be corrected before it
  // is sent, and is unusable one-handed on the phone this screen is built for.
  assert.ok(!source.includes('window.prompt'), 'no browser prompt survives');
  assert.ok(source.includes('Measured quantity'), 'weight has a labelled field');
});

test('a substitution is chosen from the store’s own catalogue', () => {
  const source = panel('orders-panel.tsx');
  assert.ok(source.includes('loadVariants'), 'the store’s published variants are loaded');
  assert.ok(source.includes('Replacement product'), 'the replacement is picked, not typed');
});

test('declining states its consequences and records a real reason', () => {
  const source = code('orders-panel.tsx');
  assert.ok(source.includes('DECLINE_REASONS'), 'reasons are standardised (VEN-27)');
  assert.ok(
    !source.includes("reason_code: 'VENDOR_UNAVAILABLE'"),
    'one reason is not sent for every case',
  );
  assert.ok(source.includes('is refunded'), 'the customer impact is previewed');
});

test('a money amount typed by a vendor is parsed in integer minor units', () => {
  const source = code('catalogue-studio.tsx');
  assert.ok(source.includes('parseRupeesToMinor'), 'the exact parser is used');
  // `Math.round(Number(price) * 100)` is floating-point money arithmetic, which
  // the repository prohibits outright. Percent-to-basis-points elsewhere in the
  // form is not money, so the check is scoped to the price itself.
  assert.ok(!/Number\(price\)/.test(source), 'the price never passes through Number()');
  assert.ok(!/price[^\n]*\* 100/.test(source), 'no float multiply reaches a price');
});

test('a vendor picks a category from the taxonomy rather than inventing one', () => {
  const source = code('catalogue-studio.tsx');
  assert.ok(source.includes('CATEGORIES'), 'categories are a fixed list');
  assert.ok(
    !/setCategory\(event\.target\.value\.toUpperCase\(\)\)/.test(source),
    'free text is not upper-cased into a category',
  );
});

test('an account with several locations can reach all of them', () => {
  const source = code('vendor-workspace.tsx');
  // Taking `vendor_location_ids[0]` and discarding the rest is why VEN-04 stood
  // at backend-only while the API had supported multiple locations throughout.
  assert.ok(!source.includes('vendor_location_ids[0];'), 'the first location is not the only one');
  assert.ok(source.includes('location-switcher'), 'a switcher exists');
});

test('onboarding no longer submits a fixed location and minimum order', () => {
  const source = panel('onboarding-panel.tsx');
  assert.ok(!source.includes('minimum_order_minor: 10000'), 'minimum order comes from the form');
  // The centroid still appears, as the fallback when the vendor declines
  // location permission. What matters is that the submission uses the resolved
  // coordinates rather than the constant.
  assert.ok(source.includes('latitude: located.latitude'), 'submitted coordinates are resolved');
  assert.ok(source.includes('storeCoordinates'));
  for (const kind of ['FOOD_SAFETY_DECLARATION', 'PAYOUT_ACCOUNT_PROOF']) {
    assert.ok(source.includes(kind), `document kind ${kind}`);
  }
});

test('a settlement statement downloads as CSV, not a print dialog', () => {
  const csv = statementToCsv({
    vendor_location_id: '0192f000-0000-7000-8000-000000000001',
    pending_minor: 1500,
    eligible_minor: 0,
    settled_minor: 24050,
    settlements: [
      {
        settlement_id: 's-1',
        reference: 'SETTLE-1',
        eligible_at: '2026-08-30T00:00:00.000Z',
        lifecycle_state: 'SETTLED',
        gross_minor: 25000,
        platform_fee_minor: 950,
        net_minor: 24050,
      },
    ],
  });
  const [header, row] = csv.split('\n');
  assert.equal(
    header,
    'settlement_reference,lifecycle_state,eligible_at,gross_inr,platform_fee_inr,net_inr',
  );
  // Paise are integers in the ledger; the single division to rupees happens
  // once, for display, and must not lose the last two digits.
  assert.equal(row, 'SETTLE-1,SETTLED,2026-08-30T00:00:00.000Z,250.00,9.50,240.50');
});

test('a field containing a comma is quoted rather than breaking the row', () => {
  const csv = statementToCsv({
    vendor_location_id: 'loc',
    pending_minor: 0,
    eligible_minor: 0,
    settled_minor: 0,
    settlements: [
      {
        settlement_id: 's',
        reference: 'SETTLE,1',
        eligible_at: 'now',
        lifecycle_state: 'SETTLED',
        gross_minor: 100,
        platform_fee_minor: 0,
        net_minor: 100,
      },
    ],
  });
  assert.ok(csv.includes('"SETTLE,1"'));
});

test('an action taken offline is queued with its own body, not retried blindly', () => {
  const source = panel('orders-panel.tsx');
  assert.ok(source.includes('navigator.onLine === false'), 'offline is distinguished from refusal');
  assert.ok(source.includes('enqueue('), 'the action is held');
  assert.ok(source.includes("addEventListener('online'"), 'it flushes on reconnect');
});

test('a zone boundary closes its ring in longitude, latitude order', () => {
  const wkt = verticesToWkt([
    { longitude: '75.76', latitude: '26.85' },
    { longitude: '75.77', latitude: '26.85' },
    { longitude: '75.77', latitude: '26.86' },
  ]);
  // PostGIS takes longitude first and requires the ring to close; getting
  // either wrong produces a polygon that is silently somewhere else.
  assert.equal(wkt, 'POLYGON((75.76 26.85, 75.77 26.85, 75.77 26.86, 75.76 26.85))');
});

test('a boundary with fewer than three vertices is refused', () => {
  assert.throws(
    () =>
      verticesToWkt([
        { longitude: '75.76', latitude: '26.85' },
        { longitude: '75.77', latitude: '26.85' },
      ]),
    /at least three/,
  );
});

test('store settings load before they are edited, and never invent defaults', () => {
  const source = code('store-settings-panel.tsx');
  // The form had no read behind it, so it opened on hardcoded values —
  // "20 minutes", "₹50", Sunday 08:00–21:00 — and wrote them over the store's
  // real settings on save.
  assert.ok(source.includes('readLocation'), 'current settings are loaded');
  assert.ok(!/useState\('20'\)/.test(source), 'no hardcoded preparation default');
  assert.ok(!/useState\('50'\)/.test(source), 'no hardcoded minimum default');
});

test('the concurrency version is carried, never typed by the shopkeeper', () => {
  const source = code('store-settings-panel.tsx');
  // `expected_version` is an optimistic-concurrency token. Exposing it as a
  // text box asked someone to guess a number they had no way of knowing, so
  // saving mostly produced a conflict.
  assert.ok(source.includes('expected_version: settings.version'), 'it comes from the read');
  assert.ok(!source.includes('Current location version'), 'no version entry box remains');
  assert.ok(!/setExpectedVersion/.test(source), 'the version is not client state to edit');
});

test('saving hours writes the whole week, not one day', () => {
  const source = code('store-settings-panel.tsx');
  // `hours` replaces every row for the location, so sending only weekday 0
  // deleted the other six days.
  assert.ok(source.includes('WEEKDAYS.filter'), 'every open day is sent');
  assert.ok(!/weekday: 0, opens_at/.test(source), 'not a single hardcoded weekday');
});

test('money typed into store settings is parsed in integer minor units', () => {
  const source = code('store-settings-panel.tsx');
  assert.ok(source.includes('parseRupeesToMinor'), 'the exact parser is used');
  assert.ok(!/Math\.round\(minR \* 100\)/.test(source), 'no float multiply reaches a minimum');
});

test('a store dashboard shows counts it can prove, or nothing', () => {
  const source = code('insights-panel.tsx');
  // The screen this replaces stated "12 orders · 96% accepted" from nothing.
  assert.ok(source.includes('vendor/locations/${vendorLocationId}/insights'), 'figures are read');
  assert.ok(!/96%/.test(source), 'no fabricated rate');
  // A percentage over a handful of orders implies precision the sample lacks.
  assert.ok(source.includes('of {insights.orders_total}'), 'rates are shown as counts');
});

test('open support cases are visible to the store they concern', () => {
  const source = code('insights-panel.tsx');
  // VEN-43: the instruction stays with the store until the case resolves.
  assert.ok(source.includes('insights/support-cases'), 'cases are read');
  // JSX wraps the sentence, so match across the line break.
  assert.ok(/Do not cancel or\s+refund/.test(source), 'the standing instruction is stated');
});

// Two runtime crashes came from assuming a response shape instead of reading
// the controller: `catalogue/products` returns the row array directly, and
// `settings/fulfilment-modes` returns an array of names, not objects. Both
// looked fine to TypeScript because the panels declared the shape they wanted.
test('the catalogue product list tolerates a bare array response', () => {
  const source = code('inventory-panel.tsx');
  assert.ok(
    source.includes('Array.isArray(response)'),
    'inventory-panel must handle the unwrapped array the route actually returns',
  );
  assert.ok(
    !source.includes('{ products: readonly CatalogueProduct[] }'),
    'inventory-panel must not assume a products wrapper',
  );
});

test('fulfilment modes are names, not objects with an enabled flag', () => {
  const source = code('service-area-panel.tsx');
  assert.ok(
    !source.includes('mode.fulfilment_method'),
    'the route returns strings; reading a field off them crashes the panel',
  );
  assert.ok(
    !source.includes("?? 'MODE'"),
    'a placeholder that renders the literal word MODE is not a fallback',
  );
});

test('a self-delivered order is started at the shop and completed at the door (VEN-37)', () => {
  const source = code('orders-panel.tsx');
  // The console used to say the step was "not available yet". Both legs now
  // exist and are the shop's own work until the door, so the order stays on
  // the active list while the goods are on the road.
  assert.ok(
    !source.includes('Recording its dispatch and delivery is not\n            available yet'),
    'the self-delivery leg is no longer described as unavailable',
  );
  assert.ok(source.includes("'self-delivery/start'"), 'the shop starts the delivery');
  assert.ok(source.includes("'self-delivery/complete'"), 'the shop completes it at the door');
  assert.ok(source.includes('Customer’s delivery code'), 'the door asks for the customer’s code');
  assert.ok(
    source.includes(
      "order.lifecycle_state === 'PICKED_UP' && order.fulfilment_method === 'VENDOR_DELIVERY'",
    ),
    'a self-delivery out on the road is still active work for the shop',
  );
});
