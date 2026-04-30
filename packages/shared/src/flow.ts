import { wordsUsingOnly } from './wordList.js';
import { backoffErrorRate, type NgramIndex } from './ngramStats.js';
import { MIN_NGRAM_SAMPLES } from './constants.js';

export interface FlowOptions {
  /** Set of allowed lowercase chars (the user's unlocked keys). */
  allowed: ReadonlySet<string>;
  /** Per-user ngram index for weakness scoring. */
  userIndex: NgramIndex;
  /** Number of words to emit (default 50). */
  numWords?: number;
  /**
   * Fraction of emitted words drawn uniformly from the FULL filtered
   * candidate pool (any length in `[minLength, maxLength]`) rather than
   * from the score-based top-K. Random picks are then shuffled together
   * with the scored picks. This breaks the perceived "samey" feel that
   * comes from the score function picking the same handful of weak words
   * every chunk. Default 0.25 (so a 50-word line carries ~13 random
   * words and ~37 weakness-targeted ones).
   */
  randomFraction?: number;
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
   * the word has already been emitted in the current call. 0.15 means
   * the second emit of a word is only 15% as likely as the first, the
   * third 2.25%, etc. — strong enough that small candidate buckets
   * cycle through variety rather than repeating the top word.
   * Default 0.15.
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
 * unlocked letters, with **length-stratified weakness sampling** plus
 * a configurable injection of pure-random words.
 *
 *   1. Filter the bundled top-10k word list to words whose chars are
 *      all `allowed` and whose length is in `[minLength, maxLength]`.
 *   2. Bucket candidates by length. For each bucket, score every word
 *      with `scoreWord` (bigram error + bigram slowness + trigram error
 *      + per-word error + per-word slowness) and keep a top-K "scored
 *      pool" of the most painful. Keep the un-truncated bucket too as
 *      the "random pool" — random picks draw from that.
 *   3. Compute `numRandom = round(numWords × randomFraction)` and
 *      `numScored = numWords − numRandom`. Pick that many words from
 *      each pool — scored picks via softmax over weakness, random
 *      picks via uniform sampling from the full bucket — then shuffle
 *      the combined list before joining.
 *
 * The same `recentDecay^N` per-emit decay applies to BOTH pools
 * (seeded by `recent` for cross-call memory and incremented on every
 * pick within this call), so the two streams cooperate: a word that
 * already showed up as a scored pick is unlikely to be re-picked as a
 * random one and vice versa.
 *
 * Why the random injection: the score function tends to pick the same
 * handful of "worst" words on every call, which feels repetitive even
 * though `recentDecay` rotates within a single call. Mixing in a
 * fraction of unbiased samples breaks that pattern without throwing
 * away weakness targeting — the user still spends most of the line on
 * their actual weak spots.
 *
 * With no user data, every error rate is the Bayesian prior (~0.1) and
 * every slow_excess is 0, so all words in a bucket score equally and
 * the scored stream collapses to uniform-within-length anyway.
 */
export function generateFlowLine({
  allowed,
  userIndex,
  numWords = 50,
  temperature = 0.7,
  topKPerLength = 20,
  minLength = 4,
  maxLength = 9,
  recent,
  recentDecay = 0.15,
  randomFraction = 0.25,
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
  const rf = Math.max(0, Math.min(1, randomFraction));

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
  const fullByLength = new Map<number, string[]>();
  for (const { word } of candidates) {
    if (word.length > hi) continue;
    let scored = poolByLength.get(word.length);
    if (!scored) {
      scored = [];
      poolByLength.set(word.length, scored);
    }
    scored.push({ word, score: scoreWord(word, userIndex, params) });

    let full = fullByLength.get(word.length);
    if (!full) {
      full = [];
      fullByLength.set(word.length, full);
    }
    full.push(word);
  }
  for (const bucket of poolByLength.values()) {
    bucket.sort((a, b) => b.score - a.score);
    if (bucket.length > topKPerLength) bucket.length = topKPerLength;
  }

  // Drop length buckets that have only one candidate from the SCORED
  // stream: the recent-decay mechanism can't redirect picks within a
  // 1-item softmax, so a tiny bucket would just spam its single word.
  // The random stream doesn't have this problem (uniform over the full
  // bucket) so it keeps its own un-filtered length set.
  let scoredLengths = Array.from(poolByLength.keys()).filter(
    (L) => poolByLength.get(L)!.length >= 2,
  );
  if (scoredLengths.length === 0) scoredLengths = Array.from(poolByLength.keys());
  const randomLengths = Array.from(fullByLength.keys());
  if (scoredLengths.length === 0 && randomLengths.length === 0) return '';

  // Per-call emit-count map (seeded from `recent`). Each emit of a word
  // multiplies its weight by `recentDecay`, so within a single call we
  // cycle through variety rather than spamming the top scorer.
  const emitCount = new Map<string, number>();
  if (recent) for (const w of recent) emitCount.set(w, 1);

  const numRandomTarget = Math.round(numWords * rf);
  const numRandom =
    randomLengths.length > 0 ? numRandomTarget : 0;
  const numScored = Math.max(0, numWords - numRandom);

  const out: string[] = [];

  for (let i = 0; i < numScored; i++) {
    if (scoredLengths.length === 0) break;
    const L = scoredLengths[Math.floor(rng() * scoredLengths.length)];
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

  for (let i = 0; i < numRandom; i++) {
    const L = randomLengths[Math.floor(rng() * randomLengths.length)];
    const pool = fullByLength.get(L)!;
    const weights = pool.map((w) => {
      const c = emitCount.get(w) ?? 0;
      return c === 0 ? 1 : Math.pow(recentDecay, c);
    });
    const pick = softmaxSample(pool, weights, temperature, rng);
    out.push(pick);
    emitCount.set(pick, (emitCount.get(pick) ?? 0) + 1);
  }

  // Fisher-Yates shuffle so the random picks are interleaved with
  // scored picks rather than tacked onto the end.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }

  return out.join(' ');
}
