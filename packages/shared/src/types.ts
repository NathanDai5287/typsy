export type FingerLabel =
  | 'left_pinky'
  | 'left_ring'
  | 'left_middle'
  | 'left_index'
  | 'left_thumb'
  | 'right_thumb'
  | 'right_index'
  | 'right_middle'
  | 'right_ring'
  | 'right_pinky';

export interface KeyPosition {
  char: string;
  row: number;
  col: number;
  finger: FingerLabel;
}

export interface Layout {
  id: number;
  name: string;
  key_positions_json: string; // JSON string of KeyPosition[]
}

export interface User {
  id: number;
  created_at: string;
  settings_json: string;
}

export interface UserLayoutProgress {
  user_id: number;
  layout_id: number;
  unlocked_keys_json: string; // JSON string: string[]
  phase: number;
  fingering_map_json: string; // JSON string: Record<string, FingerLabel>
  current_mode: string;
  last_session_at: string | null;
  /** 1 = layout is the user's daily driver (skip progressive unlocking, all keys treated as unlocked). 0 = learning. */
  is_main_layout: number;
}

export interface Session {
  id?: number;
  user_id: number;
  layout_id: number;
  started_at: string;
  ended_at: string;
  mode: string;
  wpm: number;
  accuracy: number;
  chars_typed: number;
  errors: number;
  cumulative_chars_at_session_end: number;
}

export interface NgramStat {
  user_id: number;
  layout_id: number;
  ngram: string;
  ngram_type: 'char1' | 'char2' | 'char3' | 'word1' | 'word2';
  hits: number;
  misses: number;
  total_time_ms: number;
  last_seen_at: string;
}

export interface OnboardingPayload {
  layout_id: number;
  fingering_map_json: string; // JSON string: Record<string, FingerLabel>
}

export interface ProgressUpdatePayload {
  layout_id: number;
  unlocked_keys_json?: string; // JSON string: string[]
  current_mode?: string;       // 'drill' | 'flow'
  phase?: number;
  /** Pass true to mark this layout as the user's daily driver (all keys unlocked, no progression). */
  is_main_layout?: boolean;
}

export interface UserSettings {
  /** ID of the layout currently shown on /practice. Defaults to the first layout the user onboards. */
  active_layout_id?: number;
}

export interface SetActiveLayoutPayload {
  layout_id: number;
}

export interface LayoutSummary {
  layout: Layout;
  has_progress: boolean;
  is_main_layout: boolean;
  is_active: boolean;
  unlocked_keys_count: number;
  total_chars: number;
  session_count: number;
  last_wpm: number | null;
  last_session_at: string | null;
}

export type SessionPayload = Omit<Session, 'id'>;

export interface NgramBatchDelta {
  ngram: string;
  ngram_type: 'char1' | 'char2' | 'char3' | 'word1' | 'word2';
  hits_delta: number;
  misses_delta: number;
  time_delta_ms: number;
}

export interface NgramBatchPayload {
  layout_id: number;
  deltas: NgramBatchDelta[];
}

// API response shapes
export interface UserResponse {
  user: User;
  layout_progress: UserLayoutProgress[];
}
