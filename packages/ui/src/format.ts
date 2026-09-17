/**
 * Display formatters.
 *
 * Money is the important one. Amounts cross the wire as integer minor units
 * (paise) and the repository prohibits floating-point money maths, but roughly
 * forty call sites had each hand-written `₹${(x / 100).toFixed(2)}`, which is a
 * float divide per render and rounds inconsistently. These do the arithmetic in
 * integers and hand the pieces to `Intl`.
 */

export type MoneyStyle = 'full' | 'compact';

/**
 * Formats integer minor units as rupees.
 *
 * `compact` drops a `.00` tail, which is what a price grid wants; `full` always
 * shows paise, which is what a receipt or a ledger line wants.
 */
export function formatMoneyMinor(minor: number, style: MoneyStyle = 'full'): string {
  if (!Number.isFinite(minor) || !Number.isInteger(minor)) {
    throw new TypeError('money must be an integer number of minor units');
  }
  const negative = minor < 0;
  const absolute = Math.abs(minor);
  const rupees = Math.trunc(absolute / 100);
  const paise = absolute % 100;
  const grouped = new Intl.NumberFormat('en-IN').format(rupees);
  const body =
    style === 'compact' && paise === 0 ? grouped : `${grouped}.${String(paise).padStart(2, '0')}`;
  return `${negative ? '-' : ''}₹${body}`;
}

/** Metres to a reader-friendly distance. Below a kilometre people think in metres. */
export function formatDistanceMeters(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Turns a wire enum into a sentence.
 *
 * `AWAITING_CUSTOMER_DECISION` was being printed at customers verbatim, or at
 * best `.replaceAll('_', ' ')`-ed into shouting. Known states get real copy;
 * anything unrecognised degrades to title case rather than to a raw constant.
 */
export function humaniseEnum(value: string): string {
  const words = value.toLowerCase().split('_').filter(Boolean);
  const [first, ...rest] = words;
  if (first === undefined) return value;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

/**
 * A relative time that stays honest across a reconnect.
 *
 * `now` is passed in rather than read here so a caller ticking a countdown
 * re-renders every second without each instance keeping its own clock, and so
 * the value can be driven from a server timestamp (CUS-48).
 */
export function formatRelativeTime(isoTimestamp: string, now: number): string {
  const target = new Date(isoTimestamp).getTime();
  if (Number.isNaN(target)) return '—';
  const deltaSeconds = Math.round((target - now) / 1000);
  const absolute = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (absolute < 60) return formatter.format(deltaSeconds, 'second');
  if (absolute < 3600) return formatter.format(Math.round(deltaSeconds / 60), 'minute');
  if (absolute < 86_400) return formatter.format(Math.round(deltaSeconds / 3600), 'hour');
  return formatter.format(Math.round(deltaSeconds / 86_400), 'day');
}

/**
 * Remaining time on a server-owned deadline, as `m:ss`.
 *
 * Returns `null` once the deadline has passed so the caller can say what
 * actually happens next instead of counting into negative numbers.
 */
export function formatCountdown(deadlineIso: string, now: number): string | null {
  const remaining = new Date(deadlineIso).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Parses a rupee amount typed by a person into integer minor units.
 *
 * The vendor catalogue did this with `Math.round(Number(price) * 100)`, which
 * is exactly the floating-point money arithmetic the repository prohibits:
 * `Number('1.005') * 100` is 100.49999999999999, so a listing priced ₹1.005
 * was published at ₹1.00. Parsing the digits either side of the separator keeps
 * the arithmetic in integers from end to end.
 *
 * Returns null for anything that is not a plain amount with at most two
 * decimal places, so a caller reports the input rather than storing a guess.
 */
export function parseRupeesToMinor(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const [, whole, fraction = ''] = match;
  if (whole === undefined) return null;
  const rupees = Number(whole);
  if (!Number.isSafeInteger(rupees)) return null;
  const paise = Number(fraction.padEnd(2, '0'));
  const minor = rupees * 100 + paise;
  return Number.isSafeInteger(minor) ? minor : null;
}
