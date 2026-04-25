import { describe, it, expect } from 'vitest';
import { generateDrillSequence } from './drill.js';
import { indexNgramStats } from './ngramStats.js';

const allowed = new Set(['a', 'e', 'n', 't']);

describe('generateDrillSequence', () => {
  it('returns a non-empty string composed of allowed chars (plus space)', () => {
    const seq = generateDrillSequence({
      allowed,
      userIndex: indexNgramStats([]),
      length: 30,
    });
    expect(seq.length).toBeGreaterThan(0);
    const allowedWithSpace = new Set([...allowed, ' ']);
    for (const c of seq) {
      expect(allowedWithSpace.has(c)).toBe(true);
    }
  });

  it('does not start or end with whitespace', () => {
    const seq = generateDrillSequence({
      allowed,
      userIndex: indexNgramStats([]),
      length: 30,
    });
    expect(seq.trim()).toEqual(seq);
  });

  it('contains repeated bursts of the user\'s weakest bigram', () => {
    // Make "an" overwhelmingly the worst bigram in the allowed set.
    const userIndex = indexNgramStats([
      { ngram: 'an', ngram_type: 'char2', hits: 5, misses: 95, total_time_ms: 0 },
      { ngram: 'at', ngram_type: 'char2', hits: 100, misses: 0, total_time_ms: 0 },
      { ngram: 'en', ngram_type: 'char2', hits: 100, misses: 0, total_time_ms: 0 },
      { ngram: 'ne', ngram_type: 'char2', hits: 100, misses: 0, total_time_ms: 0 },
    ]);
    const seq = generateDrillSequence({
      allowed,
      userIndex,
      length: 60,
      numBigrams: 1,
      wordsPerBigram: 0,
      numWeakWords: 0,
      burstReps: 4,
    });
    // Burst is "an an an an" — at minimum, several non-overlapping "an" tokens.
    const tokens = seq.split(' ').filter((t) => t === 'an');
    expect(tokens.length).toBeGreaterThanOrEqual(3);
  });

  it('includes corpus words containing the weak bigram', () => {
    // Allow enough chars that real words are reachable.
    const wide = new Set(['a', 'e', 'i', 'n', 'o', 'r', 's', 't', 'h']);
    const userIndex = indexNgramStats([
      { ngram: 'th', ngram_type: 'char2', hits: 5, misses: 95, total_time_ms: 0 },
    ]);
    const seq = generateDrillSequence({
      allowed: wide,
      userIndex,
      length: 80,
      numBigrams: 1,
      wordsPerBigram: 3,
      numWeakWords: 0,
      burstReps: 1,
    });
    // Some recognizable English word containing "th" and only allowed chars
    // (e.g. "the", "this", "that", "these") should appear.
    const knownThWords = ['the', 'this', 'that', 'these', 'their', 'there', 'than'];
    const found = knownThWords.some((w) => seq.split(' ').includes(w));
    expect(found).toBe(true);
  });

  it('includes user-weak words when they meet the attempts threshold', () => {
    const userIndex = indexNgramStats([
      // Two user-tracked words; "tan" is much worse than "tea".
      { ngram: 'tan', ngram_type: 'word1', hits: 2, misses: 18, total_time_ms: 0 },
      { ngram: 'tea', ngram_type: 'word1', hits: 20, misses: 0, total_time_ms: 0 },
    ]);
    const seq = generateDrillSequence({
      allowed,
      userIndex,
      length: 80,
      // Disable bigram-driven content so we know weak words are doing the work.
      numBigrams: 0,
      numWeakWords: 3,
    });
    expect(seq.split(' ')).toContain('tan');
  });

  it('output length is in the expected ballpark', () => {
    const seq = generateDrillSequence({
      allowed,
      userIndex: indexNgramStats([]),
      length: 50,
    });
    // We allow truncation at the previous word boundary, so length is bounded
    // [length/2, length + maxSegmentLen]. In practice 25-80 is generous.
    expect(seq.length).toBeGreaterThanOrEqual(25);
    expect(seq.length).toBeLessThan(120);
  });

  it('is deterministic with a seeded RNG', () => {
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const a = generateDrillSequence({
      allowed,
      userIndex: indexNgramStats([]),
      length: 50,
      rng: seedRng(42),
    });
    const b = generateDrillSequence({
      allowed,
      userIndex: indexNgramStats([]),
      length: 50,
      rng: seedRng(42),
    });
    expect(a).toEqual(b);
  });
});
