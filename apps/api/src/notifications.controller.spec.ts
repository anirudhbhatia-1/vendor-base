import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { SESSION_REQUIREMENT } from './authorization.js';
import { NotificationsController } from './notifications.controller.js';

test('notification inbox requires an authenticated session for every role', () => {
  for (const method of ['list', 'read'] as const) {
    assert.equal(
      Reflect.getMetadata(SESSION_REQUIREMENT, NotificationsController.prototype[method]),
      true,
    );
  }
});
