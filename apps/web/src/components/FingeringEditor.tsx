import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyPosition, FingerLabel } from '@typsy/shared';
import { COL_TO_FINGER, posKey } from '@typsy/shared';
import { FINGER_BG, FINGER_LABELS, FINGER_DISPLAY } from '../lib/finger-colors.ts';
import { useKeymap, type Keybinding } from '../lib/keymap.ts';

/**
 * Column-based default keyed by physical position. This is what the layout
 * would assume without any user override — and the starting point for the
 * user's one-and-only fingering map.
 */
export function buildDefaultPosFingerMap(
  positions: readonly KeyPosition[],
): Record<string, FingerLabel> {
  const map: Record<string, FingerLabel> = {};
  for (const pos of positions) {
    map[posKey(pos)] = COL_TO_FINGER[pos.col] ?? 'right_pinky';
  }
  return map;
}

export interface FingeringEditorProps {
  /**
   * Layout used purely for visual reference (which chars sit on which
   * physical keys). The fingering itself is layout-independent — it's
   * keyed by `posKey(pos)`, not by character.
   */
  positions: readonly KeyPosition[];
  /** Pre-populates the editor; missing positions fall back to column defaults. */
  initialMap?: Record<string, FingerLabel>;
  /** Hides the save button — useful when the parent owns the save action. Default false. */
  hideSaveButton?: boolean;
  /** Label shown on the save button. Default "Save". */
  saveLabel?: string;
  /** Loading label shown on the save button. Default "Saving…". */
  savingLabel?: string;
  /** Called when the user clicks "Save". Receives the position-keyed map. */
  onSave?: (posFingerMap: Record<string, FingerLabel>) => void;
  /** Called whenever the editor's internal map changes — for live previews. */
  onChange?: (posFingerMap: Record<string, FingerLabel>) => void;
  isSaving?: boolean;
}

/**
 * 30-key finger-assignment editor.
 *
 * Mouse: click a key, then click a finger.
 * Keyboard:
 *   - j/k or ←/→ → move horizontal selection within the current row
 *   - Up/Down or i/k arrows → move between rows
 *   - Enter / Space → open finger picker
 *   - 1-9, 0 → assign one of ten fingers (in column order)
 *   - r → reset selection, c → reset all to defaults
 *
 * The finger is bound to the **physical position** (row, col), not to
 * the character — so the same assignment carries over to every layout.
 */
