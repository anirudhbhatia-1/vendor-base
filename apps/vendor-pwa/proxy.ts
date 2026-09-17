import { createSessionProxy } from '@neighbourhood-store/pwa-auth/proxy';

// Next reads this file's exports statically: `proxy` must be a plain named
// export and `config` a literal object, so neither can come out of a
// destructured call result. The matcher is therefore spelled out here rather
// than taken from the shared helper.
const session = createSessionProxy({ homePath: '/catalogue' });

export const proxy = session.proxy;

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
