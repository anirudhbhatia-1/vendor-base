import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  AdminControlAuthorizationError,
  AdminControlInputError,
  AdminControlNotFoundError,
  AdminControlPlaneService,
  AdminControlStateError,
} from '@neighbourhood-store/database';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { ADMIN_CONTROL_PLANE } from './tokens.js';
const global = (capability: string) =>
  RequireAuthorization({ capability, admin_scope: { kind: 'GLOBAL' }, conceal_resource: true });
function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BadRequestException();
  return v as Record<string, unknown>;
}
function str(v: Record<string, unknown>, k: string) {
  if (typeof v[k] !== 'string') throw new BadRequestException();
  return v[k] as string;
}
function date(v: Record<string, unknown>, k: string) {
  const d = new Date(str(v, k));
  if (!Number.isFinite(d.getTime())) throw new BadRequestException();
  return d;
}
function uuid(v: string): UuidV7 {
  try {
    return parseUuidV7(v);
  } catch {
    throw new BadRequestException();
  }
}
function map(e: unknown): never {
  if (e instanceof AdminControlInputError) throw new BadRequestException(e.message);
  if (e instanceof AdminControlNotFoundError) throw new NotFoundException();
  if (e instanceof AdminControlStateError) throw new ConflictException();
  if (e instanceof AdminControlAuthorizationError) throw new BadRequestException();
  throw e;
}
@Controller('admin/control')
export class AdminControlPlaneController {
  constructor(@Inject(ADMIN_CONTROL_PLANE) private readonly control: AdminControlPlaneService) {}
  @Get('dashboard') @global('admin.control.dashboard_read') dashboard() {
    return this.control.dashboard({ context: currentRequestContext() });
  }
  @Get('orders') @global('admin.control.dashboard_read') orders(
    @Query('checkout_group_id') id?: string,
  ) {
    return this.control.orderMonitor({
      context: currentRequestContext(),
      ...(id ? { checkout_group_id: uuid(id) } : {}),
    });
  }
  @Post('support') @global('admin.support.case_manage') async createSupport(@Body() raw: unknown) {
    const b = obj(raw);
    try {
      return await this.control.createSupportCase({
        context: currentRequestContext(),
        vendor_order_id: uuid(str(b, 'vendor_order_id')),
        category: str(b, 'category'),
        description: str(b, 'description'),
        severity: str(b, 'severity') as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
        response_due_at: date(b, 'response_due_at'),
      });
    } catch (e) {
      map(e);
    }
  }
  @Post('support/:case_id/:action') @global('admin.support.case_manage') async support(
    @Param('case_id') id: string,
    @Param('action') action: string,
    @Body() raw: unknown,
  ) {
    const b = obj(raw);
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
        reason_code: str(b, 'reason_code'),
        ...(b.body ? { body: str(b, 'body') } : {}),
        ...(b.owner_user_id ? { owner_user_id: uuid(str(b, 'owner_user_id')) } : {}),
        ...(b.owner_team ? { owner_team: str(b, 'owner_team') } : {}),
      });
    } catch (e) {
      map(e);
    }
  }
  @Post('support/:case_id/evidence') @global('admin.support.case_manage') async evidence(
    @Param('case_id') id: string,
    @Body() raw: unknown,
  ) {
    const b = obj(raw);
    try {
      return await this.control.attachSupportEvidence({
        context: currentRequestContext(),
        support_case_id: uuid(id),
        evidence_reference: str(b, 'evidence_reference'),
        classification: str(b, 'classification') as 'INTERNAL' | 'RESTRICTED',
        reason_code: str(b, 'reason_code'),
      });
    } catch (e) {
      map(e);
    }
  }
  @Post('support/:case_id/merge') @global('admin.support.case_manage') async merge(
    @Param('case_id') id: string,
    @Body() raw: unknown,
  ) {
    const b = obj(raw);
    try {
      return await this.control.mergeSupportCases({
        context: currentRequestContext(),
        source_case_id: uuid(id),
        target_case_id: uuid(str(b, 'target_case_id')),
        reason_code: str(b, 'reason_code'),
      });
    } catch (e) {
      map(e);
    }
  }
  @Post('trust') @global('admin.trust.restriction_propose') async trust(@Body() raw: unknown) {
    const b = obj(raw);
    try {
      return await this.control.proposeTrust({
        context: currentRequestContext(),
        subject_kind: str(b, 'subject_kind'),
        subject_reference: str(b, 'subject_reference'),
        scope_kind: str(b, 'scope_kind'),
        scope_reference: str(b, 'scope_reference'),
        reason_code: str(b, 'reason_code'),
        evidence_reference: str(b, 'evidence_reference'),
        policy_reference: str(b, 'policy_reference'),
        effective_until: date(b, 'effective_until'),
        review_at: date(b, 'review_at'),
      });
    } catch (e) {
      map(e);
    }
  }
  @Post('trust/:id/approve') @global('admin.trust.restriction_approve') async approveTrust(
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    const b = obj(raw);
    try {
      return await this.control.approveTrust({
        context: currentRequestContext(),
        trust_restriction_case_id: uuid(id),
        expected_version: Number(b.expected_version),
        reason_code: str(b, 'reason_code'),
      });
    } catch (e) {
      map(e);
    }
  }
  @Post('trust/:id/:action') @global('admin.trust.restriction_approve') async transitionTrust(
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() raw: unknown,
  ) {
    if (action !== 'reject' && action !== 'revoke') throw new BadRequestException();
    const b = obj(raw);
    try {
      return await this.control.transitionTrust({
        context: currentRequestContext(),
        trust_restriction_case_id: uuid(id),
        expected_version: Number(b.expected_version),
        action: action === 'reject' ? 'REJECT' : 'REVOKE',
        reason_code: str(b, 'reason_code'),
      });
    } catch (e) {
      map(e);
    }
  }
  @Post('incidents') @global('admin.incident.manage') async incident(@Body() raw: unknown) {
    const b = obj(raw);
    try {
      return await this.control.setIncident({
        context: currentRequestContext(),
        control_key: str(b, 'control_key'),
        scope_kind: str(b, 'scope_kind'),
        scope_reference: str(b, 'scope_reference'),
        reason_code: str(b, 'reason_code'),
        expires_at: date(b, 'expires_at'),
        review_at: date(b, 'review_at'),
        obligations: obj(b.obligations),
      });
    } catch (e) {
      map(e);
    }
  }
  @Post('incidents/:id/revoke') @global('admin.incident.manage') async revokeIncident(
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    const b = obj(raw);
    try {
      return await this.control.revokeIncident({
        context: currentRequestContext(),
        incident_control_id: uuid(id),
        reason_code: str(b, 'reason_code'),
      });
    } catch (e) {
      map(e);
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
    const b = obj(raw);
    try {
      return await this.control.createExport({
        context: currentRequestContext(),
        report_kind: str(b, 'report_kind'),
        filters: obj(b.filters),
        classification: str(b, 'classification') as 'INTERNAL' | 'RESTRICTED',
      });
    } catch (e) {
      map(e);
    }
  }
  @Post('exports/redeem') @global('admin.reporting.export') async redeem(@Body() raw: unknown) {
    const b = obj(raw);
    try {
      return await this.control.redeemExport({
        context: currentRequestContext(),
        download_token: str(b, 'download_token'),
      });
    } catch (e) {
      map(e);
    }
  }
}
