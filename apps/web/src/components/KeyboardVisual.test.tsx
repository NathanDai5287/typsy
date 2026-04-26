import { describe, it, expect } from 'vitest';
import { scaleHeatForDisplay } from './KeyboardVisual.tsx';

describe('scaleHeatForDisplay', () => {
  it('returns 1 (no rescaling) when heat is undefined or empty', () => {
    expect(scaleHeatForDisplay(undefined)).toBe(1);
    expect(scaleHeatForDisplay(new Map())).toBe(1);
  });

  it('returns 1 when every key is perfectly clean (max = 0)', () => {
    const heat = new Map([['a', 0], ['b', 0], ['c', 0]]);
    expect(scaleHeatForDisplay(heat)).toBe(1);
  });

  it('stretches the worst key up to the floor when all keys are near-green', () => {
    // Bayesian-smoothed rates this small all render as ~green without
    // rescaling — that's the case the user complained about.
    const heat = new Map([['a', 0.05], ['b', 0.04], ['c', 0.03]]);
    const scale = scaleHeatForDisplay(heat, 0.6);
    expect(scale).toBeCloseTo(0.6 / 0.05, 6);
    // After scaling, the worst key sits exactly at the floor and the
    // others lag proportionally below it.
    expect(0.05 * scale).toBeCloseTo(0.6, 6);
    expect(0.04 * scale).toBeLessThan(0.6);
    expect(0.03 * scale).toBeLessThan(0.04 * scale);
  });

  it('does not rescale (returns 1) when the worst key already exceeds the floor', () => {
    // A genuinely bad key — absolute scaling should win so the deep-red
    // signal is preserved.
    const heat = new Map([['a', 0.7], ['b', 0.2], ['c', 0.05]]);
    expect(scaleHeatForDisplay(heat, 0.6)).toBe(1);
  });

  it('does not rescale when the worst key is exactly at the floor', () => {
    const heat = new Map([['a', 0.6], ['b', 0.1]]);
    expect(scaleHeatForDisplay(heat, 0.6)).toBe(1);
  });

  it('preserves the relative ordering of keys after rescaling', () => {
    const heat = new Map([['a', 0.10], ['b', 0.05], ['c', 0.02]]);
    const scale = scaleHeatForDisplay(heat, 0.6);
    const scaled = [...heat].map(([k, v]) => [k, v * scale] as const);
    scaled.sort((x, y) => y[1] - x[1]);
    expect(scaled.map(([k]) => k)).toEqual(['a', 'b', 'c']);
  });
});
