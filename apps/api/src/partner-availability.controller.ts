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
import { PartnerAvailabilityService } from '@neighbourhood-store/database';
import {} from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { PARTNER_AVAILABILITY } from './tokens.js';
import { uuid, optionalWholeQuery, numberField, object, stringField } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
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
    const b = object(raw),
      state = stringField(b, 'state');
    if (!['ONLINE', 'OFFLINE', 'PAUSED'].includes(state)) throw new BadRequestException();
    try {
      return await this.service.set({
        context: currentRequestContext(),
        state: state as 'ONLINE' | 'OFFLINE' | 'PAUSED',
        reason_code: stringField(b, 'reason_code'),
        ...(state === 'ONLINE'
          ? {
              latitude: numberField(b, 'latitude'),
              longitude: numberField(b, 'longitude'),
              accuracy_meters: numberField(b, 'accuracy_meters'),
              battery_percent: numberField(b, 'battery_percent'),
            }
          : {}),
      });
    } catch (e) {
      translateDomainError(e);
    }
  }
  /**
   * Presence, once a minute while online. Without it an ONLINE row from a
   * session that ended silently kept receiving offers indefinitely, ahead of
   * partners who were actually there.
   */
  @Post('heartbeat') @own async heartbeat(@Body() raw: unknown) {
    const b = object(raw);
    const located = typeof b['latitude'] === 'number' && typeof b['longitude'] === 'number';
    try {
      return await this.service.heartbeat({
        context: currentRequestContext(),
        ...(located
          ? {
              latitude: numberField(b, 'latitude'),
              longitude: numberField(b, 'longitude'),
              ...(typeof b['accuracy_meters'] === 'number'
                ? { accuracy_meters: numberField(b, 'accuracy_meters') }
                : {}),
            }
          : {}),
        ...(typeof b['battery_percent'] === 'number'
          ? { battery_percent: numberField(b, 'battery_percent') }
          : {}),
      });
    } catch (e) {
      translateDomainError(e);
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
          vendor_location_id: uuid(id),
          ...(optionalWholeQuery(radius) !== undefined
            ? { radius_meters: optionalWholeQuery(radius) as number }
            : {}),
        }),
      };
    } catch (e) {
      translateDomainError(e);
    }
  }
}
