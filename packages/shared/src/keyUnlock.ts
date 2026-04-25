import {
  UNLOCK_WPM,
  UNLOCK_ACCURACY,
  REVIEW_THRESHOLD,
  CHARS_PER_WORD,
} from './constants.js';
import { smoothedAccuracy } from './bayesian.js';
import type { NgramIndex } from './ngramStats.js';

/** Per-key roll-up used to decide unlock/review status. */
export interface KeyHealth {
  char: string;
  hits: number;
  misses: number;
  totalTimeMs: number;
  /** WPM derived from mean keypress time: 60_000 / (mean_ms * CHARS_PER_WORD). */
  wpm: number;
  /** Bayesian-smoothed accuracy. */
  accuracy: number;
}

/**
 * Compute a health snapshot for each unlocked key from the ngram index.
 * Uses char1 stats as the canonical signal.
 */
export function computeKeyHealth(
  index: NgramIndex,
  unlocked: readonly string[],
): KeyHealth[] {
  return unlocked.map((char) => {
    const row = index.get(`char1:${char}`);
    const hits = row?.hits ?? 0;
    const misses = row?.misses ?? 0;
    const totalTimeMs = row?.total_time_ms ?? 0;
    const meanMs = hits > 0 ? totalTimeMs / hits : 0;
    const wpm = meanMs > 0 ? 60_000 / (meanMs * CHARS_PER_WORD) : 0;
    const accuracy = smoothedAccuracy(hits, misses);
    return { char, hits, misses, totalTimeMs, wpm, accuracy };
  });
}

/**
 * Returns the next character to unlock from the layout, or null if the user
 * isn't ready or the layout is fully unlocked.
 *
 * Ready criteria (spec §6.4): every active key has WPM ≥ UNLOCK_WPM AND
 * smoothed accuracy ≥ UNLOCK_ACCURACY.
 *
 * Next-key choice: the next un-unlocked character on the home row first,
 * then top-row, then bottom-row, scanning columns from inside out
 * (3,4,2,5,1,6,0,7,8,9 — index fingers first for fastest skill transfer).
 */
export function shouldUnlockNextKey(
  health: readonly KeyHealth[],
  unlocked: readonly string[],
  layoutChars: readonly { char: string; row: number; col: number }[],
): string | null {
  if (health.length === 0) return null;

  // Need a meaningful sample of attempts before we trust the metrics.
  const minHits = 20;
  const everyReady = health.every(
    (h) => h.hits >= minHits && h.wpm >= UNLOCK_WPM && h.accuracy >= UNLOCK_ACCURACY,
  );
  if (!everyReady) return null;

  return pickNextKey(unlocked, layoutChars);
}

/**
 * Returns chars currently unlocked but recently performing below
 * REVIEW_THRESHOLD accuracy — these should be resurfaced via drills.
 */
export function keysNeedingReview(health: readonly KeyHealth[]): string[] {
  return health
    .filter((h) => h.hits + h.misses >= 10 && h.accuracy < REVIEW_THRESHOLD)
    .map((h) => h.char);
}

// ─── Internal helpers ──────────────────────────────────────────────────────

const COL_PRIORITY = [3, 4, 2, 5, 1, 6, 0, 7, 8, 9];
const ROW_PRIORITY = [1, 0, 2]; // home → top → bottom

function pickNextKey(
  unlocked: readonly string[],
  layoutChars: readonly { char: string; row: number; col: number }[],
): string | null {
  const have = new Set(unlocked);
  for (const row of ROW_PRIORITY) {
    for (const col of COL_PRIORITY) {
      const key = layoutChars.find(
        (k) => k.row === row && k.col === col && /^[a-z]$/.test(k.char) && !have.has(k.char),
      );
      if (key) return key.char;
    }
  }
  return null;
}
