import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { GroupedCheckoutService, type PaymentMethod } from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { GROUPED_CHECKOUT } from './tokens.js';
import { object, uuid } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
/**
 * The prepaid method, validated server-side.
 *
 * Absent is accepted — a client that has not been updated still checks out —
 * but an unrecognised value is rejected rather than stored. `COD` therefore
 * fails here as well as at the database constraint (GAT-01).
 */
function paymentMethod(value: unknown): PaymentMethod | undefined {
  if (value === undefined || value === null) return undefined;
  if (!['UPI', 'CARD', 'WALLET'].includes(String(value))) throw new BadRequestException();
  return String(value) as PaymentMethod;
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
      translateDomainError(error);
    }
  }
  @Post('groups') @checkout async place(@Body() raw: unknown) {
    const value = object(raw);
    try {
      const idempotencyKey =
        typeof value.idempotency_key === 'string' ? value.idempotency_key : undefined;
      const method = paymentMethod(value.payment_method);
      return await this.service.place({
        context: currentRequestContext(),
        checkout_quote_id: uuid(value.checkout_quote_id),
        ...(method === undefined ? {} : { payment_method: method }),
        ...(idempotencyKey === undefined ? {} : { idempotency_key: idempotencyKey }),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
  @Get('groups/:checkout_group_id') @checkout async get(@Param('checkout_group_id') id: string) {
    try {
      return await this.service.get({
        context: currentRequestContext(),
        checkout_group_id: uuid(id),
      });
    } catch (error) {
      translateDomainError(error);
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
      translateDomainError(error);
    }
  }

  @Post('provider-webhook')
  async webhook(@Body() raw: unknown, @Headers('x-provider-signature') signature: string) {
    const value = object(raw);
    // An outcome this boundary does not know is not a failure. It used to be
    // read as one, and a failure cancels the placement and gives its stock
    // back; a word the provider never sent must not do that.
    if (value.outcome !== 'SUCCEEDED' && value.outcome !== 'FAILED')
      throw new BadRequestException();
    try {
      return await this.service.receiveWebhook({
        context: currentRequestContext(),
        provider_event_id: String(value.provider_event_id),
        provider_operation_reference: String(value.provider_operation_reference),
        outcome: value.outcome,
        occurred_at: String(value.occurred_at),
        signature: signature ?? '',
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
}
