import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchLayoutSummary,
  postActiveLayout,
  postOnboarding,
  postProgressUpdate,
} from '../lib/api.ts';
import type { KeyPosition, LayoutSummary, FingerLabel } from '@typsy/shared';
import { COL_TO_FINGER } from '@typsy/shared';
import KeyboardVisual from '../components/KeyboardVisual.tsx';

function defaultFingering(positions: KeyPosition[]): Record<string, FingerLabel> {
  const m: Record<string, FingerLabel> = {};
  for (const p of positions) m[p.char] = COL_TO_FINGER[p.col] ?? 'right_pinky';
  return m;
}

export default function LayoutsPage() {
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<number | null>(null);

  const { data: summaries, isLoading } = useQuery({
    queryKey: ['layouts', 'summary'],
    queryFn: fetchLayoutSummary,
  });

  function refreshAll() {
    void queryClient.invalidateQueries({ queryKey: ['layouts', 'summary'] });
    void queryClient.invalidateQueries({ queryKey: ['user'] });
  }

  const setActive = useMutation({
    mutationFn: postActiveLayout,
    onMutate: (vars) => setPendingId(vars.layout_id),
    onSettled: () => setPendingId(null),
    onSuccess: refreshAll,
  });

  const onboard = useMutation({
    mutationFn: postOnboarding,
    onMutate: (vars) => setPendingId(vars.layout_id),
    onSettled: () => setPendingId(null),
    onSuccess: () => {
      refreshAll();
    },
  });

  const updateProgress = useMutation({
    mutationFn: postProgressUpdate,
    onMutate: (vars) => setPendingId(vars.layout_id),
    onSettled: () => setPendingId(null),
    onSuccess: refreshAll,
  });

  if (isLoading || !summaries) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-gray-400">
        Loading layouts…
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-4">
      <header>
        <h1 className="text-3xl font-bold text-white">Layouts</h1>
        <p className="text-gray-400 mt-1">
          Switch between layouts, mark a daily driver, or set up a new one.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {summaries.map((s) => (
          <LayoutCard
            key={s.layout.id}
            summary={s}
            isPending={pendingId === s.layout.id}
            onSetActive={() => setActive.mutate({ layout_id: s.layout.id })}
            onSetMain={(value) =>
              updateProgress.mutate({ layout_id: s.layout.id, is_main_layout: value })
            }
            onSetUp={() => {
              const positions: KeyPosition[] = JSON.parse(s.layout.key_positions_json);
              onboard.mutate({
                layout_id: s.layout.id,
                fingering_map_json: JSON.stringify(defaultFingering(positions)),
              });
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────

interface LayoutCardProps {
  summary: LayoutSummary;
  isPending: boolean;
  onSetActive: () => void;
  onSetMain: (value: boolean) => void;
  onSetUp: () => void;
}

function LayoutCard({ summary, isPending, onSetActive, onSetMain, onSetUp }: LayoutCardProps) {
  const positions: KeyPosition[] = JSON.parse(summary.layout.key_positions_json);
  const totalAlpha = positions.filter((p) => /^[a-z]$/.test(p.char)).length;

  const status = !summary.has_progress
    ? 'Not set up'
    : summary.is_main_layout
      ? 'Daily driver'
      : `Learning · ${summary.unlocked_keys_count}/${totalAlpha} keys`;

  return (
    <div
      className={[
        'bg-gray-900 rounded-xl p-5 flex flex-col gap-4 border-2 transition-colors',
        summary.is_active ? 'border-blue-500' : 'border-gray-800',
      ].join(' ')}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white">{summary.layout.name}</h2>
            {summary.is_active && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-600 text-crust">
                Active
              </span>
            )}
            {summary.is_main_layout && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-yellow-600 text-crust">
                Daily
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400 mt-1">{status}</p>
        </div>

        {/* Tiny stats column */}
        <div className="text-right text-xs text-gray-500 leading-tight">
          {summary.has_progress ? (
            <>
              <div>
                <span className="text-gray-300 font-mono tabular-nums">
                  {summary.last_wpm !== null ? Math.round(summary.last_wpm) : '—'}
                </span>{' '}
                WPM
              </div>
              <div>
                <span className="text-gray-300 font-mono tabular-nums">
                  {summary.total_chars.toLocaleString()}
                </span>{' '}
                chars
              </div>
              <div>
                <span className="text-gray-300 font-mono tabular-nums">
                  {summary.session_count}
                </span>{' '}
                sessions
              </div>
            </>
          ) : (
            <div>—</div>
          )}
        </div>
      </div>

      {/* Layout preview */}
      <div className="flex justify-center">
        <KeyboardVisual positions={positions} />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mt-1">
        {!summary.has_progress ? (
          <button
            type="button"
            onClick={onSetUp}
            disabled={isPending}
            className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-crust font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            {isPending ? 'Setting up…' : 'Set up'}
          </button>
        ) : (
          <>
            {!summary.is_active && (
              <button
                type="button"
                onClick={onSetActive}
                disabled={isPending}
                className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-crust font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                {isPending ? 'Switching…' : 'Switch to'}
              </button>
            )}
            <button
              type="button"
              onClick={() => onSetMain(!summary.is_main_layout)}
              disabled={isPending}
              aria-pressed={summary.is_main_layout}
              className={[
                'px-3 py-1.5 text-sm rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
                summary.is_main_layout
                  ? 'border-yellow-600 text-yellow-300 bg-yellow-900/30 hover:bg-yellow-900/50'
                  : 'border-gray-700 text-gray-300 hover:border-gray-500',
              ].join(' ')}
            >
              {summary.is_main_layout ? 'Mark as learning' : 'Mark as daily driver'}
            </button>
          </>
        )}
      </div>

      {/* Help text */}
      {!summary.has_progress && (
        <p className="text-xs text-gray-500 -mt-1">
          Set up uses default touch-typing finger assignments. Tweak per-key in onboarding.
        </p>
      )}
    </div>
  );
}
