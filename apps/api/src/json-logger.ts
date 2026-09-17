import { JsonLogger } from '@neighbourhood-store/domain-types';
import { optionalRequestContext } from './request-context-storage.js';

/** The shared structured logger, reading the HTTP request's context. */
export const apiLogger = new JsonLogger('marketplace-api', optionalRequestContext, {
  stdout: (line) => process.stdout.write(line),
  stderr: (line) => process.stderr.write(line),
});
