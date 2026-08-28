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
  PartnerWaitAuthorizationError,
  PartnerWaitConflictError,
  PartnerWaitInputError,
  PartnerWaitNotFoundError,
  PartnerWaitPolicyService,
} from '@neighbourhood-store/database';
import { parseUuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { PARTNER_WAIT_POLICY } from './tokens.js';

function body(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}
function text(value: Record<string, unknown>, key: string) {
  if (typeof value[key] !== 'string') throw new BadRequestException();
  return value[key];
}
function translate(error: unknown): never {
  if (error instanceof PartnerWaitInputError || error instanceof TypeError) {
    throw new BadRequestException();
  }
  if (error instanceof PartnerWaitNotFoundError) throw new NotFoundException();
  if (error instanceof PartnerWaitConflictError) throw new ConflictException(error.message);
  if (error instanceof PartnerWaitAuthorizationError) throw new ForbiddenException();
  throw error;
}

const act = RequireAuthorization({
  capability: 'partner.assignment.act',
  conceal_resource: true,
  delivery_assignment_id_param: 'delivery_assignment_id',
});

@Controller('partner/assignments/:delivery_assignment_id/wait')
export class PartnerWaitPolicyController {
  constructor(@Inject(PARTNER_WAIT_POLICY) private readonly service: PartnerWaitPolicyService) {}

  @Get()
  @act
  async get(@Param('delivery_assignment_id') assignmentId: string) {
    try {
      return await this.service.get({
        context: currentRequestContext(),
        delivery_assignment_id: parseUuidV7(assignmentId),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('start')
  @act
  @HttpCode(200)
  async start(@Param('delivery_assignment_id') assignmentId: string, @Body() raw: unknown) {
    const input = body(raw);
    try {
      return await this.service.start({
        context: currentRequestContext(),
        delivery_assignment_id: parseUuidV7(assignmentId),
        command_reference: text(input, 'command_reference'),
        reason_code: text(input, 'reason_code'),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('refresh')
  @act
  @HttpCode(200)
  async refresh(@Param('delivery_assignment_id') assignmentId: string) {
    try {
      return await this.service.refresh({
        context: currentRequestContext(),
        delivery_assignment_id: parseUuidV7(assignmentId),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('leave')
  @act
  @HttpCode(200)
  async leave(@Param('delivery_assignment_id') assignmentId: string, @Body() raw: unknown) {
    const input = body(raw);
    try {
      return await this.service.leave({
        context: currentRequestContext(),
        delivery_assignment_id: parseUuidV7(assignmentId),
        command_reference: text(input, 'command_reference'),
        reason_code: text(input, 'reason_code'),
      });
    } catch (error) {
      translate(error);
    }
  }
}
