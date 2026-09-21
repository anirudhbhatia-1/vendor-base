import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_WORKSPACE_URLS,
  deepLinkToPath,
  resolveWorkspaceUrl,
  staysInWorkspace,
} from '@neighbourhood-store/app-shell/config';

test('the admin app hosts the admin workspace and keeps its navigation inside it', () => {
  const workspace = resolveWorkspaceUrl('admin', {});
  assert.equal(workspace, DEFAULT_WORKSPACE_URLS.admin);
  assert.equal(staysInWorkspace(`${workspace}/`, workspace), true);
  assert.equal(staysInWorkspace('https://elsewhere.example.test/', workspace), false);
  assert.equal(deepLinkToPath('neighbourhood-admin://orders', 'neighbourhood-admin'), '/orders');
  assert.equal(deepLinkToPath('neighbourhood-other://orders', 'neighbourhood-admin'), null);
});
