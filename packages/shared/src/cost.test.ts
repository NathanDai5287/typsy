import { describe, it, expect } from 'vitest';
import { layoutCost } from './cost.js';
import { LAYOUT_DEFINITIONS } from './layouts.js';
import type { KeyPosition } from './types.js';

function loadPositions(name: string): KeyPosition[] {
  const def = LAYOUT_DEFINITIONS.find((d) => d.name === name)!;
  return JSON.parse(def.key_positions_json);
}

describe('layoutCost — relative ordering', () => {
  const qwerty = loadPositions('QWERTY');
  const colemak = loadPositions('Colemak');

  it('returns finite cost for each bundled layout', () => {
    // Cost can be slightly negative for layouts with lots of alternation +
    // inward rolls (the bonuses subtract from the penalty total). That's by
    // design — the metric is relative; lower is better in either sign.
    const q = layoutCost(qwerty, undefined);
    const c = layoutCost(colemak, undefined);
    expect(Number.isFinite(q.total)).toBe(true);
    expect(Number.isFinite(c.total)).toBe(true);
    expect(Number.isFinite(q.bigramCost)).toBe(true);
    expect(Number.isFinite(q.trigramCost)).toBe(true);
    // Trigram redirect penalty is purely positive.
    expect(q.trigramCost).toBeGreaterThanOrEqual(0);
    expect(c.trigramCost).toBeGreaterThanOrEqual(0);
  });

  it('Colemak has lower cost than QWERTY (well-known property)', () => {
    const q = layoutCost(qwerty, undefined);
    const c = layoutCost(colemak, undefined);
    expect(c.total).toBeLessThan(q.total);
  });

  it('total = bigramCost + trigramCost', () => {
    const c = layoutCost(colemak, undefined);
    expect(c.total).toBeCloseTo(c.bigramCost + c.trigramCost, 9);
  });

  it('skipping trigrams reduces cost (trigramCost > 0)', () => {
    const all = layoutCost(qwerty, undefined);
    const noTri = layoutCost(qwerty, undefined, { includeTrigrams: false });
    expect(all.total).toBeGreaterThan(noTri.total);
    expect(noTri.trigramCost).toBe(0);
  });
});
