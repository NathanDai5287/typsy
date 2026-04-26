import { useMemo } from 'react';
import { Navigate } from 'react-router-dom';
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
  topSlowNgrams,
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

// ─── Gruvbox tokens for the Recharts SVGs ──────────────────────────────
const CHART = {
  grid:       '#3c3836', // bg4
  axis:       '#928374', // fg3
  tooltipBg:  '#161819', // bg0
  tooltipBd:  '#3c3836', // bg4
  wpmLine:    '#7daea3', // blue
  volumeLine: '#a9b665', // green
  accLine:    '#d8a657', // yellow
};
const TOOLTIP_STYLE = {
  background: CHART.tooltipBg,
  border: `1px solid ${CHART.tooltipBd}`,
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '12px',
};

// ─── Subcomponents ────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}): JSX.Element {
  return (
    <div className="panel p-3 flex flex-col">
      <span className="text-[10px] uppercase tracking-widest text-fg4">{label}</span>
      <span className="text-2xl font-mono font-bold text-fg_h mt-1 tabular-nums">{value}</span>
      {hint && <span className="text-[11px] text-fg4 mt-1">{hint}</span>}
    </div>
  );
}

function PanelHeading({ children }: { children: React.ReactNode }): JSX.Element {
  return <h2 className="panel-heading">{children}</h2>;
}

// ─── Main page ────────────────────────────────────────────────────────

