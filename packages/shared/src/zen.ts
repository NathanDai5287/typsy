import { wordsUsingOnly } from './wordList.js';
import { backoffErrorRate, type NgramIndex } from './ngramStats.js';
import { MIN_NGRAM_SAMPLES } from './constants.js';

export interface ZenOptions {
  /** Set of allowed lowercase chars (the user's unlocked keys). */
  allowed: ReadonlySet<string>;
  /** Per-user ngram index for strength scoring. */
  userIndex: NgramIndex;
  /** Number of words to emit (default 50). */
  numWords?: number;
  /** Softmax temperature over MAX-normalized weights (lower = greedier). */
  temperature?: number;
  /** For each length bucket, keep the top-K most mastered words (default 50). */
  topKPerLength?: number;
  /** Min word length to include (default 4). */
  minLength?: number;
  /** Max word length to include (default 9). */
  maxLength?: number;
  /** Words to treat as already-seen (one decay step each). */
  recent?: ReadonlySet<string>;
  /** Per-emit decay applied to a word's weight (default 0.15). */
  recentDecay?: number;
  /**
   * Bigram-speed coefficient. Each bigram contributes
   * `acc + alpha × fast_advantage` to the mastery score.
   */
  alpha?: number;
  /** Trigram-accuracy coefficient (default 0.25). */
  beta?: number;
  /** Per-word accuracy coefficient (default 0.5). */
  gamma?: number;
  /** Per-word speed coefficient (default 0.25). */
  delta?: number;
  /**
   * Cap on fast advantage (relative to baseline). With maxFastAdvantage=0.5,
   * a bigram typed at 50% of baseline pace yields the maximum.
   */
  maxFastAdvantage?: number;
  /** Fallback baseline (in ms) used when the user has too few sampled bigrams. */
  defaultBaselineMs?: number;
  /** Min sample count for a bigram (or char) to be used directly for speed scoring. */
  minFastSamples?: number;
  /** Min attempts for word1 to contribute confidence (default MIN_NGRAM_SAMPLES). */
  minWordSamples?: number;
  /**
   * Confidence half-life in attempts: confidence = attempts / (attempts + k).
   * Larger k makes Zen more conservative about calling something a strength.
   */
  confidenceK?: number;
  /** Random source (injectable for tests). */
  rng?: () => number;
}

interface SpeedParams {
  baselineMs: number;
  maxFast: number;
  alpha: number;
  beta: number;
  gamma: number;
  delta: number;
  minSamples: number;
  minWordSamples: number;
  confidenceK: number;
}

function attempts(index: NgramIndex, type: string, ngram: string): number {
  const row = index.get(`${type}:${ngram}`);
  return row ? row.hits + row.misses : 0;
}

function confidence(attemptsCount: number, k: number): number {
  if (attemptsCount <= 0) return 0;
  const kk = Math.max(1, k);
  return attemptsCount / (attemptsCount + kk);
}

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

function bigramTimeMs(userIndex: NgramIndex, bigram: string, minSamples: number): number | null {
  const direct = meanTimeOrNull(userIndex, 'char2', bigram, minSamples);
  if (direct !== null) return direct;
  const a = meanTimeOrNull(userIndex, 'char1', bigram[0], minSamples);
  const b = meanTimeOrNull(userIndex, 'char1', bigram[1], minSamples);
  if (a !== null && b !== null) return (a + b) / 2;
  if (a !== null) return a;
  if (b !== null) return b;
  return null;
}

/** clamp(1 - time/baseline, 0, maxFast) */
function fastAdvantage(timeMs: number | null, baselineMs: number, maxFast: number): number {
  if (timeMs === null || baselineMs <= 0) return 0;
  const adv = 1 - timeMs / baselineMs;
  return Math.min(maxFast, Math.max(0, adv));
}

