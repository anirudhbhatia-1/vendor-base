import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  authenticatedFetch,
  authenticatedJson,
  hasSupabaseConfig,
  revokeAndSignOut,
} from './index.js';

type SignOutCall = { readonly scope?: string };

/**
 * A Supabase client stub with only the two calls this module makes.
 *
 * Cast at the boundary rather than typed all the way through: widening the real
 * client's surface into the test would test the stub, not the module.
 */
function stubClient(input: {
  readonly token?: string | null;
  readonly sessionError?: boolean;
  readonly signOutFails?: boolean;
  readonly signOuts?: SignOutCall[];
}): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({
        data: { session: input.token ? { access_token: input.token } : null },
        error: input.sessionError ? new Error('no session') : null,
      }),
      signOut: async (options?: SignOutCall) => {
        input.signOuts?.push(options ?? {});
        return { error: input.signOutFails && options?.scope === 'global' ? new Error('x') : null };
      },
    },
  } as unknown as SupabaseClient;
}

function withFetch(handler: typeof fetch, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test('a client is only created when both halves of the config are present', () => {
  assert.equal(hasSupabaseConfig({ anonKey: 'k', url: 'https://p.supabase.co' }), true);
  assert.equal(hasSupabaseConfig({ anonKey: undefined, url: 'https://p.supabase.co' }), false);
  assert.equal(hasSupabaseConfig({ anonKey: 'k', url: undefined }), false);
});

test('a request without a live session fails before it is sent', async () => {
  let sent = false;
  await withFetch(
    (async () => {
      sent = true;
      return new Response('{}');
    }) as typeof fetch,
    async () => {
      await assert.rejects(
        () => authenticatedFetch(stubClient({ token: null }), 'http://api.test/x'),
        /session has expired/,
      );
    },
  );
  assert.equal(sent, false, 'an unauthenticated request must never reach the network');
});

test('the access token is attached, and a body gets a content type', async () => {
  const seenHeaders: Headers[] = [];
  await withFetch(
    (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenHeaders.push(new Headers(init?.headers));
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
    async () => {
      await authenticatedFetch(stubClient({ token: 'abc' }), 'http://api.test/x', {
        body: '{"a":1}',
        method: 'POST',
      });
    },
  );
  assert.equal(seenHeaders[0]?.get('authorization'), 'Bearer abc');
  assert.equal(seenHeaders[0]?.get('content-type'), 'application/json');
});

/**
 * The API answers with a stable code because it localises client side. Showing
 * that code to a person was the defect: a partner mid-delivery was being told
 * `RESOURCE_NOT_FOUND`.
 */
test('a stable error code becomes a sentence, and stays on the error for branching', async () => {
  await withFetch(
    (async () =>
      new Response(JSON.stringify({ error: { code: 'VERSION_CONFLICT' } }), {
        headers: { 'content-type': 'application/json' },
        status: 409,
      })) as typeof fetch,
    async () => {
      let failure: (Error & { code?: string; status?: number }) | null = null;
      try {
        await authenticatedJson(stubClient({ token: 'abc' }), 'http://api.test/x');
      } catch (error) {
        failure = error as Error & { code?: string };
      }
      assert.ok(failure, 'a 409 must reject');
      assert.match(failure.message, /Something changed while you were working/);
      assert.equal(failure.code, 'VERSION_CONFLICT');
      assert.equal(failure.status, 409);
    },
  );
});

test('every stable code the API can answer with has a sentence, from the one shared table', async () => {
  // Two clients each kept their own table and drifted by twelve codes. The
  // table now lives beside the codes and is typed over all of them; this reads
  // a code that only ever existed in one of the old tables, through the
  // request helper, to show the helper resolves from the shared one.
  await withFetch(
    (async () =>
      new Response(JSON.stringify({ error: { code: 'PARTNER_NOT_PRESENT' } }), {
        headers: { 'content-type': 'application/json' },
        status: 409,
      })) as typeof fetch,
    async () => {
      let failure: Error | null = null;
      try {
        await authenticatedJson(stubClient({ token: 'abc' }), 'http://api.test/x');
      } catch (error) {
        failure = error as Error;
      }
      assert.ok(failure);
      assert.match(failure.message, /delivery partner is at your counter/);
    },
  );
});

test('an unrecognised failure still says something a person can act on', async () => {
  await withFetch(
    (async () => new Response('not json', { status: 502 })) as typeof fetch,
    async () => {
      await assert.rejects(
        () => authenticatedJson(stubClient({ token: 'abc' }), 'http://api.test/x'),
        /Something went wrong \(502\)\. Try again\./,
      );
    },
  );
});

test('a 204 resolves rather than failing to parse an empty body', async () => {
  await withFetch((async () => new Response(null, { status: 204 })) as typeof fetch, async () => {
    assert.equal(
      await authenticatedJson(stubClient({ token: 'abc' }), 'http://api.test/x'),
      undefined,
    );
  });
});

test('signing out ends every device, and still clears this one when it cannot', async () => {
  const signOuts: SignOutCall[] = [];
  await withFetch((async () => new Response(null, { status: 204 })) as typeof fetch, async () => {
    await revokeAndSignOut({
      apiUrl: 'http://api.test',
      client: stubClient({ signOutFails: true, signOuts, token: 'abc' }),
    });
  });
  assert.deepEqual(
    signOuts.map((call) => call.scope),
    ['global', 'local'],
    'a failed global sign-out must not leave the device in front of the user signed in',
  );
});

test('a marketplace session that cannot be revoked is not treated as signed out', async () => {
  await withFetch((async () => new Response('{}', { status: 500 })) as typeof fetch, async () => {
    await assert.rejects(
      () =>
        revokeAndSignOut({
          apiUrl: 'http://api.test',
          client: stubClient({ token: 'abc' }),
        }),
      /could not be revoked/,
    );
  });
});
