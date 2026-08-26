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
  Put,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ProtectedObjectInputError,
  ProtectedObjectNotFoundError,
  ProtectedObjectPermissionError,
  ProtectedObjectRejectedError,
  VendorOnboardingAuthorizationError,
  VendorOnboardingConflictError,
  VendorOnboardingIncompleteError,
  VendorOnboardingInputError,
  VendorOnboardingNotFoundError,
  VendorOnboardingService,
  type AffectedCapability,
  type ProtectedMediaType,
  type ProposedVendorProfile,
  type StorageScanScenario,
  type VerificationDocumentKind,
} from '@neighbourhood-store/database';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import {
  AUTHENTICATED_SESSION,
  RequireAuthorization,
  RequireSession,
  type AuthorizedRequest,
} from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { VENDOR_ONBOARDING } from './tokens.js';

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string') throw new BadRequestException();
  return value;
}

function optionalString(body: Record<string, unknown>, field: string): string | null | undefined {
  const value = body[field];
  if (value === undefined || value === null || typeof value === 'string')
    return value as string | null | undefined;
  throw new BadRequestException();
}

function integerField(body: Record<string, unknown>, field: string, minimum = 0): number {
  const value = body[field];
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new BadRequestException();
  return value as number;
}

function numberField(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new BadRequestException();
  return value;
}

function uuid(value: string): UuidV7 {
  try {
    return parseUuidV7(value);
  } catch {
    throw new BadRequestException();
  }
}

function principal(request: AuthorizedRequest): UuidV7 {
  const session = request[AUTHENTICATED_SESSION];
  if (!session) throw new ForbiddenException();
  return session.user_id;
}

function decodeBase64(value: string): Uint8Array {
  if (value.length === 0 || value.length > 7_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new BadRequestException();
  }
  const buffer = Buffer.from(value, 'base64');
  const canonical = buffer.toString('base64').replace(/=+$/, '');
  if (canonical !== value.replace(/=+$/, '')) throw new BadRequestException();
  return new Uint8Array(buffer);
}

function profile(body: Record<string, unknown>): ProposedVendorProfile {
  const description = optionalString(body, 'profile_description');
  return {
    business_name: stringField(body, 'business_name'),
    business_profile_reference: stringField(body, 'business_profile_reference'),
    category: stringField(body, 'category') as 'FRUIT_VEGETABLE',
    latitude: numberField(body, 'latitude'),
    location_name: stringField(body, 'location_name'),
    longitude: numberField(body, 'longitude'),
    minimum_order_minor: integerField(body, 'minimum_order_minor'),
    operating_timezone: stringField(body, 'operating_timezone'),
    payout_profile_reference: stringField(body, 'payout_profile_reference'),
    preparation_seconds: integerField(body, 'preparation_seconds'),
    ...(description !== undefined ? { profile_description: description } : {}),
  };
}

function translate(error: unknown): never {
  if (
    error instanceof VendorOnboardingInputError ||
    error instanceof ProtectedObjectInputError ||
    error instanceof TypeError
  )
    throw new BadRequestException();
  if (
    error instanceof VendorOnboardingNotFoundError ||
    error instanceof ProtectedObjectNotFoundError
  ) {
    throw new NotFoundException();
  }
  if (error instanceof VendorOnboardingConflictError) throw new ConflictException();
  if (
    error instanceof VendorOnboardingAuthorizationError ||
    error instanceof ProtectedObjectPermissionError
  ) {
    throw new ForbiddenException();
  }
  if (
    error instanceof VendorOnboardingIncompleteError ||
    error instanceof ProtectedObjectRejectedError
  ) {
    throw new UnprocessableEntityException();
  }
  throw error;
}

const manageOnboarding = RequireAuthorization({
  admin_scope: { kind: 'GLOBAL' },
  capability: 'admin.vendor_onboarding.manage',
  conceal_resource: true,
});
const reviewOnboarding = RequireAuthorization({
  admin_scope: { kind: 'GLOBAL' },
  capability: 'admin.vendor_onboarding.review',
  conceal_resource: true,
});

@Controller()
export class VendorOnboardingController {
  constructor(@Inject(VENDOR_ONBOARDING) private readonly onboarding: VendorOnboardingService) {}

  @Post('vendor/onboarding/applications')
  @RequireSession()
  async createApplication(@Req() request: AuthorizedRequest) {
    return {
      onboarding_case_id: await this.onboarding.createApplication({
        applicant_user_id: principal(request),
        context: currentRequestContext(),
      }),
    };
  }

  @Post('vendor/onboarding/invitations/claim')
  @RequireSession()
  async claimInvitation(@Req() request: AuthorizedRequest, @Body() raw: unknown) {
    const body = bodyObject(raw);
    try {
      return {
        version: await this.onboarding.claimInvitation({
          applicant_user_id: principal(request),
          context: currentRequestContext(),
          expected_version: integerField(body, 'expected_version'),
          invitation_reference: stringField(body, 'invitation_reference'),
        }),
      };
    } catch (error) {
      translate(error);
    }
  }

