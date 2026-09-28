import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  CompleteMoneyLifecycleService,
  type DisputableComponent,
} from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { COMPLETE_MONEY_LIFECYCLE } from './tokens.js';
import {
  integerField,
  object,
  optionalDate,
  optionalUuid,
  stringField,
  uuid,
} from './request-fields.js';
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
/** Challenging a settlement line is its own capability (VEN-50, 10.3). */
const vendorDispute = RequireAuthorization({
  capability: 'vendor.finance.dispute',
  conceal_resource: true,
  vendor_location_id_param: 'vendor_location_id',
});
/** The lines a shop may challenge; an adjustment is argued on the line it changed. */
const DISPUTABLE_COMPONENTS: readonly DisputableComponent[] = [
  'ITEM_PROCEEDS',
  'PAYMENT_FEE',
  'PLATFORM_FEE',
  'REFUND',
  'TAX',
];
const resolveDispute = RequireAuthorization({
  admin_scope: { kind: 'GLOBAL' },
  capability: 'admin.vendor_settlement.resolve',
  conceal_resource: true,
});

function optionalPeriod(body: Record<string, unknown>) {
  const start = optionalDate(body, 'period_start');
  const end = optionalDate(body, 'period_end');
  // Both or neither: the service refuses half a period rather than guessing.
  return { ...(start ? { period_start: start } : {}), ...(end ? { period_end: end } : {}) };
}

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

  /** Sends a batch's scheduled payouts to the provider (10.4). */
  @Post('payout-batches/:payout_batch_id/submit')
  @manage
  @HttpCode(200)
  async submitPayoutBatch(@Param('payout_batch_id') id: string) {
    try {
      return await this.money.submitPayoutBatch({
        context: currentRequestContext(),
        payout_batch_id: uuid(id),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  /**
   * Releases what a partner payout the bank refused carried, once a person
   * has checked the partner's account (10.4); it is paid in the next batch.
   */
  @Post('payouts/:payout_id/release')
  @manage
  @HttpCode(200)
  async releaseFailedPartnerPayout(@Param('payout_id') id: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.money.releaseFailedPartnerPayout({
        context: currentRequestContext(),
        payout_id: uuid(id),
        reason_code: stringField(body, 'reason_code'),
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
        // The window the statement covers (10.5): what the books settled in
        // it and the statement leaves out is named missing.
        ...optionalPeriod(body),
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

  @Get('disputes')
  @vendorRead
  async disputes(@Param('vendor_location_id') id: string) {
    try {
      return await this.money.listSettlementDisputes({
        context: currentRequestContext(),
        vendor_location_id: uuid(id),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('disputes')
  @vendorDispute
  async openDispute(@Param('vendor_location_id') id: string, @Body() raw: unknown) {
    const value = object(raw);
    const component = stringField(value, 'disputed_component');
    if (!DISPUTABLE_COMPONENTS.includes(component as DisputableComponent))
      throw new BadRequestException();
    try {
      return await this.money.openSettlementDispute({
        context: currentRequestContext(),
        disputed_component: component as DisputableComponent,
        evidence_note: stringField(value, 'evidence_note'),
        expected_amount_minor: integerField(value, 'expected_amount_minor', 0),
        settlement_id: uuid(stringField(value, 'settlement_id')),
        vendor_location_id: uuid(id),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('disputes/:dispute_id/withdraw')
  @vendorDispute
  @HttpCode(200)
  async withdrawDispute(
    @Param('vendor_location_id') id: string,
    @Param('dispute_id') disputeId: string,
  ) {
    try {
      // The capability was checked for the store in the path; the case must
      // be that store's, or another store's staff could withdraw it.
      return await this.money.resolveSettlementDispute({
        context: currentRequestContext(),
        resolution: 'WITHDRAWN',
        vendor_location_id: uuid(id),
        vendor_settlement_dispute_id: uuid(disputeId),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
}

/** The operator's side of a shop's challenge (VEN-50, ADM-48, 10.3). */
@Controller('admin/finance/v2/vendor-settlement-disputes')
export class AdminVendorSettlementDisputeController {
  constructor(
    @Inject(COMPLETE_MONEY_LIFECYCLE)
    private readonly money: CompleteMoneyLifecycleService,
  ) {}

  /** The queue an operator answers from, overdue cases first (VEN-50, 11.5). */
  @Get()
  @resolveDispute
  async list(@Query('state') state?: string) {
    if (state !== undefined && !['OPEN', 'RESOLVED', 'WITHDRAWN'].includes(state))
      throw new BadRequestException();
    try {
      return await this.money.listVendorSettlementDisputesForAdmin({
        context: currentRequestContext(),
        ...(state ? { state: state as 'OPEN' | 'RESOLVED' | 'WITHDRAWN' } : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':dispute_id/resolve')
  @resolveDispute
  @HttpCode(200)
  async resolve(@Param('dispute_id') disputeId: string, @Body() raw: unknown) {
    const value = object(raw);
    try {
      // The decision is money: its adjustment is posted in the same
      // transaction that records it, so the answer and the books commit
      // together and nothing else pending rides on this request.
      return await this.money.resolveSettlementDispute({
        context: currentRequestContext(),
        resolution: 'RESOLVED',
        resolution_reason_code: stringField(value, 'resolution_reason_code'),
        resolved_amount_minor: integerField(value, 'resolved_amount_minor', 0),
        vendor_settlement_dispute_id: uuid(disputeId),
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
