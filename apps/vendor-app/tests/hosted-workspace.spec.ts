import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_WORKSPACE_URLS,
  deepLinkToPath,
  resolveWorkspaceUrl,
  staysInWorkspace,
} from '@neighbourhood-store/app-shell/config';

test('the vendor app hosts the vendor workspace and keeps its navigation inside it', () => {
  const workspace = resolveWorkspaceUrl('vendor', {});
  assert.equal(workspace, DEFAULT_WORKSPACE_URLS.vendor);
  assert.equal(staysInWorkspace(`${workspace}/`, workspace), true);
  assert.equal(staysInWorkspace('https://elsewhere.example.test/', workspace), false);
  assert.equal(deepLinkToPath('neighbourhood-vendor://orders', 'neighbourhood-vendor'), '/orders');
  assert.equal(deepLinkToPath('neighbourhood-other://orders', 'neighbourhood-vendor'), null);
});
