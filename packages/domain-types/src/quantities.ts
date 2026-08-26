import type { Brand } from './brand.js';
import { parseUuidV7, type UuidV7 } from './identifiers.js';
import { createUtcInstant, instantEpochMilliseconds, type UtcInstant } from './time.js';

export type Metres = Brand<number, 'Metres'>;
export type Grams = Brand<number, 'Grams'>;
export type Seconds = Brand<number, 'Seconds'>;
export type DeadlinePolicyKey = Brand<string, 'DeadlinePolicyKey'>;

export interface VersionedDeadline {
  readonly policy_key: DeadlinePolicyKey;
  readonly configuration_version_id: UuidV7;
  readonly starts_at: UtcInstant;
  readonly expires_at: UtcInstant;
}

const POLICY_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

function createNonNegativeInteger<Name extends string>(
  value: number,
  name: Name,
): Brand<number, Name> {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value as Brand<number, Name>;
}

export function createMetres(value: number): Metres {
  return createNonNegativeInteger(value, 'Metres');
}

export function createGrams(value: number): Grams {
  return createNonNegativeInteger(value, 'Grams');
}

export function createSeconds(value: number): Seconds {
  return createNonNegativeInteger(value, 'Seconds');
}

export function createDeadlinePolicyKey(value: string): DeadlinePolicyKey {
  if (!POLICY_KEY_PATTERN.test(value)) {
    throw new TypeError(
      'Deadline policy key must use stable lowercase dot, dash, or underscore notation',
    );
  }
  return value as DeadlinePolicyKey;
}

export function createVersionedDeadline(input: {
  readonly policy_key: string;
  readonly configuration_version_id: string;
  readonly starts_at: string | Date | number;
  readonly expires_at: string | Date | number;
}): VersionedDeadline {
  const startsAt = createUtcInstant(input.starts_at);
  const expiresAt = createUtcInstant(input.expires_at);
  if (instantEpochMilliseconds(expiresAt) <= instantEpochMilliseconds(startsAt)) {
    throw new RangeError('Deadline expires_at must be later than starts_at');
  }

  return Object.freeze({
    policy_key: createDeadlinePolicyKey(input.policy_key),
    configuration_version_id: parseUuidV7(input.configuration_version_id),
    starts_at: startsAt,
    expires_at: expiresAt,
  });
}
