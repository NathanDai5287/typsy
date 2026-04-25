import { describe, it, expect } from 'vitest';
import { smoothedErrorRate, smoothedAccuracy } from './bayesian.js';

describe('smoothedErrorRate', () => {
  it('returns the prior when there are zero attempts', () => {
    // (0 + 1) / (0 + 0 + 1 + 9) = 0.1
    expect(smoothedErrorRate(0, 0)).toBeCloseTo(0.1, 6);
  });

  it('pulls a tiny-sample miss rate toward the prior', () => {
    // Raw rate of 1/2 = 0.5, but smoothed = (1+1)/(2+10) = 0.1666
    expect(smoothedErrorRate(1, 1)).toBeCloseTo(0.1666, 3);
  });

  it('approaches raw rate with large samples', () => {
    // 200 misses out of 1000 → 0.2 raw, smoothed = 201/1010 ≈ 0.199
    expect(smoothedErrorRate(800, 200)).toBeCloseTo(0.199, 2);
  });

  it('respects custom α and β', () => {
    // α=2, β=2 prior is 0.5 with no data
    expect(smoothedErrorRate(0, 0, 2, 2)).toBeCloseTo(0.5, 6);
  });
});

describe('smoothedAccuracy', () => {
  it('is 1 minus smoothed error rate', () => {
    expect(smoothedAccuracy(0, 0)).toBeCloseTo(0.9, 6);
    expect(smoothedAccuracy(800, 200)).toBeCloseTo(0.801, 2);
  });
});
