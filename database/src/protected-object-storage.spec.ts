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

const pdfDocument = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
const pngDocument = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'neighbourhood-protected-object-'));
  return {
    root,
    storage: new LocalProtectedObjectStorage({
      grant_key: 'local-protected-grant-key-material-0001',
      root_directory: root,
    }),
  };
}

test('stores evidence privately and reads it only with a valid short grant', async () => {
  const { root, storage } = await fixture();
  try {
    const key = `vendor-onboarding/${createUuidV7()}/${createUuidV7()}/object`;
    const stored = await storage.put({
      content: pdfDocument,
      media_type: 'application/pdf',
      object_key: key,
    });
    const grant = storage.issueReadGrant({ object_key: key, ttl_seconds: 60 });
    const read = await storage.readGranted({ expected_sha256: stored.content_sha256, grant });
    assert.deepEqual(read, pdfDocument);
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

test('rejects mismatched content, scan rejection, traversal, and checksum mismatch', async () => {
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
        content: pngDocument,
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
      content: pngDocument,
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

test('shares objects and signed grants across API and worker storage instances', async () => {
  const root = await mkdtemp(join(tmpdir(), 'neighbourhood-cross-process-object-'));
  const grantKey = 'cross-process-protected-grant-key-material';
  const apiStorage = new LocalProtectedObjectStorage({
    grant_key: grantKey,
    root_directory: root,
  });
  const workerStorage = new LocalProtectedObjectStorage({
    grant_key: grantKey,
    root_directory: root,
  });
  try {
    const apiKey = `catalogue-images/${createUuidV7()}/${createUuidV7()}/object`;
    const apiWrite = await apiStorage.put({
      content: pngDocument,
      media_type: 'image/png',
      object_key: apiKey,
    });
    assert.deepEqual(
      await workerStorage.readGranted({
        expected_sha256: apiWrite.content_sha256,
        grant: apiStorage.issueReadGrant({ object_key: apiKey, ttl_seconds: 30 }),
      }),
      pngDocument,
    );

    const workerKey = `vendor-onboarding/${createUuidV7()}/${createUuidV7()}/object`;
    const workerWrite = await workerStorage.put({
      content: pdfDocument,
      media_type: 'application/pdf',
      object_key: workerKey,
    });
    assert.deepEqual(
      await apiStorage.readGranted({
        expected_sha256: workerWrite.content_sha256,
        grant: workerStorage.issueReadGrant({ object_key: workerKey, ttl_seconds: 30 }),
      }),
      pdfDocument,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