export default function DashboardPage(): JSX.Element {
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

  const posFingerMap = useMemo<Record<string, FingerLabel> | undefined>(() => {
    if (!userData) return;
    try {
      return JSON.parse(userData.user.fingering_map_json) as Record<string, FingerLabel>;
    } catch {
      return undefined;
    }
  }, [userData?.user.fingering_map_json]);

  const fingerMap = useMemo(
    () => buildFingerMap(positions, posFingerMap),
    [positions, posFingerMap],
  );

  const series = useMemo(() => sessionsAsSeries(sessions ?? []), [sessions]);
  const fingerAgg = useMemo(
    () =>
      perFingerStats(ngramRows ?? [], fingerMap).filter(
        (f) => f.finger !== 'left_thumb' && f.finger !== 'right_thumb',
      ),
    [ngramRows, fingerMap],
  );
  const sfb = useMemo(() => sfbRate(ngramRows ?? [], fingerMap), [ngramRows, fingerMap]);
  const heatmap = useMemo(() => buildErrorHeatmap(ngramRows ?? []), [ngramRows]);
  const topChars = useMemo(
    () => topWeakNgrams(ngramRows ?? [], 'char2', 10),
    [ngramRows],
  );
  const slowChars = useMemo(
    () => topSlowNgrams(ngramRows ?? [], 'char2', 10),
    [ngramRows],
  );
  const topWords = useMemo(
    () => topWeakNgrams(ngramRows ?? [], 'word1', 10),
    [ngramRows],
  );

  const streak = useMemo(() => dayStreak(sessions ?? []), [sessions]);
  const totalChars = useMemo(() => totalCharsTyped(sessions ?? []), [sessions]);
  const lastSession = sessions?.[0];

  if (!userData || !layouts) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-fg3">loading…</div>
    );
  }
  if (!activeProgress || !activeLayout) {
    return <Navigate to="/onboarding" replace />;
  }

  const noData = (sessions?.length ?? 0) === 0;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <header>
        <h1 className="text-xl text-fg_h">dashboard</h1>
        <p className="text-fg3 text-sm mt-0.5">
          {activeLayout.name} · {sessions?.length ?? 0} session
          {sessions?.length === 1 ? '' : 's'}
        </p>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="total chars"
          value={totalChars.toLocaleString()}
          hint={lastSession ? `last: ${formatRelative(lastSession.ended_at)}` : undefined}
        />
        <StatCard
          label="streak"
          value={`${streak} ${streak === 1 ? 'day' : 'days'}`}
          hint={streak > 0 ? 'keep it up' : 'practice today to start'}
        />
        <StatCard
          label="latest wpm"
          value={lastSession ? Math.round(lastSession.wpm) : '—'}
          hint={lastSession ? `${Math.round(lastSession.accuracy * 100)}% acc` : undefined}
        />
        <StatCard
          label="sfb rate"
          value={`${(sfb * 100).toFixed(2)}%`}
          hint="same-finger bigrams"
        />
      </div>

      {noData && (
        <div className="panel p-6 text-center text-fg3 text-sm">
          No sessions yet. Head to Practice to get started.
        </div>
      )}

      {!noData && (
        <>
          {/* WPM trend charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <section className="panel p-4">
              <PanelHeading>wpm over time</PanelHeading>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={series} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                  <XAxis
                    dataKey="endedAt"
                    tickFormatter={(t) => formatShortDate(t)}
                    stroke={CHART.axis}
                    fontSize={10}
                  />
                  <YAxis stroke={CHART.axis} fontSize={10} domain={[0, 'auto']} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelFormatter={(t) => formatLongDate(String(t))}
                    formatter={(v: number, k: string) =>
                      k === 'wpm' ? [v.toFixed(1), 'WPM'] : [v, k]
                    }
                  />
                  <Line type="linear" dataKey="wpm" stroke={CHART.wpmLine} strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </section>

            <section className="panel p-4">
              <PanelHeading>wpm over volume</PanelHeading>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={series} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                  <XAxis
                    dataKey="cumulativeChars"
                    type="number"
                    tickFormatter={(t) => `${(t / 1000).toFixed(0)}k`}
                    stroke={CHART.axis}
                    fontSize={10}
                  />
                  <YAxis stroke={CHART.axis} fontSize={10} domain={[0, 'auto']} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelFormatter={(t) => `${Number(t).toLocaleString()} chars`}
                    formatter={(v: number) => [v.toFixed(1), 'WPM']}
                  />
                  <Line type="linear" dataKey="wpm" stroke={CHART.volumeLine} strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          </div>

          {/* Accuracy trend */}
          <section className="panel p-4">
            <PanelHeading>accuracy trend</PanelHeading>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={series} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                <XAxis
                  dataKey="endedAt"
                  tickFormatter={(t) => formatShortDate(t)}
                  stroke={CHART.axis}
                  fontSize={10}
                />
                <YAxis
                  domain={[0.5, 1]}
                  tickFormatter={(t) => `${(t * 100).toFixed(0)}%`}
                  stroke={CHART.axis}
                  fontSize={10}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(t) => formatLongDate(String(t))}
                  formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, 'Accuracy']}
                />
                <Line
                  type="linear"
                  dataKey="accuracy"
                  stroke={CHART.accLine}
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </section>
        </>
      )}

      {/* Per-finger WPM */}
      <section className="panel p-4">
        <PanelHeading>per-finger wpm</PanelHeading>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={fingerAgg} margin={{ top: 5, right: 10, bottom: 30, left: 0 }}>
            <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
            <XAxis
              dataKey="finger"
              tickFormatter={(f: string) => f.replace(/^left_|^right_/, '').slice(0, 3)}
              stroke={CHART.axis}
              fontSize={10}
              angle={-45}
              textAnchor="end"
              height={50}
            />
            <YAxis stroke={CHART.axis} fontSize={10} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
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
      <section className="panel p-4">
        <PanelHeading>weakness heatmap</PanelHeading>
        <p className="text-[11px] text-fg4 mb-3">
          dot color is each key's smoothed error rate, scaled so your worst
          key always shows some red (deep red when it's clearly an outlier)
        </p>
        <KeyboardVisual
          positions={positions}
          posFingerMap={posFingerMap}
          heat={heatmap}
        />
      </section>

      {/* Top weak / slow ngrams */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <NgramTable
          title="top 10 weak bigrams"
          rows={topChars.map((n) => [n.ngram, `${(n.errorRate * 100).toFixed(1)}%`, n.hits + n.misses])}
          headers={['bigram', 'err', 'attempts']}
          accentClass="text-red-400"
        />
        <NgramTable
          title="top 10 slow bigrams"
          rows={slowChars.map((n) => [n.ngram, n.wpm.toFixed(1), n.hits + n.misses])}
          headers={['bigram', 'wpm', 'attempts']}
          accentClass="text-orange-400"
        />
        <NgramTable
          title="top 10 weak words"
          rows={topWords.map((n) => [n.ngram, `${(n.errorRate * 100).toFixed(1)}%`, n.hits + n.misses])}
          headers={['word', 'err', 'attempts']}
          accentClass="text-red-400"
        />
      </div>

      {/* Session history */}
      <section className="panel p-4">
        <PanelHeading>session history</PanelHeading>
        {sessions && sessions.length > 0 ? (
          <table className="w-full text-sm font-mono">
            <thead className="text-left text-fg4 text-[10px] uppercase tracking-widest">
              <tr>
                <th className="py-1 font-normal">when</th>
                <th className="py-1 font-normal">mode</th>
                <th className="py-1 font-normal text-right">wpm</th>
                <th className="py-1 font-normal text-right">acc</th>
                <th className="py-1 font-normal text-right">chars</th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 20).map((s) => (
                <tr key={s.id} className="border-t border-bg4">
                  <td className="py-1 text-fg2">{formatRelative(s.ended_at)}</td>
                  <td className="py-1 text-fg3">{s.mode}</td>
                  <td className="py-1 text-right text-fg_h tabular-nums">{s.wpm.toFixed(1)}</td>
                  <td className="py-1 text-right text-fg2 tabular-nums">
                    {(s.accuracy * 100).toFixed(0)}%
                  </td>
                  <td className="py-1 text-right text-fg3 tabular-nums">{s.chars_typed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-fg4 text-sm">No sessions yet.</p>
        )}
      </section>
    </div>
  );
}

// ─── ngram table helper ───────────────────────────────────────────────

function NgramTable({
  title,
  headers,
  rows,
  accentClass,
}: {
  title: string;
  headers: readonly [string, string, string];
  rows: readonly (readonly [string, string, number])[];
  accentClass: string;
}): JSX.Element {
  return (
    <section className="panel p-4">
      <PanelHeading>{title}</PanelHeading>
      {rows.length === 0 ? (
        <p className="text-fg4 text-sm">Not enough data yet.</p>
      ) : (
        <table className="w-full text-sm font-mono">
          <thead className="text-left text-fg4 text-[10px] uppercase tracking-widest">
            <tr>
              <th className="py-1 font-normal">{headers[0]}</th>
              <th className="py-1 font-normal">{headers[1]}</th>
              <th className="py-1 font-normal text-right">{headers[2]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v, attempts]) => (
              <tr key={k} className="border-t border-bg4">
                <td className="py-1 text-fg_h">{k}</td>
                <td className={`py-1 tabular-nums ${accentClass}`}>{v}</td>
                <td className="py-1 text-right tabular-nums text-fg3">{attempts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ─── Date helpers ─────────────────────────────────────────────────────

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
