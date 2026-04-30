import type { FingerLabel, KeyPosition, Session, NgramStat } from './types.js';
import { CHARS_PER_WORD } from './constants.js';
import { smoothedAccuracy, smoothedErrorRate } from './bayesian.js';
import { posKey } from './layouts.js';

// ─── Ngram length validation ───────────────────────────────────────────────

/**
 * Get the expected length for a given ngram type.
 * Returns null for word types since they have variable lengths.
 */
function getExpectedNgramLength(type: NgramStat['ngram_type']): number | null {
  switch (type) {
    case 'char1':
      return 1;
    case 'char2':
      return 2;
    case 'char3':
      return 3;
    case 'word1':
    case 'word2':
      return null; // Variable length
  }
}

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
 * Build a `char → finger` lookup for the given layout. The user's fingering
 * is keyed by physical position (`"row,col"`), not by character — that's
 * what makes it layout-independent. Unmapped positions fall back to the
 * layout's column-based default (`KeyPosition.finger`).
 */
export function buildFingerMap(
  positions: readonly KeyPosition[],
  posFingerMap?: Record<string, FingerLabel>,
): Map<string, FingerLabel> {
  const map = new Map<string, FingerLabel>();
  for (const pos of positions) {
    map.set(pos.char, posFingerMap?.[posKey(pos)] ?? pos.finger);
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
    if (row.ngram.length !== 2) continue; // Validate length matches type
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

export interface KeyStat {
  wpm: number;
  accuracy: number;
}

/**
 * Char → { wpm, accuracy } for char1 stats only. Useful for showing per-key
 * WPM and accuracy on hover in the weakness heatmap.
 */
export function buildKeyStats(ngramRows: readonly NgramStat[]): Map<string, KeyStat> {
  const map = new Map<string, KeyStat>();
  for (const row of ngramRows) {
    if (row.ngram_type !== 'char1') continue;
    const meanMs = row.hits > 0 ? row.total_time_ms / row.hits : 0;
    const wpm = meanMs > 0 ? 60_000 / (meanMs * CHARS_PER_WORD) : 0;
    const accuracy = smoothedAccuracy(row.hits, row.misses);
    map.set(row.ngram, { wpm, accuracy });
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
  const expectedLength = getExpectedNgramLength(type);
  const out: WeakNgram[] = [];
  for (const row of ngramRows) {
    if (row.ngram_type !== type) continue;
    if (row.hits + row.misses < minAttempts) continue;
    if (expectedLength !== null && row.ngram.length !== expectedLength) continue;
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

// ─── Top slow ngrams ───────────────────────────────────────────────────────

export interface SlowNgram {
  ngram: string;
  type: NgramStat['ngram_type'];
  hits: number;
  misses: number;
  /** Mean keypress time across hits, in milliseconds. */
  meanMs: number;
  /** WPM derived from `meanMs` assuming 5 chars/word. */
  wpm: number;
}

/**
 * Top-K slowest ngrams of a given type, ranked by mean keypress time
 * (highest first). For a bigram "AB", `meanMs` is the time between the
 * A and B keystrokes; for a word, it's the mean inter-key time.
 *
 * Mean is computed as `total_time_ms / hits` to match `perFingerStats`,
 * so only successful trials contribute to the denominator. Rows with no
 * hits or fewer than `minAttempts` total attempts are skipped to avoid
 * noise from a handful of mistypes.
 */
export function topSlowNgrams(
  ngramRows: readonly NgramStat[],
  type: NgramStat['ngram_type'],
  topK = 10,
  minAttempts = 5,
): SlowNgram[] {
  const expectedLength = getExpectedNgramLength(type);
  const out: SlowNgram[] = [];
  for (const row of ngramRows) {
    if (row.ngram_type !== type) continue;
    if (row.hits + row.misses < minAttempts) continue;
    if (row.hits <= 0) continue;
    if (expectedLength !== null && row.ngram.length !== expectedLength) continue;
    const meanMs = row.total_time_ms / row.hits;
    if (meanMs <= 0) continue;
    out.push({
      ngram: row.ngram,
      type: row.ngram_type,
      hits: row.hits,
      misses: row.misses,
      meanMs,
      wpm: 60_000 / (meanMs * CHARS_PER_WORD),
    });
  }
  out.sort((a, b) => b.meanMs - a.meanMs);
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

// ─── Word context for ngrams ───────────────────────────────────────────────

/**
 * Find words that contain a given bigram and have been missed.
 * Returns up to `limit` words, sorted by miss count (highest first).
 */
export function findWordsWithBigram(
  ngramRows: readonly NgramStat[],
  bigram: string,
  limit = 5,
  minMisses = 1,
): Array<{ word: string; hits: number; misses: number; errorRate: number }> {
  const out: Array<{ word: string; hits: number; misses: number; errorRate: number }> = [];
  for (const row of ngramRows) {
    if (row.ngram_type !== 'word1') continue;
    if (row.misses < minMisses) continue;
    if (!row.ngram.includes(bigram)) continue;
    out.push({
      word: row.ngram,
      hits: row.hits,
      misses: row.misses,
      errorRate: smoothedErrorRate(row.hits, row.misses),
    });
  }
  out.sort((a, b) => b.misses - a.misses);
  return out.slice(0, limit);
}
