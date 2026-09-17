import { JsonLogger } from '@neighbourhood-store/domain-types';
import { optionalMessageContext } from './message-context.js';

/** The shared structured logger, reading the message being processed. */
export const workerLogger = new JsonLogger('marketplace-worker', optionalMessageContext, {
  stdout: (line) => process.stdout.write(line),
  stderr: (line) => process.stderr.write(line),
});
