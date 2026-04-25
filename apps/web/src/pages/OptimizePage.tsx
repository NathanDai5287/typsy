import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchUser,
  fetchLayouts,
  fetchSessions,
  fetchNgramStats,
  postCreateLayout,
  postOnboarding,
  postActiveLayout,
} from '../lib/api.ts';
import {
  anneal,
  bestSingleSwap,
  buildErrorHeatmap,
  indexNgramStats,
  totalCharsTyped,
  OPTIMIZER_MIN_CHARS,
  type AnnealResult,
} from '@typsy/shared';
import type { FingerLabel, KeyPosition } from '@typsy/shared';
import KeyboardVisual from '../components/KeyboardVisual.tsx';

type Suggestion = AnnealResult & {
  /** Source we ran the search from (the layout positions before any swap). */
  basePositions: KeyPosition[];
  /** Algorithm used. */
  algorithm: 'single-swap' | 'annealing';
};

export default function OptimizePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: userData } = useQuery({ queryKey: ['user'], queryFn: fetchUser });
  const { data: layouts } = useQuery({ queryKey: ['layouts'], queryFn: fetchLayouts });

  const activeProgress = userData?.layout_progress[0];
  const layoutId = activeProgress?.layout_id;
  const activeLayout = layouts?.find((l) => l.id === layoutId);

  const { data: sessions } = useQuery({
    queryKey: ['sessions', layoutId],
    queryFn: () => fetchSessions(layoutId!),
    enabled: !!layoutId,
  });

  const { data: ngramRows } = useQuery({
    queryKey: ['ngramStats', layoutId],
    queryFn: () => fetchNgramStats(layoutId!),
    enabled: !!layoutId,
  });

  const positions = useMemo<KeyPosition[]>(
    () => (activeLayout ? JSON.parse(activeLayout.key_positions_json) : []),
    [activeLayout],
  );

  const posFingerMap = useMemo<Record<string, FingerLabel> | undefined>(() => {
    if (!userData) return;
    try {
      return JSON.parse(userData.user.fingering_map_json) as Record<string, FingerLabel>;
    } catch {
      return undefined;
    }
  }, [userData?.user.fingering_map_json]);

  const totalChars = useMemo(() => totalCharsTyped(sessions ?? []), [sessions]);
  const ready = totalChars >= OPTIMIZER_MIN_CHARS;
  const heatmap = useMemo(() => buildErrorHeatmap(ngramRows ?? []), [ngramRows]);

  function runOptimizer(algorithm: 'single-swap' | 'annealing') {
    if (!positions.length) return;
    setIsRunning(true);
    setError(null);
    setSuggestion(null);

    // Run inside a microtask so the spinner can render before the (~1s) compute.
    setTimeout(() => {
      try {
        const userIndex = indexNgramStats(ngramRows ?? []);
        const result =
          algorithm === 'single-swap'
            ? bestSingleSwap({ positions, userIndex, posFingerMap })
            : anneal({ positions, userIndex, posFingerMap, iterations: 1500 });
        setSuggestion({
          ...result,
          basePositions: positions.slice(),
          algorithm,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Optimization failed');
      } finally {
        setIsRunning(false);
      }
    }, 30);
  }

  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!suggestion || !activeLayout || !activeProgress) {
        throw new Error('No suggestion to accept');
      }
      const baseName = activeLayout.name.replace(/ \+\d+$/, '');
      // Generate a unique-ish name including swap labels.
      const swapLabel = suggestion.swaps.map((s) => `${s.charA}↔${s.charB}`).join('_');
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const name = `${baseName} (${swapLabel || 'opt'} · ${stamp})`;

      const layout = await postCreateLayout({
        name,
        key_positions_json: JSON.stringify(suggestion.bestPositions),
      });
      // No per-layout fingering payload — the user's fingering is keyed by
      // physical position and lives on `users`, so it carries over to the
      // new layout automatically.
      await postOnboarding({ layout_id: layout.id });
      await postActiveLayout({ layout_id: layout.id });
      return layout;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user'] });
      void queryClient.invalidateQueries({ queryKey: ['layouts'] });
      void queryClient.invalidateQueries({ queryKey: ['layouts', 'summary'] });
      navigate('/');
    },
  });

  const reject = () => {
    setSuggestion(null);
    setError(null);
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  if (!userData || !layouts) {
    return <div className="flex h-[60vh] items-center justify-center text-gray-400">Loading…</div>;
  }
  if (!activeProgress || !activeLayout) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-gray-400">
        Onboard a layout first.
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Optimize</h1>
        <p className="text-gray-400 mt-1">
          Find a single swap that lowers the layout cost based on your typing data.
        </p>
      </header>

      {/* Threshold gate */}
      <section className="bg-gray-900 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm uppercase tracking-wider text-gray-400">Data threshold</div>
            <div className="font-mono text-2xl text-white tabular-nums mt-1">
              {totalChars.toLocaleString()} / {OPTIMIZER_MIN_CHARS.toLocaleString()} chars
            </div>
          </div>
          <span
            className={[
              'px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-full',
              ready ? 'bg-green-700 text-crust' : 'bg-gray-700 text-gray-300',
            ].join(' ')}
          >
            {ready ? 'Ready' : 'Practice more first'}
          </span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
          <div
            className={[
              'h-full rounded-full transition-all',
              ready ? 'bg-green-500' : 'bg-blue-500',
            ].join(' ')}
            style={{
              width: `${Math.min(100, (totalChars / OPTIMIZER_MIN_CHARS) * 100).toFixed(2)}%`,
            }}
          />
        </div>
      </section>

      {/* Run buttons */}
      <section className="flex flex-wrap gap-3 items-center">
        <button
          type="button"
          disabled={!ready || isRunning}
          onClick={() => runOptimizer('single-swap')}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-crust font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          {isRunning ? 'Searching…' : 'Suggest one swap'}
        </button>
        <button
          type="button"
          disabled={!ready || isRunning}
          onClick={() => runOptimizer('annealing')}
          className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-200 hover:border-gray-500 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          {isRunning ? 'Searching…' : 'Run full annealing'}
        </button>
        {!ready && (
          <p className="text-xs text-gray-500">
            Optimizer is gated until you've typed at least{' '}
            {OPTIMIZER_MIN_CHARS.toLocaleString()} chars on the active layout.
          </p>
        )}
      </section>

      {error && (
        <div className="bg-red-900/40 border border-red-600 rounded-lg px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Suggestion */}
      {suggestion && (
        <SuggestionPanel
          suggestion={suggestion}
          posFingerMap={posFingerMap}
          heatmap={heatmap}
          onAccept={() => acceptMutation.mutate()}
          onReject={reject}
          isAccepting={acceptMutation.isPending}
        />
      )}
    </div>
  );
}

// ─── Suggestion panel ─────────────────────────────────────────────────────

interface SuggestionPanelProps {
  suggestion: Suggestion;
  posFingerMap?: Record<string, FingerLabel>;
  heatmap: ReadonlyMap<string, number>;
  onAccept: () => void;
  onReject: () => void;
  isAccepting: boolean;
}

function SuggestionPanel({
  suggestion,
  posFingerMap,
  heatmap,
  onAccept,
  onReject,
  isAccepting,
}: SuggestionPanelProps) {
  const noChange = suggestion.swaps.length === 0;

  return (
    <section className="bg-gray-900 rounded-xl p-5 space-y-5">
      <header className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white">
            {noChange ? 'No improving swaps found' : 'Suggested swap'}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {suggestion.algorithm === 'single-swap'
              ? 'Best single pairwise swap (full search).'
              : 'Best layout from simulated annealing (~1500 iterations).'}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-gray-500">Improvement</div>
          <div className="text-2xl font-mono font-bold text-green-400 tabular-nums">
            {(suggestion.improvement * 100).toFixed(1)}%
          </div>
        </div>
      </header>

      {!noChange && (
        <ul className="flex flex-wrap gap-2 text-sm">
          {suggestion.swaps.map((s) => (
            <li
              key={`${s.charA}-${s.charB}`}
              className="px-3 py-1 rounded-full bg-gray-800 font-mono text-gray-200"
            >
              {s.charA} ↔ {s.charB}
            </li>
          ))}
        </ul>
      )}

      {/* Before / after heatmaps side-by-side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-950 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Before</div>
          <div className="text-xs text-gray-400 mb-3 font-mono tabular-nums">
            cost {suggestion.originalCost.total.toFixed(4)}
          </div>
          <KeyboardVisual
            positions={suggestion.basePositions}
            posFingerMap={posFingerMap}
            heat={heatmap}
          />
        </div>
        <div className="bg-gray-950 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">After</div>
          <div className="text-xs text-gray-400 mb-3 font-mono tabular-nums">
            cost {suggestion.bestCost.total.toFixed(4)}
          </div>
          <KeyboardVisual
            positions={suggestion.bestPositions}
            posFingerMap={posFingerMap}
            heat={heatmap}
          />
        </div>
      </div>

      {!noChange && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={onAccept}
            disabled={isAccepting}
            className="px-4 py-2 text-sm rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 text-crust font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            {isAccepting ? 'Applying…' : 'Apply (creates a new custom layout & switches)'}
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={isAccepting}
            className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            Reject
          </button>
        </div>
      )}
    </section>
  );
}


