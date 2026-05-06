import { describe, expect, it } from 'vitest';
import { indexNgramStats } from './ngramStats.js';
import { generateZenLine } from './zen.js';

describe('generateZenLine', () => {
  it('emits only allowed lowercase words', () => {
    const allowed = new Set('thate '.trim().split(''));
    const rows = indexNgramStats([]);
    const line = generateZenLine({
      allowed,
      userIndex: rows,
      numWords: 20,
      minLength: 4,
      maxLength: 4,
      rng: () => 0.123,
    });
    expect(line.length).toBeGreaterThan(0);
    for (const w of line.split(' ')) {
      for (const ch of w) expect(allowed.has(ch)).toBe(true);
    }
  });

  it('prefers high-confidence high-accuracy words when seeded', () => {
    const allowed = new Set(['t', 'h', 'a', 'e']);

    // Baseline: ~200ms, but give some bigrams very fast times.
    const rows = indexNgramStats([
      // that: th ha at (great)
      { ngram: 'th', ngram_type: 'char2', hits: 50, misses: 0, total_time_ms: 50 * 120 },
      { ngram: 'ha', ngram_type: 'char2', hits: 50, misses: 0, total_time_ms: 50 * 120 },
      { ngram: 'at', ngram_type: 'char2', hits: 50, misses: 0, total_time_ms: 50 * 120 },
      { ngram: 'tha', ngram_type: 'char3', hits: 30, misses: 0, total_time_ms: 30 * 120 },
      { ngram: 'hat', ngram_type: 'char3', hits: 30, misses: 0, total_time_ms: 30 * 120 },

      // hate: ha at te (worse accuracy, slower)
      { ngram: 'te', ngram_type: 'char2', hits: 10, misses: 10, total_time_ms: 10 * 260 },

      // Word-level confidence (word1)
      { ngram: 'that', ngram_type: 'word1', hits: 40, misses: 0, total_time_ms: 40 * 200 },
      { ngram: 'hate', ngram_type: 'word1', hits: 10, misses: 5, total_time_ms: 10 * 240 },
    ]);

    const line = generateZenLine({
      allowed,
      userIndex: rows,
      numWords: 5,
      minLength: 4,
      maxLength: 4,
      temperature: 0.001,
      recentDecay: 1,
      rng: () => 0,
    });

    expect(line.split(' ')[0]).toBe('that');
  });
});
