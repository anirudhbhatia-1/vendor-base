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
import type { TrustReviewService } from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { TRUST_REVIEW } from './tokens.js';
import {
  dateField,
  integerField,
  object,
  optionalDate,
  optionalString,
  stringField,
  uuid,
} from './request-fields.js';
import { translateDomainError } from './domain-errors.js';

/**
 * Reading needs the dashboard; the service also requires a trust capability
 * to read, proposing to propose, and every decision to approve (11.4).
 */
const read = RequireAuthorization({
  capability: 'admin.control.dashboard_read',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: true,
});
const propose = RequireAuthorization({
  capability: 'admin.trust.restriction_propose',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: true,
});
const decide = RequireAuthorization({
  capability: 'admin.trust.restriction_approve',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: true,
});
const partnerStanding = RequireAuthorization({
  capability: 'partner.standing.read',
  conceal_resource: true,
});
const customerRead = RequireAuthorization({
  capability: 'customer.order.read',
  conceal_resource: true,
});
const customerManage = RequireAuthorization({
  capability: 'customer.account.manage',
  conceal_resource: true,
});
const vendorLocation = RequireAuthorization({
  capability: 'vendor.location.read',
  conceal_resource: true,
  vendor_location_id_param: 'vendor_location_id',
});

function signalIds(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new BadRequestException();
  return value.map((entry) => uuid(entry));
}

@Controller('admin/trust')
export class AdminTrustReviewController {
  constructor(@Inject(TRUST_REVIEW) private readonly trust: TrustReviewService) {}

  @Get('signals')
  @read
  async signals() {
    try {
      return await this.trust.queue({ context: currentRequestContext() });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('signals/collect')
  @propose
  @HttpCode(200)
  async collect() {
    try {
      return await this.trust.collectSignals({ context: currentRequestContext() });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('signals/:trust_signal_id/dismiss')
  @read
  @HttpCode(200)
  async dismiss(@Param('trust_signal_id') id: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.trust.dismissSignal({
        context: currentRequestContext(),
        trust_signal_id: uuid(id),
        reason_code: stringField(body, 'reason_code'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('subjects/:subject_kind/:subject_reference')
  @read
  async subject(
    @Param('subject_kind') kind: string,
    @Param('subject_reference') reference: string,
  ) {
    try {
      return await this.trust.dossier({
        context: currentRequestContext(),
        subject_kind: kind,
        subject_reference: reference,
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('cases')
  @read
  async cases(@Query('view') view?: string) {
    if (view !== undefined && view !== 'WORK' && view !== 'ALL') throw new BadRequestException();
    try {
      return await this.trust.cases({
        context: currentRequestContext(),
        ...(view ? { view } : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('cases')
  @propose
  async proposeCase(@Body() raw: unknown) {
    const body = object(raw);
    try {
      const evidence = optionalString(body, 'evidence_reference');
      const note = optionalString(body, 'proposal_note');
      return await this.trust.propose({
        context: currentRequestContext(),
        subject_kind: stringField(body, 'subject_kind'),
        subject_reference: stringField(body, 'subject_reference'),
        scope_kind: stringField(body, 'scope_kind'),
        scope_reference: stringField(body, 'scope_reference'),
        reason_code: stringField(body, 'reason_code'),
        policy_reference: stringField(body, 'policy_reference'),
        signal_ids: signalIds(body.signal_ids),
        ...(evidence !== undefined ? { evidence_reference: evidence } : {}),
        ...(note !== undefined ? { proposal_note: note } : {}),
        effective_until: dateField(body, 'effective_until'),
        review_at: dateField(body, 'review_at'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('cases/:trust_restriction_case_id')
  @read
  async detail(@Param('trust_restriction_case_id') id: string) {
    try {
      return await this.trust.detail({
        context: currentRequestContext(),
        trust_restriction_case_id: uuid(id),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('cases/:trust_restriction_case_id/actions/:action')
  @decide
  @HttpCode(200)
  async act(
    @Param('trust_restriction_case_id') id: string,
    @Param('action') action: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    if (!/^[A-Z_]{3,32}$/.test(action)) throw new BadRequestException();
    try {
      const outcome = optionalString(body, 'outcome');
      const reviewAt = optionalDate(body, 'review_at');
      const until = optionalDate(body, 'effective_until');
      return await this.trust.act({
        context: currentRequestContext(),
        trust_restriction_case_id: uuid(id),
        action,
        expected_version: integerField(body, 'expected_version', 1),
        reason_code: stringField(body, 'reason_code'),
        ...(outcome !== undefined ? { outcome } : {}),
        ...(reviewAt !== undefined ? { review_at: reviewAt } : {}),
        ...(until !== undefined ? { effective_until: until } : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
}

/** The restrictions on the person asking, and their appeal (SEC-14, DLP-56). */
@Controller('partner/standing/restrictions')
export class PartnerRestrictionController {
  constructor(@Inject(TRUST_REVIEW) private readonly trust: TrustReviewService) {}

  @Get()
  @partnerStanding
  async list() {
    try {
      return await this.trust.ownRestrictions({ context: currentRequestContext() });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':trust_restriction_case_id/appeals')
  @partnerStanding
  async appeal(@Param('trust_restriction_case_id') id: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.trust.appeal({
        context: currentRequestContext(),
        trust_restriction_case_id: uuid(id),
        statement: stringField(body, 'statement'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
}

@Controller('customer/restrictions')
export class CustomerRestrictionController {
  constructor(@Inject(TRUST_REVIEW) private readonly trust: TrustReviewService) {}

  @Get()
  @customerRead
  async list() {
    try {
      return await this.trust.ownRestrictions({ context: currentRequestContext() });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':trust_restriction_case_id/appeals')
  @customerManage
  async appeal(@Param('trust_restriction_case_id') id: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.trust.appeal({
        context: currentRequestContext(),
        trust_restriction_case_id: uuid(id),
        statement: stringField(body, 'statement'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
}

@Controller('vendor/locations/:vendor_location_id/restrictions')
export class VendorRestrictionController {
  constructor(@Inject(TRUST_REVIEW) private readonly trust: TrustReviewService) {}

  @Get()
  @vendorLocation
  async list(@Param('vendor_location_id') locationId: string) {
    try {
      return await this.trust.ownRestrictions({
        context: currentRequestContext(),
        vendor_location_id: uuid(locationId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':trust_restriction_case_id/appeals')
  @vendorLocation
  async appeal(
    @Param('vendor_location_id') locationId: string,
    @Param('trust_restriction_case_id') id: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    try {
      return await this.trust.appeal({
        context: currentRequestContext(),
        vendor_location_id: uuid(locationId),
        trust_restriction_case_id: uuid(id),
        statement: stringField(body, 'statement'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
}
