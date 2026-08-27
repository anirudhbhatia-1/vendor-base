import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  CheckoutConflictError,
  CheckoutInputError,
  CheckoutNotFoundError,
  CheckoutPaymentDeclinedError,
  GroupedCheckoutService,
  type FakeProviderScenario,
} from '@neighbourhood-store/database';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { GROUPED_CHECKOUT } from './tokens.js';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): UuidV7 {
  try {
    return parseUuidV7(String(value));
  } catch {
    throw new BadRequestException();
  }
}
function scenario(value: unknown): FakeProviderScenario {
  if (!['SUCCESS', 'DECLINE', 'UNKNOWN', 'MALFORMED'].includes(String(value)))
    throw new BadRequestException();
  return String(value) as FakeProviderScenario;
}
function map(error: unknown): never {
  if (error instanceof CheckoutInputError) throw new BadRequestException(error.message);
  if (error instanceof CheckoutNotFoundError) throw new NotFoundException();
  if (error instanceof CheckoutConflictError) throw new ConflictException(error.message);
  if (error instanceof CheckoutPaymentDeclinedError)
    throw new ConflictException('Synthetic payment declined');
  throw error;
}
const checkout = RequireAuthorization({
  capability: 'customer.checkout.manage',
  conceal_resource: true,
});

@Controller('customer/checkout')
export class GroupedCheckoutController {
  constructor(@Inject(GROUPED_CHECKOUT) private readonly service: GroupedCheckoutService) {}
  @Post('quotes') @checkout async quote(@Body() raw: unknown) {
    try {
      return await this.service.createQuote({
        context: currentRequestContext(),
        cart_id: uuid(object(raw).cart_id),
      });
    } catch (error) {
      map(error);
    }
  }
  @Post('groups') @checkout async place(@Body() raw: unknown) {
    const value = object(raw);
    try {
      const idempotencyKey =
        typeof value.idempotency_key === 'string' ? value.idempotency_key : undefined;
      return await this.service.place({
        context: currentRequestContext(),
        checkout_quote_id: uuid(value.checkout_quote_id),
        provider_scenario: scenario(value.provider_scenario),
        ...(idempotencyKey === undefined ? {} : { idempotency_key: idempotencyKey }),
      });
    } catch (error) {
      map(error);
    }
  }
  @Get('groups/:checkout_group_id') @checkout async get(@Param('checkout_group_id') id: string) {
    try {
      return await this.service.get({
        context: currentRequestContext(),
        checkout_group_id: uuid(id),
      });
    } catch (error) {
      map(error);
    }
  }

  @Get('groups/:checkout_group_id/history')
  @checkout
  async history(
    @Param('checkout_group_id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') rawLimit?: string,
  ) {
    try {
      return await this.service.history({
        context: currentRequestContext(),
        checkout_group_id: uuid(id),
        ...(cursor ? { cursor: uuid(cursor) } : {}),
        ...(rawLimit ? { limit: Number(rawLimit) } : {}),
      });
    } catch (error) {
      map(error);
    }
  }

  @Post('provider-webhook')
  async webhook(@Body() raw: unknown, @Headers('x-synthetic-signature') signature: string) {
    const value = object(raw);
    try {
      return await this.service.receiveWebhook({
        context: currentRequestContext(),
        provider_event_id: String(value.provider_event_id),
        provider_operation_reference: String(value.provider_operation_reference),
        outcome: value.outcome === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
        occurred_at: String(value.occurred_at),
        signature: signature ?? '',
      });
    } catch (error) {
      map(error);
    }
  }
}
