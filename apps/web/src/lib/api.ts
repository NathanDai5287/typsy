import type {
  UserResponse,
  Layout,
  LayoutSummary,
  OnboardingPayload,
  InitialSetupPayload,
  ProgressUpdatePayload,
  UserFingeringPayload,
  SessionPayload,
  Session,
  NgramBatchPayload,
  NgramStat,
  User,
  UserLayoutProgress,
  SetActiveLayoutPayload,
} from '@typsy/shared';
import { getCurrentIdToken } from './auth.tsx';

// Single-origin (default) → '/api' resolves against whatever host served the
// SPA. Split-deploy (e.g. frontend on Vercel, backend on typsy.cal.taxi) sets
// VITE_API_BASE_URL='https://typsy.cal.taxi/api' at build time. We strip a
// trailing slash so callers can be lazy with their env values.
const BASE = (import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') as string | undefined) ?? '/api';

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string> | undefined) ?? {}),
  };

  // Attach a fresh Firebase ID token if the user is signed in. In
  // BYPASS_AUTH dev mode (server reads userId from TYPSY_DATA_MODE env),
  // getCurrentIdToken() returns null and we send the request without an
  // Authorization header — the server's bypass branch handles it.
  const token = await getCurrentIdToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ''}`);
  }
  return res.json() as Promise<T>;
}

export function fetchUser(): Promise<UserResponse> {
  return request<UserResponse>('/user');
}

export function fetchLayouts(): Promise<Layout[]> {
  return request<Layout[]>('/layouts');
}

export function fetchLayoutSummary(): Promise<LayoutSummary[]> {
  return request<LayoutSummary[]>('/layouts/summary');
}

export function postCreateLayout(payload: {
  name: string;
  key_positions_json: string;
}): Promise<Layout> {
  return request<Layout>('/layouts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteLayout(id: number): Promise<{ ok: boolean }> {
  return request(`/layouts/${id}`, { method: 'DELETE' });
}

export function postOnboarding(payload: OnboardingPayload): Promise<UserResponse> {
  return request<UserResponse>('/user/onboarding', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * First-run setup: declares the user's daily-driver layout and (optionally)
 * the layout they'd like to learn next. Atomic on the server — both progress
 * rows and the active-layout pointer are written in a single transaction.
 */
export function postInitialSetup(payload: InitialSetupPayload): Promise<UserResponse> {
  return request<UserResponse>('/user/initial-setup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function postProgressUpdate(
  payload: ProgressUpdatePayload,
): Promise<UserLayoutProgress> {
  return request<UserLayoutProgress>('/user/progress', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Replace the user's layout-independent fingering map. The body is keyed by
 * physical position (`"row,col"`), so the same map applies to every layout.
 */
export function postUserFingering(payload: UserFingeringPayload): Promise<User> {
  return request<User>('/user/fingering', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function postActiveLayout(
  payload: SetActiveLayoutPayload,
): Promise<{ ok: boolean; active_layout_id: number }> {
  return request('/user/active-layout', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function postSession(payload: SessionPayload): Promise<Session> {
  return request<Session>('/sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchSessions(layoutId: number, limit = 200): Promise<Session[]> {
  return request<Session[]>(`/sessions?layout_id=${layoutId}&limit=${limit}`);
}

export function postNgramBatch(payload: NgramBatchPayload): Promise<void> {
  return request<void>('/ngrams/batch', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchNgramStats(
  layoutId: number,
  type?: NgramStat['ngram_type'],
): Promise<NgramStat[]> {
  const url = type
    ? `/ngrams/stats?layout_id=${layoutId}&type=${type}`
    : `/ngrams/stats?layout_id=${layoutId}`;
  return request<NgramStat[]>(url);
}
