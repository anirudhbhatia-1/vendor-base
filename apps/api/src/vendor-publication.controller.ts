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
import { VendorPublicationService, type PublicationState } from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { VENDOR_PUBLICATION } from './tokens.js';
import { expectedVersion, object, stringField, uuid } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
const STATES = new Set<PublicationState>([
  'APPROVED',
  'CHANGES_REQUIRED',
  'DRAFT',
  'PAUSED',
  'PENDING_APPROVAL',
  'PUBLISHED',
  'UNPUBLISHED',
]);
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
    const value = object(raw);
    try {
      return {
        publication_case_id: await this.publication.create({
          context: currentRequestContext(),
          onboarding_case_id: uuid(stringField(value, 'onboarding_case_id')),
        }),
      };
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
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
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
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
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
  @Post(':publication_case_id/readiness')
  @managePublication
  @HttpCode(200)
  async evaluate(@Param('publication_case_id') caseId: string, @Body() raw: unknown) {
    const value = object(raw);
    try {
      return await this.publication.evaluate({
        context: currentRequestContext(),
        expected_version: expectedVersion(value),
        publication_case_id: uuid(caseId),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
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
    const value = object(raw);
    const decision = stringField(value, 'decision');
    if (decision !== 'APPROVED' && decision !== 'CHANGES_REQUIRED') throw new BadRequestException();
    try {
      return {
        version: await this.publication.decide({
          context: currentRequestContext(),
          decision,
          evidence_reference: stringField(value, 'evidence_reference'),
          expected_version: expectedVersion(value),
          note: stringField(value, 'note'),
          publication_case_id: uuid(caseId),
          reason_code: stringField(value, 'reason_code'),
        }),
      };
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
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
  @Post(':publication_case_id/restore')
  @managePublication
  @HttpCode(200)
  async restore(@Param('publication_case_id') caseId: string, @Body() raw: unknown) {
    return this.operatorTransition('restore', caseId, raw);
  }
  @Get(':publication_case_id/impact')
  @managePublication
  async impact(@Param('publication_case_id') caseId: string) {
    try {
      return await this.publication.impact({
        context: currentRequestContext(),
        publication_case_id: uuid(caseId),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  private async operatorTransition(
    method: 'pause' | 'publish' | 'restore' | 'submit' | 'unpublish',
    caseId: string,
    raw: unknown,
  ) {
    const value = object(raw);
    try {
      return {
        version: await this.publication[method]({
          context: currentRequestContext(),
          expected_version: expectedVersion(value),
          note: stringField(value, 'note'),
          publication_case_id: uuid(caseId),
          reason_code: stringField(value, 'reason_code'),
        }),
      };
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
}
