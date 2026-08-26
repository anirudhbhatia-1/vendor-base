import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  MoneyAuthorizationError,
  MoneyInputError,
  MoneyLifecycleService,
  MoneyNotFoundError,
  MoneyStateError,
  type FakeProviderScenario,
} from '@neighbourhood-store/database';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { MONEY_LIFECYCLE } from './tokens.js';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}
function string(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== 'string') throw new BadRequestException();
  return value[key];
}
function integer(value: Record<string, unknown>, key: string, minimum = 0): number {
  const found = value[key];
  if (!Number.isSafeInteger(found) || (found as number) < minimum) throw new BadRequestException();
  return found as number;
}
function boolean(value: Record<string, unknown>, key: string): boolean {
  if (typeof value[key] !== 'boolean') throw new BadRequestException();
  return value[key];
}
function uuid(value: string): UuidV7 {
  try {
    return parseUuidV7(value);
  } catch {
    throw new BadRequestException();
  }
}
function scenario(value: Record<string, unknown>): FakeProviderScenario {
  const found = string(value, 'provider_scenario');
  if (!['SUCCESS', 'DECLINE', 'UNKNOWN', 'MALFORMED'].includes(found))
    throw new BadRequestException();
  return found as FakeProviderScenario;
}
function translate(error: unknown): never {
  if (error instanceof MoneyInputError || error instanceof TypeError)
    throw new BadRequestException();
  if (error instanceof MoneyNotFoundError) throw new NotFoundException();
  if (error instanceof MoneyStateError) throw new ConflictException({ error_code: error.code });
  if (error instanceof MoneyAuthorizationError) throw new ForbiddenException();
  throw error;
}

const manageFinance = RequireAuthorization({
  admin_scope: { kind: 'GLOBAL' },
  capability: 'admin.finance.ledger_manage',
  conceal_resource: true,
});

@Controller('admin/finance')
export class MoneyLifecycleController {
  constructor(@Inject(MONEY_LIFECYCLE) private readonly money: MoneyLifecycleService) {}

