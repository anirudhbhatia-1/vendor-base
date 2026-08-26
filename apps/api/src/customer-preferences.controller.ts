import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  IdentityAccessService,
  IdentityPreferencesService,
  PreferenceIdentityError,
  PreferenceInputError,
  PreferenceVersionConflictError,
  RequiredNotificationError,
  type ConsentDecision,
  type ConsentKind,
  type ConsentSource,
  type CustomerLanguage,
  type NotificationChannel,
  type NotificationKind,
} from '@neighbourhood-store/database';
import type { UuidV7 } from '@neighbourhood-store/domain-types';
import {
  AUTHENTICATED_SESSION,
  RequireAuthorization,
  RequireSession,
  type AuthorizedRequest,
} from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { ACCESS_IDENTITY, IDENTITY_PREFERENCES } from './tokens.js';

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string') throw new BadRequestException();
  return value;
}

function versionField(body: Record<string, unknown>): number {
  const value = body.expected_version;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new BadRequestException();
  return value as number;
}

function customerUserId(): UuidV7 {
  const actor = currentRequestContext().actor;
  if (!actor || actor.actor_kind !== 'customer') throw new ForbiddenException();
  return actor.actor_id;
}

function translate(error: unknown): never {
  if (error instanceof PreferenceInputError || error instanceof TypeError) {
    throw new BadRequestException();
  }
  if (error instanceof PreferenceVersionConflictError) throw new ConflictException();
  if (error instanceof RequiredNotificationError) throw new UnprocessableEntityException();
  if (error instanceof PreferenceIdentityError) throw new ForbiddenException();
  throw error;
}

const manageCustomerSettings = RequireAuthorization({
  capability: 'customer.account.manage',
  conceal_resource: false,
});

@Controller('auth/customer')
export class CustomerPreferencesController {
  constructor(
    @Inject(ACCESS_IDENTITY) private readonly access: IdentityAccessService,
    @Inject(IDENTITY_PREFERENCES) private readonly preferences: IdentityPreferencesService,
  ) {}

  @Post('enrol')
  @HttpCode(200)
  @RequireSession()
  async enrol(@Req() request: AuthorizedRequest) {
    const principal = request[AUTHENTICATED_SESSION];
    if (!principal) throw new ForbiddenException();
    const roleAssignmentId = await this.access.grantCustomer({
      context: currentRequestContext(),
      user_id: principal.user_id,
    });
    return { role_assignment_id: roleAssignmentId, role_key: 'CUSTOMER' as const };
  }

  @Get('preferences')
  @RequireAuthorization({ capability: 'customer.account.read', conceal_resource: false })
  async settings() {
    return this.preferences.getSettings(customerUserId());
  }

  @Put('profile')
  @manageCustomerSettings
  async updateProfile(@Body() rawBody: unknown) {
    const body = objectBody(rawBody);
    const displayName = body.display_name;
    if (displayName !== null && typeof displayName !== 'string') throw new BadRequestException();
    try {
      return await this.preferences.updateProfile({
        context: currentRequestContext(),
        display_name: displayName,
        expected_version: versionField(body),
        language: stringField(body, 'language') as CustomerLanguage,
        user_id: customerUserId(),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('consents')
  @manageCustomerSettings
  async recordConsent(@Body() rawBody: unknown) {
    const body = objectBody(rawBody);
    const requestedSource = body.source;
    if (
      requestedSource !== undefined &&
      requestedSource !== 'ANDROID' &&
      requestedSource !== 'CUSTOMER_PWA'
    ) {
      throw new BadRequestException();
    }
    try {
      return await this.preferences.recordConsent({
        consent_kind: stringField(body, 'consent_kind') as ConsentKind,
        context: currentRequestContext(),
        decision: stringField(body, 'decision') as ConsentDecision,
        policy_version: stringField(body, 'policy_version'),
        source: (requestedSource ?? 'CUSTOMER_API') as ConsentSource,
        user_id: customerUserId(),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Put('notifications/:notification_kind/:channel')
  @manageCustomerSettings
  async setNotification(
    @Param('notification_kind') notificationKind: string,
    @Param('channel') channel: string,
    @Body() rawBody: unknown,
  ) {
    const body = objectBody(rawBody);
    if (typeof body.enabled !== 'boolean') throw new BadRequestException();
    try {
      return await this.preferences.setNotificationPreference({
        channel: channel as NotificationChannel,
        context: currentRequestContext(),
        enabled: body.enabled,
        expected_version: versionField(body),
        notification_kind: notificationKind as NotificationKind,
        user_id: customerUserId(),
      });
    } catch (error) {
      translate(error);
    }
  }
}
