import { topWeakBigrams } from './markov.js';
import { wordsContaining } from './wordList.js';
import { backoffErrorRate, type NgramIndex } from './ngramStats.js';

export interface DrillOptions {
  /** Set of allowed lowercase chars (the user's unlocked keys). */
  allowed: ReadonlySet<string>;
  /** Per-user ngram index for weakness biasing. */
  userIndex: NgramIndex;
  /** Target sequence length in characters (default 50, spec says 30–80). */
  length?: number;
  /** Number of distinct weak bigrams to drill in one sequence (default 3). */
  numBigrams?: number;
  /** Real corpus words emitted after each bigram burst (default 3). */
  wordsPerBigram?: number;
  /** Repetitions in a bigram burst, e.g. 3 → "st st st" (default 3). */
  burstReps?: number;
  /** Number of user-weak words to splice in at the end (default 5). */
  numWeakWords?: number;
  /** Min attempts before a tracked word is eligible as "commonly missed" (default 5). */
  minWeakWordAttempts?: number;
  /** Random source (injectable for tests). */
  rng?: () => number;
  /**
   * @deprecated Drill no longer uses Markov-chain weight biasing. Kept for
   * API compatibility; ignored.
   */
  bias?: number;
}

/**
 * Generate a drill-mode practice sequence focused on the user's pain points.
 *
 * The sequence is built from segments rather than a Markov walk, so output is
 * always real-word-shaped:
 *
 *   1. Pick the top-K weakest bigrams (allowed chars only, no whitespace).
 *   2. For each bigram emit:
 *        - a short repetition burst, e.g. `"st st st"`
 *        - the highest-frequency corpus words containing that bigram, e.g.
 *          `"state first must"`
 *   3. Append the user's "commonly missed" words — top `word1` ngrams by
 *      smoothed error rate × log(attempts), filtered to allowed chars.
 *   4. Concatenate segments (shuffled on every wrap) until the target length
 *      is reached, truncating cleanly at a word boundary.
 *
 * With no user data, weak bigrams collapse to the most common English bigrams
 * (th, he, in, …) so the drill still produces sensible warm-up content.
 */
export function generateDrillSequence({
  allowed,
  userIndex,
  length = 50,
  numBigrams = 3,
  wordsPerBigram = 3,
  burstReps = 3,
  numWeakWords = 5,
  minWeakWordAttempts = 5,
  rng = Math.random,
}: DrillOptions): string {
  const allowedWithSpace = new Set(allowed);
  allowedWithSpace.add(' ');

  // Top weak bigrams, dropping any that touch a space boundary.
  const weakBigrams = topWeakBigrams(userIndex, allowedWithSpace, numBigrams * 4)
    .filter((bg) => !bg.includes(' '))
    .slice(0, numBigrams);

  const weakWords = topWeakWordsFromIndex(
    userIndex,
    allowed,
    numWeakWords,
    minWeakWordAttempts,
  );

  // Each "block" is one cohesive practice unit (burst + its words). Blocks
  // are shuffled as a whole so consecutive drills look different but each
  // burst stays adjacent to the real words that exercise the same bigram.
  const blocks: string[] = [];
  for (const bigram of weakBigrams) {
    const burst = repeat(bigram, burstReps);
    const words = wordsContaining(bigram, allowed, wordsPerBigram);
    blocks.push(words.length > 0 ? `${burst} ${words.join(' ')}` : burst);
  }
  if (weakWords.length > 0) blocks.push(weakWords.join(' '));

  // Fallback: no weak bigrams could be selected (e.g. allowed set has < 2
  // letters that ever co-occur). Drill the unlocked single chars instead so
  // the user still has *something* to type.
  if (blocks.length === 0) {
    for (const c of allowed) {
      if (c === ' ') continue;
      blocks.push(`${c}${c}${c}${c}`);
    }
    if (blocks.length === 0) return '';
  }

  return assembleToLength(blocks, length, rng);
}

/** Repeat a token `n` times separated by spaces, e.g. ("st", 3) → "st st st". */
function repeat(token: string, n: number): string {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(token);
  return parts.join(' ');
}

/**
 * Concatenate blocks (space-separated) until total length ≥ target. Blocks
 * are shuffled on every pass so consecutive drills produce different
 * orderings even when the underlying bigrams haven't changed. Output is
 * truncated at the last word boundary at or before `length` (but never
 * below `length / 2`).
 */
function assembleToLength(blocks: string[], length: number, rng: () => number): string {
  if (blocks.length === 0) return '';
  let out = '';
  let pass = 0;
  // Hard cap to prevent infinite loops on pathologically short blocks.
  while (out.length < length && pass < 32) {
    const order = shuffle(blocks, rng);
    for (const seg of order) {
      out += (out ? ' ' : '') + seg;
      if (out.length >= length) break;
    }
    pass++;
  }
  if (out.length > length) {
    const lastSpace = out.lastIndexOf(' ', length);
    if (lastSpace >= Math.floor(length / 2)) out = out.slice(0, lastSpace);
  }
  return out.replace(/\s+/g, ' ').trim();
}

function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Top-K user-weak words from the `word1` index, ranked by smoothed error
 * rate × log(attempts) so we prefer words seen multiple times. Restricted to
 * words composed entirely of `allowed` chars.
 */
function topWeakWordsFromIndex(
  userIndex: NgramIndex,
  allowed: ReadonlySet<string>,
  topK: number,
  minAttempts: number,
): string[] {
  const scored: { word: string; score: number }[] = [];
  for (const [, row] of userIndex) {
    if (row.ngram_type !== 'word1') continue;
    const attempts = row.hits + row.misses;
    if (attempts < minAttempts) continue;
    if (!allUsesAllowed(row.ngram, allowed)) continue;
    const errorRate = backoffErrorRate(userIndex, row.ngram, 'word1');
    scored.push({ word: row.ngram, score: errorRate * Math.log(1 + attempts) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((x) => x.word);
}

function allUsesAllowed(word: string, allowed: ReadonlySet<string>): boolean {
  for (let i = 0; i < word.length; i++) {
    if (!allowed.has(word[i])) return false;
  }
  return true;
}
