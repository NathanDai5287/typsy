import { wordsUsingOnly } from './wordList.js';
import { backoffErrorRate, weaknessScore, type NgramIndex } from './ngramStats.js';

export interface FlowOptions {
  /** Set of allowed lowercase chars (the user's unlocked keys). */
  allowed: ReadonlySet<string>;
  /** Per-user ngram index for weakness scoring. */
  userIndex: NgramIndex;
  /** Number of words to emit (default 20). */
  numWords?: number;
  /** Softmax temperature on the candidate pool (default 1.0; lower = greedier). */
  temperature?: number;
  /** Top-K candidate pool to sample from (default 200). */
  topK?: number;
  /** Recently shown words to penalize (set to apply novelty decay). */
  recent?: ReadonlySet<string>;
  /** Penalty multiplier for recent words (default 0.2; lower = harsher). */
  recentDecay?: number;
  /** Random source (injectable for tests). */
  rng?: () => number;
}

/**
 * Score a word: sum of weakness scores across its constituent bigrams.
 * Words containing pain-point bigrams get higher scores, so they get more practice.
 */
function scoreWord(word: string, userIndex: NgramIndex, baseFreq: number): number {
  if (word.length < 2) {
    // Single-char words: rely on char1 weakness.
    return baseFreq * backoffErrorRate(userIndex, word, 'char1');
  }
  let s = 0;
  for (let i = 0; i < word.length - 1; i++) {
    const bigram = word.slice(i, i + 2);
    const errorRate = backoffErrorRate(userIndex, bigram, 'char2');
    s += weaknessScore(errorRate, baseFreq);
  }
  return s;
}

/** Weighted sample one item using softmax on `weights`. */
function softmaxSample<T>(items: T[], weights: number[], temperature: number, rng: () => number): T {
  if (items.length === 0) throw new Error('softmaxSample: empty items');
  if (items.length === 1) return items[0];

  const maxW = Math.max(...weights);
  const exp = weights.map((w) => Math.exp((w - maxW) / Math.max(temperature, 1e-6)));
  const total = exp.reduce((s, x) => s + x, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= exp[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Generate a flow-mode practice line: real English words composed of unlocked
 * letters, weighted toward the user's weak ngrams (spec §6.6).
 *
 *   1. Pre-filter the bundled word list to words using only `allowed` chars.
 *   2. Score each word: Σ weakness_score(bigram) over the word's bigrams.
 *   3. Take the top-K and sample with softmax over the score (temperature
 *      controls greediness).
 *   4. Apply novelty decay: penalize words in `recent`.
 *   5. Repeat until `numWords` are emitted; join with spaces.
 */
export function generateFlowLine({
  allowed,
  userIndex,
  numWords = 20,
  temperature = 1.0,
  topK = 200,
  recent,
  recentDecay = 0.2,
  rng = Math.random,
}: FlowOptions): string {
  const candidates = wordsUsingOnly(allowed, /* minLength */ 1);
  if (candidates.length === 0) return '';

  const scored = candidates.map(({ word, freq }) => {
    let score = scoreWord(word, userIndex, freq);
    if (recent && recent.has(word)) score *= recentDecay;
    return { word, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const pool = scored.slice(0, Math.min(topK, scored.length));

  const out: string[] = [];
  let lastWord: string | null = null;

  for (let i = 0; i < numWords; i++) {
    // Avoid immediate same-word repeats by resampling once.
    let pick = softmaxSample(
      pool.map((p) => p.word),
      pool.map((p) => p.score),
      temperature,
      rng,
    );
    if (pick === lastWord && pool.length > 1) {
      pick = softmaxSample(
        pool.map((p) => p.word),
        pool.map((p) => p.score),
        temperature,
        rng,
      );
    }
    out.push(pick);
    lastWord = pick;
  }

  return out.join(' ');
}
