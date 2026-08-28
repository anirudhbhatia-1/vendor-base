import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import {
  AccessConflictError,
  AccessInputError,
  IdentityAccessService,
  type AdminRole,
  type AdminScopeKind,
} from '@neighbourhood-store/database';
import { parseUuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { ACCESS_IDENTITY } from './tokens.js';

function object(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}
function text(value: Record<string, unknown>, key: string) {
  if (typeof value[key] !== 'string') throw new BadRequestException();
  return value[key];
}
function optionalDate(value: Record<string, unknown>, key: string) {
  if (value[key] === undefined || value[key] === null) return undefined;
  const date = new Date(text(value, key));
  if (!Number.isFinite(date.getTime())) throw new BadRequestException();
  return date;
}
function translate(error: unknown): never {
  if (error instanceof AccessInputError || error instanceof TypeError)
    throw new BadRequestException();
  if (error instanceof AccessConflictError) throw new ConflictException(error.message);
  throw error;
}
const manage = RequireAuthorization({
  capability: 'admin.access.role_manage',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: true,
});

@Controller('admin/access')
export class AdminAccessController {
  constructor(@Inject(ACCESS_IDENTITY) private readonly access: IdentityAccessService) {}

  @Post('users/:user_id/memberships')
  @manage
  @HttpCode(201)
  async grant(@Param('user_id') userId: string, @Body() raw: unknown) {
    const value = object(raw);
    const context = currentRequestContext();
    if (context.actor?.actor_kind !== 'admin') throw new ForbiddenException();
    const scopeKind = text(value, 'scope_kind') as AdminScopeKind;
    const validUntil = optionalDate(value, 'valid_until');
    try {
      const roleAssignmentId = await this.access.grantAdminMembership({
        context,
        granted_by_user_id: context.actor.actor_id,
        role: text(value, 'role') as AdminRole,
        scope: {
          kind: scopeKind,
          ...(scopeKind === 'GLOBAL' ? {} : { scope_id: parseUuidV7(text(value, 'scope_id')) }),
        },
        user_id: parseUuidV7(userId),
        ...(validUntil ? { valid_until: validUntil } : {}),
      });
      return { role_assignment_id: roleAssignmentId };
    } catch (error) {
      translate(error);
    }
  }

  @Post('users/:user_id/memberships/:role_assignment_id/revoke')
  @manage
  @HttpCode(204)
  async revoke(
    @Param('user_id') userId: string,
    @Param('role_assignment_id') roleAssignmentId: string,
    @Body() raw: unknown,
  ) {
    const value = object(raw);
    try {
      await this.access.revokeRole({
        context: currentRequestContext(),
        reason_code: text(value, 'reason_code'),
        role_assignment_id: parseUuidV7(roleAssignmentId),
        user_id: parseUuidV7(userId),
      });
    } catch (error) {
      translate(error);
    }
  }
}
