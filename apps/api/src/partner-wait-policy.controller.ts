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
import { PartnerWaitPolicyService } from '@neighbourhood-store/database';
import { parseUuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { PARTNER_WAIT_POLICY } from './tokens.js';
import { object, stringField } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
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
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('start')
  @act
  @HttpCode(200)
  async start(@Param('delivery_assignment_id') assignmentId: string, @Body() raw: unknown) {
    const input = object(raw);
    try {
      return await this.service.start({
        context: currentRequestContext(),
        delivery_assignment_id: parseUuidV7(assignmentId),
        command_reference: stringField(input, 'command_reference'),
        reason_code: stringField(input, 'reason_code'),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
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
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('leave')
  @act
  @HttpCode(200)
  async leave(@Param('delivery_assignment_id') assignmentId: string, @Body() raw: unknown) {
    const input = object(raw);
    try {
      return await this.service.leave({
        context: currentRequestContext(),
        delivery_assignment_id: parseUuidV7(assignmentId),
        command_reference: stringField(input, 'command_reference'),
        reason_code: stringField(input, 'reason_code'),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
}
