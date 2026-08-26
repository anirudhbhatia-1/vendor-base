import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createUuidV7 } from '@neighbourhood-store/domain-types';
import {
  LocalProtectedObjectStorage,
  ProtectedObjectInputError,
  ProtectedObjectPermissionError,
  ProtectedObjectRejectedError,
} from './protected-object-storage.js';

const synthetic = new TextEncoder().encode(
  'SYNTHETIC-VERIFICATION-DOCUMENT\nfictional company-test evidence',
);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'neighbourhood-protected-object-'));
  return {
    root,
    storage: new LocalProtectedObjectStorage({
      grant_key: 'synthetic-local-grant-key-material-0001',
      root_directory: root,
    }),
  };
}

test('stores synthetic evidence privately and reads it only with a valid short grant', async () => {
  const { root, storage } = await fixture();
  try {
    const key = `vendor-onboarding/${createUuidV7()}/${createUuidV7()}/object`;
    const stored = await storage.put({
      content: synthetic,
      media_type: 'application/pdf',
      object_key: key,
    });
    const grant = storage.issueReadGrant({ object_key: key, ttl_seconds: 60 });
    const read = await storage.readGranted({ expected_sha256: stored.content_sha256, grant });
    assert.deepEqual(read, synthetic);
    await assert.rejects(
      storage.readGranted({
        expected_sha256: stored.content_sha256,
        grant,
        now: new Date(Date.now() + 61_000),
      }),
      ProtectedObjectPermissionError,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('rejects non-synthetic, scan-rejected, traversal, and checksum-mismatched objects', async () => {
  const { root, storage } = await fixture();
  try {
    const caseId = createUuidV7();
    const key = `vendor-onboarding/${caseId}/${createUuidV7()}/object`;
    await assert.rejects(
      storage.put({
        content: new TextEncoder().encode('real-looking evidence'),
        media_type: 'image/png',
        object_key: key,
      }),
      ProtectedObjectRejectedError,
    );
    await assert.rejects(
      storage.put({
        content: synthetic,
        media_type: 'image/png',
        object_key: key,
        scan_scenario: 'rejected',
      }),
      ProtectedObjectRejectedError,
    );
    assert.throws(
      () => storage.issueReadGrant({ object_key: '../outside', ttl_seconds: 10 }),
      ProtectedObjectInputError,
    );
    const stored = await storage.put({
      content: synthetic,
      media_type: 'image/png',
      object_key: key,
    });
    const grant = storage.issueReadGrant({ object_key: key, ttl_seconds: 10 });
    await assert.rejects(
      storage.readGranted({ expected_sha256: '0'.repeat(64), grant }),
      ProtectedObjectRejectedError,
    );
    assert.equal(stored.scan_state, 'CLEAN');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
