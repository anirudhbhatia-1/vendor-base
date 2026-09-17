import { NextResponse, type NextRequest } from 'next/server';
import { customerCookiesSecure, customerMutationAllowed } from '../../../customer-origin';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  apiUrl,
  clearSession,
  csrfTokenMatches,
  refreshSessionFromCookie,
  setSession,
  type Tokens,
} from '../../session-cookies';

function safePath(parts: readonly string[]): string {
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid backend path');
  }
  return parts.map(encodeURIComponent).join('/');
}

function mutationAllowed(request: NextRequest, hasSession: boolean): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  if (!customerMutationAllowed(request)) return false;
  if (!hasSession) return true;
  return csrfTokenMatches(request);
}

async function forward(
  request: NextRequest,
  path: string,
  accessToken: string | undefined,
  body: ArrayBuffer | null,
): Promise<Response> {
  const requestHeaders = request.headers;
  const forwarded = new Headers();
  for (const name of ['content-type', 'idempotency-key', 'x-request-id']) {
    const value = requestHeaders.get(name);
    if (value) forwarded.set(name, value);
  }
  if (accessToken) forwarded.set('authorization', `Bearer ${accessToken}`);
  const init: RequestInit = {
    headers: forwarded,
    method: request.method,
    redirect: 'manual',
    cache: 'no-store',
  };
  if (body !== null) init.body = body;
  return fetch(`${apiUrl()}/${path}${request.nextUrl.search}`, init);
}

async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const parts = (await context.params).path;
  let path: string;
  try {
    path = safePath(parts);
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_ARGUMENT' } }, { status: 400 });
  }
  // Token exchange is owned by /api/session and must never be exposed through
  // the transparent proxy.
  if (
    path.startsWith('auth/') &&
    !path.startsWith('auth/customer/') &&
    path !== 'auth/sessions' &&
    path !== 'auth/sessions/sign-out' &&
    !/^auth\/sessions\/[0-9a-f-]+\/revoke$/.test(path)
  ) {
    return NextResponse.json({ error: { code: 'RESOURCE_NOT_FOUND' } }, { status: 404 });
  }

  const cookieStore = request.cookies;
  const hasSession = cookieStore.has(SESSION_COOKIE);
  if (!mutationAllowed(request, hasSession)) {
    return NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
  }
  let tokens: Tokens | null = null;
  const requestBody =
    request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer();
  let upstream: Response;
  try {
    upstream = await forward(request, path, cookieStore.get(ACCESS_COOKIE)?.value, requestBody);
  } catch {
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE' } },
      {
        status: 503,
        headers: { 'cache-control': 'no-store' },
      },
    );
  }
  if (upstream.status === 401 && cookieStore.has(REFRESH_COOKIE)) {
    try {
      tokens = await refreshSessionFromCookie(request);
    } catch {
      return NextResponse.json(
        { error: { code: 'SERVICE_UNAVAILABLE' } },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }
    if (tokens) {
      try {
        upstream = await forward(request, path, tokens.access_token, requestBody);
      } catch {
        const unavailable = NextResponse.json(
          { error: { code: 'SERVICE_UNAVAILABLE' } },
          {
            status: 503,
            headers: { 'cache-control': 'no-store' },
          },
        );
        setSession(unavailable, tokens, customerCookiesSecure(request));
        return unavailable;
      }
    }
  }

  const body = await upstream.arrayBuffer();
  const upstreamRequestId = upstream.headers.get('x-request-id');
  const response = new NextResponse([204, 205, 304].includes(upstream.status) ? null : body, {
    headers: {
      'cache-control': 'no-store',
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      ...(upstreamRequestId ? { 'x-request-id': upstreamRequestId } : {}),
    },
    status: upstream.status,
  });
  const secure = customerCookiesSecure(request);
  if (tokens) setSession(response, tokens, secure);
  if (upstream.status === 401 && hasSession && !tokens) clearSession(response, secure);
  return response;
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