  @Post('payments')
  @manageFinance
  async createPayment(@Body() raw: unknown) {
    const value = object(raw);
    const allocations = value.allocations;
    if (!Array.isArray(allocations)) throw new BadRequestException();
    try {
      return await this.money.createPayment({
        allocations: allocations.map((entry) => {
          const row = object(entry);
          return {
            delivery_minor: integer(row, 'delivery_minor'),
            discount_minor: integer(row, 'discount_minor'),
            item_minor: integer(row, 'item_minor'),
            policy_version_reference: string(row, 'policy_version_reference'),
            source_order_reference: string(row, 'source_order_reference'),
            tax_minor: integer(row, 'tax_minor'),
            tip_minor: integer(row, 'tip_minor'),
            vendor_location_id: uuid(string(row, 'vendor_location_id')),
          };
        }),
        amount_minor: integer(value, 'amount_minor', 1),
        command_reference: string(value, 'command_reference'),
        context: currentRequestContext(),
        provider_operation_reference: string(value, 'provider_operation_reference'),
        provider_scenario: scenario(value),
        source_checkout_reference: string(value, 'source_checkout_reference'),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('payments/:payment_id/authorize')
  @manageFinance
  @HttpCode(200)
  async authorize(@Param('payment_id') id: string, @Body() raw: unknown) {
    return this.paymentTransition('authorize', id, raw);
  }

  @Post('payments/:payment_id/capture')
  @manageFinance
  @HttpCode(200)
  async capture(@Param('payment_id') id: string, @Body() raw: unknown) {
    return this.paymentTransition('capture', id, raw);
  }

  @Post('refunds')
  @manageFinance
  async proposeRefund(@Body() raw: unknown) {
    const value = object(raw);
    const trigger = string(value, 'trigger_code');
    if (
      ![
        'CONTROLLED_RETURN',
        'FULL_ITEM_REFUND',
        'PARTIAL_ITEM_REFUND',
        'PRE_PICKUP_CANCEL',
        'PROVIDER_EXCEPTION',
      ].includes(trigger)
    )
      throw new BadRequestException();
    try {
      return await this.money.proposeRefund({
        command_reference: string(value, 'command_reference'),
        context: currentRequestContext(),
        delivery_minor: integer(value, 'delivery_minor'),
        discount_reversal_minor: integer(value, 'discount_reversal_minor'),
        item_minor: integer(value, 'item_minor'),
        payment_transaction_id: uuid(string(value, 'payment_transaction_id')),
        provider_operation_reference: string(value, 'provider_operation_reference'),
        provider_scenario: scenario(value),
        source_order_reference: string(value, 'source_order_reference'),
        tax_minor: integer(value, 'tax_minor'),
        tip_minor: integer(value, 'tip_minor'),
        trigger_code: trigger as
          | 'CONTROLLED_RETURN'
          | 'FULL_ITEM_REFUND'
          | 'PARTIAL_ITEM_REFUND'
          | 'PRE_PICKUP_CANCEL'
          | 'PROVIDER_EXCEPTION',
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('refunds/:refund_id/approve-submit')
  @manageFinance
  @HttpCode(200)
  async approveRefund(@Param('refund_id') id: string, @Body() raw: unknown) {
    const value = object(raw);
    try {
      return await this.money.approveAndSubmitRefund({
        command_reference: string(value, 'command_reference'),
        context: currentRequestContext(),
        expected_version: integer(value, 'expected_version', 1),
        refund_id: uuid(id),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('settlements')
  @manageFinance
  async createSettlement(@Body() raw: unknown) {
    const value = object(raw);
    try {
      return await this.money.createSettlement({
        completed: boolean(value, 'completed'),
        context: currentRequestContext(),
        customer_captured_minor: integer(value, 'customer_captured_minor'),
        partner_outbound_minor: integer(value, 'partner_outbound_minor'),
        partner_return_minor: integer(value, 'partner_return_minor'),
        partner_tip_minor: integer(value, 'partner_tip_minor'),
        ...(value.partner_user_id
          ? { partner_user_id: uuid(string(value, 'partner_user_id')) }
          : {}),
        partner_wait_minor: integer(value, 'partner_wait_minor'),
        payment_transaction_id: uuid(string(value, 'payment_transaction_id')),
        source_order_reference: string(value, 'source_order_reference'),
        successful_refunds_minor: integer(value, 'successful_refunds_minor'),
        vendor_item_minor: integer(value, 'vendor_item_minor'),
        vendor_location_id: uuid(string(value, 'vendor_location_id')),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('settlements/:settlement_id/payouts')
  @manageFinance
  async schedulePayout(@Param('settlement_id') id: string, @Body() raw: unknown) {
    const value = object(raw);
    const kind = string(value, 'beneficiary_kind');
    if (kind !== 'VENDOR' && kind !== 'PARTNER') throw new BadRequestException();
    try {
      return await this.money.schedulePayout({
        amount_minor: integer(value, 'amount_minor', 1),
        beneficiary_kind: kind,
        beneficiary_reference: string(value, 'beneficiary_reference'),
        context: currentRequestContext(),
        provider_operation_reference: string(value, 'provider_operation_reference'),
        provider_scenario: scenario(value),
        settlement_id: uuid(id),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('payouts/:payout_id/submit')
  @manageFinance
  @HttpCode(200)
  async submitPayout(@Param('payout_id') id: string, @Body() raw: unknown) {
    const value = object(raw);
    try {
      return await this.money.submitPayout({
        context: currentRequestContext(),
        expected_version: integer(value, 'expected_version', 1),
        payout_id: uuid(id),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('payouts/:payout_id/reconcile')
  @manageFinance
  @HttpCode(200)
  async reconcilePayout(@Param('payout_id') id: string, @Body() raw: unknown) {
    const value = object(raw);
    const state = string(value, 'provider_state');
    if (!['FAILED', 'SUCCEEDED', 'UNKNOWN'].includes(state)) throw new BadRequestException();
    try {
      return await this.money.reconcilePayout({
        amount_minor: integer(value, 'amount_minor', 1),
        context: currentRequestContext(),
        payout_id: uuid(id),
        provider_state: state as 'FAILED' | 'SUCCEEDED' | 'UNKNOWN',
        statement_reference: string(value, 'statement_reference'),
      });
    } catch (error) {
      translate(error);
    }
  }

  private async paymentTransition(kind: 'authorize' | 'capture', id: string, raw: unknown) {
    const value = object(raw);
    try {
      return await this.money[kind]({
        command_reference: string(value, 'command_reference'),
        context: currentRequestContext(),
        expected_version: integer(value, 'expected_version', 1),
        payment_transaction_id: uuid(id),
      });
    } catch (error) {
      translate(error);
    }
  }
}
