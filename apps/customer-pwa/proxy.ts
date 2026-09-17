import { NextResponse, type NextRequest } from 'next/server';

/**
 * Routes that mean nothing without a session.
 *
 * `/cart` is deliberately absent. The basket is visible to everyone and the
 * page itself renders a guest basket for a visitor who has no session; paying
 * is what demands one, and the API enforces that. Leaving `/cart` here
 * redirected a guest to sign in before the page could render, so a basket a
 * visitor had just been encouraged to fill was unreachable.
 */
const protectedRoutes = ['/account', '/orders'] as const;

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const signedIn = Boolean(request.cookies.get('ns_customer_session')?.value);
  const protectedRoute = protectedRoutes.some(
    (route) => path === route || path.startsWith(`${route}/`),
  );

  if (protectedRoute && !signedIn) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = '';
    login.searchParams.set('next', path + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
