import { useEffect, useMemo, useState } from 'react';
import type { KeyPosition, FingerLabel } from '@typsy/shared';
import { COL_TO_FINGER, posKey } from '@typsy/shared';
import { FINGER_BG, FINGER_LABELS } from '../lib/finger-colors.ts';

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
 * 30-key finger-assignment editor. Click a key, then pick a finger from the
 * popup. The finger is bound to the **physical position** (row, col), not
 * to the character — so the same assignment carries over to every layout.
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
}: FingeringEditorProps) {
  const defaults = useMemo(() => buildDefaultPosFingerMap(positions), [positions]);

  const [posFingerMap, setPosFingerMap] = useState<Record<string, FingerLabel>>(() => ({
    ...defaults,
    ...(initialMap ?? {}),
  }));
  const [selectedPos, setSelectedPos] = useState<string | null>(null);

  // Reset when defaults or the externally-provided map changes (e.g. parent
  // swaps the displayed layout, or the saved fingering refetches).
  useEffect(() => {
    setPosFingerMap({ ...defaults, ...(initialMap ?? {}) });
    setSelectedPos(null);
  }, [defaults, initialMap]);

  useEffect(() => {
    onChange?.(posFingerMap);
  }, [posFingerMap, onChange]);

  const rows = useMemo(
    () =>
      [0, 1, 2].map((r) =>
        [...positions].filter((p) => p.row === r).sort((a, b) => a.col - b.col),
      ),
    [positions],
  );

  const selectedChar = useMemo(() => {
    if (!selectedPos) return null;
    return positions.find((p) => posKey(p) === selectedPos)?.char ?? null;
  }, [selectedPos, positions]);

  function assignFinger(finger: FingerLabel) {
    if (!selectedPos) return;
    setPosFingerMap((prev) => ({ ...prev, [selectedPos]: finger }));
    setSelectedPos(null);
  }

  function resetToDefaults() {
    setPosFingerMap(defaults);
    setSelectedPos(null);
  }

  return (
    <div className="space-y-6">
      <p className="text-gray-400 text-sm">
        Click a key to reassign its finger. Defaults use standard touch-typing columns.
        Fingerings are tied to physical key positions, so they apply to every layout.
      </p>

      {/* Key grid */}
      <div className="space-y-2">
        {rows.map((row, ri) => (
          <div
            key={ri}
            className="flex gap-1.5"
            style={{ paddingLeft: ri === 1 ? '0.6rem' : ri === 2 ? '1.2rem' : 0 }}
          >
            {row.map((pos) => {
              const key = posKey(pos);
              const finger = posFingerMap[key] ?? defaults[key];
              const color = FINGER_BG[finger] ?? 'bg-gray-700';
              const isSelected = selectedPos === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedPos(isSelected ? null : key)}
                  className={[
                    'w-10 h-10 rounded font-mono text-sm font-medium text-crust transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
                    color,
                    isSelected
                      ? 'ring-2 ring-white scale-110'
                      : 'hover:brightness-125',
                  ].join(' ')}
                  title={finger.replace(/_/g, ' ')}
                >
                  {pos.char}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Finger selector */}
      {selectedPos && (
        <div className="p-4 bg-gray-800 rounded-lg space-y-2">
          <p className="text-sm text-gray-300">
            Assign the key
            {selectedChar !== null && (
              <>
                {' '}(showing <span className="font-mono text-white">"{selectedChar}"</span>)
              </>
            )}
            {' '}to:
          </p>
          <div className="flex flex-wrap gap-2">
            {FINGER_LABELS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => assignFinger(f)}
                className={[
                  'px-3 py-1 rounded text-xs font-medium text-crust focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
                  FINGER_BG[f],
                  'hover:brightness-125',
                ].join(' ')}
              >
                {f.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {FINGER_LABELS.map((f) => (
          <span
            key={f}
            className={['px-2 py-0.5 rounded text-xs text-crust', FINGER_BG[f]].join(' ')}
          >
            {f.replace(/_/g, ' ')}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {!hideSaveButton && onSave && (
          <button
            type="button"
            disabled={isSaving}
            onClick={() => onSave(posFingerMap)}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-crust font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            {isSaving ? savingLabel : saveLabel}
          </button>
        )}
        <button
          type="button"
          onClick={resetToDefaults}
          className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
