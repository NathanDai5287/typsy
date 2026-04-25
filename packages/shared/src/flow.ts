import { wordsUsingOnly, BIGRAM_FREQ, CHAR_FREQ } from './wordList.js';
import { backoffErrorRate, weaknessScore, type NgramIndex } from './ngramStats.js';

export interface FlowOptions {
  /** Set of allowed lowercase chars (the user's unlocked keys). */
  allowed: ReadonlySet<string>;
  /** Per-user ngram index for weakness scoring. */
  userIndex: NgramIndex;
  /** Number of words to emit (default 20). */
  numWords?: number;
  /**
   * Softmax temperature applied to MAX-normalized scores (lower = greedier).
   * 1.0 ≈ near-uniform, 0.1 ≈ heavy concentration on the top scorers, 0.3 is
   * a moderate default that lets the user's weakness signal actually steer
   * sampling without collapsing to the single highest-scoring word.
   */
  temperature?: number;
  /** Top-K candidate pool to sample from (default 60). */
  topK?: number;
  /** Recently shown words to penalize (set to apply novelty decay). */
  recent?: ReadonlySet<string>;
  /** Penalty multiplier for recent words (default 0.2; lower = harsher). */
  recentDecay?: number;
  /** Random source (injectable for tests). */
  rng?: () => number;
}

/**
 * Score a word as the AVERAGE per-bigram weakness:
 *
 *     score(word) = mean_b  weaknessScore(bigram_err(b) + word_err, bigram_freq(b))
 *
 *   - bigram_err(b)    = your smoothed error rate on bigram b (`char2` ngrams).
 *   - word_err         = your smoothed error rate on this exact word
 *                        (`word1` ngrams, tracked on every space).
 *   - bigram_freq(b)   = unconditional probability of b in the corpus.
 *
 * Averaging (rather than summing) keeps long and short words on the same
 * footing — otherwise a word's score grows linearly with its length and
 * cold-start sampling collapses onto multi-syllable monsters. The user's
 * per-word error rate is added to every bigram term so a word you've
 * personally fumbled has all of its bigrams "lit up", lifting it as a unit.
 *
 * Length-1 words have no bigrams, so the average collapses to the analogous
 * unigram term using CHAR_FREQ and the `char1` error rate.
 */
function scoreWord(word: string, userIndex: NgramIndex): number {
  const wordErr = backoffErrorRate(userIndex, word, 'word1');

  if (word.length < 2) {
    const charFreq = CHAR_FREQ.get(word) ?? 0;
    const charErr = backoffErrorRate(userIndex, word, 'char1');
    return weaknessScore(charErr + wordErr, charFreq);
  }
  let s = 0;
  for (let i = 0; i < word.length - 1; i++) {
    const bigram = word.slice(i, i + 2);
    const bigramErr = backoffErrorRate(userIndex, bigram, 'char2');
    const freq = BIGRAM_FREQ.get(bigram) ?? 0;
    s += weaknessScore(bigramErr + wordErr, freq);
  }
  return s / (word.length - 1);
}

/**
 * Weighted sample with softmax over MAX-normalized weights, so the
 * `temperature` parameter has a scale-invariant meaning regardless of how
 * large or small the absolute score values happen to be.
 *
 * Concretely: normalize so max weight → 1, then apply softmax with the given
 * temperature. Lower temperature = greedier; temperature → ∞ ≈ uniform.
 */
function softmaxSample<T>(items: T[], weights: number[], temperature: number, rng: () => number): T {
  if (items.length === 0) throw new Error('softmaxSample: empty items');
  if (items.length === 1) return items[0];

  const maxW = Math.max(...weights);
  if (maxW <= 0) return items[Math.floor(rng() * items.length)];

  const t = Math.max(temperature, 1e-6);
  const exp = weights.map((w) => Math.exp((w / maxW - 1) / t));
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
 *   1. Pre-filter the bundled word list to words using only `allowed` chars
 *      (and length ≥ 3, to avoid corpus noise gaming the per-bigram score).
 *   2. Score each word with `scoreWord`: average per-bigram weakness with
 *      the user's per-WORD error rate added on top of every bigram term.
 *   3. Take the top-K, then sample with softmax (max-normalized, so the
 *      `temperature` knob has a stable meaning regardless of score scale).
 *   4. Apply novelty decay: penalize words in `recent`.
 *   5. Repeat until `numWords` are emitted; join with spaces.
 */
export function generateFlowLine({
  allowed,
  userIndex,
  numWords = 20,
  temperature = 0.3,
  topK = 60,
  recent,
  recentDecay = 0.2,
  rng = Math.random,
}: FlowOptions): string {
  // minLength 3 — shorter "words" in the corpus are dominated by web-crawl
  // noise (single-letter bullets, two-letter abbreviations like "ver", "ind"),
  // and they tend to game the per-bigram averaging by being entirely composed
  // of common bigrams. Real practice should be on actual words.
  const candidates = wordsUsingOnly(allowed, /* minLength */ 3);
  if (candidates.length === 0) return '';

  const scored = candidates.map(({ word }) => {
    let score = scoreWord(word, userIndex);
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
