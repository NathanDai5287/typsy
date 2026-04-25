import { describe, it, expect } from 'vitest';
import {
  buildFingerMap,
  perFingerStats,
  sfbRate,
  buildErrorHeatmap,
  topWeakNgrams,
  totalCharsTyped,
  dayStreak,
  sessionsAsSeries,
} from './analysis.js';
import type { NgramStat, Session, KeyPosition } from './types.js';
import { LAYOUT_DEFINITIONS } from './layouts.js';

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

  it('respects override entries', () => {
    const map = buildFingerMap(colemak, { a: 'right_pinky' });
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
      sess({ ended_at: '2024-01-10', wpm: 60, accuracy: 0.95, cumulative_chars_at_session_end: 200 }),
      sess({ ended_at: '2024-01-08', wpm: 50, accuracy: 0.92, cumulative_chars_at_session_end: 100 }),
    ];
    const series = sessionsAsSeries(sessions);
    expect(series[0].endedAt).toEqual('2024-01-08');
    expect(series[1].endedAt).toEqual('2024-01-10');
    expect(series[1].cumulativeChars).toBe(200);
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
