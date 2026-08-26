import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  OtpIdentityService,
  OtpInvalidError,
  OtpRateLimitedError,
  OtpUnavailableError,
  OtpVerificationRejectedError,
  IdentitySessionService,
  SessionForbiddenError,
  SessionInputError,
  SessionInvalidError,
  SessionReplayDetectedError,
  type OtpProviderScenario,
} from '@neighbourhood-store/database';
import { currentRequestContext } from './request-context-storage.js';
import { OTP_IDENTITY, SESSION_IDENTITY } from './tokens.js';
import { RequireAuthorization } from './authorization.js';

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException();
  }
  return value as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string') throw new BadRequestException();
  return value;
}

function translate(error: unknown): never {
  if (error instanceof OtpRateLimitedError) throw new HttpException('Rate limited', 429);
  if (error instanceof OtpUnavailableError) throw new ServiceUnavailableException();
  if (error instanceof OtpVerificationRejectedError) throw new UnauthorizedException();
  if (error instanceof SessionInvalidError || error instanceof SessionReplayDetectedError) {
    throw new UnauthorizedException();
  }
  if (error instanceof SessionForbiddenError) throw new ForbiddenException();
  if (error instanceof SessionInputError) throw new BadRequestException();
  if (error instanceof OtpInvalidError || error instanceof TypeError) {
    throw new BadRequestException();
  }
  throw error;
}

function bearerToken(value: string | undefined): string {
  const match = /^Bearer (nsa_[A-Za-z0-9_-]{43})$/.exec(value ?? '');
  if (!match?.[1]) throw new UnauthorizedException();
  return match[1];
}

@Controller('auth')
export class OtpController {
  constructor(
    @Inject(OTP_IDENTITY) private readonly identity: OtpIdentityService,
    @Inject(SESSION_IDENTITY) private readonly sessions: IdentitySessionService,
  ) {}

  @Get('customer/me')
  @RequireAuthorization({
    capability: 'customer.account.read',
    conceal_resource: false,
  })
  customerIdentity() {
    const actor = currentRequestContext().actor;
    if (!actor) throw new UnauthorizedException();
    return { actor_kind: actor.actor_kind, user_id: actor.actor_id };
  }

  @Post('otp/request')
  @HttpCode(202)
  async request(@Body() rawBody: unknown) {
    const body = objectBody(rawBody);
    const scenario = body.test_scenario;
    if (
      scenario !== undefined &&
      scenario !== 'success' &&
      scenario !== 'failure' &&
      scenario !== 'delay' &&
      scenario !== 'duplicate_callback'
    ) {
      throw new BadRequestException();
    }
    try {
      const result = await this.identity.requestChallenge({
        context: currentRequestContext(),
        device_id: stringField(body, 'device_id'),
        phone_identifier: stringField(body, 'phone_identifier'),
        request_key: stringField(body, 'request_key'),
        ...(scenario ? { scenario: scenario as OtpProviderScenario } : {}),
      });
      return {
        challenge_id: result.challenge_id,
        expires_at: result.expires_at,
        replayed: result.replayed,
        status: result.status.toLowerCase(),
      };
    } catch (error) {
      translate(error);
    }
  }

  @Post('otp/verify')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async verify(@Body() rawBody: unknown) {
    const body = objectBody(rawBody);
    try {
      const result = await this.sessions.completeOtpSignIn({
        challenge_id: stringField(body, 'challenge_id'),
        code: stringField(body, 'code'),
        context: currentRequestContext(),
        device_id: stringField(body, 'device_id'),
        device_label: typeof body.device_label === 'string' ? body.device_label : null,
        notification_token:
          typeof body.notification_token === 'string' ? body.notification_token : null,
        platform: body.platform === 'ANDROID' ? 'ANDROID' : 'WEB',
      });
      return result;
    } catch (error) {
      translate(error);
    }
  }

  @Post('sessions/refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async refresh(@Body() rawBody: unknown) {
    const body = objectBody(rawBody);
    try {
      return await this.sessions.refresh({
        context: currentRequestContext(),
        refresh_token: stringField(body, 'refresh_token'),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Get('sessions')
  async list(@Headers('authorization') authorization: string | undefined) {
    try {
      return {
        sessions: await this.sessions.listSessions({
          access_token: bearerToken(authorization),
          context: currentRequestContext(),
        }),
      };
    } catch (error) {
      translate(error);
    }
  }

  @Post('sessions/sign-out')
  @HttpCode(200)
  async signOut(@Headers('authorization') authorization: string | undefined) {
    try {
      return await this.sessions.revoke({
        access_token: bearerToken(authorization),
        context: currentRequestContext(),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post('sessions/:session_id/revoke')
  @HttpCode(200)
  async revokeOther(
    @Headers('authorization') authorization: string | undefined,
    @Param('session_id') sessionId: string,
  ) {
    try {
      return await this.sessions.revoke({
        access_token: bearerToken(authorization),
        context: currentRequestContext(),
        target_session_id: sessionId,
      });
    } catch (error) {
      translate(error);
    }
  }

  @Put('devices/current/notification-token')
  async updateNotification(
    @Headers('authorization') authorization: string | undefined,
    @Body() rawBody: unknown,
  ) {
    const body = objectBody(rawBody);
    const notificationToken = body.notification_token;
    if (notificationToken !== null && typeof notificationToken !== 'string') {
      throw new BadRequestException();
    }
    try {
      return await this.sessions.updateNotificationToken({
        access_token: bearerToken(authorization),
        context: currentRequestContext(),
        notification_token: notificationToken,
      });
    } catch (error) {
      translate(error);
    }
  }
}
