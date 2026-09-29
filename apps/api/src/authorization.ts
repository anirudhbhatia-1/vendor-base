import { SetMetadata } from '@nestjs/common';
import type { SessionPrincipal } from '@neighbourhood-store/database';
import type { AuthenticatedActor } from '@neighbourhood-store/domain-types';
import type { FastifyRequest } from 'fastify';

export const AUTHORIZATION_REQUIREMENT = Symbol('AUTHORIZATION_REQUIREMENT');
export const SESSION_REQUIREMENT = Symbol('SESSION_REQUIREMENT');
export const AUTHENTICATED_SESSION = Symbol('AUTHENTICATED_SESSION');
export const AUTHORIZED_ACTOR = Symbol('AUTHORIZED_ACTOR');
export const AUTHORIZED_ROLE = Symbol('AUTHORIZED_ROLE');

export interface AuthorizationRequirement {
  readonly admin_scope?: {
    readonly kind: 'GLOBAL' | 'VENDOR_LOCATION' | 'ZONE';
    readonly scope_id_param?: string;
  };
  readonly capability: string;
  readonly conceal_resource: boolean;
  readonly delivery_assignment_id_param?: string;
  readonly owner_user_id_param?: string;
  readonly vendor_location_id_param?: string;
}

export interface AuthorizedRoleEvidence {
  readonly capability: string;
  readonly role_assignment_id: string;
  readonly role_key: string;
}

export type AuthorizedRequest = FastifyRequest & {
  [AUTHENTICATED_SESSION]?: SessionPrincipal;
  [AUTHORIZED_ACTOR]?: AuthenticatedActor;
  [AUTHORIZED_ROLE]?: AuthorizedRoleEvidence;
};

export const PUBLIC_ROUTE = Symbol('PUBLIC_ROUTE');

/**
 * Marks a route as intentionally unauthenticated.
 *
 * Routes are denied by default: a handler with no decorator at all is refused
 * by the guard, so an exposed route is always a written decision with a stated
 * reason, never a forgotten decorator. public-routes.spec.ts asserts the exact
 * list of routes carrying this.
 */
export function Public(reason: string): MethodDecorator & ClassDecorator {
  if (reason.trim().length < 10) {
    throw new Error('A public route must state a real reason');
  }
  return SetMetadata(PUBLIC_ROUTE, reason);
}

export function RequireSession(): MethodDecorator {
  return SetMetadata(SESSION_REQUIREMENT, true);
}

export function RequireAuthorization(requirement: AuthorizationRequirement): MethodDecorator {
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*){2,5}$/.test(requirement.capability)) {
    throw new Error('Authorization capability metadata is invalid');
  }
  if (
    requirement.admin_scope &&
    ((requirement.admin_scope.kind === 'GLOBAL' && requirement.admin_scope.scope_id_param) ||
      (requirement.admin_scope.kind !== 'GLOBAL' && !requirement.admin_scope.scope_id_param))
  ) {
    throw new Error('Authorization admin-scope metadata is invalid');
  }
  return SetMetadata(AUTHORIZATION_REQUIREMENT, Object.freeze({ ...requirement }));
}
