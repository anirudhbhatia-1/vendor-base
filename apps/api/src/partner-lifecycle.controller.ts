import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Query,
  Post,
} from '@nestjs/common';
import {
  PartnerFieldOpsService,
  PartnerLifecycleService,
  type DisputeComponent,
  type ExceptionKind,
  type ExceptionResolution,
  type OfflineProofKind,
  type VehicleKind,
} from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { PARTNER_FIELD_OPS, PARTNER_LIFECYCLE } from './tokens.js';
import { integerField, object, stringField, uuid } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
const partnerApplicationManage = RequireAuthorization({
  capability: 'partner.application.manage',
  conceal_resource: true,
});
/**
 * Acting on one delivery.
 *
 * `partner.assignment.act` carries the ACTIVE_ASSIGNMENT resource rule, which
 * grants only when the request supplies a `delivery_assignment_id` matching the
 * caller's active assignment. This decorator omitted the parameter binding, so
 * the guard had nothing to check and the rule could never grant: every guided
 * exception and every offline proof answered "not found" to its own owner, on
 * an assignment the partner was standing in front of. The custody and wait
 * controllers bind it; this one did not.
 */
const partnerAssignmentAct = RequireAuthorization({
  capability: 'partner.assignment.act',
  conceal_resource: true,
  delivery_assignment_id_param: 'delivery_assignment_id',
});

/** Self-scoped partner reads that are not about one assignment. */
const partnerFieldRead = RequireAuthorization({
  capability: 'partner.field.read',
  conceal_resource: true,
});
const partnerStandingRead = RequireAuthorization({
  capability: 'partner.standing.read',
  conceal_resource: true,
});
/** Operations acting on live delivery work, including partner exceptions. */
const adminDeliveryOps = RequireAuthorization({
  admin_scope: { kind: 'GLOBAL' },
  capability: 'admin.delivery.assignment_manage',
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
      translateDomainError(error);
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
      translateDomainError(error);
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
      translateDomainError(error);
    }
  }
}

@Controller('admin/partner-applications')
export class AdminPartnerApplicationController {
  constructor(@Inject(PARTNER_LIFECYCLE) private readonly lifecycle: PartnerLifecycleService) {}

  /** The review queue — without it an application can only be opened by an id
   *  nothing in the product ever shows a reviewer. */
  @Get()
  @adminReviewApplication
  async queue(@Query('limit') limit?: string) {
    try {
      return {
        applications: await this.lifecycle.listApplicationsForAdmin({
          context: currentRequestContext(),
          ...(limit === undefined ? {} : { limit: Number(limit) }),
        }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

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
      translateDomainError(error);
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
      translateDomainError(error);
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
      translateDomainError(error);
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
      translateDomainError(error);
    }
  }
}

/**
 * A partner's own standing: what restricts them, and how to challenge it.
 *
 * Read-only and self-scoped. The service refuses anything but a partner
 * session and filters to that partner's own cases, so this cannot become a way
 * to enumerate other people's trust history.
 */
@Controller('partner/standing')
export class PartnerStandingController {
  constructor(@Inject(PARTNER_LIFECYCLE) private readonly lifecycle: PartnerLifecycleService) {}

  /** This partner's own application, resolved from the session, not from a typed id. */
  @Get('application')
  @partnerStandingRead
  async application() {
    try {
      return {
        application: await this.lifecycle.getOwnApplication({ context: currentRequestContext() }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('restrictions')
  @partnerStandingRead
  async restrictions() {
    try {
      return {
        restrictions: await this.lifecycle.listOwnRestrictions({
          context: currentRequestContext(),
        }),
      };
    } catch (error) {
      translateDomainError(error);
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
      translateDomainError(error);
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
      translateDomainError(error);
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
      translateDomainError(error);
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
      translateDomainError(error);
    }
  }
}

/**
 * Operations' side of the partner's guided exceptions.
 *
 * The partner reports; this is where the instruction is composed. Without it
 * the promise the partner surface makes — "operations have this" — had nothing
 * behind it, and the directed resolutions the service reserves for admins had
 * no route at all.
 */
@Controller('admin/partner-exceptions')
export class AdminPartnerExceptionsController {
  constructor(@Inject(PARTNER_FIELD_OPS) private readonly ops: PartnerFieldOpsService) {}

  @Get()
  @adminDeliveryOps
  async listOpen() {
    try {
      return {
        exceptions: await this.ops.listOpenExceptions({ context: currentRequestContext() }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  /** Directs the outcome: return, cancel and reassign live here, not with the partner. */
  @Post(':delivery_assignment_id/resolve')
  @adminDeliveryOps
  @HttpCode(200)
  async resolve(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
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
      translateDomainError(error);
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
      translateDomainError(error);
    }
  }

  /**
   * Proofs this partner is still holding (DLP-32, DLP-33).
   *
   * The service could always answer this and nothing asked. Without it a held
   * proof lived only in a React state field, so a reload — or the phone simply
   * sleeping — lost the reference and the partner could neither sync it nor
   * see that it was outstanding, while DLP-14 says an unresolved proof is
   * exactly what should stop them taking more work.
   */
  @Get('offline-proofs')
  @partnerFieldRead
  async listPendingProofs() {
    try {
      return { proofs: await this.ops.listPending({ context: currentRequestContext() }) };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('offline-proof/:partner_offline_proof_id/sync')
  @partnerFieldRead
  async syncOfflineProof(@Param('partner_offline_proof_id') proofId: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.ops.syncOfflineProof({
        context: currentRequestContext(),
        partner_offline_proof_id: uuid(proofId),
        encrypted_payload_digest: stringField(body, 'encrypted_payload_digest'),
      });
    } catch (error) {
      translateDomainError(error);
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
      translateDomainError(error);
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
      translateDomainError(error);
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
      translateDomainError(error);
    }
  }
}
