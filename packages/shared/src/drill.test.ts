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

  it('cold-start drills vary content across consecutive calls', () => {
    // Regression: with no user data, weakness scores collapse to
    // (Bayesian prior × English-corpus frequency) for every bigram, so the
    // old "deterministic top-K" selector emitted the same three bigrams +
    // same three corpus words every call. The default selectionJitter
    // should now rotate the picks so the user doesn't see the same drill
    // back-to-back.
    const wide = new Set('abcdefghijklmnopqrstuvwxyz'.split(''));
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const seqs = new Set<string>();
    // Use a single rng across calls so each generateDrillSequence sees a
    // genuinely different stream of random numbers (the way it does in
    // production where Math.random keeps advancing between calls).
    const rng = seedRng(2024);
    for (let i = 0; i < 6; i++) {
      seqs.add(
        generateDrillSequence({
          allowed: wide,
          userIndex: indexNgramStats([]),
          length: 80,
          rng,
        }),
      );
    }
    // We're not asserting six unique drills (some shuffle-collisions are
    // fine), but at minimum it shouldn't be the SAME drill every time.
    expect(seqs.size).toBeGreaterThanOrEqual(4);
  });

  it('cold-start picks different weak bigrams across consecutive calls', () => {
    // With selectionJitter > 0, the top bigram of one drill is often not
    // the top bigram of the next when the underlying weakness scores are
    // close (the cold-start regime). We assert the union of bigrams seen
    // across many drills is wider than the deterministic top-3.
    const wide = new Set('abcdefghijklmnopqrstuvwxyz'.split(''));
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const rng = seedRng(99);
    const seenBigrams = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const seq = generateDrillSequence({
        allowed: wide,
        userIndex: indexNgramStats([]),
        length: 100,
        rng,
      });
      // Capture every bigram that appears as a doubled token (the burst).
      for (const tok of seq.split(' ')) {
        if (tok.length === 2) seenBigrams.add(tok);
      }
    }
    // Without jitter, only the deterministic top-3 (th/he/in) would ever
    // appear. With jitter, we expect at least 6 distinct bigrams to surface
    // across 12 drills.
    expect(seenBigrams.size).toBeGreaterThanOrEqual(6);
  });

  it('selectionJitter=0 produces deterministic top-K (no variety)', () => {
    // Disabling jitter recovers the old behavior — useful as a regression
    // canary so the refactor's default isn't accidentally re-baked in.
    const wide = new Set('abcdefghijklmnopqrstuvwxyz'.split(''));
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const seqs = new Set<string>();
    for (let i = 0; i < 5; i++) {
      seqs.add(
        generateDrillSequence({
          allowed: wide,
          userIndex: indexNgramStats([]),
          length: 80,
          selectionJitter: 0,
          // Same seed each call: no jitter ⇒ identical output.
          rng: seedRng(7),
        }),
      );
    }
    expect(seqs.size).toBe(1);
  });

  it('warm-start: a clear weakness still dominates despite jitter', () => {
    // Regression: jitter must not drown out a real signal. Pin "an" to a
    // ~96% smoothed error rate while every other bigram in the allowed
    // set uses the prior, then run many drills and assert "an" appears
    // in the strong majority of bursts.
    const userIndex = indexNgramStats([
      { ngram: 'an', ngram_type: 'char2', hits: 5, misses: 95, total_time_ms: 0 },
    ]);
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const rng = seedRng(31);
    let withAn = 0;
    const trials = 20;
    for (let i = 0; i < trials; i++) {
      const seq = generateDrillSequence({
        allowed,
        userIndex,
        length: 60,
        numBigrams: 1,
        wordsPerBigram: 0,
        numWeakWords: 0,
        burstReps: 4,
        rng,
      });
      // The lone burst should be "an an an an"; allow "an" to appear
      // anywhere as a token to be slightly more lenient.
      if (seq.split(' ').includes('an')) withAn++;
    }
    // With "an" ~17× the next-strongest weakness score, the default jitter
    // (±50%) cannot promote any other bigram above it. Every trial should
    // pick "an".
    expect(withAn).toBeGreaterThanOrEqual(trials - 1);
  });
});
