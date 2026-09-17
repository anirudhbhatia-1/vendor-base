import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  booleanField,
  dateField,
  expectedVersion,
  integerField,
  nonEmptyStringField,
  nullableInteger,
  nullableString,
  numberField,
  object,
  optionalDate,
  optionalInteger,
  optionalNumber,
  optionalString,
  optionalStrings,
  optionalUuid,
  stringField,
  stringsField,
  uuid,
} from './request-fields.js';

const refuses = (work: () => unknown) => assert.throws(work, BadRequestException);

test('a body is a plain object; arrays, primitives and nothing are refused', () => {
  assert.deepEqual(object({ a: 1 }), { a: 1 });
  for (const value of [null, undefined, 1, 'x', [], true]) refuses(() => object(value));
});

test('strings are strings; blankness is a separate, explicit rule', () => {
  assert.equal(stringField({ k: '' }, 'k'), '');
  refuses(() => stringField({ k: 1 }, 'k'));
  refuses(() => stringField({}, 'k'));
  refuses(() => nonEmptyStringField({ k: '  ' }, 'k'));
  assert.equal(nonEmptyStringField({ k: 'x' }, 'k'), 'x');
});

test('optional fields treat absent and null as absent, and refuse the wrong type', () => {
  assert.equal(optionalString({}, 'k'), undefined);
  assert.equal(optionalString({ k: null }, 'k'), undefined);
  refuses(() => optionalString({ k: 2 }, 'k'));
  assert.equal(nullableString({ k: null }, 'k'), null);
  assert.equal(nullableString({ k: 'v' }, 'k'), 'v');
  assert.equal(optionalInteger({}, 'k'), undefined);
  assert.equal(nullableInteger({ k: null }, 'k'), null);
  assert.equal(optionalNumber({ k: null }, 'k'), undefined);
  assert.equal(optionalStrings({}, 'k'), undefined);
  assert.equal(optionalDate({ k: null }, 'k'), undefined);
  assert.equal(optionalUuid({}, 'k'), undefined);
});

test('integers are safe integers, and a minimum applies only when the caller states one', () => {
  // The defaults that drifted: one controller's minimum was 1, four were 0, the
  // rest had none. There is no default now.
  assert.equal(integerField({ k: 0 }, 'k'), 0);
  assert.equal(integerField({ k: -5 }, 'k'), -5);
  refuses(() => integerField({ k: 0 }, 'k', 1));
  refuses(() => integerField({ k: -1 }, 'k', 0));
  refuses(() => integerField({ k: 1.5 }, 'k'));
  refuses(() => integerField({ k: '1' }, 'k'));
  refuses(() => integerField({ k: Number.MAX_SAFE_INTEGER + 1 }, 'k'));
  assert.equal(expectedVersion({ expected_version: 1 }), 1);
  refuses(() => expectedVersion({ expected_version: 0 }));
});

test('numbers are finite; booleans are booleans; string lists hold only strings', () => {
  assert.equal(numberField({ k: 26.91 }, 'k'), 26.91);
  refuses(() => numberField({ k: Number.NaN }, 'k'));
  refuses(() => numberField({ k: '1' }, 'k'));
  assert.equal(booleanField({ k: false }, 'k'), false);
  refuses(() => booleanField({ k: 'true' }, 'k'));
  assert.deepEqual(stringsField({ k: ['a', 'b'] }, 'k'), ['a', 'b']);
  refuses(() => stringsField({ k: ['a', 1] }, 'k'));
  refuses(() => stringsField({ k: 'a' }, 'k'));
});

test('dates parse or are refused; identifiers are UUIDv7 or are refused', () => {
  assert.equal(
    dateField({ k: '2026-09-15T10:00:00.000Z' }, 'k').toISOString(),
    '2026-09-15T10:00:00.000Z',
  );
  refuses(() => dateField({ k: 'yesterday' }, 'k'));
  refuses(() => dateField({ k: 1_700_000_000 }, 'k'));
  assert.equal(
    uuid('01a09f5f-2547-7c63-9c94-10ccc884d8cd'),
    '01a09f5f-2547-7c63-9c94-10ccc884d8cd',
  );
  refuses(() => uuid('not-a-uuid'));
  refuses(() => uuid('550e8400-e29b-41d4-a716-446655440000')); // v4, not v7
  refuses(() => uuid(undefined));
});
