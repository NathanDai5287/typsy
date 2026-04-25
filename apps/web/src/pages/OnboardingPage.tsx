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

// ─── Step 3: Fingering editor (thin wrapper around the shared editor) ────────

interface OnboardingFingeringStepProps {
  /** Layout used purely for the visual reference (which chars sit on which keys). */
  displayLayout: Layout;
  onSave: (posFingeringMapJson: string) => void;
  isSaving: boolean;
}

function OnboardingFingeringStep({
  displayLayout,
  onSave,
  isSaving,
}: OnboardingFingeringStepProps) {
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

export default function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [dailyDriverId, setDailyDriverId] = useState<number | null>(null);
  const [learnLayoutId, setLearnLayoutId] = useState<number | null>(null);

  const { data: layouts = [], isLoading } = useQuery({
    queryKey: ['layouts'],
    queryFn: fetchLayouts,
  });

  // Default the daily driver to QWERTY — the layout the overwhelming
  // majority of users come in already typing on. Falls back to the first
  // available layout if QWERTY somehow isn't present.
  useEffect(() => {
    if (layouts.length > 0 && dailyDriverId === null) {
      const qwerty = layouts.find((l) => l.name === 'QWERTY') ?? layouts[0];
      setDailyDriverId(qwerty.id);
    }
  }, [layouts, dailyDriverId]);

  // Step-2 candidates: every layout except the one already chosen as the
  // daily driver. Default to Colemak if available, else the first option.
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
      const colemak =
        learnOptions.find((l) => l.name === 'Colemak') ?? learnOptions[0];
      setLearnLayoutId(colemak.id);
    }
  }, [learnOptions, learnLayoutId]);

  // ─── Keyboard navigation ──────────────────────────────────────────────────
  // Step 1 cycles through the full layout list; step 2 cycles through the
  // learn-layout candidates only. Enter advances each step. Step 3 leaves
  // Enter alone — the fingering editor handles its own clicks.
  const handleStepKey = useCallback(
    (e: KeyboardEvent) => {
      if (step === 1) {
        if (layouts.length === 0) return;
        const currentIdx = layouts.findIndex((l) => l.id === dailyDriverId);
        if (e.key === 'ArrowRight') {
          const next = (currentIdx + 1 + layouts.length) % layouts.length;
          setDailyDriverId(layouts[next].id);
        } else if (e.key === 'ArrowLeft') {
          const prev = (currentIdx - 1 + layouts.length) % layouts.length;
          setDailyDriverId(layouts[prev].id);
        } else if (e.key === 'Enter' && dailyDriverId !== null) {
          setStep(2);
        }
      } else if (step === 2) {
        if (learnOptions.length === 0) return;
        const currentIdx = learnOptions.findIndex((l) => l.id === learnLayoutId);
        if (e.key === 'ArrowRight') {
          const next = (currentIdx + 1 + learnOptions.length) % learnOptions.length;
          setLearnLayoutId(learnOptions[next].id);
        } else if (e.key === 'ArrowLeft') {
          const prev = (currentIdx - 1 + learnOptions.length) % learnOptions.length;
          setLearnLayoutId(learnOptions[prev].id);
        } else if (e.key === 'Enter' && learnLayoutId !== null) {
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
      // Save the user-level fingering first so the response from
      // initial-setup picks it up via the SELECT * inside that handler.
      // Both endpoints touch only the current user's rows; ordering is
      // about user-visible state, not concurrency.
      await postUserFingering({ fingering_map_json: input.fingering_map_json });
      return postInitialSetup({
        daily_driver_layout_id: input.daily_driver_layout_id,
        learn_layout_id: input.learn_layout_id ?? undefined,
      });
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

  const dailyDriverLayout = layouts.find((l) => l.id === dailyDriverId);

  // The fingering editor needs a layout to draw the keyboard against. We
  // show the daily driver's chars: the user has the strongest mental model
  // for finger placement on the layout they already type on. Confirming
  // "left index here" once carries over to every other layout because the
  // map is keyed by physical position, not character.
  const fingeringDisplayLayout = dailyDriverLayout ?? null;

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-400">
        Loading layouts…
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
      ? 'Pick the layout you already use day to day'
      : step === 2
        ? 'Pick a layout you want to learn (optional)'
        : 'Confirm your fingering';

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold text-white mb-2">Welcome to Typsy</h1>
      <p className="text-gray-400 mb-10">
        Step {step} of 3 — {stepTitle}
      </p>

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400 mb-4">
            We&apos;ll mark this as your daily driver — every key stays unlocked
            and there&apos;s no progressive ramp-up. Use ← → to navigate, Enter
            to confirm.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
            className="mt-6 px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-crust font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
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
            className="mb-2 text-sm text-gray-400 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          >
            ← Back
          </button>
          <p className="text-sm text-gray-400 mb-4">
            Pick a layout you&apos;d like to learn — it&apos;ll get progressive
            unlocks as you practice. Skip if you just want to keep using your
            daily driver. Use ← → to navigate, Enter to confirm.
          </p>
          {learnOptions.length === 0 ? (
            <p className="text-sm text-gray-400">
              No other layouts are available — skip this step.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={learnLayoutId === null}
              onClick={() => setStep(3)}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-crust font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              Next →
            </button>
            <button
              type="button"
              onClick={() => {
                setLearnLayoutId(null);
                setStep(3);
              }}
              className="px-6 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              Skip — just my daily driver
            </button>
          </div>
        </div>
      )}

      {step === 3 && fingeringDisplayLayout && (
        <div>
          <button
            type="button"
            onClick={() => setStep(2)}
            className="mb-6 text-sm text-gray-400 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          >
            ← Back
          </button>
          <p className="text-sm text-gray-400 mb-4">
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
