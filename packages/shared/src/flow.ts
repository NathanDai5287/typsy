import { wordsUsingOnly } from './wordList.js';
import { backoffErrorRate, type NgramIndex } from './ngramStats.js';

export interface FlowOptions {
  /** Set of allowed lowercase chars (the user's unlocked keys). */
  allowed: ReadonlySet<string>;
  /** Per-user ngram index for weakness scoring. */
  userIndex: NgramIndex;
  /** Number of words to emit (default 20). */
  numWords?: number;
  /**
   * Softmax temperature applied to MAX-normalized scores within a length
   * bucket (lower = greedier). 0.4 is a moderate default that lets the
   * user's weakness signal actually steer sampling without collapsing to
   * the single highest-scoring word in a bucket.
   */
  temperature?: number;
  /**
   * For each length bucket, keep the top-K most painful words and sample
   * from those. Concentrates emissions on the user's actual weak spots
   * within a given length while length variety still comes from the
   * outer stratification step. Default 20.
   */
  topKPerLength?: number;
  /** Min word length to include (default 4). */
  minLength?: number;
  /** Max word length to include (default 12). */
  maxLength?: number;
  /**
   * Words to treat as already-seen (one decay step each). Combine with
   * the per-call internal emit-count tracking to penalize words shown in
   * earlier flow lines.
   */
  recent?: ReadonlySet<string>;
  /**
   * Per-emit decay applied to a word's weight: `weight × decay^count`,
   * where `count` includes both `recent` (one step) and how many times
   * the word has already been emitted in the current call. 0.2 means the
   * second emit of a word is only 20% as likely as the first, the third
   * 4%, etc. — strong enough that small candidate buckets cycle through
   * variety naturally rather than repeating the top word back-to-back.
   * Default 0.2.
   */
  recentDecay?: number;
  /** Random source (injectable for tests). */
  rng?: () => number;
}

/**
 * Score a word as the SUM of per-bigram smoothed user error rates plus
 * a length-scaled per-word error rate:
 *
 *     score(word) = Σ_b user_err_rate(bigram_b)
 *                 + length(word) × user_err_rate(word)
 *
 * We deliberately do NOT multiply by English-corpus bigram frequency.
 * The most common English bigrams (`th`, `he`, `in`, `er`, `an`, `re`,
 * `on`, `at`, …) are made almost entirely of letters that sit on the
 * Colemak home row, so multiplying by corpus frequency caused
 * cold-start flow to collapse onto short home-row-only words the user
 * already types fluently. With frequency dropped, words score purely on
 * "how badly does this user actually miss the bigrams in this word"
 * (plus the per-word miss rate as a separate signal).
 *
 * Sum (rather than mean) is chosen because length-stratified sampling
 * (see `generateFlowLine`) only ever ranks words against others of the
 * SAME length — so the length-grows-the-score concern that motivated
 * averaging in the prior implementation does not apply: every word in
 * a single bucket has the same number of bigrams contributing to its
 * sum.
 */
function scoreWord(word: string, userIndex: NgramIndex): number {
  const wordErr = backoffErrorRate(userIndex, word, 'word1');
  if (word.length < 2) {
    const charErr = backoffErrorRate(userIndex, word, 'char1');
    return charErr + wordErr;
  }
  let sum = 0;
  for (let i = 0; i < word.length - 1; i++) {
    const bigram = word.slice(i, i + 2);
    sum += backoffErrorRate(userIndex, bigram, 'char2');
  }
  return sum + word.length * wordErr;
}

/**
 * Weighted sample with softmax over MAX-normalized weights, so the
 * `temperature` parameter has a scale-invariant meaning regardless of
 * how large or small the absolute score values happen to be.
 *
 * Concretely: normalize so max weight → 1, then apply softmax with the
 * given temperature. Lower temperature = greedier; temperature → ∞ ≈ uniform.
 */
