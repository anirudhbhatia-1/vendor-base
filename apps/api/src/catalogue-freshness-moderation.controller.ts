import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  CatalogueFreshnessModerationService,
  CatalogueModerationAuthorizationError,
  CatalogueModerationConflictError,
  CatalogueModerationInputError,
  CatalogueModerationNotFoundError,
  type CatalogueModerationState,
} from '@neighbourhood-store/database';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { CATALOGUE_FRESHNESS_MODERATION } from './tokens.js';
import { currentRequestContext } from './request-context-storage.js';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}
function string(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== 'string') throw new BadRequestException();
  return value[key];
}
function uuid(value: string): UuidV7 {
  try {
    return parseUuidV7(value);
  } catch {
    throw new BadRequestException();
  }
}
function integer(value: Record<string, unknown>, key: string): number {
  if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1)
    throw new BadRequestException();
  return value[key] as number;
}
function state(value: string): CatalogueModerationState {
  if (!['PENDING', 'CLEARED', 'CORRECTION_REQUIRED', 'RESTRICTED'].includes(value))
    throw new BadRequestException();
  return value as CatalogueModerationState;
}
function translate(error: unknown): never {
  if (error instanceof CatalogueModerationInputError || error instanceof TypeError)
    throw new BadRequestException();
  if (error instanceof CatalogueModerationNotFoundError) throw new NotFoundException();
  if (error instanceof CatalogueModerationConflictError) throw new ConflictException();
  if (error instanceof CatalogueModerationAuthorizationError) throw new ForbiddenException();
  throw error;
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
      translate(error);
    }
  }
  @Post()
  @moderate
  async open(@Body() raw: unknown) {
    const value = object(raw);
    try {
      return await this.catalogue.openCase({
        context: currentRequestContext(),
        inventory_item_id: uuid(string(value, 'inventory_item_id')),
        reason_code: string(value, 'reason_code'),
      });
    } catch (error) {
      translate(error);
    }
  }
  @Put(':moderation_case_id/decision')
  @moderate
  async decide(@Param('moderation_case_id') caseId: string, @Body() raw: unknown) {
    const value = object(raw);
    const nextState = state(string(value, 'moderation_state'));
    if (nextState === 'PENDING') throw new BadRequestException();
    try {
      return await this.catalogue.decideCase({
        context: currentRequestContext(),
        ...(typeof value.correction_reason === 'string'
          ? { correction_reason: value.correction_reason }
          : {}),
        expected_version: integer(value, 'expected_version'),
        moderation_case_id: uuid(caseId),
        moderation_state: nextState,
        reason_code: string(value, 'reason_code'),
      });
    } catch (error) {
      translate(error);
    }
  }
}
