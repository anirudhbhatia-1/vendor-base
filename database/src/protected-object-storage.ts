import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export type ProtectedMediaType = 'application/pdf' | 'image/jpeg' | 'image/png';
export type StorageScanScenario = 'clean' | 'rejected';

export interface StoredProtectedObject {
  readonly content_length: number;
  readonly content_sha256: string;
  readonly media_type: ProtectedMediaType;
  readonly object_key: string;
  readonly scan_state: 'CLEAN';
}

export interface ProtectedObjectStorage {
  delete(objectKey: string): Promise<void>;
  issueReadGrant(input: { readonly object_key: string; readonly ttl_seconds: number }): string;
  put(input: {
    readonly content: Uint8Array;
    readonly media_type: ProtectedMediaType;
    readonly object_key: string;
    readonly scan_scenario?: StorageScanScenario;
  }): Promise<StoredProtectedObject>;
  readGranted(input: {
    readonly expected_sha256: string;
    readonly grant: string;
    readonly now?: Date;
  }): Promise<Uint8Array>;
}

export class ProtectedObjectInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}

export class ProtectedObjectRejectedError extends Error {
  readonly code = 'UNPROCESSABLE_ENTITY';
}

export class ProtectedObjectPermissionError extends Error {
  readonly code = 'FORBIDDEN';
}

export class ProtectedObjectNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';
}

const OBJECT_KEY = /^(vendor-onboarding|catalogue-images)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/object$/;
const CHECKSUM = /^[0-9a-f]{64}$/;
const MEDIA_TYPES = new Set<ProtectedMediaType>(['application/pdf', 'image/jpeg', 'image/png']);

function checksum(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function requireObjectKey(value: string): string {
  if (
    isAbsolute(value) ||
    value.includes('..') ||
    value.includes('\\') ||
    !OBJECT_KEY.test(value)
  ) {
    throw new ProtectedObjectInputError('Protected object key is invalid');
  }
  return value;
}

function hasExpectedSignature(content: Uint8Array, mediaType: ProtectedMediaType): boolean {
  if (mediaType === 'application/pdf') {
    return content.length >= 5 && String.fromCharCode(...content.slice(0, 5)) === '%PDF-';
  }
  if (mediaType === 'image/jpeg') {
    return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  }
  return (
    content.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => content[index] === byte)
  );
}

