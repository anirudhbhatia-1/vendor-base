import { createRequestContext, createUuidV7 } from '@neighbourhood-store/domain-types';
import { IdentityAccessService, IdentitySessionService, OtpIdentityService } from '../src/index.js';
import { loadDatabaseConfig } from '../src/config.js';
import { writeEvent } from '../src/output.js';

const config = loadDatabaseConfig('local');
const otp = new OtpIdentityService({
  connection_string: config.connectionString,
  hash_key: 'local-synthetic-otp-hash-material-only',
});
const sessions = new IdentitySessionService({
  connection_string: config.connectionString,
  otp_service: otp,
  token_hash_key: 'local-synthetic-session-token-hash-material',
});
const access = new IdentityAccessService({ connection_string: config.connectionString });
async function signIn(phone_identifier: string) {
  const device_id = createUuidV7();
  const challenge = await otp.requestChallenge({
    context: createRequestContext(),
    device_id,
    phone_identifier,
    request_key: `local-access-${createUuidV7().replaceAll('-', '')}`,
  });
  const code = await otp.readSyntheticOtpForTest(challenge.challenge_id);
  const result = await sessions.completeOtpSignIn({
    challenge_id: challenge.challenge_id,
    code,
    context: createRequestContext(),
    device_id,
    platform: 'WEB',
  });
  if (!result.tokens) throw new Error('Local moderator session was not issued');
  return result.tokens;
}
try {
  const grantor = await signIn('SYNTH-PHONE-ADMIN-GRANTOR-001');
  const moderator = await signIn('SYNTH-PHONE-ADMIN-CATALOGUE-001');
  await access.grantAdminMembership({
    context: createRequestContext({
      actor: { actor_id: grantor.user_id, actor_kind: 'admin', session_id: grantor.session_id },
    }),
    granted_by_user_id: grantor.user_id,
    role: 'CATALOGUE_MODERATOR',
    scope: { kind: 'GLOBAL' },
    user_id: moderator.user_id,
  });
  writeEvent('local.catalogue.moderator.created', { access_token: moderator.access_token });
} finally {
  await Promise.all([otp.close(), sessions.close(), access.close()]);
}
