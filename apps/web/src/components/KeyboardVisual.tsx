import { useState } from 'react';
import type { FingerLabel, KeyPosition, KeyStat } from '@typsy/shared';
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
  /** Optional per-key WPM + accuracy shown in a hover tooltip. */
  keyStats?: ReadonlyMap<string, KeyStat>;
  /** Compact rendering — used in cards / previews. */
  compact?: boolean;
  /**
   * Called when a key is clicked. When provided, every key gets a pointer
   * cursor + hover highlight so the keyboard reads as interactive. Used by
   * the practice page to let the user toggle individual keys' lock state.
   */
  onKeyClick?: (char: string) => void;
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
  keyStats,
  compact = false,
  onKeyClick,
}: KeyboardVisualProps): JSX.Element {
  const [hoveredChar, setHoveredChar] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const rows = [0, 1, 2].map((r) =>
    positions
      .filter((p) => p.row === r)
      .sort((a, b) => a.col - b.col),
  );

  const sizePx = compact ? 24 : 36;
  const gapPx = compact ? 2 : 4;
  const fontSize = compact ? 11 : 14;

  // Stretch the heat scale so the worst key always reaches at least the
  // "slightly red" threshold. With Bayesian smoothing the raw error rates
  // sit well below 0.5 even on shaky keys, so an unscaled gradient renders
  // every key near-green. When the worst key is already past the floor
  // (genuinely bad), no rescaling kicks in. See `scaleHeatForDisplay`.
  const heatScale = scaleHeatForDisplay(heat);

  const hoveredStat = hoveredChar ? keyStats?.get(hoveredChar) : undefined;

  return (
    <div
      className="select-none relative"
      aria-hidden={onKeyClick ? undefined : true}
      onMouseLeave={() => setHoveredChar(null)}
    >
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

            const heatRaw = heat?.get(pos.char);
            const heatPct =
              heatRaw !== undefined ? Math.min(1, heatRaw * heatScale) : undefined;
            const ringClass = isNext
              ? 'ring-1 ring-yellow-400'
              : '';

            // Physical-position cues (independent of the active layout):
            //   • Tactile bump under the home-row index keys (col 3 / col 6
            //     on row 1 — F and J on QWERTY).
            //   • Vertical gutter between the home index column and the
            //     inner-stretch column on each hand (cols 3↔4 and 5↔6).
            const isHomeIndex = pos.row === 1 && (pos.col === 3 || pos.col === 6);
            const needsLeftGutter = pos.col === 4 || pos.col === 6;
            const gutterPx = compact ? 6 : 10;

            const baseClass = [
              'relative flex items-center justify-center font-mono font-medium',
              'border border-bg4',
              isUnlocked ? `${fingerBg} text-bg_h` : 'bg-bg0 text-fg4',
              ringClass,
            ];
            const interactiveClass = onKeyClick
              ? [
                  'cursor-pointer transition-all duration-75',
                  'hover:scale-110 hover:border-yellow-400 hover:z-10 hover:shadow-md',
                  'focus-visible:outline-none focus-visible:scale-110 focus-visible:border-yellow-400',
                ]
              : [];
            const keyStyle = {
              width: `${sizePx}px`,
              height: `${sizePx}px`,
              fontSize: `${fontSize}px`,
              opacity,
              marginLeft: needsLeftGutter ? `${gutterPx}px` : undefined,
            };

            const hoverHandlers = keyStats
              ? {
                  onMouseEnter: (e: React.MouseEvent) => {
                    const rect = (e.currentTarget as HTMLElement)
                      .closest('.relative')
                      ?.getBoundingClientRect();
                    const keyRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setHoveredChar(pos.char);
                    setTooltipPos({
                      x: keyRect.left - (rect?.left ?? 0) + sizePx / 2,
                      y: keyRect.top - (rect?.top ?? 0) - 6,
                    });
                  },
                }
              : {};

            const inner = (
              <>
                {pos.char}
                {isHomeIndex && (
                  <span
                    className={[
                      'absolute left-1/2 -translate-x-1/2 bg-bg_h',
                      isUnlocked ? '' : 'opacity-60',
                    ].join(' ')}
                    style={{
                      bottom: '3px',
                      height: '2px',
                      width: `${Math.round(sizePx * 0.4)}px`,
                    }}
                  />
                )}
                {heatPct !== undefined && heatPct > 0 && (
                  <span
                    className="absolute -top-[3px] -right-[3px] w-2 h-2 border border-bg_h"
                    style={{ background: heatToColor(heatPct) }}
                  />
                )}
              </>
            );

            if (onKeyClick) {
              return (
                <button
                  key={`${pos.row}-${pos.col}`}
                  type="button"
                  className={[...baseClass, ...interactiveClass].join(' ')}
                  style={keyStyle}
                  onClick={() => onKeyClick(pos.char)}
                  title={isUnlocked ? `Lock '${pos.char}'` : `Unlock '${pos.char}'`}
                  aria-pressed={isUnlocked}
                  {...hoverHandlers}
                >
                  {inner}
                </button>
              );
            }

            return (
              <div
                key={`${pos.row}-${pos.col}`}
                className={baseClass.join(' ')}
                style={keyStyle}
                {...hoverHandlers}
              >
                {inner}
              </div>
            );
          })}
        </div>
      ))}

      {hoveredStat && hoveredChar && (
        <div
          className="pointer-events-none absolute z-20 rounded px-2.5 py-1.5 text-xs font-mono -translate-x-1/2 -translate-y-full"
          style={{
            left: tooltipPos.x,
            top: tooltipPos.y,
            background: '#161819',
            border: '1px solid #3c3836',
          }}
        >
          <span className="text-fg_h font-bold">{hoveredChar}</span>
          <span className="text-fg1 ml-2">{hoveredStat.wpm.toFixed(1)} wpm</span>
          <span className="text-fg3 ml-1.5">· {(hoveredStat.accuracy * 100).toFixed(0)}%</span>
        </div>
      )}
    </div>
  );
}

/**
 * Visual floor for the worst key on the green→yellow→red gradient.
 * 0.0 = green, 0.5 = yellow, 1.0 = red — so 0.6 is "yellow nudged toward
 * orange", reading as slightly red without overstating the problem.
 */
const MIN_WORST_DISPLAY = 0.6;

/**
 * Display-time multiplier applied to raw heat values so the worst key
 * always reaches at least `MIN_WORST_DISPLAY` on the green→red gradient
 * (~slightly red). When the worst key already sits above the floor
 * (genuinely high error rate), the multiplier is 1 and absolute scaling
 * takes over so a clear weak spot still renders deep red.
 *
 * Returns 1 when there's no heat data — callers should treat
 * `displayHeat = rate * scale` (clamped to [0, 1]) as the value to feed
 * into the gradient.
 */
export function scaleHeatForDisplay(
  heat: ReadonlyMap<string, number> | undefined,
  minWorstDisplay = MIN_WORST_DISPLAY,
): number {
  if (!heat || heat.size === 0) return 1;
  let max = 0;
  for (const v of heat.values()) {
    if (v > max) max = v;
  }
  if (max <= 0) return 1;
  return Math.max(1, minWorstDisplay / max);
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
