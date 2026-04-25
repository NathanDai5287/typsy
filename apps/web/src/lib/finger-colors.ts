import type { FingerLabel } from '@typsy/shared';

/**
 * Tailwind background classes per finger (shared across the app).
 *
 * The two hands are colored with sister accents from the Catppuccin Mocha
 * palette so left/right pairs feel related but are still distinguishable:
 *   pinky:  mauve   ↔ pink
 *   ring:   blue    ↔ lavender
 *   middle: sapphire↔ sky
 *   index:  green   ↔ teal
 *   thumb:  yellow  ↔ peach
 *
 * Each class resolves to a single Catppuccin color via the shade overrides
 * defined in `tailwind.config.js`.
 */
export const FINGER_BG: Record<FingerLabel, string> = {
  left_pinky:   'bg-purple-700', // mauve
  left_ring:    'bg-blue-700',   // blue
  left_middle:  'bg-cyan-700',   // sapphire
  left_index:   'bg-green-700',  // green
  left_thumb:   'bg-yellow-300', // yellow
  right_thumb:  'bg-yellow-700', // peach
  right_index:  'bg-green-300',  // teal
  right_middle: 'bg-cyan-500',   // sky
  right_ring:   'bg-blue-300',   // lavender
  right_pinky:  'bg-pink-500',   // pink
};

/** Inline hex colors per finger (for SVG/heatmap fills). Catppuccin Mocha. */
export const FINGER_HEX: Record<FingerLabel, string> = {
  left_pinky:   '#cba6f7', // mauve
  left_ring:    '#89b4fa', // blue
  left_middle:  '#74c7ec', // sapphire
  left_index:   '#a6e3a1', // green
  left_thumb:   '#f9e2af', // yellow
  right_thumb:  '#fab387', // peach
  right_index:  '#94e2d5', // teal
  right_middle: '#89dceb', // sky
  right_ring:   '#b4befe', // lavender
  right_pinky:  '#f5c2e7', // pink
};

export const FINGER_LABELS: FingerLabel[] = [
  'left_pinky', 'left_ring', 'left_middle', 'left_index', 'left_thumb',
  'right_thumb', 'right_index', 'right_middle', 'right_ring', 'right_pinky',
];
