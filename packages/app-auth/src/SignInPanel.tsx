import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, createApiClient, type SessionTokens } from '@neighbourhood-store/contracts';
import { colors, radii, spacing } from '@neighbourhood-store/ui-tokens/native';

/**
 * The sign-in screen the four Expo shells share.
 *
 * Each shell had grown its own: a bearer-token text box in two of them, a
 * phone/OTP flow in the customer app, and nothing at all in the admin app.
 * The flows are the same everywhere -- a phone identity verified by OTP
 * through the API, or, where the console provisioned the account as a
 * Supabase email identity, email and password -- so the differences are
 * props: the role word, the accent colour, and whether a Supabase client is
 * available at all.
 *
 * Nothing here decides what the account may do. The API's guards do; this
 * screen only obtains a credential and hands it to the shell.
 */
export type SignInRole = 'admin' | 'customer' | 'partner' | 'vendor';

/** What the shell receives: the bearer token, and the full token set where the API issued one. */
export type NativeSession = {
  readonly access_token: string;
  /** Present after an OTP sign-in; `null` after a Supabase email sign-in. */
  readonly tokens: SessionTokens | null;
};

/**
 * The part of a Supabase client this screen uses, kept structural so the
 * package neither depends on the SDK's types nor forces a client on shells
 * that only sign in by phone.
 */
export type EmailSignInClient = {
  readonly auth: {
    signInWithPassword(credentials: { email: string; password: string }): Promise<{
      data: { session: { access_token: string } | null };
      error: { message: string } | null;
    }>;
    signOut(): Promise<unknown>;
  };
};

export type SignInPanelProps = {
  readonly role: SignInRole;
  readonly onSession: (session: NativeSession | null) => void;
  /** The button colour; defaults to the evergreen brand tone. */
  readonly accent?: string;
  /** Defaults to `EXPO_PUBLIC_API_URL`, else the Android emulator's host loopback. */
  readonly apiUrl?: string;
  /** Pre-filled phone identifier, for synthetic test identities. */
  readonly defaultPhone?: string;
  /** Offered as a second method when present; `null` when the shell has no Supabase config. */
  readonly supabase?: EmailSignInClient | null;
};

type Method = 'phone' | 'email';
type Step = 'phone' | 'code';

const ROLE_TITLE: Record<SignInRole, string> = {
  admin: 'Admin sign-in',
  customer: 'Sign in to shop',
  partner: 'Partner sign-in',
  vendor: 'Store sign-in',
};

const globalEnv =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

