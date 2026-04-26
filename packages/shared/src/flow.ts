import { wordsUsingOnly } from './wordList.js';
import { backoffErrorRate, type NgramIndex } from './ngramStats.js';
import { MIN_NGRAM_SAMPLES } from './constants.js';

export interface FlowOptions {
  /** Set of allowed lowercase chars (the user's unlocked keys). */
  allowed: ReadonlySet<string>;
  /** Per-user ngram index for weakness scoring. */
  userIndex: NgramIndex;
  /** Number of words to emit (default 20). */
  numWords?: number;
  /**
   * Softmax temperature applied to MAX-normalized scores within a length
   * bucket (lower = greedier). 0.7 is a relaxed default that introduces
   * meaningful variety while still letting the user's weakness signal
   * steer sampling away from words they have already mastered.
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
  /** Max word length to include (default 9). */
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
  /**
   * Bigram-slowness coefficient. Each bigram contributes
   * `err_rate + alpha × slow_excess` to the score. `alpha = 1` means a
   * bigram typed at 2× the user's baseline pace is "as bad" as a 100%
   * miss rate. Default 1.0.
   */
  alpha?: number;
  /**
   * Trigram-error coefficient. Each trigram contributes `beta × err_rate`
   * to the score. Trigrams capture roll/scissor patterns that pure-bigram
   * scoring misses. Trigram TIMING data is intentionally not used —
   * `char3.total_time_ms` only stores the gap between letters 2 and 3
   * (= the trailing `char2` time), so it adds no information beyond
   * bigram timing. Default 0.5.
   */
  beta?: number;
  /**
   * Per-word slowness coefficient. Each word adds `delta × L × word_slow`
   * to the score, where `word_slow` is `slow_excess` of the word's mean
   * bigram time. Words that are *uniformly* slow throughout get extra
   * weight beyond what summing bigram pains already provides. Default 0.5.
   */
  delta?: number;
  /**
   * Cap on `slow_excess`. A bigram twice as slow as the user's baseline
   * yields `slow_excess = 1.0`; anything slower is clamped here so a
   * single very-slow outlier can't dominate the score. Default 1.0.
   */
  maxSlowExcess?: number;
  /**
   * Fallback baseline (in ms) used when the user has too few sampled
   * bigrams to compute their own median. ~200ms ≈ 60 wpm. Default 200.
   */
  defaultBaselineMs?: number;
  /**
   * Min sample count for a bigram (or char) to be used directly for
   * slowness scoring AND to count toward the user's baseline. Below
   * this threshold, slowness backs off (char2 → avg of two char1) or is
   * skipped entirely (slow_excess = 0). Default `MIN_NGRAM_SAMPLES` (10).
   */
  minSlowSamples?: number;
  /** Random source (injectable for tests). */
  rng?: () => number;
}

interface SlowParams {
  baselineMs: number;
  maxExcess: number;
  alpha: number;
  beta: number;
  delta: number;
  minSamples: number;
}

/**
 * Mean keypress time (`total_time_ms / hits`) for a specific ngram, or
 * `null` if there isn't enough data to use directly. We divide by hits
 * (not attempts) to match the convention in `analysis.ts` /
 * `topSlowNgrams` so the dashboard's "slow ngrams" panel and flow's
 * slowness signal speak the same language.
 */
function meanTimeOrNull(
  userIndex: NgramIndex,
  type: 'char1' | 'char2',
  ngram: string,
  minSamples: number,
): number | null {
  const row = userIndex.get(`${type}:${ngram}`);
  if (!row) return null;
  if (row.hits + row.misses < minSamples) return null;
  if (row.hits <= 0 || row.total_time_ms <= 0) return null;
  return row.total_time_ms / row.hits;
}

/**
 * Bigram mean time with backoff:
 *   - direct char2 if ≥minSamples attempts
 *   - else average of the two char1 mean times (whichever exist)
 *   - else null (no usable timing signal — slow_excess will be 0)
 */
