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
  Query,
} from '@nestjs/common';
import {
  VendorStaffAuthorizationError,
  VendorStaffConflictError,
  VendorStaffInputError,
  VendorStaffNotFoundError,
  VendorStaffService,
  type ManagedVendorRole,
} from '@neighbourhood-store/database';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { VENDOR_STAFF } from './tokens.js';

const managedRoles = ['VENDOR_MANAGER', 'VENDOR_PICKER'] as const;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}
function stringField(body: Record<string, unknown>, key: string): string {
  const found = body[key];
  if (typeof found !== 'string') throw new BadRequestException();
  return found;
}
function integerField(body: Record<string, unknown>, key: string): number {
  const found = body[key];
  if (!Number.isSafeInteger(found)) throw new BadRequestException();
  return found as number;
}
function dateField(body: Record<string, unknown>, key: string): Date {
  const found = body[key];
  const parsed = typeof found === 'string' ? new Date(found) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) throw new BadRequestException();
  return parsed;
}
function managedRole(body: Record<string, unknown>): ManagedVendorRole {
  const found = body['role'];
  if (!managedRoles.includes(found as ManagedVendorRole)) throw new BadRequestException();
  return found as ManagedVendorRole;
}
function uuid(value: string): UuidV7 {
  try {
    return parseUuidV7(value);
  } catch {
    throw new BadRequestException();
  }
}
function map(error: unknown): never {
  if (error instanceof VendorStaffInputError) throw new BadRequestException(error.message);
  if (error instanceof VendorStaffNotFoundError) throw new NotFoundException();
  if (error instanceof VendorStaffConflictError) throw new ConflictException(error.message);
  if (error instanceof VendorStaffAuthorizationError) throw new ForbiddenException();
  throw error;
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
    try {
      await this.staff.inviteStaff({
        context: currentRequestContext(),
        vendor_location_id: uuid(locationId),
        invitee_user_id: uuid(stringField(body, 'invitee_user_id')),
        role: managedRole(body),
      });
      return { invited: true };
    } catch (error) {
      map(error);
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
      map(error);
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
      map(error);
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
      map(error);
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
      map(error);
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
      map(error);
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
      map(error);
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
      map(error);
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
      map(error);
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
      map(error);
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
      map(error);
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
      map(error);
    }
  }
}
