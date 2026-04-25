import { MIN_NGRAM_SAMPLES } from './constants.js';
import { smoothedErrorRate } from './bayesian.js';

export interface NgramStatRow {
  ngram: string;
  ngram_type: 'char1' | 'char2' | 'char3' | 'word1' | 'word2';
  hits: number;
  misses: number;
  total_time_ms: number;
}

/** Fast lookup map: `${type}:${ngram}` → row. */
export type NgramIndex = ReadonlyMap<string, NgramStatRow>;

/** Build an in-memory index from a flat list of stat rows. */
export function indexNgramStats(rows: readonly NgramStatRow[]): NgramIndex {
  const map = new Map<string, NgramStatRow>();
  for (const row of rows) {
    map.set(`${row.ngram_type}:${row.ngram}`, row);
  }
  return map;
}

/** Total attempts (hits + misses) for an ngram, or 0 if absent. */
export function totalAttempts(index: NgramIndex, type: NgramStatRow['ngram_type'], ngram: string): number {
  const row = index.get(`${type}:${ngram}`);
  return row ? row.hits + row.misses : 0;
}

/**
 * Return the smoothed error rate for an ngram, OR a backed-off estimate built
 * from constituent lower-order ngrams when the higher-order sample size is
 * below `MIN_NGRAM_SAMPLES`.
 *
 * Backoff rules (per spec §6.2):
 *   - char3 below threshold → average error rate of its two char2 substrings
 *   - char2 below threshold → average error rate of its two char1 chars
 *   - char1 below threshold → smoothed default (the prior, ~0.1)
 *
 * @param index - Pre-built ngram index (use indexNgramStats).
 * @param ngram - The ngram string (1-3 chars for char* types; words for word*).
 * @param type  - Which ngram tier to start at.
 * @param minSamples - Threshold for backoff (default MIN_NGRAM_SAMPLES = 10).
 */
export function backoffErrorRate(
  index: NgramIndex,
  ngram: string,
  type: NgramStatRow['ngram_type'],
  minSamples = MIN_NGRAM_SAMPLES,
): number {
  const direct = index.get(`${type}:${ngram}`);
  if (direct && direct.hits + direct.misses >= minSamples) {
    return smoothedErrorRate(direct.hits, direct.misses);
  }

  switch (type) {
    case 'char3': {
      // Average the two overlapping bigrams: chars 0-1 and 1-2.
      const a = backoffErrorRate(index, ngram.slice(0, 2), 'char2', minSamples);
      const b = backoffErrorRate(index, ngram.slice(1, 3), 'char2', minSamples);
      return (a + b) / 2;
    }
    case 'char2': {
      // Average the two unigrams.
      const a = backoffErrorRate(index, ngram[0], 'char1', minSamples);
      const b = backoffErrorRate(index, ngram[1], 'char1', minSamples);
      return (a + b) / 2;
    }
    case 'char1': {
      // No backoff target; return smoothed estimate (with a prior if direct is undefined).
      if (direct) return smoothedErrorRate(direct.hits, direct.misses);
      return smoothedErrorRate(0, 0); // = α / (α + β) = 0.1 with defaults
    }
    case 'word1':
    case 'word2': {
      // For words we just return the smoothed estimate (or prior). No char-based backoff.
      if (direct) return smoothedErrorRate(direct.hits, direct.misses);
      return smoothedErrorRate(0, 0);
    }
  }
}

/** Mean keypress duration in ms for an ngram (returns 0 if no samples). */
export function meanTimePerHit(
  index: NgramIndex,
  type: NgramStatRow['ngram_type'],
  ngram: string,
): number {
  const row = index.get(`${type}:${ngram}`);
  if (!row || row.hits === 0) return 0;
  return row.total_time_ms / row.hits;
}

/**
 * Weakness score for a bigram: error_rate × frequency. Bigrams with high
 * error rate and high frequency contribute most to typing pain, so they
 * deserve the most practice.
 *
 * @param errorRate - smoothed/backed-off error rate
 * @param frequency - occurrence frequency in the target corpus (0..1 or any positive)
 */
export function weaknessScore(errorRate: number, frequency: number): number {
  return errorRate * frequency;
}
