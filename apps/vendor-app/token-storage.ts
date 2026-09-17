/**
 * Binds the vendor session store to Expo SecureStore. The behaviour lives in
 * `@neighbourhood-store/app-auth`, which Node tests without a device.
 */
import * as SecureStore from 'expo-secure-store';
import { createSecureTokenStorage } from '@neighbourhood-store/app-auth';

const storage = createSecureTokenStorage({
  namespace: 'vendor',
  backend: SecureStore,
  writeOptions: { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY },
  companions: ['location'],
});

export const loadPersistedToken = (): Promise<string | null> => storage.loadPersistedToken();
export const persistToken = (token: string): Promise<void> => storage.persistToken(token);
export const loadPersistedVendorLocation = (): Promise<string | null> =>
  storage.loadCompanion('location');
export const persistVendorLocation = (vendorLocationId: string): Promise<void> =>
  storage.persistCompanion('location', vendorLocationId);
