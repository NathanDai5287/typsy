import type { FingerLabel, KeyPosition } from './types.js';
import { posKey } from './layouts.js';

/**
 * Per-bigram classification used by the cost function (spec §6.7).
 *
 * The total `score` is the sum of penalties (positive) and bonuses (negative);
 * higher means harder/more uncomfortable. `flags` retains the individual
 * components for debugging and UI explanations.
 */
export interface BigramDifficulty {
  score: number;
  flags: BigramFlag[];
}

export type BigramFlag =
  | 'sfb'
  | 'sf_repeat'         // same finger, same key — not as bad as a real SFB
  | 'lateral_stretch'
  | 'scissor'
  | 'long_jump'         // skip-row + skip-finger
  | 'alternation'       // bonus
  | 'inward_roll'       // bonus
  | 'outward_roll'      // weaker bonus / mild penalty depending on style
  | 'pinky_use'         // mild penalty
  | 'awkward';

const HOME_ROW = 1;

/** Side of the keyboard (left or right) for a finger. */
function side(f: FingerLabel): 'L' | 'R' | 'C' {
  if (f.startsWith('left_')) return 'L';
  if (f.startsWith('right_')) return 'R';
  return 'C';
}

/** Rank within hand: pinky=1, ring=2, middle=3, index=4 (thumb=5). Used for inward/outward roll detection. */
function fingerRank(f: FingerLabel): number {
  switch (f) {
    case 'left_pinky':
    case 'right_pinky':
      return 1;
    case 'left_ring':
    case 'right_ring':
      return 2;
    case 'left_middle':
    case 'right_middle':
      return 3;
    case 'left_index':
    case 'right_index':
      return 4;
    case 'left_thumb':
    case 'right_thumb':
      return 5;
  }
}

/** Default home column for each finger on a standard 10-column block. */
const FINGER_HOME_COL: Record<FingerLabel, number> = {
  left_pinky: 0,
  left_ring: 1,
  left_middle: 2,
  left_index: 3,
  left_thumb: 4,
  right_thumb: 5,
  right_index: 6,
  right_middle: 7,
  right_ring: 8,
  right_pinky: 9,
};

/**
 * Build a fast char → KeyPosition lookup with the per-key finger resolved.
 * The fingering map is keyed by physical position (`"row,col"`) — not by
 * character — so the same user-level map applies across every layout.
 * Falls back to the layout's column-based default for unmapped positions.
 * Pre-build once per layout for performance.
 */
export function buildLayoutIndex(
  positions: readonly KeyPosition[],
  posFingerMap?: Record<string, FingerLabel>,
): Map<string, KeyPosition & { finger: FingerLabel }> {
  const map = new Map<string, KeyPosition & { finger: FingerLabel }>();
  for (const p of positions) {
    const finger = posFingerMap?.[posKey(p)] ?? p.finger;
    map.set(p.char, { ...p, finger });
  }
  return map;
}

export type LayoutIndex = ReturnType<typeof buildLayoutIndex>;

/**
 * Difficulty for typing the bigram `a → b` on the given layout. Higher score
 * = more uncomfortable.
 *
 * Components:
 *   - SFB (different keys, same finger): big penalty
 *   - Same-finger same-key repeat (e.g. "tt"): small penalty (not really SFB)
 *   - Lateral stretch: finger pulled ≥2 columns from its home column
 *   - Scissor: adjacent fingers, vertical bend in opposite directions
 *   - Long jump: 2+ row + 2+ column gap on the same hand
 *   - Alternation (different hands): small bonus
 *   - Inward/outward roll: small bonus / mild penalty
 *   - Pinky use: mild penalty (especially on top/bottom rows)
 */
