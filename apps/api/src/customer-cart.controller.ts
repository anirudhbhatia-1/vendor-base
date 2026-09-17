import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  CustomerCartService,
  CustomerDiscoveryService,
  type FulfilmentMethod,
  type SubstitutionPreference,
} from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { CUSTOMER_CART, CUSTOMER_DISCOVERY } from './tokens.js';
import { integerField, object, stringField, uuid } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
const fulfilmentMethods = ['CUSTOMER_PICKUP', 'PLATFORM_DELIVERY', 'VENDOR_DELIVERY'] as const;
const substitutionPreferences = ['ALLOW_SAME_STORE', 'ASK_CUSTOMER', 'NO_SUBSTITUTION'] as const;

function optionalFulfilmentMethod(body: Record<string, unknown>): {
  readonly fulfilment_method?: FulfilmentMethod;
} {
  const found = body['fulfilment_method'];
  if (found === undefined) return {};
  if (!fulfilmentMethods.includes(found as FulfilmentMethod)) throw new BadRequestException();
  return { fulfilment_method: found as FulfilmentMethod };
}
function requiredFulfilmentMethod(body: Record<string, unknown>): FulfilmentMethod {
  const found = body['fulfilment_method'];
  if (!fulfilmentMethods.includes(found as FulfilmentMethod)) throw new BadRequestException();
  return found as FulfilmentMethod;
}
function optionalSubstitutionPreference(body: Record<string, unknown>): {
  readonly substitution_preference?: SubstitutionPreference;
} {
  const found = body['substitution_preference'];
  if (found === undefined) return {};
  if (!substitutionPreferences.includes(found as SubstitutionPreference))
    throw new BadRequestException();
  return { substitution_preference: found as SubstitutionPreference };
}
const ownsCart = RequireAuthorization({
  capability: 'customer.cart.manage',
  conceal_resource: true,
});

@Controller('customer/cart')
export class CustomerCartController {
  constructor(
    @Inject(CUSTOMER_CART) private readonly cart: CustomerCartService,
    @Inject(CUSTOMER_DISCOVERY) private readonly discovery: CustomerDiscoveryService,
  ) {}

  @Get()
  @ownsCart
  async current() {
    try {
      return await this.cart.currentCart({ context: currentRequestContext() });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Put('address')
  @ownsCart
  async setAddress(@Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.cart.setCartAddress({
        context: currentRequestContext(),
        customer_address_id: uuid(stringField(body, 'customer_address_id')),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('lines')
  @ownsCart
  async addLine(@Body() raw: unknown) {
    const body = object(raw);
    try {
      const cart = await this.cart.addLine({
        context: currentRequestContext(),
        vendor_location_id: uuid(stringField(body, 'vendor_location_id')),
        catalogue_variant_id: uuid(stringField(body, 'catalogue_variant_id')),
        quantity: integerField(body, 'quantity'),
        ...optionalFulfilmentMethod(body),
        ...optionalSubstitutionPreference(body),
      });
      // Step 6.3 requirement 5 measures search-to-cart conversion. Recorded only
      // after the line is actually held, so a rejected add is never counted, and
      // only when the client attributes the add to search results.
      if (body['from_search'] === true) {
        await this.discovery.recordSearchToCart({ context: currentRequestContext() });
      }
      return cart;
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Put('lines/:cart_line_id')
  @ownsCart
  async setQuantity(@Param('cart_line_id') lineId: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.cart.setLineQuantity({
        context: currentRequestContext(),
        cart_line_id: uuid(lineId),
        expected_version: integerField(body, 'expected_version'),
        quantity: integerField(body, 'quantity'),
        ...optionalSubstitutionPreference(body),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('lines/:cart_line_id/remove')
  @ownsCart
  async removeLine(@Param('cart_line_id') lineId: string) {
    try {
      return await this.cart.removeLine({
        context: currentRequestContext(),
        cart_line_id: uuid(lineId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Put('groups/:cart_vendor_group_id/fulfilment-method')
  @ownsCart
  async setGroupFulfilmentMethod(
    @Param('cart_vendor_group_id') groupId: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    try {
      return await this.cart.setGroupFulfilmentMethod({
        context: currentRequestContext(),
        cart_vendor_group_id: uuid(groupId),
        expected_version: integerField(body, 'expected_version'),
        fulfilment_method: requiredFulfilmentMethod(body),
        customer_note:
          typeof body['customer_note'] === 'string' ? (body['customer_note'] as string) : null,
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('revalidate')
  @ownsCart
  async revalidate() {
    try {
      return { outcomes: await this.cart.revalidate({ context: currentRequestContext() }) };
    } catch (error) {
      translateDomainError(error);
    }
  }
}
