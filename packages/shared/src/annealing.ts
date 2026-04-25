import type { FingerLabel, KeyPosition } from './types.js';
import { buildLayoutIndex } from './difficulty.js';
import { computeCost, type CostBreakdown } from './cost.js';
import type { NgramIndex } from './ngramStats.js';

export interface AnnealOptions {
  positions: readonly KeyPosition[];
  /** User stats for personalized cost weighting (optional). */
  userIndex?: NgramIndex;
  /**
   * Layout-independent fingering map keyed by `posKey(pos)` (`"row,col"`).
   * Optional — falls back to column-based defaults. Because it's keyed by
   * physical position, the same map applies even after the optimizer
   * reshuffles characters.
   */
  posFingerMap?: Record<string, FingerLabel>;
  /** Number of swap iterations. Default 2000. */
  iterations?: number;
  /** Starting temperature. Default 0.5. */
  startTemp?: number;
  /** Ending temperature. Default 0.005. */
  endTemp?: number;
  /** RNG injectable for tests. */
  rng?: () => number;
  /**
   * Set of characters that the optimizer is allowed to swap. Useful when the
   * user wants to lock down certain keys (e.g. keep punctuation in place).
   * Defaults to every alphabetic char on the layout.
   */
  swappableChars?: ReadonlySet<string>;
  /** Floor on miss rate inside the cost function. Default 0.05. */
  missFloor?: number;
}

export interface SuggestedSwap {
  /** Characters being swapped. */
  charA: string;
  charB: string;
  /** Approximate cost reduction from this swap, as a fraction of the original cost (0..1). */
  improvement: number;
}

export interface AnnealResult {
  /** The best layout found. */
  bestPositions: KeyPosition[];
  /** Cost of the original layout. */
  originalCost: CostBreakdown;
  /** Cost of the best layout. */
  bestCost: CostBreakdown;
  /** Improvement as a fraction of the original total cost (0 = no change, 0.1 = 10% reduction). */
  improvement: number;
  /**
   * The minimal-set "diff": which characters moved between the original and
   * the best layout, in alphabetical pair order. The first entry is usually
   * the highest-impact swap and is what we surface to the user.
   */
  swaps: SuggestedSwap[];
}

/**
 * Simulated annealing over pairwise key swaps to minimize the layout cost
 * (spec §6.7). Returns the best layout found.
 */
export function anneal({
  positions,
  userIndex,
  posFingerMap,
  iterations = 2000,
  startTemp = 0.5,
  endTemp = 0.005,
  rng = Math.random,
  swappableChars,
  missFloor = 0.05,
}: AnnealOptions): AnnealResult {
  const swappable: number[] = [];
  for (let i = 0; i < positions.length; i++) {
    const ch = positions[i].char;
    if (swappableChars ? swappableChars.has(ch) : /^[a-z]$/.test(ch)) {
      swappable.push(i);
    }
  }
  if (swappable.length < 2) {
    const idx = buildLayoutIndex(positions, posFingerMap);
    const cost = computeCost(idx, userIndex, missFloor, true);
    return {
      bestPositions: positions.slice(),
      originalCost: cost,
      bestCost: cost,
      improvement: 0,
      swaps: [],
    };
  }

  const originalIdx = buildLayoutIndex(positions, posFingerMap);
  const originalCost = computeCost(originalIdx, userIndex, missFloor, true);

  let current = positions.slice();
  let currentIdx = originalIdx;
  let currentCost = originalCost.total;
  let best = current.slice();
  let bestIdx = currentIdx;
  let bestTotal = originalCost.total;
  let bestCost = originalCost;

  // Exponential cooling: T(i) = T0 * (Tf/T0)^(i/N)
  const lnRatio = Math.log(endTemp / startTemp);

  for (let i = 0; i < iterations; i++) {
    const T = startTemp * Math.exp((lnRatio * i) / iterations);
    const a = swappable[Math.floor(rng() * swappable.length)];
    let b: number;
    do {
      b = swappable[Math.floor(rng() * swappable.length)];
    } while (b === a);

    const candidate = swappedPositions(current, a, b);
    const candidateIdx = buildLayoutIndex(candidate, posFingerMap);
    const candidateCost = computeCost(candidateIdx, userIndex, missFloor, true);
    const delta = candidateCost.total - currentCost;

    let accept = false;
    if (delta < 0) accept = true;
    else if (rng() < Math.exp(-delta / Math.max(T, 1e-9))) accept = true;

    if (accept) {
      current = candidate;
      currentIdx = candidateIdx;
      currentCost = candidateCost.total;
      if (candidateCost.total < bestTotal) {
        best = current.slice();
        bestIdx = currentIdx;
        bestTotal = candidateCost.total;
        bestCost = candidateCost;
      }
    }
  }

  // Ensure bestIdx is referenced (silences unused warnings) and lets us
  // expose a "next-best swap" diff between original and best.
  void bestIdx;

  const swaps = diffLayouts(positions, best);
  const improvement = relativeImprovement(originalCost.total, bestTotal);

  return {
    bestPositions: best,
    originalCost,
    bestCost,
    improvement,
    swaps,
  };
}

