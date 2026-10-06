import { createDatabasePool } from '@neighbourhood-store/database';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  type OnApplicationShutdown,
  Param,
  Post,
  Headers,
} from '@nestjs/common';
import {
  AdminOnboardingConflictError,
  AdminOnboardingService,
  canonicalRequestHash,
  IdempotencyKeyReusedError,
} from '@neighbourhood-store/database';
import { createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { ADMIN_ONBOARDING } from './tokens.js';
import { RUNTIME_CONFIG, type RuntimeConfig } from './runtime-config.js';
import {
  uuid,
  numberField,
  object,
  optionalNumber,
  optionalString,
  optionalStrings,
  stringField,
} from './request-fields.js';
import { translateDomainError } from './domain-errors.js';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:-]{8,200}$/;

type ResourceKind = 'PARTNER' | 'VENDOR';
type ProvisioningState =
  'AUTH_CREATED' | 'COMPLETED' | 'COMPENSATED' | 'PENDING' | 'RECONCILIATION_REQUIRED';

type ProvisioningRow = {
  readonly command_id: string;
  readonly request_hash: string;
  readonly state: ProvisioningState;
  readonly supabase_user_id: string | null;
  readonly result_body: Record<string, unknown> | null;
};

type VendorProvisioningResponse = {
  readonly email: string;
  readonly password_set: true;
  readonly role_assignment_id: string;
  readonly supabase_user_id: string;
  readonly user_id: string;
  readonly vendor_id: string;
  readonly vendor_location_id: string;
};

type PartnerProvisioningResponse = {
  readonly email: string;
  readonly password_set: true;
  readonly role_assignment_id: string;
  readonly supabase_user_id: string;
  readonly user_id: string;
};

const provisionVendor = RequireAuthorization({
  capability: 'admin.onboarding.vendor.provision',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: false,
});
const provisionPartner = RequireAuthorization({
  capability: 'admin.onboarding.partner.provision',
  admin_scope: { kind: 'GLOBAL' },
  conceal_resource: false,
});

/** Field-error codes this controller declares (registered by 0125). */
const FIELD_REJECTION = { PASSWORD: 'PASSWORD_REJECTED', EMAIL: 'EMAIL_REJECTED' } as const;

