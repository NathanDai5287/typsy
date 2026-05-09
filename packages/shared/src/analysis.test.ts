import { describe, it, expect } from 'vitest';
import {
  buildFingerMap,
  perFingerStats,
  sfbRate,
  buildErrorHeatmap,
  findSlowWordsWithBigram,
  topWeakNgrams,
  topSlowNgrams,
  totalCharsTyped,
  dayStreak,
  sessionsAsSeries,
  sessionsAsSmoothedSeries,
} from './analysis.js';
import type { NgramStat, Session, KeyPosition } from './types.js';
import { LAYOUT_DEFINITIONS, posKey } from './layouts.js';

function loadPositions(name: string): KeyPosition[] {
  const def = LAYOUT_DEFINITIONS.find((d) => d.name === name)!;
  return JSON.parse(def.key_positions_json);
}

const colemak = loadPositions('Colemak');

function row(
  ngram: string,
  type: NgramStat['ngram_type'],
  hits: number,
  misses: number,
  totalTimeMs = 0,
): NgramStat {
  return {
    user_id: 1,
    layout_id: 1,
    ngram,
    ngram_type: type,
    hits,
    misses,
    total_time_ms: totalTimeMs,
    last_seen_at: '2024-01-01',
  };
}

describe('buildFingerMap', () => {
  it('uses the layout default when no override is given', () => {
    const map = buildFingerMap(colemak);
    expect(map.get('a')).toBe('left_pinky');
  });

  it('respects position-keyed overrides', () => {
    // Colemak puts 'a' at home-row col 0 (row=1, col=0). The user-level
    // fingering map is keyed by physical position, so this reassigns
    // whatever character lives at row 1 / col 0 — even if the user
    // switches layouts.
    const aPos = colemak.find((p) => p.char === 'a')!;
    const map = buildFingerMap(colemak, { [posKey(aPos)]: 'right_pinky' });
    expect(map.get('a')).toBe('right_pinky');
    expect(map.get('s')).toBe('left_middle'); // Colemak col 2 → unchanged
  });
});

describe('perFingerStats', () => {
  it('aggregates hits/misses by finger', () => {
    const fingerMap = buildFingerMap(colemak);
    const stats = [
      row('a', 'char1', 50, 10, 50 * 200), // left_pinky
      row('r', 'char1', 100, 0, 100 * 100), // left_ring
    ];
    const agg = perFingerStats(stats, fingerMap);
    const pinky = agg.find((a) => a.finger === 'left_pinky')!;
    const ring = agg.find((a) => a.finger === 'left_ring')!;
    expect(pinky.hits).toBe(50);
    expect(pinky.misses).toBe(10);
    expect(ring.wpm).toBeCloseTo(120, 1); // 100ms/char → 600cpm → 120 WPM
  });

  it('always returns 10 fingers', () => {
    const fingerMap = buildFingerMap(colemak);
    const agg = perFingerStats([], fingerMap);
    expect(agg).toHaveLength(10);
  });
});

describe('sfbRate', () => {
  it('returns the fraction of attempts that were same-finger bigrams', () => {
    const fingerMap = buildFingerMap(colemak);
    // Colemak: 't' (col 3) and 'd' (col 4) are both left_index → 'td' is SFB
    // Colemak: 't' (left_index) and 'h' (right_index) → 'th' is NOT SFB
    const stats = [
      row('td', 'char2', 5, 5),  // SFB: 10 attempts
      row('th', 'char2', 80, 0), // not SFB: 80 attempts
    ];
    expect(sfbRate(stats, fingerMap)).toBeCloseTo(10 / 90, 4);
  });

  it('returns 0 when no bigrams', () => {
    expect(sfbRate([], buildFingerMap(colemak))).toBe(0);
  });

  it('ignores doubled letters (aa, ss) which are SFB only in a degenerate sense', () => {
    const fingerMap = buildFingerMap(colemak);
    // 'aa' has same char on same finger but is treated as not-SFB (a true repeat).
    expect(sfbRate([row('aa', 'char2', 10, 0)], fingerMap)).toBe(0);
  });
});

describe('buildErrorHeatmap', () => {
  it('returns smoothed error rate per char1', () => {
    const stats = [row('t', 'char1', 90, 10), row('a', 'char1', 95, 5)];
    const heat = buildErrorHeatmap(stats);
    // (10+1)/(100+10) = 0.1
    expect(heat.get('t')).toBeCloseTo(0.1, 4);
    // (5+1)/(100+10) = 0.0545
    expect(heat.get('a')).toBeCloseTo(6 / 110, 4);
  });
});

