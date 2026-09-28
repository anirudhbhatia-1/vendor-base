import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { actionErrorText, describeError } from './error-presentation.js';

const directory = path.resolve(import.meta.dirname);

function source(file: string): string {
  return fs.readFileSync(path.join(directory, file), 'utf8');
}

test('the operations table is a real table with a caption, not a div grid', () => {
  const table = source('data-table.tsx');
  assert.ok(table.includes('<table'), 'renders a <table>');
  assert.ok(table.includes('<caption'), 'names itself for assistive tech');
  assert.ok(table.includes('scope="col"'), 'headers carry scope');
  assert.ok(table.includes('<dl'), 'DescriptionList is a real definition list');
});

test('the decision modal requires the reason before it confirms (design.md §12)', () => {
  const dialog = source('confirm-dialog.tsx');
  assert.ok(dialog.includes('disabled={incomplete}'), 'confirm stays disabled while incomplete');
  assert.ok(!dialog.includes('setTimeout'), 'never auto-dismisses');
});

test('a recognised failure becomes copy, an unrecognised one keeps the caller sentence', () => {
  const conflict = actionErrorText({ code: 'CONFLICT' }, 'The offer could not be accepted.');
  assert.ok(conflict.includes('Refresh and try again'));
  const unknown = actionErrorText(
    { code: 'SOMETHING_NEW', request_id: 'req-1' },
    'The offer could not be accepted.',
  );
  assert.ok(unknown.startsWith('The offer could not be accepted.'));
  assert.ok(unknown.includes('req-1'), 'the support reference is kept');
});

test('a network failure reads as offline, not as a server fault', () => {
  const described = describeError(new TypeError('fetch failed'));
  assert.equal(described.title, 'You are offline');
  assert.equal(described.retryable, true);
});
