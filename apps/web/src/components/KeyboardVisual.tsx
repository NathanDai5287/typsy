import type { FingerLabel, KeyPosition } from '@typsy/shared';
import { FINGER_BG } from '../lib/finger-colors.ts';

export interface KeyboardVisualProps {
  positions: readonly KeyPosition[];
  /** Set of unlocked chars; locked keys render greyed out. Optional — when omitted, every key is treated as unlocked. */
  unlocked?: ReadonlySet<string>;
  /** Char that is expected next; gets a bright outline. */
  nextChar?: string | null;
  /** Optional fingering override (char → FingerLabel). Falls back to the position's `finger`. */
  fingerOverrides?: Record<string, FingerLabel>;
  /**
   * Per-character muscle-memory metric used to fade keys as they're learned.
   * Map char → number of correct attempts (we'll fade as this grows).
   */
  charHits?: ReadonlyMap<string, number>;
  /**
   * Strength of the muscle-memory fade effect (0 = never fade, 1 = aggressive fade).
   * Default 1.0; user can lower this in settings later.
   */
  fadeStrength?: number;
  /** Optional heatmap (char → 0..1 error rate) drawn as a colored ring. */
  heat?: ReadonlyMap<string, number>;
}

/**
 * 30-key alpha grid visualization. Used on the practice page (with `nextChar`
 * highlighted live) and as a static layout reference elsewhere.
 */
export default function KeyboardVisual({
  positions,
  unlocked,
  nextChar,
  fingerOverrides,
  charHits,
  fadeStrength = 1.0,
  heat,
}: KeyboardVisualProps) {
  const rows = [0, 1, 2].map((r) =>
    positions
      .filter((p) => p.row === r)
      .sort((a, b) => a.col - b.col),
  );

  return (
    <div className="space-y-1 select-none" aria-hidden>
      {rows.map((row, ri) => (
        // The home row (ri=1) is left-padded slightly so it visually sits between top and bottom.
        <div
          key={ri}
          className="flex gap-1"
          style={{ paddingLeft: ri === 1 ? '0.6rem' : ri === 2 ? '1.2rem' : 0 }}
        >
          {row.map((pos) => {
            const isUnlocked = !unlocked || unlocked.has(pos.char);
            const isNext = nextChar === pos.char;
            const finger = fingerOverrides?.[pos.char] ?? pos.finger;
            const bg = isUnlocked ? FINGER_BG[finger] : 'bg-gray-800';
            const hits = charHits?.get(pos.char) ?? 0;
            // Opacity drops from 1.0 at hits=0 to 0.35 at hits=500+ (linear, clamped).
            const fade = Math.min(1, hits / 500) * fadeStrength;
            const opacity = isUnlocked ? Math.max(0.35, 1 - 0.65 * fade) : 0.4;

            const heatPct = heat?.get(pos.char);
            const ring = isNext
              ? 'ring-2 ring-white scale-110'
              : heatPct !== undefined
                ? '' // we render the heat ring inline below
                : '';

            return (
              <div
                key={`${pos.row}-${pos.col}`}
                className={[
                  'relative w-9 h-9 rounded font-mono text-sm font-medium flex items-center justify-center text-white transition-all',
                  bg,
                  ring,
                ].join(' ')}
                style={{ opacity }}
              >
                {pos.char}
                {heatPct !== undefined && heatPct > 0 && (
                  <span
                    className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border border-gray-900"
                    style={{ background: heatToColor(heatPct) }}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Map an error rate 0..1 to a green→yellow→red color. */
function heatToColor(rate: number): string {
  // Hue 120 (green) at 0 → 60 (yellow) at 0.5 → 0 (red) at 1.0+
  const r = Math.max(0, Math.min(1, rate));
  const hue = 120 - 120 * r;
  return `hsl(${hue}, 70%, 50%)`;
}
