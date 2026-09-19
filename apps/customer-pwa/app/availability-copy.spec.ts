import assert from 'node:assert/strict';
import test from 'node:test';
import { freshnessSentence, weightVarianceSentence } from './availability-copy.js';

const fallback = (_key: string, text: string) => text;

test('the freshness sentence follows the server tier and says nothing without an inventory row', () => {
  assert.match(
    freshnessSentence({ freshness: 'FRESH', is_stale: false }, fallback) ?? '',
    /last 15 minutes/,
  );
  assert.match(
    freshnessSentence({ freshness: 'STALE', is_stale: false }, fallback) ?? '',
    /within the last hour/,
  );
  assert.match(
    freshnessSentence({ freshness: 'EXPIRED', is_stale: false }, fallback) ?? '',
    /over an hour ago.*reconfirms when it accepts/,
  );
  assert.equal(freshnessSentence({ freshness: null, is_stale: true }, fallback), null);
});

test('the freshness sentence is translated by key, with the fallback only when the key is missing', () => {
  const hindi = (key: string, text: string) =>
    key === 'customer.product.freshness.expired' ? 'एक घंटे से पहले' : text;
  assert.equal(
    freshnessSentence({ freshness: 'EXPIRED', is_stale: false }, hindi),
    'एक घंटे से पहले',
  );
});

test('the weight bound is shown as a percentage, only for loose products with a bound', () => {
  assert.equal(
    weightVarianceSentence(
      { variable_weight: true, permitted_weight_variance_bps: 1000 },
      fallback,
    ),
    'The final weight may differ from what you order by up to 10%.',
  );
  assert.match(
    weightVarianceSentence(
      { variable_weight: true, permitted_weight_variance_bps: 250 },
      fallback,
    ) ?? '',
    /2\.5%/,
  );
  assert.equal(
    weightVarianceSentence(
      { variable_weight: false, permitted_weight_variance_bps: null },
      fallback,
    ),
    null,
  );
  assert.equal(
    weightVarianceSentence(
      { variable_weight: true, permitted_weight_variance_bps: null },
      fallback,
    ),
    null,
  );
});
