import { NextResponse, type NextRequest } from 'next/server';
import { customerMutationAllowed, customerOriginGuidance } from '../../../../customer-origin';
import { apiUrl } from '../../../session-cookies';

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
  const upstream = await fetch(`${apiUrl()}/auth/otp/request`, {
    body: await request.text(),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  }).catch(() => null);
  if (!upstream)
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE' } },
      {
        status: 503,
        headers: { 'cache-control': 'no-store' },
      },
    );
  return new NextResponse(await upstream.arrayBuffer(), {
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
    status: upstream.status,
  });
}