function bigramTimeMs(
  userIndex: NgramIndex,
  bigram: string,
  minSamples: number,
): number | null {
  const direct = meanTimeOrNull(userIndex, 'char2', bigram, minSamples);
  if (direct !== null) return direct;
  const a = meanTimeOrNull(userIndex, 'char1', bigram[0], minSamples);
  const b = meanTimeOrNull(userIndex, 'char1', bigram[1], minSamples);
  if (a !== null && b !== null) return (a + b) / 2;
  if (a !== null) return a;
  if (b !== null) return b;
  return null;
}

/**
 * `slow_excess(t, baseline) = clamp((t / baseline) − 1, 0, maxExcess)`.
 *
 * Returns 0 for ngrams typed at-or-below the user's baseline pace, and
 * up to `maxExcess` for the slowest. With `maxExcess = 1`, a bigram
 * typed at 2× the user's baseline yields the same magnitude as a 100%
 * miss rate, which makes `alpha = 1` an intuitive "speed and accuracy
 * matter equally" weighting.
 */
function slowExcess(
  timeMs: number | null,
  baselineMs: number,
  maxExcess: number,
): number {
  if (timeMs === null || baselineMs <= 0) return 0;
  const ratio = timeMs / baselineMs;
  return Math.min(maxExcess, Math.max(0, ratio - 1));
}

/**
 * The user's baseline bigram-typing pace: the MEDIAN of `mean_time` over
 * all char2 bigrams with ≥`minSamples` attempts. Median is robust to a
 * handful of wildly slow outliers (e.g. one bigram you only ever hit
 * after long pauses), which would skew a mean-based baseline and make
 * everything else look fast by comparison.
 *
 * Returns `defaultMs` if the user has too few sampled bigrams — common
 * at cold start, in which case slow_excess will be approximately 0
 * everywhere and the score collapses to the existing accuracy-only
 * scoring.
 */
