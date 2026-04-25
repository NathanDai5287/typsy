import type { KeyPosition } from './types.js';
import { wordsUsingOnly } from './wordList.js';
import { INITIAL_SUBSET_SIZE } from './constants.js';

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/**
 * Choose the initial K-key subset from a layout's home row (per spec §6.3).
 *
 *   1. Generate every size-K subset of the home row.
 *   2. Filter to subsets with ≥1 vowel, ≥1 consonant, and at least one key
 *      from each hand.
 *   3. Score each subset by the summed frequency of dictionary words
 *      composed entirely of those letters.
 *   4. Return the highest-scoring subset (deterministic tie-break: alphabetical).
 *
 * @param positions - All key positions of the target layout.
 * @param k         - Subset size (default INITIAL_SUBSET_SIZE = 4).
 */
export function pickInitialSubset(
  positions: readonly KeyPosition[],
  k: number = INITIAL_SUBSET_SIZE,
): string[] {
  // Home row only — the spec is explicit that the initial subset comes from row 1.
  const homeRow = positions
    .filter((p) => p.row === 1 && /^[a-z]$/.test(p.char))
    .sort((a, b) => a.col - b.col);

  if (homeRow.length < k) {
    // Fallback: just return all home-row chars sorted alphabetically.
    return homeRow.map((p) => p.char).sort();
  }

  let bestScore = -1;
  let bestSubset: string[] = [];

  for (const indices of combinations(homeRow.length, k)) {
    const subsetKeys = indices.map((i) => homeRow[i]);
    const chars = new Set(subsetKeys.map((p) => p.char));

    // Must include both a vowel and a consonant.
    const hasVowel = subsetKeys.some((p) => VOWELS.has(p.char));
    const hasConsonant = subsetKeys.some((p) => !VOWELS.has(p.char));
    if (!hasVowel || !hasConsonant) continue;

    // Must include at least one key from each hand (cols 0–4 = left, 5–9 = right).
    const hasLeft = subsetKeys.some((p) => p.col <= 4);
    const hasRight = subsetKeys.some((p) => p.col >= 5);
    if (!hasLeft || !hasRight) continue;

    const matchingWords = wordsUsingOnly(chars, /* minLength */ 1);
    const score = matchingWords.reduce((s, w) => s + w.freq, 0);

    if (score > bestScore) {
      bestScore = score;
      bestSubset = Array.from(chars).sort();
    }
  }

  // If absolutely nothing passed the filters (shouldn't happen on standard layouts),
  // fall back to the first K alphabetical home-row chars.
  if (bestSubset.length === 0) {
    return homeRow
      .slice(0, k)
      .map((p) => p.char)
      .sort();
  }

  return bestSubset;
}

/** All k-element index combinations of [0..n). */
function* combinations(n: number, k: number): Generator<number[]> {
  const indices = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield indices.slice();
    let i = k - 1;
    while (i >= 0 && indices[i] === n - k + i) i--;
    if (i < 0) return;
    indices[i]++;
    for (let j = i + 1; j < k; j++) indices[j] = indices[j - 1] + 1;
  }
}
