import { createRequestContext, createUuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  OtpIdentityService,
  OtpRateLimitedError,
  OtpUnavailableError,
  OtpVerificationRejectedError,
} from '../src/otp-identity.js';

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

export async function verifyOtpIdentity(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, application_name: 'otp-identity-verifier' });
  const codes = ['104729', '268403', '390511', '482617', '573829', '614933', '705047', '826159'];
  const service = new OtpIdentityService({
    connection_string: connectionString,
    hash_key: ['phase', 'four', 'local', 'synthetic', 'hash', 'material'].join('-'),
    code_generator: () => codes.shift() ?? '947261',
  });
  const base = new Date();
  try {
    await pool.query(
      `TRUNCATE marketplace.finance_exceptions, marketplace.provider_statement_rows,
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

    const device = createUuidV7();
    const primaryInput = {
      context: context(),
      device_id: device,
      phone_identifier: 'SYNTH-PHONE-CUSTOMER-001',
      request_key: 'signin-primary-0001',
      scenario: 'duplicate_callback' as const,
      now: base,
    };
    const [primary, concurrentReplay] = await Promise.all([
      service.requestChallenge(primaryInput),
      service.requestChallenge({ ...primaryInput, context: context() }),
    ]);
    if (
      primary.challenge_id !== concurrentReplay.challenge_id ||
      primary.replayed === concurrentReplay.replayed
    ) {
      throw new Error('Concurrent duplicate OTP requests did not collapse to one challenge');
    }

    const code = await service.readSyntheticOtpForTest(primary.challenge_id);
    if (code !== '104729')
      throw new Error('Protected test helper did not return the generated OTP');
    const verified = await service.verifyChallenge({
      challenge_id: primary.challenge_id,
      code,
      context: context(),
      device_id: device,
      now: new Date(base.getTime() + 1_000),
    });
    const replay = await service.verifyChallenge({
      challenge_id: primary.challenge_id,
      code,
      context: context(),
      device_id: device,
      now: new Date(base.getTime() + 2_000),
    });
    if (verified.replayed || !replay.replayed || replay.outcome !== 'already_verified') {
      throw new Error('OTP consumption replay was not safe and idempotent');
    }
    await rejectsWith(() => service.readSyntheticOtpForTest(primary.challenge_id), Error);

    const protectedRows = await pool.query<{
      callback_count: string;
      challenge_plaintext: string | null;
      outbox_count: string;
    }>(
      `SELECT
         (SELECT count(*) FROM marketplace.otp_provider_events WHERE challenge_id = $1) callback_count,
         (SELECT code_hash FROM marketplace.otp_challenges WHERE challenge_id = $1 AND code_hash = $2) challenge_plaintext,
         (SELECT count(*) FROM marketplace.otp_protected_test_outbox WHERE challenge_id = $1) outbox_count`,
      [primary.challenge_id, code],
    );
    if (
      protectedRows.rows[0]?.callback_count !== '1' ||
      protectedRows.rows[0]?.challenge_plaintext !== null ||
      protectedRows.rows[0]?.outbox_count !== '0'
    ) {
      throw new Error('OTP hashing, callback deduplication, or destruction proof failed');
    }

    const failureDevice = createUuidV7();
    const failure = await service.requestChallenge({
      context: context(),
      device_id: failureDevice,
      phone_identifier: 'SYNTH-PHONE-FAIL-001',
      request_key: 'signin-failure-0001',
      scenario: 'failure',
      now: base,
    });
    await rejectsWith(
      () =>
        service.verifyChallenge({
          challenge_id: failure.challenge_id,
          code: '268403',
          context: context(),
          device_id: failureDevice,
          now: base,
        }),
      OtpUnavailableError,
    );

    const delayDevice = createUuidV7();
    const delayed = await service.requestChallenge({
      context: context(),
      device_id: delayDevice,
      phone_identifier: 'SYNTH-PHONE-DELAY-001',
      request_key: 'signin-delay-0001',
      scenario: 'delay',
      now: base,
    });
    await rejectsWith(
      () =>
        service.verifyChallenge({
          challenge_id: delayed.challenge_id,
          code: '390511',
          context: context(),
          device_id: delayDevice,
          now: base,
        }),
      OtpUnavailableError,
    );

    const lockDevice = createUuidV7();
    const lockChallenge = await service.requestChallenge({
      context: context(),
      device_id: lockDevice,
      phone_identifier: 'SYNTH-PHONE-LOCK-001',
      request_key: 'signin-lock-0001',
      scenario: 'success',
      now: base,
    });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await rejectsWith(
        () =>
          service.verifyChallenge({
            challenge_id: lockChallenge.challenge_id,
            code: '000000',
            context: context(),
            device_id: lockDevice,
            now: new Date(base.getTime() + attempt * 1_000),
          }),
        OtpVerificationRejectedError,
      );
    }
    const locked = await pool.query<{
      attempt_count: number;
      outbox_count: string;
      status: string;
    }>(
      `SELECT c.attempt_count, c.status,
        (SELECT count(*) FROM marketplace.otp_protected_test_outbox o WHERE o.challenge_id = c.challenge_id) outbox_count
       FROM marketplace.otp_challenges c WHERE c.challenge_id = $1`,
      [lockChallenge.challenge_id],
    );
    if (
      locked.rows[0]?.status !== 'LOCKED' ||
      locked.rows[0].attempt_count !== 5 ||
      locked.rows[0].outbox_count !== '0'
    ) {
      throw new Error('OTP attempt lockout did not persist or destroy protected content');
    }

    const expiryDevice = createUuidV7();
    const expiring = await service.requestChallenge({
      context: context(),
      device_id: expiryDevice,
      phone_identifier: 'SYNTH-PHONE-EXPIRY-001',
      request_key: 'signin-expiry-0001',
      scenario: 'success',
      now: base,
    });
    await rejectsWith(
      () =>
        service.verifyChallenge({
          challenge_id: expiring.challenge_id,
          code: '573829',
          context: context(),
          device_id: expiryDevice,
          now: new Date(base.getTime() + 11 * 60_000),
        }),
      OtpVerificationRejectedError,
    );

    const rateDevice = createUuidV7();
    for (let index = 0; index < 3; index += 1) {
      await service.requestChallenge({
        context: context(),
        device_id: rateDevice,
        phone_identifier: 'SYNTH-PHONE-RATE-001',
        request_key: `signin-rate-000${index + 1}`,
        scenario: 'success',
        now: new Date(base.getTime() + index * 31_000),
      });
    }
    await rejectsWith(
      () =>
        service.requestChallenge({
          context: context(),
          device_id: rateDevice,
          phone_identifier: 'SYNTH-PHONE-RATE-001',
          request_key: 'signin-rate-0004',
          scenario: 'success',
          now: new Date(base.getTime() + 93_000),
        }),
      OtpRateLimitedError,
    );

    const metrics = await service.metrics();
    if (
      metrics.verified !== 1 ||
      metrics.failed !== 1 ||
      metrics.locked !== 1 ||
      metrics.wrong_attempts !== 5
    ) {
      throw new Error('OTP abuse and outcome metrics are incomplete');
    }
    const attemptEvidence = await pool.query<{
      attempt_count: string;
      contains_code_column: boolean;
    }>(
      `SELECT
         (SELECT count(*) FROM marketplace.otp_verification_attempts) AS attempt_count,
         EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'marketplace'
              AND table_name = 'otp_verification_attempts'
              AND column_name IN ('otp_code', 'code_hash', 'submitted_code')
         ) AS contains_code_column`,
    );
    if (
      attemptEvidence.rows[0]?.attempt_count !== '7' ||
      attemptEvidence.rows[0]?.contains_code_column === true
    ) {
      throw new Error('OTP-free append-only attempt evidence is incomplete');
    }
  } finally {
    await service.close();
    await pool.end();
  }
}
