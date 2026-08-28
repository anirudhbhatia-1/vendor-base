import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Query,
  ConflictException,
} from '@nestjs/common';
import {
  PartnerAvailabilityAuthorizationError,
  PartnerAvailabilityConflictError,
  PartnerAvailabilityInputError,
  PartnerAvailabilityService,
} from '@neighbourhood-store/database';
import { parseUuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { PARTNER_AVAILABILITY } from './tokens.js';
function obj(v: unknown) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BadRequestException();
  return v as Record<string, unknown>;
}
function str(v: Record<string, unknown>, k: string) {
  if (typeof v[k] !== 'string') throw new BadRequestException();
  return v[k] as string;
}
function num(v: Record<string, unknown>, k: string) {
  if (typeof v[k] !== 'number' || !Number.isFinite(v[k])) throw new BadRequestException();
  return v[k] as number;
}
function map(e: unknown): never {
  if (e instanceof PartnerAvailabilityInputError) throw new BadRequestException(e.message);
  if (e instanceof PartnerAvailabilityConflictError) throw new ConflictException(e.message);
  if (e instanceof PartnerAvailabilityAuthorizationError) throw new ForbiddenException();
  throw e;
}
const own = RequireAuthorization({
  capability: 'partner.availability.manage',
  conceal_resource: true,
});
const dispatch = RequireAuthorization({
  capability: 'admin.delivery.partner_dispatch',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: true,
});
@Controller('partner/availability')
export class PartnerAvailabilityController {
  constructor(@Inject(PARTNER_AVAILABILITY) private readonly service: PartnerAvailabilityService) {}
  @Get() @own summary() {
    return this.service.summary({ context: currentRequestContext() });
  }
  @Post() @own async set(@Body() raw: unknown) {
    const b = obj(raw),
      state = str(b, 'state');
    if (!['ONLINE', 'OFFLINE', 'PAUSED'].includes(state)) throw new BadRequestException();
    try {
      return await this.service.set({
        context: currentRequestContext(),
        state: state as 'ONLINE' | 'OFFLINE' | 'PAUSED',
        reason_code: str(b, 'reason_code'),
        ...(state === 'ONLINE'
          ? {
              latitude: num(b, 'latitude'),
              longitude: num(b, 'longitude'),
              accuracy_meters: num(b, 'accuracy_meters'),
              battery_percent: num(b, 'battery_percent'),
            }
          : {}),
      });
    } catch (e) {
      map(e);
    }
  }
}
@Controller('admin/delivery/eligible-partners')
export class AdminPartnerDispatchController {
  constructor(@Inject(PARTNER_AVAILABILITY) private readonly service: PartnerAvailabilityService) {}
  @Get(':vendor_location_id') @dispatch async list(
    @Param('vendor_location_id') id: string,
    @Query('radius_meters') radius?: string,
  ) {
    try {
      return {
        partners: await this.service.eligible({
          context: currentRequestContext(),
          vendor_location_id: parseUuidV7(id),
          ...(radius ? { radius_meters: Number(radius) } : {}),
        }),
      };
    } catch (e) {
      map(e);
    }
  }
}
