import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import {
  IdentityAccessService,
  type AdminRole,
  type AdminScopeKind,
} from '@neighbourhood-store/database';
import { parseUuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { ACCESS_IDENTITY } from './tokens.js';
import { object, optionalDate, stringField } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
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
    const scopeKind = stringField(value, 'scope_kind') as AdminScopeKind;
    const validUntil = optionalDate(value, 'valid_until');
    try {
      const roleAssignmentId = await this.access.grantAdminMembership({
        context,
        granted_by_user_id: context.actor.actor_id,
        role: stringField(value, 'role') as AdminRole,
        scope: {
          kind: scopeKind,
          ...(scopeKind === 'GLOBAL'
            ? {}
            : { scope_id: parseUuidV7(stringField(value, 'scope_id')) }),
        },
        user_id: parseUuidV7(userId),
        ...(validUntil ? { valid_until: validUntil } : {}),
      });
      return { role_assignment_id: roleAssignmentId };
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
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
        reason_code: stringField(value, 'reason_code'),
        role_assignment_id: parseUuidV7(roleAssignmentId),
        user_id: parseUuidV7(userId),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
}
