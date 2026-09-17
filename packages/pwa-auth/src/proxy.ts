import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * The server-side session gate a role workspace's `proxy.ts` installs.
 *
 * Three copies existed, identical except for where a signed-in visitor to
 * `/login` is sent. This is defence in depth beside `RequireWorkspaceRole`:
 * the static export ships with no proxy at all, so nothing here is the
 * security boundary -- the API is.
 */
export function createSessionProxy(options: { readonly homePath: string }) {
  async function proxy(request: NextRequest) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const login = new URL('/login', request.url);
    if (!url || !key) {
      return request.nextUrl.pathname === '/login'
        ? NextResponse.next()
        : NextResponse.redirect(login);
    }
    let response = NextResponse.next({ request });
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          for (const cookie of cookies) request.cookies.set(cookie.name, cookie.value);
          response = NextResponse.next({ request });
          for (const cookie of cookies) {
            response.cookies.set(cookie.name, cookie.value, cookie.options);
          }
        },
      },
    });
    const { data, error } = await supabase.auth.getUser();
    if ((error || !data.user) && request.nextUrl.pathname !== '/login') {
      return NextResponse.redirect(login);
    }
    if (data.user && request.nextUrl.pathname === '/login') {
      return NextResponse.redirect(new URL(options.homePath, request.url));
    }
    return response;
  }

  const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
  };

  return { proxy, config };
}
