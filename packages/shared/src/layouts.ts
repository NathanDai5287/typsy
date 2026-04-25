import type { KeyPosition, FingerLabel } from './types.js';
import { COL_TO_FINGER } from './constants.js';

/** Internal layout grid definition (3 alpha rows × 10 cols). */
interface LayoutGrid {
  name: string;
  /** rows[0] = top alpha row, rows[1] = home row, rows[2] = bottom alpha row */
  rows: string[][];
}

/** Exported definition shape — name + serialized positions. */
export interface LayoutDefinition {
  name: string;
  key_positions_json: string;
}

// ─── Layout grids ───────────────────────────────────────────────────────────

const QWERTY_GRID: LayoutGrid = {
  name: 'QWERTY',
  rows: [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
  ],
};

const COLEMAK_GRID: LayoutGrid = {
  name: 'Colemak',
  rows: [
    ['q', 'w', 'f', 'p', 'g', 'j', 'l', 'u', 'y', ';'],
    ['a', 'r', 's', 't', 'd', 'h', 'n', 'e', 'i', 'o'],
    ['z', 'x', 'c', 'v', 'b', 'k', 'm', ',', '.', '/'],
  ],
};

// TODO: Verify this against the official Graphite layout reference at
// https://github.com/rdavison/graphite-layout before using in production.
// This is a best-effort placeholder based on the project spec.
const GRAPHITE_GRID: LayoutGrid = {
  name: 'Graphite',
  rows: [
    ['b', 'l', 'd', 'w', 'z', "'", 'f', 'o', 'u', 'j'],
    ['n', 'r', 't', 's', 'g', 'y', 'h', 'a', 'e', 'i'],
    ['q', 'x', 'm', 'c', 'v', 'k', 'p', '.', '-', '/'],
  ],
};

// ─── Builder ────────────────────────────────────────────────────────────────

function buildKeyPositions(grid: LayoutGrid): KeyPosition[] {
  const positions: KeyPosition[] = [];
  for (let row = 0; row < grid.rows.length; row++) {
    for (let col = 0; col < grid.rows[row].length; col++) {
      const char = grid.rows[row][col];
      const finger: FingerLabel = COL_TO_FINGER[col] ?? 'right_pinky';
      positions.push({ char, row, col, finger });
    }
  }
  return positions;
}

/**
 * Canonical `"row,col"` string used as the key for layout-independent
 * fingering maps. Stable, JSON-safe, and reused everywhere a finger
 * assignment is bound to a physical key position rather than a character.
 */
export function posKey(pos: { row: number; col: number }): string {
  return `${pos.row},${pos.col}`;
}

/** Builds a row/col → char lookup map from parsed KeyPosition[]. */
export function buildPositionCharMap(positions: KeyPosition[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const pos of positions) {
    map.set(posKey(pos), pos.char);
  }
  return map;
}

/** Builds a char → KeyPosition lookup map from parsed KeyPosition[]. */
export function buildCharPositionMap(positions: KeyPosition[]): Map<string, KeyPosition> {
  const map = new Map<string, KeyPosition>();
  for (const pos of positions) {
    map.set(pos.char, pos);
  }
  return map;
}

// ─── Exports ────────────────────────────────────────────────────────────────

export const LAYOUT_DEFINITIONS: LayoutDefinition[] = [
  QWERTY_GRID,
  COLEMAK_GRID,
  GRAPHITE_GRID,
].map((grid) => ({
  name: grid.name,
  key_positions_json: JSON.stringify(buildKeyPositions(grid)),
}));

/** Returns all key positions for a layout by name. */
export function getLayoutPositions(name: string): KeyPosition[] | null {
  const def = LAYOUT_DEFINITIONS.find((d) => d.name === name);
  if (!def) return null;
  return JSON.parse(def.key_positions_json) as KeyPosition[];
}
