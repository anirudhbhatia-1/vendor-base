import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  FieldOpsAuthorizationError,
  FieldOpsConflictError,
  FieldOpsInputError,
  FieldOpsNotFoundError,
  PartnerFieldOpsService,
  PartnerLifecycleAuthorizationError,
  PartnerLifecycleConflictError,
  PartnerLifecycleInputError,
  PartnerLifecycleNotFoundError,
  PartnerLifecycleService,
  type DisputeComponent,
  type ExceptionKind,
  type ExceptionResolution,
  type OfflineProofKind,
  type VehicleKind,
} from '@neighbourhood-store/database';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { PARTNER_FIELD_OPS, PARTNER_LIFECYCLE } from './tokens.js';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}
function stringField(body: Record<string, unknown>, key: string): string {
  const found = body[key];
  if (typeof found !== 'string') throw new BadRequestException();
  return found;
}
function integerField(body: Record<string, unknown>, key: string): number {
  const found = body[key];
  if (!Number.isSafeInteger(found)) throw new BadRequestException();
  return found as number;
}
function uuid(value: string): UuidV7 {
  try {
    return parseUuidV7(value);
  } catch {
    throw new BadRequestException();
  }
}
function mapLifecycle(error: unknown): never {
  if (error instanceof PartnerLifecycleInputError) throw new BadRequestException(error.message);
  if (error instanceof PartnerLifecycleNotFoundError) throw new NotFoundException();
  if (error instanceof PartnerLifecycleConflictError) throw new ConflictException(error.message);
  if (error instanceof PartnerLifecycleAuthorizationError) throw new ForbiddenException();
  throw error;
}
function mapFieldOps(error: unknown): never {
  if (error instanceof FieldOpsInputError) throw new BadRequestException(error.message);
  if (error instanceof FieldOpsNotFoundError) throw new NotFoundException();
  if (error instanceof FieldOpsConflictError) throw new ConflictException(error.message);
  if (error instanceof FieldOpsAuthorizationError) throw new ForbiddenException();
  throw error;
}

const partnerApplicationManage = RequireAuthorization({
  capability: 'partner.application.manage',
  conceal_resource: true,
});
const partnerAssignmentAct = RequireAuthorization({
  capability: 'partner.assignment.act',
  conceal_resource: true,
});
const partnerEarningsRead = RequireAuthorization({
  capability: 'partner.earnings.read',
  conceal_resource: true,
});
const partnerEarningsDispute = RequireAuthorization({
  capability: 'partner.earnings.dispute',
  conceal_resource: true,
});
const adminReviewApplication = RequireAuthorization({
  capability: 'admin.partner_application.review',
  conceal_resource: true,
});
const adminResolveDispute = RequireAuthorization({
  capability: 'admin.partner_earnings.resolve',
  conceal_resource: true,
});

@Controller('partner/applications')
export class PartnerApplicationController {
  constructor(@Inject(PARTNER_LIFECYCLE) private readonly lifecycle: PartnerLifecycleService) {}

  @Post()
  @partnerApplicationManage
  async create(@Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.lifecycle.createApplication({
        context: currentRequestContext(),
        identity_reference: stringField(body, 'identity_reference'),
        vehicle_reference: stringField(body, 'vehicle_reference'),
        vehicle_kind: stringField(body, 'vehicle_kind') as VehicleKind,
        bank_account_reference: stringField(body, 'bank_account_reference'),
        insurance_reference: stringField(body, 'insurance_reference'),
        emergency_contact_reference: stringField(body, 'emergency_contact_reference'),
        training_reference: stringField(body, 'training_reference'),
        home_zone_name: stringField(body, 'home_zone_name'),
      });
    } catch (error) {
      mapLifecycle(error);
    }
  }

  @Post(':partner_application_id/submit')
  @partnerApplicationManage
  async submit(@Param('partner_application_id') id: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.lifecycle.submitApplication({
        context: currentRequestContext(),
        partner_application_id: uuid(id),
        expected_version: integerField(body, 'expected_version'),
      });
    } catch (error) {
      mapLifecycle(error);
    }
  }

  @Get(':partner_application_id')
  @partnerApplicationManage
  async get(@Param('partner_application_id') id: string) {
    try {
      return await this.lifecycle.getApplication({
        context: currentRequestContext(),
        partner_application_id: uuid(id),
      });
    } catch (error) {
      mapLifecycle(error);
    }
  }
}

@Controller('admin/partner-applications')
export class AdminPartnerApplicationController {
  constructor(@Inject(PARTNER_LIFECYCLE) private readonly lifecycle: PartnerLifecycleService) {}

  @Post(':partner_application_id/start-review')
  @adminReviewApplication
  async startReview(@Param('partner_application_id') id: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.lifecycle.startReview({
        context: currentRequestContext(),
        partner_application_id: uuid(id),
        expected_version: integerField(body, 'expected_version'),
      });
    } catch (error) {
      mapLifecycle(error);
    }
  }

  @Post(':partner_application_id/request-changes')
  @adminReviewApplication
  async requestChanges(@Param('partner_application_id') id: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.lifecycle.requestChanges({
        context: currentRequestContext(),
        partner_application_id: uuid(id),
        expected_version: integerField(body, 'expected_version'),
        reason_code: stringField(body, 'reason_code'),
      });
    } catch (error) {
      mapLifecycle(error);
    }
  }

  @Post(':partner_application_id/approve')
  @adminReviewApplication
  async approve(@Param('partner_application_id') id: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.lifecycle.approve({
        context: currentRequestContext(),
        partner_application_id: uuid(id),
        expected_version: integerField(body, 'expected_version'),
        reason_code: stringField(body, 'reason_code'),
      });
    } catch (error) {
      mapLifecycle(error);
    }
  }

  @Post(':partner_application_id/reject')
  @adminReviewApplication
  async reject(@Param('partner_application_id') id: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.lifecycle.reject({
        context: currentRequestContext(),
        partner_application_id: uuid(id),
        expected_version: integerField(body, 'expected_version'),
        reason_code: stringField(body, 'reason_code'),
      });
    } catch (error) {
      mapLifecycle(error);
    }
  }
}

