import type { Brand } from './brand.js';

export type UuidV7 = Brand<string, 'UuidV7'>;
export type RequestId = Brand<UuidV7, 'RequestId'>;
export type PublicReference = Brand<string, 'PublicReference'>;

export const PUBLIC_REFERENCE_PREFIXES = ['CG', 'ORD', 'JOB', 'CASE', 'APR'] as const;
export type PublicReferencePrefix = (typeof PUBLIC_REFERENCE_PREFIXES)[number];

export type RandomBytes = (length: number) => Uint8Array;

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PUBLIC_REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const PUBLIC_REFERENCE_PATTERN = /^([A-Z]{2,4})-([23456789A-HJ-NP-Z]{5})([23456789A-HJ-NP-Z])$/;
const MAX_UUID_TIMESTAMP = 0xffffffffffff;

/**
 * Typed structurally so this package compiles under any `lib` -- it is
 * consumed by Node services, browsers and React Native alike, and each
 * type-checks this source against its own globals.
 */
type RandomSource = { getRandomValues<T extends ArrayBufferView>(array: T): T };

export function secureRandomBytes(length: number): Uint8Array {
  const cryptoApi = (globalThis as { crypto?: RandomSource }).crypto;
  if (!cryptoApi) throw new Error('Secure random generation is unavailable');
  return cryptoApi.getRandomValues(new Uint8Array(length));
}

function requireRandomBytes(source: RandomBytes, length: number): Uint8Array {
  const bytes = source(length);
  if (bytes.length !== length) {
    throw new RangeError(`Random source returned ${bytes.length} bytes; expected ${length}`);
  }
  return bytes;
}

function byteToHex(value: number): string {
  return value.toString(16).padStart(2, '0');
}

export function createUuidV7(
  options: {
    readonly now_ms?: number;
    readonly random_bytes?: RandomBytes;
  } = {},
): UuidV7 {
  const nowMs = options.now_ms ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > MAX_UUID_TIMESTAMP) {
    throw new RangeError('UUIDv7 timestamp must be a non-negative 48-bit integer');
  }

  const bytes = requireRandomBytes(options.random_bytes ?? secureRandomBytes, 16);
  let timestamp = nowMs;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  const hex = Array.from(bytes, byteToHex).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as UuidV7;
}

export function isUuidV7(value: string): value is UuidV7 {
  return UUID_V7_PATTERN.test(value);
}

export function parseUuidV7(value: string): UuidV7 {
  const normalized = value.toLowerCase();
  if (!isUuidV7(normalized)) throw new TypeError('Expected a valid UUIDv7 identifier');
  return normalized;
}

export function uuidV7Timestamp(value: UuidV7): number {
  return Number.parseInt(value.replaceAll('-', '').slice(0, 12), 16);
}

export function createRequestId(
  options: {
    readonly now_ms?: number;
    readonly random_bytes?: RandomBytes;
  } = {},
): RequestId {
  return createUuidV7(options) as RequestId;
}

export function parseRequestId(value: string): RequestId {
  return parseUuidV7(value) as RequestId;
}

function referenceChecksum(prefix: string, body: string): string {
  let checksum = 17;
  for (const character of `${prefix}${body}`) {
    checksum = (checksum * 31 + character.charCodeAt(0)) % PUBLIC_REFERENCE_ALPHABET.length;
  }
  return PUBLIC_REFERENCE_ALPHABET.charAt(checksum);
}

function randomReferenceBody(source: RandomBytes): string {
  const characters: string[] = [];
  for (let attempt = 0; characters.length < 5 && attempt < 32; attempt += 1) {
    const bytes = requireRandomBytes(source, 5 - characters.length);
    for (const byte of bytes) {
      if (byte >= 224) continue;
      characters.push(PUBLIC_REFERENCE_ALPHABET.charAt(byte % PUBLIC_REFERENCE_ALPHABET.length));
    }
  }
  if (characters.length < 5)
    throw new Error('Random source could not produce an unbiased reference');
  return characters.join('');
}

export function createPublicReference(
  prefix: PublicReferencePrefix,
  randomBytes: RandomBytes = secureRandomBytes,
): PublicReference {
  if (!PUBLIC_REFERENCE_PREFIXES.includes(prefix)) {
    throw new TypeError('Unsupported public-reference prefix');
  }
  const body = randomReferenceBody(randomBytes);
  return `${prefix}-${body}${referenceChecksum(prefix, body)}` as PublicReference;
}

export function isPublicReference(value: string): value is PublicReference {
  const match = PUBLIC_REFERENCE_PATTERN.exec(value);
  if (!match) return false;
  const prefix = match[1] ?? '';
  const body = match[2] ?? '';
  const checksum = match[3] ?? '';
  return (
    PUBLIC_REFERENCE_PREFIXES.includes(prefix as PublicReferencePrefix) &&
    checksum === referenceChecksum(prefix, body)
  );
}

export function parsePublicReference(value: string): PublicReference {
  const normalized = value.toUpperCase();
  if (!isPublicReference(normalized)) {
    throw new TypeError('Expected a valid public reference with checksum');
  }
  return normalized;
}
