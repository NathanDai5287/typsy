import { describe, it, expect } from 'vitest';
import {
  getBaseTransitions,
  buildMaskedTransitions,
  generateMarkovSequence,
  topWeakBigrams,
} from './markov.js';
import { indexNgramStats } from './ngramStats.js';

const allowed = new Set(['a', 'e', 'n', 't', ' ']);

describe('getBaseTransitions', () => {
  it('contains common bigrams from English', () => {
    const t = getBaseTransitions();
    // 'th' should be a high-weight transition because of 'the', 'that', etc.
    const tRow = t.get('t');
    expect(tRow).toBeDefined();
    expect(tRow!.get('h')).toBeGreaterThan(0);
  });
});

describe('buildMaskedTransitions', () => {
  it('drops chars outside the allowed set', () => {
    const masked = buildMaskedTransitions(allowed, indexNgramStats([]));
    // Source 'q' was excluded (not in allowed)
    expect(masked.transitions.has('q')).toBe(false);
    // Source 't' should be present
    expect(masked.transitions.has('t')).toBe(true);
    // Destination 'q' should never appear
    for (const row of masked.transitions.values()) {
      expect(row.has('q')).toBe(false);
    }
  });

  it('weakness bias amplifies bigrams the user struggles with', () => {
    const userIdx = indexNgramStats([
      { ngram: 'an', ngram_type: 'char2', hits: 30, misses: 70, total_time_ms: 0 },
      { ngram: 'at', ngram_type: 'char2', hits: 100, misses: 0, total_time_ms: 0 },
    ]);
    const noBias = buildMaskedTransitions(allowed, userIdx, 0);
    const heavyBias = buildMaskedTransitions(allowed, userIdx, 100);

    const anBase = noBias.transitions.get('a')!.get('n')!;
    const anBiased = heavyBias.transitions.get('a')!.get('n')!;
    expect(anBiased).toBeGreaterThan(anBase);

    const atBase = noBias.transitions.get('a')!.get('t')!;
    const atBiased = heavyBias.transitions.get('a')!.get('t')!;
    // 'at' has near-zero error rate so its weight should barely change.
    expect(atBiased / atBase).toBeLessThan(anBiased / anBase);
  });
});

describe('generateMarkovSequence', () => {
  it('produces output of approximately the requested length', () => {
    const masked = buildMaskedTransitions(allowed, indexNgramStats([]));
    const seq = generateMarkovSequence(masked, 50);
    expect(seq.length).toBeGreaterThanOrEqual(40);
    expect(seq.length).toBeLessThan(80);
  });

  it('only contains allowed characters', () => {
    const masked = buildMaskedTransitions(allowed, indexNgramStats([]));
    const seq = generateMarkovSequence(masked, 50);
    for (const c of seq) {
      expect(allowed.has(c)).toBe(true);
    }
  });

  it('is deterministic with a seeded RNG', () => {
    const masked = buildMaskedTransitions(allowed, indexNgramStats([]));
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const a = generateMarkovSequence(masked, 30, seedRng(42));
    const b = generateMarkovSequence(masked, 30, seedRng(42));
    expect(a).toEqual(b);
  });
});

describe('topWeakBigrams', () => {
  it('returns the user\'s weakest bigrams limited to allowed chars', () => {
    const userIdx = indexNgramStats([
      { ngram: 'an', ngram_type: 'char2', hits: 30, misses: 70, total_time_ms: 0 },
      { ngram: 'na', ngram_type: 'char2', hits: 30, misses: 70, total_time_ms: 0 },
      { ngram: 'qa', ngram_type: 'char2', hits: 0, misses: 100, total_time_ms: 0 }, // 'q' not allowed
    ]);
    const weak = topWeakBigrams(userIdx, allowed, 5);
    // 'qa' must be filtered out.
    expect(weak).not.toContain('qa');
    // The two weak bigrams that ARE allowed should be in the top results.
    expect(weak).toContain('an');
  });
});
