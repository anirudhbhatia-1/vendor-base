import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IdentityAccessService, IdentitySessionService } from '@neighbourhood-store/database';
import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
} from '@neighbourhood-store/domain-types';
import { firstValueFrom, map, of } from 'rxjs';
import { AuthenticatedActorInterceptor } from './authenticated-actor.interceptor.js';
import { AuthorizationEnforcementService } from './authorization-enforcement.service.js';
import {
  AUTHENTICATED_SESSION,
  AUTHORIZATION_REQUIREMENT,
  AUTHORIZED_ACTOR,
  AUTHORIZED_ROLE,
  SESSION_REQUIREMENT,
  type AuthorizationRequirement,
  type AuthorizedRequest,
} from './authorization.js';
import { AuthorizationGuard } from './authorization.guard.js';
import { currentRequestContext, requestContextStorage } from './request-context-storage.js';

const userId = createUuidV7();
const sessionId = createUuidV7();
const deviceId = createUuidV7();
const deviceRegistrationId = createUuidV7();
const roleAssignmentId = createUuidV7();
const accessToken = `nsa_${'a'.repeat(43)}`;

function executionContext(request: Partial<AuthorizedRequest>): ExecutionContext {
  class TestController {
    readonly authorizationFixture = true;
  }
  return {
    getClass: () => TestController,
    getHandler: () => function testHandler() {},
    switchToHttp: () => ({
      getNext: () => undefined,
      getRequest: () => request,
      getResponse: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

function buildGuard(input: {
  readonly decision?:
    | {
        readonly actor_kind: 'admin' | 'customer' | 'partner' | 'vendor_staff';
        readonly allowed: true;
        readonly capability: string;
        readonly role_assignment_id: string;
        readonly role_key: string;
      }
    | { readonly allowed: false; readonly capability: string; readonly reason: 'DENY_BY_DEFAULT' };
  readonly onEvaluate?: (value: Record<string, unknown>) => void;
  readonly requirement?: AuthorizationRequirement;
  readonly sessionRequired?: boolean;
}) {
  const reflector = {
    getAllAndOverride: (key: symbol) =>
      key === AUTHORIZATION_REQUIREMENT
        ? input.requirement
        : key === SESSION_REQUIREMENT
          ? input.sessionRequired
          : undefined,
  } as unknown as Reflector;
  const sessions = {
    authenticateAccess: async ({ access_token }: { readonly access_token: string }) => {
      assert.equal(access_token, accessToken);
      return {
        client_device_id: deviceId,
        device_registration_id: deviceRegistrationId,
        session_id: sessionId,
        user_id: userId,
      };
    },
  } as unknown as IdentitySessionService;
  const access = {
    evaluate: async (value: Record<string, unknown>) => {
      input.onEvaluate?.(value);
      return (
        input.decision ?? {
          actor_kind: 'customer',
          allowed: true,
          capability: input.requirement?.capability ?? 'customer.account.read',
          role_assignment_id: roleAssignmentId,
          role_key: 'CUSTOMER',
        }
      );
    },
  } as unknown as IdentityAccessService;
  return new AuthorizationGuard(reflector, sessions, new AuthorizationEnforcementService(access));
}

async function activate(
  guard: AuthorizationGuard,
  request: Partial<AuthorizedRequest>,
): Promise<boolean> {
  return requestContextStorage.run(createRequestContext(), () =>
    guard.canActivate(executionContext(request)),
  );
}

test('leaves routes without authorization metadata unchanged', async () => {
  const guard = buildGuard({});
  assert.equal(await activate(guard, { headers: {} }), true);
});

test('declares every guard dependency explicitly for the tsx development runtime', () => {
  const dependencies = Reflect.getMetadata('self:paramtypes', AuthorizationGuard) as
    Array<{ index: number; param: unknown }> | undefined;
  assert.deepEqual(dependencies?.map(({ index }) => index).sort(), [0, 1, 2]);
});

test('rejects a protected route without an opaque access credential', async () => {
  const guard = buildGuard({
    requirement: { capability: 'customer.account.read', conceal_resource: true },
  });
  await assert.rejects(() => activate(guard, { headers: {} }), UnauthorizedException);
});

test('authenticates an explicit session-only route without inferring a role', async () => {
  const guard = buildGuard({ sessionRequired: true });
  const request: Partial<AuthorizedRequest> = {
    headers: { authorization: `Bearer ${accessToken}` },
  };
  assert.equal(await activate(guard, request), true);
  assert.equal(request[AUTHENTICATED_SESSION]?.user_id, userId);
  assert.equal(request[AUTHORIZED_ACTOR], undefined);
  assert.equal(request[AUTHORIZED_ROLE], undefined);
});

test('rejects a session-only route without an opaque access credential', async () => {
  const guard = buildGuard({ sessionRequired: true });
  await assert.rejects(() => activate(guard, { headers: {} }), UnauthorizedException);
});

test('conceals cross-customer reads before capability evaluation', async () => {
  let evaluated = false;
  const guard = buildGuard({
    onEvaluate: () => {
      evaluated = true;
    },
    requirement: {
      capability: 'customer.account.read',
      conceal_resource: true,
      owner_user_id_param: 'customer_user_id',
    },
  });
  await assert.rejects(
    () =>
      activate(guard, {
        headers: { authorization: `Bearer ${accessToken}` },
        params: { customer_user_id: createUuidV7() },
      }),
    NotFoundException,
  );
  assert.equal(evaluated, false);
});

test('passes only declared ownership and scope evidence to the default-deny evaluator', async (t) => {
  const vendorLocationId = createUuidV7();
  const deliveryAssignmentId = createUuidV7();
  const zoneId = createUuidV7();
  const scenarios = [
    {
      actorKind: 'customer' as const,
      params: { customer_user_id: userId },
      requirement: {
        capability: 'customer.account.read',
        conceal_resource: true,
        owner_user_id_param: 'customer_user_id',
      },
      role: 'CUSTOMER',
      verify: (value: Record<string, unknown>) => assert.equal(value.user_id, userId),
    },
    {
      actorKind: 'vendor_staff' as const,
      params: { vendor_location_id: vendorLocationId },
      requirement: {
        capability: 'vendor.order.manage',
        conceal_resource: true,
        vendor_location_id_param: 'vendor_location_id',
      },
      role: 'VENDOR_PICKER',
      verify: (value: Record<string, unknown>) =>
        assert.equal(value.vendor_location_id, vendorLocationId),
    },
    {
      actorKind: 'partner' as const,
      params: { assignment_id: deliveryAssignmentId },
      requirement: {
        capability: 'partner.assignment.act',
        conceal_resource: true,
        delivery_assignment_id_param: 'assignment_id',
      },
      role: 'DELIVERY_PARTNER',
      verify: (value: Record<string, unknown>) =>
        assert.equal(value.delivery_assignment_id, deliveryAssignmentId),
    },
    {
      actorKind: 'admin' as const,
      params: { zone_id: zoneId },
      requirement: {
        admin_scope: { kind: 'ZONE' as const, scope_id_param: 'zone_id' },
        capability: 'admin.support.case_manage',
        conceal_resource: false,
      },
      role: 'SUPPORT_AGENT',
      verify: (value: Record<string, unknown>) =>
        assert.deepEqual(value.admin_scope, { kind: 'ZONE', scope_id: zoneId }),
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.requirement.capability, async () => {
      const guard = buildGuard({
        decision: {
          actor_kind: scenario.actorKind,
          allowed: true,
          capability: scenario.requirement.capability,
          role_assignment_id: roleAssignmentId,
          role_key: scenario.role,
        },
        onEvaluate: scenario.verify,
        requirement: scenario.requirement,
      });
      const request: Partial<AuthorizedRequest> = {
        headers: { authorization: `Bearer ${accessToken}` },
        params: scenario.params,
      };
      assert.equal(await activate(guard, request), true);
      assert.equal(request[AUTHORIZED_ACTOR]?.actor_id, userId);
      assert.equal(
        request[AUTHORIZED_ACTOR]?.actor_kind,
        scenario.actorKind === 'partner' ? 'delivery_partner' : scenario.actorKind,
      );
      assert.equal(request[AUTHORIZED_ROLE]?.role_key, scenario.role);
    });
  }
});

test('returns indistinguishable 404 denial for concealed resources and 403 otherwise', async () => {
  const decision = {
    allowed: false as const,
    capability: 'vendor.order.manage',
    reason: 'DENY_BY_DEFAULT' as const,
  };
  const hidden = buildGuard({
    decision,
    requirement: { capability: decision.capability, conceal_resource: true },
  });
  const explicit = buildGuard({
    decision,
    requirement: { capability: decision.capability, conceal_resource: false },
  });
  const request = { headers: { authorization: `Bearer ${accessToken}` } };
  await assert.rejects(() => activate(hidden, request), NotFoundException);
  await assert.rejects(() => activate(explicit, request), ForbiddenException);
});

test('returns one concealed result for valid object-reference guesses', async () => {
  const guard = buildGuard({
    requirement: {
      capability: 'vendor.order.manage',
      conceal_resource: true,
      vendor_location_id_param: 'vendor_location_id',
    },
    decision: {
      allowed: false,
      capability: 'vendor.order.manage',
      reason: 'DENY_BY_DEFAULT',
    },
  });
  const guesses = Array.from({ length: 16 }, () => createUuidV7());
  for (const vendorLocationId of guesses) {
    await assert.rejects(
      () =>
        activate(guard, {
          headers: { authorization: `Bearer ${accessToken}` },
          params: { vendor_location_id: vendorLocationId },
        }),
      NotFoundException,
    );
  }
  await assert.rejects(
    () =>
      activate(guard, {
        headers: { authorization: `Bearer ${accessToken}` },
        params: { vendor_location_id: 'not-an-opaque-reference' },
      }),
    BadRequestException,
  );
});

test('propagates the verified actor through the complete asynchronous handler context', async () => {
  const actor = createAuthenticatedActor({
    actor_id: userId,
    actor_kind: 'vendor_staff',
    session_id: sessionId,
  });
  const request: Partial<AuthorizedRequest> = { [AUTHORIZED_ACTOR]: actor };
  const interceptor = new AuthenticatedActorInterceptor();
  const root = createRequestContext();
  const handler: CallHandler = {
    handle: () =>
      of(null).pipe(
        map(() => {
          assert.equal(currentRequestContext().request_id, root.request_id);
          return currentRequestContext().actor;
        }),
      ),
  };
  const result = await requestContextStorage.run(root, () =>
    firstValueFrom(interceptor.intercept(executionContext(request), handler)),
  );
  assert.deepEqual(result, actor);
  assert.equal(root.actor, null);
});
