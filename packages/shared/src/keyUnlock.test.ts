import { describe, it, expect } from 'vitest';
import { computeKeyHealth, shouldUnlockNextKey, keysNeedingReview, nextKeyToUnlock, lastKeyToLock } from './keyUnlock.js';
import { indexNgramStats, type NgramStatRow } from './ngramStats.js';
import { LAYOUT_DEFINITIONS } from './layouts.js';
import type { KeyPosition } from './types.js';

function colemakChars(): { char: string; row: number; col: number }[] {
  const def = LAYOUT_DEFINITIONS.find((d) => d.name === 'Colemak')!;
  return JSON.parse(def.key_positions_json) as KeyPosition[];
}

function row(
  char: string,
  hits: number,
  misses: number,
  totalTimeMs: number,
): NgramStatRow {
  return {
    ngram: char,
    ngram_type: 'char1',
    hits,
    misses,
    total_time_ms: totalTimeMs,
  };
}

describe('computeKeyHealth', () => {
  it('computes WPM from total time per char1', () => {
    // 100 hits at 200ms each = 20s of typing → 100 chars / (20s/60) = 300 cpm = 60 WPM at 5cpw
    const idx = indexNgramStats([row('t', 100, 0, 100 * 200)]);
    const [h] = computeKeyHealth(idx, ['t']);
    expect(h.wpm).toBeCloseTo(60, 1);
  });

  it('returns zero WPM and prior accuracy when no data', () => {
    const idx = indexNgramStats([]);
    const [h] = computeKeyHealth(idx, ['x']);
    expect(h.wpm).toBe(0);
    expect(h.accuracy).toBeCloseTo(0.9, 3);
  });
});

describe('shouldUnlockNextKey', () => {
  it('returns null when any key is below the WPM threshold', () => {
    const slow = row('t', 30, 0, 30 * 600); // 600ms/char → 20wpm
    const idx = indexNgramStats([slow]);
    const health = computeKeyHealth(idx, ['t']);
    expect(shouldUnlockNextKey(health, ['t'], colemakChars())).toBeNull();
  });

  it('returns the next home-row key when criteria are met', () => {
    // Each unlocked key has 30 hits, 0 misses, 100ms/char (=120wpm), 100% accuracy.
    const fastClean = (c: string) => row(c, 30, 0, 30 * 100);
    const idx = indexNgramStats([fastClean('a'), fastClean('e'), fastClean('t'), fastClean('n')]);
    const health = computeKeyHealth(idx, ['a', 'e', 't', 'n']);
    const next = shouldUnlockNextKey(health, ['a', 'e', 't', 'n'], colemakChars());
    expect(next).not.toBeNull();
    // It should be a Colemak home-row char that isn't already unlocked.
    const homeChars = new Set(colemakChars().filter((k) => k.row === 1).map((k) => k.char));
    expect(homeChars.has(next!)).toBe(true);
    expect(['a', 'e', 't', 'n']).not.toContain(next);
  });

  it('returns null when sample size is too small', () => {
    const idx = indexNgramStats([row('t', 5, 0, 5 * 100)]); // only 5 hits
    const health = computeKeyHealth(idx, ['t']);
    expect(shouldUnlockNextKey(health, ['t'], colemakChars())).toBeNull();
  });
});

describe('nextKeyToUnlock', () => {
  it('returns the next home-row key in priority order', () => {
    // Colemak home row: a r s t d h n e i o  (cols 0..9, row 1)
    // COL_PRIORITY = [3,4,2,5,1,6,0,7,8,9] → first hit col 3 = 't', then col 4 = 'd'
    const next = nextKeyToUnlock(['t'], colemakChars());
    expect(next).toBe('d');
  });

  it('returns null when all alpha keys are unlocked', () => {
    const all = colemakChars().filter((k) => /^[a-z]$/.test(k.char)).map((k) => k.char);
    expect(nextKeyToUnlock(all, colemakChars())).toBeNull();
  });
});

describe('lastKeyToLock', () => {
  it('returns the most recently added key in priority order', () => {
    // With ['t', 'd'] unlocked the last in priority order is 'd' (col 4 comes after col 3)
    const last = lastKeyToLock(['t', 'd'], colemakChars());
    expect(last).toBe('d');
  });

  it('returns null when only one key is unlocked', () => {
    expect(lastKeyToLock(['t'], colemakChars())).toBeNull();
  });
});

describe('keysNeedingReview', () => {
  it('flags keys with smoothed accuracy below 0.85', () => {
    // 7 hits, 8 misses, smoothed = (8+1)/(15+10) = 0.36 → accuracy 0.64
    const idx = indexNgramStats([row('t', 7, 8, 7 * 100)]);
    const health = computeKeyHealth(idx, ['t']);
    expect(keysNeedingReview(health)).toEqual(['t']);
  });

  it('does not flag keys above the threshold', () => {
    // 95 hits, 1 miss → smoothed acc = 1 - 2/106 ≈ 0.98
    const idx = indexNgramStats([row('t', 95, 1, 95 * 100)]);
    const health = computeKeyHealth(idx, ['t']);
    expect(keysNeedingReview(health)).toEqual([]);
  });
});
