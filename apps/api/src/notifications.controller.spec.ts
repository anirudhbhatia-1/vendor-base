import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { createRequestContext } from '@neighbourhood-store/domain-types';
import { SESSION_REQUIREMENT } from './authorization.js';
import { NotificationsController } from './notifications.controller.js';
import { requestContextStorage } from './request-context-storage.js';

test('notification inbox requires an authenticated session for every role', () => {
  for (const method of ['list', 'read'] as const) {
    assert.equal(
      Reflect.getMetadata(SESSION_REQUIREMENT, NotificationsController.prototype[method]),
      true,
    );
  }
});

test('the inbox answers under the name the contract gives it', async () => {
  // A bare array was wrapped as `data` by the reference interceptor, and every
  // inbox reading `notifications` off the answer showed nothing (audit run 49).
  const rows = [{ in_app_notification_id: 'n1' }];
  const controller = new NotificationsController({
    list: async (input: { unread_only?: boolean }) => (input.unread_only ? rows : []),
  } as unknown as ConstructorParameters<typeof NotificationsController>[0]);
  const answer = await requestContextStorage.run(createRequestContext(), () =>
    controller.list('true'),
  );
  assert.deepEqual(answer, { notifications: rows });
});
