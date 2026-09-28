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
import type { SupportCaseService } from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { SUPPORT_CASES } from './tokens.js';
import {
  integerField,
  object,
  optionalInteger,
  optionalString,
  optionalUuid,
  stringField,
  uuid,
} from './request-fields.js';
import { translateDomainError } from './domain-errors.js';

/**
 * Working support cases needs the capability everywhere; a quality review is
 * refused by the service unless the reviewer also holds its own (11.3).
 */
const manage = RequireAuthorization({
  capability: 'admin.support.case_manage',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: true,
});
const customerRead = RequireAuthorization({
  capability: 'customer.order.read',
  conceal_resource: true,
});

@Controller('admin/support/cases')
export class AdminSupportCaseController {
  constructor(@Inject(SUPPORT_CASES) private readonly cases: SupportCaseService) {}

  @Get()
  @manage
  async queue(
    @Query('view') view?: string,
    @Query('owner') owner?: string,
    @Query('team') team?: string,
    @Query('severity') severity?: string,
  ) {
    try {
      return await this.cases.queue({
        context: currentRequestContext(),
        ...(view ? { view: view as 'ACTIVE' } : {}),
        ...(owner ? { owner: owner as 'ANY' } : {}),
        ...(team ? { team } : {}),
        ...(severity ? { severity } : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post()
  @manage
  async open(@Body() raw: unknown) {
    const body = object(raw);
    try {
      const lineId = optionalUuid(body, 'vendor_order_line_id');
      const assignmentId = optionalUuid(body, 'delivery_assignment_id');
      const severity = optionalString(body, 'severity');
      return await this.cases.open({
        context: currentRequestContext(),
        vendor_order_id: uuid(body.vendor_order_id),
        category: stringField(body, 'category'),
        description: stringField(body, 'description'),
        ...(lineId ? { vendor_order_line_id: lineId } : {}),
        ...(assignmentId ? { delivery_assignment_id: assignmentId } : {}),
        ...(severity ? { severity } : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get(':support_case_id')
  @manage
  async detail(@Param('support_case_id') caseId: string) {
    try {
      return await this.cases.detail({
        context: currentRequestContext(),
        support_case_id: uuid(caseId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':support_case_id/actions/:action')
  @manage
  @HttpCode(200)
  async act(
    @Param('support_case_id') caseId: string,
    @Param('action') action: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    if (!/^[A-Z_]{3,32}$/.test(action)) throw new BadRequestException();
    try {
      const text = (key: string) => optionalString(body, key);
      const ownerUserId = optionalUuid(body, 'owner_user_id');
      const refundId = optionalUuid(body, 'refund_id');
      const targetCaseId = optionalUuid(body, 'target_case_id');
      const within = optionalInteger(body, 'respond_within_seconds', 1);
      const fields = {
        body: text('body'),
        owner_team: text('owner_team'),
        severity: text('severity'),
        resolution_code: text('resolution_code'),
        outcome: text('outcome'),
        evidence_reference: text('evidence_reference'),
        classification: text('classification'),
      };
      return await this.cases.act({
        context: currentRequestContext(),
        support_case_id: uuid(caseId),
        action,
        expected_version: integerField(body, 'expected_version', 1),
        reason_code: stringField(body, 'reason_code'),
        ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
        ...(ownerUserId ? { owner_user_id: ownerUserId } : {}),
        ...(refundId ? { refund_id: refundId } : {}),
        ...(targetCaseId ? { target_case_id: targetCaseId } : {}),
        ...(within !== undefined ? { respond_within_seconds: within } : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
}

@Controller('customer/support-cases')
export class CustomerSupportCaseController {
  constructor(@Inject(SUPPORT_CASES) private readonly cases: SupportCaseService) {}

  /** The cases about the customer's orders, whoever opened them. */
  @Get()
  @customerRead
  async list() {
    try {
      return { cases: await this.cases.customerList({ context: currentRequestContext() }) };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get(':support_case_id')
  @customerRead
  async detail(@Param('support_case_id') caseId: string) {
    try {
      return await this.cases.customerDetail({
        context: currentRequestContext(),
        support_case_id: uuid(caseId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':support_case_id/messages')
  @customerRead
  async message(@Param('support_case_id') caseId: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.cases.customerReply({
        context: currentRequestContext(),
        support_case_id: uuid(caseId),
        body: stringField(body, 'body'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
}
