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
 * Bigram → normalized frequency across the corpus, weighted by word counts.
 * For each word with raw count c, every bigram occurrence contributes c to that
 * bigram's tally; the result is then normalized so all values sum to 1.
 *
 * This is the unconditional probability of encountering a given bigram at a
 * random position inside a real English word — the right notion of "how often
 * will I have to type this bigram?" for weakness-targeted practice.
 */
export const BIGRAM_FREQ: ReadonlyMap<string, number> = (() => {
  const counts = new Map<string, number>();
  let total = 0;
  for (const [word, c] of WORD_COUNTS) {
    for (let i = 0; i < word.length - 1; i++) {
      const bg = word.slice(i, i + 2);
      counts.set(bg, (counts.get(bg) ?? 0) + c);
      total += c;
    }
  }
  if (total === 0) return new Map();
  const out = new Map<string, number>();
  for (const [bg, n] of counts) out.set(bg, n / total);
  return out;
})();

/**
 * Character → normalized frequency across the corpus, weighted by word counts.
 * Same construction as BIGRAM_FREQ but for single chars; used as the unigram
 * fallback when scoring length-1 candidate words ("a", "i", …).
 */
export const CHAR_FREQ: ReadonlyMap<string, number> = (() => {
  const counts = new Map<string, number>();
  let total = 0;
  for (const [word, c] of WORD_COUNTS) {
    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      counts.set(ch, (counts.get(ch) ?? 0) + c);
      total += c;
    }
  }
  if (total === 0) return new Map();
  const out = new Map<string, number>();
  for (const [ch, n] of counts) out.set(ch, n / total);
  return out;
})();

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

/**
 * Top-frequency corpus words that (a) contain `substring` and (b) use only
 * `allowedChars`. Returns at most `limit` words sorted by descending frequency.
 *
 * Used by drill generation to follow a bigram burst with real words that
 * exercise the same motor pattern (e.g. `"st"` → `["state", "first", "must"]`).
 */
export function wordsContaining(
  substring: string,
  allowedChars: ReadonlySet<string>,
  limit = 3,
): string[] {
  if (substring.length === 0) return [];
  const out: { word: string; count: number }[] = [];
  for (const [word, count] of WORD_COUNTS) {
    if (!word.includes(substring)) continue;
    let ok = true;
    for (let i = 0; i < word.length; i++) {
      if (!allowedChars.has(word[i])) {
        ok = false;
        break;
      }
    }
    if (ok) out.push({ word, count });
  }
  out.sort((a, b) => b.count - a.count);
  return out.slice(0, limit).map((x) => x.word);
}
