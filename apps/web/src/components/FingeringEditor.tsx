import { useEffect, useMemo, useState } from 'react';
import type { KeyPosition, FingerLabel } from '@typsy/shared';
import { COL_TO_FINGER } from '@typsy/shared';
import { FINGER_BG, FINGER_LABELS } from '../lib/finger-colors.ts';

/** Column-based default — what the layout would assume without an override. */
export function buildDefaultFingeringMap(
  positions: readonly KeyPosition[],
): Record<string, FingerLabel> {
  const map: Record<string, FingerLabel> = {};
  for (const pos of positions) {
    map[pos.char] = COL_TO_FINGER[pos.col] ?? 'right_pinky';
  }
  return map;
}

export interface FingeringEditorProps {
  positions: readonly KeyPosition[];
  /** Map to pre-populate; falls back to column-based defaults for any missing chars. */
  initialMap?: Record<string, FingerLabel>;
  /** Hides the save button — useful when the parent owns the save action. Default false. */
  hideSaveButton?: boolean;
  /** Label shown on the save button. Default "Save". */
  saveLabel?: string;
  /** Loading label shown on the save button. Default "Saving…". */
  savingLabel?: string;
  /** Called when the user clicks "Save". */
  onSave?: (fingerMap: Record<string, FingerLabel>) => void;
  /** Called whenever the editor's internal map changes — useful for parents that want a live preview. */
  onChange?: (fingerMap: Record<string, FingerLabel>) => void;
  isSaving?: boolean;
}

/**
 * 30-key finger-assignment editor. Click a key, then pick a finger from the
 * popup. Used in onboarding (with column-based defaults) and on `/fingering`
 * (pre-populated from the user's saved map).
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
  const defaults = useMemo(() => buildDefaultFingeringMap(positions), [positions]);

  const [fingerMap, setFingerMap] = useState<Record<string, FingerLabel>>(() => ({
    ...defaults,
    ...(initialMap ?? {}),
  }));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // If the parent swaps the layout (and therefore positions/initialMap), reset
  // local state so we don't carry over assignments from a different layout.
  useEffect(() => {
    setFingerMap({ ...defaults, ...(initialMap ?? {}) });
    setSelectedKey(null);
  }, [defaults, initialMap]);

  useEffect(() => {
    onChange?.(fingerMap);
  }, [fingerMap, onChange]);

  const rows = useMemo(
    () =>
      [0, 1, 2].map((r) =>
        [...positions].filter((p) => p.row === r).sort((a, b) => a.col - b.col),
      ),
    [positions],
  );

  function assignFinger(finger: FingerLabel) {
    if (!selectedKey) return;
    setFingerMap((prev) => ({ ...prev, [selectedKey]: finger }));
    setSelectedKey(null);
  }

  function resetToDefaults() {
    setFingerMap(defaults);
    setSelectedKey(null);
  }

  return (
    <div className="space-y-6">
      <p className="text-gray-400 text-sm">
        Click a key to reassign its finger. Defaults use standard touch-typing columns.
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
              const finger = fingerMap[pos.char] ?? defaults[pos.char];
              const color = FINGER_BG[finger] ?? 'bg-gray-700';
              const isSelected = selectedKey === pos.char;
              return (
                <button
                  key={pos.char}
                  type="button"
                  onClick={() => setSelectedKey(isSelected ? null : pos.char)}
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
      {selectedKey && (
        <div className="p-4 bg-gray-800 rounded-lg space-y-2">
          <p className="text-sm text-gray-300">
            Assign <span className="font-mono text-white">"{selectedKey}"</span> to:
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
            onClick={() => onSave(fingerMap)}
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
