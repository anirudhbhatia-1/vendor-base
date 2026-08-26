import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  InventoryAuthorizationError,
  InventoryConflictError,
  InventoryInputError,
  InventoryNotFoundError,
  InventoryReservationService,
  InventoryUnavailableError,
  InventoryVersionError,
  type InventoryQuantityBasis,
} from '@neighbourhood-store/database';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { INVENTORY_RESERVATIONS } from './tokens.js';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}
function stringField(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== 'string') throw new BadRequestException();
  return value[key];
}
function integerField(value: Record<string, unknown>, key: string, minimum = 0): number {
  const found = value[key];
  if (!Number.isSafeInteger(found) || (found as number) < minimum) throw new BadRequestException();
  return found as number;
}
function uuid(value: string): UuidV7 {
  try {
    return parseUuidV7(value);
  } catch {
    throw new BadRequestException();
  }
}
function translate(error: unknown): never {
  if (error instanceof InventoryInputError || error instanceof TypeError)
    throw new BadRequestException();
  if (error instanceof InventoryNotFoundError) throw new NotFoundException();
  if (error instanceof InventoryVersionError)
    throw new ConflictException({ error_code: error.code });
  if (error instanceof InventoryConflictError) throw new ConflictException();
  if (error instanceof InventoryAuthorizationError) throw new ForbiddenException();
  if (error instanceof InventoryUnavailableError)
    throw new UnprocessableEntityException({
      available_quantity: error.available_quantity,
      error_code: error.code,
    });
  throw error;
}

const manageInventory = RequireAuthorization({
  capability: 'vendor.catalogue.manage',
  conceal_resource: true,
  vendor_location_id_param: 'vendor_location_id',
});

@Controller('vendor/locations/:vendor_location_id/inventory')
export class VendorInventoryController {
  constructor(
    @Inject(INVENTORY_RESERVATIONS)
    private readonly inventory: InventoryReservationService,
  ) {}

  @Get()
  @manageInventory
  async list(@Param('vendor_location_id') locationId: string) {
    try {
      return {
        items: await this.inventory.listLocation({
          context: currentRequestContext(),
          vendor_location_id: uuid(locationId),
        }),
      };
    } catch (error) {
      translate(error);
    }
  }

  @Post()
  @manageInventory
  async create(@Param('vendor_location_id') locationId: string, @Body() raw: unknown) {
    const value = object(raw);
    const basis = stringField(value, 'quantity_basis');
    if (basis !== 'COUNTED' && basis !== 'VENDOR_CONFIRMS') throw new BadRequestException();
    try {
      return await this.inventory.createItem({
        context: currentRequestContext(),
        display_name: stringField(value, 'display_name'),
        ...(basis === 'COUNTED'
          ? {
              exact_available_quantity: integerField(value, 'exact_available_quantity'),
              low_stock_threshold: integerField(value, 'low_stock_threshold'),
            }
          : {}),
        product_reference: stringField(value, 'product_reference'),
        quantity_basis: basis as InventoryQuantityBasis,
        reason_code: stringField(value, 'reason_code'),
        vendor_location_id: uuid(locationId),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Put(':inventory_item_id/stock')
  @manageInventory
  async setStock(
    @Param('vendor_location_id') locationId: string,
    @Param('inventory_item_id') itemId: string,
    @Body() raw: unknown,
  ) {
    const value = object(raw);
    try {
      return await this.inventory.setCountedStock({
        context: currentRequestContext(),
        exact_available_quantity: integerField(value, 'exact_available_quantity'),
        expected_version: integerField(value, 'expected_version', 1),
        inventory_item_id: uuid(itemId),
        low_stock_threshold: integerField(value, 'low_stock_threshold'),
        reason_code: stringField(value, 'reason_code'),
        vendor_location_id: uuid(locationId),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post(':inventory_item_id/confirm')
  @manageInventory
  @HttpCode(200)
  async confirm(
    @Param('vendor_location_id') locationId: string,
    @Param('inventory_item_id') itemId: string,
    @Body() raw: unknown,
  ) {
    const value = object(raw);
    try {
      return await this.inventory.confirmAvailability({
        context: currentRequestContext(),
        expected_version: integerField(value, 'expected_version', 1),
        inventory_item_id: uuid(itemId),
        reason_code: stringField(value, 'reason_code'),
        vendor_location_id: uuid(locationId),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Get(':inventory_item_id/reservations')
  @manageInventory
  async reservations(
    @Param('vendor_location_id') locationId: string,
    @Param('inventory_item_id') itemId: string,
  ) {
    try {
      return {
        reservations: await this.inventory.listReservations({
          context: currentRequestContext(),
          inventory_item_id: uuid(itemId),
          vendor_location_id: uuid(locationId),
        }),
      };
    } catch (error) {
      translate(error);
    }
  }
}
