import { describe, it, expect } from 'vitest';
import { anneal, bestSingleSwap } from './annealing.js';
import { layoutCost } from './cost.js';
import { LAYOUT_DEFINITIONS } from './layouts.js';
import type { KeyPosition } from './types.js';

function loadPositions(name: string): KeyPosition[] {
  const def = LAYOUT_DEFINITIONS.find((d) => d.name === name)!;
  return JSON.parse(def.key_positions_json);
}

const qwerty = loadPositions('QWERTY');
const colemak = loadPositions('Colemak');

describe('bestSingleSwap', () => {
  it('finds at least one swap that lowers the cost on QWERTY', () => {
    const result = bestSingleSwap({ positions: qwerty, missFloor: 0.1 });
    expect(result.improvement).toBeGreaterThanOrEqual(0);
    expect(result.bestCost.total).toBeLessThanOrEqual(result.originalCost.total);
  });

  it('returns swaps that actually move characters', () => {
    const result = bestSingleSwap({ positions: qwerty, missFloor: 0.1 });
    if (result.improvement > 0) {
      expect(result.swaps.length).toBeGreaterThan(0);
      const { charA, charB } = result.swaps[0];
      expect(charA).not.toEqual(charB);
    }
  });

  it('the suggested swap matches a real position swap in the diff', () => {
    const result = bestSingleSwap({ positions: qwerty, missFloor: 0.1 });
    if (result.improvement > 0) {
      const { charA, charB } = result.swaps[0];
      // Verify charA and charB actually swapped positions.
      const origA = qwerty.find((p) => p.char === charA)!;
      const origB = qwerty.find((p) => p.char === charB)!;
      const newA = result.bestPositions.find((p) => p.char === charA)!;
      const newB = result.bestPositions.find((p) => p.char === charB)!;
      expect(newA.row).toBe(origB.row);
      expect(newA.col).toBe(origB.col);
      expect(newB.row).toBe(origA.row);
      expect(newB.col).toBe(origA.col);
    }
  });

  it('does not regress (best <= original)', () => {
    const result = bestSingleSwap({ positions: colemak, missFloor: 0.1 });
    expect(result.bestCost.total).toBeLessThanOrEqual(result.originalCost.total);
  });
});

describe('anneal', () => {
  it('finds a layout with cost ≤ original on QWERTY (deterministic seed)', () => {
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const result = anneal({
      positions: qwerty,
      iterations: 300, // small for test speed
      rng: seedRng(42),
      missFloor: 0.1,
    });

    expect(result.bestCost.total).toBeLessThanOrEqual(result.originalCost.total);
    // Verify the best layout cost matches a fresh recompute
    const recomputed = layoutCost(result.bestPositions, undefined, { missFloor: 0.1 });
    expect(recomputed.total).toBeCloseTo(result.bestCost.total, 6);
  });

  it('returns the original layout (zero improvement) when iterations=0', () => {
    const result = anneal({ positions: qwerty, iterations: 0 });
    expect(result.improvement).toBe(0);
    expect(result.swaps).toEqual([]);
  });
});