function defaultApiUrl(): string {
  return globalEnv['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:3001';
}

/**
 * An opaque per-launch identifier. Hermes has no `crypto.randomUUID`, and the
 * API only needs the value to be stable across the request/verify pair and
 * to satisfy its key pattern.
 */
function randomToken(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function describe(error: unknown): string {
  if (error instanceof ApiError)
    return error.code ? `${error.message} (${error.code})` : error.message;
  if (error instanceof Error) return error.message;
  return 'Sign-in failed.';
}

export function SignInPanel(props: SignInPanelProps) {
  const accent = props.accent ?? colors.evergreen;
  const apiUrl = props.apiUrl ?? defaultApiUrl();
  const emailAvailable = Boolean(props.supabase);

  const [method, setMethod] = useState<Method>('phone');
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState(props.defaultPhone ?? '');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deviceId] = useState(() => `device-${randomToken(24)}`);

  const api = createApiClient({ baseUrl: apiUrl, getToken: () => null });

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      setMessage(describe(error));
    } finally {
      setBusy(false);
    }
  }

  function requestCode() {
    void run(async () => {
      const trimmed = phone.trim();
      if (!trimmed) throw new Error('Enter your phone number.');
      const challenge = await api.auth.requestOtp({
        device_id: deviceId,
        phone_identifier: trimmed,
        request_key: `signin-${randomToken(32)}`,
      });
      setChallengeId(challenge.challenge_id);
      setCode('');
      setStep('code');
    });
  }

  function verifyCode() {
    void run(async () => {
      if (!challengeId) throw new Error('Request a code first.');
      const trimmed = code.trim();
      if (!trimmed) throw new Error('Enter the code you received.');
      const verified =
        props.role === 'customer'
          ? await api.auth.verifyCustomerOtp({
              challenge_id: challengeId,
              code: trimmed,
              device_id: deviceId,
              platform: 'ANDROID',
            })
          : await api.auth.verifyOtp({
              challenge_id: challengeId,
              code: trimmed,
              device_id: deviceId,
            });
      if (!verified.tokens) throw new Error('That code was not accepted. Request a new one.');
      props.onSession({ access_token: verified.tokens.access_token, tokens: verified.tokens });
    });
  }

  function signInWithEmail() {
    void run(async () => {
      const supabase = props.supabase;
      if (!supabase) throw new Error('Email sign-in is not configured for this app.');
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw new Error(error.message);
      const token = data.session?.access_token;
      if (!token) throw new Error('Sign-in succeeded but no session was returned.');
      // The account must belong to this shell's workspace; the web login page
      // makes the same check, and signs out again on a mismatch.
      const who = await fetch(`${apiUrl}/auth/whoami`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!who.ok) throw new Error(`Could not confirm the account's workspace (${who.status}).`);
      const body = (await who.json()) as { primary_role?: string };
      if (body.primary_role !== props.role) {
        await supabase.auth.signOut();
        throw new Error(
          `This account belongs to the ${body.primary_role ?? 'unknown'} workspace, not ${props.role}.`,
        );
      }
      props.onSession({ access_token: token, tokens: null });
    });
  }

  return (
    <View style={styles.panel} accessibilityRole="none" testID={`sign-in-${props.role}`}>
      <Text style={styles.title}>{ROLE_TITLE[props.role]}</Text>
      {emailAvailable && (
        <View style={styles.methods}>
          {(['phone', 'email'] as const).map((candidate) => (
            <Pressable
              key={candidate}
              accessibilityRole="button"
              accessibilityState={{ selected: method === candidate }}
              onPress={() => {
                setMethod(candidate);
                setMessage(null);
              }}
              style={[styles.method, method === candidate && { borderColor: accent }]}
            >
              <Text style={styles.methodText}>
                {candidate === 'phone' ? 'Phone code' : 'Email & password'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {method === 'phone' && step === 'phone' && (
        <>
          <Text style={styles.label}>Phone number</Text>
          <TextInput
            accessibilityLabel="Phone number"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            keyboardType="phone-pad"
            onChangeText={setPhone}
            placeholder="+919876543210"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            value={phone}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={requestCode}
            style={[styles.button, { backgroundColor: accent }, busy && styles.buttonBusy]}
          >
            {busy ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={styles.buttonText}>Send verification code</Text>
            )}
          </Pressable>
        </>
      )}

      {method === 'phone' && step === 'code' && (
        <>
          <Text style={styles.label}>Verification code</Text>
          <Text style={styles.help}>Sent to {phone.trim()}.</Text>
          <TextInput
            accessibilityLabel="Verification code"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            keyboardType="number-pad"
            maxLength={8}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            value={code}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={verifyCode}
            style={[styles.button, { backgroundColor: accent }, busy && styles.buttonBusy]}
          >
            {busy ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={styles.buttonText}>Verify and sign in</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              setStep('phone');
              setChallengeId(null);
              setMessage(null);
            }}
            style={styles.link}
          >
            <Text style={styles.linkText}>Use a different number</Text>
          </Pressable>
        </>
      )}

      {method === 'email' && (
        <>
          <Text style={styles.label}>Email</Text>
          <TextInput
            accessibilityLabel="Email"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            editable={!busy}
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            value={email}
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            accessibilityLabel="Password"
            autoCapitalize="none"
            autoComplete="current-password"
            editable={!busy}
            onChangeText={setPassword}
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
            style={styles.input}
            value={password}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={signInWithEmail}
            style={[styles.button, { backgroundColor: accent }, busy && styles.buttonBusy]}
          >
            {busy ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>
        </>
      )}

      {message && (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.alert}>
          {message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.panel,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  methods: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  method: {
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  methodText: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  label: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  help: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  input: {
    backgroundColor: colors.canvas,
    borderColor: colors.border,
    borderRadius: radii.control,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  button: {
    alignItems: 'center',
    borderRadius: radii.control,
    marginTop: spacing.xs,
    paddingVertical: spacing.sm,
  },
  buttonBusy: {
    opacity: 0.7,
  },
  buttonText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '700',
  },
  link: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  linkText: {
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
  alert: {
    color: colors.danger,
    marginTop: spacing.xs,
  },
});
