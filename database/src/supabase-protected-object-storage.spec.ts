import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';
import {
  LocalProtectedObjectStorage,
  ProtectedObjectInputError,
  ProtectedObjectNotFoundError,
  ProtectedObjectPermissionError,
  ProtectedObjectRejectedError,
  SupabaseProtectedObjectStorage,
  type SupabaseStorageApi,
  type SupabaseStorageBucketApi,
} from './protected-object-storage.js';

const GRANT_KEY = 'synthetic-protected-object-grant-material-for-tests';
const BUCKETS = { catalogue_images: 'catalogue-public', vendor_onboarding: 'evidence-private' };

const VENDOR_KEY =
  'vendor-onboarding/0199c0de-0000-7000-8000-0000000000a1/0199c0de-0000-7000-8000-0000000000b2/object';
const CATALOGUE_KEY =
  'catalogue-images/0199c0de-0000-7000-8000-0000000000c3/0199c0de-0000-7000-8000-0000000000d4/object';

/** A one-pixel PNG: real magic bytes, so it survives the media-type signature check. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const PNG_SHA256 = createHash('sha256').update(PNG).digest('hex');

interface FakeStorage extends SupabaseStorageApi {
  readonly objects: Map<string, { bucket: string; body: Uint8Array; contentType: string }>;
  readonly uploads: { bucket: string; path: string; upsert: boolean }[];
}

function fakeStorage(): FakeStorage {
  const objects = new Map<string, { bucket: string; body: Uint8Array; contentType: string }>();
  const uploads: { bucket: string; path: string; upsert: boolean }[] = [];
  const bucketApi = (bucket: string): SupabaseStorageBucketApi => ({
    async download(path) {
      const stored = objects.get(`${bucket}/${path}`);
      if (!stored) return { data: null, error: { message: 'Object not found', statusCode: '404' } };
      return {
        data: {
          arrayBuffer: async () =>
            stored.body.buffer.slice(
              stored.body.byteOffset,
              stored.body.byteOffset + stored.body.byteLength,
            ) as ArrayBuffer,
        },
        error: null,
      };
    },
    async remove(paths) {
      for (const path of paths) objects.delete(`${bucket}/${path}`);
      return { error: null };
    },
    async upload(path, body, options) {
      uploads.push({ bucket, path, upsert: options.upsert });
      const address = `${bucket}/${path}`;
      if (objects.has(address) && !options.upsert) {
        return { error: { message: 'The resource already exists', statusCode: '409' } };
      }
      objects.set(address, { bucket, body, contentType: options.contentType });
      return { error: null };
    },
  });
  return { from: bucketApi, objects, uploads };
}

describe('SupabaseProtectedObjectStorage', () => {
  let storage: FakeStorage;
  let subject: SupabaseProtectedObjectStorage;

  beforeEach(() => {
    storage = fakeStorage();
    subject = new SupabaseProtectedObjectStorage({
      buckets: BUCKETS,
      grant_key: GRANT_KEY,
      storage,
    });
  });

  it('keeps quarantined evidence out of the catalogue bucket', async () => {
    await subject.put({ content: PNG, media_type: 'image/png', object_key: VENDOR_KEY });
    await subject.put({ content: PNG, media_type: 'image/png', object_key: CATALOGUE_KEY });
    assert.deepEqual(
      storage.uploads.map((upload) => upload.bucket),
      ['evidence-private', 'catalogue-public'],
    );
  });

  it('refuses a configuration that puts evidence in the catalogue bucket', () => {
    assert.throws(
      () =>
        new SupabaseProtectedObjectStorage({
          buckets: { catalogue_images: 'shared', vendor_onboarding: 'shared' },
          grant_key: GRANT_KEY,
          storage,
        }),
      /must not share a bucket/,
    );
  });

  it('never overwrites an object somebody may already have reviewed', async () => {
    await subject.put({ content: PNG, media_type: 'image/png', object_key: VENDOR_KEY });
    await assert.rejects(
      subject.put({ content: PNG, media_type: 'image/png', object_key: VENDOR_KEY }),
      ProtectedObjectInputError,
    );
    assert.deepEqual(
      storage.uploads.map((upload) => upload.upsert),
      [false, false],
    );
  });

  it('returns the stored bytes for a valid grant', async () => {
    const stored = await subject.put({
      content: PNG,
      media_type: 'image/png',
      object_key: VENDOR_KEY,
    });
    assert.equal(stored.content_sha256, PNG_SHA256);
    assert.equal(stored.scan_state, 'CLEAN');
    const grant = subject.issueReadGrant({ object_key: VENDOR_KEY, ttl_seconds: 30 });
    const bytes = await subject.readGranted({ expected_sha256: PNG_SHA256, grant });
    assert.deepEqual(bytes, PNG);
  });

  it('rejects an object whose bytes no longer match the recorded checksum', async () => {
    await subject.put({ content: PNG, media_type: 'image/png', object_key: VENDOR_KEY });
    // Somebody replaced the object in the bucket behind the application's back.
    storage.objects.set(`evidence-private/${VENDOR_KEY}`, {
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff]),
      bucket: 'evidence-private',
      contentType: 'image/png',
    });
    const grant = subject.issueReadGrant({ object_key: VENDOR_KEY, ttl_seconds: 30 });
    await assert.rejects(
      subject.readGranted({ expected_sha256: PNG_SHA256, grant }),
      ProtectedObjectRejectedError,
    );
  });

  it('reports a missing object rather than a transport failure', async () => {
    const grant = subject.issueReadGrant({ object_key: VENDOR_KEY, ttl_seconds: 30 });
    await assert.rejects(
      subject.readGranted({ expected_sha256: PNG_SHA256, grant }),
      ProtectedObjectNotFoundError,
    );
  });

  it('refuses a grant signed with different key material', async () => {
    await subject.put({ content: PNG, media_type: 'image/png', object_key: VENDOR_KEY });
    const foreign = new SupabaseProtectedObjectStorage({
      buckets: BUCKETS,
      grant_key: 'a-different-synthetic-grant-key-of-sufficient-length',
      storage,
    });
    const grant = foreign.issueReadGrant({ object_key: VENDOR_KEY, ttl_seconds: 30 });
    await assert.rejects(
      subject.readGranted({ expected_sha256: PNG_SHA256, grant }),
      ProtectedObjectPermissionError,
    );
  });

  it('refuses an expired grant', async () => {
    await subject.put({ content: PNG, media_type: 'image/png', object_key: VENDOR_KEY });
    const grant = subject.issueReadGrant({ object_key: VENDOR_KEY, ttl_seconds: 1 });
    await assert.rejects(
      subject.readGranted({
        expected_sha256: PNG_SHA256,
        grant,
        now: new Date(Date.now() + 60_000),
      }),
      ProtectedObjectPermissionError,
    );
  });

  it('treats deleting an already-absent object as the desired end state', async () => {
    await subject.delete(VENDOR_KEY);
    await subject.put({ content: PNG, media_type: 'image/png', object_key: VENDOR_KEY });
    await subject.delete(VENDOR_KEY);
    assert.equal(storage.objects.has(`evidence-private/${VENDOR_KEY}`), false);
  });
});

describe('protected object policy is identical across adapters', () => {
  const local = new LocalProtectedObjectStorage({
    grant_key: GRANT_KEY,
    root_directory: '/tmp/neighbourhood-protected-object-policy-parity',
  });
  const remote = new SupabaseProtectedObjectStorage({
    buckets: BUCKETS,
    grant_key: GRANT_KEY,
    storage: fakeStorage(),
  });

  /** Inputs both adapters must refuse, so a file rejected by one is never taken by the other. */
  const refused: { name: string; input: Parameters<typeof remote.put>[0] }[] = [
    {
      name: 'a media type outside the allow-list',
      input: {
        content: PNG,
        media_type: 'image/gif' as never,
        object_key: VENDOR_KEY,
      },
    },
    {
      name: 'bytes that do not match the declared media type',
      input: {
        content: new Uint8Array([0x00, 0x01, 0x02, 0x03]),
        media_type: 'image/png',
        object_key: VENDOR_KEY,
      },
    },
    {
      name: 'an empty file',
      input: { content: new Uint8Array(), media_type: 'image/png', object_key: VENDOR_KEY },
    },
    {
      name: 'an object the scanner rejected',
      input: {
        content: PNG,
        media_type: 'image/png',
        object_key: VENDOR_KEY,
        scan_scenario: 'rejected',
      },
    },
    {
      name: 'a key that tries to escape its prefix',
      input: {
        content: PNG,
        media_type: 'image/png',
        object_key: 'vendor-onboarding/../../etc/passwd',
      },
    },
  ];

  for (const { name, input } of refused) {
    it(`both adapters refuse ${name}`, async () => {
      await assert.rejects(local.put(input));
      await assert.rejects(remote.put(input));
    });
  }

  it('both adapters cap a read grant at 300 seconds', () => {
    for (const adapter of [local, remote]) {
      assert.throws(
        () => adapter.issueReadGrant({ object_key: VENDOR_KEY, ttl_seconds: 301 }),
        ProtectedObjectInputError,
      );
    }
  });
});
