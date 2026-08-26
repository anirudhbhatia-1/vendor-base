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
} from '@nestjs/common';
import {
  AssignmentAuthorizationError,
  AssignmentConflictError,
  AssignmentCustodyService,
  AssignmentInputError,
  AssignmentNotFoundError,
  AssignmentVersionError,
} from '@neighbourhood-store/database';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { ASSIGNMENT_CUSTODY } from './tokens.js';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}
function stringField(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== 'string') throw new BadRequestException();
  return value[key];
}
function booleanField(value: Record<string, unknown>, key: string): boolean {
  if (typeof value[key] !== 'boolean') throw new BadRequestException();
  return value[key];
}
function integerField(value: Record<string, unknown>, key: string, minimum = 1): number {
  const found = value[key];
  if (!Number.isSafeInteger(found) || (found as number) < minimum) throw new BadRequestException();
  return found as number;
}
function stringsField(value: Record<string, unknown>, key: string): readonly string[] {
  const found = value[key];
  if (!Array.isArray(found) || found.some((entry) => typeof entry !== 'string')) {
    throw new BadRequestException();
  }
  return found as string[];
}
function dateField(value: Record<string, unknown>, key: string): Date {
  const found = stringField(value, key);
  const parsed = new Date(found);
  if (!Number.isFinite(parsed.getTime())) throw new BadRequestException();
  return parsed;
}
function uuid(value: string): UuidV7 {
  try {
    return parseUuidV7(value);
  } catch {
    throw new BadRequestException();
  }
}
function translate(error: unknown): never {
  if (error instanceof AssignmentInputError || error instanceof TypeError) {
    throw new BadRequestException();
  }
  if (error instanceof AssignmentNotFoundError) throw new NotFoundException();
  if (error instanceof AssignmentVersionError) {
    throw new ConflictException({ error_code: error.code });
  }
  if (error instanceof AssignmentConflictError) throw new ConflictException();
  if (error instanceof AssignmentAuthorizationError) throw new ForbiddenException();
  throw error;
}

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
    expected_version: integerField(value, 'expected_version'),
    reason_code: stringField(value, 'reason_code'),
  };
}

@Controller('partner')
export class PartnerAssignmentController {
  constructor(@Inject(ASSIGNMENT_CUSTODY) private readonly assignments: AssignmentCustodyService) {}

  @Post('offers/:delivery_assignment_id/accept')
  @offeredAssignment
  @HttpCode(200)
  async accept(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    try {
      return await this.assignments.accept(transition(object(raw), id));
    } catch (error) {
      translate(error);
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
      translate(error);
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
      translate(error);
    }
  }

  @Post('assignments/:delivery_assignment_id/arrive-vendor')
  @actOnAssignment
  @HttpCode(200)
  async arriveVendor(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    try {
      return await this.assignments.arriveAtVendor(transition(object(raw), id));
    } catch (error) {
      translate(error);
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
        package_count: integerField(value, 'package_count'),
        proof_reference: stringField(value, 'proof_reference'),
        vendor_confirmed: booleanField(value, 'vendor_confirmed'),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('assignments/:delivery_assignment_id/begin-route')
  @actOnAssignment
  @HttpCode(200)
  async beginRoute(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    try {
      return await this.assignments.beginRoute(transition(object(raw), id));
    } catch (error) {
      translate(error);
    }
  }

  @Post('assignments/:delivery_assignment_id/arrive-customer')
  @actOnAssignment
  @HttpCode(200)
  async arriveCustomer(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    try {
      return await this.assignments.arriveAtCustomer(transition(object(raw), id));
    } catch (error) {
      translate(error);
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
        proof_reference: stringField(value, 'proof_reference'),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('assignments/:delivery_assignment_id/fail')
  @actOnAssignment
  @HttpCode(200)
  async fail(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    try {
      return await this.assignments.failDelivery(transition(object(raw), id));
    } catch (error) {
      translate(error);
    }
  }

  @Post('assignments/:delivery_assignment_id/require-return')
  @actOnAssignment
  @HttpCode(200)
  async requireReturn(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    try {
      return await this.assignments.requireReturn(transition(object(raw), id));
    } catch (error) {
      translate(error);
    }
  }

  @Post('assignments/:delivery_assignment_id/begin-return')
  @actOnAssignment
  @HttpCode(200)
  async beginReturn(@Param('delivery_assignment_id') id: string, @Body() raw: unknown) {
    try {
      return await this.assignments.beginReturn(transition(object(raw), id));
    } catch (error) {
      translate(error);
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
      translate(error);
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
        package_count: integerField(value, 'package_count'),
        reason_code: stringField(value, 'reason_code'),
        source_order_reference: stringField(value, 'source_order_reference'),
        vendor_location_id: uuid(stringField(value, 'vendor_location_id')),
      });
    } catch (error) {
      translate(error);
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
      translate(error);
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
      translate(error);
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
      translate(error);
    }
  }
}