function computeUserBaselineMs(
  userIndex: NgramIndex,
  minSamples: number,
  defaultMs: number,
): number {
  const times: number[] = [];
  for (const [key, row] of userIndex) {
    if (!key.startsWith('char2:')) continue;
    if (row.hits + row.misses < minSamples) continue;
    if (row.hits <= 0 || row.total_time_ms <= 0) continue;
    times.push(row.total_time_ms / row.hits);
  }
  if (times.length === 0) return defaultMs;
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

/**
 * Score a word as a sum of four "pain" contributions:
 *
 *     score(w) = Σ_b [ err(b) + α · slow_excess(b) ]   // bigram pain
 *              + β · Σ_t  err(t)                       // trigram error
 *              + L · err(w)                            // per-word error
 *              + δ · L · slow_excess(w)                // per-word slowness
 *
 * Where `slow_excess(b)` is the user's pace on bigram `b` relative to
 * their median bigram pace, capped at `maxExcess`. `slow_excess(w)`
 * is `slow_excess` evaluated on the word's mean bigram time — it
 * captures words that are *uniformly* slow throughout (vs words with a
 * single slow spike, which the per-bigram sum already handles).
 *
 * Trigrams contribute their error rate but NOT their timing: the
 * tracker only records the trailing-bigram interval into `char3`, so
 * trigram-level timing carries no information that bigram-level timing
 * doesn't. Per-word `total_time_ms` is similarly only the time of the
 * space keystroke, so per-word slowness is *derived* from bigram times
 * rather than read directly from the `word1` row.
 *
 * We deliberately do NOT multiply by English-corpus bigram frequency.
 * The most common English bigrams (`th`, `he`, `in`, `er`, `an`, `re`,
 * `on`, `at`, …) are made almost entirely of letters that sit on the
 * Colemak home row, so multiplying by corpus frequency caused
 * cold-start flow to collapse onto short home-row-only words the user
 * already types fluently. With frequency dropped, words score purely on
 * "how badly does this user actually struggle with the bigrams in this
 * word" (plus the per-trigram and per-word miss rates as separate
 * signals).
 *
 * Sum (rather than mean) is chosen because length-stratified sampling
 * (see `generateFlowLine`) only ever ranks words against others of the
 * SAME length — so the length-grows-the-score concern that motivated
 * averaging in the prior implementation does not apply: every word in
 * a single bucket has the same number of bigrams (and trigrams)
 * contributing to its sum.
 */
function scoreWord(
  word: string,
  userIndex: NgramIndex,
  params: SlowParams,
): number {
  const wordErr = backoffErrorRate(userIndex, word, 'word1');

  if (word.length < 2) {
    const charErr = backoffErrorRate(userIndex, word, 'char1');
    return charErr + wordErr;
  }

  let bigramSum = 0;
  let bigramTimeTotal = 0;
  let bigramTimeCount = 0;

  for (let i = 0; i < word.length - 1; i++) {
    const bigram = word.slice(i, i + 2);
    const err = backoffErrorRate(userIndex, bigram, 'char2');
    const time = bigramTimeMs(userIndex, bigram, params.minSamples);
    const slow = slowExcess(time, params.baselineMs, params.maxExcess);
    bigramSum += err + params.alpha * slow;
    if (time !== null) {
      bigramTimeTotal += time;
      bigramTimeCount++;
    }
  }

  let trigramErrSum = 0;
  if (word.length >= 3) {
    for (let i = 0; i < word.length - 2; i++) {
      const tri = word.slice(i, i + 3);
      trigramErrSum += backoffErrorRate(userIndex, tri, 'char3');
    }
  }

  const avgBigramTime =
    bigramTimeCount > 0 ? bigramTimeTotal / bigramTimeCount : null;
  const wordSlow = slowExcess(avgBigramTime, params.baselineMs, params.maxExcess);

  const L = word.length;
  return (
    bigramSum +
    params.beta * trigramErrSum +
    L * wordErr +
    params.delta * L * wordSlow
  );
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
 *      with `scoreWord` (which combines bigram error + bigram slowness
 *      + trigram error + per-word error + per-word slowness) and keep
 *      the top-`topKPerLength` most painful.
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
 * user's actual weakness signal — error rate AND speed — without any
 * corpus-frequency multiplier (that's what made cold-start flow look
 * home-row-heavy on Colemak).
 *
 * With no user data, every error rate is the Bayesian prior (~0.1) and
 * every slow_excess is 0, so all words in a bucket score equally and
 * sampling is effectively uniform within each length — a much better
 * cold-start than "always emit the most-common short home-row words".
 */
export function generateFlowLine({
  allowed,
  userIndex,
  numWords = 20,
  temperature = 0.7,
  topKPerLength = 20,
  minLength = 4,
  maxLength = 9,
  recent,
  recentDecay = 0.15,
  alpha = 1.0,
  beta = 0.5,
  delta = 0.5,
  maxSlowExcess = 1.0,
  defaultBaselineMs = 200,
  minSlowSamples = MIN_NGRAM_SAMPLES,
  rng = Math.random,
}: FlowOptions): string {
  const lo = Math.max(1, minLength);
  const hi = Math.max(lo, maxLength);

  const candidates = wordsUsingOnly(allowed, lo);
  if (candidates.length === 0) return '';

  const baselineMs = computeUserBaselineMs(
    userIndex,
    minSlowSamples,
    defaultBaselineMs,
  );
  const params: SlowParams = {
    baselineMs,
    maxExcess: maxSlowExcess,
    alpha,
    beta,
    delta,
    minSamples: minSlowSamples,
  };

  type ScoredWord = { word: string; score: number };
  const poolByLength = new Map<number, ScoredWord[]>();
  for (const { word } of candidates) {
    if (word.length > hi) continue;
    let bucket = poolByLength.get(word.length);
    if (!bucket) {
      bucket = [];
      poolByLength.set(word.length, bucket);
    }
    bucket.push({ word, score: scoreWord(word, userIndex, params) });
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
