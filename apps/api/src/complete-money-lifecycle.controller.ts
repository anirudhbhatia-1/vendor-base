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
import { CompleteMoneyLifecycleService } from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { COMPLETE_MONEY_LIFECYCLE } from './tokens.js';
import { integerField, object, optionalUuid, stringField, uuid } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
const manage = RequireAuthorization({
  admin_scope: { kind: 'GLOBAL' },
  capability: 'admin.finance.ledger_manage',
  conceal_resource: true,
});
const customerRead = RequireAuthorization({
  capability: 'customer.order.read',
  conceal_resource: true,
});
const partnerRead = RequireAuthorization({
  capability: 'partner.finance.read',
  conceal_resource: true,
});
const vendorRead = RequireAuthorization({
  capability: 'vendor.finance.read',
  conceal_resource: true,
  vendor_location_id_param: 'vendor_location_id',
});

@Controller('admin/finance/v2')
export class CompleteMoneyAdminController {
  constructor(
    @Inject(COMPLETE_MONEY_LIFECYCLE)
    private readonly money: CompleteMoneyLifecycleService,
  ) {}

  @Post('payments/:payment_id/void')
  @manage
  @HttpCode(200)
  async voidPayment(@Param('payment_id') id: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.money.voidAuthorization({
        command_reference: stringField(body, 'command_reference'),
        context: currentRequestContext(),
        expected_version: integerField(body, 'expected_version', 1),
        payment_transaction_id: uuid(id),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('payout-batches')
  @manage
  async createPayoutBatch(@Body() raw: unknown) {
    const body = object(raw);
    const beneficiaryKind = stringField(body, 'beneficiary_kind');
    const providerScenario = stringField(body, 'provider_scenario');
    if (!['VENDOR', 'PARTNER'].includes(beneficiaryKind)) throw new BadRequestException();
    if (!['SUCCESS', 'DECLINE', 'UNKNOWN', 'MALFORMED'].includes(providerScenario))
      throw new BadRequestException();
    try {
      return await this.money.createPayoutBatch({
        beneficiary_kind: beneficiaryKind as 'PARTNER' | 'VENDOR',
        context: currentRequestContext(),
        provider_scenario: providerScenario as 'DECLINE' | 'MALFORMED' | 'SUCCESS' | 'UNKNOWN',
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('payout-jobs/daily')
  @manage
  async schedulePayoutJob() {
    try {
      return await this.money.scheduleDailyPayoutJob({ context: currentRequestContext() });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('provider-statements')
  @manage
  async importStatement(@Body() raw: unknown) {
    const body = object(raw);
    if (!Array.isArray(body['rows'])) throw new BadRequestException();
    try {
      return await this.money.importProviderStatement({
        context: currentRequestContext(),
        rows: body['rows'].map((rawRow) => {
          const row = object(rawRow);
          const kind = stringField(row, 'operation_kind');
          const state = stringField(row, 'provider_state');
          if (!['PAYMENT', 'PAYOUT', 'REFUND'].includes(kind)) throw new BadRequestException();
          if (!['FAILED', 'SUCCEEDED', 'UNKNOWN'].includes(state)) throw new BadRequestException();
          return {
            amount_minor: integerField(row, 'amount_minor', 1),
            operation_kind: kind as 'PAYMENT' | 'PAYOUT' | 'REFUND',
            provider_operation_reference: stringField(row, 'provider_operation_reference'),
            provider_state: state as 'FAILED' | 'SUCCEEDED' | 'UNKNOWN',
          };
        }),
        statement_reference: stringField(body, 'statement_reference'),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('corrections')
  @manage
  async proposeCorrection(@Body() raw: unknown) {
    const body = object(raw);
    if (!Array.isArray(body['entries'])) throw new BadRequestException();
    try {
      return await this.money.proposeCorrection({
        amount_minor: integerField(body, 'amount_minor', 1),
        context: currentRequestContext(),
        correction_reference: stringField(body, 'correction_reference'),
        entries: body['entries'].map((rawEntry) => {
          const entry = object(rawEntry);
          const partnerUserId = optionalUuid(entry, 'partner_user_id');
          const vendorLocationId = optionalUuid(entry, 'vendor_location_id');
          return {
            account_reference: stringField(entry, 'account_reference'),
            component: stringField(entry, 'component'),
            credit_minor: integerField(entry, 'credit_minor', 0),
            debit_minor: integerField(entry, 'debit_minor', 0),
            ...(partnerUserId ? { partner_user_id: partnerUserId } : {}),
            ...(entry['source_order_reference'] === undefined
              ? {}
              : { source_order_reference: stringField(entry, 'source_order_reference') }),
            ...(vendorLocationId ? { vendor_location_id: vendorLocationId } : {}),
          };
        }),
        evidence_reference: stringField(body, 'evidence_reference'),
        original_ledger_transaction_id: uuid(stringField(body, 'original_ledger_transaction_id')),
        reason_code: stringField(body, 'reason_code'),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('corrections/:correction_id/approve-post')
  @manage
  @HttpCode(200)
  async approveCorrection(@Param('correction_id') id: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.money.approveAndPostCorrection({
        context: currentRequestContext(),
        expected_version: integerField(body, 'expected_version', 1),
        financial_correction_id: uuid(id),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('partner-earnings/:earnings_id/post')
  @manage
  @HttpCode(200)
  async postPartnerEarning(@Param('earnings_id') id: string) {
    try {
      return await this.money.postPartnerEarning({
        context: currentRequestContext(),
        partner_earnings_record_id: uuid(id),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Get('exceptions')
  @manage
  async exceptions() {
    try {
      return await this.money.financeQueue({ context: currentRequestContext() });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  /** The trial balance (10.1): the catalogue with its postings, shown only when it balances. */
  @Get('ledger')
  @manage
  async ledger() {
    try {
      return await this.money.ledgerTrialBalance({ context: currentRequestContext() });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Get('ledger/transactions/:ledger_transaction_id')
  @manage
  async ledgerTransaction(@Param('ledger_transaction_id') ledgerTransactionId: string) {
    try {
      return await this.money.ledgerTransaction({
        context: currentRequestContext(),
        ledger_transaction_id: uuid(ledgerTransactionId),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
}

@Controller('customer/finance')
export class CustomerFinanceController {
  constructor(
    @Inject(COMPLETE_MONEY_LIFECYCLE)
    private readonly money: CompleteMoneyLifecycleService,
  ) {}

  @Get('receipts/:checkout_group_id')
  @customerRead
  async receipt(@Param('checkout_group_id') id: string) {
    try {
      return await this.money.customerReceipt({
        checkout_group_id: uuid(id),
        context: currentRequestContext(),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
}

@Controller('vendor/locations/:vendor_location_id/finance')
export class VendorFinanceController {
  constructor(
    @Inject(COMPLETE_MONEY_LIFECYCLE)
    private readonly money: CompleteMoneyLifecycleService,
  ) {}

  @Get('statement')
  @vendorRead
  async statement(@Param('vendor_location_id') id: string) {
    try {
      return await this.money.vendorStatement({
        context: currentRequestContext(),
        vendor_location_id: uuid(id),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
}

@Controller('partner/finance')
export class PartnerFinanceController {
  constructor(
    @Inject(COMPLETE_MONEY_LIFECYCLE)
    private readonly money: CompleteMoneyLifecycleService,
  ) {}

  @Get('statement')
  @partnerRead
  async statement() {
    try {
      return await this.money.partnerStatement({ context: currentRequestContext() });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
}
