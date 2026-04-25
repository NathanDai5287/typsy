import type { FingerLabel } from '@typsy/shared';

/** Tailwind background classes per finger (shared across the app). */
export const FINGER_BG: Record<FingerLabel, string> = {
  left_pinky:   'bg-purple-700',
  left_ring:    'bg-blue-700',
  left_middle:  'bg-cyan-700',
  left_index:   'bg-green-700',
  left_thumb:   'bg-yellow-700',
  right_thumb:  'bg-yellow-600',
  right_index:  'bg-green-600',
  right_middle: 'bg-cyan-600',
  right_ring:   'bg-blue-600',
  right_pinky:  'bg-purple-600',
};

/** Inline hex colors per finger (for SVG/heatmap fills). */
export const FINGER_HEX: Record<FingerLabel, string> = {
  left_pinky:   '#7e22ce',
  left_ring:    '#1d4ed8',
  left_middle:  '#0e7490',
  left_index:   '#15803d',
  left_thumb:   '#a16207',
  right_thumb:  '#ca8a04',
  right_index:  '#16a34a',
  right_middle: '#0891b2',
  right_ring:   '#2563eb',
  right_pinky:  '#9333ea',
};

export const FINGER_LABELS: FingerLabel[] = [
  'left_pinky', 'left_ring', 'left_middle', 'left_index', 'left_thumb',
  'right_thumb', 'right_index', 'right_middle', 'right_ring', 'right_pinky',
];
