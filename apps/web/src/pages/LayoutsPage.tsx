import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteLayout,
  fetchLayoutSummary,
  postActiveLayout,
  postOnboarding,
  postProgressUpdate,
} from '../lib/api.ts';
import type { KeyPosition, LayoutSummary } from '@typsy/shared';
import { SEEDED_LAYOUT_NAMES } from '@typsy/shared';
import KeyboardVisual from '../components/KeyboardVisual.tsx';
import { useRegisterPageKeymap } from '../lib/keymapContext.tsx';
import type { Keybinding } from '../lib/keymap.ts';

export default function LayoutsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());

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
    onSuccess: refreshAll,
  });

  const updateProgress = useMutation({
    mutationFn: postProgressUpdate,
    onMutate: (vars) => setPendingId(vars.layout_id),
    onSettled: () => setPendingId(null),
    onSuccess: refreshAll,
  });

  const remove = useMutation({
    mutationFn: (vars: { layout_id: number }) => deleteLayout(vars.layout_id),
    onMutate: (vars) => setPendingId(vars.layout_id),
    onSettled: () => {
      setPendingId(null);
      setConfirmingDeleteId(null);
    },
    onSuccess: refreshAll,
  });

  const items = summaries ?? [];
  const selected = items[selectedIndex];
  const stateRef = useRef({ items, selected, confirmingDeleteId });
  stateRef.current = { items, selected, confirmingDeleteId };

  // Scroll the focused card into view as the selection moves so the
  // keyboard-driven flow doesn't end up below the fold.
  useEffect(() => {
    if (!selected) return;
    const el = cardRefs.current.get(selected.layout.id);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, selected]);

  // ─── Keymap ───────────────────────────────────────────────────────
  const bindings = useMemo<Keybinding[]>(
    () => [
      {
        id: 'layouts.next',
        code: 'KeyJ',
        description: 'Next layout',
        handler: () =>
          setSelectedIndex((i) => Math.min(stateRef.current.items.length - 1, i + 1)),
      },
      {
        id: 'layouts.prev',
        code: 'KeyK',
        description: 'Previous layout',
        handler: () => setSelectedIndex((i) => Math.max(0, i - 1)),
      },
      {
        id: 'layouts.adown',
        code: 'ArrowDown',
        description: 'Next layout',
        handler: () =>
          setSelectedIndex((i) => Math.min(stateRef.current.items.length - 1, i + 1)),
      },
      {
        id: 'layouts.aup',
        code: 'ArrowUp',
        description: 'Previous layout',
        handler: () => setSelectedIndex((i) => Math.max(0, i - 1)),
      },
      {
        id: 'layouts.activate',
        code: 'Enter',
        description: 'Switch to / set up the highlighted layout',
        handler: () => {
          const s = stateRef.current.selected;
          if (!s) return;
          if (!s.has_progress) onboard.mutate({ layout_id: s.layout.id });
          else if (!s.is_active) setActive.mutate({ layout_id: s.layout.id });
        },
      },
      {
        id: 'layouts.toggle-main',
        code: 'KeyM',
        description: 'Toggle daily-driver flag',
        handler: () => {
          const s = stateRef.current.selected;
          if (!s || !s.has_progress) return;
          updateProgress.mutate({
            layout_id: s.layout.id,
            is_main_layout: !s.is_main_layout,
          });
        },
      },
      {
        id: 'layouts.delete',
        code: 'KeyX',
        description: 'Delete layout (custom layouts only)',
        handler: () => {
          const s = stateRef.current.selected;
          if (!s) return;
          if (SEEDED_LAYOUT_NAMES.has(s.layout.name)) return;
          if (stateRef.current.confirmingDeleteId === s.layout.id) {
            // Press again to confirm.
            remove.mutate({ layout_id: s.layout.id });
          } else {
            setConfirmingDeleteId(s.layout.id);
          }
        },
      },
      {
        id: 'layouts.cancel',
        code: 'Escape',
        description: 'Cancel delete confirmation',
        handler: () => setConfirmingDeleteId(null),
      },
    ],
    [onboard, setActive, updateProgress, remove],
  );
  useRegisterPageKeymap('Layouts', bindings, !isLoading && items.length > 0);

  if (isLoading || !summaries) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-fg3">
        loading layouts…
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <header>
        <h1 className="text-xl text-fg_h">layouts</h1>
        <p className="text-fg3 text-sm mt-0.5">
          <kbd className="kbd">j</kbd>/<kbd className="kbd">k</kbd> select ·{' '}
          <kbd className="kbd">Enter</kbd> switch / setup ·{' '}
          <kbd className="kbd">m</kbd> toggle daily ·{' '}
          <kbd className="kbd">x</kbd> delete (custom)
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {summaries.map((s, idx) => (
          <LayoutCard
            key={s.layout.id}
            ref={(el) => {
              cardRefs.current.set(s.layout.id, el);
            }}
            summary={s}
            isPending={pendingId === s.layout.id}
            isFocused={idx === selectedIndex}
            isConfirmingDelete={confirmingDeleteId === s.layout.id}
            onFocus={() => setSelectedIndex(idx)}
            onSetActive={() => setActive.mutate({ layout_id: s.layout.id })}
            onSetMain={(value) =>
              updateProgress.mutate({ layout_id: s.layout.id, is_main_layout: value })
            }
            onSetUp={() => onboard.mutate({ layout_id: s.layout.id })}
            onRequestDelete={() => setConfirmingDeleteId(s.layout.id)}
            onConfirmDelete={() => remove.mutate({ layout_id: s.layout.id })}
            onCancelDelete={() => setConfirmingDeleteId(null)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Card ──────────────────────────────────────────────────────────

interface LayoutCardProps {
  summary: LayoutSummary;
  isPending: boolean;
  isFocused: boolean;
  isConfirmingDelete: boolean;
  onFocus: () => void;
  onSetActive: () => void;
  onSetMain: (value: boolean) => void;
  onSetUp: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

const LayoutCard = forwardRef<HTMLDivElement, LayoutCardProps>(function LayoutCard(
  {
    summary,
    isPending,
    isFocused,
    isConfirmingDelete,
    onFocus,
    onSetActive,
    onSetMain,
    onSetUp,
    onRequestDelete,
    onConfirmDelete,
    onCancelDelete,
  },
  ref,
) {
  const positions: KeyPosition[] = JSON.parse(summary.layout.key_positions_json);
  const totalAlpha = positions.filter((p) => /^[a-z]$/.test(p.char)).length;
  const isSeeded = SEEDED_LAYOUT_NAMES.has(summary.layout.name);

  const status = !summary.has_progress
    ? 'not set up'
    : summary.is_main_layout
      ? 'daily driver'
      : `learning · ${summary.unlocked_keys_count}/${totalAlpha} keys`;

  return (
    <div
      ref={ref}
      onClick={onFocus}
      className={[
        'panel p-3 flex flex-col gap-3 cursor-pointer',
        isFocused ? 'border-yellow-400' : '',
        summary.is_active && !isFocused ? 'border-blue-400' : '',
      ].join(' ')}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-fg_h font-semibold">{summary.layout.name}</h2>
            {summary.is_active && <Tag color="blue">active</Tag>}
            {summary.is_main_layout && <Tag color="yellow">daily</Tag>}
          </div>
          <p className="text-xs text-fg3 mt-0.5">{status}</p>
        </div>

        <div className="text-right text-[11px] text-fg4 leading-tight tabular-nums">
          {summary.has_progress ? (
            <>
              <div>
                <span className="text-fg_h">
                  {summary.last_wpm !== null ? Math.round(summary.last_wpm) : '—'}
                </span>{' '}
                wpm
              </div>
              <div>
                <span className="text-fg_h">
                  {summary.total_chars.toLocaleString()}
                </span>{' '}
                chars
              </div>
              <div>
                <span className="text-fg_h">{summary.session_count}</span> sessions
              </div>
            </>
          ) : (
            <div>—</div>
          )}
        </div>
      </div>

      {/* Layout preview */}
      <div className="flex justify-center">
        <KeyboardVisual positions={positions} compact />
      </div>

      {/* Actions */}
      {isConfirmingDelete ? (
        <div className="border border-red-400 px-3 py-2 space-y-1.5">
          <p className="text-xs text-red-400">
            Delete <span className="font-semibold">{summary.layout.name}</span>?
            All sessions and ngram data on this layout will be erased.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCancelDelete();
              }}
              disabled={isPending}
              className="btn btn-ghost"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onConfirmDelete();
              }}
              disabled={isPending}
              className="btn btn-danger"
            >
              {isPending ? 'Deleting…' : 'Confirm delete'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 -mt-1">
          {!summary.has_progress ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSetUp();
              }}
              disabled={isPending}
              className="btn btn-primary"
            >
              {isPending ? 'Setting up…' : 'Set up'}
            </button>
          ) : (
            <>
              {!summary.is_active && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetActive();
                  }}
                  disabled={isPending}
                  className="btn btn-primary"
                >
                  {isPending ? 'Switching…' : 'Switch to'}
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSetMain(!summary.is_main_layout);
                }}
                disabled={isPending}
                aria-pressed={summary.is_main_layout}
                className={[
                  'btn',
                  summary.is_main_layout ? 'text-yellow-400 border-yellow-400' : '',
                ].join(' ')}
              >
                {summary.is_main_layout ? 'Mark as learning' : 'Mark daily driver'}
              </button>
            </>
          )}
          {!isSeeded && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRequestDelete();
              }}
              disabled={isPending}
              className="btn btn-danger ml-auto"
            >
              Delete
            </button>
          )}
        </div>
      )}

      {!summary.has_progress && (
        <p className="text-[11px] text-fg4 -mt-1">
          uses your existing fingering — tweak per-key on the Fingering page.
        </p>
      )}
    </div>
  );
});

function Tag({
  color,
  children,
}: {
  color: 'blue' | 'yellow';
  children: React.ReactNode;
}): JSX.Element {
  const cls =
    color === 'blue'
      ? 'border-blue-400 text-blue-400'
      : 'border-yellow-400 text-yellow-400';
  return (
    <span className={`text-[10px] uppercase tracking-widest px-1 border ${cls}`}>
      {children}
    </span>
  );
}
