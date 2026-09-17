import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  AssignmentConflictError,
  AssignmentCustodyService,
  AssignmentInputError,
  AssignmentNotFoundError,
} from '@neighbourhood-store/database';
import { parseUuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { ASSIGNMENT_CUSTODY } from './tokens.js';
import {
  booleanField,
  dateField,
  integerField,
  object,
  stringField,
  stringsField,
  uuid,
} from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
const offeredAssignment = RequireAuthorization({
  capability: 'partner.eligibility.read',
  conceal_resource: true,
});
const readAssignment = RequireAuthorization({
  capability: 'partner.assignment.read',
  conceal_resource: true,
  delivery_assignment_id_param: 'delivery_assignment_id',
});
const actOnAssignment = RequireAuthorization({
  capability: 'partner.assignment.act',
  conceal_resource: true,
  delivery_assignment_id_param: 'delivery_assignment_id',
});
const manageAssignments = RequireAuthorization({
  admin_scope: { kind: 'GLOBAL' },
  capability: 'admin.delivery.assignment_manage',
  conceal_resource: true,
});

function transition(value: Record<string, unknown>, assignmentId: string) {
  return {
    command_reference: stringField(value, 'command_reference'),
    context: currentRequestContext(),
    delivery_assignment_id: uuid(assignmentId),
    expected_version: integerField(value, 'expected_version', 1),
    reason_code: stringField(value, 'reason_code'),
  };
}

@Controller('partner')
export class PartnerAssignmentController {
  constructor(@Inject(ASSIGNMENT_CUSTODY) private readonly assignments: AssignmentCustodyService) {}

  @Get('offers')
  @offeredAssignment
  async listOffers() {
    const actor = currentRequestContext().actor;
    if (!actor || actor.actor_kind !== 'delivery_partner') {
      return { offers: [] };
    }
    try {
      const offers = await this.assignments.listOffersForPartner({
        partner_user_id: actor.actor_id,
      });
      return { offers };
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('offers/:delivery_assignment_id/accept')
  @offeredAssignment
  @HttpCode(200)
  async accept(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    try {
      return await this.assignments.accept(transition(object(raw), id));
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  /**
   * The partner's own delivery rating.
   *
   * An aggregate over a window, never a list: a rating traceable to one
   * delivery is traceable to one customer at one door. Built in 0060 with no
   * way for the person it is about to see it.
   */
  @Get('ratings')
  @offeredAssignment
  async ratings() {
    const actor = currentRequestContext().actor;
    if (!actor || actor.actor_kind !== 'delivery_partner') {
      return { rating_average: null, rating_count: 0 };
    }
    return this.assignments.partnerRatingSummary({ partner_user_id: actor.actor_id });
  }

  @Get('assignments')
  @offeredAssignment
  async listAssignments() {
    const actor = currentRequestContext().actor;
    if (!actor || actor.actor_kind !== 'delivery_partner') return { assignments: [] };
    try {
      return {
        assignments: await this.assignments.listActiveForPartner({
          partner_user_id: actor.actor_id,
        }),
      };
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('offers/:delivery_assignment_id/decline')
  @offeredAssignment
  @HttpCode(200)
  async decline(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    const value = object(raw);
    try {
      return await this.assignments.endBeforePickup({
        ...transition(value, id),
        resulting_state: 'DECLINED',
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Get('assignments/:delivery_assignment_id')
  @readAssignment
  async get(@Param('delivery_assignment_id') id: string) {
    try {
      return await this.assignments.get({
        context: currentRequestContext(),
        delivery_assignment_id: uuid(id),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('assignments/:delivery_assignment_id/arrive-vendor')
  @actOnAssignment
  @HttpCode(200)
  async arriveVendor(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    try {
      return await this.assignments.arriveAtVendor(transition(object(raw), id));
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('assignments/:delivery_assignment_id/pickup')
  @actOnAssignment
  @HttpCode(200)
  async pickup(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    const value = object(raw);
    try {
      return await this.assignments.confirmPickup({
        ...transition(value, id),
        package_count: integerField(value, 'package_count', 1),
        proof_reference: stringField(value, 'proof_reference'),
        vendor_confirmed: booleanField(value, 'vendor_confirmed'),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('assignments/:delivery_assignment_id/begin-route')
  @actOnAssignment
  @HttpCode(200)
  async beginRoute(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    try {
      return await this.assignments.beginRoute(transition(object(raw), id));
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('assignments/:delivery_assignment_id/arrive-customer')
  @actOnAssignment
  @HttpCode(200)
  async arriveCustomer(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    try {
      return await this.assignments.arriveAtCustomer(transition(object(raw), id));
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('assignments/:delivery_assignment_id/deliver')
  @actOnAssignment
  @HttpCode(200)
  async deliver(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    const value = object(raw);
    try {
      return await this.assignments.deliver({
        ...transition(value, id),
        otp: stringField(value, 'otp'),
        proof_reference: stringField(value, 'proof_reference'),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('assignments/:delivery_assignment_id/fail')
  @actOnAssignment
  @HttpCode(200)
  async fail(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    try {
      return await this.assignments.failDelivery(transition(object(raw), id));
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('assignments/:delivery_assignment_id/require-return')
  @actOnAssignment
  @HttpCode(200)
  async requireReturn(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    try {
      return await this.assignments.requireReturn(transition(object(raw), id));
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('assignments/:delivery_assignment_id/begin-return')
  @actOnAssignment
  @HttpCode(200)
  async beginReturn(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    try {
      return await this.assignments.beginReturn(transition(object(raw), id));
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('assignments/:delivery_assignment_id/complete-return')
  @actOnAssignment
  @HttpCode(200)
  async completeReturn(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    const value = object(raw);
    try {
      return await this.assignments.completeReturn({
        ...transition(value, id),
        proof_reference: stringField(value, 'proof_reference'),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
}

@Controller('admin/delivery/assignments')
export class AdminAssignmentController {
  constructor(@Inject(ASSIGNMENT_CUSTODY) private readonly assignments: AssignmentCustodyService) {}

  @Post()
  @manageAssignments
  async create(@Body() raw: unknown) {
    const value = object(raw);
    try {
      return await this.assignments.create({
        approximate_drop_area: stringField(value, 'approximate_drop_area'),
        approximate_pickup_area: stringField(value, 'approximate_pickup_area'),
        command_reference: stringField(value, 'command_reference'),
        context: currentRequestContext(),
        handling_flags: stringsField(value, 'handling_flags'),
        package_count: integerField(value, 'package_count', 1),
        reason_code: stringField(value, 'reason_code'),
        source_order_reference: stringField(value, 'source_order_reference'),
        vendor_location_id: uuid(stringField(value, 'vendor_location_id')),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post(':delivery_assignment_id/offer')
  @manageAssignments
  @HttpCode(200)
  async offer(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    const value = object(raw);
    try {
      return await this.assignments.offer({
        ...transition(value, id),
        expires_at: dateField(value, 'expires_at'),
        partner_user_id: uuid(stringField(value, 'partner_user_id')),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post(':delivery_assignment_id/authorize-return')
  @manageAssignments
  @HttpCode(200)
  async authorizeReturn(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    const value = object(raw);
    try {
      return await this.assignments.authorizeReturn({
        ...transition(value, id),
        destination_reference: stringField(value, 'destination_reference'),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post(':delivery_assignment_id/end-before-pickup')
  @manageAssignments
  @HttpCode(200)
  async endBeforePickup(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    const value = object(raw);
    const resulting = stringField(value, 'resulting_state');
    if (!['CANCELLED', 'FAILED_PICKUP', 'REASSIGNED'].includes(resulting)) {
      throw new BadRequestException();
    }
    try {
      return await this.assignments.endBeforePickup({
        ...transition(value, id),
        resulting_state: resulting as 'CANCELLED' | 'FAILED_PICKUP' | 'REASSIGNED',
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
}

const customerRatesDelivery = RequireAuthorization({
  capability: 'customer.order.rate',
  conceal_resource: true,
});

/**
 * The customer's rating of the delivery itself.
 *
 * Deliberately its own route rather than another field on the order rating:
 * the shop and the rider performed two different services, and one score across
 * both means a shop that packed a perfect order carries a late rider on its
 * record, with neither able to act on the signal.
 */
@Controller('customer/deliveries')
export class CustomerDeliveryRatingController {
  constructor(@Inject(ASSIGNMENT_CUSTODY) private readonly assignments: AssignmentCustodyService) {}

  @Post(':delivery_assignment_id/rating')
  @customerRatesDelivery
  async rate(
    @Param('delivery_assignment_id') assignmentId: string,
    @Body() raw: unknown,
  ): Promise<{ readonly rated: true }> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException();
    const body = raw as Record<string, unknown>;
    if (typeof body.stars !== 'number') throw new BadRequestException();
    if (body.review_note !== undefined && typeof body.review_note !== 'string') {
      throw new BadRequestException();
    }
    try {
      await this.assignments.submitDeliveryRating({
        context: currentRequestContext(),
        delivery_assignment_id: parseUuidV7(assignmentId),
        stars: body.stars,
        ...(typeof body.review_note === 'string' ? { review_note: body.review_note } : {}),
      });
      return { rated: true };
    } catch (error) {
      if (error instanceof AssignmentInputError) throw new BadRequestException(error.message);
      if (error instanceof AssignmentNotFoundError) throw new NotFoundException();
      if (error instanceof AssignmentConflictError)
        throw new ConflictException({ error_code: 'ORDER_STATE_CONFLICT' });
      throw error;
    }
  }
}
