import { createRequestContext, createUuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  IdentitySessionService,
  SessionForbiddenError,
  SessionInvalidError,
  SessionReplayDetectedError,
  type SessionTokens,
} from '../src/identity-sessions.js';
import { OtpIdentityService } from '../src/otp-identity.js';

function context() {
  return createRequestContext();
}

async function rejectsWith(
  operation: () => Promise<unknown>,
  expected: new (...args: never[]) => Error,
) {
  try {
    await operation();
  } catch (error) {
    if (error instanceof expected) return;
    throw error;
  }
  throw new Error(`Expected ${expected.name}`);
}

async function signIn(input: {
  readonly deviceId: string;
  readonly now: Date;
  readonly otp: OtpIdentityService;
  readonly phone: string;
  readonly requestKey: string;
  readonly sessions: IdentitySessionService;
}): Promise<SessionTokens & { readonly code: string; readonly challenge_id: string }> {
  const challenge = await input.otp.requestChallenge({
    context: context(),
    device_id: input.deviceId,
    phone_identifier: input.phone,
    request_key: input.requestKey,
    now: input.now,
  });
  const code = await input.otp.readSyntheticOtpForTest(challenge.challenge_id);
  const result = await input.sessions.completeOtpSignIn({
    challenge_id: challenge.challenge_id,
    code,
    context: context(),
    device_id: input.deviceId,
    device_label: 'Synthetic test browser',
    notification_token: 'SYNTHETIC_NOTIFICATION_TOKEN_0001',
    now: new Date(input.now.getTime() + 1_000),
    platform: 'WEB',
  });
  if (!result.tokens) throw new Error('Fresh OTP verification did not issue a session');
  return Object.freeze({ ...result.tokens, challenge_id: challenge.challenge_id, code });
}

