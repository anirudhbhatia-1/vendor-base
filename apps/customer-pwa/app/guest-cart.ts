'use client';

/**
 * The basket a visitor fills before they have an account.
 *
 * Without this, "browse before signing in" is only half true: you can look, but
 * the moment you reach for something you are bounced to a sign-in screen. Every
 * shopping app lets the basket fill first and asks who you are at the till.
 *
 * Deliberately *not* a mirror of the server cart. It holds the few facts needed
 * to show a count and to replay the lines after sign-in — the vendor group
 * subtotals, minimums, fees, availability and eligibility are all server
 * decisions (MKT-08, CUS-36) and are not guessed here. It also creates no
 * reservation of any kind, which is what EXC-11 requires of a cart.
 */
const STORAGE_KEY = 'neighbourhood:guest-cart';
export const GUEST_CART_EVENT = 'neighbourhood:guest-cart';

export type GuestCartLine = {
  readonly vendor_location_id: string;
  readonly catalogue_variant_id: string;
  readonly quantity: number;
  /** Snapshotted only so the basket can name what is in it before sign-in. */
  readonly title: string;
  readonly price_minor: number | null;
};

function isLine(value: unknown): value is GuestCartLine {
  if (!value || typeof value !== 'object') return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line['vendor_location_id'] === 'string' &&
    typeof line['catalogue_variant_id'] === 'string' &&
    typeof line['quantity'] === 'number' &&
    line['quantity'] > 0 &&
    typeof line['title'] === 'string' &&
    (line['price_minor'] === null || typeof line['price_minor'] === 'number')
  );
}

export function readGuestCart(): readonly GuestCartLine[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isLine) : [];
  } catch {
    return [];
  }
}

function write(lines: readonly GuestCartLine[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (lines.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    window.dispatchEvent(new Event(GUEST_CART_EVENT));
  } catch {
    // A full or disabled store must not break adding to a basket.
  }
}

export function setGuestQuantity(input: {
  readonly vendor_location_id: string;
  readonly catalogue_variant_id: string;
  readonly quantity: number;
  readonly title: string;
  readonly price_minor: number | null;
}): void {
  const existing = readGuestCart().filter(
    (line) => line.catalogue_variant_id !== input.catalogue_variant_id,
  );
  if (input.quantity <= 0) {
    write(existing);
    return;
  }
  write([
    ...existing,
    {
      catalogue_variant_id: input.catalogue_variant_id,
      price_minor: input.price_minor,
      quantity: input.quantity,
      title: input.title,
      vendor_location_id: input.vendor_location_id,
    },
  ]);
}

export function clearGuestCart(): void {
  write([]);
}

export function guestItemCount(lines: readonly GuestCartLine[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}

/**
 * Integer minor units throughout, and null the moment anything is unpriced —
 * the same rule the server read model uses, so the two never disagree about
 * whether a total can be shown at all.
 */
export function guestSubtotalMinor(lines: readonly GuestCartLine[]): number | null {
  let total = 0;
  for (const line of lines) {
    if (line.price_minor === null) return null;
    total += line.price_minor * line.quantity;
  }
  return total;
}
