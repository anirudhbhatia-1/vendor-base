import { BadRequestException } from '@nestjs/common';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';

/**
 * The request-body readers every controller shares.
 *
 * Each controller carried its own copy of `object`, `stringField`, `uuid` and
 * whichever others it needed, and the copies drifted: `integerField` refused
 * zero in one controller and negatives in four, `optionalString` treated null
 * as a value in some places and as absence in others. A malformed field is a
 * 400 with no detail -- the shape is the contract, and the clients are ours.
 *
 * Rules that apply everywhere: absent and `null` are both "absent" for an
 * optional field; a `nullable` field returns `null` for both; integers are
 * safe integers with no default minimum; identifiers are UUIDv7.
 */
export type Body = Record<string, unknown>;

function refuse(): never {
  throw new BadRequestException();
}

function present(body: Body, key: string): boolean {
  const found = body[key];
  return found !== undefined && found !== null;
}

export function object(value: unknown): Body {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse();
  return value as Body;
}

export function stringField(body: Body, key: string): string {
  const found = body[key];
  if (typeof found !== 'string') refuse();
  return found;
}

export function nonEmptyStringField(body: Body, key: string): string {
  const found = stringField(body, key);
  if (found.trim() === '') refuse();
  return found;
}

export function optionalString(body: Body, key: string): string | undefined {
  return present(body, key) ? stringField(body, key) : undefined;
}

export function nullableString(body: Body, key: string): string | null {
  return present(body, key) ? stringField(body, key) : null;
}

export function stringsField(body: Body, key: string): readonly string[] {
  const found = body[key];
  if (!Array.isArray(found) || !found.every((entry) => typeof entry === 'string')) refuse();
  return found as string[];
}

export function optionalStrings(body: Body, key: string): readonly string[] | undefined {
  return present(body, key) ? stringsField(body, key) : undefined;
}

/**
 * A minimum applies only when the caller states one: the defaults that used to
 * differ between controllers are gone.
 */
export function integerField(body: Body, key: string, minimum?: number): number {
  const found = body[key];
  if (typeof found !== 'number' || !Number.isSafeInteger(found)) refuse();
  if (minimum !== undefined && found < minimum) refuse();
  return found;
}

export function optionalInteger(body: Body, key: string, minimum?: number): number | undefined {
  return present(body, key) ? integerField(body, key, minimum) : undefined;
}

export function nullableInteger(body: Body, key: string, minimum?: number): number | null {
  return present(body, key) ? integerField(body, key, minimum) : null;
}

/** A version to compare against is at least 1: a row that exists has been written once. */
export function expectedVersion(body: Body): number {
  return integerField(body, 'expected_version', 1);
}

export function numberField(body: Body, key: string): number {
  const found = body[key];
  if (typeof found !== 'number' || !Number.isFinite(found)) refuse();
  return found;
}

export function optionalNumber(body: Body, key: string): number | undefined {
  return present(body, key) ? numberField(body, key) : undefined;
}

export function booleanField(body: Body, key: string): boolean {
  const found = body[key];
  if (typeof found !== 'boolean') refuse();
  return found;
}

/** An ISO-8601 string; a numeric timestamp is refused rather than guessed at. */
export function dateField(body: Body, key: string): Date {
  const found = body[key];
  if (typeof found !== 'string') refuse();
  const parsed = new Date(found);
  if (Number.isNaN(parsed.getTime())) refuse();
  return parsed;
}

export function optionalDate(body: Body, key: string): Date | undefined {
  return present(body, key) ? dateField(body, key) : undefined;
}

export function uuid(value: unknown): UuidV7 {
  if (typeof value !== 'string') refuse();
  try {
    return parseUuidV7(value);
  } catch {
    refuse();
  }
}

export function optionalUuid(body: Body, key: string): UuidV7 | undefined {
  return present(body, key) ? uuid(body[key]) : undefined;
}

/**
 * Query-string readers. Query values arrive as strings (or string arrays), and
 * several controllers converted them with a bare `Number(...)`, so `?limit=abc`
 * reached the service as NaN and surfaced as a 500. Absent and empty are both
 * "absent" for the optional readers; a malformed value is a 400.
 */
type QueryValue = string | readonly string[] | undefined;

function singleQuery(value: QueryValue): string | undefined {
  const found = Array.isArray(value) ? value[0] : value;
  return found === undefined || found === '' ? undefined : (found as string);
}

/** A whole number (digits only), e.g. a limit, offset or radius. */
export function optionalWholeQuery(value: QueryValue): number | undefined {
  const found = singleQuery(value);
  if (found === undefined) return undefined;
  if (!/^\d{1,15}$/.test(found)) refuse();
  return Number(found);
}

/** A finite decimal, e.g. a coordinate. */
export function decimalQuery(value: QueryValue): number {
  const found = singleQuery(value);
  if (found === undefined) refuse();
  const parsed = Number(found);
  if (!Number.isFinite(parsed)) refuse();
  return parsed;
}

export function optionalDecimalQuery(value: QueryValue): number | undefined {
  return singleQuery(value) === undefined ? undefined : decimalQuery(value);
}
