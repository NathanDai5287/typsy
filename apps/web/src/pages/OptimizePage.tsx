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
import { useRegisterPageKeymap } from '../lib/keymapContext.tsx';
import type { Keybinding } from '../lib/keymap.ts';

type Suggestion = AnnealResult & {
  basePositions: KeyPosition[];
  algorithm: 'single-swap' | 'annealing';
};

export default function OptimizePage(): JSX.Element {
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
    if (!ready) return;
    setIsRunning(true);
    setError(null);
    setSuggestion(null);

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
      const swapLabel = suggestion.swaps.map((s) => `${s.charA}↔${s.charB}`).join('_');
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const name = `${baseName} (${swapLabel || 'opt'} · ${stamp})`;

      const layout = await postCreateLayout({
        name,
        key_positions_json: JSON.stringify(suggestion.bestPositions),
      });
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

  // ─── Keymap ───────────────────────────────────────────────────────
  // 1 = single swap, 2 = full annealing, Enter = accept current suggestion,
  // r = reject. Number keys are outside the typing alpha block, but the
  // optimize page never captures typing anyway.
  const bindings = useMemo<Keybinding[]>(
    () => [
      {
        id: 'opt.single',
        code: 'Digit1',
        description: 'Suggest one swap',
        handler: () => runOptimizer('single-swap'),
      },
      {
        id: 'opt.anneal',
        code: 'Digit2',
        description: 'Run full annealing',
        handler: () => runOptimizer('annealing'),
      },
      {
        id: 'opt.accept',
        code: 'Enter',
        description: 'Accept the current suggestion',
        handler: () => {
          if (suggestion && suggestion.swaps.length > 0 && !acceptMutation.isPending) {
            acceptMutation.mutate();
          }
        },
      },
      {
        id: 'opt.reject',
        code: 'KeyR',
        description: 'Reject the current suggestion',
        handler: reject,
      },
    ],
    [suggestion, acceptMutation, ready, ngramRows, positions, posFingerMap],
  );
  useRegisterPageKeymap('Optimize', bindings);

  if (!userData || !layouts) {
    return <div className="flex h-[60vh] items-center justify-center text-fg3">loading…</div>;
  }
  if (!activeProgress || !activeLayout) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-fg3">
        Onboard a layout first.
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <header>
        <h1 className="text-xl text-fg_h">optimize</h1>
        <p className="text-fg3 text-sm mt-0.5">
          Suggest a swap (or several) that lowers the layout cost based on
          your typing data. <kbd className="kbd">1</kbd> single ·{' '}
          <kbd className="kbd">2</kbd> anneal · <kbd className="kbd">Enter</kbd>{' '}
          accept · <kbd className="kbd">r</kbd> reject.
        </p>
      </header>

      {/* Threshold gate */}
      <section className="panel p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="panel-heading">data threshold</div>
            <div className="font-mono text-xl text-fg_h tabular-nums mt-1">
              {totalChars.toLocaleString()} / {OPTIMIZER_MIN_CHARS.toLocaleString()} chars
            </div>
          </div>
          <span
            className={[
              'text-[10px] uppercase tracking-widest px-1 border',
              ready
                ? 'border-green-400 text-green-400'
                : 'border-fg4 text-fg3',
            ].join(' ')}
          >
            {ready ? 'ready' : 'need more practice'}
          </span>
        </div>
        <div className="w-full bg-bg2 h-1 overflow-hidden">
          <div
            className={ready ? 'h-full bg-green-400' : 'h-full bg-yellow-400'}
            style={{
              width: `${Math.min(100, (totalChars / OPTIMIZER_MIN_CHARS) * 100).toFixed(2)}%`,
            }}
          />
        </div>
      </section>

      {/* Run buttons */}
      <section className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          disabled={!ready || isRunning}
          onClick={() => runOptimizer('single-swap')}
          className="btn btn-primary"
        >
          {isRunning ? 'searching…' : 'Suggest one swap'} <span className="text-fg4">1</span>
        </button>
        <button
          type="button"
          disabled={!ready || isRunning}
          onClick={() => runOptimizer('annealing')}
          className="btn"
        >
          {isRunning ? 'searching…' : 'Run full annealing'} <span className="text-fg4">2</span>
        </button>
        {!ready && (
          <p className="text-xs text-fg4">
            Optimizer is gated until you've typed at least{' '}
            {OPTIMIZER_MIN_CHARS.toLocaleString()} chars on the active layout.
          </p>
        )}
      </section>

      {error && (
        <div className="border border-red-400 px-4 py-2 text-sm text-red-400">{error}</div>
      )}

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
}: SuggestionPanelProps): JSX.Element {
  const noChange = suggestion.swaps.length === 0;

  return (
    <section className="panel p-4 space-y-4">
      <header className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-fg_h font-semibold">
            {noChange ? 'No improving swaps found' : 'Suggested swap'}
          </h2>
          <p className="text-xs text-fg3 mt-1">
            {suggestion.algorithm === 'single-swap'
              ? 'best single pairwise swap (full search)'
              : 'best layout from simulated annealing (~1500 iterations)'}
          </p>
        </div>
        <div className="text-right">
          <div className="panel-heading">improvement</div>
          <div className="text-xl font-mono font-bold text-green-400 tabular-nums">
            {(suggestion.improvement * 100).toFixed(1)}%
          </div>
        </div>
      </header>

      {!noChange && (
        <ul className="flex flex-wrap gap-2 text-sm font-mono">
          {suggestion.swaps.map((s) => (
            <li
              key={`${s.charA}-${s.charB}`}
              className="px-2 py-0.5 border border-bg4 text-fg_h"
            >
              {s.charA} ↔ {s.charB}
            </li>
          ))}
        </ul>
      )}

      {/* Before / after heatmaps side-by-side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-bg_h border border-bg4 p-3">
          <div className="panel-heading">before</div>
          <div className="text-xs text-fg3 mb-2 font-mono tabular-nums">
            cost {suggestion.originalCost.total.toFixed(4)}
          </div>
          <KeyboardVisual
            positions={suggestion.basePositions}
            posFingerMap={posFingerMap}
            heat={heatmap}
          />
        </div>
        <div className="bg-bg_h border border-bg4 p-3">
          <div className="panel-heading">after</div>
          <div className="text-xs text-fg3 mb-2 font-mono tabular-nums">
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
            className="btn btn-primary"
          >
            {isAccepting ? 'applying…' : 'Apply (creates new layout & switches)'}
            <span className="text-fg4">Enter</span>
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={isAccepting}
            className="btn"
          >
            Reject <span className="text-fg4">r</span>
          </button>
        </div>
      )}
    </section>
  );
}
