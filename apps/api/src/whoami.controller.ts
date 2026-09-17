import { createDatabasePool } from '@neighbourhood-store/database';
import {
  Controller,
  Get,
  Inject,
  type OnApplicationShutdown,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { WhoAmI } from '@neighbourhood-store/contracts';
import { Pool } from 'pg';
import { AUTHENTICATED_SESSION, RequireSession, type AuthorizedRequest } from './authorization.js';
import { RUNTIME_CONFIG, type RuntimeConfig } from './runtime-config.js';

/**
 * Returns the marketplace roles + primary email/phone associated with the
 * caller's session. Login pages call this after Supabase sign-in to decide
 * which workspace to redirect the user into (admin / vendor / partner /
 * customer). Session-only — no capability required, since the caller has
 * already proved they are authenticated.
 */
@Controller('auth')
export class WhoAmIController implements OnApplicationShutdown {
  readonly #pool: Pool;
  constructor(@Inject(RUNTIME_CONFIG) config: RuntimeConfig) {
    this.#pool = createDatabasePool({
      application_name: 'neighbourhood-store-whoami',
      connectionString: config.databaseUrl,
      max: 2,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.#pool.end();
  }

  @Get('whoami')
  @RequireSession()
  async whoami(@Req() request: AuthorizedRequest): Promise<WhoAmI> {
    const principal = request[AUTHENTICATED_SESSION];
    if (!principal) throw new UnauthorizedException();
    const userId = principal.user_id;
    const roles = await this.#pool.query<{
      role_key: string;
      role_assignment_id: string;
      scope_id: string | null;
      scope_kind: 'GLOBAL' | 'VENDOR_LOCATION' | 'ZONE' | null;
      vendor_location_id: string | null;
    }>(
      `SELECT ra.role_key, ra.role_assignment_id, sm.vendor_location_id,
              admin_scope.scope_kind, admin_scope.scope_id
         FROM marketplace.role_assignments ra
         LEFT JOIN marketplace.staff_memberships sm
           ON sm.role_assignment_id = ra.role_assignment_id
         LEFT JOIN marketplace.admin_membership_scopes admin_scope
           ON admin_scope.role_assignment_id = ra.role_assignment_id
        WHERE ra.user_id = $1 AND ra.state = 'ACTIVE'
          AND (valid_until IS NULL OR valid_until > NOW())`,
      [userId],
    );
    const email = await this.#pool.query<{ email: string }>(
      'SELECT email FROM marketplace.supabase_identities WHERE user_id = $1',
      [userId],
    );
    const primaryRole = pickPrimaryRole(roles.rows.map((r) => r.role_key));
    const vendorLocationIds = Array.from(
      new Set(
        roles.rows.flatMap((role) =>
          role.vendor_location_id === null ? [] : [role.vendor_location_id],
        ),
      ),
    );
    return {
      user_id: userId,
      session_id: principal.session_id,
      device_registration_id: principal.device_registration_id,
      email: email.rows[0]?.email ?? null,
      roles: roles.rows,
      vendor_location_ids: vendorLocationIds,
      primary_role: primaryRole,
      redirect_hint: redirectFor(primaryRole),
    };
  }
}

const ADMIN_ROLES = new Set([
  'CONFIG_APPROVER',
  'CONFIG_OPERATOR',
  'DELIVERY_OPERATOR',
  'FINANCE_APPROVER',
  'FINANCE_OPERATOR',
  'INCIDENT_COMMANDER',
  'SUPPORT_AGENT',
  'TRUST_APPROVER',
  'TRUST_OPERATOR',
  'VENDOR_ONBOARDING_OPERATOR',
  'VENDOR_ONBOARDING_REVIEWER',
  'CATALOGUE_MODERATOR',
  'VENDOR_PUBLICATION_OPERATOR',
  'VENDOR_PUBLICATION_REVIEWER',
]);
const VENDOR_ROLES = new Set(['VENDOR_OWNER', 'VENDOR_MANAGER', 'VENDOR_PICKER']);
const PARTNER_ROLES = new Set(['DELIVERY_PARTNER']);

type PrimaryRole = 'admin' | 'vendor' | 'partner' | 'customer';

function pickPrimaryRole(roleKeys: readonly string[]): PrimaryRole {
  if (roleKeys.some((r) => ADMIN_ROLES.has(r))) return 'admin';
  if (roleKeys.some((r) => VENDOR_ROLES.has(r))) return 'vendor';
  if (roleKeys.some((r) => PARTNER_ROLES.has(r))) return 'partner';
  return 'customer';
}

function redirectFor(role: PrimaryRole): string {
  switch (role) {
    case 'admin':
      return '/';
    case 'vendor':
      return '/catalogue';
    case 'partner':
      return '/';
    case 'customer':
      return '/';
  }
}
