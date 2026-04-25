import { describe, it, expect } from 'vitest';
import { generateFlowLine } from './flow.js';
import { indexNgramStats } from './ngramStats.js';

describe('generateFlowLine', () => {
  it('emits the requested number of words', () => {
    const allowed = new Set(['a', 'e', 'n', 't', 'o', 'h', 'i', 's', 'r', 'l']);
    const line = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 10,
    });
    const words = line.split(' ');
    expect(words).toHaveLength(10);
  });

  it('only emits words composed of allowed chars', () => {
    const allowed = new Set(['a', 'e', 't', 'n']);
    const line = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 5,
    });
    const words = line.split(' ');
    for (const word of words) {
      for (const c of word) {
        expect(allowed.has(c)).toBe(true);
      }
    }
  });

  it('returns empty string when no words match the allowed set', () => {
    const allowed = new Set<string>(); // nothing allowed
    const line = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 5,
    });
    expect(line).toEqual('');
  });

  it('is deterministic with a seeded RNG', () => {
    const allowed = new Set(['a', 'e', 'n', 't', 'o', 'h']);
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const a = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 8,
      rng: seedRng(123),
    });
    const b = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 8,
      rng: seedRng(123),
    });
    expect(a).toEqual(b);
  });

  it('biases sampling toward words containing a painful frequent bigram', () => {
    // Full alphabet so the candidate pool is the entire word list.
    const allowed = new Set('abcdefghijklmnopqrstuvwxyz'.split(''));
    // Pin "er" to a near-certain error rate; everything else uses the prior.
    const userIndex = indexNgramStats([
      { ngram: 'er', ngram_type: 'char2', hits: 0, misses: 1000, total_time_ms: 0 },
    ]);
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const baseline = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 50,
      rng: seedRng(7),
    }).split(' ');
    const biased = generateFlowLine({
      allowed,
      userIndex,
      numWords: 50,
      rng: seedRng(7),
    }).split(' ');

    const baselineEr = baseline.filter((w) => w.includes('er')).length;
    const biasedEr = biased.filter((w) => w.includes('er')).length;

    // The painful-bigram condition should yield substantially more "er" words
    // than the no-data baseline, AND a clear majority of the line.
    expect(biasedEr).toBeGreaterThan(baselineEr);
    expect(biasedEr).toBeGreaterThan(biased.length / 2);
  });

  it('biases sampling toward words the user has personally missed (word1)', () => {
    const allowed = new Set('abcdefghijklmnopqrstuvwxyz'.split(''));
    // Mark a few specific words as heavily missed at the word1 level. Bigrams
    // are left untouched, so the only signal is per-word.
    const missedWords = ['through', 'because', 'although'];
    const userIndex = indexNgramStats(
      missedWords.map((w) => ({
        ngram: w,
        ngram_type: 'word1' as const,
        hits: 0,
        misses: 200,
        total_time_ms: 0,
      })),
    );
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const baseline = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 100,
      rng: seedRng(11),
    }).split(' ');
    const biased = generateFlowLine({
      allowed,
      userIndex,
      numWords: 100,
      rng: seedRng(11),
    }).split(' ');

    const missed = new Set(missedWords);
    const baselineHits = baseline.filter((w) => missed.has(w)).length;
    const biasedHits = biased.filter((w) => missed.has(w)).length;

    // Personally-missed words should appear noticeably more often than they
    // do without any per-word data.
    expect(biasedHits).toBeGreaterThan(baselineHits);
    expect(biasedHits).toBeGreaterThan(0);
  });

  it('produces varied word lengths (length-stratified sampling)', () => {
    // Cold start, full alphabet — output should span multiple lengths
    // rather than collapsing to whatever length wins the global score.
    const allowed = new Set('abcdefghijklmnopqrstuvwxyz'.split(''));
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const line = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 30,
      rng: seedRng(42),
    });
    const lengths = new Set(line.split(' ').map((w) => w.length));
    // We bucket lengths in [4..12]; expect output to use at least 5 of those.
    expect(lengths.size).toBeGreaterThanOrEqual(5);
  });

  it('does not concentrate cold-start emissions on the Colemak home row', () => {
    // Regression: the previous implementation multiplied per-bigram
    // weakness by English-corpus bigram frequency, which favored common
    // bigrams like "th/he/in/er/an" — all of whose chars sit on the
    // Colemak home row — so cold-start flow output was ~95%+ home-row
    // chars on Colemak. With corpus frequency removed, cold-start is
    // length-stratified and uses a much wider char distribution.
    const allowed = new Set('abcdefghijklmnopqrstuvwxyz'.split(''));
    const colemakHome = new Set(['a', 'r', 's', 't', 'd', 'h', 'n', 'e', 'i', 'o']);
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const line = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 50,
      rng: seedRng(99),
    });
    let homeRowChars = 0;
    let totalChars = 0;
    for (const w of line.split(' ')) {
      for (const c of w) {
        totalChars++;
        if (colemakHome.has(c)) homeRowChars++;
      }
    }
    // English itself has ~70% of letters in the Colemak home row, so we
    // can never expect << 70% — this guards against the old behavior of
    // 90%+ where the output was nothing but "the/and/her/are/there/them".
    expect(homeRowChars / totalChars).toBeLessThan(0.8);
  });

  it('cycles through bucket variety rather than spamming the top scorer', () => {
    // Restricted allowed set so only a handful of words match. The
    // per-call emit-count decay should prevent any single word from
    // dominating the output.
    const allowed = new Set(['a', 'r', 's', 't', 'd', 'h', 'n', 'e', 'i', 'o']);
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const line = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 40,
      rng: seedRng(13),
    });
    const words = line.split(' ');
    const counts = new Map<string, number>();
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
    const maxCount = Math.max(...counts.values());
    // No single word should be more than ~25% of the output.
    expect(maxCount).toBeLessThanOrEqual(Math.ceil(words.length * 0.25));
  });
});
