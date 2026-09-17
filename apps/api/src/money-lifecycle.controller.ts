import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { MoneyLifecycleService, type FakeProviderScenario } from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { MONEY_LIFECYCLE } from './tokens.js';
import { booleanField, integerField, object, stringField, uuid } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
function scenario(value: Record<string, unknown>): FakeProviderScenario {
  const found = stringField(value, 'provider_scenario');
  if (!['SUCCESS', 'DECLINE', 'UNKNOWN', 'MALFORMED'].includes(found))
    throw new BadRequestException();
  return found as FakeProviderScenario;
}
const manageFinance = RequireAuthorization({
  admin_scope: { kind: 'GLOBAL' },
  capability: 'admin.finance.ledger_manage',
  conceal_resource: true,
});

@Controller('admin/finance')
export class MoneyLifecycleController {
  constructor(@Inject(MONEY_LIFECYCLE) private readonly money: MoneyLifecycleService) {}

  @Get('payments')
  @manageFinance
  async listPayments() {
    try {
      return { payments: await this.money.listPayments({ context: currentRequestContext() }) };
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Get('refunds')
  @manageFinance
  async listRefunds() {
    try {
      return { refunds: await this.money.listRefunds({ context: currentRequestContext() }) };
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

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
            delivery_minor: integerField(row, 'delivery_minor', 0),
            discount_minor: integerField(row, 'discount_minor', 0),
            item_minor: integerField(row, 'item_minor', 0),
            policy_version_reference: stringField(row, 'policy_version_reference'),
            source_order_reference: stringField(row, 'source_order_reference'),
            tax_minor: integerField(row, 'tax_minor', 0),
            tip_minor: integerField(row, 'tip_minor', 0),
            vendor_location_id: uuid(stringField(row, 'vendor_location_id')),
          };
        }),
        amount_minor: integerField(value, 'amount_minor', 1),
        command_reference: stringField(value, 'command_reference'),
        context: currentRequestContext(),
        provider_operation_reference: stringField(value, 'provider_operation_reference'),
        provider_scenario: scenario(value),
        source_checkout_reference: stringField(value, 'source_checkout_reference'),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
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
    const trigger = stringField(value, 'trigger_code');
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
        command_reference: stringField(value, 'command_reference'),
        context: currentRequestContext(),
        delivery_minor: integerField(value, 'delivery_minor', 0),
        discount_reversal_minor: integerField(value, 'discount_reversal_minor', 0),
        item_minor: integerField(value, 'item_minor', 0),
        payment_transaction_id: uuid(stringField(value, 'payment_transaction_id')),
        provider_operation_reference: stringField(value, 'provider_operation_reference'),
        provider_scenario: scenario(value),
        source_order_reference: stringField(value, 'source_order_reference'),
        tax_minor: integerField(value, 'tax_minor', 0),
        tip_minor: integerField(value, 'tip_minor', 0),
        trigger_code: trigger as
          | 'CONTROLLED_RETURN'
          | 'FULL_ITEM_REFUND'
          | 'PARTIAL_ITEM_REFUND'
          | 'PRE_PICKUP_CANCEL'
          | 'PROVIDER_EXCEPTION',
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('refunds/:refund_id/approve-submit')
  @manageFinance
  @HttpCode(200)
  async approveRefund(@Param('refund_id') id: string, @Body() raw: unknown) {
    const value = object(raw);
    try {
      return await this.money.approveAndSubmitRefund({
        command_reference: stringField(value, 'command_reference'),
        context: currentRequestContext(),
        expected_version: integerField(value, 'expected_version', 1),
        refund_id: uuid(id),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('settlements')
  @manageFinance
  async createSettlement(@Body() raw: unknown) {
    const value = object(raw);
    try {
      // The manual route has no quote to date the policy from, so it uses the
      // one in force now. Restating an old order's money belongs in the
      // correction path, which keeps the original version intact.
      const financial = await this.money.resolveActiveFinancialPolicy();
      return await this.money.createSettlement({
        completed: booleanField(value, 'completed'),
        context: currentRequestContext(),
        financial_policy: financial.policy,
        policy_version_reference: financial.version_reference,
        customer_captured_minor: integerField(value, 'customer_captured_minor', 0),
        partner_outbound_minor: integerField(value, 'partner_outbound_minor', 0),
        partner_return_minor: integerField(value, 'partner_return_minor', 0),
        partner_tip_minor: integerField(value, 'partner_tip_minor', 0),
        ...(value.partner_user_id
          ? { partner_user_id: uuid(stringField(value, 'partner_user_id')) }
          : {}),
        partner_wait_minor: integerField(value, 'partner_wait_minor', 0),
        payment_transaction_id: uuid(stringField(value, 'payment_transaction_id')),
        source_order_reference: stringField(value, 'source_order_reference'),
        successful_refunds_minor: integerField(value, 'successful_refunds_minor', 0),
        vendor_item_minor: integerField(value, 'vendor_item_minor', 0),
        vendor_location_id: uuid(stringField(value, 'vendor_location_id')),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('settlements/:settlement_id/payouts')
  @manageFinance
  async schedulePayout(@Param('settlement_id') id: string, @Body() raw: unknown) {
    const value = object(raw);
    const kind = stringField(value, 'beneficiary_kind');
    if (kind !== 'VENDOR' && kind !== 'PARTNER') throw new BadRequestException();
    try {
      return await this.money.schedulePayout({
        amount_minor: integerField(value, 'amount_minor', 1),
        beneficiary_kind: kind,
        beneficiary_reference: stringField(value, 'beneficiary_reference'),
        context: currentRequestContext(),
        provider_operation_reference: stringField(value, 'provider_operation_reference'),
        provider_scenario: scenario(value),
        settlement_id: uuid(id),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
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
        expected_version: integerField(value, 'expected_version', 1),
        payout_id: uuid(id),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('payouts/:payout_id/reconcile')
  @manageFinance
  @HttpCode(200)
  async reconcilePayout(@Param('payout_id') id: string, @Body() raw: unknown) {
    const value = object(raw);
    const state = stringField(value, 'provider_state');
    if (!['FAILED', 'SUCCEEDED', 'UNKNOWN'].includes(state)) throw new BadRequestException();
    try {
      return await this.money.reconcilePayout({
        amount_minor: integerField(value, 'amount_minor', 1),
        context: currentRequestContext(),
        payout_id: uuid(id),
        provider_state: state as 'FAILED' | 'SUCCEEDED' | 'UNKNOWN',
        statement_reference: stringField(value, 'statement_reference'),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  private async paymentTransition(kind: 'authorize' | 'capture', id: string, raw: unknown) {
    const value = object(raw);
    try {
      return await this.money[kind]({
        command_reference: stringField(value, 'command_reference'),
        context: currentRequestContext(),
        expected_version: integerField(value, 'expected_version', 1),
        payment_transaction_id: uuid(id),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
}
