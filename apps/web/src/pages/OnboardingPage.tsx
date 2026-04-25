import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchLayouts,
  postInitialSetup,
  postUserFingering,
} from '../lib/api.ts';
import type { Layout, KeyPosition, FingerLabel, UserResponse } from '@typsy/shared';
import FingeringEditor from '../components/FingeringEditor.tsx';

// ─── Reusable layout card (used in steps 1 & 2) ─────────────────────────────

interface LayoutCardProps {
  layout: Layout;
  selected: boolean;
  onSelect: () => void;
}

function LayoutCard({ layout, selected, onSelect }: LayoutCardProps): JSX.Element {
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
        'panel p-4 text-left transition-none focus-visible:outline-none',
        selected ? 'border-yellow-400' : 'hover:border-fg3',
      ].join(' ')}
    >
      <div className="font-semibold text-fg_h mb-2 flex items-center gap-2">
        <span>{layout.name}</span>
        {selected && (
          <span className="text-[10px] uppercase tracking-widest text-yellow-400 border border-yellow-400 px-1">
            selected
          </span>
        )}
      </div>
      <div className="font-mono text-[11px] space-y-1">
        {rows.map((row, ri) => (
          <div
            key={ri}
            className="flex gap-0.5"
            style={{ paddingLeft: ri === 1 ? '6px' : ri === 2 ? '14px' : 0 }}
          >
            {row.map((pos) => (
              <span
                key={pos.char}
                className="w-5 h-5 flex items-center justify-center bg-bg2 text-fg2 border border-bg4"
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

// ─── Step 3: Fingering editor (thin wrapper around the shared editor) ────────

interface OnboardingFingeringStepProps {
  displayLayout: Layout;
  onSave: (posFingeringMapJson: string) => void;
  isSaving: boolean;
}

function OnboardingFingeringStep({
  displayLayout,
  onSave,
  isSaving,
}: OnboardingFingeringStepProps): JSX.Element {
  const positions: KeyPosition[] = useMemo(
    () => JSON.parse(displayLayout.key_positions_json),
    [displayLayout],
  );

  return (
    <FingeringEditor
      positions={positions}
      onSave={(posFingerMap: Record<string, FingerLabel>) =>
        onSave(JSON.stringify(posFingerMap))
      }
      isSaving={isSaving}
      saveLabel="Save and start"
      savingLabel="Saving…"
    />
  );
}

// ─── Main onboarding page ────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

export default function OnboardingPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [dailyDriverId, setDailyDriverId] = useState<number | null>(null);
  const [learnLayoutId, setLearnLayoutId] = useState<number | null>(null);

  const { data: layouts = [], isLoading } = useQuery({
    queryKey: ['layouts'],
    queryFn: fetchLayouts,
  });

  // Default daily driver to QWERTY (overwhelming-majority assumption).
  useEffect(() => {
    if (layouts.length > 0 && dailyDriverId === null) {
      const qwerty = layouts.find((l) => l.name === 'QWERTY') ?? layouts[0];
      setDailyDriverId(qwerty.id);
    }
  }, [layouts, dailyDriverId]);

  const learnOptions = useMemo(
    () => layouts.filter((l) => l.id !== dailyDriverId),
    [layouts, dailyDriverId],
  );

  useEffect(() => {
    if (learnOptions.length === 0) {
      setLearnLayoutId(null);
      return;
    }
    if (
      learnLayoutId === null ||
      !learnOptions.some((l) => l.id === learnLayoutId)
    ) {
      const colemak = learnOptions.find((l) => l.name === 'Colemak') ?? learnOptions[0];
      setLearnLayoutId(colemak.id);
    }
  }, [learnOptions, learnLayoutId]);

  // ─── Keyboard navigation (arrow keys to pick layouts in steps 1/2) ───────
  // Uses event.code so navigation is layout-agnostic. Step 3's keymap is
  // owned by the FingeringEditor. Modified keys (Shift+S etc.) belong to
  // the global keymap — don't double-handle them here.
  const handleStepKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (step === 1) {
        if (layouts.length === 0) return;
        const currentIdx = layouts.findIndex((l) => l.id === dailyDriverId);
        if (e.code === 'ArrowRight' || e.code === 'KeyL') {
          e.preventDefault();
          const next = (currentIdx + 1 + layouts.length) % layouts.length;
          setDailyDriverId(layouts[next].id);
        } else if (e.code === 'ArrowLeft' || e.code === 'KeyH') {
          e.preventDefault();
          const prev = (currentIdx - 1 + layouts.length) % layouts.length;
          setDailyDriverId(layouts[prev].id);
        } else if (e.code === 'Enter' && dailyDriverId !== null) {
          e.preventDefault();
          setStep(2);
        }
      } else if (step === 2) {
        if (learnOptions.length === 0) return;
        const currentIdx = learnOptions.findIndex((l) => l.id === learnLayoutId);
        if (e.code === 'ArrowRight' || e.code === 'KeyL') {
          e.preventDefault();
          const next = (currentIdx + 1 + learnOptions.length) % learnOptions.length;
          setLearnLayoutId(learnOptions[next].id);
        } else if (e.code === 'ArrowLeft' || e.code === 'KeyH') {
          e.preventDefault();
          const prev = (currentIdx - 1 + learnOptions.length) % learnOptions.length;
          setLearnLayoutId(learnOptions[prev].id);
        } else if (e.code === 'Enter' && learnLayoutId !== null) {
          e.preventDefault();
          setStep(3);
        } else if (e.code === 'KeyS') {
          // Skip the optional learn step.
          e.preventDefault();
          setLearnLayoutId(null);
          setStep(3);
        }
      }
    },
    [step, layouts, dailyDriverId, learnOptions, learnLayoutId],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleStepKey);
    return () => document.removeEventListener('keydown', handleStepKey);
  }, [handleStepKey]);

  // ─── Submit ──────────────────────────────────────────────────────────────

  const mutation = useMutation({
    mutationFn: async (input: {
      daily_driver_layout_id: number;
      learn_layout_id: number | null;
      fingering_map_json: string;
    }) => {
      await postUserFingering({ fingering_map_json: input.fingering_map_json });
      return postInitialSetup({
        daily_driver_layout_id: input.daily_driver_layout_id,
        learn_layout_id: input.learn_layout_id ?? undefined,
      });
    },
    onSuccess: (response) => {
      queryClient.setQueryData<UserResponse>(['user'], response);
      navigate('/');
    },
  });

  const dailyDriverLayout = layouts.find((l) => l.id === dailyDriverId);
  const fingeringDisplayLayout = dailyDriverLayout ?? null;

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-fg3">
        loading layouts…
      </div>
    );
  }

  function submit(fingeringMapJson: string) {
    if (dailyDriverId === null) return;
    mutation.mutate({
      daily_driver_layout_id: dailyDriverId,
      learn_layout_id: learnLayoutId,
      fingering_map_json: fingeringMapJson,
    });
  }

  const stepTitle =
    step === 1
      ? 'pick the layout you already use day-to-day'
      : step === 2
        ? 'pick a layout you want to learn (optional)'
        : 'confirm your fingering';

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      {/* Banner */}
      <div className="mb-8">
        <h1 className="text-2xl text-fg_h">welcome to <span className="text-yellow-400">typsy</span></h1>
        <p className="text-fg3 text-sm mt-1">
          step <span className="text-fg_h">{step}</span> of 3 — {stepTitle}
        </p>
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-fg3 text-sm">
            We'll mark this as your daily driver — every key stays unlocked
            and there's no progressive ramp-up. Use{' '}
            <kbd className="kbd">←</kbd>/<kbd className="kbd">→</kbd> or{' '}
            <kbd className="kbd">h</kbd>/<kbd className="kbd">l</kbd> to browse,{' '}
            <kbd className="kbd">Enter</kbd> to confirm.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {layouts.map((layout) => (
              <LayoutCard
                key={layout.id}
                layout={layout}
                selected={layout.id === dailyDriverId}
                onSelect={() => setDailyDriverId(layout.id)}
              />
            ))}
          </div>
          <button
            type="button"
            disabled={dailyDriverId === null}
            onClick={() => setStep(2)}
            className="btn btn-primary mt-2"
          >
            Next →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setStep(1)}
            className="btn btn-ghost"
          >
            ← Back
          </button>
          <p className="text-fg3 text-sm">
            Pick a layout you'd like to learn — it'll get progressive unlocks
            as you practice. Skip if you just want to keep using your daily
            driver. Use <kbd className="kbd">←</kbd>/<kbd className="kbd">→</kbd>{' '}
            to browse, <kbd className="kbd">Enter</kbd> to confirm,{' '}
            <kbd className="kbd">s</kbd> to skip.
          </p>
          {learnOptions.length === 0 ? (
            <p className="text-fg3 text-sm">No other layouts available — skip this step.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {learnOptions.map((layout) => (
                <LayoutCard
                  key={layout.id}
                  layout={layout}
                  selected={layout.id === learnLayoutId}
                  onSelect={() => setLearnLayoutId(layout.id)}
                />
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={learnLayoutId === null}
              onClick={() => setStep(3)}
              className="btn btn-primary"
            >
              Next →
            </button>
            <button
              type="button"
              onClick={() => {
                setLearnLayoutId(null);
                setStep(3);
              }}
              className="btn"
            >
              Skip — just my daily driver
            </button>
          </div>
        </div>
      )}

      {step === 3 && fingeringDisplayLayout && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setStep(2)}
            className="btn btn-ghost"
          >
            ← Back
          </button>
          <p className="text-fg3 text-sm">
            Fingerings are layout-independent — confirm them once on your
            daily driver and they apply everywhere. Defaults are standard
            touch-typing columns; tweak only if your hands disagree.
          </p>
          <OnboardingFingeringStep
            displayLayout={fingeringDisplayLayout}
            isSaving={mutation.isPending}
            onSave={submit}
          />
        </div>
      )}
    </div>
  );
}
