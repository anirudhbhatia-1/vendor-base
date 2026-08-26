import type { Brand } from './brand.js';

export type CurrencyCode = Brand<string, 'CurrencyCode'>;
export type MinorUnitAmount = Brand<number, 'MinorUnitAmount'>;

export interface Money {
  readonly amount_minor: MinorUnitAmount;
  readonly currency: CurrencyCode;
}

export const INR = 'INR' as CurrencyCode;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function createCurrencyCode(value: string): CurrencyCode {
  const normalized = value.toUpperCase();
  if (!CURRENCY_PATTERN.test(normalized)) {
    throw new TypeError('Currency must be a three-letter uppercase ISO-style code');
  }
  return normalized as CurrencyCode;
}

export function createMinorUnitAmount(value: number): MinorUnitAmount {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError('Money amount_minor must be a safe integer');
  }
  return value as MinorUnitAmount;
}

export function createMoney(amountMinor: number, currency: CurrencyCode | string): Money {
  return Object.freeze({
    amount_minor: createMinorUnitAmount(amountMinor),
    currency: createCurrencyCode(currency),
  });
}

function requireSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) throw new TypeError('Money currencies must match');
}

export function addMoney(left: Money, right: Money): Money {
  requireSameCurrency(left, right);
  return createMoney(left.amount_minor + right.amount_minor, left.currency);
}

export function subtractMoney(left: Money, right: Money): Money {
  requireSameCurrency(left, right);
  return createMoney(left.amount_minor - right.amount_minor, left.currency);
}

export function requireNonNegativeMoney(value: Money): Money {
  if (value.amount_minor < 0) throw new RangeError('Money amount must not be negative');
  return value;
}
