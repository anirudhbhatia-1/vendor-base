import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  CompleteMoneyLifecycleService,
  MoneyAuthorizationError,
  MoneyInputError,
  MoneyNotFoundError,
  MoneyStateError,
} from '@neighbourhood-store/database';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { COMPLETE_MONEY_LIFECYCLE } from './tokens.js';

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
  if (!Number.isSafeInteger(found) || Number(found) < minimum) throw new BadRequestException();
  return Number(found);
}
function uuid(value: string): UuidV7 {
  try {
    return parseUuidV7(value);
  } catch {
    throw new BadRequestException();
  }
}
function optionalUuid(value: Record<string, unknown>, key: string): UuidV7 | undefined {
  return value[key] === undefined ? undefined : uuid(string(value, key));
}
function translate(error: unknown): never {
  if (error instanceof MoneyInputError || error instanceof TypeError)
    throw new BadRequestException(error.message);
  if (error instanceof MoneyNotFoundError) throw new NotFoundException();
  if (error instanceof MoneyStateError) throw new ConflictException({ error_code: error.code });
  if (error instanceof MoneyAuthorizationError) throw new ForbiddenException();
  throw error;
}

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
        command_reference: string(body, 'command_reference'),
        context: currentRequestContext(),
        expected_version: integer(body, 'expected_version', 1),
        payment_transaction_id: uuid(id),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('payout-batches')
  @manage
  async createPayoutBatch(@Body() raw: unknown) {
    const body = object(raw);
    const beneficiaryKind = string(body, 'beneficiary_kind');
    const providerScenario = string(body, 'provider_scenario');
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
      translate(error);
    }
  }

  @Post('payout-jobs/daily')
  @manage
  async schedulePayoutJob() {
    try {
      return await this.money.scheduleDailyPayoutJob({ context: currentRequestContext() });
    } catch (error) {
      translate(error);
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
          const kind = string(row, 'operation_kind');
          const state = string(row, 'provider_state');
          if (!['PAYMENT', 'PAYOUT', 'REFUND'].includes(kind)) throw new BadRequestException();
          if (!['FAILED', 'SUCCEEDED', 'UNKNOWN'].includes(state)) throw new BadRequestException();
          return {
            amount_minor: integer(row, 'amount_minor', 1),
            operation_kind: kind as 'PAYMENT' | 'PAYOUT' | 'REFUND',
            provider_operation_reference: string(row, 'provider_operation_reference'),
            provider_state: state as 'FAILED' | 'SUCCEEDED' | 'UNKNOWN',
          };
        }),
        statement_reference: string(body, 'statement_reference'),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('corrections')
  @manage
  async proposeCorrection(@Body() raw: unknown) {
    const body = object(raw);
    if (!Array.isArray(body['entries'])) throw new BadRequestException();
    try {
      return await this.money.proposeCorrection({
        amount_minor: integer(body, 'amount_minor', 1),
        context: currentRequestContext(),
        correction_reference: string(body, 'correction_reference'),
        entries: body['entries'].map((rawEntry) => {
          const entry = object(rawEntry);
          const partnerUserId = optionalUuid(entry, 'partner_user_id');
          const vendorLocationId = optionalUuid(entry, 'vendor_location_id');
          return {
            account_reference: string(entry, 'account_reference'),
            component: string(entry, 'component'),
            credit_minor: integer(entry, 'credit_minor'),
            debit_minor: integer(entry, 'debit_minor'),
            ...(partnerUserId ? { partner_user_id: partnerUserId } : {}),
            ...(entry['source_order_reference'] === undefined
              ? {}
              : { source_order_reference: string(entry, 'source_order_reference') }),
            ...(vendorLocationId ? { vendor_location_id: vendorLocationId } : {}),
          };
        }),
        evidence_reference: string(body, 'evidence_reference'),
        original_ledger_transaction_id: uuid(string(body, 'original_ledger_transaction_id')),
        reason_code: string(body, 'reason_code'),
      });
    } catch (error) {
      translate(error);
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
        expected_version: integer(body, 'expected_version', 1),
        financial_correction_id: uuid(id),
      });
    } catch (error) {
      translate(error);
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
      translate(error);
    }
  }

  @Get('exceptions')
  @manage
  async exceptions() {
    try {
      return await this.money.financeQueue({ context: currentRequestContext() });
    } catch (error) {
      translate(error);
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
      translate(error);
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
      translate(error);
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
      translate(error);
    }
  }
}
