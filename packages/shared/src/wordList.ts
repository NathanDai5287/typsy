import { WORD_COUNTS } from './wordListData.js';

/**
 * Real English word frequencies from Norvig's web-crawl unigram counts
 * (top 10,000 a-z words, see wordListData.ts).
 *
 * Used by:
 *   - initialSubset.ts: scoring candidate home-row subsets
 *   - flow.ts:          filtering to words composed of unlocked letters
 *   - markov.ts:        weighting char-transition statistics
 */

/** Total of all raw counts, used to normalize into probabilities. */
const TOTAL_COUNT = WORD_COUNTS.reduce((s, [, c]) => s + c, 0);

/** Word → normalized frequency (sums to 1 across the full list). */
export const WORD_FREQ: ReadonlyMap<string, number> = (() => {
  const map = new Map<string, number>();
  for (const [w, c] of WORD_COUNTS) map.set(w, c / TOTAL_COUNT);
  return map;
})();

/** Word → raw count (useful when relative ratios matter, not the normalization). */
export const WORD_RAW: ReadonlyMap<string, number> = (() => {
  const map = new Map<string, number>();
  for (const [w, c] of WORD_COUNTS) map.set(w, c);
  return map;
})();

/** All words in descending-frequency order. */
export const ALL_WORDS: readonly string[] = WORD_COUNTS.map(([w]) => w);

/**
 * Words that use ONLY characters in `allowedChars`. Result is sorted by
 * descending frequency.
 *
 * @param allowedChars - Set of allowed lowercase chars (e.g. unlocked keys).
 * @param minLength    - Minimum word length to include (default 1).
 */
export function wordsUsingOnly(
  allowedChars: ReadonlySet<string>,
  minLength = 1,
): { word: string; freq: number }[] {
  const out: { word: string; freq: number }[] = [];
  for (const [word, count] of WORD_COUNTS) {
    if (word.length < minLength) continue;
    let ok = true;
    for (let i = 0; i < word.length; i++) {
      if (!allowedChars.has(word[i])) {
        ok = false;
        break;
      }
    }
    if (ok) out.push({ word, freq: count / TOTAL_COUNT });
  }
  return out;
}
