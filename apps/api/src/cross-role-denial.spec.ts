/**
 * Security invariant: every route that carries a RequireAuthorization decorator
 * must use a capability that matches the controller's declared role boundary.
 *
 * Routes protected only by RequireSession or without any auth decorator are
 * audited in a separate list so that any new additions are visible and deliberate.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import {
  AUTHORIZATION_REQUIREMENT,
  SESSION_REQUIREMENT,
  type AuthorizationRequirement,
} from './authorization.js';
import { CustomerCartController } from './customer-cart.controller.js';
import { CustomerPreferencesController } from './customer-preferences.controller.js';
import {
  CustomerFinanceController,
  CompleteMoneyAdminController,
} from './complete-money-lifecycle.controller.js';
import { GroupedCheckoutController } from './grouped-checkout.controller.js';
import { CatalogueProductsController } from './catalogue-products.controller.js';
import { VendorInventoryController } from './vendor-inventory.controller.js';
import { VendorStaffController } from './vendor-staff.controller.js';
import { PartnerAssignmentController } from './assignment-custody.controller.js';
import { PartnerAvailabilityController } from './partner-availability.controller.js';
import { PartnerWaitPolicyController } from './partner-wait-policy.controller.js';
import { PartnerEarningsController } from './partner-lifecycle.controller.js';
import { AdminAccessController } from './admin-access.controller.js';
import { AdminControlPlaneController } from './admin-control-plane.controller.js';
import { AdminOnboardingController } from './admin-onboarding.controller.js';

type ControllerClass = new (...args: never[]) => object;

interface RouteAudit {
  cls: ControllerClass;
  method: string;
  capability: string | undefined;
  sessionOnly: boolean;
  unprotected: boolean;
}

/**
 * Nest records a handler's route path under this metadata key. It is exported as
 * `PATH_METADATA` from `@nestjs/common/constants`, which ships no type
 * declarations, so the key is declared locally.
 */
const PATH_METADATA = 'path';

/** True only for methods Nest actually registers as HTTP routes. */
function isRoute(prototype: object, name: string): boolean {
  const handler = (prototype as Record<string, unknown>)[name];
  return typeof handler === 'function' && Reflect.hasMetadata(PATH_METADATA, handler);
}

/**
 * Lifecycle hooks such as `onApplicationShutdown` are ordinary prototype
 * methods and must not be audited as unprotected endpoints.
 */
function routeMethods(cls: ControllerClass): string[] {
  return Object.getOwnPropertyNames(cls.prototype).filter(
    (name) => name !== 'constructor' && isRoute(cls.prototype, name),
  );
}

function auditController(cls: ControllerClass): RouteAudit[] {
  return routeMethods(cls).map((method) => {
    const req = Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, cls.prototype[method]) as
      AuthorizationRequirement | undefined;
    const session = Reflect.getMetadata(SESSION_REQUIREMENT, cls.prototype[method]) as
      boolean | undefined;
    return {
      cls,
      method,
      capability: req?.capability,
      sessionOnly: !req && !!session,
      unprotected: !req && !session,
    };
  });
}

/** Controllers whose authorized routes are exclusively customer.* capabilities */
const strictlyCustomerControllers: ControllerClass[] = [
  CustomerCartController,
  CustomerFinanceController,
  GroupedCheckoutController,
];

/** Controllers whose authorized routes are exclusively vendor.* capabilities */
const strictlyVendorControllers: ControllerClass[] = [
  CatalogueProductsController,
  VendorInventoryController,
  VendorStaffController,
];

/** Controllers whose authorized routes are exclusively partner.* capabilities */
const strictlyPartnerControllers: ControllerClass[] = [
  PartnerAssignmentController,
  PartnerAvailabilityController,
  PartnerWaitPolicyController,
  PartnerEarningsController,
];

/** Controllers whose authorized routes are exclusively admin.* capabilities */
const strictlyAdminControllers: ControllerClass[] = [
  AdminAccessController,
  AdminControlPlaneController,
  AdminOnboardingController,
  CompleteMoneyAdminController,
];

function capabilityPrefix(audit: RouteAudit): string | undefined {
  return audit.capability?.split('.')[0];
}

