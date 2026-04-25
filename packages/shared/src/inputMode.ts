import type { KeyPosition } from './types.js';
import { buildPositionCharMap } from './layouts.js';

/**
 * Maps physical KeyboardEvent.code values to their row/col in the standard
 * 30-key alpha block (same positions as QWERTY).
 *
 * Row 0 = top alpha row (Q-P)
 * Row 1 = home row      (A-;)
 * Row 2 = bottom row    (Z-/)
 */
export const CODE_TO_POSITION: Record<string, { row: number; col: number }> = {
  // Row 0
  KeyQ: { row: 0, col: 0 },
  KeyW: { row: 0, col: 1 },
  KeyE: { row: 0, col: 2 },
  KeyR: { row: 0, col: 3 },
  KeyT: { row: 0, col: 4 },
  KeyY: { row: 0, col: 5 },
  KeyU: { row: 0, col: 6 },
  KeyI: { row: 0, col: 7 },
  KeyO: { row: 0, col: 8 },
  KeyP: { row: 0, col: 9 },
  // Row 1
  KeyA: { row: 1, col: 0 },
  KeyS: { row: 1, col: 1 },
  KeyD: { row: 1, col: 2 },
  KeyF: { row: 1, col: 3 },
  KeyG: { row: 1, col: 4 },
  KeyH: { row: 1, col: 5 },
  KeyJ: { row: 1, col: 6 },
  KeyK: { row: 1, col: 7 },
  KeyL: { row: 1, col: 8 },
  Semicolon: { row: 1, col: 9 },
  // Row 2
  KeyZ: { row: 2, col: 0 },
  KeyX: { row: 2, col: 1 },
  KeyC: { row: 2, col: 2 },
  KeyV: { row: 2, col: 3 },
  KeyB: { row: 2, col: 4 },
  KeyN: { row: 2, col: 5 },
  KeyM: { row: 2, col: 6 },
  Comma: { row: 2, col: 7 },
  Period: { row: 2, col: 8 },
  Slash: { row: 2, col: 9 },
};

/**
 * Translates a physical keypress into the logical character produced by the
 * active layout.
 *
 * Uses KeyboardEvent.code (physical key position, layout-independent) to look
 * up row/col in the QWERTY grid, then finds the character at that row/col in
 * the active layout. This enables practicing any layout regardless of the OS
 * keyboard setting — only event.code (physical position) matters.
 *
 * @param event          - The keyboard event (or a subset of it for testing).
 * @param positionMap    - Pre-built row/col → char map for the active layout.
 *                         Build with buildLayoutPositionMap().
 * @param _detectedOsLayout - Accepted for API compatibility; not used in MVP
 *                            (physical key mapping handles both QWERTY and
 *                            native-layout OS configurations correctly).
 * @returns The logical character, or null for non-character keys.
 */
export function translateKeypress(
  event: Pick<KeyboardEvent, 'code' | 'key'>,
  positionMap: Map<string, string>,
  _detectedOsLayout?: string,
): string | null {
  // Space is layout-independent — always return a literal space.
  if (event.code === 'Space') return ' ';

  const position = CODE_TO_POSITION[event.code];
  if (!position) return null;
  const char = positionMap.get(`${position.row},${position.col}`);
  return char ?? null;
}

/**
 * Convenience wrapper: builds the position map from a KeyPosition[] and
 * translates the event. Use when you can't pre-build the map.
 */
export function translateKeypressFromPositions(
  event: Pick<KeyboardEvent, 'code' | 'key'>,
  positions: KeyPosition[],
): string | null {
  const map = buildPositionCharMap(positions);
  return translateKeypress(event, map);
}
