import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  OtpIdentityService,
  IdentitySessionService,
  type OtpProviderScenario,
} from '@neighbourhood-store/database';
import { currentRequestContext } from './request-context-storage.js';
import { OTP_IDENTITY, SESSION_IDENTITY } from './tokens.js';
import {
  AUTHENTICATED_SESSION,
  RequireAuthorization,
  RequireSession,
  type AuthorizedRequest,
} from './authorization.js';
import { object, stringField } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
function authenticatedSession(request: AuthorizedRequest) {
  const principal = request[AUTHENTICATED_SESSION];
  if (!principal) throw new UnauthorizedException();
  return principal;
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
    const body = object(rawBody);
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
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('otp/verify')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async verify(@Body() rawBody: unknown) {
    const body = object(rawBody);
    if (body.customer_enrolment !== undefined && typeof body.customer_enrolment !== 'boolean')
      throw new BadRequestException();
    try {
      const result = await this.sessions.completeOtpSignIn({
        challenge_id: stringField(body, 'challenge_id'),
        customer_enrolment: body.customer_enrolment === true,
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
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('sessions/refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async refresh(@Body() rawBody: unknown) {
    const body = object(rawBody);
    try {
      return await this.sessions.refresh({
        context: currentRequestContext(),
        refresh_token: stringField(body, 'refresh_token'),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Get('sessions')
  @RequireSession()
  async list(@Req() request: AuthorizedRequest) {
    try {
      return {
        sessions: await this.sessions.listSessionsForPrincipal({
          current: authenticatedSession(request),
        }),
      };
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('sessions/sign-out')
  @RequireSession()
  @HttpCode(200)
  async signOut(@Req() request: AuthorizedRequest) {
    try {
      return await this.sessions.revokeForPrincipal({
        current: authenticatedSession(request),
        context: currentRequestContext(),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Post('sessions/:session_id/revoke')
  @RequireSession()
  @HttpCode(200)
  async revokeOther(@Req() request: AuthorizedRequest, @Param('session_id') sessionId: string) {
    try {
      return await this.sessions.revokeForPrincipal({
        current: authenticatedSession(request),
        context: currentRequestContext(),
        target_session_id: sessionId,
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }

  @Put('devices/current/notification-token')
  @RequireSession()
  async updateNotification(@Req() request: AuthorizedRequest, @Body() rawBody: unknown) {
    const body = object(rawBody);
    const notificationToken = body.notification_token;
    if (notificationToken !== null && typeof notificationToken !== 'string') {
      throw new BadRequestException();
    }
    try {
      return await this.sessions.updateNotificationTokenForPrincipal({
        current: authenticatedSession(request),
        notification_token: notificationToken,
      });
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException();
      translateDomainError(error);
    }
  }
}
