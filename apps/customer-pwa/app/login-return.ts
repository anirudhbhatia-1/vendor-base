/** Only local UI pages are valid return destinations; never execute an untrusted URL. */
export function customerLoginReturn(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  // Reject encoded separators/control characters too: different URL layers may decode them.
  if (
    Array.from(value).some(
      (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  )
    return '/';
  if (/[\\]|%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f|25)/i.test(value)) return '/';
  const url = new URL(value, 'https://customer.invalid');
  if (url.origin !== 'https://customer.invalid' || /^\/(?:api|login)(?:\/|$)/.test(url.pathname))
    return '/';
  return url.pathname + url.search + url.hash;
}
