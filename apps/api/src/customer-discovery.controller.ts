import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  CustomerDiscoveryAuthorizationError,
  CustomerDiscoveryConflictError,
  CustomerDiscoveryInputError,
  CustomerDiscoveryNotFoundError,
  CustomerDiscoveryService,
} from '@neighbourhood-store/database';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { CUSTOMER_DISCOVERY } from './tokens.js';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}
function stringField(body: Record<string, unknown>, key: string): string {
  const found = body[key];
  if (typeof found !== 'string') throw new BadRequestException();
  return found;
}
function numberField(body: Record<string, unknown>, key: string): number {
  const found = body[key];
  if (typeof found !== 'number' || !Number.isFinite(found)) throw new BadRequestException();
  return found;
}
function uuid(value: string): UuidV7 {
  try {
    return parseUuidV7(value);
  } catch {
    throw new BadRequestException();
  }
}
function requireQuery(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new BadRequestException();
  return value;
}
function map(error: unknown): never {
  if (error instanceof CustomerDiscoveryInputError) throw new BadRequestException(error.message);
  if (error instanceof CustomerDiscoveryNotFoundError) throw new NotFoundException();
  if (error instanceof CustomerDiscoveryConflictError) throw new ConflictException(error.message);
  if (error instanceof CustomerDiscoveryAuthorizationError) throw new ForbiddenException();
  throw error;
}

const asCustomer = RequireAuthorization({
  capability: 'customer.discovery.use',
  conceal_resource: true,
});

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
      map(error);
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
      map(error);
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
      map(error);
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
      map(error);
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
      map(error);
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
      map(error);
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
      map(error);
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
      map(error);
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
      map(error);
    }
  }

  @Delete('preferred-store')
  @asCustomer
  async clearPreferredStore() {
    try {
      await this.discovery.clearPreferredStore({ context: currentRequestContext() });
      return { cleared: true };
    } catch (error) {
      map(error);
    }
  }

  @Get('preferred-store')
  @asCustomer
  async preferredStore() {
    try {
      return {
        vendor_location_id: await this.discovery.preferredStore({
          context: currentRequestContext(),
        }),
      };
    } catch (error) {
      map(error);
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
      map(error);
    }
  }
}
