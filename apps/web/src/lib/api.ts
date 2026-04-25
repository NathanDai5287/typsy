import type {
  UserResponse,
  Layout,
  LayoutSummary,
  OnboardingPayload,
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

const BASE = '/api';

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
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
