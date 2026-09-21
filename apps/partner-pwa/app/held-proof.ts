/**
 * A completion held on the device without signal (9.7).
 *
 * The delivery's proof is the customer's code (DLP-30). At a door with no
 * signal the code is entered and cannot be sent, so the whole completion
 * command -- its stable command reference, the version it was built against,
 * the code, when it was captured -- is encrypted here and replayed when signal
 * returns. Until audit run 62 the app "held" a digest of nothing and sent it
 * to the server it could not reach; a held proof completed no delivery.
 *
 * What the encryption is for: a lost phone must not give up a customer's code
 * or door. AES-GCM under a per-device key that never leaves the key store
 * (non-extractable when the platform allows), with the assignment and the
 * partner as additional authenticated data, so a record cannot be replayed
 * against another job or by another account on the same phone. Without a key
 * store nothing is held: the partner is told to report to support instead of
 * being promised a hold the device cannot keep.
 */
export interface HeldCompletion {
  readonly command_reference: string;
  readonly expected_version: number;
  readonly otp: string;
  readonly proof_reference: string;
  readonly captured_at: string;
}

/** Where the device keeps its key: IndexedDB in the browser, memory in tests. */
export interface KeyStore {
  get(): Promise<CryptoKey | null>;
  set(key: CryptoKey): Promise<void>;
}

export interface HeldRecord {
  readonly assignment_id: string;
  readonly captured_at: string;
  /** The offline proof registered on reconnect, once it has been. */
  readonly offline_proof_id: string | null;
  /** Why the last replay was refused, if it was; the support path reads it. */
  readonly failure: string | null;
}

const PREFIX = 'partner.held-proof.';
const KEY_DB = 'partner-held-proof';
const KEY_STORE = 'keys';
const KEY_ID = 'device';

type Stored = HeldRecord & { readonly iv: string; readonly ciphertext: string };

function toBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function aad(assignmentId: string, partnerId: string): Uint8Array<ArrayBuffer> {
  const text = new TextEncoder().encode(`${assignmentId}:${partnerId}`);
  const bytes = new Uint8Array(new ArrayBuffer(text.byteLength));
  bytes.set(text);
  return bytes;
}

/** The browser's key store: one non-extractable AES key per device, in IndexedDB. */
export function browserKeyStore(): KeyStore | null {
  if (typeof indexedDB === 'undefined') return null;
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(KEY_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(KEY_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('key store unavailable'));
    });
  return {
    async get() {
      const db = await open();
      return new Promise<CryptoKey | null>((resolve, reject) => {
        const request = db.transaction(KEY_STORE, 'readonly').objectStore(KEY_STORE).get(KEY_ID);
        request.onsuccess = () => resolve((request.result as CryptoKey | undefined) ?? null);
        request.onerror = () => reject(request.error ?? new Error('key read failed'));
      });
    },
    async set(key) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const request = db
          .transaction(KEY_STORE, 'readwrite')
          .objectStore(KEY_STORE)
          .put(key, KEY_ID);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error('key write failed'));
      });
    },
  };
}

/** An in-memory key store, for tests and for a session that cannot persist one. */
export function memoryKeyStore(): KeyStore {
  let held: CryptoKey | null = null;
  return {
    get: async () => held,
    set: async (key) => {
      held = key;
    },
  };
}

async function deviceKey(keys: KeyStore): Promise<CryptoKey> {
  const existing = await keys.get();
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await keys.set(key);
  return key;
}

/** Holds a completion for this assignment and partner; returns the digest of what was stored. */
export async function holdCompletion(
  storage: Pick<Storage, 'setItem'>,
  keys: KeyStore,
  input: {
    readonly assignment_id: string;
    readonly partner_id: string;
    readonly completion: HeldCompletion;
  },
): Promise<{ readonly digest: string }> {
  const key = await deviceKey(keys);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(input.completion));
  const plaintext = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  plaintext.set(encoded);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad(input.assignment_id, input.partner_id) },
      key,
      plaintext,
    ),
  );
  const stored: Stored = {
    assignment_id: input.assignment_id,
    captured_at: input.completion.captured_at,
    offline_proof_id: null,
    failure: null,
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
  storage.setItem(`${PREFIX}${input.assignment_id}`, JSON.stringify(stored));
  return { digest: await digestOf(ciphertext) };
}

