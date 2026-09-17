import { createDatabasePool } from '@neighbourhood-store/database';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { Pool } from 'pg';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';

export interface SupabasePrincipal {
  readonly external_session_id: string;
  readonly user_id: UuidV7; // marketplace user id
  readonly supabase_user_id: string;
  readonly email: string;
}

class SupabaseAuthConfigurationError extends Error {}
export class SupabaseAuthInvalidTokenError extends Error {}

/**
 * Verifies Supabase-issued JWTs and maps them to marketplace users via
 * marketplace.supabase_identities. Identity creation is deliberately excluded:
 * only an audited admin-provisioning command may link a Supabase user.
 */
@Injectable()
export class SupabaseAuthService implements OnApplicationShutdown {
  readonly #supabaseUrl: string | undefined;
  readonly #issuer: string | undefined;
  readonly #jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  readonly #pool: Pool | undefined;

  constructor(input: {
    readonly supabase_url: string | undefined;
    readonly database_url: string | undefined;
  }) {
    if (!input.supabase_url || !input.database_url) {
      // Supabase auth is optional at boot; leave the service inert so the API
      // still starts in local/synthetic mode. Attempts to verify will throw.
      this.#supabaseUrl = undefined;
      this.#issuer = undefined;
      this.#jwks = undefined;
      this.#pool = undefined;
      return;
    }
    this.#supabaseUrl = input.supabase_url;
    this.#issuer = `${input.supabase_url.replace(/\/$/, '')}/auth/v1`;
    this.#jwks = createRemoteJWKSet(new URL(`${this.#issuer}/.well-known/jwks.json`));
    this.#pool = createDatabasePool({
      application_name: 'neighbourhood-store-supabase-auth',
      connectionString: input.database_url,
      max: 4,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.#pool) await this.#pool.end();
  }

  isConfigured(): boolean {
    return !!this.#jwks;
  }

  /**
   * Verify a Supabase-issued JWT and resolve it to a provisioned marketplace user.
   */
  async verify(token: string): Promise<SupabasePrincipal> {
    if (!this.#jwks || !this.#pool || !this.#issuer) {
      throw new SupabaseAuthConfigurationError('Supabase auth is not configured on this API');
    }
    let payload: JWTPayload;
    try {
      const result = await jwtVerify(token, this.#jwks, {
        issuer: this.#issuer,
        audience: 'authenticated',
      });
      payload = result.payload;
    } catch {
      throw new SupabaseAuthInvalidTokenError('Supabase JWT verification failed');
    }
    const supabaseUserId = typeof payload.sub === 'string' ? payload.sub : undefined;
    const externalSessionId =
      typeof payload.session_id === 'string' ? payload.session_id : undefined;
    const email =
      typeof (payload as { email?: unknown }).email === 'string'
        ? (payload as { email: string }).email
        : undefined;
    if (!supabaseUserId || !email || !externalSessionId) {
      throw new SupabaseAuthInvalidTokenError('Supabase JWT missing sub, email, or session_id');
    }
    const client = await this.#pool.connect();
    try {
      const existing = await client.query<{ user_id: string }>(
        'SELECT user_id FROM marketplace.supabase_identities WHERE supabase_user_id = $1',
        [supabaseUserId],
      );
      if (existing.rows[0]) {
        return Object.freeze({
          external_session_id: externalSessionId,
          user_id: parseUuidV7(existing.rows[0].user_id),
          supabase_user_id: supabaseUserId,
          email,
        });
      }
      throw new SupabaseAuthInvalidTokenError('Supabase identity is not provisioned');
    } finally {
      client.release();
    }
  }

  get supabaseUrl(): string | undefined {
    return this.#supabaseUrl;
  }
}
