import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AdminControlPlaneService } from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { ADMIN_CONTROL_PLANE } from './tokens.js';
import { dateField, object, stringField, uuid } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
const global = (capability: string) =>
  RequireAuthorization({ capability, admin_scope: { kind: 'GLOBAL' }, conceal_resource: true });
@Controller('admin/control')
export class AdminControlPlaneController {
  constructor(@Inject(ADMIN_CONTROL_PLANE) private readonly control: AdminControlPlaneService) {}
  @Get('dashboard') @global('admin.control.dashboard_read') dashboard() {
    return this.control.dashboard({ context: currentRequestContext() });
  }
  @Get('orders') @global('admin.control.dashboard_read') orders(
    @Query('checkout_group_id') id?: string,
    @Query('stalled_only') stalled?: string,
  ) {
    return this.control.orderMonitor({
      context: currentRequestContext(),
      ...(id ? { checkout_group_id: uuid(id) } : {}),
      ...(stalled === 'true' ? { stalled_only: true } : {}),
    });
  }
  @Get('dead-letters') @global('admin.messaging.deadletter_read') deadLetters(
    @Query('limit') limit?: string,
  ) {
    return this.control.deadLetterQueue({
      context: currentRequestContext(),
      ...(limit ? { limit: Number(limit) } : {}),
    });
  }
  @Post('dead-letters/:event_id/recover')
  @global('admin.messaging.deadletter_recover')
  async recoverDeadLetter(@Param('event_id') eventId: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.control.recoverDeadLetter({
        context: currentRequestContext(),
        event_id: uuid(eventId),
        reason_code: stringField(body, 'reason_code'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
  @Post('support') @global('admin.support.case_manage') async createSupport(@Body() raw: unknown) {
    const b = object(raw);
    try {
      return await this.control.createSupportCase({
        context: currentRequestContext(),
        vendor_order_id: uuid(stringField(b, 'vendor_order_id')),
        category: stringField(b, 'category'),
        description: stringField(b, 'description'),
        severity: stringField(b, 'severity') as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
        response_due_at: dateField(b, 'response_due_at'),
      });
    } catch (e) {
      translateDomainError(e);
    }
  }
  @Post('support/:case_id/:action') @global('admin.support.case_manage') async support(
    @Param('case_id') id: string,
    @Param('action') action: string,
    @Body() raw: unknown,
  ) {
    const b = object(raw);
    if (
      !['ASSIGN', 'NOTE', 'MESSAGE', 'RESOLVE', 'REOPEN', 'ESCALATE', 'QUALITY_REVIEW'].includes(
        action,
      )
    )
      throw new BadRequestException();
    try {
      return await this.control.supportAction({
        context: currentRequestContext(),
        support_case_id: uuid(id),
        action: action as
          'ASSIGN' | 'NOTE' | 'MESSAGE' | 'RESOLVE' | 'REOPEN' | 'ESCALATE' | 'QUALITY_REVIEW',
        reason_code: stringField(b, 'reason_code'),
        ...(b.body ? { body: stringField(b, 'body') } : {}),
        ...(b.owner_user_id ? { owner_user_id: uuid(stringField(b, 'owner_user_id')) } : {}),
        ...(b.owner_team ? { owner_team: stringField(b, 'owner_team') } : {}),
      });
    } catch (e) {
      translateDomainError(e);
    }
  }
  @Post('support/:case_id/evidence') @global('admin.support.case_manage') async evidence(
    @Param('case_id') id: string,
    @Body() raw: unknown,
  ) {
    const b = object(raw);
    try {
      return await this.control.attachSupportEvidence({
        context: currentRequestContext(),
        support_case_id: uuid(id),
        evidence_reference: stringField(b, 'evidence_reference'),
        classification: stringField(b, 'classification') as 'INTERNAL' | 'RESTRICTED',
        reason_code: stringField(b, 'reason_code'),
      });
    } catch (e) {
      translateDomainError(e);
    }
  }
  @Post('support/:case_id/merge') @global('admin.support.case_manage') async merge(
    @Param('case_id') id: string,
    @Body() raw: unknown,
  ) {
    const b = object(raw);
    try {
      return await this.control.mergeSupportCases({
        context: currentRequestContext(),
        source_case_id: uuid(id),
        target_case_id: uuid(stringField(b, 'target_case_id')),
        reason_code: stringField(b, 'reason_code'),
      });
    } catch (e) {
      translateDomainError(e);
    }
  }
  @Post('trust') @global('admin.trust.restriction_propose') async trust(@Body() raw: unknown) {
    const b = object(raw);
    try {
      return await this.control.proposeTrust({
        context: currentRequestContext(),
        subject_kind: stringField(b, 'subject_kind'),
        subject_reference: stringField(b, 'subject_reference'),
        scope_kind: stringField(b, 'scope_kind'),
        scope_reference: stringField(b, 'scope_reference'),
        reason_code: stringField(b, 'reason_code'),
        evidence_reference: stringField(b, 'evidence_reference'),
        policy_reference: stringField(b, 'policy_reference'),
        effective_until: dateField(b, 'effective_until'),
        review_at: dateField(b, 'review_at'),
      });
    } catch (e) {
      translateDomainError(e);
    }
  }
  @Post('trust/:id/approve') @global('admin.trust.restriction_approve') async approveTrust(
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    const b = object(raw);
    try {
      return await this.control.approveTrust({
        context: currentRequestContext(),
        trust_restriction_case_id: uuid(id),
        expected_version: Number(b.expected_version),
        reason_code: stringField(b, 'reason_code'),
      });
    } catch (e) {
      translateDomainError(e);
    }
  }
  @Post('trust/:id/:action') @global('admin.trust.restriction_approve') async transitionTrust(
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() raw: unknown,
  ) {
    if (action !== 'reject' && action !== 'revoke') throw new BadRequestException();
    const b = object(raw);
    try {
      return await this.control.transitionTrust({
        context: currentRequestContext(),
        trust_restriction_case_id: uuid(id),
        expected_version: Number(b.expected_version),
        action: action === 'reject' ? 'REJECT' : 'REVOKE',
        reason_code: stringField(b, 'reason_code'),
      });
    } catch (e) {
      translateDomainError(e);
    }
  }
  @Post('incidents') @global('admin.incident.manage') async incident(@Body() raw: unknown) {
    const b = object(raw);
    try {
      return await this.control.setIncident({
        context: currentRequestContext(),
        control_key: stringField(b, 'control_key'),
        scope_kind: stringField(b, 'scope_kind'),
        scope_reference: stringField(b, 'scope_reference'),
        reason_code: stringField(b, 'reason_code'),
        expires_at: dateField(b, 'expires_at'),
        review_at: dateField(b, 'review_at'),
        obligations: object(b.obligations),
      });
    } catch (e) {
      translateDomainError(e);
    }
  }
  @Post('incidents/:id/revoke') @global('admin.incident.manage') async revokeIncident(
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    const b = object(raw);
    try {
      return await this.control.revokeIncident({
        context: currentRequestContext(),
        incident_control_id: uuid(id),
        reason_code: stringField(b, 'reason_code'),
      });
    } catch (e) {
      translateDomainError(e);
    }
  }
  @Post('maintenance/expire') @global('admin.incident.manage') expire() {
    return this.control.expireOperationalControls({ context: currentRequestContext() });
  }
  @Get('audit') @global('admin.audit.read') audit(@Query('q') q?: string) {
    return this.control.audit({ context: currentRequestContext(), ...(q ? { query: q } : {}) });
  }
  @Get('reports/:kind') @global('admin.reporting.read') report(@Param('kind') kind: string) {
    return this.control.report({ context: currentRequestContext(), report_kind: kind });
  }
  @Post('exports') @global('admin.reporting.export') async export(@Body() raw: unknown) {
    const b = object(raw);
    try {
      return await this.control.createExport({
        context: currentRequestContext(),
        report_kind: stringField(b, 'report_kind'),
        filters: object(b.filters),
        classification: stringField(b, 'classification') as 'INTERNAL' | 'RESTRICTED',
      });
    } catch (e) {
      translateDomainError(e);
    }
  }
  @Post('exports/redeem') @global('admin.reporting.export') async redeem(@Body() raw: unknown) {
    const b = object(raw);
    try {
      return await this.control.redeemExport({
        context: currentRequestContext(),
        download_token: stringField(b, 'download_token'),
      });
    } catch (e) {
      translateDomainError(e);
    }
  }
}