function softmaxSample<T>(
  items: readonly T[],
  weights: readonly number[],
  temperature: number,
  rng: () => number,
): T {
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
 * Generate a flow-mode practice line: real English words composed of
 * unlocked letters, with **length-stratified weakness sampling** (spec
 * §6.6, refined).
 *
 *   1. Filter the bundled top-10k word list to words whose chars are
 *      all `allowed` and whose length is in `[minLength, maxLength]`.
 *   2. Bucket candidates by length. For each bucket, score every word
 *      with `scoreWord` and keep the top-`topKPerLength` most painful.
 *   3. For each emitted word: pick a length L uniformly at random from
 *      the lengths that have any candidates, then softmax-sample a
 *      word from that bucket's top-K pool. A word's weight is
 *      multiplied by `recentDecay^N` where N is its emit count so far
 *      in this call (plus one if the word is in `recent`), so small
 *      buckets naturally cycle through their words rather than
 *      repeating the top scorer.
 *
 * Stratifying on length guarantees the output mixes 4-, 7-, 11-letter
 * words rather than collapsing to whatever length wins the global
 * scoring. Within a single length bucket, sampling is dominated by the
 * user's actual error signal (no corpus-frequency multiplier — that's
 * what made cold-start flow look home-row-heavy on Colemak).
 *
 * With no user data, every bigram error rate is the Bayesian prior
 * (~0.1), so all words in a bucket score equally and sampling is
 * effectively uniform within each length — a much better cold-start
 * than "always emit the most-common short home-row words".
 */
export function generateFlowLine({
  allowed,
  userIndex,
  numWords = 20,
  temperature = 0.4,
  topKPerLength = 20,
  minLength = 4,
  maxLength = 12,
  recent,
  recentDecay = 0.2,
  rng = Math.random,
}: FlowOptions): string {
  const lo = Math.max(1, minLength);
  const hi = Math.max(lo, maxLength);

  const candidates = wordsUsingOnly(allowed, lo);
  if (candidates.length === 0) return '';

  type ScoredWord = { word: string; score: number };
  const poolByLength = new Map<number, ScoredWord[]>();
  for (const { word } of candidates) {
    if (word.length > hi) continue;
    let bucket = poolByLength.get(word.length);
    if (!bucket) {
      bucket = [];
      poolByLength.set(word.length, bucket);
    }
    bucket.push({ word, score: scoreWord(word, userIndex) });
  }
  for (const bucket of poolByLength.values()) {
    bucket.sort((a, b) => b.score - a.score);
    if (bucket.length > topKPerLength) bucket.length = topKPerLength;
  }

  // Drop length buckets that have only one candidate: the recent-decay
  // mechanism can't redirect picks within a 1-item softmax, so a tiny
  // bucket would just spam its single word every time L was chosen. If
  // EVERY bucket has only one candidate (very restricted allowed set),
  // fall back to including them all so we still produce output.
  let lengths = Array.from(poolByLength.keys()).filter(
    (L) => poolByLength.get(L)!.length >= 2,
  );
  if (lengths.length === 0) lengths = Array.from(poolByLength.keys());
  if (lengths.length === 0) return '';

  // Per-call emit-count map (seeded from `recent`). Each emit of a word
  // multiplies its weight by `recentDecay`, so within a single call we
  // cycle through the bucket rather than spamming the top scorer.
  const emitCount = new Map<string, number>();
  if (recent) for (const w of recent) emitCount.set(w, 1);

  const out: string[] = [];

  for (let i = 0; i < numWords; i++) {
    const L = lengths[Math.floor(rng() * lengths.length)];
    const pool = poolByLength.get(L)!;

    const items = pool.map((p) => p.word);
    const weights = pool.map((p) => {
      const c = emitCount.get(p.word) ?? 0;
      return c === 0 ? p.score : p.score * Math.pow(recentDecay, c);
    });

    const pick = softmaxSample(items, weights, temperature, rng);
    out.push(pick);
    emitCount.set(pick, (emitCount.get(pick) ?? 0) + 1);
  }

  return out.join(' ');
}
