import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { describeState } from './status.js';

const directory = path.resolve(import.meta.dirname);

function source(file: string): string {
  return fs.readFileSync(path.join(directory, file), 'utf8');
}

const tokens = fs.readFileSync(path.resolve(directory, '../../ui-tokens/src/tokens.css'), 'utf8');
const styles = source('styles.css');

test('every state is carried by a glyph and a word, never colour alone (UX-07)', () => {
  const states = [
    'PLACED',
    'AWAITING_CUSTOMER_DECISION',
    'DELIVERED',
    'CANCELLED',
    'RETURN_AUTHORIZED',
    'OUT_OF_STOCK',
    'A_STATE_NOBODY_HAS_DEFINED',
  ];
  for (const state of states) {
    const presentation = describeState(state);
    assert.ok(presentation.glyph.length > 0, `${state} has a glyph`);
    assert.ok(presentation.label.length > 0, `${state} has a word`);
    assert.ok(
      !/^[A-Z_]+$/.test(presentation.label),
      `${state} renders as copy, not as the raw constant`,
    );
    assert.ok(presentation.key.startsWith('state.'), `${state} carries a locale key`);
  }
});

test('an unknown state degrades to a sentence rather than disappearing', () => {
  const presentation = describeState('SOME_FUTURE_STATE');
  assert.equal(presentation.label, 'Some future state');
  assert.equal(presentation.tone, 'neutral');
});

test('the non-happy states exist as components, not as ad-hoc sentences (UX-09)', () => {
  const states = source('states.tsx');
  for (const component of ['LoadingState', 'EmptyState', 'ErrorState', 'Skeleton', 'Notice']) {
    assert.ok(states.includes(`export function ${component}`), `${component} exists`);
  }
  // A loading region a screen reader never mentions is not a loading state.
  assert.ok(states.includes('aria-busy'), 'loading announces itself');
  assert.ok(states.includes('aria-live'), 'status changes are announced');
  assert.ok(states.includes('role="alert"'), 'an error is announced assertively');
});

test('reduced motion is honoured once, in the shared token layer (UX-11)', () => {
  assert.ok(
    tokens.includes('@media (prefers-reduced-motion: reduce)'),
    'the preference is respected',
  );
  assert.ok(tokens.includes('animation-duration: 0.01ms'), 'animation is suppressed');
  assert.ok(tokens.includes('transition-duration: 0.01ms'), 'transition is suppressed');
});

test('the focus ring is a solid colour, never a low-alpha wash (WCAG 2.4.11)', () => {
  assert.ok(tokens.includes('--focus-ring: #245e9b'), 'a solid ring colour is defined');
  assert.ok(styles.includes(':focus-visible'), 'components adopt it');
  assert.ok(!/outline:[^;]*rgba\(/.test(styles), 'no translucent outline is used');
});

test('controls meet the touch-target floor, and the operational surfaces exceed it (UX-02)', () => {
  assert.ok(tokens.includes('--touch-target: 44px'), 'the AAA target is the baseline');
  assert.ok(tokens.includes('--touch-target-field: 48px'), 'fields take the larger target');
  // Vendor and partner staff work one-handed on low-end phones.
  assert.ok(
    /\[data-role='vendor'\],\s*\[data-role='partner'\]\s*\{\s*--touch-target: var\(--touch-target-field\);/.test(
      tokens,
    ),
    'vendor and partner raise the floor to 48px',
  );
  assert.ok(styles.includes('min-height: var(--touch-target)'), 'buttons use the token');
});

test('the component layer declares no !important and no colour literals', () => {
  const withoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!withoutComments.includes('!important'), 'nothing forces the cascade');
  // Colour belongs to the token layer. A literal here is a component starting
  // its own palette, which is how three fighting stylesheets happened before.
  const literals = withoutComments.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(literals, [], `unexpected colour literals: ${literals.join(', ')}`);
});

test('wide content scrolls inside its own box, never widening the document (UX-01, UX-05)', () => {
  assert.ok(styles.includes('.ns-scroll-x'), 'an explicit scroll container exists');
  assert.ok(styles.includes('overflow-x: auto'), 'it scrolls rather than overflowing');
  // Grids size by available width rather than by breakpoint, so a 200% zoom
  // reflows into fewer columns instead of scrolling sideways.
  assert.ok(styles.includes('repeat(auto-fill, minmax('), 'grids reflow by width');
});
