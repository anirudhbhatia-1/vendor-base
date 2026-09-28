import { releaseServicePool, resolveServicePool } from './database-pool.js';
import {
  parseRequestId,
  parseUuidV7,
  type RequestContext,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';

export class LocaleInputError extends Error {}
export class LocaleNotFoundError extends Error {}
export class LocaleConflictError extends Error {}
export class LocaleAuthorizationError extends Error {}

export type LocaleLanguage = 'en' | 'hi';
export type LocaleNamespace =
  'customer' | 'vendor' | 'partner' | 'admin' | 'receipt' | 'notification' | 'error' | 'support';
export type LocaleAudience = 'ADMIN' | 'CUSTOMER' | 'PARTNER' | 'SHARED' | 'VENDOR';

export interface LocaleKey {
  readonly locale_key: string;
  readonly namespace: LocaleNamespace;
  readonly audience: LocaleAudience;
  readonly description: string;
  readonly classification: 'INTERNAL' | 'RESTRICTED';
}

export interface LocaleEntry {
  readonly locale_key: string;
  readonly language_code: LocaleLanguage;
  readonly translation: string;
}

export interface CoverageReport {
  readonly total_keys: number;
  readonly languages: readonly LocaleLanguage[];
  readonly missing: readonly {
    readonly locale_key: string;
    readonly missing_languages: readonly LocaleLanguage[];
  }[];
}

const localeKeyShape = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const supportedLanguages: readonly LocaleLanguage[] = ['en', 'hi'];

function requireAdmin(context: RequestContext): void {
  if (context.actor?.actor_kind !== 'admin') throw new LocaleAuthorizationError();
}

/**
 * LocaleRegistryService owns the server-side registry of user-visible strings.
 * Server codes stay stable across releases; UIs and receipts render the label
 * for their language via lookup. The verify script asserts that every key has
 * both English and Hindi translations, so a missing translation blocks CI
 * before it reaches a customer.
 */
export class LocaleRegistryService {
  readonly #pool: Pool;

  constructor(input: { readonly connection_string: string; readonly pool?: Pool }) {
    this.#pool = resolveServicePool(input, {
      application_name: 'neighbourhood-store-locale-registry',
      max: 4,
    });
  }

  async close(): Promise<void> {
    await releaseServicePool(this.#pool);
  }

  async listKeys(input: {
    readonly context: RequestContext;
    readonly namespace?: LocaleNamespace;
  }): Promise<readonly LocaleKey[]> {
    // The registry is public within the platform: no-op the actor check for
    // reads so a customer app can hydrate its label bundle.
    const values: unknown[] = [];
    let filter = '';
    if (input.namespace) {
      filter = 'WHERE namespace = $1';
      values.push(input.namespace);
    }
    const result = await this.#pool.query(
      `SELECT locale_key, namespace, audience, description, classification
         FROM marketplace.locale_keys ${filter}
        ORDER BY namespace, locale_key`,
      values,
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          locale_key: row['locale_key'] as string,
          namespace: row['namespace'] as LocaleNamespace,
          audience: row['audience'] as LocaleAudience,
          description: row['description'] as string,
          classification: row['classification'] as 'INTERNAL' | 'RESTRICTED',
        }),
      ),
    );
  }

  /**
   * Returns a { locale_key -> translation } bundle for a single language.
   * The audience filter narrows the bundle to what a given actor should
   * ever see, so a customer never receives admin labels.
   */
  async bundleForLanguage(input: {
    readonly language: LocaleLanguage;
    readonly audience?: LocaleAudience;
  }): Promise<Readonly<Record<string, string>>> {
    if (!supportedLanguages.includes(input.language))
      throw new LocaleInputError('language must be en or hi');
    const values: unknown[] = [input.language];
    let filter = '';
    if (input.audience) {
      filter = "AND (k.audience = $2 OR k.audience = 'SHARED')";
      values.push(input.audience);
    }
    const result = await this.#pool.query(
      `SELECT k.locale_key, t.translation
         FROM marketplace.locale_keys k
         JOIN marketplace.locale_translations t
           ON t.locale_key = k.locale_key AND t.language_code = $1
        WHERE 1=1 ${filter}
        ORDER BY k.locale_key`,
      values,
    );
    const bundle: Record<string, string> = {};
    for (const row of result.rows) {
      bundle[row['locale_key'] as string] = row['translation'] as string;
    }
    return Object.freeze(bundle);
  }

  /**
   * Returns a report of any locale key missing an English or Hindi
   * translation. The verify script fails when this report contains any
   * entries, and the `locale:coverage` CI check calls this from a shell
   * so missing translations block a launch.
   */
  async coverage(): Promise<CoverageReport> {
    const result = await this.#pool.query<{
      locale_key: string;
      languages: string[];
    }>(
      `SELECT k.locale_key,
              COALESCE(array_agg(t.language_code ORDER BY t.language_code)
                       FILTER (WHERE t.language_code IS NOT NULL), '{}') AS languages
         FROM marketplace.locale_keys k
         LEFT JOIN marketplace.locale_translations t ON t.locale_key = k.locale_key
        GROUP BY k.locale_key
        ORDER BY k.locale_key`,
    );
    const missing = result.rows
      .map((row) => {
        const present = new Set(row.languages);
        const missingLanguages = supportedLanguages.filter((code) => !present.has(code));
        return { locale_key: row.locale_key, missing_languages: missingLanguages };
      })
      .filter((row) => row.missing_languages.length > 0);
    return Object.freeze({
      total_keys: result.rows.length,
      languages: supportedLanguages,
      missing: Object.freeze(
        missing.map((row) =>
          Object.freeze({
            locale_key: row.locale_key,
            missing_languages: Object.freeze(row.missing_languages),
          }),
        ),
      ),
    });
  }

  async upsertKey(input: {
    readonly context: RequestContext;
    readonly locale_key: string;
    readonly namespace: LocaleNamespace;
    readonly audience: LocaleAudience;
    readonly description: string;
    readonly classification?: 'INTERNAL' | 'RESTRICTED';
  }): Promise<LocaleKey> {
    requireAdmin(input.context);
    if (!localeKeyShape.test(input.locale_key) || input.locale_key.length > 120)
      throw new LocaleInputError('locale_key must be dotted lowercase.snake_case');
    if (input.description.length < 4 || input.description.length > 240)
      throw new LocaleInputError('description must be between 4 and 240 characters');
    // These are audit fields carried on the caller's request context so a
    // support-agent locale edit lands in the same audit trail as their other
    // control-plane actions.
    parseRequestId(input.context.request_id);
    parseUuidV7(input.context.correlation_id);
    const result = await this.#pool.query(
      `INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description, classification)
       VALUES ($1,$2,$3,$4,COALESCE($5,'INTERNAL'))
       ON CONFLICT (locale_key) DO UPDATE
         SET namespace=EXCLUDED.namespace,
             audience=EXCLUDED.audience,
             description=EXCLUDED.description,
             classification=EXCLUDED.classification,
             updated_at=clock_timestamp()
       RETURNING locale_key, namespace, audience, description, classification`,
      [
        input.locale_key,
        input.namespace,
        input.audience,
        input.description,
        input.classification ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new LocaleConflictError('Locale key was not upserted');
    return Object.freeze({
      locale_key: row['locale_key'] as string,
      namespace: row['namespace'] as LocaleNamespace,
      audience: row['audience'] as LocaleAudience,
      description: row['description'] as string,
      classification: row['classification'] as 'INTERNAL' | 'RESTRICTED',
    });
  }

  async setTranslation(input: {
    readonly context: RequestContext;
    readonly locale_key: string;
    readonly language_code: LocaleLanguage;
    readonly translation: string;
  }): Promise<LocaleEntry> {
    requireAdmin(input.context);
    if (!supportedLanguages.includes(input.language_code))
      throw new LocaleInputError('language_code must be en or hi');
    if (input.translation.length < 1 || input.translation.length > 500)
      throw new LocaleInputError('translation must be between 1 and 500 characters');
    const check = await this.#pool.query(
      `SELECT 1 FROM marketplace.locale_keys WHERE locale_key=$1`,
      [input.locale_key],
    );
    if (!check.rows[0]) throw new LocaleNotFoundError('locale_key is not registered');
    const result = await this.#pool.query(
      `INSERT INTO marketplace.locale_translations (locale_key, language_code, translation)
       VALUES ($1,$2,$3)
       ON CONFLICT (locale_key, language_code) DO UPDATE
         SET translation=EXCLUDED.translation, updated_at=clock_timestamp()
       RETURNING locale_key, language_code, translation`,
      [input.locale_key, input.language_code, input.translation],
    );
    const row = result.rows[0];
    if (!row) throw new LocaleConflictError('translation was not upserted');
    return Object.freeze({
      locale_key: row['locale_key'] as string,
      language_code: row['language_code'] as LocaleLanguage,
      translation: row['translation'] as string,
    });
  }
}
