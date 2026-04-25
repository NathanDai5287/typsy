import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchLayouts, postOnboarding, postUserFingering } from '../lib/api.ts';
import type { Layout, KeyPosition, FingerLabel, UserResponse } from '@typsy/shared';
import FingeringEditor from '../components/FingeringEditor.tsx';

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

// ─── Step 2: Fingering editor (thin wrapper around the shared editor) ────────

interface OnboardingFingeringStepProps {
  layout: Layout;
  onSave: (posFingeringMapJson: string) => void;
  isSaving: boolean;
}

function OnboardingFingeringStep({ layout, onSave, isSaving }: OnboardingFingeringStepProps) {
  const positions: KeyPosition[] = useMemo(
    () => JSON.parse(layout.key_positions_json),
    [layout],
  );

  return (
    <FingeringEditor
      positions={positions}
      onSave={(posFingerMap: Record<string, FingerLabel>) => onSave(JSON.stringify(posFingerMap))}
      isSaving={isSaving}
      saveLabel="Save and start"
      savingLabel="Saving…"
    />
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
    mutationFn: async (input: {
      layout_id: number;
      fingering_map_json: string;
    }) => {
      // Save the user-level fingering first so the response from
      // onboarding picks it up via the SELECT * inside that handler.
      // Both endpoints touch only the current user's rows; ordering is
      // about user-visible state, not concurrency.
      await postUserFingering({ fingering_map_json: input.fingering_map_json });
      return postOnboarding({ layout_id: input.layout_id });
    },
    onSuccess: (response) => {
      // Seed the user query synchronously so App.tsx sees layout_progress
      // populated before we navigate. Otherwise the redirect at "/" would
      // race the refetch from invalidateQueries, see needsOnboarding=true,
      // and bounce the user back into onboarding a second time.
      queryClient.setQueryData<UserResponse>(['user'], response);
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
            className="mt-6 px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-crust font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
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
          <OnboardingFingeringStep
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
