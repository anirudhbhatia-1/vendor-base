import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import type { IncidentAction, IncidentControlService } from '@neighbourhood-store/database';
import { Public, RequireAuthorization } from './authorization.js';
import { translateDomainError } from './domain-errors.js';
import { currentRequestContext } from './request-context-storage.js';
import {
  dateField,
  expectedVersion,
  object,
  optionalDate,
  optionalInteger,
  optionalUuid,
  stringField,
  uuid,
} from './request-fields.js';
import { INCIDENT_CONTROLS } from './tokens.js';

const manage = RequireAuthorization({
  capability: 'admin.incident.manage',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: true,
});
const ACTIONS = new Set<IncidentAction>(['APPROVE', 'REJECT', 'REVIEW', 'CHECK', 'REVOKE']);

/**
 * Incident controls (11.7): preview what a pause stops and what carries on,
 * engage it (or propose it for a second person), review it, work its
 * recovery checklist and lift it. Until audit run 79 these were three routes
 * on the control plane that overwrote the last engagement.
 */
@Controller('admin/incidents')
export class IncidentControlsController {
  constructor(@Inject(INCIDENT_CONTROLS) private readonly incidents: IncidentControlService) {}

  @Get('catalogue')
  @manage
  catalogue() {
    return this.incidents.catalogue();
  }

  @Get()
  @manage
  async list() {
    try {
      return await this.incidents.list({ context: currentRequestContext() });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('preview')
  @manage
  @HttpCode(200)
  async preview(@Body() raw: unknown) {
    const input = object(raw);
    try {
      return await this.incidents.preview({
        context: currentRequestContext(),
        control_key: stringField(input, 'control_key'),
        scope_kind: stringField(input, 'scope_kind'),
        scope_reference: stringField(input, 'scope_reference'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post()
  @manage
  async engage(@Body() raw: unknown) {
    const input = object(raw);
    try {
      const owner = optionalUuid(input, 'owner_user_id');
      return await this.incidents.engage({
        context: currentRequestContext(),
        control_key: stringField(input, 'control_key'),
        scope_kind: stringField(input, 'scope_kind'),
        scope_reference: stringField(input, 'scope_reference'),
        reason_code: stringField(input, 'reason_code'),
        banner: stringField(input, 'banner'),
        expires_at: dateField(input, 'expires_at'),
        review_at: dateField(input, 'review_at'),
        ...(owner ? { owner_user_id: owner } : {}),
      });
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError)
        throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('expire')
  @manage
  @HttpCode(200)
  expire() {
    return this.incidents.expireDue({ context: currentRequestContext() });
  }

  @Get(':incident_control_id')
  @manage
  async detail(@Param('incident_control_id') id: string) {
    try {
      return await this.incidents.detail({
        context: currentRequestContext(),
        incident_control_id: uuid(id),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':incident_control_id/actions/:action')
  @manage
  @HttpCode(200)
  async act(
    @Param('incident_control_id') id: string,
    @Param('action') action: string,
    @Body() raw: unknown,
  ) {
    if (!ACTIONS.has(action as IncidentAction)) throw new BadRequestException();
    const input = object(raw);
    try {
      const reviewAt = optionalDate(input, 'review_at');
      const expiresAt = optionalDate(input, 'expires_at');
      const itemIndex = optionalInteger(input, 'item_index', 0);
      return await this.incidents.act({
        context: currentRequestContext(),
        incident_control_id: uuid(id),
        action: action as IncidentAction,
        expected_version: expectedVersion(input),
        reason_code: stringField(input, 'reason_code'),
        ...(reviewAt ? { review_at: reviewAt } : {}),
        ...(expiresAt ? { expires_at: expiresAt } : {}),
        ...(itemIndex !== undefined ? { item_index: itemIndex } : {}),
      });
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError)
        throw new BadRequestException();
      translateDomainError(error);
    }
  }
}

/**
 * The banners every surface shows while a pause is in force (11.7). They say
 * what is paused and until when -- the same thing the storefront would tell
 * anyone who tried -- and nothing about who engaged it or why.
 */
@Controller('service-status')
@Public('Service banners tell every visitor, signed in or not, what is paused and until when')
export class ServiceStatusController {
  constructor(@Inject(INCIDENT_CONTROLS) private readonly incidents: IncidentControlService) {}

  @Get()
  status() {
    return this.incidents.banners();
  }
}
