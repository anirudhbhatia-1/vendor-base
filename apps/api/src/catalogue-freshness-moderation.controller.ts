import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  CatalogueFreshnessModerationService,
  type CatalogueModerationState,
} from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { CATALOGUE_FRESHNESS_MODERATION } from './tokens.js';
import { currentRequestContext } from './request-context-storage.js';
import { integerField, object, stringField, uuid } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
function state(value: string): CatalogueModerationState {
  if (!['PENDING', 'CLEARED', 'CORRECTION_REQUIRED', 'RESTRICTED'].includes(value))
    throw new BadRequestException();
  return value as CatalogueModerationState;
}
@Controller('catalogue/locations/:vendor_location_id/availability')
export class CustomerAvailabilityController {
  constructor(
    @Inject(CATALOGUE_FRESHNESS_MODERATION)
    private readonly catalogue: CatalogueFreshnessModerationService,
  ) {}
  @Get()
  async list(@Param('vendor_location_id') locationId: string) {
    return {
      items: await this.catalogue.listCustomerAvailability({
        vendor_location_id: uuid(locationId),
      }),
    };
  }
}

const moderate = RequireAuthorization({
  capability: 'admin.catalogue.moderate',
  conceal_resource: true,
  admin_scope: { kind: 'GLOBAL' },
});

@Controller('admin/catalogue/moderation')
export class AdminCatalogueModerationController {
  constructor(
    @Inject(CATALOGUE_FRESHNESS_MODERATION)
    private readonly catalogue: CatalogueFreshnessModerationService,
  ) {}
  @Get()
  @moderate
  async list(@Query('state') queryState?: string) {
    try {
      return {
        cases: await this.catalogue.listQueue({
          context: currentRequestContext(),
          ...(queryState ? { state: state(queryState) } : {}),
        }),
      };
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
  @Post()
  @moderate
  async open(@Body() raw: unknown) {
    const value = object(raw);
    try {
      return await this.catalogue.openCase({
        context: currentRequestContext(),
        inventory_item_id: uuid(stringField(value, 'inventory_item_id')),
        reason_code: stringField(value, 'reason_code'),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
  @Put(':moderation_case_id/decision')
  @moderate
  async decide(@Param('moderation_case_id') caseId: string, @Body() raw: unknown) {
    const value = object(raw);
    const nextState = state(stringField(value, 'moderation_state'));
    if (nextState === 'PENDING') throw new BadRequestException();
    try {
      return await this.catalogue.decideCase({
        context: currentRequestContext(),
        ...(typeof value.correction_reason === 'string'
          ? { correction_reason: value.correction_reason }
          : {}),
        expected_version: integerField(value, 'expected_version', 1),
        moderation_case_id: uuid(caseId),
        moderation_state: nextState,
        reason_code: stringField(value, 'reason_code'),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
}
