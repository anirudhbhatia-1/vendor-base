import { BadRequestException, Controller, Get, Inject, Param, Query } from '@nestjs/common';
import type { AuditSearchService } from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { translateDomainError } from './domain-errors.js';
import { currentRequestContext } from './request-context-storage.js';
import { AUDIT_SEARCH } from './tokens.js';

const read = RequireAuthorization({
  capability: 'admin.audit.read',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: true,
});

function queryDate(value: string | undefined): Date | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException();
  return parsed;
}

function queryWhole(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^\d{1,4}$/.test(value)) throw new BadRequestException();
  return Number(value);
}

/**
 * The searchable audit (11.9). Read-only by construction: this controller
 * has no handler but GET, and the table refuses UPDATE, DELETE and TRUNCATE.
 * Until audit run 81 the audit was one route on the control plane taking a
 * substring, returning every field of every row to every reader.
 */
@Controller('admin/audit')
export class AuditController {
  constructor(@Inject(AUDIT_SEARCH) private readonly audit: AuditSearchService) {}

  @Get()
  @read
  async search(
    @Query('actor_id') actorId?: string,
    @Query('action') action?: string,
    @Query('action_prefix') actionPrefix?: string,
    @Query('target_kind') targetKind?: string,
    @Query('target_reference') targetReference?: string,
    @Query('reason_code') reasonCode?: string,
    @Query('request_id') requestId?: string,
    @Query('approval_reference') approvalReference?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('text') text?: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const start = queryDate(from);
    const end = queryDate(to);
    const size = queryWhole(limit);
    const given = (value: string | undefined) =>
      value === undefined || value === '' ? undefined : value;
    const filters = Object.fromEntries(
      Object.entries({
        actor_id: given(actorId),
        action: given(action),
        action_prefix: given(actionPrefix),
        target_kind: given(targetKind),
        target_reference: given(targetReference),
        reason_code: given(reasonCode),
        request_id: given(requestId),
        approval_reference: given(approvalReference),
        text: given(text),
        from: start,
        to: end,
      }).filter(([, value]) => value !== undefined),
    );
    try {
      return await this.audit.search({
        context: currentRequestContext(),
        filters,
        ...(size !== undefined ? { limit: size } : {}),
        ...(given(before) ? { before: before as string } : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get(':operational_audit_event_id')
  @read
  async detail(@Param('operational_audit_event_id') id: string) {
    try {
      return await this.audit.detail({
        context: currentRequestContext(),
        operational_audit_event_id: id,
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
}
