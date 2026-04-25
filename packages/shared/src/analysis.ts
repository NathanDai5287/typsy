import type { FingerLabel, KeyPosition, Session, NgramStat } from './types.js';
import { CHARS_PER_WORD } from './constants.js';
import { smoothedAccuracy, smoothedErrorRate } from './bayesian.js';

// ─── Per-finger aggregation ────────────────────────────────────────────────

export interface PerFingerStats {
  finger: FingerLabel;
  hits: number;
  misses: number;
  totalTimeMs: number;
  /** WPM derived from mean keypress time across all char1 hits on this finger. */
  wpm: number;
  /** Bayesian-smoothed accuracy. */
  accuracy: number;
}

const FINGER_ORDER: FingerLabel[] = [
  'left_pinky', 'left_ring', 'left_middle', 'left_index',
  'left_thumb', 'right_thumb',
  'right_index', 'right_middle', 'right_ring', 'right_pinky',
];

/**
 * Build a `char → finger` lookup. Prefers an explicit `fingeringOverride`
 * (i.e. the user's onboarding map) and falls back to the layout's default
 * column-based finger assignment.
 */
export function buildFingerMap(
  positions: readonly KeyPosition[],
  fingeringOverride?: Record<string, FingerLabel>,
): Map<string, FingerLabel> {
  const map = new Map<string, FingerLabel>();
  for (const pos of positions) {
    map.set(pos.char, fingeringOverride?.[pos.char] ?? pos.finger);
  }
  return map;
}

/** Aggregate char1 stats by finger. Always returns all 10 fingers (some may be empty). */
export function perFingerStats(
  ngramRows: readonly NgramStat[],
  fingerMap: ReadonlyMap<string, FingerLabel>,
): PerFingerStats[] {
  const init = (): Omit<PerFingerStats, 'finger' | 'wpm' | 'accuracy'> => ({
    hits: 0,
    misses: 0,
    totalTimeMs: 0,
  });
  const buckets = new Map<FingerLabel, ReturnType<typeof init>>();
  for (const f of FINGER_ORDER) buckets.set(f, init());

  for (const row of ngramRows) {
    if (row.ngram_type !== 'char1') continue;
    const finger = fingerMap.get(row.ngram);
    if (!finger) continue;
    const b = buckets.get(finger)!;
    b.hits += row.hits;
    b.misses += row.misses;
    b.totalTimeMs += row.total_time_ms;
  }

  return FINGER_ORDER.map((finger) => {
    const b = buckets.get(finger)!;
    const meanMs = b.hits > 0 ? b.totalTimeMs / b.hits : 0;
    const wpm = meanMs > 0 ? 60_000 / (meanMs * CHARS_PER_WORD) : 0;
    const accuracy = smoothedAccuracy(b.hits, b.misses);
    return { finger, ...b, wpm, accuracy };
  });
}

// ─── SFB rate ──────────────────────────────────────────────────────────────

/**
 * Same-finger bigram rate: of all char2 attempts the user made, what fraction
 * crossed two consecutive same-finger keypresses? Lower is better.
 *
 * Returns 0 when no bigram data exists.
 */
export function sfbRate(
  ngramRows: readonly NgramStat[],
  fingerMap: ReadonlyMap<string, FingerLabel>,
): number {
  let sfbAttempts = 0;
  let totalAttempts = 0;
  for (const row of ngramRows) {
    if (row.ngram_type !== 'char2') continue;
    if (row.ngram.length !== 2) continue;
    const a = fingerMap.get(row.ngram[0]);
    const b = fingerMap.get(row.ngram[1]);
    if (!a || !b) continue;
    const attempts = row.hits + row.misses;
    totalAttempts += attempts;
    if (a === b && row.ngram[0] !== row.ngram[1]) sfbAttempts += attempts;
  }
  return totalAttempts > 0 ? sfbAttempts / totalAttempts : 0;
}

// ─── Heatmap ────────────────────────────────────────────────────────────────

/**
 * Char → smoothed error rate for char1 stats only. Useful for overlaying a
 * heatmap on the layout visual.
 */
export function buildErrorHeatmap(ngramRows: readonly NgramStat[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of ngramRows) {
    if (row.ngram_type !== 'char1') continue;
    map.set(row.ngram, smoothedErrorRate(row.hits, row.misses));
  }
  return map;
}

// ─── Top weak ngrams ───────────────────────────────────────────────────────

export interface WeakNgram {
  ngram: string;
  type: NgramStat['ngram_type'];
  hits: number;
  misses: number;
  errorRate: number;
}

/**
 * Top-K weakest ngrams of a given type, ranked by smoothed error rate.
 * Skips ngrams below `minAttempts` to avoid noise.
 */
export function topWeakNgrams(
  ngramRows: readonly NgramStat[],
  type: NgramStat['ngram_type'],
  topK = 10,
  minAttempts = 5,
): WeakNgram[] {
  const out: WeakNgram[] = [];
  for (const row of ngramRows) {
    if (row.ngram_type !== type) continue;
    if (row.hits + row.misses < minAttempts) continue;
    out.push({
      ngram: row.ngram,
      type: row.ngram_type,
      hits: row.hits,
      misses: row.misses,
      errorRate: smoothedErrorRate(row.hits, row.misses),
    });
  }
  out.sort((a, b) => b.errorRate - a.errorRate);
  return out.slice(0, topK);
}

// ─── Sessions: streak / totals ─────────────────────────────────────────────

/** Total characters typed across all sessions for the layout. */
export function totalCharsTyped(sessions: readonly Session[]): number {
  return sessions.reduce((s, x) => s + x.chars_typed, 0);
}

/**
 * Consecutive-day practice streak ending today. A session counts for a day
 * based on its `ended_at` (in the user's local timezone — we pass in `now`
 * to keep it pure/testable).
 */
export function dayStreak(sessions: readonly Session[], now: Date = new Date()): number {
  if (sessions.length === 0) return 0;
  const days = new Set<string>();
  for (const s of sessions) {
    days.add(toLocalDayKey(new Date(s.ended_at)));
  }
  let streak = 0;
  const cursor = new Date(now);
  while (days.has(toLocalDayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function toLocalDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── Session series for charts ─────────────────────────────────────────────

export interface SessionPoint {
  /** ISO timestamp of session end. */
  endedAt: string;
  /** Cumulative characters at session end (from the row). */
  cumulativeChars: number;
  wpm: number;
  accuracy: number;
}

/** Convert sessions to chart-friendly rows in chronological order. */
export function sessionsAsSeries(sessions: readonly Session[]): SessionPoint[] {
  return sessions
    .slice()
    .sort((a, b) => Date.parse(a.ended_at) - Date.parse(b.ended_at))
    .map((s) => ({
      endedAt: s.ended_at,
      cumulativeChars: s.cumulative_chars_at_session_end,
      wpm: s.wpm,
      accuracy: s.accuracy,
    }));
}
