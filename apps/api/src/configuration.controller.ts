import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ConfigurationAdminService,
  type ConfigurationPublicationService,
  type ConfigurationStatus,
} from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { CONFIGURATION_ADMIN, CONFIGURATION_PUBLICATION } from './tokens.js';
import { uuid, dateField, object, stringField } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';

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
const STATUSES = new Set([
  'DRAFT',
  'VALIDATED',
  'APPROVED',
  'SCHEDULED',
  'ACTIVE',
  'SUPERSEDED',
  'REJECTED',
  'CANCELLED',
]);

/**
 * Configuration approval and publication (11.6). The register is read from
 * the versioned configuration; every change goes through the publication
 * service, which knows the catalogue of settings, checks values, previews
 * what they change, and keeps a protected change's approver independent.
 */
@Controller('admin/configuration')
export class ConfigurationController {
  constructor(
    @Inject(CONFIGURATION_ADMIN) private readonly configuration: ConfigurationAdminService,
    @Inject(CONFIGURATION_PUBLICATION)
    private readonly publication: ConfigurationPublicationService,
  ) {}

  @Get()
  @read
  list(@Query('status') status?: string) {
    if (status !== undefined && !STATUSES.has(status)) throw new BadRequestException();
    return this.configuration.list({
      ...(status ? { status: status as ConfigurationStatus } : {}),
    });
  }

  @Get('catalogue')
  @read
  async catalogue() {
    try {
      return await this.publication.catalogue({ context: currentRequestContext() });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get(':configuration_version_id')
  @read
  async detail(@Param('configuration_version_id') id: string) {
    try {
      return await this.publication.detail({
        context: currentRequestContext(),
        configuration_version_id: uuid(id),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get(':configuration_version_id/preview')
  @read
  async preview(@Param('configuration_version_id') id: string) {
    try {
      return await this.publication.preview({
        context: currentRequestContext(),
        configuration_version_id: uuid(id),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('drafts')
  @propose
  async create(@Body() raw: unknown) {
    const input = object(raw);
    try {
      return await this.publication.draft({
        context: currentRequestContext(),
        configuration_key: stringField(input, 'configuration_key'),
        configuration_value: input['configuration_value'],
        reason_code: stringField(input, 'reason_code'),
        scope_kind: stringField(input, 'scope_kind'),
        scope_reference: stringField(input, 'scope_reference'),
      });
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError)
        throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post(':configuration_version_id/validate')
  @propose
  @HttpCode(200)
  async validate(@Param('configuration_version_id') id: string, @Body() raw: unknown) {
    try {
      return await this.publication.validate({
        context: currentRequestContext(),
        configuration_version_id: uuid(id),
        reason_code: stringField(object(raw), 'reason_code'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':configuration_version_id/approve')
  @approve
  @HttpCode(200)
  async approve(@Param('configuration_version_id') id: string, @Body() raw: unknown) {
    try {
      return await this.publication.approve({
        context: currentRequestContext(),
        configuration_version_id: uuid(id),
        reason_code: stringField(object(raw), 'reason_code'),
      });
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError)
        throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post(':configuration_version_id/reject')
  @approve
  @HttpCode(200)
  async reject(@Param('configuration_version_id') id: string, @Body() raw: unknown) {
    try {
      return await this.publication.reject({
        context: currentRequestContext(),
        configuration_version_id: uuid(id),
        reason_code: stringField(object(raw), 'reason_code'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':configuration_version_id/schedule')
  @propose
  @HttpCode(200)
  async schedule(@Param('configuration_version_id') id: string, @Body() raw: unknown) {
    const input = object(raw);
    try {
      return await this.publication.schedule({
        context: currentRequestContext(),
        configuration_version_id: uuid(id),
        effective_from: dateField(input, 'effective_from'),
        ...(input['effective_until']
          ? { effective_until: dateField(input, 'effective_until') }
          : {}),
        reason_code: stringField(input, 'reason_code'),
      });
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError)
        throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post(':configuration_version_id/cancel')
  @propose
  @HttpCode(200)
  async cancel(@Param('configuration_version_id') id: string, @Body() raw: unknown) {
    try {
      return await this.publication.cancel({
        context: currentRequestContext(),
        configuration_version_id: uuid(id),
        reason_code: stringField(object(raw), 'reason_code'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':configuration_version_id/rollback')
  @propose
  async rollback(@Param('configuration_version_id') id: string, @Body() raw: unknown) {
    try {
      return await this.publication.rollback({
        context: currentRequestContext(),
        target_version_id: uuid(id),
        reason_code: stringField(object(raw), 'reason_code'),
      });
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError)
        throw new BadRequestException();
      translateDomainError(error);
    }
  }
}
