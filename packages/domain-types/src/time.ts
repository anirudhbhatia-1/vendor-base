import type { Brand } from './brand.js';

export type UtcInstant = Brand<string, 'UtcInstant'>;
export type IanaTimeZone = Brand<string, 'IanaTimeZone'>;

export interface OperatingTimeContext {
  readonly instant: UtcInstant;
  readonly timezone: IanaTimeZone;
}

const UTC_INPUT_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/;

export function createUtcInstant(value: Date | number | string): UtcInstant {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new RangeError('UTC instant milliseconds must be a safe integer');
  }
  let expectedCanonicalValue: string | undefined;
  if (typeof value === 'string') {
    const match = UTC_INPUT_PATTERN.exec(value);
    if (!match) throw new TypeError('UTC instant must be an ISO 8601 timestamp ending in Z');
    expectedCanonicalValue = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('UTC instant is invalid');
  const canonicalValue = date.toISOString();
  if (expectedCanonicalValue && canonicalValue !== expectedCanonicalValue) {
    throw new TypeError('UTC instant contains an invalid calendar date or time');
  }
  return canonicalValue as UtcInstant;
}

export function createIanaTimeZone(value: string): IanaTimeZone {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
  } catch {
    throw new TypeError('Timezone must be a valid IANA timezone name');
  }
  return value as IanaTimeZone;
}

export function createOperatingTimeContext(
  instant: UtcInstant | Date | number | string,
  timezone: IanaTimeZone | string,
): OperatingTimeContext {
  return Object.freeze({
    instant: createUtcInstant(instant),
    timezone: createIanaTimeZone(timezone),
  });
}

export function instantEpochMilliseconds(value: UtcInstant): number {
  return new Date(value).getTime();
}
