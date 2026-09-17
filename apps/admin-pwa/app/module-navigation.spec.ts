import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeAdminModule, adminModuleGroups } from './module-navigation';

test('all admin modules remain reachable with distinct routes', () => {
  const routes = adminModuleGroups.flatMap((group) => group.links.map(([href]) => href));
  assert.equal(new Set(routes).size, 14);
  for (const route of ['/support', '/finance', '/trust', '/incidents', '/onboarding', '/audit'])
    assert.ok(routes.some((href) => href === route));
});
test('nested work retains its module without prefix collisions', () => {
  assert.equal(activeAdminModule('/finance/refunds')?.[0], '/finance');
  assert.equal(activeAdminModule('/orders/123')?.[0], '/orders');
  assert.equal(activeAdminModule('/')?.[0], '/');
  assert.equal(activeAdminModule('/orders-archive'), undefined);
});
