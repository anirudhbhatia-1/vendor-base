import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ConfigurationAdminService,
  type ConfigurationKind,
  type ConfigurationScopeKind,
  type ConfigurationStatus,
} from '@neighbourhood-store/database';
import {} from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { CONFIGURATION_ADMIN } from './tokens.js';
import { uuid, dateField, object, stringField } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
function identity() {
  const context = currentRequestContext();
  if (context.actor?.actor_kind !== 'admin') throw new BadRequestException();
  return {
    actor_id: context.actor.actor_id,
    correlation_id: context.correlation_id,
    request_id: context.request_id,
  };
}
const propose = RequireAuthorization({
  capability: 'admin.configuration.propose',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: true,
});
// Reading the register is its own capability (0090), held by both sides of
// the maker-checker pair; it was gated on `propose`, so an approver could not
// see what they were asked to approve.
const read = RequireAuthorization({
  capability: 'admin.configuration.read',
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
  @read
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
        configuration_key: stringField(input, 'configuration_key'),
        configuration_kind: stringField(input, 'configuration_kind') as ConfigurationKind,
        configuration_value: input['configuration_value'],
        reason_code: stringField(input, 'reason_code'),
        scope: {
          kind: stringField(input, 'scope_kind') as ConfigurationScopeKind,
          reference: stringField(input, 'scope_reference'),
        },
      });
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError)
        throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post(':configuration_version_id/validate')
  @propose
  async validate(@Param('configuration_version_id') id: string, @Body() raw: unknown) {
    try {
      return await this.configuration.validate({
        actor_id: identity().actor_id,
        configuration_version_id: uuid(id),
        reason_code: stringField(object(raw), 'reason_code'),
        request_id: identity().request_id,
      });
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError)
        throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post(':configuration_version_id/approve')
  @approve
  async approve(@Param('configuration_version_id') id: string, @Body() raw: unknown) {
    try {
      return await this.configuration.approve({
        actor_id: identity().actor_id,
        configuration_version_id: uuid(id),
        reason_code: stringField(object(raw), 'reason_code'),
        request_id: identity().request_id,
      });
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError)
        throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post(':configuration_version_id/schedule')
  @propose
  async schedule(@Param('configuration_version_id') id: string, @Body() raw: unknown) {
    const input = object(raw);
    try {
      return await this.configuration.schedule({
        actor_id: identity().actor_id,
        configuration_version_id: uuid(id),
        effective_from: dateField(input, 'effective_from'),
        ...(input['effective_until']
          ? { effective_until: dateField(input, 'effective_until') }
          : {}),
        reason_code: stringField(input, 'reason_code'),
        request_id: identity().request_id,
      });
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError)
        throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post(':configuration_version_id/rollback')
  @propose
  async rollback(@Param('configuration_version_id') id: string, @Body() raw: unknown) {
    const input = object(raw);
    try {
      return await this.configuration.rollback({
        ...identity(),
        target_version_id: uuid(id),
        reason_code: stringField(input, 'reason_code'),
      });
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError)
        throw new BadRequestException();
      translateDomainError(error);
    }
  }
}
