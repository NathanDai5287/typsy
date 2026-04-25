import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchUser,
  fetchLayouts,
  fetchSessions,
  fetchNgramStats,
} from '../lib/api.ts';
import {
  buildErrorHeatmap,
  buildFingerMap,
  dayStreak,
  perFingerStats,
  sessionsAsSeries,
  sfbRate,
  topWeakNgrams,
  totalCharsTyped,
} from '@typsy/shared';
import type { FingerLabel, KeyPosition } from '@typsy/shared';
import KeyboardVisual from '../components/KeyboardVisual.tsx';
import { FINGER_HEX } from '../lib/finger-colors.ts';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// ─── Subcomponents ───────────────────────────────────────────────────────

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="bg-gray-900 rounded-xl p-4 flex flex-col">
      <span className="text-xs uppercase tracking-wider text-gray-500">{label}</span>
      <span className="text-3xl font-mono font-bold text-white mt-1 tabular-nums">{value}</span>
      {hint && <span className="text-xs text-gray-500 mt-1">{hint}</span>}
    </div>
  );
}

function PanelHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3">{children}</h2>;
}

// ─── Main page ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: userData } = useQuery({ queryKey: ['user'], queryFn: fetchUser });
  const { data: layouts } = useQuery({ queryKey: ['layouts'], queryFn: fetchLayouts });
  const activeProgress = userData?.layout_progress[0];
  const layoutId = activeProgress?.layout_id;
  const activeLayout = layouts?.find((l) => l.id === layoutId);

  const { data: sessions } = useQuery({
    queryKey: ['sessions', layoutId],
    queryFn: () => fetchSessions(layoutId!),
    enabled: !!layoutId,
  });

  const { data: ngramRows } = useQuery({
    queryKey: ['ngramStats', layoutId],
    queryFn: () => fetchNgramStats(layoutId!),
    enabled: !!layoutId,
  });

  const positions = useMemo<KeyPosition[]>(
    () => (activeLayout ? JSON.parse(activeLayout.key_positions_json) : []),
    [activeLayout],
  );

  const fingerOverrides = useMemo<Record<string, FingerLabel> | undefined>(() => {
    if (!activeProgress) return;
    try {
      return JSON.parse(activeProgress.fingering_map_json) as Record<string, FingerLabel>;
    } catch {
      return undefined;
    }
  }, [activeProgress?.fingering_map_json]);

  const fingerMap = useMemo(
    () => buildFingerMap(positions, fingerOverrides),
    [positions, fingerOverrides],
  );

  const series = useMemo(() => sessionsAsSeries(sessions ?? []), [sessions]);
  const fingerAgg = useMemo(
    () => perFingerStats(ngramRows ?? [], fingerMap),
    [ngramRows, fingerMap],
  );
  const sfb = useMemo(() => sfbRate(ngramRows ?? [], fingerMap), [ngramRows, fingerMap]);
  const heatmap = useMemo(() => buildErrorHeatmap(ngramRows ?? []), [ngramRows]);
  const topChars = useMemo(
    () => topWeakNgrams(ngramRows ?? [], 'char2', 10),
    [ngramRows],
  );
  const topWords = useMemo(
    () => topWeakNgrams(ngramRows ?? [], 'word1', 10),
    [ngramRows],
  );

  const streak = useMemo(() => dayStreak(sessions ?? []), [sessions]);
  const totalChars = useMemo(() => totalCharsTyped(sessions ?? []), [sessions]);
  const lastSession = sessions?.[0];

  // ─── Loading / empty states ──────────────────────────────────────────────
  if (!userData || !layouts) {
    return <div className="flex h-[60vh] items-center justify-center text-gray-400">Loading…</div>;
  }
  if (!activeProgress || !activeLayout) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-gray-400">
        Complete onboarding to see your dashboard.
      </div>
    );
  }

  const noData = (sessions?.length ?? 0) === 0;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-400 mt-1">
          {activeLayout.name} · {sessions?.length ?? 0} session
          {sessions?.length === 1 ? '' : 's'}
        </p>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total chars"
          value={totalChars.toLocaleString()}
          hint={lastSession ? `Last: ${formatRelative(lastSession.ended_at)}` : undefined}
        />
        <StatCard
          label="Streak"
          value={`${streak} ${streak === 1 ? 'day' : 'days'}`}
          hint={streak > 0 ? 'Keep it up!' : 'Practice today to start a streak'}
        />
        <StatCard
          label="Latest WPM"
          value={lastSession ? Math.round(lastSession.wpm) : '—'}
          hint={
            lastSession ? `${Math.round(lastSession.accuracy * 100)}% accuracy` : undefined
          }
        />
        <StatCard
          label="SFB rate"
          value={`${(sfb * 100).toFixed(2)}%`}
          hint="Same-finger bigrams across all typed text"
        />
      </div>

      {noData && (
        <div className="rounded-xl bg-gray-900 p-8 text-center text-gray-400">
          No sessions yet. Head to the practice page to get started.
        </div>
      )}

      {!noData && (
        <>
          {/* WPM trend charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <section className="bg-gray-900 rounded-xl p-5">
              <PanelHeading>WPM over time</PanelHeading>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={series} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="4 4" />
                  <XAxis
                    dataKey="endedAt"
                    tickFormatter={(t) => formatShortDate(t)}
                    stroke="#6b7280"
                    fontSize={11}
                  />
                  <YAxis stroke="#6b7280" fontSize={11} domain={[0, 'auto']} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #1f2937' }}
                    labelFormatter={(t) => formatLongDate(String(t))}
                    formatter={(v: number, k: string) =>
                      k === 'wpm' ? [v.toFixed(1), 'WPM'] : [v, k]
                    }
                  />
                  <Line type="monotone" dataKey="wpm" stroke="#60a5fa" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </section>

            <section className="bg-gray-900 rounded-xl p-5">
              <PanelHeading>WPM over volume</PanelHeading>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={series} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="4 4" />
                  <XAxis
                    dataKey="cumulativeChars"
                    type="number"
                    tickFormatter={(t) => `${(t / 1000).toFixed(0)}k`}
                    stroke="#6b7280"
                    fontSize={11}
                  />
                  <YAxis stroke="#6b7280" fontSize={11} domain={[0, 'auto']} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #1f2937' }}
                    labelFormatter={(t) => `${Number(t).toLocaleString()} chars`}
                    formatter={(v: number) => [v.toFixed(1), 'WPM']}
                  />
                  <Line type="monotone" dataKey="wpm" stroke="#34d399" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          </div>

          {/* Accuracy trend */}
          <section className="bg-gray-900 rounded-xl p-5">
            <PanelHeading>Accuracy trend</PanelHeading>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={series} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid stroke="#1f2937" strokeDasharray="4 4" />
                <XAxis
                  dataKey="endedAt"
                  tickFormatter={(t) => formatShortDate(t)}
                  stroke="#6b7280"
                  fontSize={11}
                />
                <YAxis
                  domain={[0.5, 1]}
                  tickFormatter={(t) => `${(t * 100).toFixed(0)}%`}
                  stroke="#6b7280"
                  fontSize={11}
                />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #1f2937' }}
                  labelFormatter={(t) => formatLongDate(String(t))}
                  formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, 'Accuracy']}
                />
                <Line
                  type="monotone"
                  dataKey="accuracy"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </section>
        </>
      )}

      {/* Per-finger WPM */}
      <section className="bg-gray-900 rounded-xl p-5">
        <PanelHeading>Per-finger WPM</PanelHeading>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={fingerAgg} margin={{ top: 5, right: 10, bottom: 30, left: 0 }}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="4 4" />
            <XAxis
              dataKey="finger"
              tickFormatter={(f: string) => f.replace(/^left_|^right_/, '').slice(0, 3)}
              stroke="#6b7280"
              fontSize={11}
              angle={-45}
              textAnchor="end"
              height={50}
            />
            <YAxis stroke="#6b7280" fontSize={11} />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #1f2937' }}
              formatter={(v: number, _k, p) => {
                const a = p?.payload?.accuracy as number | undefined;
                return [
                  `${v.toFixed(1)} WPM${a !== undefined ? ` · ${(a * 100).toFixed(0)}% acc` : ''}`,
                  String(p?.payload?.finger ?? '').replace(/_/g, ' '),
                ];
              }}
            />
            <Bar dataKey="wpm">
              {fingerAgg.map((f) => (
                <Cell key={f.finger} fill={FINGER_HEX[f.finger]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Layout heatmap */}
      <section className="bg-gray-900 rounded-xl p-5">
        <PanelHeading>Weakness heatmap</PanelHeading>
        <p className="text-xs text-gray-500 mb-3">
          Dot color shows error rate per key (green = clean, red = high error).
        </p>
        <KeyboardVisual
          positions={positions}
          fingerOverrides={fingerOverrides}
          heat={heatmap}
        />
      </section>

      {/* Top weak ngrams */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="bg-gray-900 rounded-xl p-5">
          <PanelHeading>Top 10 weak bigrams</PanelHeading>
          {topChars.length === 0 ? (
            <p className="text-gray-500 text-sm">Not enough data yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="py-2 font-normal">Bigram</th>
                  <th className="py-2 font-normal">Error rate</th>
                  <th className="py-2 font-normal text-right">Attempts</th>
                </tr>
              </thead>
              <tbody>
                {topChars.map((n) => (
                  <tr key={n.ngram} className="border-t border-gray-800">
                    <td className="py-2 font-mono text-white">{n.ngram}</td>
                    <td className="py-2 text-red-400 tabular-nums">
                      {(n.errorRate * 100).toFixed(1)}%
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-400">
                      {n.hits + n.misses}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="bg-gray-900 rounded-xl p-5">
          <PanelHeading>Top 10 weak words</PanelHeading>
          {topWords.length === 0 ? (
            <p className="text-gray-500 text-sm">Not enough data yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="py-2 font-normal">Word</th>
                  <th className="py-2 font-normal">Error rate</th>
                  <th className="py-2 font-normal text-right">Attempts</th>
                </tr>
              </thead>
              <tbody>
                {topWords.map((n) => (
                  <tr key={n.ngram} className="border-t border-gray-800">
                    <td className="py-2 font-mono text-white">{n.ngram}</td>
                    <td className="py-2 text-red-400 tabular-nums">
                      {(n.errorRate * 100).toFixed(1)}%
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-400">
                      {n.hits + n.misses}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* Session history */}
      <section className="bg-gray-900 rounded-xl p-5">
        <PanelHeading>Session history</PanelHeading>
        {sessions && sessions.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="py-2 font-normal">When</th>
                <th className="py-2 font-normal">Mode</th>
                <th className="py-2 font-normal text-right">WPM</th>
                <th className="py-2 font-normal text-right">Accuracy</th>
                <th className="py-2 font-normal text-right">Chars</th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 20).map((s) => (
                <tr key={s.id} className="border-t border-gray-800">
                  <td className="py-2 text-gray-300">{formatRelative(s.ended_at)}</td>
                  <td className="py-2 text-gray-400 capitalize">{s.mode}</td>
                  <td className="py-2 text-right text-white tabular-nums">{s.wpm.toFixed(1)}</td>
                  <td className="py-2 text-right text-gray-300 tabular-nums">
                    {(s.accuracy * 100).toFixed(0)}%
                  </td>
                  <td className="py-2 text-right text-gray-400 tabular-nums">{s.chars_typed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-500 text-sm">No sessions yet.</p>
        )}
      </section>
    </div>
  );
}

// ─── Date helpers ────────────────────────────────────────────────────────

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatLongDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}