function constantTimeEqual(first: string, second: string): boolean {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

/**
 * Input policy every adapter must apply identically. Kept in one place because two
 * adapters that disagree about what they accept are a way in: a file rejected by
 * the local adapter but taken by the remote one is exactly the drift to prevent.
 */
export function validateProtectedObjectInput(input: {
  readonly content: Uint8Array;
  readonly media_type: ProtectedMediaType;
  readonly scan_scenario?: StorageScanScenario;
}): void {
  if (!MEDIA_TYPES.has(input.media_type)) {
    throw new ProtectedObjectInputError('Protected object media type is unsupported');
  }
  if (input.content.length < 1 || input.content.length > 5 * 1024 * 1024) {
    throw new ProtectedObjectInputError('Protected object must contain 1 byte to 5 MiB');
  }
  if (!hasExpectedSignature(input.content, input.media_type)) {
    throw new ProtectedObjectRejectedError('File contents do not match the declared media type');
  }
  // Scanning precedes storage: a rejected object must never reach a bucket.
  if (input.scan_scenario === 'rejected') {
    throw new ProtectedObjectRejectedError('Malware scan rejected the object');
  }
}

function requireGrantKey(grantKey: string): string {
  if (grantKey.length < 32) {
    throw new Error('Protected object grant key must contain at least 32 characters');
  }
  return grantKey;
}

/** Signs a short-lived, opaque grant naming exactly one object. */
function signReadGrant(
  grantKey: string,
  input: { readonly object_key: string; readonly ttl_seconds: number },
): string {
  const objectKey = requireObjectKey(input.object_key);
  if (!Number.isInteger(input.ttl_seconds) || input.ttl_seconds < 1 || input.ttl_seconds > 300) {
    throw new ProtectedObjectInputError('Protected read grant must expire within 300 seconds');
  }
  const payload = Buffer.from(
    JSON.stringify({ object_key: objectKey, expires_at: Date.now() + input.ttl_seconds * 1000 }),
  ).toString('base64url');
  const signature = createHmac('sha256', grantKey).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

/** Verifies a grant and returns the single object key it authorises. */
function openReadGrant(
  grantKey: string,
  input: { readonly expected_sha256: string; readonly grant: string; readonly now?: Date },
): string {
  if (!CHECKSUM.test(input.expected_sha256)) {
    throw new ProtectedObjectInputError('Expected checksum is invalid');
  }
  const [payload, signature, extra] = input.grant.split('.');
  if (!payload || !signature || extra) {
    throw new ProtectedObjectPermissionError('Read grant is invalid');
  }
  const expectedSignature = createHmac('sha256', grantKey).update(payload).digest('base64url');
  if (!constantTimeEqual(signature, expectedSignature)) {
    throw new ProtectedObjectPermissionError('Read grant is invalid');
  }
  let parsed: { readonly expires_at?: unknown; readonly object_key?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof parsed;
  } catch {
    throw new ProtectedObjectPermissionError('Read grant is invalid');
  }
  if (typeof parsed.object_key !== 'string' || typeof parsed.expires_at !== 'number') {
    throw new ProtectedObjectPermissionError('Read grant is invalid');
  }
  if ((input.now ?? new Date()).getTime() >= parsed.expires_at) {
    throw new ProtectedObjectPermissionError('Read grant has expired');
  }
  return parsed.object_key;
}

export class LocalProtectedObjectStorage implements ProtectedObjectStorage {
  readonly #grantKey: string;
  readonly #root: string;

  constructor(input: { readonly grant_key: string; readonly root_directory: string }) {
    if (!isAbsolute(input.root_directory)) {
      throw new Error('Protected object root must be an absolute path');
    }
    this.#grantKey = requireGrantKey(input.grant_key);
    this.#root = resolve(input.root_directory);
  }

  async #path(objectKey: string, createParent: boolean): Promise<string> {
    const key = requireObjectKey(objectKey);
    await mkdir(this.#root, { mode: 0o700, recursive: true });
    const root = await realpath(this.#root);
    const destination = resolve(root, key);
    const pathFromRoot = relative(root, destination);
    if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === '..' || isAbsolute(pathFromRoot)) {
      throw new ProtectedObjectPermissionError('Object escaped the protected storage root');
    }
    const parent = dirname(destination);
    if (createParent) await mkdir(parent, { mode: 0o700, recursive: true });
    let resolvedParent: string;
    try {
      resolvedParent = await realpath(parent);
    } catch {
      throw new ProtectedObjectNotFoundError('Protected object was not found');
    }
    const parentFromRoot = relative(root, resolvedParent);
    if (
      parentFromRoot.startsWith(`..${sep}`) ||
      parentFromRoot === '..' ||
      isAbsolute(parentFromRoot)
    ) {
      throw new ProtectedObjectPermissionError('Object parent escaped the protected storage root');
    }
    return destination;
  }

  async put(input: {
    readonly content: Uint8Array;
    readonly media_type: ProtectedMediaType;
    readonly object_key: string;
    readonly scan_scenario?: StorageScanScenario;
  }): Promise<StoredProtectedObject> {
    validateProtectedObjectInput(input);
    const destination = await this.#path(input.object_key, true);
    let file;
    try {
      file = await open(destination, 'wx', 0o600);
      await file.writeFile(input.content);
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'EEXIST'
      ) {
        throw new ProtectedObjectInputError('Protected object already exists');
      }
      throw error;
    } finally {
      await file?.close();
    }
    return Object.freeze({
      content_length: input.content.length,
      content_sha256: checksum(input.content),
      media_type: input.media_type,
      object_key: input.object_key,
      scan_state: 'CLEAN' as const,
    });
  }

  issueReadGrant(input: { readonly object_key: string; readonly ttl_seconds: number }): string {
    return signReadGrant(this.#grantKey, input);
  }

  async readGranted(input: {
    readonly expected_sha256: string;
    readonly grant: string;
    readonly now?: Date;
  }): Promise<Uint8Array> {
    const objectKey = openReadGrant(this.#grantKey, input);
    const destination = await this.#path(objectKey, false);
    let content: Buffer;
    try {
      const details = await lstat(destination);
      if (!details.isFile() || details.isSymbolicLink()) {
        throw new ProtectedObjectPermissionError('Protected object path is unsafe');
      }
      const file = await open(destination, 'r');
      try {
        content = await file.readFile();
      } finally {
        await file.close();
      }
    } catch (error: unknown) {
      if (error instanceof ProtectedObjectPermissionError) throw error;
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        throw new ProtectedObjectNotFoundError('Protected object was not found');
      }
      throw error;
    }
    if (checksum(content) !== input.expected_sha256) {
      throw new ProtectedObjectRejectedError('Protected object checksum does not match metadata');
    }
    return new Uint8Array(content);
  }

  async delete(objectKey: string): Promise<void> {
    const destination = await this.#path(objectKey, false);
    try {
      await unlink(destination);
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
  }
}

/**
 * The subset of `@supabase/supabase-js`'s storage client this adapter uses. Declaring
 * it here rather than importing the concrete client keeps the behaviour testable
 * without a network, and keeps the database package from depending on the shape of a
 * client it only needs four methods from.
 */
export interface SupabaseStorageBucketApi {
  // `PromiseLike` because supabase-js returns thenable builders, not plain promises.
  download(path: string): PromiseLike<{
    data: { arrayBuffer(): Promise<ArrayBuffer> } | null;
    error: { message: string; statusCode?: string } | null;
  }>;
  remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
  upload(
    path: string,
    body: Uint8Array,
    options: { readonly contentType: string; readonly upsert: boolean },
  ): PromiseLike<{ error: { message: string; statusCode?: string } | null }>;
}

export interface SupabaseStorageApi {
  from(bucket: string): SupabaseStorageBucketApi;
}

/**
 * D-15 requires approved public catalogue assets and private quarantined evidence to
 * live apart. Routing is by object-key prefix, and both buckets are private here:
 * an approved catalogue image becomes publicly readable through a separate
 * publication step, not by being written to a public bucket in the first place.
 */
export interface ProtectedObjectBuckets {
  readonly catalogue_images: string;
  readonly vendor_onboarding: string;
}

function bucketFor(objectKey: string, buckets: ProtectedObjectBuckets): string {
  return objectKey.startsWith('vendor-onboarding/')
    ? buckets.vendor_onboarding
    : buckets.catalogue_images;
}

function isAlreadyExists(error: { message: string; statusCode?: string }): boolean {
  return error.statusCode === '409' || /already exists/i.test(error.message);
}

function isNotFound(error: { message: string; statusCode?: string }): boolean {
  return error.statusCode === '404' || /not found/i.test(error.message);
}

/**
 * Supabase Storage adapter.
 *
 * It deliberately keeps the opaque HMAC grant rather than returning a Supabase signed
 * URL. A grant is issued and consumed inside the API, which then proxies the bytes and
 * checks them against the checksum recorded with the row. A signed URL would hand the
 * caller something forwardable that bypasses that check, which is weaker than what the
 * local adapter already provides.
 *
 * Not yet exercised against a live Supabase project: no bucket has been provisioned and
 * activation is a separate gate. The behaviour below is covered by contract tests
 * against the documented client shapes.
 */
export class SupabaseProtectedObjectStorage implements ProtectedObjectStorage {
  readonly #buckets: ProtectedObjectBuckets;
  readonly #grantKey: string;
  readonly #storage: SupabaseStorageApi;

  constructor(input: {
    readonly buckets: ProtectedObjectBuckets;
    readonly grant_key: string;
    readonly storage: SupabaseStorageApi;
  }) {
    if (!input.buckets.catalogue_images || !input.buckets.vendor_onboarding) {
      throw new Error('Protected object storage needs a catalogue and an evidence bucket');
    }
    if (input.buckets.catalogue_images === input.buckets.vendor_onboarding) {
      throw new Error('Quarantined evidence must not share a bucket with catalogue assets');
    }
    this.#buckets = input.buckets;
    this.#grantKey = requireGrantKey(input.grant_key);
    this.#storage = input.storage;
  }

  #bucket(objectKey: string): SupabaseStorageBucketApi {
    return this.#storage.from(bucketFor(objectKey, this.#buckets));
  }

  async put(input: {
    readonly content: Uint8Array;
    readonly media_type: ProtectedMediaType;
    readonly object_key: string;
    readonly scan_scenario?: StorageScanScenario;
  }): Promise<StoredProtectedObject> {
    validateProtectedObjectInput(input);
    const objectKey = requireObjectKey(input.object_key);
    // `upsert: false` so a repeated key is refused rather than silently replacing
    // evidence somebody has already reviewed.
    const { error } = await this.#bucket(objectKey).upload(objectKey, input.content, {
      contentType: input.media_type,
      upsert: false,
    });
    if (error) {
      if (isAlreadyExists(error)) {
        throw new ProtectedObjectInputError('Protected object already exists');
      }
      throw new Error(`Protected object upload failed: ${error.message}`);
    }
    return Object.freeze({
      content_length: input.content.length,
      content_sha256: checksum(input.content),
      media_type: input.media_type,
      object_key: objectKey,
      scan_state: 'CLEAN' as const,
    });
  }

  issueReadGrant(input: { readonly object_key: string; readonly ttl_seconds: number }): string {
    return signReadGrant(this.#grantKey, input);
  }

  async readGranted(input: {
    readonly expected_sha256: string;
    readonly grant: string;
    readonly now?: Date;
  }): Promise<Uint8Array> {
    const objectKey = openReadGrant(this.#grantKey, input);
    const { data, error } = await this.#bucket(objectKey).download(objectKey);
    if (error) {
      if (isNotFound(error))
        throw new ProtectedObjectNotFoundError('Protected object was not found');
      throw new Error(`Protected object download failed: ${error.message}`);
    }
    if (!data) throw new ProtectedObjectNotFoundError('Protected object was not found');
    const content = new Uint8Array(await data.arrayBuffer());
    if (checksum(content) !== input.expected_sha256) {
      throw new ProtectedObjectRejectedError('Protected object checksum does not match metadata');
    }
    return content;
  }

  async delete(objectKey: string): Promise<void> {
    const key = requireObjectKey(objectKey);
    const { error } = await this.#bucket(key).remove([key]);
    // Deleting something already gone is the desired end state, not a failure.
    if (error && !isNotFound(error)) {
      throw new Error(`Protected object delete failed: ${error.message}`);
    }
  }
}
