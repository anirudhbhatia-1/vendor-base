import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ConfigurationAdminService,
  ConfigurationApprovalConflictError,
  ConfigurationNotFoundError,
  ConfigurationOverlapError,
  ConfigurationTransitionConflictError,
  type ConfigurationKind,
  type ConfigurationScopeKind,
  type ConfigurationStatus,
} from '@neighbourhood-store/database';
import { parseUuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { CONFIGURATION_ADMIN } from './tokens.js';

function object(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}
function text(value: Record<string, unknown>, key: string) {
  if (typeof value[key] !== 'string') throw new BadRequestException();
  return value[key];
}
function date(value: Record<string, unknown>, key: string) {
  const found = new Date(text(value, key));
  if (!Number.isFinite(found.getTime())) throw new BadRequestException();
  return found;
}
function identity() {
  const context = currentRequestContext();
  if (context.actor?.actor_kind !== 'admin') throw new BadRequestException();
  return {
    actor_id: context.actor.actor_id,
    correlation_id: context.correlation_id,
    request_id: context.request_id,
  };
}
function translate(error: unknown): never {
  if (error instanceof TypeError || error instanceof RangeError) throw new BadRequestException();
  if (error instanceof ConfigurationNotFoundError) throw new BadRequestException();
  if (
    error instanceof ConfigurationTransitionConflictError ||
    error instanceof ConfigurationApprovalConflictError ||
    error instanceof ConfigurationOverlapError
  ) {
    throw new ConflictException(error.message);
  }
  throw error;
}
const propose = RequireAuthorization({
  capability: 'admin.configuration.propose',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: true,
});
const approve = RequireAuthorization({
  capability: 'admin.configuration.approve',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: true,
});

@Controller('admin/configuration')
export class ConfigurationController {
  constructor(
    @Inject(CONFIGURATION_ADMIN) private readonly configuration: ConfigurationAdminService,
  ) {}

  @Get()
  @propose
  list(@Query('status') status?: string) {
    return this.configuration.list({
      ...(status ? { status: status as ConfigurationStatus } : {}),
    });
  }

  @Post('drafts')
  @propose
  async create(@Body() raw: unknown) {
    const input = object(raw);
    try {
      return await this.configuration.create({
        ...identity(),
        configuration_key: text(input, 'configuration_key'),
        configuration_kind: text(input, 'configuration_kind') as ConfigurationKind,
        configuration_value: input['configuration_value'],
        reason_code: text(input, 'reason_code'),
        scope: {
          kind: text(input, 'scope_kind') as ConfigurationScopeKind,
          reference: text(input, 'scope_reference'),
        },
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post(':configuration_version_id/validate')
  @propose
  async validate(@Param('configuration_version_id') id: string, @Body() raw: unknown) {
    try {
      return await this.configuration.validate({
        actor_id: identity().actor_id,
        configuration_version_id: parseUuidV7(id),
        reason_code: text(object(raw), 'reason_code'),
        request_id: identity().request_id,
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post(':configuration_version_id/approve')
  @approve
  async approve(@Param('configuration_version_id') id: string, @Body() raw: unknown) {
    try {
      return await this.configuration.approve({
        actor_id: identity().actor_id,
        configuration_version_id: parseUuidV7(id),
        reason_code: text(object(raw), 'reason_code'),
        request_id: identity().request_id,
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post(':configuration_version_id/schedule')
  @propose
  async schedule(@Param('configuration_version_id') id: string, @Body() raw: unknown) {
    const input = object(raw);
    try {
      return await this.configuration.schedule({
        actor_id: identity().actor_id,
        configuration_version_id: parseUuidV7(id),
        effective_from: date(input, 'effective_from'),
        ...(input['effective_until'] ? { effective_until: date(input, 'effective_until') } : {}),
        reason_code: text(input, 'reason_code'),
        request_id: identity().request_id,
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post(':configuration_version_id/rollback')
  @propose
  async rollback(@Param('configuration_version_id') id: string, @Body() raw: unknown) {
    const input = object(raw);
    try {
      return await this.configuration.rollback({
        ...identity(),
        target_version_id: parseUuidV7(id),
        reason_code: text(input, 'reason_code'),
      });
    } catch (error) {
      translate(error);
    }
  }
}
