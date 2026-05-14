import { useEffect, useRef, useState } from 'react';

export interface PinnedBigramsOverlayProps {
  open: boolean;
  bigrams: readonly string[];
  onAdd: (bigram: string) => void;
  onRemove: (bigram: string) => void;
  onClose: () => void;
}

/**
 * Modal overlay for managing pinned bigrams. Opened with Ctrl+B (handler
 * lives on the practice page). The input auto-commits as soon as the user
 * types two valid lowercase letters; backspace on an empty input removes
 * the most recently added chip. Esc or click-outside closes.
 */
export default function PinnedBigramsOverlay({
  open,
  bigrams,
  onAdd,
  onRemove,
  onClose,
}: PinnedBigramsOverlayProps): JSX.Element | null {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setDraft('');
      return;
    }
    inputRef.current?.focus();
  }, [open]);

  // Document-level Escape handler at capture phase — we need to swallow Esc
  // before the page's "end session" binding sees it, since both want the
  // same key. Same trick the typing handler in PracticePage uses.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = e.target.value.toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
    if (cleaned.length === 2) {
      if (!bigrams.includes(cleaned)) onAdd(cleaned);
      setDraft('');
    } else {
      setDraft(cleaned);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && draft.length === 0 && bigrams.length > 0) {
      e.preventDefault();
      onRemove(bigrams[bigrams.length - 1]);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pin bigrams"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-bg_h/85 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="panel w-full max-w-md mx-4">
        <div className="flex items-center justify-between border-b border-bg4 px-4 py-2">
          <span className="text-yellow-400 font-mono text-sm">── pin bigrams ──</span>
          <span className="text-fg4 text-xs">
            <kbd className="kbd">Esc</kbd> to close
          </span>
        </div>

        <div className="p-4 space-y-3">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="type 2 letters…"
            spellCheck={false}
            autoComplete="off"
            className="w-full bg-bg0 border border-bg4 text-fg_h font-mono px-3 py-2 text-sm focus:outline-none focus:border-yellow-400"
          />

          {bigrams.length === 0 ? (
            <p className="text-xs text-fg4 italic">
              no bigrams pinned · type a pair (e.g. "sh") to require it in
              every generated word
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {bigrams.map((bg) => (
                <span
                  key={bg}
                  className="inline-flex items-center gap-1 border border-yellow-400/60 bg-yellow-400/10 text-yellow-400 font-mono text-xs px-1.5 py-0.5"
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
          )}

          <p className="text-[10px] text-fg4 uppercase tracking-widest">
            words must contain ≥1 pinned bigram (or pinned key)
          </p>
        </div>
      </div>
    </div>
  );
}
