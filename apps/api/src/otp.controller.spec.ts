import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { OtpController } from './otp.controller.js';
import { createRequestContext } from '@neighbourhood-store/domain-types';
import {
  CustomerEnrolmentDeniedError,
  type IdentitySessionService,
  type OtpIdentityService,
} from '@neighbourhood-store/database';
import { requestContextStorage } from './request-context-storage.js';

test('customer completion opts into only customer enrolment and keeps native platform', async () => {
  let captured: Record<string, unknown> | undefined;
  const sessions = {
    completeOtpSignIn: async (input: Record<string, unknown>) => {
      captured = input;
      return { customer_enrolled: true };
    },
  } as unknown as IdentitySessionService;
  const controller = new OtpController({} as OtpIdentityService, sessions);
  await requestContextStorage.run(createRequestContext(), () =>
    controller.verify({
      challenge_id: 'challenge',
      code: '123456',
      device_id: 'device',
      customer_enrolment: true,
      platform: 'ANDROID',
      role: 'ADMIN',
      user_id: 'another-user',
    }),
  );
  assert.equal(captured?.customer_enrolment, true);
  assert.equal(captured?.platform, 'ANDROID');
  assert.equal(captured?.role, undefined);
  assert.equal(captured?.user_id, undefined);
});

test('a revoked membership error becomes 403, never session success or a generic 500', async () => {
  const controller = new OtpController(
    {} as OtpIdentityService,
    {
      completeOtpSignIn: async () => {
        throw new CustomerEnrolmentDeniedError('Review required');
      },
    } as unknown as IdentitySessionService,
  );
  await assert.rejects(
    requestContextStorage.run(createRequestContext(), () =>
      controller.verify({
        challenge_id: 'challenge',
        code: '123456',
        device_id: 'device',
        customer_enrolment: true,
      }),
    ),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'getStatus' in error &&
      (error.getStatus as () => number)() === 403,
  );
});

test('malformed customer-enrolment flag is rejected before session processing', async () => {
  const controller = new OtpController({} as OtpIdentityService, {} as IdentitySessionService);
  await assert.rejects(controller.verify({ customer_enrolment: 'ADMIN' }), /Bad Request/);
});

function authorization(method: keyof OtpController): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, OtpController.prototype[method]) as
    AuthorizationRequirement | undefined;
}

test('customerIdentity is protected by customer.account.read and does not conceal the resource', () => {
  const req = authorization('customerIdentity');
  assert.equal(req?.capability, 'customer.account.read');
  assert.equal(req?.conceal_resource, false);
});

test('unauthenticated routes carry no authorization requirement', () => {
  for (const method of ['request', 'verify', 'refresh'] as const) {
    assert.equal(
      authorization(method),
      undefined,
      `${method} must be publicly reachable for OTP flow`,
    );
  }
});

test('session mutation routes carry no role requirement — they rely on the bearer token directly', () => {
  for (const method of ['signOut', 'revokeOther', 'updateNotification', 'list'] as const) {
    assert.equal(
      authorization(method),
      undefined,
      `${method} does not require role-based authorization`,
    );
  }
});
