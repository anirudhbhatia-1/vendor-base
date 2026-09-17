'use client';

import { ApiError, createApiClient, type ApiClient } from '@neighbourhood-store/contracts';

const storageKey = 'neighbourhood.customer.session-summary';
const csrfCookie = 'ns_customer_csrf';

export type BrowserSession = {
  access_expires_at: string;
  session_id: string;
};

let sessionCheck: Promise<BrowserSession> | undefined;

function isBrowserSession(value: unknown): value is BrowserSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.access_expires_at === 'string' && typeof row.session_id === 'string';
}

function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${csrfCookie}=`;
  const found = document.cookie.split('; ').find((entry) => entry.startsWith(prefix));
  return found ? decodeURIComponent(found.slice(prefix.length)) : null;
}

function persistSummary(summary: BrowserSession): void {
  const encoded = JSON.stringify({
    access_expires_at: summary.access_expires_at,
    session_id: summary.session_id,
  });
  if (window.sessionStorage.getItem(storageKey) !== encoded) {
    window.sessionStorage.setItem(storageKey, encoded);
    window.dispatchEvent(new Event('neighbourhood:customer-session'));
  }
}

/** Returns only non-secret UI state. Access and refresh credentials are HttpOnly cookies. */
export function readCustomerSession(): BrowserSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isBrowserSession(parsed) ? parsed : null;
  } catch {
    clearCustomerSession();
    return null;
  }
}

export function storeCustomerSession(summary: BrowserSession): void {
  persistSummary(summary);
}

export function clearCustomerSession(): void {
  if (typeof window === 'undefined') return;
  const existed = window.sessionStorage.getItem(storageKey) !== null;
  window.sessionStorage.removeItem(storageKey);
  if (existed) window.dispatchEvent(new Event('neighbourhood:customer-session'));
}

function browserClient(): ApiClient {
  return createApiClient({
    baseUrl: '/api/backend',
    getCsrfToken: readCsrfToken,
    getToken: () => null,
  });
}

export function anonymousCustomerClient(): ApiClient {
  return browserClient();
}

export async function requestCustomerOtp(body: {
  device_id: string;
  phone_identifier: string;
  request_key: string;
}): Promise<{ challenge_id: string }> {
  const response = await fetch('/api/session/otp/request', {
    body: JSON.stringify(body),
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) throw new ApiError(response.status, 'The verification code could not be sent.');
  return response.json() as Promise<{ challenge_id: string }>;
}

export async function verifyCustomerOtp(body: {
  challenge_id: string;
  code: string;
  device_id: string;
}): Promise<BrowserSession> {
  const response = await fetch('/api/session/otp/verify', {
    body: JSON.stringify({ ...body, device_label: 'Customer web browser', platform: 'WEB' }),
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok || !isBrowserSession(value)) {
    const message =
      response.status === 409
        ? 'This code was already used. Open Orders to check your session, or request a new code if you are still signed out.'
        : response.status === 403
          ? 'Customer access is restricted or could not be established. Contact support; requesting more codes will not restore revoked access.'
          : response.status >= 500 || response.ok
            ? 'Sign-in could not be completed by the server. Please try again with a new code.'
            : response.status === 429
              ? 'Too many attempts. Wait before requesting a new code.'
              : 'The verification code is invalid or expired. Request a new code and try once.';
    throw new ApiError(response.ok ? 502 : response.status, message);
  }
  persistSummary(value);
  return value;
}

export async function currentCustomerTokens(): Promise<BrowserSession> {
  sessionCheck ??= fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' })
    .then(async (response) => {
      const value: unknown = await response.json().catch(() => null);
      if (response.status === 401) {
        throw new ApiError(401, 'Sign in with your mobile number to continue.');
      }
      if (response.status === 403) {
        throw new ApiError(
          403,
          'Customer access is restricted. Contact support or sign out to use another account.',
        );
      }
      if (!response.ok || !isBrowserSession(value)) {
        throw new ApiError(
          response.ok ? 502 : response.status,
          'We could not check your session. Please try again.',
        );
      }
      persistSummary(value);
      return value;
    })
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) clearCustomerSession();
      throw error;
    })
    .finally(() => {
      sessionCheck = undefined;
    });
  return sessionCheck;
}

export async function customerApiClient(): Promise<ApiClient> {
  await currentCustomerTokens();
  return browserClient();
}

export async function restoreCustomerSession(): Promise<BrowserSession | null> {
  try {
    return await currentCustomerTokens();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function signOutCustomer(): Promise<void> {
  const response = await fetch('/api/session', {
    credentials: 'same-origin',
    headers: { 'x-csrf-token': readCsrfToken() ?? '' },
    method: 'DELETE',
  });
  if (!response.ok)
    throw new ApiError(response.status, 'Sign-out could not be completed. Please try again.');
  clearCustomerSession();
}
