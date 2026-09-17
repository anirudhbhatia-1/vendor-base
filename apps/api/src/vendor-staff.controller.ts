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
import { VendorStaffService, type ManagedVendorRole } from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { VENDOR_STAFF } from './tokens.js';
import { dateField, integerField, object, stringField, uuid } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
const managedRoles = ['VENDOR_MANAGER', 'VENDOR_PICKER'] as const;

function managedRole(body: Record<string, unknown>): ManagedVendorRole {
  const found = body['role'];
  if (!managedRoles.includes(found as ManagedVendorRole)) throw new BadRequestException();
  return found as ManagedVendorRole;
}
const manageStaff = RequireAuthorization({
  capability: 'vendor.staff.manage',
  conceal_resource: true,
  vendor_location_id_param: 'vendor_location_id',
});
const manageSettings = RequireAuthorization({
  capability: 'vendor.settings.manage',
  conceal_resource: true,
  vendor_location_id_param: 'vendor_location_id',
});

@Controller('vendor/locations/:vendor_location_id/staff')
export class VendorStaffController {
  constructor(@Inject(VENDOR_STAFF) private readonly staff: VendorStaffService) {}

  @Post('invite')
  @manageStaff
  async invite(@Param('vendor_location_id') locationId: string, @Body() raw: unknown) {
    const body = object(raw);
    // Addressed by phone, because that is the only identifier an owner can
    // know about their picker. `invitee_user_id` stays accepted for callers
    // that already hold one (tests, admin tooling).
    const suppliedId = body['invitee_user_id'];
    try {
      return await this.staff.inviteStaff({
        context: currentRequestContext(),
        vendor_location_id: uuid(locationId),
        ...(typeof suppliedId === 'string'
          ? { invitee_user_id: uuid(suppliedId) }
          : { invitee_phone: stringField(body, 'invitee_phone') }),
        role: managedRole(body),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('revoke')
  @manageStaff
  async revoke(@Param('vendor_location_id') locationId: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      await this.staff.revokeStaff({
        context: currentRequestContext(),
        vendor_location_id: uuid(locationId),
        target_user_id: uuid(stringField(body, 'target_user_id')),
        role: managedRole(body),
        reason_code: stringField(body, 'reason_code'),
      });
      return { revoked: true };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get()
  @manageStaff
  async list(@Param('vendor_location_id') locationId: string) {
    try {
      return {
        staff: await this.staff.listStaff({
          context: currentRequestContext(),
          vendor_location_id: uuid(locationId),
        }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('activity')
  @manageStaff
  async activity(@Param('vendor_location_id') locationId: string, @Query('limit') limit?: string) {
    try {
      return {
        activity: await this.staff.activityHistory({
          context: currentRequestContext(),
          vendor_location_id: uuid(locationId),
          ...(limit !== undefined ? { limit: Number(limit) } : {}),
        }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }
}

@Controller('vendor/locations/:vendor_location_id/access')
export class VendorAccessController {
  constructor(@Inject(VENDOR_STAFF) private readonly staff: VendorStaffService) {}

  @Get('mine')
  @manageStaff
  async mine(@Param('vendor_location_id') locationId: string) {
    try {
      return await this.staff.myAccess({
        context: currentRequestContext(),
        vendor_location_id: uuid(locationId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
}

@Controller('vendor/locations/:vendor_location_id/settings')
export class VendorSettingsController {
  constructor(@Inject(VENDOR_STAFF) private readonly staff: VendorStaffService) {}

  @Post('profile')
  @manageSettings
  async profile(@Param('vendor_location_id') locationId: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.staff.updateProfile({
        context: currentRequestContext(),
        vendor_location_id: uuid(locationId),
        expected_version: integerField(body, 'expected_version'),
        profile_description: stringField(body, 'profile_description'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('ordering')
  @manageSettings
  async ordering(@Param('vendor_location_id') locationId: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.staff.updateOrderingSettings({
        context: currentRequestContext(),
        vendor_location_id: uuid(locationId),
        expected_version: integerField(body, 'expected_version'),
        minimum_order_minor: integerField(body, 'minimum_order_minor'),
        preparation_seconds: integerField(body, 'preparation_seconds'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('hours')
  @manageSettings
  async hours(@Param('vendor_location_id') locationId: string, @Body() raw: unknown) {
    const body = object(raw);
    const hours = body['hours'];
    if (!Array.isArray(hours)) throw new BadRequestException();
    try {
      await this.staff.replaceOperatingHours({
        context: currentRequestContext(),
        vendor_location_id: uuid(locationId),
        hours: hours.map((window) => {
          const w = object(window);
          return {
            weekday: integerField(w, 'weekday'),
            opens_at: stringField(w, 'opens_at'),
            closes_at: stringField(w, 'closes_at'),
          };
        }),
      });
      return { updated: true };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('closures')
  @manageSettings
  async closure(@Param('vendor_location_id') locationId: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      await this.staff.addTemporaryClosure({
        context: currentRequestContext(),
        vendor_location_id: uuid(locationId),
        starts_at: dateField(body, 'starts_at'),
        ends_at: dateField(body, 'ends_at'),
        reason_code: stringField(body, 'reason_code'),
      });
      return { added: true };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('zones')
  @manageSettings
  async listZones(@Param('vendor_location_id') locationId: string) {
    try {
      return {
        zones: await this.staff.listServiceZones({
          context: currentRequestContext(),
          vendor_location_id: uuid(locationId),
        }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('closures')
  @manageSettings
  async listClosures(@Param('vendor_location_id') locationId: string) {
    try {
      return {
        closures: await this.staff.listTemporaryClosures({
          context: currentRequestContext(),
          vendor_location_id: uuid(locationId),
        }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('zones')
  @manageSettings
  async addZone(@Param('vendor_location_id') locationId: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      await this.staff.addServiceZone({
        context: currentRequestContext(),
        vendor_location_id: uuid(locationId),
        zone_name: stringField(body, 'zone_name'),
        boundary_wkt: stringField(body, 'boundary_wkt'),
      });
      return { added: true };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('zones/:service_zone_id/deactivate')
  @manageSettings
  async deactivateZone(
    @Param('vendor_location_id') locationId: string,
    @Param('service_zone_id') zoneId: string,
  ) {
    try {
      await this.staff.deactivateServiceZone({
        context: currentRequestContext(),
        vendor_location_id: uuid(locationId),
        service_zone_id: uuid(zoneId),
      });
      return { deactivated: true };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('fulfilment-modes')
  @manageSettings
  async fulfilmentModes(@Param('vendor_location_id') locationId: string) {
    try {
      return {
        fulfilment_modes: await this.staff.listFulfilmentModes({
          context: currentRequestContext(),
          vendor_location_id: uuid(locationId),
        }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }
}
