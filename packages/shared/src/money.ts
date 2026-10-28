/**
 * Money utilities (ADR-013). Money is integer minor units; credits are integers.
 * Arithmetic that needs fractions uses BigInt and rounds half up exactly once.
 */

export type Currency = 'USD';
export const CURRENCIES: readonly Currency[] = ['USD'];

export interface Money {
  amountMinor: number;
  currency: Currency;
}

export function assertMinor(n: number, label = 'amount'): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${label} must be a safe integer, got ${n}`);
  return n;
}

/**
 * Round the rational a/b to an integer, halves away from zero (b > 0). For the
 * non-negative values pricing produces this is ordinary round-half-up.
 */
export function divRoundHalfUp(a: bigint, b: bigint): bigint {
  if (b <= 0n) throw new RangeError('divisor must be positive');
  if (a < 0n) return -divRoundHalfUp(-a, b);
  return (a * 2n + b) / (b * 2n);
}

/** round_half_up(a * b / c) for integers, exact. */
export function mulDivRoundHalfUp(a: bigint | number, b: bigint | number, c: bigint | number): bigint {
  return divRoundHalfUp(BigInt(a) * BigInt(b), BigInt(c));
}

export function toSafeNumber(v: bigint, label = 'value'): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${label} exceeds the safe integer range`);
  }
  return Number(v);
}

export function sumMinor(values: readonly number[]): number {
  let total = 0n;
  for (const v of values) total += BigInt(assertMinor(v));
  return toSafeNumber(total, 'sum');
}

export function assertSameCurrency(items: readonly { currency: string }[]): Currency {
  const first = items[0]?.currency;
  if (!first) throw new RangeError('no items');
  for (const it of items) {
    if (it.currency !== first) throw new RangeError(`mixed currency: ${first} and ${it.currency}`);
  }
  if (!CURRENCIES.includes(first as Currency)) throw new RangeError(`unsupported currency ${first}`);
  return first as Currency;
}

/** Format minor units for display only. Never parse this back. */
export function formatMoney(amountMinor: number, currency: Currency = 'USD'): string {
  const neg = amountMinor < 0;
  const abs = Math.abs(assertMinor(amountMinor));
  const major = Math.trunc(abs / 100);
  const minor = String(abs % 100).padStart(2, '0');
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return `${neg ? '-' : ''}${symbol}${major.toLocaleString('en-US')}.${minor}`;
}
