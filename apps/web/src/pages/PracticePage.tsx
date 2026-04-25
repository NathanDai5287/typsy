import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
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

function renderChar(cd: CharData, i: number, cursor: number): JSX.Element {
  const cls = [
    i === cursor ? 'border-b-2 border-blue-400' : '',
    cd.state === 'correct' ? 'text-green-400' : '',
    cd.state === 'wrong' ? 'text-red-500' : '',
    cd.state === 'pending' ? 'text-gray-500' : '',
  ]
    .filter(Boolean)
    .join(' ');
  // For spaces: render literal space so the line can break here. The
  // cursor underline still appears under the (monospace-width) space.
  // The `data-cursor` attribute lets the scroll effect locate the cursor
  // glyph in the DOM without threading a per-char ref through every span.
  return (
    <span key={i} className={cls} data-cursor={i === cursor ? 'true' : undefined}>
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
    // Each appended chunk needs to comfortably outrun the visible window
    // (~3 lines × ~50 chars/line) so the user is never "caught up to the
    // generator" — `appendNextChunk` fires eagerly anyway, this just
    // keeps the prefetch budget a couple lines ahead.
    return generateDrillSequence({
      allowed: unlocked,
      userIndex,
      length: 100,
    });
  }
  return generateFlowLine({
    allowed: unlocked,
    userIndex,
    numWords: 20,
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
  // Practice is one indefinite stream — there is no "complete" or "paused"
  // state. The user types until they press Esc, which flushes data, posts a
  // session row (flow only), and resets back to a fresh stream. `lastSummary`
  // is the transient post-Esc toast.
  const [sentence, setSentence] = useState('');
  const [charData, setCharData] = useState<CharData[]>([]);
  const [cursor, setCursor] = useState(0);
  const [totalKeystrokes, setTotalKeystrokes] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [liveWpm, setLiveWpm] = useState(0);
  const [liveAccuracy, setLiveAccuracy] = useState(100);
  const [showKeyboard, setShowKeyboard] = useState(true);
  const [lastSummary, setLastSummary] = useState<{
    wpm: number;
    accuracy: number;
    mode: Mode;
    unlocked?: string;
  } | null>(null);

  const ngramTrackerRef = useRef<NgramTracker | null>(null);
  const lastKeypressTimeRef = useRef<number | null>(null);

  // Stable ref copies for the document-level keydown handler
  const cursorRef = useRef(cursor);
  const totalKeystrokesRef = useRef(totalKeystrokes);
  const startTimeRef = useRef(startTime);
  const sentenceRef = useRef(sentence);
  cursorRef.current = cursor;
  totalKeystrokesRef.current = totalKeystrokes;
  startTimeRef.current = startTime;
  sentenceRef.current = sentence;

  // ─── Monkeytype-style scrolling window ───────────────────────────────────
  // The visible typing area is fixed at 3 line-heights tall. As the user
  // types past line 0, we translate the inner text up so the cursor stays
  // on visible line 1 (middle of 3) — completed lines scroll off the top
  // and upcoming lines stream in at the bottom from `appendNextChunk`.
  // `streamKey` is bumped on every reset so the inner div remounts and the
  // transform snaps to 0 without animating from the previous offset.
  const innerRef = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(0);
  const [streamKey, setStreamKey] = useState(0);

  // ─── Reset session ───────────────────────────────────────────────────────
  const resetSession = useCallback(() => {
    if (!activeProgress || unlockedSet.size === 0 || (ngramRows == null)) {
      // Wait for data; the load effect will retry.
      return;
    }
    // Pre-fill the buffer with two chunks so the very first paint already
    // shows a multi-line preview ahead of the cursor. The handler's eager
    // appendNextChunk keeps it topped up after that.
    const s =
      buildSentence(mode, unlockedSet, ngramRows) +
      ' ' +
      buildSentence(mode, unlockedSet, ngramRows);
    setSentence(s);
    setCharData(initCharData(s));
    setCursor(0);
    setTotalKeystrokes(0);
    setStartTime(null);
    setLiveWpm(0);
    setLiveAccuracy(100);
    lastKeypressTimeRef.current = null;
    // Snap the scrolling window back to the top of the new buffer.
    // Bumping `streamKey` remounts the inner element so the transform
    // resets without an awkward "sweep down" animation from the
    // previous session's offset.
    setScrollY(0);
    setStreamKey((k) => k + 1);

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

  // ─── Track cursor's line position and scroll the inner content ───────────
  /**
   * After every cursor or buffer change, find the cursor span in the DOM,
   * compute its natural line index inside the inner content, and translate
   * the inner element so the cursor sits on visible line 1 (middle of the
   * 3-line window). Result: completed lines scroll smoothly off the top
   * while upcoming lines stream in below — Monkeytype-style.
   *
   * `getBoundingClientRect` is robust to the parent's existing transform
   * (the cursor and its parent are translated by the same amount, so the
   * delta is the natural offset).
   */
  useLayoutEffect(() => {
    const innerEl = innerRef.current;
    if (!innerEl) return;
    const cursorEl = innerEl.querySelector<HTMLElement>('[data-cursor="true"]');
    if (!cursorEl) return;

    const innerRect = innerEl.getBoundingClientRect();
    const cursorRect = cursorEl.getBoundingClientRect();
    const cursorTop = cursorRect.top - innerRect.top;

    // Resolve line-height in px. `getComputedStyle.lineHeight` returns
    // `'normal'` if the author left it unset — fall back to 1.5 × font-size
    // in that case so we still get a sensible scroll step.
    const lhStr = getComputedStyle(innerEl).lineHeight;
    let lineHeight = parseFloat(lhStr);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      lineHeight = parseFloat(getComputedStyle(innerEl).fontSize) * 1.5;
    }
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;

    const cursorLine = Math.round(cursorTop / lineHeight);
    // Keep the cursor on visible line 1 of 3 once past line 0. Lines 0
    // doesn't scroll; from line 1 onwards we scroll one line at a time so
    // the cursor word always has one finished line above it and one
    // upcoming line below it.
    const desiredScrollLine = Math.max(0, cursorLine - 1);
    const desired = desiredScrollLine * lineHeight;
    setScrollY((prev) => (Math.abs(prev - desired) < 0.5 ? prev : desired));
  }, [cursor, charData.length]);

  // ─── Append more content when the cursor runs out ────────────────────────
  /**
   * Practice is unlimited — when the cursor reaches the end of the visible
   * sentence we splice another generated chunk on so typing continues
   * without an explicit "round complete" step. The chunk is prefixed with
   * a single space so it cleanly joins onto whatever the user just typed.
   */
  const appendNextChunk = useCallback(() => {
    if (!ngramRows || unlockedSet.size === 0) return;
    const more = ' ' + buildSentence(mode, unlockedSet, ngramRows);
    setSentence((prev) => prev + more);
    setCharData((prev) => [...prev, ...initCharData(more)]);
  }, [mode, unlockedSet, ngramRows]);

  // ─── End session (flush + persist + reset) ───────────────────────────────
  /**
   * Triggered by Esc (or the End button). Snapshots the current stats,
   * flushes the ngram tracker, persists a session row + runs the unlock
   * check (flow only — drill is practice-only), shows a transient summary
   * toast, and resets the page back to a fresh stream so the user can
   * keep typing immediately. Sessions don't naturally complete; this is
   * the only path to commit data.
   */
  const endSession = useCallback(async () => {
    const finalCursor = cursorRef.current;
    const finalKeystrokes = totalKeystrokesRef.current;
    const st = startTimeRef.current;
    const localMode = mode;
    const tracker = ngramTrackerRef.current;

    // Nothing to commit if the user hasn't actually typed anything yet —
    // just regenerate the stream so Esc still feels like "give me a fresh
    // start".
    if (st === null || finalCursor === 0) {
      resetSession();
      return;
    }

    // Use the last keypress time (not the Esc time) so trailing idle
    // time between the last char and Esc doesn't artificially lower wpm.
    const lastKey = lastKeypressTimeRef.current;
    const now = Date.now();
    const endedAt = lastKey ?? now;
    const minutes = (endedAt - st) / 60_000;
    const wpm = minutes > 0 ? finalCursor / CHARS_PER_WORD / minutes : 0;
    const accuracy = finalKeystrokes > 0 ? finalCursor / finalKeystrokes : 1;
    const errors = finalKeystrokes - finalCursor;

    // Capture the trailing partial word and kick off the flush. We hold
    // onto the promise so the unlock check below can wait for the server
    // to see the latest deltas. We null the ref *before* resetSession so
    // its own (fire-and-forget) stop() doesn't double-flush the tracker
    // we're already managing.
    tracker?.finalizeWord();
    const flushPromise = tracker?.stop() ?? Promise.resolve();
    ngramTrackerRef.current = null;

    resetSession();
    setLastSummary({
      wpm: Math.round(wpm),
      accuracy: Math.round(accuracy * 100),
      mode: localMode,
    });

    // Drill is practice-only — no session row, no unlock check.
    if (localMode !== 'flow' || !activeProgress) return;

    try {
      await flushPromise;

      await postSession({
        user_id: 1,
        layout_id: activeProgress.layout_id,
        started_at: new Date(st).toISOString(),
        ended_at: new Date(endedAt).toISOString(),
        mode: localMode,
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
          // Fold the unlock notice into whichever toast is currently
          // showing. If the toast has already auto-cleared we drop it
          // rather than re-popping a surprise notification.
          setLastSummary((prev) => (prev ? { ...prev, unlocked: next } : prev));
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
  }, [activeProgress, isMainLayout, mode, queryClient, unlockedSet, positions, resetSession]);

  // Auto-clear the post-Esc toast after a few seconds. We pick a window
  // long enough to comfortably cover the session POST + unlock fetch round
  // trip, so an unlock notice can still land on a still-visible toast.
  useEffect(() => {
    if (lastSummary === null) return;
    const id = setTimeout(() => setLastSummary(null), 6000);
    return () => clearTimeout(id);
  }, [lastSummary]);

  // ─── Keydown handler ─────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Skip when an input/textarea/select has focus.
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Esc ends the current session: flush data, post stats (flow only),
      // and reset the stream. There is no pause / no completable level.
      if (e.key === 'Escape') {
        e.preventDefault();
        void endSession();
        return;
      }

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

      let st = startTimeRef.current;
      if (st === null) {
        st = now;
        setStartTime(now);
      }

      if (isCorrect) {
        const newCursor = currentCursor + 1;
        setCursor(newCursor);

        const minutes = (now - st) / 60_000;
        const wpm = minutes > 0 ? newCursor / CHARS_PER_WORD / minutes : 0;
        const accuracy = currentTotalKeystrokes > 0
          ? newCursor / currentTotalKeystrokes
          : 1;
        setLiveWpm(Math.round(wpm));
        setLiveAccuracy(Math.round(accuracy * 100));

        // Eagerly prefetch more content well before the cursor reaches the
        // end of the buffer, so the user always sees several lines of
        // upcoming text below the cursor (Monkeytype-style). Threshold is
        // generous — bigger than one chunk worth — so even a momentary
        // late append still keeps the visible window full.
        const remaining = sentenceRef.current.length - newCursor;
        if (remaining < 200) {
          appendNextChunk();
        }
      }
    },
    [positionMap, endSession, appendNextChunk],
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

      {/* Transient end-of-session toast (auto-clears after 6s). Shown
          after Esc or the End button; folds in an unlock notice if one
          fires before the toast disappears. */}
      {lastSummary && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm flex items-center gap-3 text-gray-300"
        >
          <span className="text-gray-400">
            {lastSummary.mode === 'flow' ? 'Session saved' : 'Drill ended'}
          </span>
          <span className="text-gray-700">·</span>
          <span className="text-blue-300 font-mono tabular-nums">{lastSummary.wpm} WPM</span>
          <span className="text-gray-700">·</span>
          <span className="text-yellow-300 font-mono tabular-nums">
            {lastSummary.accuracy}% acc
          </span>
          {lastSummary.unlocked && (
            <>
              <span className="text-gray-700">·</span>
              <span className="text-green-300">
                Unlocked <span className="font-mono font-bold">{lastSummary.unlocked}</span>
              </span>
            </>
          )}
        </div>
      )}

      {/* Typing area — fixed-height 3-line window that scrolls
          Monkeytype-style. The outer div sets the font size + line-height
          so its child line-box height matches the explicit calc below,
          and `p-8` adds the 4rem of padding (2rem top + 2rem bottom) the
          calc accounts for. The inner div is translated up as the cursor
          advances so completed lines scroll off the top while upcoming
          lines stream in at the bottom from `appendNextChunk`.

          Height math: text-2xl = 1.5rem font-size, leading-relaxed =
          1.625 → per-line = 2.4375rem → 3 lines = 7.3125rem, plus 4rem
          for p-8's vertical padding = 11.3125rem total. Using calc keeps
          the source readable; we deliberately avoid the `lh` unit since
          it isn't supported by older Safari/Firefox builds Vite targets. */}
      <div
        className="w-full max-w-2xl bg-gray-900 rounded-2xl px-8 py-8 font-mono text-2xl leading-relaxed overflow-hidden"
        style={{ height: 'calc(2.4375rem * 3 + 4rem)' }}
        role="region"
        aria-label="Typing practice area"
      >
        <div
          ref={innerRef}
          key={streamKey}
          className="tracking-wide"
          style={{
            transform: `translateY(-${scrollY}px)`,
            transition: 'transform 120ms ease-out',
            willChange: 'transform',
          }}
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
                  {tok.indices.map((i) => renderChar(charData[i], i, cursor))}
                </span>
              ) : (
                // A whitespace token: render each space char as a plain inline span.
                // The space content is a literal space so the line can break here.
                tok.indices.map((i) => renderChar(charData[i], i, cursor))
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
          onClick={() => void endSession()}
          className="px-4 py-2 text-sm text-gray-400 border border-gray-700 rounded-lg hover:border-gray-500 hover:text-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          End session (Esc)
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
        Type freely · Press Esc to end the session
        {mode === 'flow' ? ' and save your stats' : ''}
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
