import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchLayouts, fetchUser, postUserFingering } from '../lib/api.ts';
import type { FingerLabel, KeyPosition, Layout, UserResponse } from '@typsy/shared';
import FingeringEditor, { buildDefaultPosFingerMap } from '../components/FingeringEditor.tsx';

/**
 * /fingering — edit the user's layout-independent finger assignments.
 *
 * The fingering map is keyed by physical position (`"row,col"`), so it
 * applies to every layout the user practices. The displayed keyboard is
 * just a visual reference — switching it doesn't change which finger is
 * assigned to a given physical key.
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

  // The keyboard is shown purely for visual reference. Default to the
  // active layout (server returns it as layout_progress[0]); user can
  // pick any onboarded layout to confirm the fingering looks right with
  // its character placement.
  const [displayLayoutId, setDisplayLayoutId] = useState<number | null>(null);
  useEffect(() => {
    if (displayLayoutId === null && onboardedProgress.length > 0) {
      setDisplayLayoutId(onboardedProgress[0].layout_id);
    }
  }, [onboardedProgress, displayLayoutId]);

  const displayLayout = displayLayoutId !== null ? layoutsById.get(displayLayoutId) : undefined;

  const positions = useMemo<KeyPosition[]>(
    () => (displayLayout ? JSON.parse(displayLayout.key_positions_json) : []),
    [displayLayout],
  );

  const initialMap = useMemo<Record<string, FingerLabel>>(() => {
    if (!userData) return {};
    try {
      return JSON.parse(userData.user.fingering_map_json) as Record<string, FingerLabel>;
    } catch {
      return {};
    }
  }, [userData?.user.fingering_map_json]);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: postUserFingering,
    onSuccess: (user) => {
      // Patch the cached user response so other pages see the new map
      // immediately, then invalidate to refetch the canonical version.
      queryClient.setQueryData<UserResponse | undefined>(['user'], (prev) =>
        prev ? { ...prev, user } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: ['user'] });
      setStatusMessage('Fingering saved.');
    },
    onError: (err) => {
      setStatusMessage(`Could not save: ${err instanceof Error ? err.message : 'unknown error'}`);
    },
  });

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

  function handleSave(posFingerMap: Record<string, FingerLabel>) {
    saveMutation.mutate({ fingering_map_json: JSON.stringify(posFingerMap) });
  }

  function handleResetToDefault() {
    if (positions.length === 0) return;
    const defaults = buildDefaultPosFingerMap(positions);
    saveMutation.mutate({ fingering_map_json: JSON.stringify(defaults) });
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Fingering</h1>
        <p className="text-gray-400 mt-1">
          Override the default column-based finger assignments for your physical keyboard.
          Saved fingerings are tied to physical key positions, so they apply to every layout
          you practice — used for keyboard visualization, per-finger stats, and SFB detection.
        </p>
      </header>

      {/* Layout picker — pure visual aid, doesn't change the fingering data */}
      {onboardedProgress.length > 1 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-gray-500">
            Show with characters from
          </p>
          <div className="flex flex-wrap gap-2">
            {onboardedProgress.map((p) => {
              const layout = layoutsById.get(p.layout_id);
              if (!layout) return null;
              const isSelected = p.layout_id === displayLayoutId;
              return (
                <button
                  key={p.layout_id}
                  type="button"
                  onClick={() => setDisplayLayoutId(p.layout_id)}
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
        </div>
      )}

      {displayLayout && (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-white">Your fingering</h2>
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
            // Re-mount when the user navigates to a different display
            // layout so the character labels redraw cleanly.
            key={displayLayoutId}
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
