import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestScope } from '../request-scope';

test('account or location changes invalidate every prior response', () => {
  const scope = createRequestScope();
  const catalogue = scope.capture();
  const alerts = scope.capture();
  assert.equal(catalogue(), true);
  scope.invalidate();
  assert.equal(catalogue(), false);
  assert.equal(alerts(), false);
  const next = scope.capture();
  assert.equal(next(), true);
  scope.invalidate();
  assert.equal(next(), false);
});

test('separate workspace instances do not invalidate one another', () => {
  const first = createRequestScope();
  const second = createRequestScope();
  const current = second.capture();
  first.invalidate();
  assert.equal(current(), true);
});
