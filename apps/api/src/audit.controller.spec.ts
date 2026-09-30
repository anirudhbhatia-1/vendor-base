import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants.js';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { AuditController } from './audit.controller.js';

test('the audit is read by audit readers and offers nothing but reads (11.9)', () => {
  const handlers = Object.getOwnPropertyNames(AuditController.prototype).filter(
    (name) => name !== 'constructor',
  );
  assert.deepEqual(handlers.sort(), ['detail', 'search']);
  for (const name of handlers) {
    const handler = (AuditController.prototype as unknown as Record<string, object>)[
      name
    ] as object;
    assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.GET, name);
    const rule = Reflect.getMetadata(
      AUTHORIZATION_REQUIREMENT,
      handler,
    ) as AuthorizationRequirement;
    assert.equal(rule.capability, 'admin.audit.read', name);
    assert.deepEqual(rule.admin_scope, { kind: 'GLOBAL' }, name);
  }
});
