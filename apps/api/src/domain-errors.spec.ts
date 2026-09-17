import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpException } from '@nestjs/common';
import {
  AssignmentVersionError,
  DeliveryOtpMismatchError,
  FulfilmentConflictError,
  InventoryUnavailableError,
  MoneyNotFoundError,
  OtpRateLimitedError,
  PickupOtpMissingError,
  VendorPublicationIncompleteError,
} from '@neighbourhood-store/database';
import { ERROR_DEFINITIONS } from '@neighbourhood-store/domain-types';
import { DOMAIN_ERROR_TRANSLATIONS, translateDomainError } from './domain-errors.js';

function answer(error: unknown): { status: number; body: unknown } {
  let raised: unknown;
  try {
    translateDomainError(error);
  } catch (caught) {
    raised = caught;
  }
  assert.ok(raised instanceof HttpException, `translated to ${String(raised)}`);
  return { status: raised.getStatus(), body: raised.getResponse() };
}

test('every literal code in the table is a registered stable code with a matching status', () => {
  const byStatus: Record<string, number> = {
    bad_request: 400,
    unauthorized: 401,
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    unprocessable: 422,
    rate_limited: 429,
    unavailable: 503,
  };
  for (const [kind, translation] of DOMAIN_ERROR_TRANSLATIONS) {
    const code = 'code' in translation ? translation.code : undefined;
    if (typeof code !== 'string') continue;
    const definition = ERROR_DEFINITIONS[code as keyof typeof ERROR_DEFINITIONS];
    assert.ok(definition, `${kind.name} names ${code}, which is not registered`);
    assert.equal(
      definition.http_status,
      byStatus[translation.status],
      `${kind.name}: ${code} is a ${definition.http_status} but the table answers ${translation.status}`,
    );
  }
});

test('a coded domain error answers with the code it carries', () => {
  assert.deepEqual(answer(new FulfilmentConflictError('stale', 'VERSION_CONFLICT')), {
    status: 409,
    body: { error_code: 'VERSION_CONFLICT' },
  });
  assert.deepEqual(answer(new FulfilmentConflictError('not yet')), {
    status: 409,
    body: { error_code: 'ORDER_STATE_CONFLICT' },
  });
  assert.equal(answer(new AssignmentVersionError('moved on')).status, 409);
});

test('distinct outcomes keep distinct codes across status classes', () => {
  assert.deepEqual(answer(new PickupOtpMissingError()).body, { error_code: 'PICKUP_OTP_MISSING' });
  assert.deepEqual(answer(new DeliveryOtpMismatchError()), {
    status: 400,
    body: { error_code: 'DELIVERY_OTP_MISMATCH' },
  });
  assert.equal(answer(new MoneyNotFoundError('x')).status, 404);
  assert.equal(answer(new OtpRateLimitedError('x')).status, 429);
});

test('unprocessable refusals carry their allowlisted detail', () => {
  const stock = answer(new InventoryUnavailableError(3));
  assert.equal(stock.status, 422);
  assert.deepEqual(stock.body, { error_code: 'INVENTORY_UNAVAILABLE', available_quantity: 3 });
  const publication = answer(
    new VendorPublicationIncompleteError([
      { key: 'OPERATING_HOURS', ready: false },
      { key: 'CATALOGUE', ready: true },
    ] as never),
  );
  assert.deepEqual(publication.body, {
    error_code: 'PUBLICATION_INCOMPLETE',
    missing_checks: ['OPERATING_HOURS'],
  });
});

test('an error the table does not know is rethrown as itself', () => {
  const unknown = new Error('a bug');
  assert.throws(
    () => translateDomainError(unknown),
    (raised) => raised === unknown,
  );
  assert.throws(
    () => translateDomainError('not an error'),
    (raised) => raised === 'not an error',
  );
});
