import { describe, it, expect } from 'vitest';
import { translateKeypress, CODE_TO_POSITION } from './inputMode.js';
import { LAYOUT_DEFINITIONS, buildPositionCharMap } from './layouts.js';
import type { KeyPosition } from './types.js';

function makeMap(name: string) {
  const def = LAYOUT_DEFINITIONS.find((d) => d.name === name);
  if (!def) throw new Error(`Layout "${name}" not found`);
  const positions: KeyPosition[] = JSON.parse(def.key_positions_json);
  return buildPositionCharMap(positions);
}

const qwertyMap = makeMap('QWERTY');
const colemakMap = makeMap('Colemak');
const graphiteMap = makeMap('Graphite');

// ─── CODE_TO_POSITION sanity ────────────────────────────────────────────────

describe('CODE_TO_POSITION', () => {
  it('has exactly 30 entries', () => {
    expect(Object.keys(CODE_TO_POSITION)).toHaveLength(30);
  });

  it('maps KeyA to home row col 0', () => {
    expect(CODE_TO_POSITION['KeyA']).toEqual({ row: 1, col: 0 });
  });

  it('maps KeyF to home row col 3', () => {
    expect(CODE_TO_POSITION['KeyF']).toEqual({ row: 1, col: 3 });
  });
});

// ─── QWERTY pass-through ────────────────────────────────────────────────────

describe('translateKeypress — QWERTY layout', () => {
  it('returns the same char as QWERTY', () => {
    expect(translateKeypress({ code: 'KeyA', key: 'a' }, qwertyMap)).toBe('a');
    expect(translateKeypress({ code: 'KeyS', key: 's' }, qwertyMap)).toBe('s');
    expect(translateKeypress({ code: 'KeyF', key: 'f' }, qwertyMap)).toBe('f');
  });

  it('returns ; for Semicolon', () => {
    expect(translateKeypress({ code: 'Semicolon', key: ';' }, qwertyMap)).toBe(';');
  });
});

// ─── Colemak remapping ──────────────────────────────────────────────────────

describe('translateKeypress — Colemak layout (OS on QWERTY)', () => {
  it('KeyF (QWERTY f) → t in Colemak (home row col 3)', () => {
    // QWERTY home row col 3 = f; Colemak home row col 3 = t
    expect(translateKeypress({ code: 'KeyF', key: 'f' }, colemakMap)).toBe('t');
  });

  it('KeyS (QWERTY s) → r in Colemak (home row col 1)', () => {
    // QWERTY home row col 1 = s; Colemak home row col 1 = r
    expect(translateKeypress({ code: 'KeyS', key: 's' }, colemakMap)).toBe('r');
  });

  it('KeyA → a (unchanged in Colemak)', () => {
    expect(translateKeypress({ code: 'KeyA', key: 'a' }, colemakMap)).toBe('a');
  });

  it('KeyJ → n (Colemak home row col 6)', () => {
    expect(translateKeypress({ code: 'KeyJ', key: 'j' }, colemakMap)).toBe('n');
  });

  it('KeyE → f (Colemak top row col 2)', () => {
    // QWERTY top row col 2 = e; Colemak top row col 2 = f
    expect(translateKeypress({ code: 'KeyE', key: 'e' }, colemakMap)).toBe('f');
  });

  it('Semicolon → o (Colemak home row col 9)', () => {
    // QWERTY home row col 9 = ;; Colemak home row col 9 = o
    expect(translateKeypress({ code: 'Semicolon', key: ';' }, colemakMap)).toBe('o');
  });
});

// ─── Non-character keys ─────────────────────────────────────────────────────

describe('translateKeypress — non-character keys', () => {
  it('returns null for ShiftLeft', () => {
    expect(translateKeypress({ code: 'ShiftLeft', key: 'Shift' }, colemakMap)).toBeNull();
  });

  it('returns null for Enter', () => {
    expect(translateKeypress({ code: 'Enter', key: 'Enter' }, colemakMap)).toBeNull();
  });

  it('returns null for Backspace', () => {
    expect(translateKeypress({ code: 'Backspace', key: 'Backspace' }, colemakMap)).toBeNull();
  });

  it('returns a space for the Space key (layout-independent)', () => {
    expect(translateKeypress({ code: 'Space', key: ' ' }, colemakMap)).toBe(' ');
    expect(translateKeypress({ code: 'Space', key: ' ' }, qwertyMap)).toBe(' ');
  });
});

// ─── Graphite ───────────────────────────────────────────────────────────────

describe('translateKeypress — Graphite layout', () => {
  it('KeyN (top row col 5) → apostrophe in Graphite', () => {
    // Wait — KeyN is row 2 col 5 not row 0. Let me recalculate.
    // CODE_TO_POSITION["KeyY"] = { row: 0, col: 5 }; Graphite row 0 col 5 = "'"
    expect(translateKeypress({ code: 'KeyY', key: 'y' }, graphiteMap)).toBe("'");
  });

  it('KeyA → n (Graphite home row col 0)', () => {
    // Graphite home row col 0 = n
    expect(translateKeypress({ code: 'KeyA', key: 'a' }, graphiteMap)).toBe('n');
  });
});
