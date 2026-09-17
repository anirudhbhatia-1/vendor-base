/**
 * Session persistence for the native shells, with no native import so it can
 * be tested in Node.
 *
 * Three apps carried this file, and by the time it was audited the three
 * copies had three different hashes: the vendor's cleared a companion value on
 * sign-out that the others did not know about, and the comments disagreed
 * about why the file existed. A credential store is the last thing that
 * should drift by copy. The behaviour is here once; each app binds it to
 * `expo-secure-store` with its own namespace and nothing else.
 *
 * D-15 requires Android credentials to live in SecureStore, which is what the
 * `writeOptions` (keychain accessibility) carry through to every write.
 */

export interface SecureStorageBackend {
  deleteItemAsync(key: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: Record<string, unknown>): Promise<void>;
}

export interface SecureTokenStorage<Companion extends string = never> {
  loadPersistedToken(): Promise<string | null>;
  /** An empty token is a sign-out: the credential is deleted, and every companion with it. */
  persistToken(token: string): Promise<void>;
  loadCompanion(name: Companion): Promise<string | null>;
  persistCompanion(name: Companion, value: string): Promise<void>;
}

/**
 * `companions` are per-account values that must not outlive the session --
 * the vendor's selected location, for instance. Leaving one behind meant the
 * next person to sign in on the same device inherited the previous account's
 * store until they noticed and retyped it.
 */
export function createSecureTokenStorage<Companion extends string = never>(input: {
  readonly namespace: 'admin' | 'customer' | 'partner' | 'vendor';
  readonly backend: SecureStorageBackend;
  readonly writeOptions?: Record<string, unknown>;
  readonly companions?: readonly Companion[];
}): SecureTokenStorage<Companion> {
  const tokenKey = `neighbourhood.${input.namespace}.token.v1`;
  const companionKey = (name: Companion) => `neighbourhood.${input.namespace}.${name}.v1`;
  const companions = input.companions ?? [];
  const writeOptions = input.writeOptions ?? {};

  async function write(key: string, value: string): Promise<void> {
    if (value) await input.backend.setItemAsync(key, value, writeOptions);
    else await input.backend.deleteItemAsync(key);
  }

  return {
    async loadPersistedToken() {
      return (await input.backend.getItemAsync(tokenKey)) || null;
    },
    async persistToken(token: string) {
      await write(tokenKey, token);
      if (!token) {
        for (const name of companions) await input.backend.deleteItemAsync(companionKey(name));
      }
    },
    async loadCompanion(name: Companion) {
      return (await input.backend.getItemAsync(companionKey(name))) || null;
    },
    async persistCompanion(name: Companion, value: string) {
      await write(companionKey(name), value);
    },
  };
}
