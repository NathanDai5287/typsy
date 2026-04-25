import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchUser,
  fetchLayouts,
  fetchNgramStats,
  postSession,
  postProgressUpdate,
} from '../lib/api.ts';
import { NgramTracker } from '../lib/ngramTracker.ts';
import {
  translateKeypress,
  buildPositionCharMap,
  CHARS_PER_WORD,
  generateDrillSequence,
  generateFlowLine,
  indexNgramStats,
  computeKeyHealth,
  shouldUnlockNextKey,
} from '@typsy/shared';
import type { KeyPosition, NgramStat, FingerLabel } from '@typsy/shared';
import KeyboardVisual from '../components/KeyboardVisual.tsx';

type Mode = 'drill' | 'flow';
type CharState = 'pending' | 'correct' | 'wrong';

interface CharData {
  char: string;
  state: CharState;
}

function initCharData(sentence: string): CharData[] {
  return sentence.split('').map((char) => ({ char, state: 'pending' }));
}

interface TypingToken {
  kind: 'word' | 'space';
  indices: number[];
}

/**
 * Group sentence chars into alternating word / whitespace runs. Word runs
 * are rendered as one `inline-block` so a word can never wrap mid-glyph.
 */
function tokenize(charData: readonly CharData[]): TypingToken[] {
  const out: TypingToken[] = [];
  for (let i = 0; i < charData.length; i++) {
    const isSpace = charData[i].char === ' ';
    const last = out[out.length - 1];
    const kind: TypingToken['kind'] = isSpace ? 'space' : 'word';
    if (last && last.kind === kind) {
      last.indices.push(i);
    } else {
      out.push({ kind, indices: [i] });
    }
  }
  return out;
}

function renderChar(
  cd: CharData,
  i: number,
  cursor: number,
  sessionComplete: boolean,
): JSX.Element {
  const cls = [
    i === cursor && !sessionComplete ? 'border-b-2 border-blue-400' : '',
    cd.state === 'correct' ? 'text-green-400' : '',
    cd.state === 'wrong' ? 'text-red-500' : '',
    cd.state === 'pending' ? 'text-gray-500' : '',
  ]
    .filter(Boolean)
    .join(' ');
  // For spaces: render literal space so the line can break here. The
  // cursor underline still appears under the (monospace-width) space.
  return (
    <span key={i} className={cls}>
      {cd.char === ' ' ? ' ' : cd.char}
    </span>
  );
}

/** Build the next sentence based on mode + unlocked + user weakness. */
function buildSentence(
  mode: Mode,
  unlocked: ReadonlySet<string>,
  ngramRows: readonly NgramStat[],
): string {
  if (unlocked.size === 0) {
    return 'finish onboarding to start practicing';
  }
  const userIndex = indexNgramStats(ngramRows);
  if (mode === 'drill') {
    return generateDrillSequence({
      allowed: unlocked,
      userIndex,
      length: 50,
    });
  }
  return generateFlowLine({
    allowed: unlocked,
    userIndex,
    numWords: 12,
  });
}

