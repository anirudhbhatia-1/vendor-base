import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import {
  VendorNetworkNotFoundError,
  VendorNetworkService,
  VendorNetworkTransitionError,
  VendorNetworkVersionConflictError,
} from '@neighbourhood-store/database';
import {} from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { VENDOR_NETWORK } from './tokens.js';
import { uuid, object } from './request-fields.js';
const readsZones = RequireAuthorization({
  capability: 'admin.control.dashboard_read',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: false,
});

const operatesZones = RequireAuthorization({
  capability: 'admin.zone.operate',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: false,
});

@Controller('admin/zones')
export class AdminZonesController {
  constructor(@Inject(VENDOR_NETWORK) private readonly network: VendorNetworkService) {}

  @Get()
  @readsZones
  async list() {
    const zones = await this.network.listServiceZones({
      context: currentRequestContext(),
    });
    return { zones };
  }

  /**
   * Closes or reopens one service zone.
   *
   * The console could only read zones, so a neighbourhood that became
   * undeliverable — weather, a festival, a closed road — could not be taken out
   * of service without a database change. Discovery filters on the zone's
   * state, so this takes effect on the next customer read.
   */
  @Post(':service_zone_id/:action')
  @operatesZones
  async transition(
    @Param('service_zone_id') zoneId: string,
    @Param('action') action: string,
    @Body() raw: unknown,
  ) {
    if (action !== 'suspend' && action !== 'resume') throw new BadRequestException();
    const value = object(raw);
    if (typeof value.expected_version !== 'number' || typeof value.reason_code !== 'string') {
      throw new BadRequestException();
    }
    try {
      const version = await this.network.transitionServiceZone({
        context: currentRequestContext(),
        expected_version: value.expected_version,
        lifecycle_state: action === 'suspend' ? 'INACTIVE' : 'ACTIVE',
        reason_code: value.reason_code,
        service_zone_id: uuid(zoneId),
      });
      return { service_zone_id: zoneId, version };
    } catch (error) {
      if (error instanceof VendorNetworkNotFoundError) throw new BadRequestException(error.message);
      if (error instanceof VendorNetworkVersionConflictError) {
        throw new ConflictException({ error_code: 'VERSION_CONFLICT' });
      }
      if (error instanceof VendorNetworkTransitionError)
        throw new ConflictException({ error_code: 'ORDER_STATE_CONFLICT' });
      throw error;
    }
  }
}
