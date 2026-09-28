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
import type { OrderMonitorService } from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { ORDER_MONITOR } from './tokens.js';
import {
  booleanField,
  integerField,
  object,
  optionalInteger,
  optionalString,
  uuid,
} from './request-fields.js';
import { translateDomainError } from './domain-errors.js';

/**
 * Reading the monitor and an order's history needs the dashboard; each
 * intervention is refused by the service unless the operator also holds its
 * kind's capability (11.2).
 */
const monitor = RequireAuthorization({
  capability: 'admin.control.dashboard_read',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: true,
});

function optionalWhole(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^\d+$/.test(value)) throw new BadRequestException();
  return Number(value);
}

@Controller('admin/orders')
export class AdminOrderMonitorController {
  constructor(@Inject(ORDER_MONITOR) private readonly orders: OrderMonitorService) {}

  @Get('monitor')
  @monitor
  async monitor(
    @Query('state') state?: string,
    @Query('vendor_location_id') vendorLocationId?: string,
    @Query('fulfilment_method') fulfilmentMethod?: string,
    @Query('exception') exception?: string,
    @Query('min_time_in_state_seconds') minTime?: string,
    @Query('checkout_group_id') checkoutGroupId?: string,
  ) {
    try {
      const minimum = optionalWhole(minTime);
      return await this.orders.monitor({
        context: currentRequestContext(),
        filters: {
          ...(state ? { state } : {}),
          ...(vendorLocationId ? { vendor_location_id: uuid(vendorLocationId) } : {}),
          ...(fulfilmentMethod ? { fulfilment_method: fulfilmentMethod } : {}),
          ...(exception ? { exception } : {}),
          ...(minimum !== undefined ? { min_time_in_state_seconds: minimum } : {}),
          ...(checkoutGroupId ? { checkout_group_id: uuid(checkoutGroupId) } : {}),
        },
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Get(':vendor_order_id/timeline')
  @monitor
  async timeline(@Param('vendor_order_id') id: string) {
    try {
      return await this.orders.timeline({
        context: currentRequestContext(),
        vendor_order_id: uuid(id),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Get(':vendor_order_id/interventions/:kind/preview')
  @monitor
  async preview(
    @Param('vendor_order_id') id: string,
    @Param('kind') kind: string,
    @Query('amount_minor') amount?: string,
    @Query('compensation_minor') compensation?: string,
    @Query('message') message?: string,
    @Query('destination_note') destinationNote?: string,
  ) {
    try {
      const amountMinor = optionalWhole(amount);
      const compensationMinor = optionalWhole(compensation);
      return await this.orders.preview({
        context: currentRequestContext(),
        kind,
        params: {
          ...(amountMinor !== undefined ? { amount_minor: amountMinor } : {}),
          ...(compensationMinor !== undefined ? { compensation_minor: compensationMinor } : {}),
          ...(message ? { message } : {}),
          ...(destinationNote ? { destination_note: destinationNote } : {}),
        },
        vendor_order_id: uuid(id),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post(':vendor_order_id/interventions/:kind')
  @monitor
  @HttpCode(200)
  async intervene(
    @Param('vendor_order_id') id: string,
    @Param('kind') kind: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    try {
      const amountMinor = optionalInteger(body, 'amount_minor', 1);
      const compensationMinor = optionalInteger(body, 'compensation_minor', 0);
      const assignmentVersion = optionalInteger(body, 'expected_assignment_version', 1);
      const message = optionalString(body, 'message');
      const destinationNote = optionalString(body, 'destination_note');
      return await this.orders.intervene({
        confirm: booleanField(body, 'confirm'),
        context: currentRequestContext(),
        expected_order_version: integerField(body, 'expected_order_version', 1),
        ...(assignmentVersion !== undefined
          ? { expected_assignment_version: assignmentVersion }
          : {}),
        kind,
        params: {
          ...(amountMinor !== undefined ? { amount_minor: amountMinor } : {}),
          ...(compensationMinor !== undefined ? { compensation_minor: compensationMinor } : {}),
          ...(message ? { message } : {}),
          ...(destinationNote ? { destination_note: destinationNote } : {}),
        },
        reason_code: String(body['reason_code'] ?? ''),
        vendor_order_id: uuid(id),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
}
