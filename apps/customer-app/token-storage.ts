import * as SecureStore from 'expo-secure-store';
import type { SessionTokens } from '@neighbourhood-store/contracts';

const SESSION_KEY = 'neighbourhood.customer.session.v1';

export async function loadPersistedSession(): Promise<SessionTokens | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SessionTokens>;
    return typeof value.access_token === 'string' &&
      typeof value.refresh_token === 'string' &&
      typeof value.session_id === 'string' &&
      typeof value.access_expires_at === 'string'
      ? (value as SessionTokens)
      : null;
  } catch {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    return null;
  }
}

export async function persistSession(tokens: SessionTokens | null): Promise<void> {
  if (!tokens) {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    return;
  }
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(tokens), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}
