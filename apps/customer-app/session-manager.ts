import { ApiError, type SessionTokens } from '@neighbourhood-store/contracts';

/** One refresh at a time; logout invalidates any outstanding refresh response. */
export function createSessionManager(input: {
  read: () => Promise<SessionTokens | null>;
  write: (tokens: SessionTokens | null) => Promise<void>;
  refresh: (token: string) => Promise<SessionTokens>;
  now?: () => number;
}) {
  let current: SessionTokens | null = null;
  let generation = 0;
  let refreshing: Promise<SessionTokens | null> | null = null;
  let writes: Promise<void> = Promise.resolve();
  const save = (tokens: SessionTokens | null) => {
    writes = writes.catch(() => undefined).then(() => input.write(tokens));
    return writes;
  };
  return {
    async restore() {
      const started = generation;
      const stored = await input.read();
      if (generation === started) current = stored;
      return current;
    },
    async set(tokens: SessionTokens | null) {
      generation += 1;
      refreshing = null;
      current = tokens;
      await save(tokens);
    },
    async valid(): Promise<SessionTokens | null> {
      if (!current) return null;
      if (Date.parse(current.access_expires_at) > (input.now?.() ?? Date.now()) + 60_000)
        return current;
      if (refreshing) return refreshing;
      const started = generation;
      const refreshToken = current.refresh_token;
      const operation = input
        .refresh(refreshToken)
        .then(async (tokens) => {
          if (generation !== started) return null;
          current = tokens;
          await save(tokens);
          return tokens;
        })
        .catch(async (error: unknown) => {
          if (generation !== started) return null;
          if (generation === started && error instanceof ApiError && error.status === 401) {
            current = null;
            await save(null);
          }
          throw error;
        })
        .finally(() => {
          if (refreshing === operation) refreshing = null;
        });
      refreshing = operation;
      return operation;
    },
  };
}
