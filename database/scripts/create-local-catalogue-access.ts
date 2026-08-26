import { createRequestContext, createUuidV7 } from '@neighbourhood-store/domain-types';
import {
  IdentityAccessService,
  IdentitySessionService,
  OtpIdentityService,
  VendorNetworkService,
} from '../src/index.js';
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
const network = new VendorNetworkService({ connection_string: config.connectionString });

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
  if (!result.tokens) throw new Error('Local access session was not issued');
  return result.tokens;
}

try {
  const token = await signIn('SYNTH-PHONE-VENDOR-CATALOGUE-001');
  const context = createRequestContext({
    actor: { actor_id: token.user_id, actor_kind: 'vendor_staff', session_id: token.session_id },
  });
  const vendor = await network.createVendor({
    business_name: 'SYNTH Jain Stores Test',
    context,
    vendor_id: createUuidV7(),
  });
  await network.transitionVendor({
    context,
    expected_version: vendor.version,
    reason_code: 'LOCAL_TEST_ACTIVATE',
    to_state: 'ACTIVE',
    vendor_id: vendor.vendor_id,
  });
  const location = await network.createLocation({
    category: 'FRUIT_VEGETABLE',
    context,
    latitude: 26.8467,
    location_name: 'SYNTH Jain Stores 302020',
    longitude: 75.7794,
    minimum_order_minor: 0,
    operating_timezone: 'Asia/Kolkata',
    preparation_seconds: 1200,
    vendor_id: vendor.vendor_id,
    vendor_location_id: createUuidV7(),
  });
  await network.transitionLocation({
    context,
    expected_version: location.version,
    reason_code: 'LOCAL_TEST_ACTIVATE',
    to_state: 'ACTIVE',
    vendor_location_id: location.vendor_location_id,
  });
  await access.grantVendorMembership({
    context,
    granted_by_user_id: token.user_id,
    role: 'VENDOR_MANAGER',
    user_id: token.user_id,
    vendor_location_id: location.vendor_location_id,
  });
  writeEvent('local.catalogue.access.created', {
    access_token: token.access_token,
    vendor_location_id: location.vendor_location_id,
  });
} finally {
  await Promise.all([otp.close(), sessions.close(), access.close(), network.close()]);
}
