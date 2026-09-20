import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { LocalNotificationService, NotificationNotFoundError } from '@neighbourhood-store/database';
import { parseUuidV7 } from '@neighbourhood-store/domain-types';
import { RequireSession } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { LOCAL_NOTIFICATIONS } from './tokens.js';

@Controller('notifications')
export class NotificationsController {
  constructor(
    @Inject(LOCAL_NOTIFICATIONS) private readonly notifications: LocalNotificationService,
  ) {}

  @Get()
  @RequireSession()
  async list(@Query('unread_only') unread?: string) {
    // The contract names the list (`notifications`); a bare array left the
    // reference interceptor to wrap it as `data`, and every inbox that read
    // `notifications` off the answer showed nothing, always (audit run 49).
    return {
      notifications: await this.notifications.list({
        context: currentRequestContext(),
        unread_only: unread === 'true',
      }),
    };
  }

  @Post(':in_app_notification_id/read')
  @RequireSession()
  async read(@Param('in_app_notification_id') id: string) {
    try {
      return await this.notifications.markRead({
        context: currentRequestContext(),
        in_app_notification_id: parseUuidV7(id),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      if (error instanceof NotificationNotFoundError) throw new NotFoundException();
      throw error;
    }
  }
}
