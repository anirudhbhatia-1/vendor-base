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
import type { FinanceQueueService } from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { FINANCE_QUEUES } from './tokens.js';
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
 * The finance queues are worked under the ledger capability; approving a
 * write-off also needs the refund approver's, which the service checks (11.5).
 */
const manage = RequireAuthorization({
  capability: 'admin.finance.ledger_manage',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: true,
});
const PROVIDER_STATES = new Set(['FAILED', 'SUCCEEDED', 'UNKNOWN']);

@Controller('admin/finance/queues')
export class FinanceQueuesController {
  constructor(@Inject(FINANCE_QUEUES) private readonly queues: FinanceQueueService) {}

  @Get()
  @manage
  async list(@Query('queue') queue?: string, @Query('include_resolved') resolved?: string) {
    try {
      return await this.queues.queues({
        context: currentRequestContext(),
        ...(queue ? { queue } : {}),
        ...(resolved === 'true' ? { include_resolved: true } : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('exceptions/:finance_exception_id')
  @manage
  async detail(@Param('finance_exception_id') id: string) {
    try {
      return await this.queues.detail({
        context: currentRequestContext(),
        finance_exception_id: uuid(id),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('exceptions/:finance_exception_id/actions/:action')
  @manage
  @HttpCode(200)
  async act(
    @Param('finance_exception_id') id: string,
    @Param('action') action: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    if (!/^[A-Z_]{3,32}$/.test(action)) throw new BadRequestException();
    const providerState = optionalString(body, 'provider_state');
    if (providerState !== undefined && !PROVIDER_STATES.has(providerState)) {
      throw new BadRequestException();
    }
    try {
      const note = optionalString(body, 'note');
      const evidence = optionalString(body, 'evidence_reference');
      const resolution = optionalString(body, 'resolution_code');
      const assignee = optionalUuid(body, 'assignee_user_id');
      const correction = optionalUuid(body, 'financial_correction_id');
      const duplicate = optionalUuid(body, 'duplicate_of');
      const statementAmount = optionalInteger(body, 'statement_amount_minor', 1);
      return await this.queues.act({
        context: currentRequestContext(),
        finance_exception_id: uuid(id),
        action,
        expected_version: integerField(body, 'expected_version', 1),
        reason_code: stringField(body, 'reason_code'),
        ...(note !== undefined ? { note } : {}),
        ...(evidence !== undefined ? { evidence_reference: evidence } : {}),
        ...(resolution !== undefined ? { resolution_code: resolution } : {}),
        ...(assignee ? { assignee_user_id: assignee } : {}),
        ...(correction ? { financial_correction_id: correction } : {}),
        ...(duplicate ? { duplicate_of: duplicate } : {}),
        ...(providerState !== undefined
          ? { provider_state: providerState as 'FAILED' | 'SUCCEEDED' | 'UNKNOWN' }
          : {}),
        ...(statementAmount !== undefined ? { statement_amount_minor: statementAmount } : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
}
