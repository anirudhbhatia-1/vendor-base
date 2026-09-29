import { BadRequestException, Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import {
  LocaleInputError,
  LocaleRegistryService,
  type LocaleAudience,
  type LocaleLanguage,
  type LocaleNamespace,
} from '@neighbourhood-store/database';
import { LOCALE_REGISTRY } from './tokens.js';
import { Public, RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { object, stringField } from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
const languages = ['en', 'hi'] as const;
const audiences = ['CUSTOMER', 'VENDOR', 'PARTNER', 'ADMIN', 'SHARED'] as const;
const namespaces = [
  'customer',
  'vendor',
  'partner',
  'admin',
  'receipt',
  'notification',
  'error',
  'support',
] as const;
/**
 * Public, unauthenticated read of the localization bundle so any client can
 * hydrate its label set (including before sign-in). Writes stay admin-only on
 * the LocaleRegistryService; only the bundle read is exposed here. No
 * @RequireAuthorization decorator == public route per the authorization guard.
 */
@Controller('locale')
export class LocaleController {
  constructor(@Inject(LOCALE_REGISTRY) private readonly locales: LocaleRegistryService) {}

  @Public('Locale strings must load before sign-in, on the sign-in screen itself')
  @Get('bundle')
  async bundle(@Query('language') language?: string, @Query('audience') audience?: string) {
    if (!language || !languages.includes(language as LocaleLanguage))
      throw new BadRequestException('language must be en or hi');
    if (audience !== undefined && !audiences.includes(audience as LocaleAudience))
      throw new BadRequestException('audience is not recognised');
    try {
      const bundle = await this.locales.bundleForLanguage({
        language: language as LocaleLanguage,
        ...(audience !== undefined ? { audience: audience as LocaleAudience } : {}),
      });
      return { language, ...(audience ? { audience } : {}), bundle };
    } catch (error) {
      if (error instanceof LocaleInputError) throw new BadRequestException(error.message);
      throw error;
    }
  }
}

const manageLocale = RequireAuthorization({
  capability: 'admin.locale.manage',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: true,
});

@Controller('admin/locale')
export class AdminLocaleController {
  constructor(@Inject(LOCALE_REGISTRY) private readonly locales: LocaleRegistryService) {}

  @Get('coverage')
  @manageLocale
  coverage() {
    return this.locales.coverage();
  }

  @Post('keys')
  @manageLocale
  async key(@Body() raw: unknown) {
    const body = object(raw);
    const namespace = stringField(body, 'namespace');
    const audience = stringField(body, 'audience');
    if (
      !namespaces.includes(namespace as LocaleNamespace) ||
      !audiences.includes(audience as LocaleAudience)
    )
      throw new BadRequestException();
    try {
      return await this.locales.upsertKey({
        context: currentRequestContext(),
        locale_key: stringField(body, 'locale_key'),
        namespace: namespace as LocaleNamespace,
        audience: audience as LocaleAudience,
        description: stringField(body, 'description'),
        ...(body['classification'] === 'RESTRICTED'
          ? { classification: 'RESTRICTED' as const }
          : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('translations')
  @manageLocale
  async translation(@Body() raw: unknown) {
    const body = object(raw);
    const language = stringField(body, 'language_code');
    if (!languages.includes(language as LocaleLanguage)) throw new BadRequestException();
    try {
      return await this.locales.setTranslation({
        context: currentRequestContext(),
        locale_key: stringField(body, 'locale_key'),
        language_code: language as LocaleLanguage,
        translation: stringField(body, 'translation'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
}
