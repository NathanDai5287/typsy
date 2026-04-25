import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchLayouts, fetchUser, postProgressUpdate } from '../lib/api.ts';
import type { FingerLabel, KeyPosition, Layout } from '@typsy/shared';
import FingeringEditor, { buildDefaultFingeringMap } from '../components/FingeringEditor.tsx';

/**
 * /fingering — edit which finger maps to which key for any onboarded layout.
 * The active layout is selected by default; users with multiple layouts can
 * pick any of them from the picker at the top.
 */
export default function FingeringPage() {
  const queryClient = useQueryClient();

  const { data: userData } = useQuery({ queryKey: ['user'], queryFn: fetchUser });
  const { data: layouts } = useQuery({ queryKey: ['layouts'], queryFn: fetchLayouts });

  const layoutsById = useMemo<Map<number, Layout>>(
    () => new Map((layouts ?? []).map((l) => [l.id, l])),
    [layouts],
  );

  const onboardedProgress = userData?.layout_progress ?? [];

  // Default to the active layout (server returns it as layout_progress[0]).
  const [selectedLayoutId, setSelectedLayoutId] = useState<number | null>(null);
  useEffect(() => {
    if (selectedLayoutId === null && onboardedProgress.length > 0) {
      setSelectedLayoutId(onboardedProgress[0].layout_id);
    }
  }, [onboardedProgress, selectedLayoutId]);

  const selectedProgress = onboardedProgress.find((p) => p.layout_id === selectedLayoutId);
  const selectedLayout = selectedLayoutId !== null ? layoutsById.get(selectedLayoutId) : undefined;

  const positions = useMemo<KeyPosition[]>(
    () => (selectedLayout ? JSON.parse(selectedLayout.key_positions_json) : []),
    [selectedLayout],
  );

  const initialMap = useMemo<Record<string, FingerLabel>>(() => {
    if (!selectedProgress) return {};
    try {
      return JSON.parse(selectedProgress.fingering_map_json) as Record<string, FingerLabel>;
    } catch {
      return {};
    }
  }, [selectedProgress?.fingering_map_json]);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: postProgressUpdate,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user'] });
      setStatusMessage('Fingering saved.');
    },
    onError: (err) => {
      setStatusMessage(`Could not save: ${err instanceof Error ? err.message : 'unknown error'}`);
    },
  });

  // Clear the status message when the user switches layouts.
  useEffect(() => {
    setStatusMessage(null);
  }, [selectedLayoutId]);

  if (!userData || !layouts) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-gray-400">
        Loading…
      </div>
    );
  }

  if (onboardedProgress.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12 text-gray-400">
        Set up a layout first on the <a href="/layouts" className="text-blue-400 underline">Layouts</a> page.
      </div>
    );
  }

  function handleSave(fingerMap: Record<string, FingerLabel>) {
    if (selectedLayoutId === null) return;
    saveMutation.mutate({
      layout_id: selectedLayoutId,
      fingering_map_json: JSON.stringify(fingerMap),
    });
  }

  function handleResetToDefault() {
    if (selectedLayoutId === null || !selectedLayout) return;
    const positions = JSON.parse(selectedLayout.key_positions_json) as KeyPosition[];
    const defaults = buildDefaultFingeringMap(positions);
    saveMutation.mutate({
      layout_id: selectedLayoutId,
      fingering_map_json: JSON.stringify(defaults),
    });
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Fingering</h1>
        <p className="text-gray-400 mt-1">
          Override the default column-based finger assignments for any of your layouts.
          Saved fingerings are used everywhere — keyboard visualization, per-finger stats,
          and SFB detection.
        </p>
      </header>

      {/* Layout picker */}
      {onboardedProgress.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {onboardedProgress.map((p) => {
            const layout = layoutsById.get(p.layout_id);
            if (!layout) return null;
            const isSelected = p.layout_id === selectedLayoutId;
            return (
              <button
                key={p.layout_id}
                type="button"
                onClick={() => setSelectedLayoutId(p.layout_id)}
                aria-pressed={isSelected}
                className={[
                  'px-4 py-1.5 text-sm rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
                  isSelected
                    ? 'border-blue-500 bg-blue-600 text-crust font-medium'
                    : 'border-gray-700 text-gray-300 hover:border-gray-500',
                ].join(' ')}
              >
                {layout.name}
              </button>
            );
          })}
        </div>
      )}

      {selectedLayout && (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-white">{selectedLayout.name}</h2>
            <button
              type="button"
              onClick={handleResetToDefault}
              disabled={saveMutation.isPending}
              className="text-xs text-gray-400 hover:text-gray-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded px-1"
            >
              Reset saved fingering to default
            </button>
          </div>

          <FingeringEditor
            // Re-mount the editor when the layout changes so its internal state resets cleanly.
            key={selectedLayoutId}
            positions={positions}
            initialMap={initialMap}
            onSave={handleSave}
            isSaving={saveMutation.isPending}
            saveLabel="Save fingering"
            savingLabel="Saving…"
          />

          {statusMessage && (
            <p
              className={[
                'text-sm',
                saveMutation.isError ? 'text-red-400' : 'text-green-400',
              ].join(' ')}
            >
              {statusMessage}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