test('strictly-customer controllers carry only customer.* capabilities on authorized routes', () => {
  for (const cls of strictlyCustomerControllers) {
    for (const audit of auditController(cls)) {
      if (!audit.capability) continue;
      assert.equal(
        capabilityPrefix(audit),
        'customer',
        `${cls.name}.${audit.method} has capability "${audit.capability}" — expected customer.*`,
      );
    }
  }
});

test('strictly-vendor controllers carry only vendor.* capabilities on authorized routes', () => {
  for (const cls of strictlyVendorControllers) {
    for (const audit of auditController(cls)) {
      if (!audit.capability) continue;
      assert.equal(
        capabilityPrefix(audit),
        'vendor',
        `${cls.name}.${audit.method} has capability "${audit.capability}" — expected vendor.*`,
      );
    }
  }
});

test('strictly-partner controllers carry only partner.* capabilities on authorized routes', () => {
  for (const cls of strictlyPartnerControllers) {
    for (const audit of auditController(cls)) {
      if (!audit.capability) continue;
      assert.equal(
        capabilityPrefix(audit),
        'partner',
        `${cls.name}.${audit.method} has capability "${audit.capability}" — expected partner.*`,
      );
    }
  }
});

test('strictly-admin controllers carry only admin.* capabilities on authorized routes', () => {
  for (const cls of strictlyAdminControllers) {
    for (const audit of auditController(cls)) {
      if (!audit.capability) continue;
      assert.equal(
        capabilityPrefix(audit),
        'admin',
        `${cls.name}.${audit.method} has capability "${audit.capability}" — expected admin.*`,
      );
    }
  }
});

/**
 * Known unprotected routes: webhooks verified by HMAC or routes open by design.
 * Any new additions must be listed here explicitly so the security reviewer sees them.
 */
const KNOWN_UNPROTECTED: ReadonlySet<string> = new Set([
  'CustomerPreferencesController.enrol', // session-only enrolment — before role granted
  'GroupedCheckoutController.webhook', // payment webhook — HMAC verified, no bearer auth
]);

const KNOWN_SESSION_ONLY: ReadonlySet<string> = new Set([
  'CustomerPreferencesController.enrol', // RequireSession, not RequireAuthorization
]);

/**
 * An exemption is keyed by `Controller.method`, so a stale entry lies in wait: add a
 * real route with that name later and it is silently unprotected. This list carried
 * `CatalogueProductsController.map`, described as a "public product map endpoint — no
 * auth required". `map` is a private error translator with no route metadata, so the
 * entry could never match and nothing would have flagged it — while reserving the name
 * `map` on that controller as permanently exempt.
 */
test('every unprotected-route exemption names a route that exists', () => {
  const all = [
    ...strictlyCustomerControllers,
    ...strictlyVendorControllers,
    ...strictlyPartnerControllers,
    ...strictlyAdminControllers,
    CustomerPreferencesController,
    GroupedCheckoutController,
  ];
  const realRoutes = new Set(
    all.flatMap((cls) => routeMethods(cls).map((method) => `${cls.name}.${method}`)),
  );
  const stale = [...KNOWN_UNPROTECTED, ...KNOWN_SESSION_ONLY].filter((key) => !realRoutes.has(key));
  assert.deepEqual(stale, [], 'exemptions must name a real route, or they exempt a future one');
});

test('no new unprotected routes appear without explicit approval', () => {
  const all = [
    ...strictlyCustomerControllers,
    ...strictlyVendorControllers,
    ...strictlyPartnerControllers,
    ...strictlyAdminControllers,
    CustomerPreferencesController,
  ];
  const surprises: string[] = [];
  for (const cls of all) {
    for (const audit of auditController(cls)) {
      const key = `${cls.name}.${audit.method}`;
      if (audit.unprotected && !KNOWN_UNPROTECTED.has(key)) {
        surprises.push(key);
      }
    }
  }
  assert.deepEqual(
    surprises,
    [],
    `New unprotected routes require security review: ${surprises.join(', ')}`,
  );
});

test('known session-only routes have RequireSession and no RequireAuthorization', () => {
  const all = [CustomerPreferencesController];
  for (const cls of all) {
    for (const audit of auditController(cls)) {
      const key = `${cls.name}.${audit.method}`;
      if (KNOWN_SESSION_ONLY.has(key)) {
        assert.equal(audit.sessionOnly, true, `${key} should be session-only`);
        assert.equal(audit.capability, undefined, `${key} should have no capability`);
      }
    }
  }
});
