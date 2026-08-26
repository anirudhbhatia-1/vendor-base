'use client';

import { useState, type FormEvent } from 'react';

type Step = 'phone' | 'code' | 'verified';
type SessionTokens = {
  access_expires_at: string;
  access_token: string;
  refresh_token: string;
  session_id: string;
};
type Consent = { consent_kind: string; decision: 'GRANTED' | 'WITHDRAWN' };
type NotificationPreference = {
  channel: 'PUSH' | 'SMS';
  effective_enabled: boolean;
  notification_kind: 'MARKETING' | 'ORDER_STATUS' | 'SECURITY' | 'SUPPORT';
  preference_enabled: boolean | null;
  user_controllable: boolean;
  version: number;
};
type CustomerSettings = {
  consents: Consent[];
  notifications: NotificationPreference[];
  profile: { display_name: string | null; language: 'EN' | 'HI'; version: number };
};

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

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

export function SignInPanel() {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('SYNTH-PHONE-CUSTOMER-001');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [deviceId] = useState(() => uuidV7());
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<SessionTokens | null>(null);
  const [settings, setSettings] = useState<CustomerSettings | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [language, setLanguage] = useState<'EN' | 'HI'>('EN');
  const [message, setMessage] = useState('Use a fictional identifier. No SMS will be sent.');

  async function authenticatedFetch(token: string, path: string, init?: RequestInit) {
    return fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  }

  function acceptSettings(next: CustomerSettings) {
    setSettings(next);
    setDisplayName(next.profile.display_name ?? '');
    setLanguage(next.profile.language);
  }

  async function reloadSettings(token: string) {
    const response = await authenticatedFetch(token, '/auth/customer/preferences');
    if (!response.ok) throw new Error('Customer settings could not be loaded.');
    acceptSettings((await response.json()) as CustomerSettings);
  }

  async function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('Requesting a protected synthetic code…');
    try {
      const response = await fetch(`${apiUrl}/auth/otp/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          phone_identifier: phone,
          request_key: `signin-${uuidV7().replaceAll('-', '')}`,
        }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? 'Too many requests. Wait before retrying.'
            : 'The local OTP service is unavailable.',
        );
      const body = (await response.json()) as { challenge_id: string };
      setChallengeId(body.challenge_id);
      setStep('code');
      setMessage('Code created. Retrieve it only with the protected local test helper.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The request could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('Verifying code and enrolling this account as a customer…');
    try {
      const response = await fetch(`${apiUrl}/auth/otp/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challenge_id: challengeId, code, device_id: deviceId }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? 'That code is wrong, expired, or locked.'
            : 'Verification is temporarily unavailable.',
        );
      const body = (await response.json()) as { tokens: SessionTokens | null };
      if (!body.tokens) throw new Error('This code was already used. Request a new code.');
      const enrolment = await authenticatedFetch(body.tokens.access_token, '/auth/customer/enrol', {
        method: 'POST',
      });
      if (!enrolment.ok) throw new Error('The signed-in account could not be enrolled.');
      await reloadSettings(body.tokens.access_token);
      window.sessionStorage.setItem(
        'neighbourhood.customer.access-token',
        body.tokens.access_token,
      );
      setSession(body.tokens);
      setStep('verified');
      setMessage('Signed in and explicitly enrolled as a customer for this local test.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Verification could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !settings) return;
    setBusy(true);
    try {
      const response = await authenticatedFetch(session.access_token, '/auth/customer/profile', {
        method: 'PUT',
        body: JSON.stringify({
          display_name: displayName.trim() || null,
          expected_version: settings.profile.version,
          language,
        }),
      });
      if (!response.ok) throw new Error('Profile was not saved. Reload if another edit won.');
      await reloadSettings(session.access_token);
      setMessage('Optional profile and language preference saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Profile was not saved.');
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
      const response = await authenticatedFetch(session.access_token, '/auth/customer/consents', {
        method: 'POST',
        body: JSON.stringify({
          consent_kind: 'MARKETING',
          decision: granted ? 'WITHDRAWN' : 'GRANTED',
          policy_version: 'marketing.test.v1',
          source: 'CUSTOMER_PWA',
        }),
      });
      if (!response.ok) throw new Error('Marketing consent was not changed.');
      await reloadSettings(session.access_token);
      setMessage(granted ? 'Marketing consent withdrawn.' : 'Marketing consent granted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Consent was not changed.');
    } finally {
      setBusy(false);
    }
  }

  async function changeNotification(preference: NotificationPreference) {
    if (!session) return;
    setBusy(true);
    try {
      const response = await authenticatedFetch(
        session.access_token,
        `/auth/customer/notifications/${preference.notification_kind}/${preference.channel}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            enabled: !preference.effective_enabled,
            expected_version: preference.version,
          }),
        },
      );
      if (!response.ok) throw new Error('Notification preference was not changed.');
      await reloadSettings(session.access_token);
      setMessage('Notification preference saved. Required alerts remain enabled.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Preference was not changed.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!session) return;
    setBusy(true);
    setMessage('Signing out…');
    try {
      const response = await authenticatedFetch(session.access_token, '/auth/sessions/sign-out', {
        method: 'POST',
      });
      if (!response.ok) throw new Error('The session could not be revoked.');
      setSession(null);
      window.sessionStorage.removeItem('neighbourhood.customer.access-token');
      setSettings(null);
      setCode('');
      setChallengeId('');
      setStep('phone');
      setMessage('Signed out. The local access and refresh tokens were cleared from memory.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sign-out could not be completed.');
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
        <p className="step-label">Identity foundation · Step {step === 'phone' ? '1' : '2'} of 2</p>
        <h2 id="sign-in-title">
          {step === 'verified' ? 'Your local test account' : 'Sign in safely'}
        </h2>
      </div>

      {step === 'phone' && (
        <form onSubmit={requestOtp}>
          <label htmlFor="phone-identifier">Fictional phone identifier</label>
          <input
            id="phone-identifier"
            value={phone}
            onChange={(event) => setPhone(event.target.value.toUpperCase())}
            pattern="SYNTH-PHONE-[A-Z0-9][A-Z0-9-]{2,47}"
            autoComplete="off"
            required
          />
          <p className="field-help">
            Format: SYNTH-PHONE-NAME-001. Real phone numbers are rejected.
          </p>
          <button type="submit" disabled={busy}>
            {busy ? 'Requesting…' : 'Request test code'}
          </button>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={verifyOtp}>
          <label htmlFor="otp-code">Six-digit test code</label>
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
            . Tokens remain in memory only.
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
              onChange={(event) => setLanguage(event.target.value as 'EN' | 'HI')}
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

      <p className="status-message" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
