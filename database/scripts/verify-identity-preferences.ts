import { createRequestContext, createUuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  IdentityPreferencesService,
  PreferenceVersionConflictError,
  RequiredNotificationError,
} from '../src/identity-preferences.js';

async function expectError(
  operation: () => Promise<unknown>,
  expected: new (...arguments_: never[]) => Error,
) {
  try {
    await operation();
  } catch (error) {
    if (error instanceof expected) return;
    throw error;
  }
  throw new Error(`Expected ${expected.name}`);
}

export async function verifyIdentityPreferences(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, application_name: 'identity-preference-verifier' });
  const preferences = new IdentityPreferencesService({ connection_string: connectionString });
  const now = new Date();
  const customer = createUuidV7();
  const otherCustomer = createUuidV7();
  try {
    await pool.query(
      `TRUNCATE marketplace.notification_preference_events,
        marketplace.notification_preferences, marketplace.consents,
        marketplace.customer_profiles CASCADE
      `,
    );
    for (const userId of [customer, otherCustomer]) {
      await pool.query(
        `INSERT INTO marketplace.users (user_id, created_at, updated_at)
         VALUES ($1, $2, $2) ON CONFLICT (user_id) DO NOTHING`,
        [userId, now],
      );
    }

    const empty = await preferences.getSettings(customer);
    if (
      empty.profile.version !== 0 ||
      empty.profile.display_name !== null ||
      empty.profile.language !== 'EN' ||
      empty.consents.length !== 0 ||
      // Four kinds across three channels. IN_APP joined PUSH and SMS in 0056;
      // it had been a deliverable channel since 0037 with no policy behind it,
      // so every in-app notification was silently discarded.
      empty.notifications.length !== 12
    ) {
      throw new Error('New customer settings did not return privacy-minimal defaults');
    }
    const inAppOrderStatus = empty.notifications.find(
      (item) => item.notification_kind === 'ORDER_STATUS' && item.channel === 'IN_APP',
    );
    if (!inAppOrderStatus?.effective_enabled) {
      throw new Error('Order updates cannot reach the customer’s in-app inbox by default');
    }
    const requiredSecurity = empty.notifications.find(
      (item) => item.notification_kind === 'SECURITY' && item.channel === 'SMS',
    );
    const defaultMarketing = empty.notifications.find(
      (item) => item.notification_kind === 'MARKETING' && item.channel === 'PUSH',
    );
    if (
      requiredSecurity?.user_controllable ||
      !requiredSecurity?.effective_enabled ||
      defaultMarketing?.effective_enabled
    ) {
      throw new Error('Required or consent-gated notification defaults are unsafe');
    }

    const profileContext = createRequestContext();
    const firstProfile = await preferences.updateProfile({
      context: profileContext,
      display_name: '  Synthetic Customer  ',
      expected_version: 0,
      language: 'HI',
      now: new Date(now.getTime() + 1_000),
      user_id: customer,
    });
    if (
      firstProfile.version !== 1 ||
      firstProfile.display_name !== 'Synthetic Customer' ||
      firstProfile.language !== 'HI'
    ) {
      throw new Error('Optional profile fields were not normalized and versioned');
    }
    const replayedProfile = await preferences.updateProfile({
      context: profileContext,
      display_name: 'Different replay content',
      expected_version: 0,
      language: 'EN',
      now: new Date(now.getTime() + 2_000),
      user_id: customer,
    });
    if (replayedProfile.version !== 1 || replayedProfile.language !== 'HI') {
      throw new Error('Profile request replay changed committed settings');
    }
    await expectError(
      () =>
        preferences.updateProfile({
          context: createRequestContext(),
          display_name: null,
          expected_version: 0,
          language: 'EN',
          now: new Date(now.getTime() + 3_000),
          user_id: customer,
        }),
      PreferenceVersionConflictError,
    );
    const secondProfile = await preferences.updateProfile({
      context: createRequestContext(),
      display_name: null,
      expected_version: 1,
      language: 'EN',
      now: new Date(now.getTime() + 4_000),
      user_id: customer,
    });
    if (secondProfile.version !== 2 || secondProfile.display_name !== null) {
      throw new Error('Optional profile field could not be cleared safely');
    }

    const grantContext = createRequestContext();
    const marketingGrant = await preferences.recordConsent({
      consent_kind: 'MARKETING',
      context: grantContext,
      decision: 'GRANTED',
      now: new Date(now.getTime() + 5_000),
      policy_version: 'marketing.2026-08-test',
      source: 'CUSTOMER_PWA',
      user_id: customer,
    });
    const grantReplay = await preferences.recordConsent({
      consent_kind: 'MARKETING',
      context: grantContext,
      decision: 'WITHDRAWN',
      now: new Date(now.getTime() + 6_000),
      policy_version: 'marketing.replay',
      source: 'CUSTOMER_API',
      user_id: customer,
    });
    if (
      marketingGrant.consent_version !== 1 ||
      grantReplay.consent_record_id !== marketingGrant.consent_record_id ||
      grantReplay.decision !== 'GRANTED'
    ) {
      throw new Error('Consent request replay created or changed evidence');
    }
    const marketingWithdrawn = await preferences.recordConsent({
      consent_kind: 'MARKETING',
      context: createRequestContext(),
      decision: 'WITHDRAWN',
      now: new Date(now.getTime() + 7_000),
      policy_version: 'marketing.2026-08-test',
      source: 'CUSTOMER_PWA',
      user_id: customer,
    });
    if (marketingWithdrawn.consent_version !== 2) {
      throw new Error('Consent withdrawal did not append a new version');
    }

    await expectError(
      () =>
        preferences.setNotificationPreference({
          channel: 'SMS',
          context: createRequestContext(),
          enabled: false,
          expected_version: 0,
          notification_kind: 'SECURITY',
          now: new Date(now.getTime() + 8_000),
          user_id: customer,
        }),
      RequiredNotificationError,
    );
    let directRequiredDisableRejected = false;
    try {
      await pool.query(
        `INSERT INTO marketplace.notification_preferences
           (user_id, notification_kind, channel, enabled, version, request_id, correlation_id)
         VALUES ($1, 'ORDER_STATUS', 'SMS', false, 1, $2, $3)`,
        [customer, createUuidV7(), createUuidV7()],
      );
    } catch (error: unknown) {
      directRequiredDisableRejected =
        typeof error === 'object' && error !== null && 'code' in error && error.code === '23514';
    }
    if (!directRequiredDisableRejected) {
      throw new Error('Database accepted disabling a required notification channel');
    }

    const orderContext = createRequestContext();
    const disabledOrderPush = await preferences.setNotificationPreference({
      channel: 'PUSH',
      context: orderContext,
      enabled: false,
      expected_version: 0,
      notification_kind: 'ORDER_STATUS',
      now: new Date(now.getTime() + 9_000),
      user_id: customer,
    });
    if (disabledOrderPush.version !== 1 || disabledOrderPush.effective_enabled) {
      throw new Error('Controllable channel preference was not applied');
    }
    const orderReplay = await preferences.setNotificationPreference({
      channel: 'PUSH',
      context: orderContext,
      enabled: true,
      expected_version: 0,
      notification_kind: 'ORDER_STATUS',
      now: new Date(now.getTime() + 10_000),
      user_id: customer,
    });
    if (orderReplay.version !== 1 || orderReplay.effective_enabled) {
      throw new Error('Notification request replay changed the preference');
    }
    await expectError(
      () =>
        preferences.setNotificationPreference({
          channel: 'PUSH',
          context: createRequestContext(),
          enabled: true,
          expected_version: 0,
          notification_kind: 'ORDER_STATUS',
          now: new Date(now.getTime() + 11_000),
          user_id: customer,
        }),
      PreferenceVersionConflictError,
    );

    const marketingPreference = await preferences.setNotificationPreference({
      channel: 'PUSH',
      context: createRequestContext(),
      enabled: true,
      expected_version: 0,
      notification_kind: 'MARKETING',
      now: new Date(now.getTime() + 12_000),
      user_id: customer,
    });
    if (marketingPreference.effective_enabled) {
      throw new Error('Marketing preference bypassed withdrawn consent');
    }
    await preferences.recordConsent({
      consent_kind: 'MARKETING',
      context: createRequestContext(),
      decision: 'GRANTED',
      now: new Date(now.getTime() + 13_000),
      policy_version: 'marketing.2026-08-test',
      source: 'CUSTOMER_PWA',
      user_id: customer,
    });
    const afterConsent = await preferences.getNotificationPreferences(customer);
    if (
      !afterConsent.find(
        (item) => item.notification_kind === 'MARKETING' && item.channel === 'PUSH',
      )?.effective_enabled
    ) {
      throw new Error('Granted consent did not activate the enabled marketing channel');
    }

    const otherSettings = await preferences.getSettings(otherCustomer);
    if (
      otherSettings.profile.version !== 0 ||
      otherSettings.consents.length !== 0 ||
      otherSettings.notifications.some((item) => item.preference_enabled !== null)
    ) {
      throw new Error('Customer settings leaked across account ownership');
    }

    const retention = await pool.query<{
      missing_retention: string;
      profile_classification: string;
      consent_classification: string;
      preference_classification: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM marketplace.unclassified_retention_rows())
           AS missing_retention,
         (SELECT data_classification FROM marketplace.customer_profiles WHERE user_id = $1)
           AS profile_classification,
         (SELECT data_classification FROM marketplace.consents WHERE user_id = $1 LIMIT 1)
           AS consent_classification,
         (SELECT data_classification FROM marketplace.notification_preferences
           WHERE user_id = $1 LIMIT 1) AS preference_classification`,
      [customer],
    );
    // What actually protects this is the schema, not a row scan.
    //
    // The check here used to count rows where `retention_class IS NULL` across six
    // hard-coded tables. Every one of those columns is declared NOT NULL, so the count
    // could only ever be zero: the assertion could not fail and proved nothing. It also
    // named six tables while fifteen carry the columns.
    //
    // The meaningful question is whether a sensitive table can be added *without* the
    // classification, so this asserts the declaration: both columns present, both NOT
    // NULL, on every table that classifies anything, and the coverage not shrinking.
    const declaration = await pool.query<{
      classified: string;
      nullable: string;
      unpaired: string;
    }>(
      `WITH classified AS (
         SELECT table_name,
                count(*) FILTER (WHERE column_name = 'retention_class') AS has_class,
                count(*) FILTER (WHERE column_name = 'retention_review_at') AS has_review,
                count(*) FILTER (WHERE is_nullable = 'YES') AS nullable
           FROM information_schema.columns
          WHERE table_schema = 'marketplace'
            AND column_name IN ('retention_class', 'retention_review_at')
          GROUP BY table_name
       )
       SELECT count(*)::text AS classified,
              coalesce(sum(nullable), 0)::text AS nullable,
              count(*) FILTER (WHERE has_class <> 1 OR has_review <> 1)::text AS unpaired
         FROM classified`,
    );
    const declared = declaration.rows[0];
    if (Number(declared?.classified ?? 0) < 15) {
      throw new Error('Retention classification covers fewer tables than it did');
    }
    if (declared?.unpaired !== '0') {
      throw new Error('A table carries one retention column without the other');
    }
    if (declared.nullable !== '0') {
      throw new Error('A retention classification column is nullable and can be left unset');
    }
    if (
      retention.rows[0]?.missing_retention !== '0' ||
      retention.rows[0].profile_classification !== 'RESTRICTED' ||
      retention.rows[0].consent_classification !== 'RESTRICTED' ||
      retention.rows[0].preference_classification !== 'INTERNAL'
    ) {
      throw new Error('Sensitive identity retention or classification metadata is incomplete');
    }

    const consentEvent = await pool.query<{ consent_record_id: string }>(
      `SELECT consent_record_id FROM marketplace.consents WHERE user_id = $1 LIMIT 1`,
      [customer],
    );
    const notificationEvent = await pool.query<{ event_id: string }>(
      `SELECT event_id FROM marketplace.notification_preference_events WHERE user_id = $1 LIMIT 1`,
      [customer],
    );
    for (const mutation of [
      pool.query(`DELETE FROM marketplace.consents WHERE consent_record_id = $1`, [
        consentEvent.rows[0]?.consent_record_id,
      ]),
      pool.query(
        `UPDATE marketplace.notification_preference_events SET enabled = NOT enabled
          WHERE event_id = $1`,
        [notificationEvent.rows[0]?.event_id],
      ),
    ]) {
      let rejected = false;
      try {
        await mutation;
      } catch (error: unknown) {
        rejected =
          typeof error === 'object' && error !== null && 'code' in error && error.code === '55000';
      }
      if (!rejected) throw new Error('Append-only privacy evidence accepted mutation');
    }
  } finally {
    await preferences.close();
    await pool.end();
  }
}
