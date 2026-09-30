import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { AdminControlPlaneService } from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { ADMIN_CONTROL_PLANE } from './tokens.js';
import { optionalWholeQuery, object, stringField, uuid } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
const global = (capability: string) =>
  RequireAuthorization({ capability, admin_scope: { kind: 'GLOBAL' }, conceal_resource: true });
@Controller('admin/control')
export class AdminControlPlaneController {
  constructor(@Inject(ADMIN_CONTROL_PLANE) private readonly control: AdminControlPlaneService) {}
  @Get('dashboard') @global('admin.control.dashboard_read') dashboard() {
    return this.control.dashboard({ context: currentRequestContext() });
  }
  @Get('orders') @global('admin.control.dashboard_read') orders(
    @Query('checkout_group_id') id?: string,
    @Query('stalled_only') stalled?: string,
  ) {
    return this.control.orderMonitor({
      context: currentRequestContext(),
      ...(id ? { checkout_group_id: uuid(id) } : {}),
      ...(stalled === 'true' ? { stalled_only: true } : {}),
    });
  }
  @Get('dead-letters') @global('admin.messaging.deadletter_read') deadLetters(
    @Query('limit') limit?: string,
  ) {
    return this.control.deadLetterQueue({
      context: currentRequestContext(),
      ...(optionalWholeQuery(limit) !== undefined
        ? { limit: optionalWholeQuery(limit) as number }
        : {}),
    });
  }
  @Post('dead-letters/:event_id/recover')
  @global('admin.messaging.deadletter_recover')
  async recoverDeadLetter(@Param('event_id') eventId: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.control.recoverDeadLetter({
        context: currentRequestContext(),
        event_id: uuid(eventId),
        reason_code: stringField(body, 'reason_code'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
  @Get('audit') @global('admin.audit.read') audit(@Query('q') q?: string) {
    return this.control.audit({ context: currentRequestContext(), ...(q ? { query: q } : {}) });
  }
}