/**
 * (orig - best) / |orig|, clamped to ≥ 0. Robust to signed cost values: any
 * reduction in cost reports a positive improvement fraction. Returns 0 when
 * there's no reduction or when |orig| is essentially zero.
 */
function relativeImprovement(originalCost: number, bestCost: number): number {
  const denom = Math.max(Math.abs(originalCost), 1e-6);
  return Math.max(0, (originalCost - bestCost) / denom);
}

/**
 * Convenience: find the single highest-impact swap from the user's layout
 * by trying every pair and picking the one with the largest cost reduction.
 *
 * Faster than annealing (O(K²) cost evaluations) but only finds local
 * single-swap optima. Useful for the "Suggest one swap" UI button.
 */
export function bestSingleSwap(opts: AnnealOptions): AnnealResult {
  const {
    positions,
    userIndex,
    posFingerMap,
    swappableChars,
    missFloor = 0.05,
  } = opts;

  const swappable: number[] = [];
  for (let i = 0; i < positions.length; i++) {
    if (swappableChars ? swappableChars.has(positions[i].char) : /^[a-z]$/.test(positions[i].char)) {
      swappable.push(i);
    }
  }

  const originalIdx = buildLayoutIndex(positions, posFingerMap);
  const originalCost = computeCost(originalIdx, userIndex, missFloor, true);

  let bestPositions: KeyPosition[] = positions.slice();
  let bestTotal = originalCost.total;
  let bestCost = originalCost;

  for (let i = 0; i < swappable.length; i++) {
    for (let j = i + 1; j < swappable.length; j++) {
      const candidate = swappedPositions(positions, swappable[i], swappable[j]);
      const idx = buildLayoutIndex(candidate, posFingerMap);
      const cost = computeCost(idx, userIndex, missFloor, true);
      if (cost.total < bestTotal) {
        bestPositions = candidate;
        bestTotal = cost.total;
        bestCost = cost;
      }
    }
  }

  const swaps = diffLayouts(positions, bestPositions);
  const improvement = relativeImprovement(originalCost.total, bestTotal);

  return {
    bestPositions,
    originalCost,
    bestCost,
    improvement,
    swaps,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function swappedPositions(
  positions: readonly KeyPosition[],
  i: number,
  j: number,
): KeyPosition[] {
  const out = positions.slice();
  out[i] = { ...positions[i], char: positions[j].char };
  out[j] = { ...positions[j], char: positions[i].char };
  return out;
}

/**
 * Compute the minimal pair-swap diff between two layouts. Returns one entry
 * per pair of moved characters. The improvement field is left at 0 — caller
 * can fill in if desired.
 */
function diffLayouts(
  before: readonly KeyPosition[],
  after: readonly KeyPosition[],
): SuggestedSwap[] {
  if (before.length !== after.length) return [];
  // Build (row,col) → char for each.
  const beforeAt = new Map<string, string>();
  const afterAt = new Map<string, string>();
  for (const p of before) beforeAt.set(`${p.row},${p.col}`, p.char);
  for (const p of after) afterAt.set(`${p.row},${p.col}`, p.char);

  // Find positions where char changed; collect into pairs.
  const moved: { from: string; to: string }[] = [];
  for (const key of beforeAt.keys()) {
    const b = beforeAt.get(key)!;
    const a = afterAt.get(key)!;
    if (a !== b) moved.push({ from: b, to: a });
  }

  // Pair them up: each pair (X→Y, Y→X) is one swap.
  const swaps: SuggestedSwap[] = [];
  const seen = new Set<string>();
  for (const m of moved) {
    if (seen.has(m.from) || seen.has(m.to)) continue;
    const key = [m.from, m.to].sort().join('→');
    if (seen.has(key)) continue;
    swaps.push({ charA: m.from, charB: m.to, improvement: 0 });
    seen.add(m.from);
    seen.add(m.to);
    seen.add(key);
  }
  return swaps;
}
