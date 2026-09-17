/**
 * Binds the admin session store to Expo SecureStore. The behaviour lives in
 * `@neighbourhood-store/app-auth`, which Node tests without a device.
 */
import * as SecureStore from 'expo-secure-store';
import { createSecureTokenStorage } from '@neighbourhood-store/app-auth';

const storage = createSecureTokenStorage({
  namespace: 'admin',
  backend: SecureStore,
  writeOptions: { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY },
});

export const loadPersistedToken = (): Promise<string | null> => storage.loadPersistedToken();
export const persistToken = (token: string): Promise<void> => storage.persistToken(token);