export async function verifyIdentitySessions(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, application_name: 'identity-session-verifier' });
  const otp = new OtpIdentityService({
    connection_string: connectionString,
    hash_key: ['phase', 'four', 'local', 'synthetic', 'hash', 'material'].join('-'),
  });
  const sessions = new IdentitySessionService({
    connection_string: connectionString,
    otp_service: otp,
    token_hash_key: ['phase', 'four', 'session', 'token', 'hash', 'material'].join('-'),
  });
  const base = new Date();
  try {
    await pool.query(
      `TRUNCATE marketplace.customer_address_events, marketplace.customer_addresses,
    marketplace.finance_exceptions, marketplace.provider_statement_rows,
        marketplace.payouts, marketplace.settlements, marketplace.ledger_entries,
        marketplace.ledger_transactions, marketplace.refund_events, marketplace.refunds,
        marketplace.payment_events, marketplace.payment_allocations, marketplace.payment_transactions,
        marketplace.return_tasks, marketplace.custody_events,
        marketplace.assignment_events, marketplace.delivery_assignments,
        marketplace.notification_preference_events,
        marketplace.notification_preferences, marketplace.consents,
        marketplace.customer_profiles,
        marketplace.access_membership_events,
        marketplace.admin_membership_scopes, marketplace.partner_assignment_memberships,
        marketplace.partner_eligibilities, marketplace.staff_memberships,
        marketplace.role_assignments,
        marketplace.catalogue_moderation_events, marketplace.catalogue_moderation_cases,
        marketplace.catalogue_product_substitutions, marketplace.catalogue_product_images,
        marketplace.catalogue_prices, marketplace.catalogue_product_variants,
        marketplace.catalogue_import_rows, marketplace.catalogue_imports, marketplace.catalogue_products,
        marketplace.inventory_events, marketplace.inventory_reservations, marketplace.inventory_items,
        marketplace.vendor_publication_events, marketplace.vendor_publication_cases,
        marketplace.vendor_onboarding_events,
        marketplace.vendor_onboarding_appeals,
        marketplace.vendor_document_reviews,
        marketplace.vendor_verification_documents,
        marketplace.vendor_onboarding_cases,
        marketplace.vendor_network_events,
        marketplace.vendor_location_fulfilment_modes,
        marketplace.vendor_service_zones,
        marketplace.vendor_location_temporary_closures,
        marketplace.vendor_location_calendar_exceptions,
        marketplace.vendor_location_operating_hours,
        marketplace.vendor_locations, marketplace.vendors,
        marketplace.session_events, marketplace.session_refresh_tokens,
        marketplace.sessions, marketplace.devices, marketplace.phone_identities,
        marketplace.users, marketplace.otp_verification_attempts,
        marketplace.otp_provider_events, marketplace.otp_protected_test_outbox,
        marketplace.otp_challenges`,
    );

    const deviceA1 = createUuidV7();
    const first = await signIn({
      deviceId: deviceA1,
      now: base,
      otp,
      phone: 'SYNTH-PHONE-SESSION-A',
      requestKey: 'session-account-a-0001',
      sessions,
    });
    const authenticated = await sessions.authenticateAccess({
      access_token: first.access_token,
      context: context(),
      expected_user_id: first.user_id,
      now: new Date(base.getTime() + 2_000),
    });
    if (
      authenticated.session_id !== first.session_id ||
      authenticated.client_device_id !== deviceA1
    ) {
      throw new Error('Issued access token did not resolve its bound session and device');
    }

    const otpReplay = await sessions.completeOtpSignIn({
      challenge_id: first.challenge_id,
      code: first.code,
      context: context(),
      device_id: deviceA1,
      now: new Date(base.getTime() + 3_000),
      platform: 'WEB',
    });
    if (!otpReplay.replayed || otpReplay.tokens !== null) {
      throw new Error('Consumed OTP replay issued a second session');
    }

    const protectedStorage = await pool.query<{
      access_plaintext: boolean;
      notification_plaintext: boolean;
      phone_plaintext: boolean;
      refresh_plaintext: boolean;
    }>(
      `SELECT
         EXISTS (SELECT 1 FROM marketplace.sessions WHERE access_token_hash = $1) access_plaintext,
         EXISTS (SELECT 1 FROM marketplace.session_refresh_tokens WHERE token_hash = $2) refresh_plaintext,
         EXISTS (SELECT 1 FROM marketplace.phone_identities WHERE phone_lookup_hash = $3) phone_plaintext,
         EXISTS (SELECT 1 FROM marketplace.devices WHERE notification_token_hash = $4) notification_plaintext`,
      [
        first.access_token,
        first.refresh_token,
        'SYNTH-PHONE-SESSION-A',
        'SYNTHETIC_NOTIFICATION_TOKEN_0001',
      ],
    );
    if (Object.values(protectedStorage.rows[0] ?? {}).some(Boolean)) {
      throw new Error('Session, identity, or notification plaintext reached durable storage');
    }

    const rotated = await sessions.refresh({
      context: context(),
      now: new Date(base.getTime() + 60_000),
      refresh_token: first.refresh_token,
    });
    if (
      rotated.session_id !== first.session_id ||
      rotated.access_token === first.access_token ||
      rotated.refresh_token === first.refresh_token
    ) {
      throw new Error('Refresh did not rotate both credentials in the same session');
    }
    await rejectsWith(
      () =>
        sessions.authenticateAccess({
          access_token: first.access_token,
          context: context(),
          now: new Date(base.getTime() + 60_001),
        }),
      SessionInvalidError,
    );
    await sessions.authenticateAccess({
      access_token: rotated.access_token,
      context: context(),
      now: new Date(base.getTime() + 60_002),
    });
    await rejectsWith(
      () =>
        sessions.refresh({
          context: context(),
          now: new Date(base.getTime() + 61_000),
          refresh_token: first.refresh_token,
        }),
      SessionReplayDetectedError,
    );
    await rejectsWith(
      () =>
        sessions.authenticateAccess({
          access_token: rotated.access_token,
          context: context(),
          now: new Date(base.getTime() + 61_001),
        }),
      SessionInvalidError,
    );

    const deviceB = createUuidV7();
    const expiring = await signIn({
      deviceId: deviceB,
      now: new Date(base.getTime() + 2_000),
      otp,
      phone: 'SYNTH-PHONE-SESSION-B',
      requestKey: 'session-account-b-0001',
      sessions,
    });
    await rejectsWith(
      () =>
        sessions.authenticateAccess({
          access_token: expiring.access_token,
          context: context(),
          now: new Date(base.getTime() + 16 * 60_000),
        }),
      SessionInvalidError,
    );
    const afterAccessExpiry = await sessions.refresh({
      context: context(),
      now: new Date(base.getTime() + 16 * 60_000),
      refresh_token: expiring.refresh_token,
    });
    await rejectsWith(
      () =>
        sessions.refresh({
          context: context(),
          now: new Date(base.getTime() + 31 * 24 * 60 * 60_000),
          refresh_token: afterAccessExpiry.refresh_token,
        }),
      SessionInvalidError,
    );

    const deviceC = createUuidV7();
    const accountC = await signIn({
      deviceId: deviceC,
      now: new Date(base.getTime() + 4_000),
      otp,
      phone: 'SYNTH-PHONE-SESSION-C',
      requestKey: 'session-account-c-0001',
      sessions,
    });
    await rejectsWith(
      () =>
        sessions.authenticateAccess({
          access_token: accountC.access_token,
          context: context(),
          expected_user_id: expiring.user_id,
          now: new Date(base.getTime() + 5_000),
        }),
      SessionForbiddenError,
    );

    const deviceA2 = createUuidV7();
    const accountA2 = await signIn({
      deviceId: deviceA2,
      now: new Date(base.getTime() + 31_000),
      otp,
      phone: 'SYNTH-PHONE-SESSION-A',
      requestKey: 'session-account-a-0002',
      sessions,
    });
    const deviceA3 = createUuidV7();
    const accountA3 = await signIn({
      deviceId: deviceA3,
      now: new Date(base.getTime() + 62_000),
      otp,
      phone: 'SYNTH-PHONE-SESSION-A',
      requestKey: 'session-account-a-0003',
      sessions,
    });
    if (accountA2.user_id !== first.user_id || accountA3.user_id !== first.user_id) {
      throw new Error('Verified phone identity did not resolve a stable user');
    }
    const listed = await sessions.listSessions({
      access_token: accountA2.access_token,
      context: context(),
      now: new Date(base.getTime() + 70_000),
    });
    if (listed.length !== 3 || listed.filter((item) => item.current).length !== 1) {
      throw new Error('Safe per-user session listing is incomplete');
    }
    await sessions.revoke({
      access_token: accountA2.access_token,
      context: context(),
      now: new Date(base.getTime() + 71_000),
      target_session_id: accountA3.session_id,
    });
    await rejectsWith(
      () =>
        sessions.authenticateAccess({
          access_token: accountA3.access_token,
          context: context(),
          now: new Date(base.getTime() + 71_001),
        }),
      SessionInvalidError,
    );
    await sessions.authenticateAccess({
      access_token: accountA2.access_token,
      context: context(),
      now: new Date(base.getTime() + 71_002),
    });

    const notification = await sessions.updateNotificationToken({
      access_token: accountA2.access_token,
      context: context(),
      notification_token: 'SYNTHETIC_NOTIFICATION_TOKEN_REPLACED_0002',
      now: new Date(base.getTime() + 72_000),
    });
    const notificationRemoved = await sessions.updateNotificationToken({
      access_token: accountA2.access_token,
      context: context(),
      notification_token: null,
      now: new Date(base.getTime() + 73_000),
    });
    if (
      notification.notification_state !== 'ACTIVE' ||
      notificationRemoved.notification_state !== 'NONE'
    ) {
      throw new Error('Notification-token lifecycle did not activate and remove safely');
    }
    await sessions.revoke({
      access_token: accountA2.access_token,
      context: context(),
      now: new Date(base.getTime() + 74_000),
    });
    await rejectsWith(
      () =>
        sessions.authenticateAccess({
          access_token: accountA2.access_token,
          context: context(),
          now: new Date(base.getTime() + 74_001),
        }),
      SessionInvalidError,
    );

    const evidence = await pool.query<{
      created: string;
      expired: string;
      refreshed: string;
      replayed: string;
      revoked: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE event_type = 'CREATED') created,
         count(*) FILTER (WHERE event_type = 'REFRESHED') refreshed,
         count(*) FILTER (WHERE event_type = 'REPLAY_DETECTED') replayed,
         count(*) FILTER (WHERE event_type = 'EXPIRED') expired,
         count(*) FILTER (WHERE event_type = 'REVOKED') revoked
       FROM marketplace.session_events`,
    );
    const row = evidence.rows[0];
    if (
      Number(row?.created ?? 0) !== 5 ||
      Number(row?.refreshed ?? 0) !== 2 ||
      Number(row?.replayed ?? 0) !== 1 ||
      Number(row?.expired ?? 0) !== 1 ||
      Number(row?.revoked ?? 0) !== 2
    ) {
      throw new Error('Append-only session lifecycle evidence is incomplete');
    }
  } finally {
    await sessions.close();
    await otp.close();
    await pool.end();
  }
}
