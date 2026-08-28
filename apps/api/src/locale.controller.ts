import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import {
  LocaleConflictError,
  LocaleNotFoundError,
  LocaleInputError,
  LocaleRegistryService,
  type LocaleAudience,
  type LocaleLanguage,
  type LocaleNamespace,
} from '@neighbourhood-store/database';
import { LOCALE_REGISTRY } from './tokens.js';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';

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
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}
function text(value: Record<string, unknown>, key: string): string {
  const found = value[key];
  if (typeof found !== 'string') throw new BadRequestException();
  return found;
}
function map(error: unknown): never {
  if (error instanceof LocaleInputError) throw new BadRequestException(error.message);
  if (error instanceof LocaleNotFoundError) throw new NotFoundException();
  if (error instanceof LocaleConflictError) throw new BadRequestException(error.message);
  throw error;
}

/**
 * Public, unauthenticated read of the localization bundle so any client can
 * hydrate its label set (including before sign-in). Writes stay admin-only on
 * the LocaleRegistryService; only the bundle read is exposed here. No
 * @RequireAuthorization decorator == public route per the authorization guard.
 */
@Controller('locale')
export class LocaleController {
  constructor(@Inject(LOCALE_REGISTRY) private readonly locales: LocaleRegistryService) {}

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
    const body = record(raw);
    const namespace = text(body, 'namespace');
    const audience = text(body, 'audience');
    if (
      !namespaces.includes(namespace as LocaleNamespace) ||
      !audiences.includes(audience as LocaleAudience)
    )
      throw new BadRequestException();
    try {
      return await this.locales.upsertKey({
        context: currentRequestContext(),
        locale_key: text(body, 'locale_key'),
        namespace: namespace as LocaleNamespace,
        audience: audience as LocaleAudience,
        description: text(body, 'description'),
        ...(body['classification'] === 'RESTRICTED'
          ? { classification: 'RESTRICTED' as const }
          : {}),
      });
    } catch (error) {
      map(error);
    }
  }

  @Post('translations')
  @manageLocale
  async translation(@Body() raw: unknown) {
    const body = record(raw);
    const language = text(body, 'language_code');
    if (!languages.includes(language as LocaleLanguage)) throw new BadRequestException();
    try {
      return await this.locales.setTranslation({
        context: currentRequestContext(),
        locale_key: text(body, 'locale_key'),
        language_code: language as LocaleLanguage,
        translation: text(body, 'translation'),
      });
    } catch (error) {
      map(error);
    }
  }
}
