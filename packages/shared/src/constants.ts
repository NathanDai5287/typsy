import type { FingerLabel } from './types.js';

export const UNLOCK_WPM = 30;
export const UNLOCK_ACCURACY = 0.95;
export const REVIEW_THRESHOLD = 0.85;
export const BAYESIAN_ALPHA = 1;
export const BAYESIAN_BETA = 9;
export const MIN_NGRAM_SAMPLES = 10;
export const INITIAL_SUBSET_SIZE = 4;
export const OPTIMIZER_MIN_CHARS = 50_000;
export const WRITE_FLUSH_INTERVAL_MS = 30_000;
export const CHARS_PER_WORD = 5;

/** Maps column index (0–9) to the default finger for that column. */
export const COL_TO_FINGER: Record<number, FingerLabel> = {
  0: 'left_pinky',
  1: 'left_ring',
  2: 'left_middle',
  3: 'left_index',
  4: 'left_index',
  5: 'right_index',
  6: 'right_index',
  7: 'right_middle',
  8: 'right_ring',
  9: 'right_pinky',
};
