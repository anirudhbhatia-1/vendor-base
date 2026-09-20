import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CustomerDiscoveryService } from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { CUSTOMER_DISCOVERY } from './tokens.js';
import { numberField, object, optionalString, stringField, uuid } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
function requireQuery(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new BadRequestException();
  return value;
}
const asCustomer = RequireAuthorization({
  capability: 'customer.discovery.use',
  conceal_resource: true,
});
// A shop request is a lead for the vendor pipeline, so the queue is read and
// moved under the onboarding capabilities rather than a capability of its own.
// The queue is read by both sides of the onboarding pair (0091): it was gated
// on `review`, so the operator who triages and closes requests could not
// list them.
const reviewRequests = RequireAuthorization({
  admin_scope: { kind: 'GLOBAL' },
  capability: 'admin.vendor_onboarding.read',
  conceal_resource: true,
});
const manageRequests = RequireAuthorization({
  admin_scope: { kind: 'GLOBAL' },
  capability: 'admin.vendor_onboarding.manage',
  conceal_resource: true,
});
const SHOP_REQUEST_STATES = new Set(['OPEN', 'TRIAGED', 'CLOSED']);
function shopRequestState(value: string): 'CLOSED' | 'OPEN' | 'TRIAGED' {
  if (!SHOP_REQUEST_STATES.has(value)) throw new BadRequestException();
  return value as 'CLOSED' | 'OPEN' | 'TRIAGED';
}

@Controller('customer/discovery')
export class CustomerDiscoveryController {
  constructor(@Inject(CUSTOMER_DISCOVERY) private readonly discovery: CustomerDiscoveryService) {}

  @Get('stores')
  @asCustomer
  async stores(
    @Query('customer_address_id') addressId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    try {
      return {
        stores: await this.discovery.discoverStores({
          context: currentRequestContext(),
          customer_address_id: uuid(requireQuery(addressId)),
          ...(limit !== undefined ? { limit: Number(limit) } : {}),
          ...(offset !== undefined ? { offset: Number(offset) } : {}),
        }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('search')
  @asCustomer
  async search(
    @Query('customer_address_id') addressId: string,
    @Query('term') term: string,
    @Query('limit') limit?: string,
    @Query('category') category?: string,
    @Query('available_only') availableOnly?: string,
    @Query('fulfilment_mode') fulfilmentMode?: string,
    @Query('max_distance_meters') maxDistance?: string,
  ) {
    try {
      return {
        results: await this.discovery.searchProducts({
          context: currentRequestContext(),
          customer_address_id: uuid(requireQuery(addressId)),
          term: requireQuery(term),
          ...(limit !== undefined ? { limit: Number(limit) } : {}),
          ...(category ? { category } : {}),
          ...(availableOnly !== undefined ? { available_only: availableOnly === 'true' } : {}),
          ...(fulfilmentMode ? { fulfilment_mode: fulfilmentMode } : {}),
          ...(maxDistance !== undefined ? { max_distance_meters: Number(maxDistance) } : {}),
        }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('recent-searches')
  @asCustomer
  async recentSearches() {
    try {
      return {
        recent_searches: await this.discovery.recentSearches({ context: currentRequestContext() }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Delete('recent-searches/:display_term')
  @asCustomer
  async deleteRecentSearch(@Param('display_term') term: string) {
    try {
      await this.discovery.deleteRecentSearch({
        context: currentRequestContext(),
        display_term: decodeURIComponent(term),
      });
      return { deleted: true };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('stores/:vendor_location_id')
  @asCustomer
  async storefront(@Param('vendor_location_id') locationId: string) {
    try {
      return await this.discovery.storefront({
        context: currentRequestContext(),
        vendor_location_id: uuid(locationId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('favourites/:vendor_location_id')
  @asCustomer
  async addFavourite(@Param('vendor_location_id') locationId: string) {
    try {
      await this.discovery.addFavourite({
        context: currentRequestContext(),
        vendor_location_id: uuid(locationId),
      });
      return { favourited: true };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Delete('favourites/:vendor_location_id')
  @asCustomer
  async removeFavourite(@Param('vendor_location_id') locationId: string) {
    try {
      await this.discovery.removeFavourite({
        context: currentRequestContext(),
        vendor_location_id: uuid(locationId),
      });
      return { favourited: false };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('favourites')
  @asCustomer
  async favourites(@Query('customer_address_id') addressId?: string) {
    try {
      return {
        favourites: await this.discovery.listFavourites({
          context: currentRequestContext(),
          ...(addressId ? { customer_address_id: uuid(addressId) } : {}),
        }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('preferred-store/:vendor_location_id')
  @asCustomer
  async setPreferredStore(@Param('vendor_location_id') locationId: string) {
    try {
      await this.discovery.setPreferredStore({
        context: currentRequestContext(),
        vendor_location_id: uuid(locationId),
      });
      return { set: true };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Delete('preferred-store')
  @asCustomer
  async clearPreferredStore() {
    try {
      await this.discovery.clearPreferredStore({ context: currentRequestContext() });
      return { cleared: true };
    } catch (error) {
      translateDomainError(error);
    }
  }

  /**
   * With an address, the answer says whether the preferred store can serve
   * it (6.4 requirement 3): the preference survives an eligibility change and
   * the change is shown, rather than the store quietly vanishing.
   */
  @Get('preferred-store')
  @asCustomer
  async preferredStore(@Query('customer_address_id') addressId?: string) {
    try {
      return {
        preferred_store: await this.discovery.preferredStore({
          context: currentRequestContext(),
          ...(addressId ? { customer_address_id: uuid(addressId) } : {}),
        }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('shop-requests')
  @asCustomer
  async requestShop(@Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.discovery.requestShop({
        context: currentRequestContext(),
        pin_code: stringField(body, 'pin_code'),
        latitude: numberField(body, 'latitude'),
        longitude: numberField(body, 'longitude'),
        store_name: stringField(body, 'store_name'),
        note: typeof body['note'] === 'string' ? (body['note'] as string) : null,
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
}

/**
 * The pipeline side of a nearby-shop request (6.4 requirement 4). The request
 * used to be written and never read by anyone.
 */
@Controller('admin/shop-requests')
export class AdminShopRequestController {
  constructor(@Inject(CUSTOMER_DISCOVERY) private readonly discovery: CustomerDiscoveryService) {}

  @Get()
  @reviewRequests
  async list(@Query('state') state?: string) {
    try {
      return {
        shop_requests: await this.discovery.listShopRequests({
          context: currentRequestContext(),
          ...(state ? { state: shopRequestState(state) } : {}),
        }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':customer_shop_request_id/triage')
  @manageRequests
  async triage(@Param('customer_shop_request_id') id: string, @Body() raw: unknown) {
    const body = object(raw);
    const caseId = optionalString(body, 'onboarding_case_id');
    try {
      return await this.discovery.triageShopRequest({
        context: currentRequestContext(),
        customer_shop_request_id: uuid(id),
        ...(caseId ? { onboarding_case_id: uuid(caseId) } : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':customer_shop_request_id/close')
  @manageRequests
  async close(@Param('customer_shop_request_id') id: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.discovery.closeShopRequest({
        context: currentRequestContext(),
        customer_shop_request_id: uuid(id),
        resolution: stringField(body, 'resolution'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
}
