import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  InventoryReservationService,
  type InventoryQuantityBasis,
} from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { INVENTORY_RESERVATIONS } from './tokens.js';
import { integerField, object, stringField, uuid } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
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
        // The catalogue-joined read model: a stock line the customer cannot
        // see must be distinguishable on screen from one they can.
        items: await this.inventory.listLocationStock({
          context: currentRequestContext(),
          vendor_location_id: uuid(locationId),
        }),
      };
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
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
              exact_available_quantity: integerField(value, 'exact_available_quantity', 0),
              low_stock_threshold: integerField(value, 'low_stock_threshold', 0),
            }
          : {}),
        product_reference: stringField(value, 'product_reference'),
        quantity_basis: basis as InventoryQuantityBasis,
        reason_code: stringField(value, 'reason_code'),
        vendor_location_id: uuid(locationId),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
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
        exact_available_quantity: integerField(value, 'exact_available_quantity', 0),
        expected_version: integerField(value, 'expected_version', 1),
        inventory_item_id: uuid(itemId),
        low_stock_threshold: integerField(value, 'low_stock_threshold', 0),
        reason_code: stringField(value, 'reason_code'),
        vendor_location_id: uuid(locationId),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
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
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
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
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
}
