import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_WORKSPACE_URLS,
  deepLinkToPath,
  resolveWorkspaceUrl,
  staysInWorkspace,
} from '@neighbourhood-store/app-shell/config';

test('the customer app hosts the customer workspace and keeps its navigation inside it', () => {
  const workspace = resolveWorkspaceUrl('customer', {});
  assert.equal(workspace, DEFAULT_WORKSPACE_URLS.customer);
  assert.equal(staysInWorkspace(`${workspace}/`, workspace), true);
  assert.equal(staysInWorkspace('https://elsewhere.example.test/', workspace), false);
  assert.equal(
    deepLinkToPath('neighbourhood-customer://orders', 'neighbourhood-customer'),
    '/orders',
  );
  assert.equal(deepLinkToPath('neighbourhood-other://orders', 'neighbourhood-customer'), null);
});