/** SHA-256 of the stored ciphertext: what the server is told, never the code. */
export async function digestOf(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readStored(storage: Pick<Storage, 'getItem'>, assignmentId: string): Stored | null {
  try {
    const raw = storage.getItem(`${PREFIX}${assignmentId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (
      typeof parsed.assignment_id !== 'string' ||
      typeof parsed.iv !== 'string' ||
      typeof parsed.ciphertext !== 'string' ||
      typeof parsed.captured_at !== 'string'
    ) {
      return null;
    }
    return {
      assignment_id: parsed.assignment_id,
      captured_at: parsed.captured_at,
      offline_proof_id:
        typeof parsed.offline_proof_id === 'string' ? parsed.offline_proof_id : null,
      failure: typeof parsed.failure === 'string' ? parsed.failure : null,
      iv: parsed.iv,
      ciphertext: parsed.ciphertext,
    };
  } catch {
    return null;
  }
}

/** The held completions on this device, without decrypting any. */
export function listHeld(
  storage: Pick<Storage, 'length' | 'key' | 'getItem'>,
): readonly HeldRecord[] {
  const records: HeldRecord[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const name = storage.key(index);
      if (!name?.startsWith(PREFIX)) continue;
      const stored = readStored(storage, name.slice(PREFIX.length));
      if (stored) {
        records.push({
          assignment_id: stored.assignment_id,
          captured_at: stored.captured_at,
          offline_proof_id: stored.offline_proof_id,
          failure: stored.failure,
        });
      }
    }
  } catch {
    // Storage denied: nothing is held.
  }
  return records;
}

/** The digest of what is held, for registering the proof on reconnect. */
export async function heldDigest(
  storage: Pick<Storage, 'getItem'>,
  assignmentId: string,
): Promise<string | null> {
  const stored = readStored(storage, assignmentId);
  return stored ? digestOf(fromBase64(stored.ciphertext)) : null;
}

/**
 * Opens a held completion. Fails -- returns null -- when the record was made
 * for another assignment or partner, or by another device's key.
 */
export async function recallCompletion(
  storage: Pick<Storage, 'getItem'>,
  keys: KeyStore,
  input: { readonly assignment_id: string; readonly partner_id: string },
): Promise<HeldCompletion | null> {
  const stored = readStored(storage, input.assignment_id);
  if (!stored) return null;
  const key = await keys.get();
  if (!key) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(stored.iv),
        additionalData: aad(input.assignment_id, input.partner_id),
      },
      key,
      fromBase64(stored.ciphertext),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<HeldCompletion>;
    if (
      typeof parsed.command_reference !== 'string' ||
      typeof parsed.expected_version !== 'number' ||
      typeof parsed.otp !== 'string' ||
      typeof parsed.proof_reference !== 'string' ||
      typeof parsed.captured_at !== 'string'
    ) {
      return null;
    }
    return {
      command_reference: parsed.command_reference,
      expected_version: parsed.expected_version,
      otp: parsed.otp,
      proof_reference: parsed.proof_reference,
      captured_at: parsed.captured_at,
    };
  } catch {
    return null;
  }
}

/** Notes the proof id the server gave, or why the replay was refused. */
export function annotateHeld(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  assignmentId: string,
  patch: Partial<Pick<HeldRecord, 'offline_proof_id' | 'failure'>>,
): void {
  const stored = readStored(storage, assignmentId);
  if (!stored) return;
  try {
    storage.setItem(`${PREFIX}${assignmentId}`, JSON.stringify({ ...stored, ...patch }));
  } catch {
    // The annotation is a convenience; the record stands.
  }
}

/** Removes the held completion once the server has confirmed it, or support has closed it. */
export function forgetHeld(storage: Pick<Storage, 'removeItem'>, assignmentId: string): void {
  try {
    storage.removeItem(`${PREFIX}${assignmentId}`);
  } catch {
    // Nothing to forget.
  }
}

/** What the partner is told about a held completion: never "delivered". */
export function heldSentence(record: HeldRecord, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(record.captured_at)) / 60_000));
  const age = minutes < 1 ? 'just now' : `${minutes} min ago`;
  if (record.failure) {
    return `Held ${age}. The server refused it (${record.failure.toLowerCase().replaceAll('_', ' ')}). Report it so operations can close the delivery with you.`;
  }
  return `Proof held on this device ${age}. The delivery is not confirmed yet — it sends when you have signal.`;
}
