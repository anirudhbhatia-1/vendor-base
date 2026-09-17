import {
  BadRequestException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  IdentitySessionService,
  SessionForbiddenError,
  SessionInvalidError,
  SessionReplayDetectedError,
} from '@neighbourhood-store/database';
import {
  createAuthenticatedActor,
  parseUuidV7,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import {
  AUTHORIZATION_REQUIREMENT,
  AUTHENTICATED_SESSION,
  AUTHORIZED_ACTOR,
  AUTHORIZED_ROLE,
  SESSION_REQUIREMENT,
  type AuthorizationRequirement,
  type AuthorizedRequest,
} from './authorization.js';
import { AuthorizationEnforcementService } from './authorization-enforcement.service.js';
import { currentRequestContext } from './request-context-storage.js';
import { SESSION_IDENTITY } from './tokens.js';
import { SupabaseAuthInvalidTokenError, SupabaseAuthService } from './supabase-auth.service.js';

type BearerKind = { kind: 'nsa'; token: string } | { kind: 'jwt'; token: string };

function bearerToken(value: string | string[] | undefined): BearerKind {
  const header = Array.isArray(value) ? value[0] : value;
  const raw = (header ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!raw) throw new UnauthorizedException();
  if (/^nsa_[A-Za-z0-9_-]{43}$/.test(raw)) return { kind: 'nsa', token: raw };
  // A JWT is three base64url segments separated by dots.
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw))
    return { kind: 'jwt', token: raw };
  throw new UnauthorizedException();
}

function routeUuid(
  params: Record<string, unknown>,
  parameter: string | undefined,
): UuidV7 | undefined {
  if (!parameter) return undefined;
  const value = params[parameter];
  if (typeof value !== 'string') throw new BadRequestException();
  try {
    return parseUuidV7(value);
  } catch {
    throw new BadRequestException();
  }
}

function actorKind(kind: 'admin' | 'customer' | 'partner' | 'vendor_staff') {
  return kind === 'partner' ? 'delivery_partner' : kind;
}

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SESSION_IDENTITY) private readonly sessions: IdentitySessionService,
    @Inject(AuthorizationEnforcementService)
    private readonly enforcement: AuthorizationEnforcementService,
    @Inject(SupabaseAuthService) private readonly supabaseAuth: SupabaseAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<AuthorizationRequirement>(
      AUTHORIZATION_REQUIREMENT,
      [context.getHandler(), context.getClass()],
    );
    const sessionRequired = this.reflector.getAllAndOverride<boolean>(SESSION_REQUIREMENT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requirement && !sessionRequired) return true;

    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    const bearer = bearerToken(request.headers.authorization);
    let principal: import('@neighbourhood-store/database').SessionPrincipal;
    if (bearer.kind === 'jwt') {
      if (!this.supabaseAuth.isConfigured()) throw new UnauthorizedException();
      try {
        const supabasePrincipal = await this.supabaseAuth.verify(bearer.token);
        principal = await this.sessions.bindSupabaseSession({
          context: currentRequestContext(),
          external_session_id: supabasePrincipal.external_session_id,
          user_id: supabasePrincipal.user_id,
        });
      } catch (error) {
        if (
          error instanceof SupabaseAuthInvalidTokenError ||
          error instanceof SessionInvalidError ||
          error instanceof SessionReplayDetectedError ||
          error instanceof SessionForbiddenError
        ) {
          throw new UnauthorizedException();
        }
        throw error;
      }
    } else {
      try {
        principal = await this.sessions.authenticateAccess({
          access_token: bearer.token,
          context: currentRequestContext(),
        });
      } catch (error) {
        if (
          error instanceof SessionInvalidError ||
          error instanceof SessionReplayDetectedError ||
          error instanceof SessionForbiddenError
        ) {
          throw new UnauthorizedException();
        }
        throw error;
      }
    }
    request[AUTHENTICATED_SESSION] = principal;
    if (!requirement) return true;

    const params = (request.params ?? {}) as Record<string, unknown>;
    const ownerUserId = routeUuid(params, requirement.owner_user_id_param);
    const vendorLocationId = routeUuid(params, requirement.vendor_location_id_param);
    const deliveryAssignmentId = routeUuid(params, requirement.delivery_assignment_id_param);
    const adminScopeId = routeUuid(params, requirement.admin_scope?.scope_id_param);
    if (requirement.admin_scope && requirement.admin_scope.kind !== 'GLOBAL' && !adminScopeId) {
      throw new BadRequestException();
    }

    const decision = await this.enforcement.enforce({
      evidence: {
        ...(ownerUserId ? { owner_user_id: ownerUserId } : {}),
        ...(vendorLocationId ? { vendor_location_id: vendorLocationId } : {}),
        ...(deliveryAssignmentId ? { delivery_assignment_id: deliveryAssignmentId } : {}),
        ...(requirement.admin_scope
          ? {
              admin_scope: {
                kind: requirement.admin_scope.kind,
                ...(adminScopeId ? { scope_id: adminScopeId } : {}),
              },
            }
          : {}),
      },
      requirement,
      user_id: principal.user_id,
    });
    request[AUTHORIZED_ACTOR] = createAuthenticatedActor({
      actor_id: principal.user_id,
      actor_kind: actorKind(decision.actor_kind),
      session_id: principal.session_id,
    });
    request[AUTHORIZED_ROLE] = Object.freeze({
      capability: decision.capability,
      role_assignment_id: decision.role_assignment_id,
      role_key: decision.role_key,
    });
    return true;
  }
}
