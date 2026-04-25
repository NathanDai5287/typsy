import type { KeyPosition } from './types.js';
import { getBaseTransitions } from './markov.js';
import { backoffErrorRate, type NgramIndex } from './ngramStats.js';
import {
  bigramDifficulty,
  buildLayoutIndex,
  trigramRedirectPenalty,
  type LayoutIndex,
} from './difficulty.js';

/**
 * Cost of typing English on the given layout, weighted by the user's personal
 * miss rates (spec §6.7).
 *
 *   cost(layout) = Σ over bigrams: freq(b) × difficulty(b, layout) × max(miss_rate(b), floor)
 *                + Σ over trigrams: freq(t) × redirect_penalty(t, layout) × max(miss_rate(t), floor)
 *
 * The `miss_rate` is smoothed via the existing backoff utility so unseen
 * bigrams contribute the prior (~0.1) instead of zero — otherwise we could
 * "improve" the cost by routing high-frequency English through bigrams the
 * user has never typed.
 *
 * `floor` ensures even bigrams the user types perfectly still contribute
 * proportionally to their layout difficulty.
 */
export interface CostBreakdown {
  total: number;
  bigramCost: number;
  trigramCost: number;
}

export interface CostOptions {
  /** Per-user ngram stats (optional; if omitted, uses the smoothed prior everywhere). */
  userIndex?: NgramIndex;
  /** Floor on miss rate so well-practiced bigrams still count their difficulty. Default 0.05. */
  missFloor?: number;
  /** Whether to include trigram redirect penalty. Default true. */
  includeTrigrams?: boolean;
}

export function layoutCost(
  positions: readonly KeyPosition[],
  fingeringOverride: Record<string, import('./types.js').FingerLabel> | undefined,
  options: CostOptions = {},
): CostBreakdown {
  const { userIndex, missFloor = 0.05, includeTrigrams = true } = options;
  const index = buildLayoutIndex(positions, fingeringOverride);

  return computeCost(index, userIndex, missFloor, includeTrigrams);
}

/** Internal helper: takes a pre-built LayoutIndex (cheaper for inner loops). */
export function computeCost(
  layoutIndex: LayoutIndex,
  userIndex: NgramIndex | undefined,
  missFloor: number,
  includeTrigrams: boolean,
): CostBreakdown {
  const base = getBaseTransitions();
  const baseTotal = sumAllWeights(base);

  let bigramCost = 0;
  for (const [a, row] of base) {
    if (a === ' ') continue;
    if (!layoutIndex.has(a)) continue;
    for (const [b, w] of row) {
      if (b === ' ' || !layoutIndex.has(b)) continue;
      const bigram = a + b;
      const freq = w / baseTotal;
      const diff = bigramDifficulty(layoutIndex, bigram).score;
      if (diff === 0) continue;
      const miss = userIndex
        ? Math.max(missFloor, backoffErrorRate(userIndex, bigram, 'char2'))
        : missFloor;
      bigramCost += freq * diff * miss;
    }
  }

  let trigramCost = 0;
  if (includeTrigrams) {
    // Use a sample of common trigrams from base transitions: enumerate every
    // (a, b, c) where both (a,b) and (b,c) bigrams are above a small weight
    // threshold. Trigram frequency ≈ base(a→b) × P(c | b).
    for (const [a, rowA] of base) {
      if (a === ' ' || !layoutIndex.has(a)) continue;
      for (const [b, wAB] of rowA) {
        if (b === ' ' || !layoutIndex.has(b)) continue;
        const rowB = base.get(b);
        if (!rowB) continue;
        const totalB = sumRow(rowB);
        if (totalB === 0) continue;
        for (const [c, wBC] of rowB) {
          if (c === ' ' || !layoutIndex.has(c)) continue;
          const trigram = a + b + c;
          const { score: penalty } = trigramRedirectPenalty(layoutIndex, trigram);
          if (penalty === 0) continue;
          // Trigram frequency ≈ p(a→b) * p(c | b) for the bundled corpus.
          const triFreq = (wAB / baseTotal) * (wBC / totalB);
          const miss = userIndex
            ? Math.max(missFloor, backoffErrorRate(userIndex, trigram, 'char3'))
            : missFloor;
          trigramCost += triFreq * penalty * miss;
        }
      }
    }
  }

  return { total: bigramCost + trigramCost, bigramCost, trigramCost };
}

function sumAllWeights(t: ReadonlyMap<string, ReadonlyMap<string, number>>): number {
  let total = 0;
  for (const row of t.values()) for (const w of row.values()) total += w;
  return total;
}

function sumRow(row: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const w of row.values()) total += w;
  return total;
}
