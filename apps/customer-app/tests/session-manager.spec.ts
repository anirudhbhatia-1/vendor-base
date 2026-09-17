import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, type SessionTokens } from '@neighbourhood-store/contracts';
import { createSessionManager } from '../session-manager';

const expired: SessionTokens = {
  access_token: 'old-access',
  refresh_token: 'old-refresh',
  session_id: 'device-session',
  access_expires_at: '2020-01-01T00:00:00Z',
};
const rotated = {
  ...expired,
  access_token: 'new-access',
  refresh_token: 'new-refresh',
  access_expires_at: '2030-01-01T00:00:00Z',
};

test('concurrent requests rotate once and persist both replacement tokens', async () => {
  let calls = 0;
  let stored: SessionTokens | null = expired;
  const manager = createSessionManager({
    read: async () => stored,
    write: async (value) => {
      stored = value;
    },
    refresh: async (token) => {
      calls += 1;
      assert.equal(token, expired.refresh_token);
      return rotated;
    },
  });
  await manager.restore();
  assert.deepEqual(await Promise.all([manager.valid(), manager.valid()]), [rotated, rotated]);
  assert.equal(calls, 1);
  assert.deepEqual(stored, rotated);
});

test('logout during a pending refresh cannot resurrect the session', async () => {
  let resolveRefresh: (value: SessionTokens) => void = () => undefined;
  let stored: SessionTokens | null = expired;
  const manager = createSessionManager({
    read: async () => stored,
    write: async (value) => {
      stored = value;
    },
    refresh: () =>
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
  });
  await manager.restore();
  const pending = manager.valid();
  await manager.set(null);
  resolveRefresh(rotated);
  assert.equal(await pending, null);
  assert.equal(stored, null);
});

test('network failures preserve refresh credentials; authentication rejection clears them', async () => {
  let stored: SessionTokens | null = expired;
  let failure: Error = new Error('Offline');
  const manager = createSessionManager({
    read: async () => stored,
    write: async (value) => {
      stored = value;
    },
    refresh: async () => {
      throw failure;
    },
  });
  await manager.restore();
  await assert.rejects(manager.valid(), /Offline/);
  assert.deepEqual(stored, expired);
  failure = new ApiError(401, 'Revoked');
  await assert.rejects(manager.valid(), /Revoked/);
  assert.equal(stored, null);
});

test('switching accounts isolates old refresh completion from the new session', async () => {
  const completions: Array<(value: SessionTokens) => void> = [];
  let stored: SessionTokens | null = expired;
  let calls = 0;
  const manager = createSessionManager({
    read: async () => stored,
    write: async (value) => {
      stored = value;
    },
    refresh: () => {
      calls += 1;
      return new Promise((resolve) => completions.push(resolve));
    },
  });
  await manager.restore();
  const oldRequest = manager.valid();
  const other = { ...expired, session_id: 'other-account', refresh_token: 'other-refresh' };
  await manager.set(other);
  const newRequest = manager.valid();
  assert.equal(calls, 2);
  // Named rather than asserted past: if the refresh was never registered, the
  // failure should say so instead of throwing on a non-null assertion.
  const firstCompletion = completions[0];
  const secondCompletion = completions[1];
  assert.ok(firstCompletion && secondCompletion, 'both refreshes should be in flight');
  firstCompletion(rotated);
  assert.equal(await oldRequest, null);
  const concurrentNewRequest = manager.valid();
  assert.equal(calls, 2, 'old completion must not clear the new in-flight refresh');
  const otherRotated = { ...rotated, session_id: other.session_id };
  secondCompletion(otherRotated);
  assert.deepEqual(await newRequest, otherRotated);
  assert.deepEqual(await concurrentNewRequest, otherRotated);
  assert.deepEqual(stored, otherRotated);
});
