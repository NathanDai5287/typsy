export interface PinnedBigramsBarProps {
  bigrams: readonly string[];
  onRemove: (bigram: string) => void;
  onOpen: () => void;
}

/**
 * Compact chip strip shown below the on-screen keyboard. Hidden entirely
 * when no bigrams are pinned — the Ctrl+B keymap still works either way.
 */
export default function PinnedBigramsBar({
  bigrams,
  onRemove,
  onOpen,
}: PinnedBigramsBarProps): JSX.Element | null {
  if (bigrams.length === 0) return null;

  return (
    <div className="mt-4 flex items-center gap-2 text-xs font-mono">
      <span className="text-fg4 uppercase tracking-widest text-[10px]">
        pinned bigrams
      </span>
      <div className="flex flex-wrap gap-1.5">
        {bigrams.map((bg) => (
          <span
            key={bg}
            className="inline-flex items-center gap-1 border border-yellow-400/60 bg-yellow-400/10 text-yellow-400 px-1.5 py-0.5"
          >
            {bg}
            <button
              type="button"
              onClick={() => onRemove(bg)}
              title={`Unpin '${bg}'`}
              className="text-yellow-400/70 hover:text-yellow-400"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="text-fg4 hover:text-fg_h ml-1"
        title="Edit pinned bigrams (Ctrl+B)"
      >
        <kbd className="kbd">Ctrl+B</kbd>
      </button>
    </div>
  );
}