describe('topWeakNgrams', () => {
  it('ranks by smoothed error rate descending', () => {
    const stats = [
      row('th', 'char2', 90, 10), // 11/110 = 0.1
      row('he', 'char2', 50, 50), // 51/110 = 0.464
      row('an', 'char2', 95, 5),  // 6/110 = 0.054
    ];
    const top = topWeakNgrams(stats, 'char2', 3);
    expect(top.map((t) => t.ngram)).toEqual(['he', 'th', 'an']);
  });

  it('skips low-attempt ngrams', () => {
    const stats = [
      row('he', 'char2', 0, 1, 0), // only 1 attempt → skipped (default minAttempts=5)
      row('th', 'char2', 90, 10),
    ];
    const top = topWeakNgrams(stats, 'char2', 5);
    expect(top.map((t) => t.ngram)).toEqual(['th']);
  });

  it('skips ngrams with zero actual misses (default minMisses=1)', () => {
    // Without the minMisses filter, the Bayesian prior would still rank these
    // — a clean session would surface "weak" bigrams the user has never failed.
    const stats = [
      row('th', 'char2', 50, 0),  // 50 hits, 0 misses → smoothed prior ≈ 1.6%
      row('he', 'char2', 100, 0), // 100 hits, 0 misses → smoothed prior ≈ 0.9%
      row('an', 'char2', 20, 2),  // real miss data
    ];
    const top = topWeakNgrams(stats, 'char2', 5);
    expect(top.map((t) => t.ngram)).toEqual(['an']);
  });

  it('honors a higher minMisses threshold', () => {
    const stats = [
      row('th', 'char2', 50, 1),
      row('he', 'char2', 100, 5),
    ];
    const top = topWeakNgrams(stats, 'char2', 5, 5, 5);
    expect(top.map((t) => t.ngram)).toEqual(['he']);
  });
});

describe('topSlowNgrams', () => {
  it('ranks by mean keypress time descending', () => {
    const stats = [
      row('th', 'char2', 100, 0, 100 * 100), // 100ms/hit  → 120 WPM
      row('he', 'char2', 50, 0, 50 * 300),   // 300ms/hit  → 40 WPM (slowest)
      row('an', 'char2', 80, 0, 80 * 150),   // 150ms/hit  → 80 WPM
    ];
    const slow = topSlowNgrams(stats, 'char2', 3);
    expect(slow.map((s) => s.ngram)).toEqual(['he', 'an', 'th']);
    expect(slow[0].meanMs).toBeCloseTo(300, 5);
    expect(slow[0].wpm).toBeCloseTo(40, 1);
    expect(slow[2].wpm).toBeCloseTo(120, 1);
  });

  it('skips ngrams below minAttempts and rows with no hits', () => {
    const stats = [
      row('xy', 'char2', 1, 0, 9999), // 1 attempt → skipped (default minAttempts=5)
      row('zz', 'char2', 0, 20, 5000), // 0 hits → skipped (can't compute mean)
      row('th', 'char2', 50, 0, 50 * 200),
    ];
    const slow = topSlowNgrams(stats, 'char2', 5);
    expect(slow.map((s) => s.ngram)).toEqual(['th']);
  });

  it('ignores other ngram types', () => {
    const stats = [
      row('the', 'char3', 100, 0, 100 * 500), // very slow trigram, but wrong type
      row('th', 'char2', 100, 0, 100 * 100),
    ];
    const slow = topSlowNgrams(stats, 'char2', 5);
    expect(slow.map((s) => s.ngram)).toEqual(['th']);
  });

  it('limits result to topK', () => {
    const stats = [
      row('aa', 'char2', 10, 0, 10 * 100),
      row('bb', 'char2', 10, 0, 10 * 200),
      row('cc', 'char2', 10, 0, 10 * 300),
      row('dd', 'char2', 10, 0, 10 * 400),
    ];
    const slow = topSlowNgrams(stats, 'char2', 2);
    expect(slow.map((s) => s.ngram)).toEqual(['dd', 'cc']);
  });
});

describe('totalCharsTyped', () => {
  it('sums chars_typed across sessions', () => {
    const sessions: Session[] = [
      sess({ chars_typed: 100 }),
      sess({ chars_typed: 250 }),
    ];
    expect(totalCharsTyped(sessions)).toBe(350);
  });
});

describe('dayStreak', () => {
  it('counts consecutive days back from `now`', () => {
    const now = new Date('2024-01-10T20:00:00');
    const sessions: Session[] = [
      sess({ ended_at: '2024-01-10T18:00:00' }),
      sess({ ended_at: '2024-01-09T20:00:00' }),
      sess({ ended_at: '2024-01-08T08:00:00' }),
      // gap on the 7th
      sess({ ended_at: '2024-01-06T12:00:00' }),
    ];
    expect(dayStreak(sessions, now)).toBe(3);
  });

  it('returns 0 if no session today/yesterday', () => {
    const now = new Date('2024-01-10T20:00:00');
    expect(dayStreak([sess({ ended_at: '2024-01-08T20:00:00' })], now)).toBe(0);
  });
});

