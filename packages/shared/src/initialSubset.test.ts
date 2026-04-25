import { describe, it, expect } from 'vitest';
import { pickInitialSubset } from './initialSubset.js';
import { LAYOUT_DEFINITIONS } from './layouts.js';
import type { KeyPosition } from './types.js';

function loadLayout(name: string): KeyPosition[] {
  const def = LAYOUT_DEFINITIONS.find((d) => d.name === name)!;
  return JSON.parse(def.key_positions_json);
}

describe('pickInitialSubset', () => {
  it('returns exactly K characters for QWERTY home row', () => {
    const subset = pickInitialSubset(loadLayout('QWERTY'), 4);
    expect(subset).toHaveLength(4);
  });

  it('only chooses from home-row chars', () => {
    const positions = loadLayout('Colemak');
    const homeChars = new Set(positions.filter((p) => p.row === 1).map((p) => p.char));
    const subset = pickInitialSubset(positions, 4);
    for (const c of subset) {
      expect(homeChars.has(c)).toBe(true);
    }
  });

  it('subset includes at least one vowel and one consonant', () => {
    const positions = loadLayout('Colemak');
    const subset = pickInitialSubset(positions, 4);
    const vowels = new Set(['a', 'e', 'i', 'o', 'u']);
    expect(subset.some((c) => vowels.has(c))).toBe(true);
    expect(subset.some((c) => !vowels.has(c))).toBe(true);
  });

  it('subset spans both hands', () => {
    const positions = loadLayout('Colemak');
    const subset = pickInitialSubset(positions, 4);
    const homeRow = positions.filter((p) => p.row === 1);
    const charToCol = new Map(homeRow.map((p) => [p.char, p.col]));
    const cols = subset.map((c) => charToCol.get(c)!);
    expect(cols.some((col) => col <= 4)).toBe(true);
    expect(cols.some((col) => col >= 5)).toBe(true);
  });

  it('Colemak best-4 contains common letters', () => {
    const subset = pickInitialSubset(loadLayout('Colemak'), 4);
    // Colemak home row is a r s t d h n e i o.
    // Top 4 by word coverage almost certainly contain a, e, t and one of n/o/i/s.
    expect(subset).toContain('a');
    expect(subset).toContain('e');
    expect(subset).toContain('t');
  });

  it('result is sorted alphabetically (deterministic)', () => {
    const subset = pickInitialSubset(loadLayout('QWERTY'), 4);
    const sorted = [...subset].sort();
    expect(subset).toEqual(sorted);
  });
});
