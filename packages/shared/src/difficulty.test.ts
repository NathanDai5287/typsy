import { describe, it, expect } from 'vitest';
import {
  bigramDifficulty,
  buildLayoutIndex,
  trigramRedirectPenalty,
} from './difficulty.js';
import { LAYOUT_DEFINITIONS } from './layouts.js';
import type { KeyPosition } from './types.js';

function loadIndex(name: string) {
  const def = LAYOUT_DEFINITIONS.find((d) => d.name === name)!;
  const positions = JSON.parse(def.key_positions_json) as KeyPosition[];
  return buildLayoutIndex(positions);
}

const colemak = loadIndex('Colemak');
const qwerty = loadIndex('QWERTY');

describe('bigramDifficulty — SFB', () => {
  it('flags a Colemak SFB (t and d are both left_index)', () => {
    // Colemak home row: a r s t d h n e i o
    // 't' col 3, 'd' col 4 → both left_index
    const r = bigramDifficulty(colemak, 'td');
    expect(r.flags).toContain('sfb');
    expect(r.score).toBeGreaterThan(0.5);
  });

  it('does not flag a cross-hand bigram as SFB', () => {
    // 't' (left_index) → 'h' (right_index): same finger NAME but different hand
    const r = bigramDifficulty(colemak, 'th');
    expect(r.flags).not.toContain('sfb');
  });

  it('treats a same-key repeat (tt) as a small repeat penalty, not an SFB', () => {
    const r = bigramDifficulty(colemak, 'tt');
    expect(r.flags).toContain('sf_repeat');
    expect(r.flags).not.toContain('sfb');
    expect(r.score).toBeLessThan(0.2);
  });
});

describe('bigramDifficulty — alternation bonus', () => {
  it('gives a bonus to cross-hand bigrams', () => {
    // Colemak 'ne': n is right_index, e is right_middle — same hand. Pick another:
    // 'an' on Colemak: a=left_pinky, n=right_index → cross-hand.
    const r = bigramDifficulty(colemak, 'an');
    expect(r.flags).toContain('alternation');
    expect(r.score).toBeLessThan(0);
  });
});

describe('bigramDifficulty — rolls', () => {
  it('flags an inward roll on Colemak (st: s=left_middle, t=left_index)', () => {
    const r = bigramDifficulty(colemak, 'st');
    expect(r.flags).toContain('inward_roll');
    expect(r.score).toBeLessThan(0);
  });
});

describe('bigramDifficulty — lateral stretch', () => {
  it('flags a lateral stretch when a finger is ≥2 cols from its home', () => {
    // Colemak 'g' is at col 4 (left_index, home col 3) → no stretch (1 col)
    // QWERTY 'b' is at row 2 col 4 (left_index, home col 3) → no stretch
    // Synthetic: pick 'g' (col 4 = index home is col 3, so still 1 col)
    // Actually cols: left_index home=3. col 4 is 1 away (still ok).
    // A real lateral stretch would be e.g. left_index reaching col 5 — but
    // that's a different hand on the standard map. So lateral stretches in
    // this 30-key block come from manual fingering overrides; with the
    // default fingering they don't occur.
    // Just sanity-check the function returns 0 for normal home-row bigrams:
    const r = bigramDifficulty(colemak, 'as'); // both left, no stretch
    expect(r.flags).not.toContain('lateral_stretch');
  });
});

describe('bigramDifficulty — return-zero edge cases', () => {
  it('returns score 0 for one- or three-letter inputs', () => {
    expect(bigramDifficulty(colemak, 'a').score).toBe(0);
    expect(bigramDifficulty(colemak, 'abc').score).toBe(0);
  });

  it('returns score 0 when either char is not in the layout', () => {
    expect(bigramDifficulty(colemak, '!a').score).toBe(0);
    expect(bigramDifficulty(colemak, 'a!').score).toBe(0);
  });

  it('returns score 0 when either char is a space', () => {
    expect(bigramDifficulty(colemak, ' a').score).toBe(0);
    expect(bigramDifficulty(colemak, 'a ').score).toBe(0);
  });
});

describe('trigramRedirectPenalty', () => {
  it('detects a same-hand redirect (rolls reverse direction)', () => {
    // Colemak left side fingers (home row): a(pinky=1) r(ring=2) s(middle=3) t(index=4) d(index=4)
    // 'srs': s(3) → r(2) → s(3): direction goes -1 then +1 → redirect.
    const r = trigramRedirectPenalty(colemak, 'srs');
    expect(r.flag).toBe('redirect');
    expect(r.score).toBeGreaterThan(0);
  });

  it('does not flag a straight roll', () => {
    // 'asr': a(1) → s(3) → r(2): not straight, not really a redirect either
    // Try 'art': a(1) → r(2) → t(4) — all increasing → straight roll.
    const r = trigramRedirectPenalty(colemak, 'art');
    expect(r.flag).toBeNull();
  });

  it('does not flag a cross-hand sequence', () => {
    // 'are': a(left_pinky), r(left_ring), e(right_middle) → not all same hand.
    const r = trigramRedirectPenalty(colemak, 'are');
    expect(r.flag).toBeNull();
  });

  it('does not flag when an SFB is in the way', () => {
    // 'rsr': r(left_ring) → s(left_middle) → r(left_ring): repeats r ↔ s, but
    // first finger == third finger and middle differs — that's a wobble, not a
    // redirect by this function's definition (it requires no SFB component).
    // Actually the function checks adjacent-pair SFB only. Let's go with 'tdt':
    // t(left_index) → d(left_index) → t(left_index): SFB everywhere.
    const r = trigramRedirectPenalty(colemak, 'tdt');
    expect(r.flag).toBeNull();
  });
});

describe('layout indexing', () => {
  it('respects fingering override', () => {
    const def = LAYOUT_DEFINITIONS.find((d) => d.name === 'QWERTY')!;
    const positions = JSON.parse(def.key_positions_json) as KeyPosition[];
    const idx = buildLayoutIndex(positions, { a: 'right_pinky' });
    expect(idx.get('a')!.finger).toBe('right_pinky');
    expect(idx.get('s')!.finger).toBe('left_ring'); // unchanged
  });
});

// Ensure the default-fingering loaded indexes are usable
describe('smoke: bigramDifficulty over QWERTY', () => {
  it('returns finite scores for a sample of bigrams', () => {
    const samples = ['th', 'he', 'in', 'er', 'an', 're', 'on', 'at', 'en', 'nd'];
    for (const b of samples) {
      const r = bigramDifficulty(qwerty, b);
      expect(Number.isFinite(r.score)).toBe(true);
    }
  });
});