export default function FingeringEditor({
  positions,
  initialMap,
  hideSaveButton = false,
  saveLabel = 'Save',
  savingLabel = 'Saving…',
  onSave,
  onChange,
  isSaving = false,
}: FingeringEditorProps): JSX.Element {
  const defaults = useMemo(() => buildDefaultPosFingerMap(positions), [positions]);

  const [posFingerMap, setPosFingerMap] = useState<Record<string, FingerLabel>>(() => ({
    ...defaults,
    ...(initialMap ?? {}),
  }));
  const [selectedPos, setSelectedPos] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Keep an up-to-date ref for the keybinding closure so we don't re-bind
  // every keystroke.
  const stateRef = useRef({ selectedPos, pickerOpen });
  stateRef.current = { selectedPos, pickerOpen };

  // Reset when defaults or the externally-provided map changes (e.g. parent
  // swaps the displayed layout, or the saved fingering refetches).
  useEffect(() => {
    setPosFingerMap({ ...defaults, ...(initialMap ?? {}) });
    setSelectedPos(null);
    setPickerOpen(false);
  }, [defaults, initialMap]);

  useEffect(() => {
    onChange?.(posFingerMap);
  }, [posFingerMap, onChange]);

  const sortedPositions = useMemo(
    () =>
      [...positions].sort((a, b) =>
        a.row !== b.row ? a.row - b.row : a.col - b.col,
      ),
    [positions],
  );

  const rows = useMemo(
    () =>
      [0, 1, 2].map((r) =>
        sortedPositions.filter((p) => p.row === r),
      ),
    [sortedPositions],
  );

  const selectedChar = useMemo(() => {
    if (!selectedPos) return null;
    return positions.find((p) => posKey(p) === selectedPos)?.char ?? null;
  }, [selectedPos, positions]);

  // Read `selectedPos` via the ref instead of the surrounding closure.
  // The keymap-binding handlers below are memoized on `[positions]`, so
  // the `assignFinger` they capture is whichever instance existed the
  // first time `positions` was non-empty — i.e. before the user clicked
  // any key. Without the ref, every digit-key handler always saw
  // `selectedPos === null` and returned early, so the number shortcuts
  // silently did nothing while the picker buttons (which call the
  // *current* `assignFinger`) still worked.
  function assignFinger(finger: FingerLabel) {
    const pos = stateRef.current.selectedPos;
    if (!pos) return;
    setPosFingerMap((prev) => ({ ...prev, [pos]: finger }));
    setPickerOpen(false);
  }

  function moveSelection(dRow: number, dCol: number) {
    setSelectedPos((prev) => {
      if (!prev && sortedPositions.length > 0) {
        return posKey(sortedPositions[0]);
      }
      if (!prev) return prev;
      const cur = positions.find((p) => posKey(p) === prev);
      if (!cur) return prev;
      const nextRow = Math.max(0, Math.min(2, cur.row + dRow));
      const rowKeys = positions.filter((p) => p.row === nextRow).sort((a, b) => a.col - b.col);
      if (rowKeys.length === 0) return prev;
      // When jumping between rows, snap to the closest column rather than
      // overshooting if the row has fewer keys.
      const targetCol = Math.max(0, Math.min(rowKeys.length - 1, cur.col + dCol));
      const next = rowKeys.find((p) => p.col === targetCol)
        ?? rowKeys.find((p) => p.col === cur.col)
        ?? rowKeys[Math.min(rowKeys.length - 1, targetCol)];
      return posKey(next);
    });
  }

  function resetToDefaults() {
    setPosFingerMap(defaults);
    setSelectedPos(null);
    setPickerOpen(false);
  }

  // ─── Keyboard bindings (page-level) ─────────────────────────────────
  // These run via `useKeymap` so they coexist with the global keymap
  // (? for help, Esc to focus the navbar) without competing.
  const bindings = useMemo<Keybinding[]>(() => {
    const moveAndOpen = (dRow: number, dCol: number) => () => {
      // Close the picker when moving — the user wants to pick a different key.
      setPickerOpen(false);
      moveSelection(dRow, dCol);
    };
    const list: Keybinding[] = [
      { id: 'fe.left',   code: 'KeyH',       description: 'Select key ←', handler: moveAndOpen(0, -1) },
      { id: 'fe.right',  code: 'KeyL',       description: 'Select key →', handler: moveAndOpen(0, 1) },
      { id: 'fe.up',     code: 'KeyK',       description: 'Select key ↑', handler: moveAndOpen(-1, 0) },
      { id: 'fe.down',   code: 'KeyJ',       description: 'Select key ↓', handler: moveAndOpen(1, 0) },
      { id: 'fe.aleft',  code: 'ArrowLeft',  description: 'Select key ←', handler: moveAndOpen(0, -1) },
      { id: 'fe.aright', code: 'ArrowRight', description: 'Select key →', handler: moveAndOpen(0, 1) },
      { id: 'fe.aup',    code: 'ArrowUp',    description: 'Select key ↑', handler: moveAndOpen(-1, 0) },
      { id: 'fe.adown',  code: 'ArrowDown',  description: 'Select key ↓', handler: moveAndOpen(1, 0) },
      {
        id: 'fe.open',
        code: 'Enter',
        description: 'Open finger picker',
        handler: () => {
          if (stateRef.current.selectedPos) setPickerOpen(true);
        },
      },
      {
        id: 'fe.close',
        code: 'Escape',
        description: 'Close picker / clear selection',
        handler: () => {
          if (stateRef.current.pickerOpen) setPickerOpen(false);
          else setSelectedPos(null);
        },
      },
      {
        id: 'fe.reset',
        code: 'KeyC',
        description: 'Reset every key to default',
        handler: resetToDefaults,
      },
    ];
    // Digit shortcuts for finger assignment (only when picker is open).
    const digits = ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0'];
    for (let i = 0; i < FINGER_LABELS.length; i++) {
      list.push({
        id: `fe.assign-${i}`,
        code: digits[i],
        description: `Assign ${FINGER_DISPLAY[FINGER_LABELS[i]]}`,
        handler: () => {
          if (!stateRef.current.pickerOpen) return;
          assignFinger(FINGER_LABELS[i]);
        },
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions]); // moveSelection / resetToDefaults / assignFinger close over setters which are stable
  useKeymap(bindings);

  return (
    <div className="space-y-4">
      <p className="text-fg3 text-sm">
        Click a key (or use <kbd className="kbd">h j k l</kbd> / arrows) to select. Defaults
        use standard touch-typing columns. Fingerings are tied to physical key positions, so
        they apply to every layout.
      </p>

      {/* Key grid */}
      <div className="space-y-1">
        {rows.map((row, ri) => (
          <div
            key={ri}
            className="flex"
            style={{
              gap: '4px',
              paddingLeft: ri === 1 ? '14px' : ri === 2 ? '32px' : 0,
              marginTop: ri === 0 ? 0 : '4px',
            }}
          >
            {row.map((pos) => {
              const key = posKey(pos);
              const finger = posFingerMap[key] ?? defaults[key];
              const color = FINGER_BG[finger] ?? 'bg-bg2';
              const isSelected = selectedPos === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSelectedPos(isSelected ? null : key);
                    setPickerOpen(isSelected ? false : true);
                  }}
                  className={[
                    'w-10 h-10 font-mono text-sm font-medium text-bg_h border focus-visible:outline-none',
                    color,
                    isSelected
                      ? 'border-yellow-400 ring-1 ring-yellow-400'
                      : 'border-bg4 hover:border-fg2',
                  ].join(' ')}
                  title={FINGER_DISPLAY[finger]}
                >
                  {pos.char}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Finger picker */}
      {pickerOpen && selectedPos && (
        <div className="panel p-3 text-sm">
          <p className="text-fg3 mb-2">
            Assign{' '}
            {selectedChar !== null && (
              <span className="font-mono text-fg_h">"{selectedChar}"</span>
            )}{' '}
            to:
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {FINGER_LABELS.map((f, i) => (
              <button
                key={f}
                type="button"
                onClick={() => assignFinger(f)}
                className={[
                  'flex items-center justify-between px-2 py-1 text-bg_h border border-bg4',
                  'hover:border-yellow-400 focus-visible:outline-none focus-visible:border-yellow-400',
                  FINGER_BG[f],
                ].join(' ')}
              >
                <span className="font-mono">{FINGER_DISPLAY[f]}</span>
                <kbd className="kbd !bg-bg_h/30 !border-bg_h/30 !text-bg_h">
                  {i === 9 ? 0 : i + 1}
                </kbd>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-1 text-xs">
        {FINGER_LABELS.map((f) => (
          <span
            key={f}
            className={['px-2 py-0.5 text-bg_h font-mono border border-bg4', FINGER_BG[f]].join(' ')}
          >
            {FINGER_DISPLAY[f]}
          </span>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {!hideSaveButton && onSave && (
          <button
            type="button"
            disabled={isSaving}
            onClick={() => onSave(posFingerMap)}
            className="btn btn-primary"
          >
            {isSaving ? savingLabel : saveLabel}
          </button>
        )}
        <button
          type="button"
          onClick={resetToDefaults}
          className="btn"
        >
          Reset to defaults <span className="text-fg4">c</span>
        </button>
      </div>
    </div>
  );
}
