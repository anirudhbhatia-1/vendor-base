import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
  type ArgumentsHost,
} from '@nestjs/common';
import { RequestExceptionFilter } from './request-exception.filter.js';

interface Captured {
  readonly body: unknown;
  readonly status: number;
}

function host(request: { method?: string; routeOptions?: { url?: string } }): {
  captured: Captured[];
  host: ArgumentsHost;
} {
  const captured: Captured[] = [];
  let status = 0;
  const reply = {
    code(next: number) {
      status = next;
      return this;
    },
    send(body: unknown) {
      captured.push({ body, status });
      return this;
    },
  };
  return {
    captured,
    host: {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
    } as unknown as ArgumentsHost,
  };
}

/**
 * Every authorization denial is a thrown exception, so it never reaches the interceptor
 * that logs method and route on the success path. Without them here, a concealed 404
 * for someone probing another customer's records looked exactly like a dead link, on
 * every route in the API — and the concealed response is deliberately identical, so the
 * log is the only place the attempt can be seen.
 */
test('a denial records the route that was probed', () => {
  const lines: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const target = host({
      method: 'GET',
      routeOptions: { url: '/customer/addresses/:customer_address_id/eligible-vendor-locations' },
    });
    new RequestExceptionFilter().catch(new NotFoundException(), target.host);
  } finally {
    process.stdout.write = write;
  }
  const failure = lines
    .map((line) => JSON.parse(line))
    .find((l) => l.event === 'http.request.failed');
  assert.equal(failure.status, 404);
  assert.equal(failure.method, 'GET');
  assert.equal(
    failure.route,
    '/customer/addresses/:customer_address_id/eligible-vendor-locations',
    'the route pattern makes the attempt attributable',
  );
  assert.equal(
    String(failure.route).includes('01a0'),
    false,
    'the pattern carries the parameter name, never the value',
  );
});

test('two denials on different routes are distinguishable', () => {
  const lines: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const filter = new RequestExceptionFilter();
    filter.catch(
      new ForbiddenException(),
      host({ method: 'GET', routeOptions: { url: '/a/:id' } }).host,
    );
    filter.catch(new NotFoundException(), host({ method: 'POST', routeOptions: {} }).host);
  } finally {
    process.stdout.write = write;
  }
  const routes = lines
    .map((line) => JSON.parse(line))
    .filter((l) => l.event === 'http.request.failed')
    .map((l) => l.route);
  assert.deepEqual(routes, ['/a/:id', 'unmatched']);
});

test('a declared stable code survives, and an undeclared conflict still reads as a version conflict', () => {
  // The whole 409 family was reported as VERSION_CONFLICT, whose client wording is
  // "Refresh and try again". A delivery partner refused because the vendor had not
  // handed the order over was told to retry, and did -- nine identical POSTs from
  // one partner in one session.
  const stateConflict = host({ method: 'POST', routeOptions: { url: '/partner/x/pickup' } });
  new RequestExceptionFilter().catch(
    new ConflictException({ error_code: 'ORDER_STATE_CONFLICT' }),
    stateConflict.host,
  );
  assert.equal(stateConflict.captured[0]?.status, 409);
  assert.equal(
    (stateConflict.captured[0]?.body as { error: { code: string } }).error.code,
    'ORDER_STATE_CONFLICT',
  );

  // A conflict that declares nothing keeps the status-derived code, so existing
  // callers are unaffected.
  const bare = host({ method: 'POST', routeOptions: { url: '/partner/x/pickup' } });
  new RequestExceptionFilter().catch(new ConflictException(), bare.host);
  assert.equal(
    (bare.captured[0]?.body as { error: { code: string } }).error.code,
    'VERSION_CONFLICT',
  );
});

test('a controller cannot smuggle an unrelated code or a raw message into the response', () => {
  // The filter deliberately discards exception bodies -- a concealed 404 has to
  // stay concealed. Honouring a declared code must not reopen that: the code has
  // to be a real one, and it has to belong to the status being sent.
  const mismatched = host({ method: 'GET', routeOptions: { url: '/x' } });
  new RequestExceptionFilter().catch(
    // FORBIDDEN is a real code, but it is a 403 and this is a 400.
    new BadRequestException({ error_code: 'FORBIDDEN' }),
    mismatched.host,
  );
  assert.equal(
    (mismatched.captured[0]?.body as { error: { code: string } }).error.code,
    'INVALID_ARGUMENT',
  );

  const invented = host({ method: 'GET', routeOptions: { url: '/x' } });
  new RequestExceptionFilter().catch(
    new ConflictException({ error_code: 'VENDOR_HAS_NOT_HANDED_OVER', message: 'internal detail' }),
    invented.host,
  );
  const body = invented.captured[0]?.body as { error: { code: string } };
  assert.equal(body.error.code, 'VERSION_CONFLICT');
  assert.ok(!JSON.stringify(body).includes('internal detail'), 'no raw message reached the client');
});

test('a refusal carries the detail that explains it, and nothing else', () => {
  // `missing_checks` is the publication checklist -- the entire point of the
  // feature -- and it was discarded, leaving "That is not allowed in the current
  // state". Same for `available_quantity`, which is the number the shopper needs.
  const publication = host({ method: 'POST', routeOptions: { url: '/vendor/x/publish' } });
  new RequestExceptionFilter().catch(
    new UnprocessableEntityException({
      error_code: 'PUBLICATION_INCOMPLETE',
      missing_checks: ['CATALOGUE_REVIEWED', 'HOURS_SET'],
      internal_note: 'operator eyes only',
    }),
    publication.host,
  );
  const body = publication.captured[0]?.body as {
    error: { code: string; details: Record<string, unknown> };
  };
  assert.equal(publication.captured[0]?.status, 422);
  assert.equal(body.error.code, 'PUBLICATION_INCOMPLETE');
  assert.deepEqual(body.error.details.missing_checks, ['CATALOGUE_REVIEWED', 'HOURS_SET']);
  // The allowlist is the point: an unlisted key does not cross just because a
  // controller attached it.
  assert.equal('internal_note' in body.error.details, false);
  assert.ok(!JSON.stringify(body).includes('operator eyes only'));

  const stock = host({ method: 'PUT', routeOptions: { url: '/vendor/x/stock' } });
  new RequestExceptionFilter().catch(
    new UnprocessableEntityException({
      available_quantity: 1,
      error_code: 'INVENTORY_UNAVAILABLE',
    }),
    stock.host,
  );
  const stockBody = stock.captured[0]?.body as {
    error: { code: string; details: Record<string, unknown> };
  };
  assert.equal(stockBody.error.code, 'INVENTORY_UNAVAILABLE');
  assert.equal(stockBody.error.details.available_quantity, 1);

  // A refusal that carries nothing still answers with an empty detail map rather
  // than an absent field, so a client never has to guess the shape.
  const plain = host({ method: 'GET', routeOptions: { url: '/x' } });
  new RequestExceptionFilter().catch(new NotFoundException(), plain.host);
  assert.deepEqual((plain.captured[0]?.body as { error: { details: unknown } }).error.details, {});
});
