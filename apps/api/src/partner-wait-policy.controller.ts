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
import { AssignmentCustodyService, PartnerWaitPolicyService } from '@neighbourhood-store/database';
import {} from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { ASSIGNMENT_CUSTODY, PARTNER_WAIT_POLICY } from './tokens.js';
import { uuid, object, stringField } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
const act = RequireAuthorization({
  capability: 'partner.assignment.act',
  conceal_resource: true,
  delivery_assignment_id_param: 'delivery_assignment_id',
});

@Controller('partner/assignments/:delivery_assignment_id/wait')
export class PartnerWaitPolicyController {
  constructor(
    @Inject(PARTNER_WAIT_POLICY) private readonly service: PartnerWaitPolicyService,
    @Inject(ASSIGNMENT_CUSTODY) private readonly assignments: AssignmentCustodyService,
  ) {}

  @Get()
  @act
  async get(@Param('delivery_assignment_id') assignmentId: string) {
    try {
      return await this.service.get({
        context: currentRequestContext(),
        delivery_assignment_id: uuid(assignmentId),
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
        delivery_assignment_id: uuid(assignmentId),
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
        delivery_assignment_id: uuid(assignmentId),
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
      const context = currentRequestContext();
      const id = uuid(assignmentId);
      // Where the partner is decides what leaving means (9.5): at the store the
      // attempt goes back to the pool with the wait paid; at the customer's
      // door the delivery fails under the policy (DLP-38). The custody
      // service checks the state again under its lock.
      const current = await this.assignments.get({ context, delivery_assignment_id: id });
      if (current.assignment_state === 'AT_VENDOR') {
        return await this.assignments.leaveStoreAfterWait({
          command_reference: stringField(input, 'command_reference'),
          context,
          delivery_assignment_id: id,
          expected_version: current.version,
          reason_code: stringField(input, 'reason_code'),
        });
      }
      return await this.service.leave({
        context,
        delivery_assignment_id: id,
        command_reference: stringField(input, 'command_reference'),
        reason_code: stringField(input, 'reason_code'),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
}
