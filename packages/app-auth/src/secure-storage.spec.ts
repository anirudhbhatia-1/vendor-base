import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createSecureTokenStorage, type SecureStorageBackend } from './secure-storage.js';

/** Stands in for expo-secure-store, recording what actually reached the keychain. */
function fakeBackend(): SecureStorageBackend & {
  deleted: string[];
  items: Map<string, string>;
  options: Record<string, unknown> | undefined;
} {
  const items = new Map<string, string>();
  const deleted: string[] = [];
  let options: Record<string, unknown> | undefined;
  return {
    deleted,
    items,
    get options() {
      return options;
    },
    async deleteItemAsync(key) {
      deleted.push(key);
      items.delete(key);
    },
    async getItemAsync(key) {
      return items.get(key) ?? null;
    },
    async setItemAsync(key, value, written) {
      options = written;
      items.set(key, value);
    },
  };
}

describe('secure token storage', () => {
  let backend: ReturnType<typeof fakeBackend>;
  let storage: ReturnType<typeof createSecureTokenStorage<'location'>>;

  beforeEach(() => {
    backend = fakeBackend();
    storage = createSecureTokenStorage({
      namespace: 'vendor',
      backend,
      writeOptions: { keychainAccessible: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY' },
      companions: ['location'],
    });
  });

  it('reports no session before anything is stored', async () => {
    assert.equal(await storage.loadPersistedToken(), null);
    assert.equal(await storage.loadCompanion('location'), null);
  });

  it('restores the token and companions a previous process wrote', async () => {
    await storage.persistToken('token-a');
    await storage.persistCompanion('location', 'loc-1');
    assert.equal(await storage.loadPersistedToken(), 'token-a');
    assert.equal(await storage.loadCompanion('location'), 'loc-1');
  });

  it('namespaces keys per app so two shells on one device cannot read each other', async () => {
    const partner = createSecureTokenStorage({ namespace: 'partner', backend });
    await storage.persistToken('vendor-token');
    await partner.persistToken('partner-token');
    assert.deepEqual([...backend.items.keys()].sort(), [
      'neighbourhood.partner.token.v1',
      'neighbourhood.vendor.token.v1',
    ]);
    assert.equal(await partner.loadPersistedToken(), 'partner-token');
  });

  it('passes the caller-supplied keychain protection through to every write', async () => {
    await storage.persistToken('token-a');
    assert.deepEqual(backend.options, {
      keychainAccessible: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    });
    await storage.persistCompanion('location', 'loc-1');
    assert.deepEqual(backend.options, {
      keychainAccessible: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    });
  });

  it('removes the credential from the keychain on sign-out rather than storing an empty one', async () => {
    await storage.persistToken('token-a');
    await storage.persistToken('');
    assert.equal(backend.items.has('neighbourhood.vendor.token.v1'), false);
    assert.ok(backend.deleted.includes('neighbourhood.vendor.token.v1'));
  });

  it('clears every companion on sign-out so the next account cannot inherit them', async () => {
    // This is the rule two of the three copies had lost.
    await storage.persistToken('token-a');
    await storage.persistCompanion('location', 'loc-1');
    await storage.persistToken('');
    assert.equal(await storage.loadCompanion('location'), null);
    assert.ok(backend.deleted.includes('neighbourhood.vendor.location.v1'));
  });
});
