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
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  VendorPublicationAuthorizationError,
  VendorPublicationConflictError,
  VendorPublicationIncompleteError,
  VendorPublicationInputError,
  VendorPublicationNotFoundError,
  VendorPublicationService,
  VendorPublicationVersionError,
  type PublicationState,
} from '@neighbourhood-store/database';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { VENDOR_PUBLICATION } from './tokens.js';

const STATES = new Set<PublicationState>([
  'APPROVED',
  'CHANGES_REQUIRED',
  'DRAFT',
  'PAUSED',
  'PENDING_APPROVAL',
  'PUBLISHED',
  'UNPUBLISHED',
]);
function body(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}
function stringField(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== 'string') throw new BadRequestException();
  return value[key];
}
function version(value: Record<string, unknown>): number {
  const found = value.expected_version;
  if (!Number.isSafeInteger(found) || (found as number) < 1) throw new BadRequestException();
  return found as number;
}
function uuid(value: string): UuidV7 {
  try {
    return parseUuidV7(value);
  } catch {
    throw new BadRequestException();
  }
}
function translate(error: unknown): never {
  if (error instanceof VendorPublicationInputError || error instanceof TypeError)
    throw new BadRequestException();
  if (error instanceof VendorPublicationNotFoundError) throw new NotFoundException();
  if (error instanceof VendorPublicationVersionError)
    throw new ConflictException({ error_code: error.code });
  if (error instanceof VendorPublicationConflictError) throw new ConflictException();
  if (error instanceof VendorPublicationAuthorizationError) throw new ForbiddenException();
  if (error instanceof VendorPublicationIncompleteError)
    throw new UnprocessableEntityException({
      error_code: error.code,
      missing_checks: error.missing_checks,
    });
  throw error;
}
const managePublication = RequireAuthorization({
  admin_scope: { kind: 'GLOBAL' },
  capability: 'admin.vendor_publication.manage',
  conceal_resource: true,
});
const reviewPublication = RequireAuthorization({
  admin_scope: { kind: 'GLOBAL' },
  capability: 'admin.vendor_publication.review',
  conceal_resource: true,
});

@Controller('admin/vendor-publications')
export class VendorPublicationController {
  constructor(@Inject(VENDOR_PUBLICATION) private readonly publication: VendorPublicationService) {}

  @Post()
  @managePublication
  async create(@Body() raw: unknown) {
    const value = body(raw);
    try {
      return {
        publication_case_id: await this.publication.create({
          context: currentRequestContext(),
          onboarding_case_id: uuid(stringField(value, 'onboarding_case_id')),
        }),
      };
    } catch (error) {
      translate(error);
    }
  }
  @Get()
  @managePublication
  async list(@Query('state') rawState?: string) {
    if (rawState !== undefined && !STATES.has(rawState as PublicationState))
      throw new BadRequestException();
    try {
      return {
        cases: await this.publication.list({
          context: currentRequestContext(),
          ...(rawState ? { state: rawState as PublicationState } : {}),
        }),
      };
    } catch (error) {
      translate(error);
    }
  }
  @Get(':publication_case_id')
  @managePublication
  async get(@Param('publication_case_id') caseId: string) {
    try {
      return await this.publication.get({
        context: currentRequestContext(),
        publication_case_id: uuid(caseId),
      });
    } catch (error) {
      translate(error);
    }
  }
  @Post(':publication_case_id/readiness')
  @managePublication
  @HttpCode(200)
  async evaluate(@Param('publication_case_id') caseId: string, @Body() raw: unknown) {
    const value = body(raw);
    try {
      return await this.publication.evaluate({
        context: currentRequestContext(),
        expected_version: version(value),
        publication_case_id: uuid(caseId),
      });
    } catch (error) {
      translate(error);
    }
  }
  @Post(':publication_case_id/submit')
  @managePublication
  @HttpCode(200)
  async submit(@Param('publication_case_id') caseId: string, @Body() raw: unknown) {
    return this.operatorTransition('submit', caseId, raw);
  }
  @Post(':publication_case_id/decision')
  @reviewPublication
  @HttpCode(200)
  async decide(@Param('publication_case_id') caseId: string, @Body() raw: unknown) {
    const value = body(raw);
    const decision = stringField(value, 'decision');
    if (decision !== 'APPROVED' && decision !== 'CHANGES_REQUIRED') throw new BadRequestException();
    try {
      return {
        version: await this.publication.decide({
          context: currentRequestContext(),
          decision,
          evidence_reference: stringField(value, 'evidence_reference'),
          expected_version: version(value),
          note: stringField(value, 'note'),
          publication_case_id: uuid(caseId),
          reason_code: stringField(value, 'reason_code'),
        }),
      };
    } catch (error) {
      translate(error);
    }
  }
  @Post(':publication_case_id/publish')
  @managePublication
  @HttpCode(200)
  async publish(@Param('publication_case_id') caseId: string, @Body() raw: unknown) {
    return this.operatorTransition('publish', caseId, raw);
  }
  @Post(':publication_case_id/pause')
  @managePublication
  @HttpCode(200)
  async pause(@Param('publication_case_id') caseId: string, @Body() raw: unknown) {
    return this.operatorTransition('pause', caseId, raw);
  }
  @Post(':publication_case_id/unpublish')
  @managePublication
  @HttpCode(200)
  async unpublish(@Param('publication_case_id') caseId: string, @Body() raw: unknown) {
    return this.operatorTransition('unpublish', caseId, raw);
  }

  private async operatorTransition(
    method: 'pause' | 'publish' | 'submit' | 'unpublish',
    caseId: string,
    raw: unknown,
  ) {
    const value = body(raw);
    try {
      return {
        version: await this.publication[method]({
          context: currentRequestContext(),
          expected_version: version(value),
          note: stringField(value, 'note'),
          publication_case_id: uuid(caseId),
          reason_code: stringField(value, 'reason_code'),
        }),
      };
    } catch (error) {
      translate(error);
    }
  }
}
