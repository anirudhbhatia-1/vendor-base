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

const OBJECT_KEY = /^vendor-onboarding\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/object$/;
const CHECKSUM = /^[0-9a-f]{64}$/;
const SYNTHETIC_MARKER = new TextEncoder().encode('SYNTHETIC-VERIFICATION-DOCUMENT\n');
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

function containsSyntheticMarker(content: Uint8Array): boolean {
  if (content.length < SYNTHETIC_MARKER.length) return false;
  return SYNTHETIC_MARKER.every((byte, index) => content[index] === byte);
}

function constantTimeEqual(first: string, second: string): boolean {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

export class LocalProtectedObjectStorage implements ProtectedObjectStorage {
  readonly #grantKey: string;
  readonly #root: string;

  constructor(input: { readonly grant_key: string; readonly root_directory: string }) {
    if (input.grant_key.length < 32) {
      throw new Error('Protected object grant key must contain at least 32 characters');
    }
    if (!isAbsolute(input.root_directory)) {
      throw new Error('Protected object root must be an absolute path');
    }
    this.#grantKey = input.grant_key;
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
    if (!MEDIA_TYPES.has(input.media_type)) {
      throw new ProtectedObjectInputError('Protected object media type is unsupported');
    }
    if (input.content.length < 1 || input.content.length > 5 * 1024 * 1024) {
      throw new ProtectedObjectInputError('Protected object must contain 1 byte to 5 MiB');
    }
    if (!containsSyntheticMarker(input.content)) {
      throw new ProtectedObjectRejectedError('Only explicitly synthetic documents are accepted');
    }
    if (input.scan_scenario === 'rejected') {
      throw new ProtectedObjectRejectedError('Synthetic malware scan rejected the object');
    }
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
    const objectKey = requireObjectKey(input.object_key);
    if (!Number.isInteger(input.ttl_seconds) || input.ttl_seconds < 1 || input.ttl_seconds > 300) {
      throw new ProtectedObjectInputError('Protected read grant must expire within 300 seconds');
    }
    const payload = Buffer.from(
      JSON.stringify({ object_key: objectKey, expires_at: Date.now() + input.ttl_seconds * 1000 }),
    ).toString('base64url');
    const signature = createHmac('sha256', this.#grantKey).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  async readGranted(input: {
    readonly expected_sha256: string;
    readonly grant: string;
    readonly now?: Date;
  }): Promise<Uint8Array> {
    if (!CHECKSUM.test(input.expected_sha256)) {
      throw new ProtectedObjectInputError('Expected checksum is invalid');
    }
    const [payload, signature, extra] = input.grant.split('.');
    if (!payload || !signature || extra)
      throw new ProtectedObjectPermissionError('Read grant is invalid');
    const expectedSignature = createHmac('sha256', this.#grantKey)
      .update(payload)
      .digest('base64url');
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
    const destination = await this.#path(parsed.object_key, false);
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
