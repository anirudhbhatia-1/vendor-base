import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  featureFlagScopePrecedence,
  normalizeConfigurationValue,
} from './versioned-configuration.js';

describe('versioned configuration validation', () => {
  it('normalizes supported values and preserves safe integer meaning', () => {
    assert.deepEqual(normalizeConfigurationValue('SETTING', 300), {
      json: '300',
      type: 'INTEGER',
      value: 300,
    });
    assert.deepEqual(normalizeConfigurationValue('SETTING', { enabled: true, limit: 3 }), {
      json: '{"enabled":true,"limit":3}',
      type: 'JSON',
      value: { enabled: true, limit: 3 },
    });
  });

  it('requires boolean feature flags and bounded JSON values', () => {
    assert.throws(() => normalizeConfigurationValue('FEATURE_FLAG', 'true'), /boolean/);
    assert.throws(
      () => normalizeConfigurationValue('SETTING', Number.NaN),
      /boolean, safe integer/,
    );
    assert.throws(() => normalizeConfigurationValue('SETTING', 'x'.repeat(65_537)), /65536/);
  });

  it('fixes deterministic specific-to-global flag precedence', () => {
    assert.deepEqual(featureFlagScopePrecedence, [
      'INTERNAL_USER',
      'VENDOR',
      'CATEGORY',
      'ZONE',
      'COHORT',
      'GLOBAL',
    ]);
    assert.ok(Object.isFrozen(featureFlagScopePrecedence));
  });
});