export function bigramDifficulty(
  index: LayoutIndex,
  bigram: string,
): BigramDifficulty {
  if (bigram.length !== 2 || bigram[0] === ' ' || bigram[1] === ' ') {
    return { score: 0, flags: [] };
  }
  const a = index.get(bigram[0]);
  const b = index.get(bigram[1]);
  if (!a || !b) return { score: 0, flags: [] };

  const flags: BigramFlag[] = [];
  let score = 0;

  const sameHand = side(a.finger) === side(b.finger) && side(a.finger) !== 'C';
  const sameFinger = a.finger === b.finger;
  const sameKey = a.row === b.row && a.col === b.col;

  // ─── SFB (worst single-bigram offender) ────────────────────────────────
  if (sameFinger && !sameKey) {
    // Magnitude scales mildly with row distance — same-finger jumps from
    // home to top row are less awkward than home → bottom.
    const rowDist = Math.abs(a.row - b.row);
    score += 0.7 + 0.15 * rowDist;
    flags.push('sfb');
  } else if (sameFinger && sameKey) {
    score += 0.05;
    flags.push('sf_repeat');
  }

  // ─── Cross-hand alternation (good) ─────────────────────────────────────
  if (!sameHand && side(a.finger) !== 'C' && side(b.finger) !== 'C') {
    score -= 0.05;
    flags.push('alternation');
  }

  // ─── Same hand interactions ────────────────────────────────────────────
  if (sameHand && !sameFinger) {
    const ra = fingerRank(a.finger);
    const rb = fingerRank(b.finger);
    const fingerGap = Math.abs(ra - rb);
    const colGap = Math.abs(a.col - b.col);
    const rowGap = Math.abs(a.row - b.row);

    // Roll: adjacent fingers, same row.
    if (fingerGap === 1 && rowGap === 0) {
      // Inward = pinky → index direction (rb > ra); outward = reverse.
      if (rb > ra) {
        score -= 0.05;
        flags.push('inward_roll');
      } else {
        score -= 0.02;
        flags.push('outward_roll');
      }
    }

    // Scissor: adjacent fingers + opposite vertical motion.
    // E.g. ring drops below home while middle reaches above. Awkward.
    if (fingerGap === 1 && rowGap >= 1) {
      const aOffset = a.row - HOME_ROW;
      const bOffset = b.row - HOME_ROW;
      if (aOffset !== 0 && bOffset !== 0 && Math.sign(aOffset) !== Math.sign(bOffset)) {
        score += 0.45;
        flags.push('scissor');
      }
    }

    // Long jump: skip-finger + skip-row.
    if (fingerGap >= 2 && rowGap >= 2) {
      score += 0.2 + 0.05 * (fingerGap - 2);
      flags.push('long_jump');
    }

    // Awkward column compression (e.g. index reaching across to col 4 then col 5 staying same hand).
    if (colGap >= 3 && fingerGap === 1) {
      score += 0.15;
      flags.push('awkward');
    }
  }

  // ─── Lateral stretch: a finger pulled ≥2 cols from its home column ─────
  for (const k of [a, b]) {
    const home = FINGER_HOME_COL[k.finger];
    if (Math.abs(k.col - home) >= 2) {
      score += 0.18;
      flags.push('lateral_stretch');
      break; // count once per bigram
    }
  }

  // ─── Pinky use (mild penalty, scaled by row distance from home) ────────
  if (a.finger.endsWith('_pinky') || b.finger.endsWith('_pinky')) {
    const aPinkyCost = a.finger.endsWith('_pinky') ? Math.abs(a.row - HOME_ROW) : 0;
    const bPinkyCost = b.finger.endsWith('_pinky') ? Math.abs(b.row - HOME_ROW) : 0;
    const cost = 0.04 * Math.max(aPinkyCost, bPinkyCost);
    if (cost > 0) {
      score += cost;
      flags.push('pinky_use');
    }
  }

  return { score, flags };
}

/**
 * Trigram redirect penalty: a roll that reverses direction on the same hand
 * mid-sequence (e.g. on Colemak: `nse` is index → middle → middle wait...).
 *
 * Concretely: same hand for all three keys, no SFB, and (rank b - rank a)
 * has opposite sign to (rank c - rank b).
 */
export function trigramRedirectPenalty(
  index: LayoutIndex,
  trigram: string,
): { score: number; flag: 'redirect' | null } {
  if (trigram.length !== 3) return { score: 0, flag: null };
  if (trigram.includes(' ')) return { score: 0, flag: null };
  const a = index.get(trigram[0]);
  const b = index.get(trigram[1]);
  const c = index.get(trigram[2]);
  if (!a || !b || !c) return { score: 0, flag: null };

  const sa = side(a.finger);
  const sb = side(b.finger);
  const sc = side(c.finger);
  if (sa === 'C' || sa !== sb || sb !== sc) return { score: 0, flag: null };

  if (a.finger === b.finger || b.finger === c.finger) return { score: 0, flag: null };

  const ra = fingerRank(a.finger);
  const rb = fingerRank(b.finger);
  const rc = fingerRank(c.finger);
  const d1 = rb - ra;
  const d2 = rc - rb;
  if (d1 === 0 || d2 === 0) return { score: 0, flag: null };
  if (Math.sign(d1) === Math.sign(d2)) return { score: 0, flag: null };

  return { score: 0.25, flag: 'redirect' };
}
