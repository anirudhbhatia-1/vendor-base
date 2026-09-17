import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { CustomerAddressService, type CoordinateSource } from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { CUSTOMER_ADDRESSES } from './tokens.js';
import { nullableString, numberField, object, stringField, uuid } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
// `exactOptionalPropertyTypes` forbids passing an explicit undefined, so an
// absent source is spread away rather than set.
function coordinateSource(body: Record<string, unknown>): {
  readonly coordinate_source?: CoordinateSource;
} {
  const found = body['coordinate_source'];
  if (found === undefined || found === null) return {};
  if (found !== 'MANUAL_PIN' && found !== 'DEVICE_LOCATION') throw new BadRequestException();
  return { coordinate_source: found };
}
// Every route is contained to the authenticated customer account, and a
// concealed resource returns 404 rather than confirming another customer's row.
const ownsAddresses = RequireAuthorization({
  capability: 'customer.address.manage',
  conceal_resource: true,
});

@Controller('customer/addresses')
export class CustomerAddressesController {
  constructor(@Inject(CUSTOMER_ADDRESSES) private readonly addresses: CustomerAddressService) {}

  @Get()
  @ownsAddresses
  async list() {
    try {
      return {
        saved_address_limit: await this.addresses.savedAddressLimit(),
        addresses: await this.addresses.listAddresses({ context: currentRequestContext() }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post()
  @ownsAddresses
  async create(@Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.addresses.createAddress({
        context: currentRequestContext(),
        address_reference: stringField(body, 'address_reference'),
        label: stringField(body, 'label'),
        pin_code: stringField(body, 'pin_code'),
        latitude: numberField(body, 'latitude'),
        longitude: numberField(body, 'longitude'),
        ...coordinateSource(body),
        landmark: nullableString(body, 'landmark'),
        delivery_instructions: nullableString(body, 'delivery_instructions'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Put(':customer_address_id')
  @ownsAddresses
  async update(@Param('customer_address_id') addressId: string, @Body() raw: unknown) {
    const body = object(raw);
    const expected = body['expected_version'];
    if (!Number.isSafeInteger(expected)) throw new BadRequestException();
    try {
      return await this.addresses.updateAddress({
        context: currentRequestContext(),
        customer_address_id: uuid(addressId),
        expected_version: expected as number,
        label: stringField(body, 'label'),
        pin_code: stringField(body, 'pin_code'),
        latitude: numberField(body, 'latitude'),
        longitude: numberField(body, 'longitude'),
        ...coordinateSource(body),
        landmark: nullableString(body, 'landmark'),
        delivery_instructions: nullableString(body, 'delivery_instructions'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':customer_address_id/select')
  @ownsAddresses
  async select(@Param('customer_address_id') addressId: string) {
    try {
      return await this.addresses.selectAddress({
        context: currentRequestContext(),
        customer_address_id: uuid(addressId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get(':customer_address_id/eligible-vendor-locations')
  @ownsAddresses
  async eligible(@Param('customer_address_id') addressId: string) {
    try {
      return {
        vendor_location_ids: await this.addresses.eligibleVendorLocations({
          context: currentRequestContext(),
          customer_address_id: uuid(addressId),
        }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Delete(':customer_address_id')
  @ownsAddresses
  async archive(@Param('customer_address_id') addressId: string) {
    try {
      return await this.addresses.archiveAddress({
        context: currentRequestContext(),
        customer_address_id: uuid(addressId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
}
