import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vendorPages, vendorSectionPages } from './workspace-navigation';

test('catalogue tasks have distinct addressable pages in the same navigation section', () => {
  assert.deepEqual(
    vendorSectionPages('inventory').map(([, page]) => page.href),
    ['/catalogue', '/catalogue/inventory', '/catalogue/imports'],
  );
});
test('store controls are separated without losing staff or delivery configuration', () => {
  assert.deepEqual(
    vendorSectionPages('staff').map(([, page]) => page.href),
    ['/store', '/store/service-area', '/store/staff'],
  );
});
test('insights and onboarding remain reachable without interrupting the orders workspace', () => {
  assert.equal(vendorPages.insights.section, 'more');
  assert.equal(vendorPages.onboarding.section, 'more');
  assert.deepEqual(
    vendorSectionPages('orders').map(([view]) => view),
    ['orders'],
  );
  const routes = Object.values(vendorPages).map((page) => page.href);
  assert.equal(new Set(routes).size, routes.length);
});
