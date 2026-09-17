import { NextResponse, type NextRequest } from 'next/server';
import {
  customerCookiesSecure,
  customerMutationAllowed,
  customerOriginGuidance,
} from '../../../../customer-origin';
import { apiUrl, setSession, tokenShape } from '../../../session-cookies';

export async function POST(request: NextRequest) {
  if (!customerMutationAllowed(request)) {
    // A refusal caused by the address bar says so; every other refusal stays
    // deliberately uninformative.
    const guidance = customerOriginGuidance(request);
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', ...(guidance ? { message: guidance } : {}) } },
      { status: 403 },
    );
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return NextResponse.json({ error: { code: 'INVALID_ARGUMENT' } }, { status: 400 });
  const upstream = await fetch(`${apiUrl()}/auth/otp/verify`, {
    body: JSON.stringify({ ...body, customer_enrolment: true }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  }).catch(() => null);
  if (!upstream)
    return NextResponse.json(
      { error: { code: 'SIGN_IN_OUTCOME_UNKNOWN' } },
      {
        status: 503,
        headers: { 'cache-control': 'no-store' },
      },
    );
  const value: unknown = await upstream.json().catch(() => null);
  const tokens =
    value && typeof value === 'object' && 'tokens' in value
      ? (value as { tokens?: unknown }).tokens
      : null;
  if (!upstream.ok) {
    return NextResponse.json(value, { status: upstream.status });
  }
  if (!tokenShape(tokens)) {
    const consumed =
      value !== null &&
      typeof value === 'object' &&
      'outcome' in value &&
      value.outcome === 'already_verified';
    return NextResponse.json(
      { error: { code: consumed ? 'OTP_ALREADY_VERIFIED' : 'SESSION_RESPONSE_INVALID' } },
      { status: consumed ? 409 : 502, headers: { 'cache-control': 'no-store' } },
    );
  }
  // The API must attest that OTP consumption, customer enrolment and session
  // issuance committed together. Older API builds must not yield unusable cookies.
  if (
    !value ||
    typeof value !== 'object' ||
    !('customer_enrolled' in value) ||
    value.customer_enrolled !== true
  ) {
    return NextResponse.json(
      { error: { code: 'CUSTOMER_ENROLMENT_NOT_CONFIRMED' } },
      {
        status: 503,
        headers: { 'cache-control': 'no-store' },
      },
    );
  }
  const secure = customerCookiesSecure(request);
  const response = NextResponse.json(
    {
      authenticated: true,
      access_expires_at: tokens.access_expires_at,
      session_id: tokens.session_id,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
  setSession(response, tokens, secure);
  return response;
}
