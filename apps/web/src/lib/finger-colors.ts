import type { FingerLabel } from '@typsy/shared';

/**
 * Tailwind background classes per finger (shared across the app).
 *
 * The two hands use sister tones from the Gruvbox Material palette so
 * left/right pairs feel related but are still distinguishable. We use a
 * desaturated/muted variant for one side and the brighter accent for the
 * other — all colors land naturally on the dark canvas.
 *
 *   pinky:  purple ↔ red
 *   ring:   blue   ↔ orange
 *   middle: aqua   ↔ yellow
 *   index:  green  ↔ green-bright
 *   thumb:  yellow ↔ orange
 *
 * Each class resolves to a single Gruvbox color via the shade overrides
 * defined in `tailwind.config.js`.
 */
export const FINGER_BG: Record<FingerLabel, string> = {
  left_pinky:   'bg-purple-500', // gruv purple
  left_ring:    'bg-blue-500',   // gruv blue
  left_middle:  'bg-cyan-500',   // gruv aqua
  left_index:   'bg-green-500',  // gruv green
  left_thumb:   'bg-yellow-500', // gruv yellow
  right_thumb:  'bg-orange-500', // gruv orange
  right_index:  'bg-green-300',  // gruv green-bright
  right_middle: 'bg-yellow-300', // gruv yellow-bright
  right_ring:   'bg-orange-300', // gruv orange-bright
  right_pinky:  'bg-red-500',    // gruv red
};

/** Inline hex colors per finger (for SVG/heatmap fills). Gruvbox Material. */
export const FINGER_HEX: Record<FingerLabel, string> = {
  left_pinky:   '#d3869b', // purple
  left_ring:    '#7daea3', // blue
  left_middle:  '#89b482', // aqua
  left_index:   '#a9b665', // green
  left_thumb:   '#d8a657', // yellow
  right_thumb:  '#e78a4e', // orange
  right_index:  '#b8bb26', // green-bright
  right_middle: '#fabd2f', // yellow-bright
  right_ring:   '#fe8019', // orange-bright
  right_pinky:  '#ea6962', // red
};

export const FINGER_LABELS: FingerLabel[] = [
  'left_pinky', 'left_ring', 'left_middle', 'left_index', 'left_thumb',
  'right_thumb', 'right_index', 'right_middle', 'right_ring', 'right_pinky',
];

/**
 * Display label for the finger picker UI. Short, monospace-friendly so
 * each line in the picker fits in a fixed-width column.
 */
export const FINGER_DISPLAY: Record<FingerLabel, string> = {
  left_pinky:   'L pinky',
  left_ring:    'L ring',
  left_middle:  'L middle',
  left_index:   'L index',
  left_thumb:   'L thumb',
  right_thumb:  'R thumb',
  right_index:  'R index',
  right_middle: 'R middle',
  right_ring:   'R ring',
  right_pinky:  'R pinky',
};
