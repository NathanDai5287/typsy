import {
  buildMaskedTransitions,
  generateMarkovSequence,
  topWeakBigrams,
} from './markov.js';
import type { NgramIndex } from './ngramStats.js';

export interface DrillOptions {
  /** Set of allowed lowercase chars (the user's unlocked keys). */
  allowed: ReadonlySet<string>;
  /** Per-user ngram index for weakness biasing. */
  userIndex: NgramIndex;
  /** Target sequence length in characters (default 50, spec says 30–80). */
  length?: number;
  /** How aggressively to bias toward weak bigrams (default 5). */
  bias?: number;
  /** Random source (injectable for tests). */
  rng?: () => number;
}

/**
 * Generate a drill-mode practice sequence (spec §6.5).
 *
 *   1. Mask base char transitions to allowed letters and bias by user weakness.
 *   2. Sample a Markov chain to produce a 30–80 char sequence.
 *   3. Ensure the top-3 weakest bigrams appear at least once — splice them in
 *      if missing.
 */
export function generateDrillSequence({
  allowed,
  userIndex,
  length = 50,
  bias = 5,
  rng = Math.random,
}: DrillOptions): string {
  // Make sure space is in the allowed set so the chain can break into words.
  const allowedWithSpace = new Set(allowed);
  allowedWithSpace.add(' ');

  const masked = buildMaskedTransitions(allowedWithSpace, userIndex, bias);
  let seq = generateMarkovSequence(masked, length, rng);

  // Splice in any of the top-3 weak bigrams that are missing.
  const top3 = topWeakBigrams(userIndex, allowedWithSpace, 3);
  for (const bigram of top3) {
    if (!seq.includes(bigram)) {
      const insertAt = Math.floor(rng() * Math.max(1, seq.length));
      seq = seq.slice(0, insertAt) + bigram + seq.slice(insertAt);
    }
  }

  // Final cleanup: collapse spaces and trim.
  return seq.replace(/\s+/g, ' ').trim();
}
