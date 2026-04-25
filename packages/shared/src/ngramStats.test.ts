import { describe, it, expect } from 'vitest';
import {
  indexNgramStats,
  backoffErrorRate,
  weaknessScore,
  totalAttempts,
  meanTimePerHit,
  type NgramStatRow,
} from './ngramStats.js';

const baseRow = (
  ngram: string,
  type: NgramStatRow['ngram_type'],
  hits: number,
  misses: number,
  totalTimeMs = 0,
): NgramStatRow => ({ ngram, ngram_type: type, hits, misses, total_time_ms: totalTimeMs });

describe('indexNgramStats / totalAttempts', () => {
  it('sums hits + misses correctly', () => {
    const idx = indexNgramStats([baseRow('t', 'char1', 7, 3)]);
    expect(totalAttempts(idx, 'char1', 't')).toBe(10);
    expect(totalAttempts(idx, 'char1', 'x')).toBe(0);
  });
});

describe('backoffErrorRate', () => {
  it('uses direct stats when above MIN_NGRAM_SAMPLES', () => {
    // Raw 5/10 = 0.5; smoothed (5+1)/(10+10) = 0.3
    const idx = indexNgramStats([baseRow('th', 'char2', 5, 5)]);
    expect(backoffErrorRate(idx, 'th', 'char2')).toBeCloseTo(0.3, 6);
  });

  it('backs off a sparse trigram to the average of its bigrams', () => {
    const idx = indexNgramStats([
      baseRow('th', 'char2', 8, 2, 0), // 10 attempts → uses direct: (2+1)/(10+10)=0.15
      baseRow('he', 'char2', 0, 0, 0), // no data → backoff hits char1 fallback (~0.1)
    ]);
    // Backoff('th') = direct (above threshold) = 0.15
    // Backoff('he') = avg(backoff('h','char1'), backoff('e','char1')) = avg(0.1, 0.1) = 0.1
    // Backoff('the') sparse → avg(backoff('th','char2'), backoff('he','char2')) = (0.15 + 0.1)/2 = 0.125
    expect(backoffErrorRate(idx, 'the', 'char3')).toBeCloseTo(0.125, 4);
  });

  it('returns the prior when no data anywhere', () => {
    const idx = indexNgramStats([]);
    expect(backoffErrorRate(idx, 'x', 'char1')).toBeCloseTo(0.1, 6);
  });

  it('respects custom minSamples threshold', () => {
    // Direct has 3 attempts. With minSamples=2, treat as direct.
    const idx = indexNgramStats([baseRow('a', 'char1', 1, 2)]);
    // smoothed = (2+1)/(3+10) = 3/13 ≈ 0.230
    expect(backoffErrorRate(idx, 'a', 'char1', 2)).toBeCloseTo(3 / 13, 6);
  });
});

describe('weaknessScore', () => {
  it('multiplies error rate and frequency', () => {
    expect(weaknessScore(0.2, 0.05)).toBeCloseTo(0.01, 6);
    expect(weaknessScore(0, 0.1)).toBe(0);
  });
});

describe('meanTimePerHit', () => {
  it('returns total_time_ms / hits when hits > 0', () => {
    const idx = indexNgramStats([baseRow('t', 'char1', 4, 1, 800)]);
    expect(meanTimePerHit(idx, 'char1', 't')).toBe(200);
  });

  it('returns 0 when no hits', () => {
    expect(meanTimePerHit(indexNgramStats([]), 'char1', 'x')).toBe(0);
  });
});
