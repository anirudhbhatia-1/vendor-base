export type SafeLogScalar = boolean | number | string | null;
export type SafeLogValue =
  SafeLogScalar | readonly SafeLogValue[] | { readonly [key: string]: SafeLogValue };

export const REDACTED_VALUE = '[REDACTED]';

const PROTECTED_KEY_PATTERN =
  /(?:^|_)(?:aadhaar|access_token|account_number|address|bank_account|card|cookie|coordinates|credential|cvv|device_token|email|ifsc|lat|latitude|lng|lon|longitude|mobile|msisdn|otp|pan|passcode|password|payment_token|phone|precise_location|refresh_token|secret|set_cookie|token|upi|vpa)(?:$|_)/i;
const AUTHORIZATION_KEY_PATTERN = /^(?:authorization|authorization_header|proxy_authorization)$/i;

/**
 * Normalizes a key so the protected-word pattern can see its boundaries.
 *
 * Only `-` was converted, so camelCase slipped through: `phoneNumber`, `otpCode` and
 * `accessToken` were all logged in full while their snake_case spellings were
 * redacted. Provider payloads are the obvious way in, since most arrive camelCase.
 */
function safeKey(value: string): string {
  return value.replaceAll('-', '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2');
}

function redact(value: unknown, seen: WeakSet<object>, depth: number): SafeLogValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return { error_name: value.name };
  if (typeof value !== 'object') return String(value);
  if (depth >= 8) return '[MAX_DEPTH]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    const output = value.slice(0, 100).map((entry) => redact(entry, seen, depth + 1));
    seen.delete(value);
    return output;
  }

  const output: Record<string, SafeLogValue> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 100)) {
    const normalizedKey = safeKey(key);
    output[key] =
      PROTECTED_KEY_PATTERN.test(normalizedKey) || AUTHORIZATION_KEY_PATTERN.test(normalizedKey)
        ? REDACTED_VALUE
        : redact(entry, seen, depth + 1);
  }
  seen.delete(value);
  return output;
}

export function redactProtectedFields(value: unknown): SafeLogValue {
  return redact(value, new WeakSet<object>(), 0);
}
