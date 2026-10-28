import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { assertSameCurrency, divRoundHalfUp, formatMoney, mulDivRoundHalfUp, sumMinor } from '../src/money';

describe('money', () => {
  it('rounds half up', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(7n, 4n)).toBe(2n);
    expect(divRoundHalfUp(5n, 4n)).toBe(1n);
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(mulDivRoundHalfUp(77184, 1, 100)).toBe(772n);
  });
  it('matches exact rounding on random inputs', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 15n }), fc.bigInt({ min: 1n, max: 10n ** 9n }), (a, b) => {
        const r = divRoundHalfUp(a, b);
        // a - r*b lies in [-b/2, b/2): ties round up
        const diff2 = a * 2n - r * 2n * b; // 2(a - rb)
        expect(diff2 >= -b && diff2 < b).toBe(true);
      }),
    );
  });
  it('sums and rejects non-integers', () => {
    expect(sumMinor([1, 2, 3])).toBe(6);
    expect(() => sumMinor([1.5])).toThrow();
  });
  it('rejects mixed currency', () => {
    expect(() => assertSameCurrency([{ currency: 'USD' }, { currency: 'EUR' }])).toThrow(/mixed currency/);
    expect(assertSameCurrency([{ currency: 'USD' }])).toBe('USD');
  });
  it('formats for display', () => {
    expect(formatMoney(1671)).toBe('$16.71');
    expect(formatMoney(123456789)).toBe('$1,234,567.89');
    expect(formatMoney(-5)).toBe('-$0.05');
  });
});
