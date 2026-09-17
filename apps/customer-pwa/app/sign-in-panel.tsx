'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type {
  CustomerSettings,
  Language,
  NotificationPreference,
} from '@neighbourhood-store/contracts';
import { ApiError } from '@neighbourhood-store/contracts';
import {
  type BrowserSession,
  customerApiClient,
  requestCustomerOtp,
  restoreCustomerSession,
  signOutCustomer,
  storeCustomerSession,
  verifyCustomerOtp,
} from './customer-session';
import { customerLoginReturn } from './login-return';

type Step = 'phone' | 'code' | 'verified';

function uuidV7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let timestamp = Date.now();
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function SignInPanel({
  redirectAfterSignIn = false,
  returnTo = '/',
}: {
  redirectAfterSignIn?: boolean;
  returnTo?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [deviceId] = useState(() => uuidV7());
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [settings, setSettings] = useState<CustomerSettings | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [language, setLanguage] = useState<Language>('EN');
  const [message, setMessage] = useState('Enter your mobile number to continue.');
  const [messageIsError, setMessageIsError] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

  /**
   * Status and failure shared one polite live region, so a screen reader queued
   * "that code was wrong" behind whatever it was already saying. Verification has a
   * bounded attempt count and the code expires, so a missed failure is not a cosmetic
   * problem: it can cost the attempt that locks the account out. Failures announce
   * assertively; ordinary progress stays polite so it does not interrupt.
   */
  const showStatus = (text: string) => {
    setMessageIsError(false);
    setMessage(text);
  };
  const showError = (text: string) => {
    setMessageIsError(true);
    setMessage(text);
  };

  function acceptSettings(next: CustomerSettings) {
    setSettings(next);
    setDisplayName(next.profile.display_name ?? '');
    setLanguage(next.profile.language);
  }

  async function reloadSettings() {
    const next = await (await customerApiClient()).auth.customerPreferences();
    acceptSettings(next);
  }

  useEffect(() => {
    let live = true;
    void restoreCustomerSession()
      .then(async (tokens) => {
        if (!live || !tokens) return;
        try {
          setSession(tokens);
          setStep('verified');
          if (redirectAfterSignIn) {
            router.replace(customerLoginReturn(returnTo));
            router.refresh();
            return;
          }
          await reloadSettings();
          if (!live) return;
          setStep('verified');
          showStatus('Your session was restored.');
        } catch {
          if (live)
            showError(
              'You are signed in, but account settings could not load. Retry loading them below.',
            );
        }
      })
      .catch((error: unknown) => {
        if (live && error instanceof ApiError && error.status === 403) setAccessDenied(true);
        if (live)
          showError(
            error instanceof Error
              ? error.message
              : 'Session checking is temporarily unavailable. Try again.',
          );
      });
    return () => {
      live = false;
    };
  }, []);

  async function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    showStatus('Requesting a verification code…');
    try {
      const body = await requestCustomerOtp({
        device_id: deviceId,
        phone_identifier: phone,
        request_key: `signin-${uuidV7().replaceAll('-', '')}`,
      });
      setChallengeId(body.challenge_id);
      setStep('code');
      showStatus('Verification code requested. Enter the six-digit code to continue.');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'The request could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    showStatus('Verifying code and enrolling this account as a customer…');
    try {
      const session = await verifyCustomerOtp({
        challenge_id: challengeId,
        code,
        device_id: deviceId,
      });
      storeCustomerSession(session);
      setSession(session);
      setStep('verified');
      setCode('');
      setChallengeId('');
      showStatus('Signed in successfully.');
      if (redirectAfterSignIn) {
        router.replace(customerLoginReturn(returnTo));
        router.refresh();
        return;
      }
      await reloadSettings().catch(() =>
        showError(
          'You are signed in, but account settings could not load. Retry loading them below.',
        ),
      );
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Verification could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !settings) return;
    setBusy(true);
    try {
      await (
        await customerApiClient()
      ).auth.updateProfile({
        display_name: displayName.trim() || null,
        expected_version: settings.profile.version,
        language,
      });
      await reloadSettings();
      showStatus('Optional profile and language preference saved.');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Profile was not saved.');
    } finally {
      setBusy(false);
    }
  }

  async function changeMarketingConsent() {
    if (!session || !settings) return;
    const granted = settings.consents.some(
      (consent) => consent.consent_kind === 'MARKETING' && consent.decision === 'GRANTED',
    );
    setBusy(true);
    try {
      await (
        await customerApiClient()
      ).auth.updateConsent({
        consent_kind: 'MARKETING',
        decision: granted ? 'WITHDRAWN' : 'GRANTED',
        policy_version: 'marketing.v1',
        source: 'CUSTOMER_PWA',
      });
      await reloadSettings();
      showStatus(granted ? 'Marketing consent withdrawn.' : 'Marketing consent granted.');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Consent was not changed.');
    } finally {
      setBusy(false);
    }
  }

  async function changeNotification(preference: NotificationPreference) {
    if (!session) return;
    setBusy(true);
    try {
      await (
        await customerApiClient()
      ).auth.updateNotification(preference.notification_kind, preference.channel, {
        enabled: !preference.effective_enabled,
        expected_version: preference.version,
      });
      await reloadSettings();
      showStatus('Notification preference saved. Required alerts remain enabled.');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Preference was not changed.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    showStatus('Signing out…');
    try {
      await signOutCustomer();
      setSession(null);
      setAccessDenied(false);
      setSettings(null);
      setCode('');
      setChallengeId('');
      setStep('phone');
      showStatus('Signed out securely.');
      router.replace('/login');
      router.refresh();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Sign-out could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  const marketingGranted = settings?.consents.some(
    (consent) => consent.consent_kind === 'MARKETING' && consent.decision === 'GRANTED',
  );

  return (
    <section className="sign-in-card" aria-labelledby="sign-in-title">
      <div className="sign-in-heading">
        <p className="step-label">
          {step === 'verified'
            ? 'Account settings'
            : `Sign in · Step ${step === 'phone' ? '1' : '2'} of 2`}
        </p>
        <h2 id="sign-in-title">
          {step === 'verified' ? 'Profile and preferences' : 'Sign in safely'}
        </h2>
      </div>

      {step === 'phone' && !accessDenied && (
        <form onSubmit={requestOtp}>
          <label htmlFor="phone-identifier">Mobile number</label>
          {/* The API accepts an E.164 number or a SYNTH-PHONE-… development
              identity. This field allowed only the former, so every seeded
              local identity was rejected by the browser before a request was
              ever made: the form simply refused to submit. */}
          <input
            id="phone-identifier"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            pattern="(\+[1-9][0-9]{7,14}|SYNTH-PHONE-[A-Za-z0-9][A-Za-z0-9-]{2,47})"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+919876543210"
            required
          />
          <p className="field-help">Include the country code, for example +919876543210.</p>
          <button type="submit" disabled={busy}>
            {busy ? 'Requesting…' : 'Send verification code'}
          </button>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={verifyOtp}>
          <label htmlFor="otp-code">Six-digit verification code</label>
          <input
            id="otp-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            required
          />
          <div className="button-row">
            <button type="submit" disabled={busy}>
              {busy ? 'Checking…' : 'Verify code'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setStep('phone');
                setCode('');
              }}
              disabled={busy}
            >
              Use another identifier
            </button>
          </div>
        </form>
      )}

      {step === 'verified' && session && settings && (
        <div className="customer-settings">
          <p className="session-note">
            Session active until{' '}
            <time dateTime={session.access_expires_at}>
              {new Date(session.access_expires_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
            . This device keeps a rotating session until it expires, is revoked, or you sign out.
          </p>
          <form onSubmit={saveProfile} className="settings-block">
            <h3>Optional profile</h3>
            <label htmlFor="display-name">Display name</label>
            <input
              id="display-name"
              maxLength={80}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Leave blank if you prefer"
            />
            <label htmlFor="language">Language</label>
            <select
              id="language"
              value={language}
              onChange={(event) => setLanguage(event.target.value as Language)}
            >
              <option value="EN">English</option>
              <option value="HI">हिन्दी</option>
            </select>
            <button type="submit" disabled={busy}>
              Save profile
            </button>
          </form>
          <div className="settings-block">
            <h3>Consent</h3>
            <p className="field-help">
              Marketing is off unless you explicitly allow it. Every change creates a versioned
              record.
            </p>
            <button
              type="button"
              className="secondary"
              onClick={changeMarketingConsent}
              disabled={busy}
            >
              {marketingGranted ? 'Withdraw marketing consent' : 'Allow marketing'}
            </button>
          </div>
          <div className="settings-block">
            <h3>Notifications</h3>
            <ul className="preference-list">
              {settings.notifications.map((preference) => (
                <li key={`${preference.notification_kind}-${preference.channel}`}>
                  <span>
                    {preference.notification_kind.replace('_', ' ')} · {preference.channel}
                  </span>
                  {preference.user_controllable ? (
                    <button
                      type="button"
                      className="compact secondary"
                      disabled={busy}
                      onClick={() => changeNotification(preference)}
                    >
                      {preference.effective_enabled ? 'Turn off' : 'Turn on'}
                    </button>
                  ) : (
                    <strong>Required</strong>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <button type="button" onClick={signOut} disabled={busy}>
            {busy ? 'Working…' : 'Sign out of this device'}
          </button>
        </div>
      )}

      {step === 'verified' && session && !settings ? (
        <div className="button-row">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void reloadSettings()
                .then(() => showStatus('Account settings loaded.'))
                .catch(() =>
                  showError('Account settings are still unavailable. Your sign-in has been kept.'),
                )
                .finally(() => setBusy(false));
            }}
          >
            Retry account settings
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      ) : null}

      {accessDenied ? (
        <button type="button" disabled={busy} onClick={() => void signOut()}>
          Sign out to use another account
        </button>
      ) : null}

      {messageIsError ? (
        <p className="status-message status-message-error" role="alert">
          {message}
        </p>
      ) : (
        <p className="status-message" role="status" aria-live="polite">
          {message}
        </p>
      )}
    </section>
  );
}
