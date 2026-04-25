import type { FingerLabel, KeyPosition } from '@typsy/shared';
import { posKey } from '@typsy/shared';
import { FINGER_BG } from '../lib/finger-colors.ts';

export interface KeyboardVisualProps {
  positions: readonly KeyPosition[];
  /** Set of unlocked chars; locked keys render dimmed. Optional — when omitted, every key is treated as unlocked. */
  unlocked?: ReadonlySet<string>;
  /** Char that is expected next; gets a bright outline. */
  nextChar?: string | null;
  /**
   * Layout-independent fingering map keyed by physical position
   * (`posKey(pos)` → `"row,col"`). Falls back to the position's column
   * default (`KeyPosition.finger`).
   */
  posFingerMap?: Record<string, FingerLabel>;
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
  /** Compact rendering — used in cards / previews. */
  compact?: boolean;
}

/**
 * 30-key alpha grid visualization.
 *
 * Renders each key as a sharp-cornered square in the active finger's color
 * with the layout char inside. Every variant (next-char ring, weakness
 * heatmap, muscle-memory fade) is drawn directly on the same grid so the
 * whole keyboard reads as a single cohesive HUD on every page.
 */
export default function KeyboardVisual({
  positions,
  unlocked,
  nextChar,
  posFingerMap,
  charHits,
  fadeStrength = 1.0,
  heat,
  compact = false,
}: KeyboardVisualProps): JSX.Element {
  const rows = [0, 1, 2].map((r) =>
    positions
      .filter((p) => p.row === r)
      .sort((a, b) => a.col - b.col),
  );

  const sizePx = compact ? 24 : 36;
  const gapPx = compact ? 2 : 4;
  const fontSize = compact ? 11 : 14;

  return (
    <div className="select-none" aria-hidden>
      {rows.map((row, ri) => (
        // Stagger each row a fraction of the key width to mimic the
        // physical staircase of a real ANSI keyboard.
        <div
          key={ri}
          className="flex"
          style={{
            gap: `${gapPx}px`,
            paddingLeft: ri === 1 ? `${sizePx * 0.35}px` : ri === 2 ? `${sizePx * 0.85}px` : 0,
            marginTop: ri === 0 ? 0 : `${gapPx}px`,
          }}
        >
          {row.map((pos) => {
            const isUnlocked = !unlocked || unlocked.has(pos.char);
            const isNext = nextChar === pos.char;
            const finger = posFingerMap?.[posKey(pos)] ?? pos.finger;
            const fingerBg = FINGER_BG[finger];
            const hits = charHits?.get(pos.char) ?? 0;
            // Muscle-memory fade: keys you've practiced a lot move
            // toward the canvas color so the visual "fades into the
            // background" without disappearing entirely.
            const fade = Math.min(1, hits / 500) * fadeStrength;
            const opacity = isUnlocked ? Math.max(0.3, 1 - 0.7 * fade) : 0.25;

            const heatPct = heat?.get(pos.char);
            const ringClass = isNext
              ? 'ring-1 ring-yellow-400'
              : '';

            return (
              <div
                key={`${pos.row}-${pos.col}`}
                className={[
                  'relative flex items-center justify-center font-mono font-medium',
                  'border border-bg4',
                  isUnlocked ? `${fingerBg} text-bg_h` : 'bg-bg0 text-fg4',
                  ringClass,
                ].join(' ')}
                style={{
                  width: `${sizePx}px`,
                  height: `${sizePx}px`,
                  fontSize: `${fontSize}px`,
                  opacity,
                }}
              >
                {pos.char}
                {heatPct !== undefined && heatPct > 0 && (
                  <span
                    className="absolute -top-[3px] -right-[3px] w-2 h-2 border border-bg_h"
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

/** Map an error rate 0..1 to a Gruvbox-tinted green→yellow→red color. */
function heatToColor(rate: number): string {
  const r = Math.max(0, Math.min(1, rate));
  // Walk through three Gruvbox accent stops:
  //   0.0  green  #a9b665
  //   0.5  yellow #d8a657
  //   1.0  red    #ea6962
  if (r < 0.5) return mix('#a9b665', '#d8a657', r * 2);
  return mix('#d8a657', '#ea6962', (r - 0.5) * 2);
}

function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const r = Math.round(ca.r + (cb.r - ca.r) * t);
  const g = Math.round(ca.g + (cb.g - ca.g) * t);
  const bl = Math.round(ca.b + (cb.b - ca.b) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
