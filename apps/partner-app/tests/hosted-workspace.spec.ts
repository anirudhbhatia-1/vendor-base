import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_WORKSPACE_URLS,
  deepLinkToPath,
  resolveWorkspaceUrl,
  staysInWorkspace,
} from '@neighbourhood-store/app-shell/config';

test('the partner app hosts the partner workspace and keeps its navigation inside it', () => {
  const workspace = resolveWorkspaceUrl('partner', {});
  assert.equal(workspace, DEFAULT_WORKSPACE_URLS.partner);
  assert.equal(staysInWorkspace(`${workspace}/`, workspace), true);
  assert.equal(staysInWorkspace('https://elsewhere.example.test/', workspace), false);
  assert.equal(
    deepLinkToPath('neighbourhood-partner://orders', 'neighbourhood-partner'),
    '/orders',
  );
  assert.equal(deepLinkToPath('neighbourhood-other://orders', 'neighbourhood-partner'), null);
});