function computeUserBaselineMs(userIndex: NgramIndex, minSamples: number, defaultMs: number): number {
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

function scoreWord(word: string, userIndex: NgramIndex, params: SpeedParams): number {
  const L = word.length;

  const wordAttempts = attempts(userIndex, 'word1', word);
  const wordErr = backoffErrorRate(userIndex, word, 'word1', params.minWordSamples);
  const wordAcc = 1 - wordErr;
  const wordConf = wordAttempts >= params.minWordSamples
    ? confidence(wordAttempts, params.confidenceK)
    : 0;

  if (L < 2) {
    const charAttempts = attempts(userIndex, 'char1', word);
    const charErr = backoffErrorRate(userIndex, word, 'char1', params.minSamples);
    const charAcc = 1 - charErr;
    const charConf = charAttempts >= params.minSamples
      ? confidence(charAttempts, params.confidenceK)
      : 0;
    return charConf * charAcc + wordConf * params.gamma * wordAcc;
  }

  let bigramAccSum = 0;
  let bigramFastSum = 0;
  let bigramTimeTotal = 0;
  let bigramTimeCount = 0;

  for (let i = 0; i < L - 1; i++) {
    const bigram = word.slice(i, i + 2);
    const bgAttempts = attempts(userIndex, 'char2', bigram);
    const bgErr = backoffErrorRate(userIndex, bigram, 'char2', params.minSamples);
    const bgAcc = 1 - bgErr;
    const bgConf = bgAttempts >= params.minSamples
      ? confidence(bgAttempts, params.confidenceK)
      : 0;

    const time = bigramTimeMs(userIndex, bigram, params.minSamples);
    const fast = fastAdvantage(time, params.baselineMs, params.maxFast);

    bigramAccSum += bgConf * bgAcc;
    bigramFastSum += bgConf * fast;

    if (time !== null) {
      bigramTimeTotal += time;
      bigramTimeCount++;
    }
  }

  let trigramAccSum = 0;
  if (L >= 3) {
    for (let i = 0; i < L - 2; i++) {
      const tri = word.slice(i, i + 3);
      const triAttempts = attempts(userIndex, 'char3', tri);
      const triErr = backoffErrorRate(userIndex, tri, 'char3', params.minSamples);
      const triAcc = 1 - triErr;
      const triConf = triAttempts >= params.minSamples
        ? confidence(triAttempts, params.confidenceK)
        : 0;
      trigramAccSum += triConf * triAcc;
    }
  }

  const avgBigramTime = bigramTimeCount > 0 ? bigramTimeTotal / bigramTimeCount : null;
  const wordFast = fastAdvantage(avgBigramTime, params.baselineMs, params.maxFast);

  return (
    bigramAccSum +
    params.alpha * bigramFastSum +
    params.beta * trigramAccSum +
    params.gamma * L * wordConf * wordAcc +
    params.delta * L * wordConf * wordFast
  );
}

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

export function generateZenLine({
  allowed,
  userIndex,
  numWords = 50,
  temperature = 0.7,
  topKPerLength = 50,
  minLength = 4,
  maxLength = 9,
  recent,
  recentDecay = 0.15,
  alpha = 1.0,
  beta = 0.25,
  gamma = 0.5,
  delta = 0.25,
  maxFastAdvantage = 0.5,
  defaultBaselineMs = 200,
  minFastSamples = MIN_NGRAM_SAMPLES,
  minWordSamples = MIN_NGRAM_SAMPLES,
  confidenceK = 20,
  rng = Math.random,
}: ZenOptions): string {
  const lo = Math.max(1, minLength);
  const hi = Math.max(lo, maxLength);

  const candidates = wordsUsingOnly(allowed, lo);
  if (candidates.length === 0) return '';

  const baselineMs = computeUserBaselineMs(userIndex, minFastSamples, defaultBaselineMs);
  const params: SpeedParams = {
    baselineMs,
    maxFast: maxFastAdvantage,
    alpha,
    beta,
    gamma,
    delta,
    minSamples: minFastSamples,
    minWordSamples,
    confidenceK,
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

  let lengths = Array.from(poolByLength.keys()).filter((L) => poolByLength.get(L)!.length >= 2);
  if (lengths.length === 0) lengths = Array.from(poolByLength.keys());
  if (lengths.length === 0) return '';

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
