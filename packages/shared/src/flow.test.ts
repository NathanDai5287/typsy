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
      numWords: 200,
      rng: seedRng(11),
    }).split(' ');
    const biased = generateFlowLine({
      allowed,
      userIndex,
      numWords: 200,
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

  it('biases sampling toward words containing a slow bigram (no errors)', () => {
    // "er" is error-free but takes 4× the user's baseline time. With
    // alpha=1 and maxSlowExcess=1 it carries the same per-bigram
    // weight as a 100% miss rate would — so words containing "er"
    // should appear noticeably more than at cold start.
    const allowed = new Set('abcdefghijklmnopqrstuvwxyz'.split(''));
    // Baseline data: a handful of bigrams typed at ~200ms each define
    // the user's baseline. "er" sits at 800ms (4× baseline).
    const userIndex = indexNgramStats([
      // 1000 hits at 200ms each → mean = 200ms
      { ngram: 'th', ngram_type: 'char2', hits: 1000, misses: 0, total_time_ms: 200_000 },
      { ngram: 'he', ngram_type: 'char2', hits: 1000, misses: 0, total_time_ms: 200_000 },
      { ngram: 'in', ngram_type: 'char2', hits: 1000, misses: 0, total_time_ms: 200_000 },
      { ngram: 'an', ngram_type: 'char2', hits: 1000, misses: 0, total_time_ms: 200_000 },
      { ngram: 're', ngram_type: 'char2', hits: 1000, misses: 0, total_time_ms: 200_000 },
      { ngram: 'on', ngram_type: 'char2', hits: 1000, misses: 0, total_time_ms: 200_000 },
      { ngram: 'at', ngram_type: 'char2', hits: 1000, misses: 0, total_time_ms: 200_000 },
      // "er" is the slow one: 800ms / hit
      { ngram: 'er', ngram_type: 'char2', hits: 1000, misses: 0, total_time_ms: 800_000 },
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

    // Slow-bigram condition should yield substantially more "er" words
    // than the no-data baseline.
    expect(biasedEr).toBeGreaterThan(baselineEr);
  });

  it('biases sampling toward words with a high trigram error rate', () => {
    // Pin "ing" to a near-certain error rate at the trigram level
    // WITHOUT inflating its constituent bigrams ("in", "ng") or chars.
    // Words containing "ing" should win via the trigram path alone.
    const allowed = new Set('abcdefghijklmnopqrstuvwxyz'.split(''));
    const userIndex = indexNgramStats([
      { ngram: 'ing', ngram_type: 'char3', hits: 0, misses: 1000, total_time_ms: 0 },
    ]);
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const baseline = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 80,
      rng: seedRng(31),
    }).split(' ');
    const biased = generateFlowLine({
      allowed,
      userIndex,
      numWords: 80,
      rng: seedRng(31),
    }).split(' ');

    const baselineIng = baseline.filter((w) => w.includes('ing')).length;
    const biasedIng = biased.filter((w) => w.includes('ing')).length;

    // Painful-trigram condition should yield more "ing" words than the
    // no-data baseline.
    expect(biasedIng).toBeGreaterThan(baselineIng);
  });

  it('cold-start (no timing data) still produces varied lengths', () => {
    // Regression: introducing timing-based scoring shouldn't disrupt
    // the cold-start "all words score equally" property. With no
    // bigram-timing data, baseline falls back to defaultBaselineMs
    // and every slow_excess is 0, so output should still span a wide
    // range of word lengths.
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
    expect(lengths.size).toBeGreaterThanOrEqual(5);
  });

  it('no per-bigram timing data => slowness contributes nothing', () => {
    // When all bigram error rates are equal AND no timing data exists,
    // sampling should be effectively uniform within each length bucket.
    // A single bigram with `time_total > 0` but below minSlowSamples
    // attempts must NOT skew the score.
    const allowed = new Set('abcdefghijklmnopqrstuvwxyz'.split(''));
    const userIndex = indexNgramStats([
      // Below minSlowSamples (default 10) → slowness ignored
      { ngram: 'er', ngram_type: 'char2', hits: 5, misses: 0, total_time_ms: 5_000 }, // would be 1000ms/hit
    ]);
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const a = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 50,
      rng: seedRng(101),
    });
    const b = generateFlowLine({
      allowed,
      userIndex,
      numWords: 50,
      rng: seedRng(101),
    });
    // The under-sampled "er" timing must NOT change the output: with
    // identical RNG seeds, the two outputs should be identical.
    expect(b).toEqual(a);
  });

  it('higher randomFraction reduces concentration on the weakest score', () => {
    // Pin "th" to extreme weakness so words containing it dominate the
    // scored stream. Random injection should pull the line back toward
    // the broader candidate distribution, so a 50% random line should
    // contain noticeably fewer "th" words than a 0% random one.
    const allowed = new Set('abcdefghijklmnopqrstuvwxyz'.split(''));
    const userIndex = indexNgramStats([
      { ngram: 'th', ngram_type: 'char2', hits: 0, misses: 1000, total_time_ms: 0 },
    ]);
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const greedy = generateFlowLine({
      allowed,
      userIndex,
      numWords: 100,
      randomFraction: 0,
      rng: seedRng(7),
    }).split(' ');
    const varied = generateFlowLine({
      allowed,
      userIndex,
      numWords: 100,
      randomFraction: 0.5,
      rng: seedRng(7),
    }).split(' ');

    const greedyTh = greedy.filter((w) => w.includes('th')).length;
    const variedTh = varied.filter((w) => w.includes('th')).length;
    expect(variedTh).toBeLessThan(greedyTh);
  });

  it('recent words are penalized across calls (cross-chunk memory)', () => {
    // Same allowed + index + seed: a second call that lists the first
    // call's emitted words as `recent` should differ from a second call
    // that doesn't, because every recent word starts at a one-step decay
    // disadvantage.
    const allowed = new Set('abcdefghijklmnopqrstuvwxyz'.split(''));
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const first = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 50,
      rng: seedRng(99),
    });
    const recent = new Set(first.split(' '));
    const followUpWithRecent = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 50,
      recent,
      rng: seedRng(99),
    });
    const followUpWithoutRecent = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 50,
      rng: seedRng(99),
    });
    expect(followUpWithRecent).not.toEqual(followUpWithoutRecent);
    // And the follow-up SHOULD overlap less with the first line when
    // recent is supplied.
    const overlapWith = followUpWithRecent
      .split(' ')
      .filter((w) => recent.has(w)).length;
    const overlapWithout = followUpWithoutRecent
      .split(' ')
      .filter((w) => recent.has(w)).length;
    expect(overlapWith).toBeLessThan(overlapWithout);
  });

  it('alpha=0 + delta=0 makes timing data invisible to scoring', () => {
    // Knob test: zeroing both slowness coefficients should make the
    // generator ignore timing data entirely. Two indexes identical in
    // error counts but wildly different in `total_time_ms` must
    // produce identical output once `alpha=0, delta=0`.
    const allowed = new Set('abcdefghijklmnopqrstuvwxyz'.split(''));
    const fast = indexNgramStats([
      { ngram: 'th', ngram_type: 'char2', hits: 1000, misses: 0, total_time_ms: 200_000 },
      { ngram: 'he', ngram_type: 'char2', hits: 1000, misses: 0, total_time_ms: 200_000 },
      { ngram: 'in', ngram_type: 'char2', hits: 1000, misses: 0, total_time_ms: 200_000 },
      { ngram: 'er', ngram_type: 'char2', hits: 1000, misses: 0, total_time_ms: 200_000 },
    ]);
    const slow = indexNgramStats([
      { ngram: 'th', ngram_type: 'char2', hits: 1000, misses: 0, total_time_ms: 200_000 },
      { ngram: 'he', ngram_type: 'char2', hits: 1000, misses: 0, total_time_ms: 200_000 },
      { ngram: 'in', ngram_type: 'char2', hits: 1000, misses: 0, total_time_ms: 200_000 },
      // "er" is wildly slow ONLY in the slow index
      { ngram: 'er', ngram_type: 'char2', hits: 1000, misses: 0, total_time_ms: 800_000 },
    ]);
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const off1 = generateFlowLine({
      allowed,
      userIndex: fast,
      numWords: 50,
      alpha: 0,
      delta: 0,
      rng: seedRng(7),
    });
    const off2 = generateFlowLine({
      allowed,
      userIndex: slow,
      numWords: 50,
      alpha: 0,
      delta: 0,
      rng: seedRng(7),
    });
    expect(off1).toEqual(off2);

    // Sanity: with the default coefficients ON, the same comparison
    // should produce DIFFERENT output (slowness is doing something).
    const on1 = generateFlowLine({
      allowed,
      userIndex: fast,
      numWords: 50,
      rng: seedRng(7),
    });
    const on2 = generateFlowLine({
      allowed,
      userIndex: slow,
      numWords: 50,
      rng: seedRng(7),
    });
    expect(on1).not.toEqual(on2);
  });
});