@Controller('admin/onboarding')
export class AdminOnboardingController implements OnApplicationShutdown {
  readonly #pool: Pool;
  readonly #supabaseAdmin: SupabaseClient | null;
  constructor(
    @Inject(ADMIN_ONBOARDING) private readonly onboarding: AdminOnboardingService,
    @Inject(RUNTIME_CONFIG) config: RuntimeConfig,
  ) {
    this.#pool = createDatabasePool({
      application_name: 'neighbourhood-store-admin-provisioning',
      connectionString: config.databaseUrl,
      max: 4,
    });
    this.#supabaseAdmin =
      config.supabaseUrl && config.supabaseServiceRoleKey
        ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
          })
        : null;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.#pool.end();
  }

  async #reserveCommand(input: {
    readonly actor_user_id: UuidV7;
    readonly body: Record<string, unknown>;
    readonly command_scope: string;
    readonly correlation_id: UuidV7;
    readonly email: string;
    readonly idempotency_key: string;
    readonly request_id: string;
    readonly resource_kind: ResourceKind;
  }): Promise<ProvisioningRow> {
    if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotency_key)) {
      throw new BadRequestException('Idempotency-Key must contain 8-200 safe opaque characters');
    }
    const requestHash = canonicalRequestHash(input.body);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const commandId = createUuidV7();
      await client.query(
        `INSERT INTO marketplace.admin_provisioning_commands
           (command_id, actor_user_id, command_scope, idempotency_key, request_hash,
            resource_kind, email, request_id, correlation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (actor_user_id, command_scope, idempotency_key) DO NOTHING`,
        [
          commandId,
          input.actor_user_id,
          input.command_scope,
          input.idempotency_key,
          requestHash,
          input.resource_kind,
          input.email,
          input.request_id,
          input.correlation_id,
        ],
      );
      const result = await client.query<ProvisioningRow>(
        `SELECT command_id, request_hash, state, supabase_user_id, result_body
           FROM marketplace.admin_provisioning_commands
          WHERE actor_user_id=$1 AND command_scope=$2 AND idempotency_key=$3
          FOR UPDATE`,
        [input.actor_user_id, input.command_scope, input.idempotency_key],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Provisioning command could not be reserved');
      if (row.request_hash !== requestHash) throw new IdempotencyKeyReusedError();
      if (row.state === 'COMPENSATED') {
        throw new AdminOnboardingConflictError('The previous provisioning attempt was compensated');
      }
      if (row.state === 'RECONCILIATION_REQUIRED') {
        throw new AdminOnboardingConflictError(
          'Provisioning requires administrator reconciliation',
        );
      }
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async #findSupabaseUserByEmail(email: string) {
    if (!this.#supabaseAdmin) return null;
    for (let page = 1; ; page += 1) {
      const list = await this.#supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (list.error) throw new BadRequestException(list.error.message);
      const found = list.data.users.find(
        (user) => user.email?.toLowerCase() === email.toLowerCase(),
      );
      if (found) return found;
      if (list.data.users.length < 200) return null;
    }
  }

  async #ensureSupabaseUser(input: {
    readonly command: ProvisioningRow;
    readonly email: string;
    readonly password: string;
  }): Promise<string> {
    if (!this.#supabaseAdmin) {
      throw new BadRequestException(
        'Supabase Auth is not configured on this API. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      );
    }
    if (input.password.length < 8)
      throw new BadRequestException({
        message: 'password must be at least 8 chars',
        field_errors: [{ field: 'password', code: FIELD_REJECTION.PASSWORD }],
      });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
      throw new BadRequestException({
        message: 'email is invalid',
        field_errors: [{ field: 'email', code: FIELD_REJECTION.EMAIL }],
      });
    if (input.command.supabase_user_id) return input.command.supabase_user_id;
    const created = await this.#supabaseAdmin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      app_metadata: { provisioning_command_id: input.command.command_id },
    });
    let supabaseUserId: string;
    if (created.error) {
      if (/already|registered|exists/i.test(created.error.message)) {
        const found = await this.#findSupabaseUserByEmail(input.email);
        if (found?.app_metadata['provisioning_command_id'] === input.command.command_id) {
          supabaseUserId = found.id;
        } else {
          throw new AdminOnboardingConflictError('An account already exists for this email');
        }
      } else {
        // The sign-in provider's own rules (its password policy, its email
        // checks) refuse here; the operator is told which field, and the
        // provider's wording goes to the log.
        const field = /password/i.test(created.error.message) ? 'password' : 'email';
        throw new BadRequestException({
          message: `sign-in provider refused: ${created.error.message}`,
          field_errors: [
            {
              field,
              code: field === 'password' ? FIELD_REJECTION.PASSWORD : FIELD_REJECTION.EMAIL,
            },
          ],
        });
      }
    } else {
      supabaseUserId = created.data.user.id;
    }
    await this.#pool.query(
      `UPDATE marketplace.admin_provisioning_commands
          SET state='AUTH_CREATED', supabase_user_id=$2, updated_at=clock_timestamp()
        WHERE command_id=$1 AND state IN ('PENDING','AUTH_CREATED')`,
      [input.command.command_id, supabaseUserId],
    );
    return supabaseUserId;
  }

  async #completeCommand(
    commandId: string,
    result: VendorProvisioningResponse | PartnerProvisioningResponse,
  ): Promise<void> {
    await this.#pool.query(
      `UPDATE marketplace.admin_provisioning_commands
          SET state='COMPLETED', result_body=$2::jsonb, error_code=NULL,
              updated_at=clock_timestamp()
        WHERE command_id=$1 AND state IN ('PENDING','AUTH_CREATED','COMPLETED')`,
      [commandId, JSON.stringify(result)],
    );
  }

  async #compensate(commandId: string, supabaseUserId: string): Promise<void> {
    if (!this.#supabaseAdmin) return;
    const removed = await this.#supabaseAdmin.auth.admin.deleteUser(supabaseUserId);
    await this.#pool.query(
      `UPDATE marketplace.admin_provisioning_commands
          SET state=$2, error_code=$3, updated_at=clock_timestamp()
        WHERE command_id=$1 AND state <> 'COMPLETED'`,
      [
        commandId,
        removed.error ? 'RECONCILIATION_REQUIRED' : 'COMPENSATED',
        removed.error ? 'SUPABASE_COMPENSATION_FAILED' : 'MARKETPLACE_PROVISIONING_FAILED',
      ],
    );
  }

  async #recoverVendor(
    supabaseUserId: string,
    email: string,
  ): Promise<VendorProvisioningResponse | null> {
    const result = await this.#pool.query<{
      role_assignment_id: string;
      user_id: string;
      vendor_id: string;
      vendor_location_id: string;
    }>(
      `SELECT si.user_id, ra.role_assignment_id, sm.vendor_location_id, vl.vendor_id
         FROM marketplace.supabase_identities si
         JOIN marketplace.role_assignments ra
           ON ra.user_id=si.user_id AND ra.role_key='VENDOR_OWNER' AND ra.state='ACTIVE'
         JOIN marketplace.staff_memberships sm USING (role_assignment_id)
         JOIN marketplace.vendor_locations vl USING (vendor_location_id)
        WHERE si.supabase_user_id=$1
        ORDER BY ra.created_at DESC LIMIT 1`,
      [supabaseUserId],
    );
    const row = result.rows[0];
    return row
      ? Object.freeze({ ...row, email, password_set: true, supabase_user_id: supabaseUserId })
      : null;
  }

  async #recoverPartner(
    supabaseUserId: string,
    email: string,
  ): Promise<PartnerProvisioningResponse | null> {
    const result = await this.#pool.query<{ role_assignment_id: string; user_id: string }>(
      `SELECT si.user_id, ra.role_assignment_id
         FROM marketplace.supabase_identities si
         JOIN marketplace.role_assignments ra
           ON ra.user_id=si.user_id AND ra.role_key='DELIVERY_PARTNER' AND ra.state='ACTIVE'
        WHERE si.supabase_user_id=$1
        ORDER BY ra.created_at DESC LIMIT 1`,
      [supabaseUserId],
    );
    const row = result.rows[0];
    return row
      ? Object.freeze({ ...row, email, password_set: true, supabase_user_id: supabaseUserId })
      : null;
  }

  @Get('vendors')
  @provisionVendor
  async listVendors() {
    const result = await this.#pool.query<{
      business_name: string;
      email: string;
      lifecycle_state: string;
      location_name: string;
      user_id: string;
      vendor_id: string;
      vendor_location_id: string;
      version: number;
    }>(
      `SELECT DISTINCT ON (v.vendor_id)
          v.vendor_id,v.business_name,v.lifecycle_state,v.version,
          vl.vendor_location_id,vl.location_name,ra.user_id,si.email
         FROM marketplace.vendors v
         JOIN marketplace.vendor_locations vl USING (vendor_id)
         JOIN marketplace.staff_memberships sm USING (vendor_location_id)
         JOIN marketplace.role_assignments ra USING (role_assignment_id)
         JOIN marketplace.supabase_identities si ON si.user_id=ra.user_id
        WHERE ra.role_key='VENDOR_OWNER'
        ORDER BY v.vendor_id,ra.created_at DESC`,
    );
    return { items: result.rows };
  }

  @Get('partners')
  @provisionPartner
  async listPartners() {
    const result = await this.#pool.query<{
      email: string;
      lifecycle_state: string;
      user_id: string;
      version: number;
    }>(
      `SELECT pe.user_id,si.email,pe.state AS lifecycle_state,pe.version
         FROM marketplace.partner_eligibilities pe
         JOIN marketplace.supabase_identities si USING (user_id)
        ORDER BY pe.updated_at DESC,pe.user_id`,
    );
    return { items: result.rows };
  }

  @Post('vendors/:vendor_id/suspend')
  @provisionVendor
  async suspendVendor(@Param('vendor_id') vendorId: string, @Body() raw: unknown) {
    const body = object(raw);
    const context = currentRequestContext();
    if (context.actor?.actor_kind !== 'admin') throw new ForbiddenException();
    try {
      return await this.onboarding.suspendVendor({
        actor_user_id: context.actor.actor_id,
        context,
        expected_version: numberField(body, 'expected_version'),
        reason_code: stringField(body, 'reason_code'),
        vendor_id: uuid(vendorId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('vendors/:vendor_id/reinstate')
  @provisionVendor
  async reinstateVendor(@Param('vendor_id') vendorId: string, @Body() raw: unknown) {
    const body = object(raw);
    const context = currentRequestContext();
    if (context.actor?.actor_kind !== 'admin') throw new ForbiddenException();
    try {
      return await this.onboarding.reinstateVendor({
        actor_user_id: context.actor.actor_id,
        context,
        expected_version: numberField(body, 'expected_version'),
        reason_code: stringField(body, 'reason_code'),
        vendor_id: uuid(vendorId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('partners/:user_id/suspend')
  @provisionPartner
  async suspendPartner(@Param('user_id') userId: string, @Body() raw: unknown) {
    const body = object(raw);
    const context = currentRequestContext();
    if (context.actor?.actor_kind !== 'admin') throw new ForbiddenException();
    try {
      return await this.onboarding.suspendPartner({
        actor_user_id: context.actor.actor_id,
        context,
        expected_version: numberField(body, 'expected_version'),
        reason_code: stringField(body, 'reason_code'),
        user_id: uuid(userId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('partners/:user_id/reinstate')
  @provisionPartner
  async reinstatePartner(@Param('user_id') userId: string, @Body() raw: unknown) {
    const body = object(raw);
    const context = currentRequestContext();
    if (context.actor?.actor_kind !== 'admin') throw new ForbiddenException();
    try {
      return await this.onboarding.reinstatePartner({
        actor_user_id: context.actor.actor_id,
        context,
        expected_version: numberField(body, 'expected_version'),
        reason_code: stringField(body, 'reason_code'),
        user_id: uuid(userId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('vendors')
  @provisionVendor
  @HttpCode(201)
  async createVendor(
    @Body() raw: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const body = object(raw);
    const context = currentRequestContext();
    if (context.actor?.actor_kind !== 'admin') throw new ForbiddenException();
    const email = optionalString(body, 'email');
    try {
      const modes = optionalStrings(body, 'fulfilment_modes');
      const validModes = ['CUSTOMER_PICKUP', 'PLATFORM_DELIVERY', 'VENDOR_DELIVERY'] as const;
      const fulfilment = modes?.map((mode) => {
        if (!validModes.includes(mode as (typeof validModes)[number])) {
          throw new BadRequestException(`fulfilment_modes contains invalid mode "${mode}"`);
        }
        return mode as (typeof validModes)[number];
      });

      // Path A: Supabase Auth (email + password).
      if (email) {
        const password = stringField(body, 'password');
        const command = await this.#reserveCommand({
          actor_user_id: context.actor.actor_id,
          body,
          command_scope: 'admin.onboarding.vendor.provision',
          correlation_id: context.correlation_id,
          email,
          idempotency_key: idempotencyKey ?? '',
          request_id: context.request_id,
          resource_kind: 'VENDOR',
        });
        if (command.state === 'COMPLETED' && command.result_body) {
          return command.result_body as VendorProvisioningResponse;
        }
        const supabaseUserId = await this.#ensureSupabaseUser({ command, email, password });
        const recovered = await this.#recoverVendor(supabaseUserId, email);
        if (recovered) {
          await this.#completeCommand(command.command_id, recovered);
          return recovered;
        }
        try {
          const result = await this.onboarding.provisionVendorFromSupabase({
            context,
            actor_user_id: context.actor.actor_id,
            supabase_user_id: supabaseUserId,
            email,
            business_name: stringField(body, 'business_name'),
            location_name: stringField(body, 'location_name'),
            ...(optionalString(body, 'profile_description') !== undefined
              ? { profile_description: optionalString(body, 'profile_description') as string }
              : {}),
            ...(optionalString(body, 'category') !== undefined
              ? { category: optionalString(body, 'category') as string }
              : {}),
            ...(optionalString(body, 'timezone') !== undefined
              ? { timezone: optionalString(body, 'timezone') as string }
              : {}),
            latitude: numberField(body, 'latitude'),
            longitude: numberField(body, 'longitude'),
            ...(optionalNumber(body, 'minimum_order_minor') !== undefined
              ? { minimum_order_minor: optionalNumber(body, 'minimum_order_minor') as number }
              : {}),
            ...(fulfilment ? { fulfilment_modes: fulfilment } : {}),
          });
          const response: VendorProvisioningResponse = {
            user_id: result.user_id,
            vendor_id: result.vendor_id,
            vendor_location_id: result.vendor_location_id,
            role_assignment_id: result.role_assignment_id,
            supabase_user_id: supabaseUserId,
            email,
            password_set: true,
          };
          await this.#completeCommand(command.command_id, response);
          return response;
        } catch (error) {
          const committed = await this.#recoverVendor(supabaseUserId, email);
          if (committed) {
            await this.#completeCommand(command.command_id, committed);
            return committed;
          }
          await this.#compensate(command.command_id, supabaseUserId);
          throw error;
        }
      }

      // Path B: legacy phone-based provisioning.
      const result = await this.onboarding.provisionVendor({
        context,
        actor_user_id: context.actor.actor_id,
        phone_identifier: stringField(body, 'phone_identifier'),
        business_name: stringField(body, 'business_name'),
        location_name: stringField(body, 'location_name'),
        ...(optionalString(body, 'profile_description') !== undefined
          ? { profile_description: optionalString(body, 'profile_description') as string }
          : {}),
        ...(optionalString(body, 'category') !== undefined
          ? { category: optionalString(body, 'category') as string }
          : {}),
        ...(optionalString(body, 'timezone') !== undefined
          ? { timezone: optionalString(body, 'timezone') as string }
          : {}),
        latitude: numberField(body, 'latitude'),
        longitude: numberField(body, 'longitude'),
        ...(optionalNumber(body, 'minimum_order_minor') !== undefined
          ? { minimum_order_minor: optionalNumber(body, 'minimum_order_minor') as number }
          : {}),
        ...(fulfilment ? { fulfilment_modes: fulfilment } : {}),
        ...(optionalString(body, 'password') !== undefined
          ? { password: optionalString(body, 'password') as string }
          : {}),
      });
      return {
        user_id: result.user_id,
        vendor_id: result.vendor_id,
        vendor_location_id: result.vendor_location_id,
        role_assignment_id: result.role_assignment_id,
        password_set: result.password_set,
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post('partners')
  @provisionPartner
  @HttpCode(201)
  async createPartner(
    @Body() raw: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const body = object(raw);
    const context = currentRequestContext();
    if (context.actor?.actor_kind !== 'admin') throw new ForbiddenException();
    const email = optionalString(body, 'email');
    try {
      if (email) {
        const password = stringField(body, 'password');
        const command = await this.#reserveCommand({
          actor_user_id: context.actor.actor_id,
          body,
          command_scope: 'admin.onboarding.partner.provision',
          correlation_id: context.correlation_id,
          email,
          idempotency_key: idempotencyKey ?? '',
          request_id: context.request_id,
          resource_kind: 'PARTNER',
        });
        if (command.state === 'COMPLETED' && command.result_body) {
          return command.result_body as PartnerProvisioningResponse;
        }
        const supabaseUserId = await this.#ensureSupabaseUser({ command, email, password });
        const recovered = await this.#recoverPartner(supabaseUserId, email);
        if (recovered) {
          await this.#completeCommand(command.command_id, recovered);
          return recovered;
        }
        try {
          const result = await this.onboarding.provisionPartnerFromSupabase({
            context,
            actor_user_id: context.actor.actor_id,
            supabase_user_id: supabaseUserId,
            email,
            display_name: stringField(body, 'display_name'),
          });
          const response: PartnerProvisioningResponse = {
            user_id: result.user_id,
            role_assignment_id: result.role_assignment_id,
            supabase_user_id: supabaseUserId,
            email,
            password_set: true,
          };
          await this.#completeCommand(command.command_id, response);
          return response;
        } catch (error) {
          const committed = await this.#recoverPartner(supabaseUserId, email);
          if (committed) {
            await this.#completeCommand(command.command_id, committed);
            return committed;
          }
          await this.#compensate(command.command_id, supabaseUserId);
          throw error;
        }
      }
      const result = await this.onboarding.provisionPartner({
        context,
        actor_user_id: context.actor.actor_id,
        phone_identifier: stringField(body, 'phone_identifier'),
        display_name: stringField(body, 'display_name'),
        ...(optionalString(body, 'password') !== undefined
          ? { password: optionalString(body, 'password') as string }
          : {}),
      });
      return {
        user_id: result.user_id,
        role_assignment_id: result.role_assignment_id,
        password_set: result.password_set,
      };
    } catch (error) {
      translateDomainError(error);
    }
  }
}
