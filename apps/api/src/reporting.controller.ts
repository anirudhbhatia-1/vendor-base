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
import type { Classification, ReportingService } from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { translateDomainError } from './domain-errors.js';
import { currentRequestContext } from './request-context-storage.js';
import {
  object,
  optionalDate,
  optionalInteger,
  optionalString,
  stringField,
  uuid,
} from './request-fields.js';
import { REPORTING } from './tokens.js';

// Every admin role holds the dashboard capability (0115); which report a
// person may read is the service's decision, by the work the report measures.
const read = RequireAuthorization({
  capability: 'admin.control.dashboard_read',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: true,
});
const readZone = RequireAuthorization({
  capability: 'admin.control.dashboard_read',
  admin_scope: { kind: 'ZONE', scope_id_param: 'service_zone_id' },
  conceal_resource: true,
});
const exporting = RequireAuthorization({
  capability: 'admin.reporting.export',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: true,
});
const exportingZone = RequireAuthorization({
  capability: 'admin.reporting.export',
  admin_scope: { kind: 'ZONE', scope_id_param: 'service_zone_id' },
  conceal_resource: true,
});

function queryDate(value: string | undefined): Date | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException();
  return parsed;
}

function classification(value: string | undefined): Classification | undefined {
  if (value === undefined) return undefined;
  if (value !== 'INTERNAL' && value !== 'RESTRICTED') throw new BadRequestException();
  return value;
}

/**
 * Reports and exports (11.8): seven reports, each read by the people whose
 * work it measures, for the platform or one zone, with every figure defined
 * and its freshness stated; and exports that are snapshots, taken once, by
 * the person who asked, before they lapse. Until audit run 80 these were
 * three routes on the control plane that only incident command could use.
 */
@Controller('admin/reports')
export class ReportingController {
  constructor(@Inject(REPORTING) private readonly reporting: ReportingService) {}

  @Get()
  @read
  async catalogue() {
    try {
      return await this.reporting.catalogue({ context: currentRequestContext() });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('exports')
  @read
  async exports() {
    try {
      return await this.reporting.exports({ context: currentRequestContext() });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('exports/redeem')
  @exporting
  @HttpCode(200)
  async redeem(@Body() raw: unknown) {
    try {
      return await this.reporting.redeemExport({
        context: currentRequestContext(),
        download_token: stringField(object(raw), 'download_token'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('zones/:service_zone_id/:kind')
  @readZone
  async zoneReport(
    @Param('service_zone_id') zone: string,
    @Param('kind') kind: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.#report(kind, from, to, uuid(zone));
  }

  @Post('zones/:service_zone_id/:kind/exports')
  @exportingZone
  async zoneExport(
    @Param('service_zone_id') zone: string,
    @Param('kind') kind: string,
    @Body() raw: unknown,
  ) {
    return this.#export(kind, raw, uuid(zone));
  }

  @Get(':kind')
  @read
  async report(
    @Param('kind') kind: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.#report(kind, from, to);
  }

  @Post(':kind/exports')
  @exporting
  async export(@Param('kind') kind: string, @Body() raw: unknown) {
    return this.#export(kind, raw);
  }

  async #report(kind: string, from?: string, to?: string, zone?: string) {
    const start = queryDate(from);
    const end = queryDate(to);
    try {
      return await this.reporting.report({
        context: currentRequestContext(),
        report_kind: kind,
        ...(zone ? { service_zone_id: zone } : {}),
        ...(start ? { from: start } : {}),
        ...(end ? { to: end } : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  async #export(kind: string, raw: unknown, zone?: string) {
    const input = object(raw);
    try {
      const from = optionalDate(input, 'from');
      const to = optionalDate(input, 'to');
      const level = classification(optionalString(input, 'classification'));
      const minutes = optionalInteger(input, 'expires_in_minutes', 1);
      return await this.reporting.createExport({
        context: currentRequestContext(),
        report_kind: kind,
        ...(zone ? { service_zone_id: zone } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(level ? { classification: level } : {}),
        ...(minutes !== undefined ? { expires_in_minutes: minutes } : {}),
      });
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError)
        throw new BadRequestException();
      translateDomainError(error);
    }
  }
}