  @Put('vendor/onboarding/:onboarding_case_id/profile')
  @RequireSession()
  async submitProfile(
    @Req() request: AuthorizedRequest,
    @Param('onboarding_case_id') caseId: string,
    @Body() raw: unknown,
  ) {
    const body = bodyObject(raw);
    try {
      return {
        version: await this.onboarding.submitProfile({
          applicant_user_id: principal(request),
          context: currentRequestContext(),
          expected_version: integerField(body, 'expected_version'),
          onboarding_case_id: uuid(caseId),
          profile: profile(body),
        }),
      };
    } catch (error) {
      translate(error);
    }
  }

  @Post('vendor/onboarding/:onboarding_case_id/documents')
  @RequireSession()
  async uploadDocument(
    @Req() request: AuthorizedRequest,
    @Param('onboarding_case_id') caseId: string,
    @Body() raw: unknown,
  ) {
    const body = bodyObject(raw);
    const scenario = body.test_scan_scenario;
    const expiresOn = optionalString(body, 'expires_on');
    if (scenario !== undefined && scenario !== 'clean' && scenario !== 'rejected')
      throw new BadRequestException();
    try {
      return await this.onboarding.uploadDocument({
        affected_capability: stringField(body, 'affected_capability') as AffectedCapability,
        applicant_user_id: principal(request),
        content: decodeBase64(stringField(body, 'content_base64')),
        context: currentRequestContext(),
        document_kind: stringField(body, 'document_kind') as VerificationDocumentKind,
        expected_case_version: integerField(body, 'expected_version'),
        ...(expiresOn !== undefined ? { expires_on: expiresOn } : {}),
        media_type: stringField(body, 'media_type') as ProtectedMediaType,
        onboarding_case_id: uuid(caseId),
        ...(scenario ? { scan_scenario: scenario as StorageScanScenario } : {}),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Get('vendor/onboarding/:onboarding_case_id')
  @RequireSession()
  async applicantCase(
    @Req() request: AuthorizedRequest,
    @Param('onboarding_case_id') caseId: string,
  ) {
    try {
      return await this.onboarding.getForApplicant({
        applicant_user_id: principal(request),
        onboarding_case_id: uuid(caseId),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('vendor/onboarding/:onboarding_case_id/appeals')
  @RequireSession()
  async appeal(
    @Req() request: AuthorizedRequest,
    @Param('onboarding_case_id') caseId: string,
    @Body() raw: unknown,
  ) {
    const body = bodyObject(raw);
    const documentId = optionalString(body, 'verification_document_id');
    const evidenceReference = optionalString(body, 'evidence_reference');
    try {
      return {
        onboarding_appeal_id: await this.onboarding.submitAppeal({
          appeal_note: stringField(body, 'appeal_note'),
          applicant_user_id: principal(request),
          context: currentRequestContext(),
          ...(evidenceReference !== undefined ? { evidence_reference: evidenceReference } : {}),
          expected_case_version: integerField(body, 'expected_version'),
          onboarding_case_id: uuid(caseId),
          reason_code: stringField(body, 'reason_code'),
          ...(documentId ? { verification_document_id: uuid(documentId) } : {}),
        }),
      };
    } catch (error) {
      translate(error);
    }
  }

  @Post('admin/vendor-onboarding/leads')
  @manageOnboarding
  async createLead() {
    try {
      return {
        onboarding_case_id: await this.onboarding.createLead({ context: currentRequestContext() }),
      };
    } catch (error) {
      translate(error);
    }
  }

  @Post('admin/vendor-onboarding/invitations')
  @manageOnboarding
  async createInvitation(@Body() raw: unknown) {
    const body = bodyObject(raw);
    const applicantId = optionalString(body, 'applicant_user_id');
    try {
      return {
        onboarding_case_id: await this.onboarding.createInvitation({
          context: currentRequestContext(),
          invitation_reference: stringField(body, 'invitation_reference'),
          ...(applicantId ? { applicant_user_id: uuid(applicantId) } : {}),
        }),
      };
    } catch (error) {
      translate(error);
    }
  }

  @Post('admin/vendor-onboarding/deadlines/advance')
  @manageOnboarding
  @HttpCode(200)
  async advanceDeadlines() {
    try {
      return {
        changed: await this.onboarding.advanceDocumentDeadlines({
          context: currentRequestContext(),
        }),
      };
    } catch (error) {
      translate(error);
    }
  }

  @Post('admin/vendor-onboarding/:onboarding_case_id/review/start')
  @manageOnboarding
  async startReview(@Param('onboarding_case_id') caseId: string, @Body() raw: unknown) {
    const body = bodyObject(raw);
    try {
      return {
        version: await this.onboarding.startReview({
          context: currentRequestContext(),
          expected_version: integerField(body, 'expected_version'),
          onboarding_case_id: uuid(caseId),
        }),
      };
    } catch (error) {
      translate(error);
    }
  }

  @Post('admin/vendor-onboarding/:onboarding_case_id/documents/:document_id/review')
  @reviewOnboarding
  async reviewDocument(
    @Param('onboarding_case_id') caseId: string,
    @Param('document_id') documentId: string,
    @Body() raw: unknown,
  ) {
    const body = bodyObject(raw);
    const decision = stringField(body, 'decision');
    if (decision !== 'APPROVED' && decision !== 'REJECTED') throw new BadRequestException();
    try {
      return {
        version: await this.onboarding.reviewDocument({
          context: currentRequestContext(),
          decision,
          evidence_reference: stringField(body, 'evidence_reference'),
          expected_case_version: integerField(body, 'expected_version'),
          onboarding_case_id: uuid(caseId),
          reason_code: stringField(body, 'reason_code'),
          reviewer_note: stringField(body, 'reviewer_note'),
          verification_document_id: uuid(documentId),
        }),
      };
    } catch (error) {
      translate(error);
    }
  }

  @Post('admin/vendor-onboarding/:onboarding_case_id/approve')
  @reviewOnboarding
  async approve(@Param('onboarding_case_id') caseId: string, @Body() raw: unknown) {
    const body = bodyObject(raw);
    try {
      return await this.onboarding.approve({
        context: currentRequestContext(),
        evidence_reference: stringField(body, 'evidence_reference'),
        expected_version: integerField(body, 'expected_version'),
        onboarding_case_id: uuid(caseId),
        reason_code: stringField(body, 'reason_code'),
        reviewer_note: stringField(body, 'reviewer_note'),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('admin/vendor-onboarding/:onboarding_case_id/reject')
  @reviewOnboarding
  async reject(@Param('onboarding_case_id') caseId: string, @Body() raw: unknown) {
    const body = bodyObject(raw);
    try {
      return {
        version: await this.onboarding.reject({
          context: currentRequestContext(),
          expected_version: integerField(body, 'expected_version'),
          onboarding_case_id: uuid(caseId),
          reason_code: stringField(body, 'reason_code'),
          reviewer_note: stringField(body, 'reviewer_note'),
        }),
      };
    } catch (error) {
      translate(error);
    }
  }

  @Post('admin/vendor-onboarding/:onboarding_case_id/documents/:document_id/grace')
  @reviewOnboarding
  async grace(
    @Param('onboarding_case_id') caseId: string,
    @Param('document_id') documentId: string,
    @Body() raw: unknown,
  ) {
    const body = bodyObject(raw);
    try {
      return {
        version: await this.onboarding.grantDocumentGrace({
          context: currentRequestContext(),
          expected_case_version: integerField(body, 'expected_version'),
          grace_until: stringField(body, 'grace_until'),
          onboarding_case_id: uuid(caseId),
          reason_code: stringField(body, 'reason_code'),
          reviewer_note: stringField(body, 'reviewer_note'),
          verification_document_id: uuid(documentId),
        }),
      };
    } catch (error) {
      translate(error);
    }
  }

  @Post('admin/vendor-onboarding/:onboarding_case_id/appeals/:appeal_id/review')
  @reviewOnboarding
  async reviewAppeal(
    @Param('onboarding_case_id') caseId: string,
    @Param('appeal_id') appealId: string,
    @Body() raw: unknown,
  ) {
    const body = bodyObject(raw);
    const decision = stringField(body, 'decision');
    if (decision !== 'OVERTURNED' && decision !== 'UPHELD') throw new BadRequestException();
    try {
      return {
        version: await this.onboarding.reviewAppeal({
          context: currentRequestContext(),
          decision,
          expected_case_version: integerField(body, 'expected_version'),
          onboarding_appeal_id: uuid(appealId),
          onboarding_case_id: uuid(caseId),
          reason_code: stringField(body, 'reason_code'),
          reviewer_note: stringField(body, 'reviewer_note'),
        }),
      };
    } catch (error) {
      translate(error);
    }
  }

  @Get('admin/vendor-onboarding/:onboarding_case_id')
  @manageOnboarding
  async adminCase(@Param('onboarding_case_id') caseId: string) {
    try {
      return await this.onboarding.getForAdmin({
        context: currentRequestContext(),
        onboarding_case_id: uuid(caseId),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('admin/vendor-onboarding/documents/:document_id/access')
  @reviewOnboarding
  @HttpCode(200)
  async documentAccess(@Param('document_id') documentId: string) {
    try {
      return await this.onboarding.issueDocumentReadGrant({
        context: currentRequestContext(),
        verification_document_id: uuid(documentId),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('admin/vendor-onboarding/documents/:document_id/content')
  @reviewOnboarding
  @HttpCode(200)
  async documentContent(@Param('document_id') documentId: string, @Body() raw: unknown) {
    const body = bodyObject(raw);
    try {
      const result = await this.onboarding.readDocumentWithGrant({
        context: currentRequestContext(),
        grant: stringField(body, 'grant'),
        verification_document_id: uuid(documentId),
      });
      return {
        content_base64: Buffer.from(result.content).toString('base64'),
        media_type: result.media_type,
      };
    } catch (error) {
      translate(error);
    }
  }
}
