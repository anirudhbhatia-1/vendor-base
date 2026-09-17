import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { GatedCapabilityService } from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { GATED_CAPABILITIES } from './tokens.js';
import { nonEmptyStringField, object } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
const reviewsGates = RequireAuthorization({
  admin_scope: { kind: 'GLOBAL' },
  capability: 'admin.gated.review',
  conceal_resource: false,
});

/**
 * The register of capabilities FEATURES.md marks Gated.
 *
 * These capabilities do not exist in the product, and this controller does not
 * create them: it records the named approvals that would allow them to be
 * built, and reports that they are unavailable until one exists. Enabling a
 * capability is the same action as recording who approved it and why.
 */
@Controller('admin/gated-capabilities')
export class GatedCapabilitiesController {
  constructor(@Inject(GATED_CAPABILITIES) private readonly gates: GatedCapabilityService) {}

  @Get()
  @reviewsGates
  async list() {
    try {
      return { capabilities: await this.gates.list({ context: currentRequestContext() }) };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':capability_key/approvals')
  @reviewsGates
  @HttpCode(200)
  async approve(@Param('capability_key') capabilityKey: string, @Body() raw: unknown) {
    const body = object(raw);
    const decision = nonEmptyStringField(body, 'decision');
    if (decision !== 'APPROVED' && decision !== 'WITHDRAWN') throw new BadRequestException();
    const input = {
      approval_reference: nonEmptyStringField(body, 'approval_reference'),
      approver_role: nonEmptyStringField(body, 'approver_role'),
      capability_key: capabilityKey,
      context: currentRequestContext(),
      evidence_note: nonEmptyStringField(body, 'evidence_note'),
    };
    try {
      return decision === 'APPROVED'
        ? await this.gates.approve(input)
        : await this.gates.withdraw(input);
    } catch (error) {
      translateDomainError(error);
    }
  }
}