export default function PracticePage() {
  const queryClient = useQueryClient();

  const { data: userData } = useQuery({ queryKey: ['user'], queryFn: fetchUser });
  const { data: layouts } = useQuery({ queryKey: ['layouts'], queryFn: fetchLayouts });

  const activeProgress = userData?.layout_progress[0];
  const activeLayout = layouts?.find((l) => l.id === activeProgress?.layout_id);

  const { data: ngramRows } = useQuery<NgramStat[]>({
    queryKey: ['ngramStats', activeProgress?.layout_id],
    queryFn: () => fetchNgramStats(activeProgress!.layout_id),
    enabled: !!activeProgress,
    staleTime: 10_000,
  });

  const positions = useMemo<KeyPosition[]>(() => {
    if (!activeLayout) return [];
    return JSON.parse(activeLayout.key_positions_json);
  }, [activeLayout]);

  const positionMap = useMemo(() => buildPositionCharMap(positions), [positions]);

  const isMainLayout = activeProgress?.is_main_layout === 1;

  /**
   * Effective unlocked set: when the layout is marked main (the user's daily
   * driver), every alpha key is treated as unlocked and the progressive-
   * unlock logic is skipped. Otherwise we read `unlocked_keys_json` as set
   * during onboarding / earlier unlocks.
   */
  const unlockedSet = useMemo<Set<string>>(() => {
    if (!activeProgress) return new Set();
    if (isMainLayout) {
      return new Set(positions.filter((p) => /^[a-z]$/.test(p.char)).map((p) => p.char));
    }
    try {
      return new Set(JSON.parse(activeProgress.unlocked_keys_json) as string[]);
    } catch {
      return new Set();
    }
  }, [activeProgress, isMainLayout, positions]);

  const fingerOverrides = useMemo<Record<string, FingerLabel>>(() => {
    if (!activeProgress) return {};
    try {
      return JSON.parse(activeProgress.fingering_map_json) as Record<string, FingerLabel>;
    } catch {
      return {};
    }
  }, [activeProgress?.fingering_map_json]);

  /** Per-char muscle-memory hit count (drives keyboard fade). */
  const charHits = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const row of ngramRows ?? []) {
      if (row.ngram_type === 'char1') map.set(row.ngram, row.hits);
    }
    return map;
  }, [ngramRows]);

  // ─── Mode (persisted server-side) ────────────────────────────────────────
  const initialMode: Mode =
    activeProgress?.current_mode === 'drill' ? 'drill' : 'flow';
  const [mode, setMode] = useState<Mode>(initialMode);
  useEffect(() => {
    setMode(initialMode);
    // Re-syncs when server-side current_mode changes (e.g. multi-tab edit).
  }, [initialMode]);

  const updateProgress = useMutation({
    mutationFn: postProgressUpdate,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['user'] }),
  });

  function changeMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    if (activeProgress) {
      updateProgress.mutate({
        layout_id: activeProgress.layout_id,
        current_mode: next,
      });
    }
  }

  // ─── Session state ───────────────────────────────────────────────────────
  const [sentence, setSentence] = useState('');
  const [charData, setCharData] = useState<CharData[]>([]);
  const [cursor, setCursor] = useState(0);
  const [totalKeystrokes, setTotalKeystrokes] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [liveWpm, setLiveWpm] = useState(0);
  const [liveAccuracy, setLiveAccuracy] = useState(100);
  const [showKeyboard, setShowKeyboard] = useState(true);
  const [justUnlocked, setJustUnlocked] = useState<string | null>(null);

  const ngramTrackerRef = useRef<NgramTracker | null>(null);
  const lastKeypressTimeRef = useRef<number | null>(null);

  // Stable ref copies for the document-level keydown handler
  const cursorRef = useRef(cursor);
  const totalKeystrokesRef = useRef(totalKeystrokes);
  const startTimeRef = useRef(startTime);
  const isPausedRef = useRef(isPaused);
  const sessionCompleteRef = useRef(sessionComplete);
  const sentenceRef = useRef(sentence);
  cursorRef.current = cursor;
  totalKeystrokesRef.current = totalKeystrokes;
  startTimeRef.current = startTime;
  isPausedRef.current = isPaused;
  sessionCompleteRef.current = sessionComplete;
  sentenceRef.current = sentence;

  // ─── Reset session ───────────────────────────────────────────────────────
  const resetSession = useCallback(() => {
    if (!activeProgress || unlockedSet.size === 0 || (ngramRows == null)) {
      // Wait for data; the load effect will retry.
      return;
    }
    const s = buildSentence(mode, unlockedSet, ngramRows);
    setSentence(s);
    setCharData(initCharData(s));
    setCursor(0);
    setTotalKeystrokes(0);
    setStartTime(null);
    setIsPaused(false);
    setSessionComplete(false);
    setLiveWpm(0);
    setLiveAccuracy(100);
    lastKeypressTimeRef.current = null;

    ngramTrackerRef.current?.stop().catch(console.error);
    // Drill is practice-only: no n-gram tracking, no session row, no unlocks.
    // Skipping the tracker here makes `recordChar` calls a no-op via `?.`.
    if (mode === 'flow') {
      const tracker = new NgramTracker(1, activeProgress.layout_id);
      tracker.start();
      ngramTrackerRef.current = tracker;
    } else {
      ngramTrackerRef.current = null;
    }
  }, [activeProgress?.layout_id, mode, unlockedSet, ngramRows]);

  // Build the first sentence as soon as we have the data.
  useEffect(() => {
    if (!sentence && activeProgress && unlockedSet.size > 0 && ngramRows) {
      resetSession();
    }
  }, [activeProgress, unlockedSet.size, ngramRows, sentence, resetSession]);

  // Regenerate when mode changes (resetSession identity already includes mode).
  useEffect(() => {
    if (sentence) resetSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Cleanup tracker on unmount
  useEffect(() => {
    return () => {
      ngramTrackerRef.current?.stop().catch(console.error);
    };
  }, []);

  // ─── Session complete + unlock check ─────────────────────────────────────
  const completeSession = useCallback(
    async (finalCursor: number, finalKeystrokes: number, st: number, endTime: number) => {
      ngramTrackerRef.current?.finalizeWord();
      await ngramTrackerRef.current?.stop();

      const durationMs = endTime - st;
      const minutes = durationMs / 60_000;
      const wpm = minutes > 0 ? finalCursor / CHARS_PER_WORD / minutes : 0;
      const accuracy = finalKeystrokes > 0 ? finalCursor / finalKeystrokes : 1;
      const errors = finalKeystrokes - finalCursor;

      setLiveWpm(Math.round(wpm));
      setLiveAccuracy(Math.round(accuracy * 100));
      setSessionComplete(true);

      if (!activeProgress) return;
      // Drill is practice-only — show stats on screen but don't persist.
      if (mode === 'drill') return;

      try {
        await postSession({
          user_id: 1,
          layout_id: activeProgress.layout_id,
          started_at: new Date(st).toISOString(),
          ended_at: new Date(endTime).toISOString(),
          mode,
          wpm: Math.round(wpm * 10) / 10,
          accuracy: Math.round(accuracy * 1000) / 1000,
          chars_typed: finalCursor,
          errors,
          cumulative_chars_at_session_end: 0, // server computes this
        });

        // Progressive unlock check is only relevant for non-main layouts —
        // when the user has marked a layout as their daily driver, every
        // key is already unlocked.
        if (!isMainLayout) {
          const fresh = await queryClient.fetchQuery<NgramStat[]>({
            queryKey: ['ngramStats', activeProgress.layout_id],
            queryFn: () => fetchNgramStats(activeProgress.layout_id),
          });

          const idx = indexNgramStats(fresh);
          const unlockedArr = Array.from(unlockedSet);
          const health = computeKeyHealth(idx, unlockedArr);
          const next = shouldUnlockNextKey(health, unlockedArr, positions);
          if (next) {
            const nextUnlocked = [...unlockedArr, next].sort();
            await postProgressUpdate({
              layout_id: activeProgress.layout_id,
              unlocked_keys_json: JSON.stringify(nextUnlocked),
            });
            setJustUnlocked(next);
            void queryClient.invalidateQueries({ queryKey: ['user'] });
          }
        } else {
          // Still refresh ngram stats so the dashboard / next-sentence
          // generation see fresh data.
          void queryClient.invalidateQueries({
            queryKey: ['ngramStats', activeProgress.layout_id],
          });
        }

        // Invalidate session list for the dashboard.
        void queryClient.invalidateQueries({
          queryKey: ['sessions', activeProgress.layout_id],
        });
      } catch (err) {
        console.error('Failed to save session', err);
      }
    },
    [activeProgress, isMainLayout, mode, queryClient, unlockedSet, positions],
  );

  // ─── Keydown handler ─────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Skip when an input/textarea/select has focus.
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // After session: Enter advances to next sentence.
      if (sessionCompleteRef.current) {
        if (e.key === 'Enter') {
          e.preventDefault();
          setJustUnlocked(null);
          resetSession();
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        setIsPaused((p) => !p);
        return;
      }
      if (isPausedRef.current) return;

      // Ignore plain modifiers and tab.
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(e.key)) return;

      const logicalChar = translateKeypress(e, positionMap);
      if (logicalChar === null) return;

      e.preventDefault();

      const now = Date.now();
      const timeSinceLastMs = lastKeypressTimeRef.current
        ? now - lastKeypressTimeRef.current
        : 0;
      lastKeypressTimeRef.current = now;

      const currentCursor = cursorRef.current;
      const currentTotalKeystrokes = totalKeystrokesRef.current + 1;
      const expected = sentenceRef.current[currentCursor];
      const isCorrect = logicalChar === expected;

      setCharData((prev) =>
        prev.map((cd, i) =>
          i === currentCursor ? { ...cd, state: isCorrect ? 'correct' : 'wrong' } : cd,
        ),
      );
      setTotalKeystrokes(currentTotalKeystrokes);

      ngramTrackerRef.current?.recordChar(logicalChar, expected, timeSinceLastMs);

      let newCursor = currentCursor;
      let st = startTimeRef.current;
      if (st === null) {
        st = now;
        setStartTime(now);
      }

      if (isCorrect) {
        newCursor = currentCursor + 1;
        setCursor(newCursor);

        const minutes = (now - st) / 60_000;
        const wpm = minutes > 0 ? newCursor / CHARS_PER_WORD / minutes : 0;
        const accuracy = currentTotalKeystrokes > 0
          ? newCursor / currentTotalKeystrokes
          : 1;
        setLiveWpm(Math.round(wpm));
        setLiveAccuracy(Math.round(accuracy * 100));

        if (newCursor === sentenceRef.current.length) {
          void completeSession(newCursor, currentTotalKeystrokes, st, now);
        }
      }
    },
    [positionMap, completeSession, resetSession],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ─── Render ──────────────────────────────────────────────────────────────
  if (!activeLayout) {
    return (
      <div className="flex h-[80vh] items-center justify-center text-gray-400">
        Loading layout…
      </div>
    );
  }

  // What key is expected next? (skip if it's a space — no on-screen highlight needed.)
  const nextExpected = sentence[cursor];
  const nextChar = nextExpected && nextExpected !== ' ' ? nextExpected : null;

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] px-6 py-10 select-none">
      {/* Top bar */}
      <div className="w-full max-w-2xl flex justify-between items-center mb-6 text-sm">
        <div className="flex items-center gap-3">
          <span className="text-gray-500">{activeLayout.name}</span>
          <span className="text-gray-700">·</span>
          {isMainLayout ? (
            <span className="text-gray-500">Daily driver</span>
          ) : (
            <span className="text-gray-500">
              {unlockedSet.size}/{positions.filter((p) => /^[a-z]$/.test(p.char)).length} keys unlocked
            </span>
          )}
        </div>
        <div className="flex gap-6">
          <Stat label="WPM" value={liveWpm} />
          <Stat label="ACC" value={`${liveAccuracy}%`} />
        </div>
      </div>

      {/* Mode toggle */}
      <div
        role="tablist"
        aria-label="Practice mode"
        className="flex gap-1 mb-4 p-1 bg-gray-900 rounded-full"
      >
        {(['flow', 'drill'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() => changeMode(m)}
            className={[
              'px-4 py-1 rounded-full text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
              mode === m
                ? 'bg-blue-600 text-crust font-medium'
                : 'text-gray-400 hover:text-gray-200',
            ].join(' ')}
          >
            {m === 'flow' ? 'Flow' : 'Drill'}
          </button>
        ))}
      </div>

      {/* Just-unlocked banner */}
      {justUnlocked && !sessionComplete && (
        <div
          role="status"
          className="mb-4 px-4 py-2 bg-green-900/40 border border-green-600 rounded-lg text-green-300 text-sm"
        >
          New key unlocked: <span className="font-mono font-bold">{justUnlocked}</span>
        </div>
      )}

      {/* Typing area */}
      <div
        className="w-full max-w-2xl bg-gray-900 rounded-2xl p-8 relative"
        role="region"
        aria-label="Typing practice area"
      >
        {isPaused && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90 rounded-2xl z-10">
            <span className="text-gray-300 text-lg">Paused — press Esc to resume</span>
          </div>
        )}
        {sessionComplete && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/95 rounded-2xl z-10 gap-3">
            <div className="text-green-400 text-4xl font-bold font-mono">{liveWpm} WPM</div>
            <div className="text-gray-300 text-xl">{liveAccuracy}% accuracy</div>
            {justUnlocked && (
              <div className="text-yellow-300 text-sm">
                Unlocked <span className="font-mono font-bold">{justUnlocked}</span>!
              </div>
            )}
            <div className="text-gray-500 text-sm mt-4">Press Enter for the next round</div>
          </div>
        )}

        <div
          className="font-mono text-2xl leading-relaxed tracking-wide"
          aria-live="polite"
          aria-label="Text to type"
        >
          {charData.length === 0 ? (
            <span className="text-gray-500">Loading practice text…</span>
          ) : (
            // Group chars into word / whitespace tokens. Word tokens are
            // rendered as inline-block + whitespace-nowrap so a word never
            // wraps mid-glyph. Spaces stay as plain text inside their own
            // span so the line can break between words.
            tokenize(charData).map((tok, ti) =>
              tok.kind === 'word' ? (
                <span key={ti} className="inline-block whitespace-nowrap">
                  {tok.indices.map((i) => renderChar(charData[i], i, cursor, sessionComplete))}
                </span>
              ) : (
                // A whitespace token: render each space char as a plain inline span.
                // The space content is a literal space so the line can break here.
                tok.indices.map((i) => renderChar(charData[i], i, cursor, sessionComplete))
              ),
            )
          )}
        </div>
      </div>

      {/* On-screen keyboard */}
      {showKeyboard && (
        <div className="mt-8">
          <KeyboardVisual
            positions={positions}
            unlocked={unlockedSet}
            nextChar={nextChar}
            fingerOverrides={fingerOverrides}
            charHits={charHits}
          />
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-3 mt-6">
        <button
          type="button"
          onClick={() => setIsPaused((p) => !p)}
          className="px-4 py-2 text-sm text-gray-400 border border-gray-700 rounded-lg hover:border-gray-500 hover:text-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          aria-pressed={isPaused}
        >
          {isPaused ? 'Resume (Esc)' : 'Pause (Esc)'}
        </button>
        <button
          type="button"
          onClick={() => {
            setJustUnlocked(null);
            resetSession();
          }}
          className="px-4 py-2 text-sm text-gray-400 border border-gray-700 rounded-lg hover:border-gray-500 hover:text-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => setShowKeyboard((v) => !v)}
          aria-pressed={showKeyboard}
          className="px-4 py-2 text-sm text-gray-400 border border-gray-700 rounded-lg hover:border-gray-500 hover:text-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          {showKeyboard ? 'Hide keyboard' : 'Show keyboard'}
        </button>
      </div>

      <p className="mt-4 text-xs text-gray-600">
        Type the text above · Esc to pause · Enter to continue after each round
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-right">
      <div className="text-2xl font-mono font-bold text-white tabular-nums">{value}</div>
      <div className="text-xs text-gray-500 uppercase tracking-wider">{label}</div>
    </div>
  );
}
