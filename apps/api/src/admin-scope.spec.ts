import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Every `admin.*` capability is an ADMIN_SCOPE rule: the access evaluation
 * matches a role assignment's scope against the scope named in the request's
 * evidence, and a requirement that names no scope can never match. Two
 * requirements were declared that way, so no admin could open the partner
 * application queue or resolve an earnings dispute. Read from the source,
 * because the requirement objects are module-private consts.
 */
test('every admin capability requirement names its admin scope', () => {
  const directory = path.resolve(import.meta.dirname);
  const offenders: string[] = [];
  for (const file of fs.readdirSync(directory)) {
    if (!file.endsWith('.controller.ts')) continue;
    const source = fs.readFileSync(path.join(directory, file), 'utf8');
    for (const match of source.matchAll(/RequireAuthorization\(\{([\s\S]*?)\}\)/g)) {
      const body = match[1] ?? '';
      const capability = /capability:\s*'([^']+)'/.exec(body)?.[1];
      if (!capability?.startsWith('admin.')) continue;
      if (!body.includes('admin_scope')) offenders.push(`${file}: ${capability}`);
    }
  }
  assert.deepEqual(offenders, []);
});
