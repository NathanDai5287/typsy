import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchLayouts, postOnboarding } from '../lib/api.ts';
import type { Layout, KeyPosition, FingerLabel } from '@typsy/shared';
import { COL_TO_FINGER } from '@typsy/shared';
import { FINGER_BG as FINGER_COLORS, FINGER_LABELS } from '../lib/finger-colors.ts';

function buildDefaultFingeringMap(positions: KeyPosition[]): Record<string, FingerLabel> {
  const map: Record<string, FingerLabel> = {};
  for (const pos of positions) {
    map[pos.char] = COL_TO_FINGER[pos.col] ?? 'right_pinky';
  }
  return map;
}

// ─── Step 1: Pick layout ─────────────────────────────────────────────────────

interface LayoutCardProps {
  layout: Layout;
  selected: boolean;
  onSelect: () => void;
}

function LayoutCard({ layout, selected, onSelect }: LayoutCardProps) {
  const positions: KeyPosition[] = JSON.parse(layout.key_positions_json);
  const rows = [0, 1, 2].map((r) =>
    positions.filter((p) => p.row === r).sort((a, b) => a.col - b.col),
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      aria-pressed={selected}
      className={[
        'rounded-xl border-2 p-5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
        selected
          ? 'border-blue-400 bg-gray-800'
          : 'border-gray-700 bg-gray-900 hover:border-gray-500',
      ].join(' ')}
    >
      <div className="font-semibold text-white mb-3">{layout.name}</div>
      <div className="font-mono text-xs space-y-1">
        {rows.map((row, ri) => (
          <div key={ri} className="flex gap-1">
            {row.map((pos) => (
              <span
                key={pos.char}
                className="w-6 h-6 flex items-center justify-center rounded bg-gray-700 text-gray-300"
              >
                {pos.char}
              </span>
            ))}
          </div>
        ))}
      </div>
    </button>
  );
}

// ─── Step 2: Fingering editor ────────────────────────────────────────────────

interface FingeringEditorProps {
  layout: Layout;
  onSave: (fingeringMapJson: string) => void;
  isSaving: boolean;
}

function FingeringEditor({ layout, onSave, isSaving }: FingeringEditorProps) {
  const positions: KeyPosition[] = useMemo(
    () => JSON.parse(layout.key_positions_json),
    [layout],
  );

  const [fingerMap, setFingerMap] = useState<Record<string, FingerLabel>>(
    () => buildDefaultFingeringMap(positions),
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      [0, 1, 2].map((r) =>
        positions.filter((p) => p.row === r).sort((a, b) => a.col - b.col),
      ),
    [positions],
  );

  function assignFinger(finger: FingerLabel) {
    if (!selectedKey) return;
    setFingerMap((prev) => ({ ...prev, [selectedKey]: finger }));
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
          <div key={ri} className="flex gap-1.5">
            {row.map((pos) => {
              const finger = fingerMap[pos.char] ?? COL_TO_FINGER[pos.col];
              const color = FINGER_COLORS[finger] ?? 'bg-gray-700';
              const isSelected = selectedKey === pos.char;
              return (
                <button
                  key={pos.char}
                  type="button"
                  onClick={() => setSelectedKey(isSelected ? null : pos.char)}
                  className={[
                    'w-10 h-10 rounded font-mono text-sm font-medium transition-all',
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
                  'px-3 py-1 rounded text-xs font-medium text-white',
                  FINGER_COLORS[f],
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
            className={['px-2 py-0.5 rounded text-xs text-white', FINGER_COLORS[f]].join(' ')}
          >
            {f.replace(/_/g, ' ')}
          </span>
        ))}
      </div>

      <button
        type="button"
        disabled={isSaving}
        onClick={() => onSave(JSON.stringify(fingerMap))}
        className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        {isSaving ? 'Saving…' : 'Save and start'}
      </button>
    </div>
  );
}

// ─── Main onboarding page ────────────────────────────────────────────────────

export default function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedLayoutId, setSelectedLayoutId] = useState<number | null>(null);
  const [layoutIndex, setLayoutIndex] = useState(0);

  const { data: layouts = [], isLoading } = useQuery({
    queryKey: ['layouts'],
    queryFn: fetchLayouts,
  });

  // Default to Colemak once layouts load
  useEffect(() => {
    if (layouts.length > 0 && selectedLayoutId === null) {
      const colemak = layouts.find((l) => l.name === 'Colemak') ?? layouts[0];
      setSelectedLayoutId(colemak.id);
      setLayoutIndex(layouts.indexOf(colemak));
    }
  }, [layouts, selectedLayoutId]);

  // Keyboard navigation on step 1
  const handleStep1Key = useCallback(
    (e: KeyboardEvent) => {
      if (step !== 1 || layouts.length === 0) return;
      if (e.key === 'ArrowRight') {
        const next = (layoutIndex + 1) % layouts.length;
        setLayoutIndex(next);
        setSelectedLayoutId(layouts[next].id);
      } else if (e.key === 'ArrowLeft') {
        const prev = (layoutIndex - 1 + layouts.length) % layouts.length;
        setLayoutIndex(prev);
        setSelectedLayoutId(layouts[prev].id);
      } else if (e.key === 'Enter') {
        if (selectedLayoutId !== null) setStep(2);
      }
    },
    [step, layouts, layoutIndex, selectedLayoutId],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleStep1Key);
    return () => document.removeEventListener('keydown', handleStep1Key);
  }, [handleStep1Key]);

  const mutation = useMutation({
    mutationFn: postOnboarding,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user'] });
      navigate('/');
    },
  });

  const activeLayout = layouts.find((l) => l.id === selectedLayoutId);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-400">
        Loading layouts…
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold text-white mb-2">Welcome to Typsy</h1>
      <p className="text-gray-400 mb-10">
        Step {step} of 2 — {step === 1 ? 'Choose your target layout' : 'Assign finger positions'}
      </p>

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400 mb-4">
            Use ← → arrow keys to navigate, Enter to confirm.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {layouts.map((layout) => (
              <LayoutCard
                key={layout.id}
                layout={layout}
                selected={layout.id === selectedLayoutId}
                onSelect={() => {
                  setSelectedLayoutId(layout.id);
                  setLayoutIndex(layouts.indexOf(layout));
                }}
              />
            ))}
          </div>
          <button
            type="button"
            disabled={selectedLayoutId === null}
            onClick={() => setStep(2)}
            className="mt-6 px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            Next →
          </button>
        </div>
      )}

      {step === 2 && activeLayout && (
        <div>
          <button
            type="button"
            onClick={() => setStep(1)}
            className="mb-6 text-sm text-gray-400 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          >
            ← Back
          </button>
          <FingeringEditor
            layout={activeLayout}
            isSaving={mutation.isPending}
            onSave={(fingeringMapJson) =>
              mutation.mutate({ layout_id: selectedLayoutId!, fingering_map_json: fingeringMapJson })
            }
          />
        </div>
      )}
    </div>
  );
}
