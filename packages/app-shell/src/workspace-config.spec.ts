import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_WORKSPACE_URLS,
  WorkspaceConfigError,
  deepLinkToPath,
  offlineSentence,
  resolveWorkspaceUrl,
  staysInWorkspace,
} from './workspace-config.js';

test('each role resolves to its company-test workspace unless the build names another', () => {
  assert.equal(resolveWorkspaceUrl('partner'), DEFAULT_WORKSPACE_URLS.partner);
  assert.equal(
    resolveWorkspaceUrl('vendor', { EXPO_PUBLIC_WORKSPACE_URL: 'https://vendor.example.test/x' }),
    'https://vendor.example.test',
  );
  // A dev server on the machine, reached from the emulator's loopback alias.
  assert.equal(
    resolveWorkspaceUrl('customer', { EXPO_PUBLIC_WORKSPACE_URL: 'http://10.0.2.2:3100' }),
    'http://10.0.2.2:3100',
  );
  assert.throws(
    () => resolveWorkspaceUrl('admin', { EXPO_PUBLIC_WORKSPACE_URL: 'http://admin.example.test' }),
    WorkspaceConfigError,
  );
  assert.throws(
    () => resolveWorkspaceUrl('admin', { EXPO_PUBLIC_WORKSPACE_URL: 'not a url' }),
    WorkspaceConfigError,
  );
});

test('same-origin navigation stays in the shell; maps, calls and other hosts go to the device', () => {
  const workspace = DEFAULT_WORKSPACE_URLS.partner;
  assert.equal(staysInWorkspace(`${workspace}/active`, workspace), true);
  assert.equal(staysInWorkspace('about:blank', workspace), true);
  assert.equal(staysInWorkspace('geo:26.91,75.81?q=store', workspace), false);
  assert.equal(staysInWorkspace('tel:+911234567890', workspace), false);
  assert.equal(staysInWorkspace('https://maps.example.test/route', workspace), false);
  assert.equal(staysInWorkspace('nonsense', workspace), false);
});

test('a deep link on the app scheme names a workspace path and nothing else', () => {
  assert.equal(
    deepLinkToPath('neighbourhood-partner://active', 'neighbourhood-partner'),
    '/active',
  );
  assert.equal(
    deepLinkToPath('neighbourhood-partner:///earnings?tab=week', 'neighbourhood-partner'),
    '/earnings?tab=week',
  );
  assert.equal(deepLinkToPath('neighbourhood-partner://', 'neighbourhood-partner'), '/');
  assert.equal(deepLinkToPath('https://evil.example.test/', 'neighbourhood-partner'), null);
  assert.equal(deepLinkToPath('neighbourhood-partner://../x', 'neighbourhood-partner'), null);
});

test('the offline sentence is the role’s', () => {
  assert.match(offlineSentence('partner'), /held on this device/);
  assert.match(offlineSentence('customer'), /basket/);
});
