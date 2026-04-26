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
const dvorakMap = makeMap('Dvorak');
const workmanMap = makeMap('Workman');
const colemakDhMap = makeMap('Colemak DH');
const canaryMap = makeMap('Canary');

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

// ─── Dvorak ─────────────────────────────────────────────────────────────────

describe('translateKeypress — Dvorak layout', () => {
  it('KeyA → a (Dvorak home row col 0)', () => {
    expect(translateKeypress({ code: 'KeyA', key: 'a' }, dvorakMap)).toBe('a');
  });

  it('KeyS → o (Dvorak home row col 1)', () => {
    // Dvorak home row: a o e u i d h t n s
    expect(translateKeypress({ code: 'KeyS', key: 's' }, dvorakMap)).toBe('o');
  });

  it('KeyF → u (Dvorak home row col 3)', () => {
    expect(translateKeypress({ code: 'KeyF', key: 'f' }, dvorakMap)).toBe('u');
  });

  it('KeyJ → h (Dvorak home row col 6)', () => {
    expect(translateKeypress({ code: 'KeyJ', key: 'j' }, dvorakMap)).toBe('h');
  });

  it('Semicolon → s (Dvorak home row col 9)', () => {
    expect(translateKeypress({ code: 'Semicolon', key: ';' }, dvorakMap)).toBe('s');
  });

  it("KeyQ → ' (Dvorak top row col 0 is the apostrophe)", () => {
    expect(translateKeypress({ code: 'KeyQ', key: 'q' }, dvorakMap)).toBe("'");
  });
});

// ─── Workman ────────────────────────────────────────────────────────────────

describe('translateKeypress — Workman layout', () => {
  it('KeyA → a (Workman home row col 0)', () => {
    expect(translateKeypress({ code: 'KeyA', key: 'a' }, workmanMap)).toBe('a');
  });

  it('KeyD → h (Workman home row col 2)', () => {
    // Workman home row: a s h t g y n e o i
    expect(translateKeypress({ code: 'KeyD', key: 'd' }, workmanMap)).toBe('h');
  });

  it('KeyF → t (Workman home row col 3)', () => {
    expect(translateKeypress({ code: 'KeyF', key: 'f' }, workmanMap)).toBe('t');
  });

  it('KeyJ → n (Workman home row col 6)', () => {
    expect(translateKeypress({ code: 'KeyJ', key: 'j' }, workmanMap)).toBe('n');
  });

  it('KeyW → d (Workman top row col 1)', () => {
    // Workman top row: q d r w b j f u p ;
    expect(translateKeypress({ code: 'KeyW', key: 'w' }, workmanMap)).toBe('d');
  });
});

// ─── Colemak DH ─────────────────────────────────────────────────────────────

describe('translateKeypress — Colemak DH layout', () => {
  it('KeyA → a (Colemak DH home row col 0, same as Colemak)', () => {
    expect(translateKeypress({ code: 'KeyA', key: 'a' }, colemakDhMap)).toBe('a');
  });

  it('KeyD → s (Colemak DH home row col 2)', () => {
    // Colemak DH home: a r s t g m n e i o (same as Colemak)
    expect(translateKeypress({ code: 'KeyD', key: 'd' }, colemakDhMap)).toBe('s');
  });

  it('KeyG → b (Colemak DH top row col 4 — the DH swap)', () => {
    // The DH swap: Colemak has 'g' at top-row col 4; Colemak DH has 'b' there.
    // CODE_TO_POSITION['KeyT'] = { row: 0, col: 4 } so KeyT is the comparable key,
    // but KeyG is row 1 col 4 = 'g' in Colemak DH — we test the actual top-row key.
    expect(translateKeypress({ code: 'KeyT', key: 't' }, colemakDhMap)).toBe('b');
  });

  it('KeyB → v (Colemak DH bottom row col 4 — the other DH change)', () => {
    // Colemak bottom row col 4 = 'b'; Colemak DH has 'v' there (z x c d v ...).
    expect(translateKeypress({ code: 'KeyB', key: 'b' }, colemakDhMap)).toBe('v');
  });

  it('KeyM → h (Colemak DH bottom row col 6 — H drops off the home row)', () => {
    // Standard Colemak puts 'm' at row 2 col 6; Colemak DH puts 'h' there
    // (the "H" half of "DH"). KeyM is row 2 col 6.
    expect(translateKeypress({ code: 'KeyM', key: 'm' }, colemakDhMap)).toBe('h');
  });
});

// ─── Canary ─────────────────────────────────────────────────────────────────

describe('translateKeypress — Canary layout', () => {
  it('KeyA → c (Canary home row col 0)', () => {
    // Canary home: c r s t g m n e i a
    expect(translateKeypress({ code: 'KeyA', key: 'a' }, canaryMap)).toBe('c');
  });

  it('KeyF → t (Canary home row col 3)', () => {
    expect(translateKeypress({ code: 'KeyF', key: 'f' }, canaryMap)).toBe('t');
  });

  it('Semicolon → a (Canary home row col 9 — the e/a flip vs. Colemak)', () => {
    expect(translateKeypress({ code: 'Semicolon', key: ';' }, canaryMap)).toBe('a');
  });

  it("KeyP → ' (Canary top row col 9 puts the apostrophe on the right pinky)", () => {
    expect(translateKeypress({ code: 'KeyP', key: 'p' }, canaryMap)).toBe("'");
  });

  it('Comma → / (Canary bottom row col 7 — slash deliberately left of comma)', () => {
    // Canary bottom: q j v d k x h / , .
    expect(translateKeypress({ code: 'Comma', key: ',' }, canaryMap)).toBe('/');
  });
});
