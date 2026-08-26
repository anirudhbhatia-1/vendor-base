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
  Put,
} from '@nestjs/common';
import {
  CustomerCartAuthorizationError,
  CustomerCartConflictError,
  CustomerCartInputError,
  CustomerCartNotFoundError,
  CustomerCartService,
  type FulfilmentMethod,
  type SubstitutionPreference,
} from '@neighbourhood-store/database';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { CUSTOMER_CART } from './tokens.js';

const fulfilmentMethods = ['CUSTOMER_PICKUP', 'PLATFORM_DELIVERY', 'VENDOR_DELIVERY'] as const;
const substitutionPreferences = ['ALLOW_SAME_STORE', 'ASK_CUSTOMER', 'NO_SUBSTITUTION'] as const;

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
function uuid(value: string): UuidV7 {
  try {
    return parseUuidV7(value);
  } catch {
    throw new BadRequestException();
  }
}
function map(error: unknown): never {
  if (error instanceof CustomerCartInputError) throw new BadRequestException(error.message);
  if (error instanceof CustomerCartNotFoundError) throw new NotFoundException();
  if (error instanceof CustomerCartConflictError) throw new ConflictException(error.message);
  if (error instanceof CustomerCartAuthorizationError) throw new ForbiddenException();
  throw error;
}

const ownsCart = RequireAuthorization({
  capability: 'customer.cart.manage',
  conceal_resource: true,
});

@Controller('customer/cart')
export class CustomerCartController {
  constructor(@Inject(CUSTOMER_CART) private readonly cart: CustomerCartService) {}

  @Get()
  @ownsCart
  async current() {
    try {
      return await this.cart.currentCart({ context: currentRequestContext() });
    } catch (error) {
      map(error);
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
      map(error);
    }
  }

  @Post('lines')
  @ownsCart
  async addLine(@Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.cart.addLine({
        context: currentRequestContext(),
        vendor_location_id: uuid(stringField(body, 'vendor_location_id')),
        catalogue_variant_id: uuid(stringField(body, 'catalogue_variant_id')),
        quantity: integerField(body, 'quantity'),
        ...optionalFulfilmentMethod(body),
        ...optionalSubstitutionPreference(body),
      });
    } catch (error) {
      map(error);
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
      });
    } catch (error) {
      map(error);
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
      map(error);
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
      map(error);
    }
  }

  @Post('revalidate')
  @ownsCart
  async revalidate() {
    try {
      return { outcomes: await this.cart.revalidate({ context: currentRequestContext() }) };
    } catch (error) {
      map(error);
    }
  }
}