@Controller('partner/earnings')
export class PartnerEarningsController {
  constructor(@Inject(PARTNER_LIFECYCLE) private readonly lifecycle: PartnerLifecycleService) {}

  @Get()
  @partnerEarningsRead
  async list() {
    try {
      return { earnings: await this.lifecycle.listEarnings({ context: currentRequestContext() }) };
    } catch (error) {
      mapLifecycle(error);
    }
  }

  @Post('disputes')
  @partnerEarningsDispute
  async openDispute(@Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.lifecycle.openDispute({
        context: currentRequestContext(),
        partner_earnings_record_id: uuid(stringField(body, 'partner_earnings_record_id')),
        disputed_component: stringField(body, 'disputed_component') as DisputeComponent,
        proposed_amount_minor: integerField(body, 'proposed_amount_minor'),
        evidence_note: stringField(body, 'evidence_note'),
      });
    } catch (error) {
      mapLifecycle(error);
    }
  }

  @Post('disputes/:partner_dispute_case_id/withdraw')
  @partnerEarningsDispute
  async withdraw(@Param('partner_dispute_case_id') id: string) {
    try {
      return await this.lifecycle.resolveDispute({
        context: currentRequestContext(),
        partner_dispute_case_id: uuid(id),
        resolution: 'WITHDRAWN',
      });
    } catch (error) {
      mapLifecycle(error);
    }
  }
}

@Controller('admin/partner-disputes')
export class AdminPartnerDisputeController {
  constructor(@Inject(PARTNER_LIFECYCLE) private readonly lifecycle: PartnerLifecycleService) {}

  @Post(':partner_dispute_case_id/resolve')
  @adminResolveDispute
  async resolve(@Param('partner_dispute_case_id') id: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.lifecycle.resolveDispute({
        context: currentRequestContext(),
        partner_dispute_case_id: uuid(id),
        resolution: 'RESOLVED',
        resolution_reason_code: stringField(body, 'resolution_reason_code'),
        resolved_amount_minor: integerField(body, 'resolved_amount_minor'),
      });
    } catch (error) {
      mapLifecycle(error);
    }
  }
}

@Controller('partner/field')
export class PartnerFieldOpsController {
  constructor(@Inject(PARTNER_FIELD_OPS) private readonly ops: PartnerFieldOpsService) {}

  @Post(':delivery_assignment_id/offline-proof')
  @partnerAssignmentAct
  async saveOfflineProof(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    const body = object(raw);
    const capturedAt = body['captured_at'];
    if (typeof capturedAt !== 'string') throw new BadRequestException();
    const captured = new Date(capturedAt);
    if (Number.isNaN(captured.getTime())) throw new BadRequestException();
    try {
      return await this.ops.saveOfflineProof({
        context: currentRequestContext(),
        delivery_assignment_id: uuid(id),
        proof_kind: stringField(body, 'proof_kind') as OfflineProofKind,
        encrypted_payload_digest: stringField(body, 'encrypted_payload_digest'),
        encryption_key_reference: stringField(body, 'encryption_key_reference'),
        captured_at: captured,
        reason_code: stringField(body, 'reason_code'),
      });
    } catch (error) {
      mapFieldOps(error);
    }
  }

  @Post('offline-proof/:partner_offline_proof_id/sync')
  @partnerAssignmentAct
  async syncOfflineProof(@Param('partner_offline_proof_id') proofId: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.ops.syncOfflineProof({
        context: currentRequestContext(),
        partner_offline_proof_id: uuid(proofId),
        encrypted_payload_digest: stringField(body, 'encrypted_payload_digest'),
      });
    } catch (error) {
      mapFieldOps(error);
    }
  }

  @Post(':delivery_assignment_id/exception')
  @partnerAssignmentAct
  async raiseException(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.ops.raiseException({
        context: currentRequestContext(),
        delivery_assignment_id: uuid(id),
        exception_kind: stringField(body, 'exception_kind') as ExceptionKind,
        reason_code: stringField(body, 'reason_code'),
      });
    } catch (error) {
      mapFieldOps(error);
    }
  }

  @Post(':delivery_assignment_id/exception/resolve')
  @partnerAssignmentAct
  async resolveException(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.ops.resolveException({
        context: currentRequestContext(),
        delivery_assignment_id: uuid(id),
        exception_kind: stringField(body, 'exception_kind') as ExceptionKind,
        resolution_state: stringField(body, 'resolution_state') as Exclude<
          ExceptionResolution,
          'OPEN'
        >,
        reason_code: stringField(body, 'reason_code'),
      });
    } catch (error) {
      mapFieldOps(error);
    }
  }

  @Get(':delivery_assignment_id/exception')
  @partnerAssignmentAct
  async listExceptions(@Param('delivery_assignment_id') id: string) {
    try {
      return {
        exceptions: await this.ops.listExceptions({
          context: currentRequestContext(),
          delivery_assignment_id: uuid(id),
        }),
      };
    } catch (error) {
      mapFieldOps(error);
    }
  }
}