describe('sessionsAsSeries', () => {
  it('returns sessions in chronological order with chart fields', () => {
    const sessions: Session[] = [
      sess({ ended_at: '2024-01-10', wpm: 60, accuracy: 0.95, chars_typed: 200, cumulative_chars_at_session_end: 200 }),
      sess({ ended_at: '2024-01-08', wpm: 50, accuracy: 0.92, chars_typed: 100, cumulative_chars_at_session_end: 100 }),
    ];
    const series = sessionsAsSeries(sessions);
    expect(series[0].endedAt).toEqual('2024-01-08');
    expect(series[1].endedAt).toEqual('2024-01-10');
    expect(series[1].cumulativeChars).toBe(200);
    expect(series[1].charsTyped).toBe(200);
  });
});

describe('sessionsAsSmoothedSeries', () => {
  it('downweights tiny sessions when smoothing', () => {
    const sessions: Session[] = [
      sess({ ended_at: '2024-01-08', wpm: 100, accuracy: 1, chars_typed: 1000, cumulative_chars_at_session_end: 1000 }),
      sess({ ended_at: '2024-01-10', wpm: 0, accuracy: 0, chars_typed: 1, cumulative_chars_at_session_end: 1001 }),
    ];

    const series = sessionsAsSmoothedSeries(sessions, { window: 2 });
    expect(series[1].wpm).toBeGreaterThan(99);
    expect(series[1].accuracy).toBeGreaterThan(0.99);
  });
});

describe('findSlowWordsWithBigram', () => {
  // Word time is reconstructed as char1[first] + Σ char2[transitions].
  // Helper: register the per-char/per-bigram means as ngram_stats rows so the
  // function can read them. mean = total_time_ms / hits, so we set hits=1 and
  // total_time_ms = the desired mean directly.
  const charRow = (ng: string, type: 'char1' | 'char2', meanMs: number): NgramStat =>
    row(ng, type, 1, 0, meanMs);

  it('reconstructs word time from char-level data and ranks slowest first', () => {
    const rows: NgramStat[] = [
      // word1 entries (only existence + .ngram matter; total_time_ms is unused)
      row('cat', 'word1', 5, 0, 0),
      row('cab', 'word1', 5, 0, 0),
      row('hi',  'word1', 5, 0, 0),  // doesn't contain "ca" → skipped

      // char1 firsts
      charRow('c', 'char1', 100),
      charRow('h', 'char1', 100),

      // char2 transitions for "cat": ca + at
      charRow('ca', 'char2', 100), // cat = 100 + 100 + 100 = 300
      charRow('at', 'char2', 100),

      // char2 for "cab": ca + ab — make ab really slow so cab > cat
      charRow('ab', 'char2', 500), // cab = 100 + 100 + 500 = 700

      // char2 for "hi"
      charRow('hi', 'char2', 100),
    ];
    const out = findSlowWordsWithBigram(rows, 'ca', 5);
    expect(out.map((r) => r.word)).toEqual(['cab', 'cat']);
    expect(out[0].meanMs).toBe(700);
    expect(out[1].meanMs).toBe(300);
    // wpm = 12000 * length / total_ms
    expect(out[0].wpm).toBeCloseTo((12_000 * 3) / 700, 5);
  });

  it('skips words missing any required char1 or char2 mean', () => {
    const rows: NgramStat[] = [
      row('cab', 'word1', 5, 0, 0),
      // No char1:c → skip
      charRow('ca', 'char2', 100),
      charRow('ab', 'char2', 100),
    ];
    expect(findSlowWordsWithBigram(rows, 'ca')).toEqual([]);
  });

  it('respects minAttempts', () => {
    const rows: NgramStat[] = [
      row('cat', 'word1', 0, 0, 0), // 0 attempts → skip even at minAttempts=1
      charRow('c', 'char1', 100),
      charRow('ca', 'char2', 100),
      charRow('at', 'char2', 100),
    ];
    expect(findSlowWordsWithBigram(rows, 'ca')).toEqual([]);
  });
});

function sess(overrides: Partial<Session> = {}): Session {
  return {
    id: 0,
    user_id: 1,
    layout_id: 1,
    started_at: '2024-01-01',
    ended_at: '2024-01-01',
    mode: 'flow',
    wpm: 0,
    accuracy: 1,
    chars_typed: 0,
    errors: 0,
    cumulative_chars_at_session_end: 0,
    ...overrides,
  };
}
