import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  Header,
  Inject,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  IdentityPasswordService,
  IdentitySessionService,
  PasswordAuthenticationError,
  PasswordInputError,
  PasswordRateLimitedError,
} from '@neighbourhood-store/database';
import { currentRequestContext } from './request-context-storage.js';
import { IDENTITY_PASSWORD, SESSION_IDENTITY } from './tokens.js';
import { nullableString, object, stringField } from './request-fields.js';
import { Public } from './authorization.js';
@Controller('auth/password')
export class PasswordAuthController {
  constructor(
    @Inject(IDENTITY_PASSWORD) private readonly passwords: IdentityPasswordService,
    @Inject(SESSION_IDENTITY) private readonly sessions: IdentitySessionService,
  ) {}

  @Public('Deprecated password sign-in; removal tracked in native-auth-migration-todo')
  @Post('verify')
  @HttpCode(200)
  @Header('Deprecation', 'true')
  @Header('Warning', '299 - "Deprecated native phone/password authentication endpoint"')
  @Header('Cache-Control', 'no-store')
  async verify(@Body() raw: unknown) {
    const body = object(raw);
    const context = currentRequestContext();
    const platform = stringField(body, 'platform');
    if (platform !== 'WEB' && platform !== 'ANDROID') {
      throw new BadRequestException('platform must be WEB or ANDROID');
    }
    try {
      const userId = await this.passwords.verify({
        context,
        phone_identifier: stringField(body, 'phone_identifier'),
        password: stringField(body, 'password'),
      });
      const tokens = await this.sessions.beginPasswordSession({
        context,
        user_id: userId,
        device_id: stringField(body, 'device_id'),
        platform,
        device_label: nullableString(body, 'device_label'),
        notification_token: nullableString(body, 'notification_token'),
      });
      return { tokens };
    } catch (error) {
      if (error instanceof PasswordInputError) throw new BadRequestException(error.message);
      if (error instanceof PasswordAuthenticationError) throw new UnauthorizedException();
      if (error instanceof PasswordRateLimitedError) {
        throw new HttpException('Too many recent password attempts', 429);
      }
      throw new ServiceUnavailableException();
    }
  }
}
