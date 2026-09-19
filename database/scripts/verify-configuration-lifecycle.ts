import { createRequestId, createUuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  activateConfigurationVersion,
  approveConfigurationVersion,
  ConfigurationApprovalConflictError,
  ConfigurationOverlapError,
  createConfigurationDraft,
  createConfigurationRollbackDraft,
  evaluateFeatureFlag,
  resolveConfiguration,
  scheduleConfigurationVersion,
  snapshotConfigurationVersions,
  validateConfigurationVersion,
  type ConfigurationScope,
} from '../src/versioned-configuration.js';

/**
 * Append-only guards must refuse with 55000. A bare catch accepts any failure, which is
 * how two guards in step 3.6 kept raising an internal field-resolution error while their
 * tests stayed green.
 */
function isAppendOnlyRefusal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '55000';
}

export async function verifyVersionedConfiguration(connectionString: string): Promise<void> {
  const pool = new Pool({
    application_name: 'neighbourhood-store-test-configuration-verifier',
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 12,
    query_timeout: 30_000,
    statement_timeout: 30_000,
  });
  const proposerId = createUuidV7();
  const validatorId = createUuidV7();
  const approverId = createUuidV7();
  const activatorId = createUuidV7();
  const correlationId = createUuidV7();
  const baseTime = new Date(Date.now() - 60_000);
  const flagKey = 'checkout.grouped_enabled';

  const approveAndActivate = async (
    scope: ConfigurationScope,
    value: boolean,
    effectiveFrom = baseTime,
  ) => {
    const draft = await createConfigurationDraft(pool, {
      actor_id: proposerId,
      configuration_key: flagKey,
      configuration_kind: 'FEATURE_FLAG',
      configuration_value: value,
      correlation_id: correlationId,
      request_id: createRequestId(),
      scope,
    });
    await validateConfigurationVersion(pool, {
      actor_id: validatorId,
      configuration_version_id: draft.configuration_version_id,
      request_id: createRequestId(),
    });
    await approveConfigurationVersion(pool, {
      actor_id: approverId,
      configuration_version_id: draft.configuration_version_id,
      request_id: createRequestId(),
    });
    await scheduleConfigurationVersion(pool, {
      actor_id: approverId,
      configuration_version_id: draft.configuration_version_id,
      effective_from: effectiveFrom,
      request_id: createRequestId(),
    });
    return activateConfigurationVersion(pool, {
      actor_id: activatorId,
      at: new Date(),
      configuration_version_id: draft.configuration_version_id,
      request_id: createRequestId(),
    });
  };

  try {
    const globalDraft = await createConfigurationDraft(pool, {
      actor_id: proposerId,
      configuration_key: flagKey,
      configuration_kind: 'FEATURE_FLAG',
      configuration_value: false,
      correlation_id: correlationId,
      request_id: createRequestId(),
      scope: { kind: 'GLOBAL', reference: 'global' },
    });
    if (globalDraft.status !== 'DRAFT' || globalDraft.version_number !== 1) {
      throw new Error('Configuration draft did not start at version one in DRAFT');
    }
    await validateConfigurationVersion(pool, {
      actor_id: validatorId,
      configuration_version_id: globalDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    let selfApprovalRejected = false;
    try {
      await approveConfigurationVersion(pool, {
        actor_id: proposerId,
        configuration_version_id: globalDraft.configuration_version_id,
        request_id: createRequestId(),
      });
    } catch (error: unknown) {
      selfApprovalRejected = error instanceof ConfigurationApprovalConflictError;
    }
    if (!selfApprovalRejected) throw new Error('Configuration maker approved their own version');
    await approveConfigurationVersion(pool, {
      actor_id: approverId,
      configuration_version_id: globalDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    await scheduleConfigurationVersion(pool, {
      actor_id: approverId,
      configuration_version_id: globalDraft.configuration_version_id,
      effective_from: baseTime,
      request_id: createRequestId(),
    });
    const globalActive = await activateConfigurationVersion(pool, {
      actor_id: activatorId,
      at: new Date(),
      configuration_version_id: globalDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    if (globalActive.status !== 'ACTIVE')
      throw new Error('Scheduled configuration did not activate');

    const scopedVersions = await Promise.all([
      approveAndActivate({ kind: 'COHORT', reference: 'synthetic-pilot' }, true),
      approveAndActivate({ kind: 'ZONE', reference: '302020' }, false),
      approveAndActivate({ kind: 'CATEGORY', reference: 'fruit-vegetables' }, true),
      approveAndActivate({ kind: 'VENDOR', reference: 'SYNTH-VENDOR-01' }, false),
      approveAndActivate({ kind: 'INTERNAL_USER', reference: 'SYNTH-USER-01' }, true),
    ]);
    if (scopedVersions.some((version) => version.status !== 'ACTIVE')) {
      throw new Error('A scoped feature flag did not activate');
    }
    const fullSubject = {
      category: 'fruit-vegetables',
      cohort: 'synthetic-pilot',
      internal_user: 'SYNTH-USER-01',
      vendor: 'SYNTH-VENDOR-01',
      zone: '302020',
    };
    const evaluations = await Promise.all([
      evaluateFeatureFlag(pool, { configuration_key: flagKey, subject: fullSubject }),
      evaluateFeatureFlag(pool, {
        configuration_key: flagKey,
        subject: {
          category: fullSubject.category,
          cohort: fullSubject.cohort,
          vendor: fullSubject.vendor,
          zone: fullSubject.zone,
        },
      }),
      evaluateFeatureFlag(pool, {
        configuration_key: flagKey,
        subject: {
          category: fullSubject.category,
          cohort: fullSubject.cohort,
          zone: fullSubject.zone,
        },
      }),
      evaluateFeatureFlag(pool, {
        configuration_key: flagKey,
        subject: {
          cohort: fullSubject.cohort,
          zone: fullSubject.zone,
        },
      }),
      evaluateFeatureFlag(pool, {
        configuration_key: flagKey,
        subject: { cohort: fullSubject.cohort },
      }),
      evaluateFeatureFlag(pool, { configuration_key: flagKey }),
    ]);
    if (
      JSON.stringify(evaluations.map((evaluation) => evaluation.enabled)) !==
        JSON.stringify([true, false, true, false, true, false]) ||
      JSON.stringify(evaluations.map((evaluation) => evaluation.matched_scope?.kind)) !==
        JSON.stringify(['INTERNAL_USER', 'VENDOR', 'CATEGORY', 'ZONE', 'COHORT', 'GLOBAL'])
    ) {
      throw new Error('Feature flag scopes did not follow deterministic precedence');
    }
    const missing = await evaluateFeatureFlag(pool, {
      configuration_key: 'feature.unconfigured_safe_default',
    });
    if (missing.enabled || missing.configuration_version_id !== null) {
      throw new Error('Missing feature flag did not default safely to disabled');
    }

    const overlapKey = 'synthetic.overlap_guard';
    const prepareScheduled = async (suffix: string) => {
      const draft = await createConfigurationDraft(pool, {
        actor_id: proposerId,
        configuration_key: overlapKey,
        configuration_kind: 'SETTING',
        configuration_value: suffix,
        correlation_id: correlationId,
        request_id: createRequestId(),
        scope: { kind: 'GLOBAL', reference: 'global' },
      });
      await validateConfigurationVersion(pool, {
        actor_id: validatorId,
        configuration_version_id: draft.configuration_version_id,
        request_id: createRequestId(),
      });
      await approveConfigurationVersion(pool, {
        actor_id: approverId,
        configuration_version_id: draft.configuration_version_id,
        request_id: createRequestId(),
      });
      return draft;
    };
    const firstScheduled = await prepareScheduled('first');
    const secondScheduled = await prepareScheduled('second');
    const future = new Date(Date.now() + 60 * 60 * 1_000);
    const overlappingSchedules = await Promise.allSettled([
      scheduleConfigurationVersion(pool, {
        actor_id: approverId,
        configuration_version_id: firstScheduled.configuration_version_id,
        effective_from: future,
        request_id: createRequestId(),
      }),
      scheduleConfigurationVersion(pool, {
        actor_id: approverId,
        configuration_version_id: secondScheduled.configuration_version_id,
        effective_from: new Date(future.getTime() + 1_000),
        request_id: createRequestId(),
      }),
    ]);
    const scheduledWinners = overlappingSchedules.filter((result) => result.status === 'fulfilled');
    const overlapLosers = overlappingSchedules.filter(
      (result) =>
        result.status === 'rejected' && result.reason instanceof ConfigurationOverlapError,
    );
    if (scheduledWinners.length !== 1 || overlapLosers.length !== 1) {
      throw new Error('Concurrent overlapping schedules did not produce exactly one winner');
    }

    let invalidValueRejected = false;
    try {
      await pool.query(
        `INSERT INTO marketplace.configuration_versions
           (configuration_version_id, configuration_key, version_number,
            configuration_kind, value_type, configuration_value, scope_kind,
            scope_reference, proposed_by, request_id, correlation_id)
         VALUES ($1, 'feature.invalid_value', 1, 'FEATURE_FLAG', 'STRING',
                 '"unsafe"'::jsonb, 'GLOBAL', 'global', $2, $3, $4)`,
        [createUuidV7(), proposerId, createRequestId(), correlationId],
      );
    } catch (error: unknown) {
      invalidValueRejected =
        typeof error === 'object' && error !== null && 'code' in error && error.code === '23514';
    }
    if (!invalidValueRejected) throw new Error('Database accepted a non-boolean feature flag');

    // A version that never entered the schedule race, so its status is APPROVED
    // deterministically.
    //
    // This used `secondScheduled`, whose status depends on which of two
    // concurrent schedules won. That decides the outcome outright: measured
    // directly against this schema, APPROVED -> ACTIVE is refused with 23514
    // while SCHEDULED -> ACTIVE is *permitted* (migration 0005 lists it), so
    // whenever the second version won the race the update succeeded and this
    // assertion reported the database accepting an invalid jump. The first-issued
    // schedule usually wins, which is why it failed only occasionally -- the worst
    // kind of red, rare enough to look like noise.
    const neverScheduled = await prepareScheduled('never-scheduled');
    let invalidTransitionRejected = false;
    try {
      await pool.query(
        `UPDATE marketplace.configuration_versions
            SET status = 'ACTIVE', effective_from = clock_timestamp(),
                activated_at = clock_timestamp()
          WHERE configuration_version_id = $1`,
        [neverScheduled.configuration_version_id],
      );
    } catch (error: unknown) {
      invalidTransitionRejected =
        typeof error === 'object' && error !== null && 'code' in error && error.code === '23514';
    }
    if (!invalidTransitionRejected) throw new Error('Database accepted an invalid lifecycle jump');

    const replacement = await approveAndActivate(
      { kind: 'GLOBAL', reference: 'global' },
      true,
      new Date(baseTime.getTime() + 10_000),
    );
    const superseded = await pool.query<{ effective_until: Date | null; status: string }>(
      `SELECT status, effective_until FROM marketplace.configuration_versions
        WHERE configuration_version_id = $1`,
      [globalActive.configuration_version_id],
    );
    if (
      replacement.version_number !== 2 ||
      superseded.rows[0]?.status !== 'SUPERSEDED' ||
      !superseded.rows[0].effective_until
    ) {
      throw new Error('Activation did not supersede the prior scoped version');
    }
    // History survives supersession. The superseded version was in force for
    // ten seconds before its replacement; resolving as of an instant inside
    // that window must return it, and as of an instant after must return the
    // replacement. The resolver used to consider ACTIVE rows only, so every
    // earlier instant resolved to nothing once a key had been changed once.
    const asOfBefore = await resolveConfiguration(pool, {
      configuration_key: flagKey,
      at: new Date(baseTime.getTime() + 5_000),
    });
    if (
      asOfBefore?.configuration_version_id !== globalActive.configuration_version_id ||
      asOfBefore.configuration_value !== false
    ) {
      throw new Error(
        'Resolving as of an instant before supersession did not return the version then in force',
      );
    }
    const asOfAfter = await resolveConfiguration(pool, {
      configuration_key: flagKey,
      at: new Date(baseTime.getTime() + 15_000),
    });
    if (
      asOfAfter?.configuration_version_id !== replacement.configuration_version_id ||
      asOfAfter.configuration_value !== true
    ) {
      throw new Error(
        'Resolving as of an instant after supersession did not return the replacement',
      );
    }

    const rollbackDraft = await createConfigurationRollbackDraft(pool, {
      actor_id: proposerId,
      correlation_id: correlationId,
      reason_code: 'ROLLBACK_AFTER_SYNTHETIC_REVIEW',
      request_id: createRequestId(),
      target_version_id: globalActive.configuration_version_id,
    });
    if (
      rollbackDraft.version_number !== 3 ||
      rollbackDraft.rollback_of_version_id !== globalActive.configuration_version_id ||
      rollbackDraft.configuration_value !== false
    ) {
      throw new Error('Rollback did not create a new attributable version from history');
    }
    await validateConfigurationVersion(pool, {
      actor_id: validatorId,
      configuration_version_id: rollbackDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    await approveConfigurationVersion(pool, {
      actor_id: approverId,
      configuration_version_id: rollbackDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    await scheduleConfigurationVersion(pool, {
      actor_id: approverId,
      configuration_version_id: rollbackDraft.configuration_version_id,
      effective_from: new Date(baseTime.getTime() + 20_000),
      request_id: createRequestId(),
    });
    const rollbackActive = await activateConfigurationVersion(pool, {
      actor_id: activatorId,
      at: new Date(),
      configuration_version_id: rollbackDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    const rolledBackEvaluation = await evaluateFeatureFlag(pool, { configuration_key: flagKey });
    if (
      rolledBackEvaluation.enabled ||
      rolledBackEvaluation.configuration_version_id !== rollbackActive.configuration_version_id
    ) {
      throw new Error('Controlled rollback did not become the effective new version');
    }

    const resolved = await resolveConfiguration(pool, { configuration_key: flagKey });
    if (!resolved) throw new Error('Active configuration could not be resolved for snapshot');
    const businessRecordId = createUuidV7();
    const snapshotClient = await pool.connect();
    try {
      await snapshotClient.query('BEGIN');
      await snapshotConfigurationVersions(snapshotClient, {
        business_record_id: businessRecordId,
        business_record_type: 'synthetic_quote',
        versions: [
          {
            configuration_key: resolved.configuration_key,
            configuration_version_id: resolved.configuration_version_id,
          },
        ],
      });
      await snapshotClient.query('COMMIT');
    } catch (error: unknown) {
      await snapshotClient.query('ROLLBACK');
      throw error;
    } finally {
      snapshotClient.release();
    }
    const snapshot = await pool.query<{ configuration_version_id: string }>(
      `SELECT configuration_version_id
         FROM marketplace.business_configuration_snapshots
        WHERE business_record_type = 'synthetic_quote' AND business_record_id = $1`,
      [businessRecordId],
    );
    if (snapshot.rows[0]?.configuration_version_id !== rollbackActive.configuration_version_id) {
      throw new Error('Business record did not preserve its effective configuration version');
    }

    let mutationRejected = false;
    try {
      await pool.query(
        `UPDATE marketplace.configuration_versions
            SET configuration_value = 'true'::jsonb
          WHERE configuration_version_id = $1`,
        [rollbackActive.configuration_version_id],
      );
    } catch (error: unknown) {
      mutationRejected = isAppendOnlyRefusal(error);
    }
    let snapshotDeletionRejected = false;
    try {
      await pool.query(
        `DELETE FROM marketplace.business_configuration_snapshots
          WHERE business_record_type = 'synthetic_quote' AND business_record_id = $1`,
        [businessRecordId],
      );
    } catch (error: unknown) {
      snapshotDeletionRejected = isAppendOnlyRefusal(error);
    }
    if (!mutationRejected || !snapshotDeletionRejected) {
      throw new Error(
        'Configuration content or business snapshot did not refuse with the append-only code',
      );
    }

    const lifecycle = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM marketplace.configuration_lifecycle_events
        WHERE configuration_version_id = $1`,
      [rollbackActive.configuration_version_id],
    );
    if (lifecycle.rows[0]?.count !== '5') {
      throw new Error('Rollback lifecycle did not retain proposal through activation attribution');
    }
  } finally {
    await pool.end();
  }
}
