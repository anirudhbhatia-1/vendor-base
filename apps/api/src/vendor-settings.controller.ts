import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Inject,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { VendorSettingsService } from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { VENDOR_SETTINGS } from './tokens.js';
import { integerField, object, optionalInteger, optionalString, uuid } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
const manages = RequireAuthorization({
  capability: 'vendor.settings.manage',
  conceal_resource: true,
  vendor_location_id_param: 'vendor_location_id',
});

@Controller('vendor/locations/:vendor_location_id/settings')
export class VendorLocationSettingsController {
  constructor(@Inject(VENDOR_SETTINGS) private readonly settings: VendorSettingsService) {}

  /** The current settings and the version an edit must carry (ENG-03). */
  @Get()
  @manages
  async read(@Param('vendor_location_id') vendorLocationId: string) {
    try {
      return await this.settings.readLocation({
        context: currentRequestContext(),
        vendor_location_id: uuid(vendorLocationId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Put()
  @manages
  async update(@Param('vendor_location_id') vendorLocationId: string, @Body() raw: unknown) {
    const body = object(raw);
    const hoursRaw = body['hours'];
    let hours:
      | readonly {
          readonly weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
          readonly opens_at: string;
          readonly closes_at: string;
        }[]
      | undefined;
    if (Array.isArray(hoursRaw)) {
      hours = hoursRaw.map((h) => {
        const r = object(h);
        return {
          weekday: integerField(r, 'weekday') as 0 | 1 | 2 | 3 | 4 | 5 | 6,
          opens_at: (optionalString(r, 'opens_at') ?? '') as string,
          closes_at: (optionalString(r, 'closes_at') ?? '') as string,
        };
      });
    }
    try {
      return await this.settings.updateLocation({
        context: currentRequestContext(),
        vendor_location_id: uuid(vendorLocationId),
        expected_version: integerField(body, 'expected_version'),
        ...(optionalString(body, 'location_name') !== undefined
          ? { location_name: optionalString(body, 'location_name') as string }
          : {}),
        ...(body['profile_description'] === null || typeof body['profile_description'] === 'string'
          ? { profile_description: (body['profile_description'] ?? null) as string | null }
          : {}),
        ...(optionalInteger(body, 'preparation_seconds') !== undefined
          ? { preparation_seconds: optionalInteger(body, 'preparation_seconds') as number }
          : {}),
        ...(optionalInteger(body, 'minimum_order_minor') !== undefined
          ? { minimum_order_minor: optionalInteger(body, 'minimum_order_minor') as number }
          : {}),
        ...(optionalString(body, 'operating_timezone') !== undefined
          ? { operating_timezone: optionalString(body, 'operating_timezone') as string }
          : {}),
        ...(hours ? { hours } : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('lifecycle')
  @manages
  async setLifecycle(@Param('vendor_location_id') vendorLocationId: string, @Body() raw: unknown) {
    const body = object(raw);
    const state = body['state'];
    if (state !== 'ACTIVE' && state !== 'PAUSED') {
      throw new BadRequestException('state must be ACTIVE or PAUSED');
    }
    try {
      return await this.settings.setLifecycle({
        context: currentRequestContext(),
        vendor_location_id: uuid(vendorLocationId),
        state,
        expected_version: integerField(body, 'expected_version'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
}

// Reserved: retained so the exception classes are re-exported for controller consumers.
void ConflictException;
