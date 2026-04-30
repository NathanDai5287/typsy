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
  nextKeyToUnlock,
} from '@typsy/shared';
import type { KeyPosition, NgramStat, FingerLabel } from '@typsy/shared';
import KeyboardVisual from '../components/KeyboardVisual.tsx';
import { useRegisterPageKeymap } from '../lib/keymapContext.tsx';
import type { Keybinding, Modifier } from '../lib/keymap.ts';

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
  const isCursor = i === cursor;
  // Terminal-style colors:
  //   pending  : dim foreground (muted)
  //   correct  : bright foreground
  //   wrong    : red underline (kept visible even at the cursor)
  //   cursor   : reverse-video block, tinted red when sitting on a
  //              wrong char so the typo doesn't get masked
  const isWrong = cd.state === 'wrong';
  let className: string;
  if (isCursor) {
    className = isWrong
      ? 'bg-red-400 text-bg_h'
      : 'bg-yellow-400 text-bg_h';
  } else if (cd.state === 'correct') {
    className = 'text-fg_h';
  } else if (isWrong) {
    className = 'text-red-400 underline decoration-red-400';
  } else {
    className = 'text-fg4';
  }
  return (
    <span
      key={i}
      className={className}
      data-cursor={isCursor ? 'true' : undefined}
    >
      {cd.char === ' ' ? ' ' : cd.char}
    </span>
  );
}

/** Words the flow generator will treat as "recently emitted" — keeps
 * the same handful of weak words from re-surfacing in every chunk. */
const RECENT_FLOW_BUFFER = 40;

/** Build the next sentence based on mode + unlocked + user weakness. */
function buildSentence(
  mode: Mode,
  unlocked: ReadonlySet<string>,
  ngramRows: readonly NgramStat[],
  recent?: ReadonlySet<string>,
): string {
  if (unlocked.size === 0) {
    return 'finish onboarding to start practicing';
  }
  const userIndex = indexNgramStats(ngramRows);
  if (mode === 'drill') {
    return generateDrillSequence({
      allowed: unlocked,
      userIndex,
      length: 100,
    });
  }
  return generateFlowLine({
    allowed: unlocked,
    userIndex,
    numWords: 50,
    recent,
  });
}

export default function PracticePage(): JSX.Element {
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

  // Insertion-ordered array of unlocked keys. The order is the source of truth
  // for the "lock back" UX — pressing − pops the last entry, so chronological
  // add-history is preserved naturally without an extra DB column.
  const unlockedKeys = useMemo<string[]>(() => {
    if (!activeProgress) return [];
    if (isMainLayout) {
      return positions.filter((p) => /^[a-z]$/.test(p.char)).map((p) => p.char);
    }
    try {
      const arr = JSON.parse(activeProgress.unlocked_keys_json) as string[];
      // De-dupe defensively while preserving order — older rows may have
      // duplicates from before the click-to-toggle flow was added.
      const seen = new Set<string>();
      const out: string[] = [];
      for (const c of arr) {
        if (!seen.has(c)) { seen.add(c); out.push(c); }
      }
      return out;
    } catch {
      return [];
    }
  }, [activeProgress, isMainLayout, positions]);

  const unlockedSet = useMemo<Set<string>>(
    () => new Set(unlockedKeys),
    [unlockedKeys],
  );

  const posFingerMap = useMemo<Record<string, FingerLabel>>(() => {
    if (!userData) return {};
    try {
      return JSON.parse(userData.user.fingering_map_json) as Record<string, FingerLabel>;
    } catch {
      return {};
    }
  }, [userData?.user.fingering_map_json]);

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
  }, [initialMode]);

  const updateProgress = useMutation({
    mutationFn: postProgressUpdate,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['user'] }),
  });

  const changeMode = useCallback((next: Mode) => {
    if (next === mode) return;
    setMode(next);
    if (activeProgress) {
      updateProgress.mutate({
        layout_id: activeProgress.layout_id,
        current_mode: next,
      });
    }
  }, [mode, activeProgress, updateProgress]);

  // Stable serialized key of unlocked set contents — used as effect dependency
  // so text regenerates whenever the set changes (size OR membership).
  // Sorted so we don't regenerate on identity-only reorders (e.g. lock then
  // immediately unlock the same key — same logical set, no need to reset).
  const unlockedKey = useMemo(
    () => [...unlockedKeys].sort().join(','),
    [unlockedKeys],
  );

  // ─── Manual unlock/lock controls ─────────────────────────────────────────
  const layoutAlphaChars = useMemo(
    () => positions.filter((p) => /^[a-z]$/.test(p.char)),
    [positions],
  );

  const applyUnlockedChange = useCallback(
    async (next: string[]) => {
      if (!activeProgress) return;
      // Persist the array verbatim — order is meaningful (the last entry is
      // the one that − will pop). Don't sort.
      await postProgressUpdate({
        layout_id: activeProgress.layout_id,
        unlocked_keys_json: JSON.stringify(next),
      });
      void queryClient.invalidateQueries({ queryKey: ['user'] });
    },
    [activeProgress, queryClient],
  );

  const handleUnlockNext = useCallback(async () => {
    if (!activeProgress || isMainLayout) return;
    const next = nextKeyToUnlock(unlockedKeys, layoutAlphaChars);
    if (!next) return;
    await applyUnlockedChange([...unlockedKeys, next]);
  }, [activeProgress, isMainLayout, unlockedKeys, layoutAlphaChars, applyUnlockedChange]);

  const handleLockLast = useCallback(async () => {
    if (!activeProgress || isMainLayout) return;
    if (unlockedKeys.length <= 1) return;
    // Pop the most recently added key (LIFO).
    await applyUnlockedChange(unlockedKeys.slice(0, -1));
  }, [activeProgress, isMainLayout, unlockedKeys, applyUnlockedChange]);

  const handleToggleKey = useCallback(
    async (char: string) => {
      if (!activeProgress || isMainLayout) return;
      if (!/^[a-z]$/.test(char)) return; // ignore non-alpha clicks
      const isUnlocked = unlockedSet.has(char);
      if (isUnlocked) {
        // Don't allow locking the last remaining key
        if (unlockedKeys.length <= 1) return;
        await applyUnlockedChange(unlockedKeys.filter((c) => c !== char));
      } else {
        // Append to end — this becomes the new "last unlocked" that − will pop
        await applyUnlockedChange([...unlockedKeys, char]);
      }
    },
    [activeProgress, isMainLayout, unlockedKeys, unlockedSet, applyUnlockedChange],
  );

  // ─── Session state ───────────────────────────────────────────────────────
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
  // Ring buffer of recently emitted flow words. Passed back into the
  // generator so the same weak words don't re-surface every chunk.
  const recentFlowWordsRef = useRef<string[]>([]);

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
  const innerRef = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(0);
  const [streamKey, setStreamKey] = useState(0);

  // ─── Reset session ───────────────────────────────────────────────────────
  const pushRecentFlowWords = useCallback((words: readonly string[]) => {
    const buf = recentFlowWordsRef.current;
    for (const w of words) buf.push(w);
    if (buf.length > RECENT_FLOW_BUFFER) {
      buf.splice(0, buf.length - RECENT_FLOW_BUFFER);
    }
  }, []);

  const resetSession = useCallback(() => {
    if (!activeProgress || unlockedSet.size === 0 || (ngramRows == null)) {
      return;
    }
    const recent1 = new Set(recentFlowWordsRef.current);
    const s1 = buildSentence(mode, unlockedSet, ngramRows, recent1);
    if (mode === 'flow') pushRecentFlowWords(s1.split(' '));
    const recent2 = new Set(recentFlowWordsRef.current);
    const s2 = buildSentence(mode, unlockedSet, ngramRows, recent2);
    if (mode === 'flow') pushRecentFlowWords(s2.split(' '));
    const s = s1 + ' ' + s2;
    setSentence(s);
    setCharData(initCharData(s));
    setCursor(0);
    setTotalKeystrokes(0);
    setStartTime(null);
    setLiveWpm(0);
    setLiveAccuracy(100);
    lastKeypressTimeRef.current = null;
    setScrollY(0);
    setStreamKey((k) => k + 1);

    ngramTrackerRef.current?.stop().catch(console.error);
    if (mode === 'flow') {
      const tracker = new NgramTracker(1, activeProgress.layout_id);
      tracker.start();
      ngramTrackerRef.current = tracker;
    } else {
      ngramTrackerRef.current = null;
    }
  }, [activeProgress?.layout_id, mode, unlockedSet, ngramRows, pushRecentFlowWords]);

  useEffect(() => {
    if (!sentence && activeProgress && unlockedSet.size > 0 && ngramRows) {
      resetSession();
    }
  }, [activeProgress, unlockedKey, ngramRows, sentence, resetSession]);

  useEffect(() => {
    if (sentence) resetSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlockedKey]);

  useEffect(() => {
    if (sentence) resetSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    return () => {
      ngramTrackerRef.current?.stop().catch(console.error);
    };
  }, []);

  // ─── Track cursor's line position and scroll the inner content ───────────
  useLayoutEffect(() => {
    const innerEl = innerRef.current;
    if (!innerEl) return;
    const cursorEl = innerEl.querySelector<HTMLElement>('[data-cursor="true"]');
    if (!cursorEl) return;

    const innerRect = innerEl.getBoundingClientRect();
    const cursorRect = cursorEl.getBoundingClientRect();
    const cursorTop = cursorRect.top - innerRect.top;

    const lhStr = getComputedStyle(innerEl).lineHeight;
    let lineHeight = parseFloat(lhStr);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      lineHeight = parseFloat(getComputedStyle(innerEl).fontSize) * 1.5;
    }
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;

    const cursorLine = Math.round(cursorTop / lineHeight);
    const desiredScrollLine = Math.max(0, cursorLine - 1);
    const desired = desiredScrollLine * lineHeight;
    setScrollY((prev) => (Math.abs(prev - desired) < 0.5 ? prev : desired));
  }, [cursor, charData.length]);

  const appendNextChunk = useCallback(() => {
    if (!ngramRows || unlockedSet.size === 0) return;
    const recent = new Set(recentFlowWordsRef.current);
    const next = buildSentence(mode, unlockedSet, ngramRows, recent);
    if (mode === 'flow') pushRecentFlowWords(next.split(' '));
    const more = ' ' + next;
    setSentence((prev) => prev + more);
    setCharData((prev) => [...prev, ...initCharData(more)]);
  }, [mode, unlockedSet, ngramRows, pushRecentFlowWords]);

  // ─── End session (flush + persist + reset) ───────────────────────────────
  const endSession = useCallback(async () => {
    const finalCursor = cursorRef.current;
    const finalKeystrokes = totalKeystrokesRef.current;
    const st = startTimeRef.current;
    const localMode = mode;
    const tracker = ngramTrackerRef.current;

    if (st === null || finalCursor === 0) {
      resetSession();
      return;
    }

    const lastKey = lastKeypressTimeRef.current;
    const now = Date.now();
    const endedAt = lastKey ?? now;
    const minutes = (endedAt - st) / 60_000;
    const wpm = minutes > 0 ? finalCursor / CHARS_PER_WORD / minutes : 0;
    const accuracy = finalKeystrokes > 0 ? finalCursor / finalKeystrokes : 1;
    const errors = finalKeystrokes - finalCursor;

    tracker?.finalizeWord();
    const flushPromise = tracker?.stop() ?? Promise.resolve();
    ngramTrackerRef.current = null;

    resetSession();
    setLastSummary({
      wpm: Math.round(wpm),
      accuracy: Math.round(accuracy * 100),
      mode: localMode,
    });

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
        cumulative_chars_at_session_end: 0,
      });

      if (!isMainLayout) {
        const fresh = await queryClient.fetchQuery<NgramStat[]>({
          queryKey: ['ngramStats', activeProgress.layout_id],
          queryFn: () => fetchNgramStats(activeProgress.layout_id),
        });

        const idx = indexNgramStats(fresh);
        const health = computeKeyHealth(idx, unlockedKeys);
        const next = shouldUnlockNextKey(health, unlockedKeys, positions);
        if (next) {
          // Append in insertion order — preserves the LIFO history used by −.
          const nextUnlocked = [...unlockedKeys, next];
          await postProgressUpdate({
            layout_id: activeProgress.layout_id,
            unlocked_keys_json: JSON.stringify(nextUnlocked),
          });
          setLastSummary((prev) => (prev ? { ...prev, unlocked: next } : prev));
          void queryClient.invalidateQueries({ queryKey: ['user'] });
        }
      } else {
        void queryClient.invalidateQueries({
          queryKey: ['ngramStats', activeProgress.layout_id],
        });
      }

      void queryClient.invalidateQueries({
        queryKey: ['sessions', activeProgress.layout_id],
      });
    } catch (err) {
      console.error('Failed to save session', err);
    }
  }, [activeProgress, isMainLayout, mode, queryClient, unlockedKeys, positions, resetSession]);

  useEffect(() => {
    if (lastSummary === null) return;
    const id = setTimeout(() => setLastSummary(null), 6000);
    return () => clearTimeout(id);
  }, [lastSummary]);

  // ─── Page-level keymap (Esc, Tab, \) ─────────────────────────────────────
  // These are non-typing controls that don't conflict with the typing
  // handler below (Tab, Escape, Backslash all return null from the
  // CODE_TO_POSITION map). Bound through the global keymap registry so
  // they show up in the help overlay.
  const pageBindings = useMemo<Keybinding[]>(
    () => [
      {
        id: 'practice.end',
        code: 'Escape',
        description: 'End session (saves stats in flow mode)',
        handler: () => void endSession(),
        allowInInput: true,
      },
      {
        id: 'practice.toggle-mode',
        code: 'Tab',
        description: 'Toggle Flow ↔ Drill',
        handler: () => changeMode(mode === 'flow' ? 'drill' : 'flow'),
      },
      {
        id: 'practice.toggle-keyboard',
        code: 'Backslash',
        description: 'Show / hide on-screen keyboard',
        handler: () => setShowKeyboard((v) => !v),
      },
      {
        id: 'practice.unlock-next',
        code: 'Equal',
        modifiers: new Set<Modifier>(['shift']),
        description: 'Unlock next key',
        handler: () => void handleUnlockNext(),
      },
      {
        id: 'practice.lock-last',
        code: 'Minus',
        description: 'Lock most recently unlocked key',
        handler: () => void handleLockLast(),
      },
    ],
    [endSession, changeMode, mode, handleUnlockNext, handleLockLast],
  );
  useRegisterPageKeymap('Practice', pageBindings);

  // ─── Typing handler ──────────────────────────────────────────────────────
  // Captures alpha-block keypresses and routes them through translateKeypress.
  // ANY modifier (Shift / Ctrl / Alt / Meta) → return early so global
  // shortcuts like `Shift+P` and `?` (Shift+Slash) flow through to the
  // global keymap without being eaten.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Any modifier? Skip — those keys are global navigation / help etc.
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      // Plain modifiers we still want to ignore on keydown.
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;

      const logicalChar = translateKeypress(e, positionMap);
      if (logicalChar === null) return;

      e.preventDefault();
      // Stop subsequent listeners on the document (including the bubble
      // phase) from re-processing the same physical key. Without this,
      // typing a `g` would also arm the global `g` nav leader.
      e.stopImmediatePropagation();

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

        const remaining = sentenceRef.current.length - newCursor;
        if (remaining < 200) {
          appendNextChunk();
        }
      }
    },
    [positionMap, appendNextChunk],
  );

  // Capture-phase listener so we run before the keymap context's
  // bubble-phase listeners pick up the keypress. preventDefault here also
  // avoids the browser's default scroll on Space.
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  // ─── Render ──────────────────────────────────────────────────────────────
  if (!activeLayout) {
    return (
      <div className="flex h-[80vh] items-center justify-center text-fg3">
        loading layout…
      </div>
    );
  }

  const nextExpected = sentence[cursor];
  const nextChar = nextExpected && nextExpected !== ' ' ? nextExpected : null;
  const totalAlpha = positions.filter((p) => /^[a-z]$/.test(p.char)).length;

  return (
    <div className="flex flex-col items-center px-4 py-6 select-none">
      {/* Top bar: layout · mode · stats */}
      <div className="w-full max-w-3xl flex justify-between items-center mb-4 text-xs font-mono">
        <div className="flex items-center gap-2 text-fg3">
          <span className="text-fg_h">{activeLayout.name}</span>
          <span className="text-fg4">·</span>
          <ModeToggle mode={mode} onChange={changeMode} />
          <span className="text-fg4">·</span>
          {isMainLayout ? (
            <span className="text-fg3">daily driver</span>
          ) : (
            <UnlockControls
              unlockedCount={unlockedKeys.length}
              totalAlpha={totalAlpha}
              onUnlockNext={handleUnlockNext}
              onLockLast={handleLockLast}
            />
          )}
        </div>
        <div className="flex gap-5">
          <Stat label="WPM" value={liveWpm} />
          <Stat label="ACC" value={`${liveAccuracy}%`} />
        </div>
      </div>

      {/* End-of-session toast — fixed-position so it doesn't shift the
          typing area / on-screen keyboard down when it appears. Mirrors
          the placement and layering of <LeaderHint> (z-30 here so it
          sits *under* a leader hint if both somehow coexist). */}
      {lastSummary && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-10 right-4 z-30 panel px-3 py-2 text-xs font-mono flex items-center gap-2 select-none"
        >
          <span className="text-fg4">
            {lastSummary.mode === 'flow' ? 'session saved' : 'drill ended'}
          </span>
          <span className="text-fg4">·</span>
          <span className="text-yellow-400 tabular-nums">{lastSummary.wpm} WPM</span>
          <span className="text-fg4">·</span>
          <span className="text-blue-400 tabular-nums">{lastSummary.accuracy}% acc</span>
          {lastSummary.unlocked && (
            <>
              <span className="text-fg4">·</span>
              <span className="text-green-400">
                unlocked <span className="font-bold">{lastSummary.unlocked}</span>
              </span>
            </>
          )}
        </div>
      )}

      {/* Typing area — fixed-height 3-line window that scrolls
          monkeytype-style. Sharp single-pixel border, no rounded corners. */}
      <div
        className="w-full max-w-3xl panel px-6 py-6 text-2xl leading-relaxed overflow-hidden"
        style={{ height: 'calc(2.4375rem * 3 + 3rem)' }}
        role="region"
        aria-label="Typing practice area"
      >
        <div
          ref={innerRef}
          key={streamKey}
          className="font-mono"
          style={{
            transform: `translateY(-${scrollY}px)`,
            transition: 'transform 80ms linear',
            willChange: 'transform',
          }}
          aria-live="polite"
          aria-label="Text to type"
        >
          {charData.length === 0 ? (
            <span className="text-fg4">loading…</span>
          ) : (
            tokenize(charData).map((tok, ti) =>
              tok.kind === 'word' ? (
                <span key={ti} className="inline-block whitespace-nowrap">
                  {tok.indices.map((i) => renderChar(charData[i], i, cursor))}
                </span>
              ) : (
                tok.indices.map((i) => renderChar(charData[i], i, cursor))
              ),
            )
          )}
        </div>
      </div>

      {/* On-screen keyboard. When learning a layout, every alpha key is
          clickable and toggles its lock state — daily-driver layouts skip
          this so all keys remain non-interactive. */}
      {showKeyboard && (
        <div className="mt-6">
          <KeyboardVisual
            positions={positions}
            unlocked={unlockedSet}
            nextChar={nextChar}
            posFingerMap={posFingerMap}
            charHits={charHits}
            onKeyClick={isMainLayout ? undefined : handleToggleKey}
          />
        </div>
      )}

      {/* Hint line */}
      <p className="mt-6 text-xs text-fg4">
        type freely · <kbd className="kbd">Esc</kbd> end · <kbd className="kbd">Tab</kbd> mode ·{' '}
        <kbd className="kbd">\</kbd> keyboard · <kbd className="kbd">+</kbd>/<kbd className="kbd">−</kbd> unlock ·{' '}
        <kbd className="kbd">?</kbd> help
      </p>
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <span role="tablist" aria-label="Practice mode" className="inline-flex items-center gap-1">
      {(['flow', 'drill'] as const).map((m) => (
        <button
          key={m}
          role="tab"
          type="button"
          aria-selected={mode === m}
          onClick={() => onChange(m)}
          className={[
            'px-2 py-0 text-xs font-mono border focus-visible:outline-none focus-visible:border-yellow-400',
            mode === m
              ? 'bg-yellow-400 text-bg_h border-yellow-400'
              : 'border-bg4 text-fg2 hover:text-fg_h',
          ].join(' ')}
        >
          {m}
        </button>
      ))}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-right">
      <div className="text-xl font-mono font-bold text-fg_h tabular-nums leading-none">
        {value}
      </div>
      <div className="text-[10px] text-fg4 uppercase tracking-widest mt-0.5">{label}</div>
    </div>
  );
}

// ─── UnlockControls ──────────────────────────────────────────────────────────
// Compact +/count/− trio shown in the practice top bar. Specific keys are
// toggled by clicking on the on-screen keyboard itself; this component is
// the "next-in-priority-order" shortcut.

interface UnlockControlsProps {
  unlockedCount: number;
  totalAlpha: number;
  onUnlockNext: () => void;
  onLockLast: () => void;
}

function UnlockControls({
  unlockedCount,
  totalAlpha,
  onUnlockNext,
  onLockLast,
}: UnlockControlsProps) {
  const canUnlockMore = unlockedCount < totalAlpha;
  const canLockBack = unlockedCount > 1;

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        title="Lock most recently unlocked key"
        onClick={onLockLast}
        disabled={!canLockBack}
        className={[
          'w-5 h-5 flex items-center justify-center border font-mono text-xs leading-none focus-visible:outline-none focus-visible:border-yellow-400',
          canLockBack
            ? 'border-bg4 text-fg2 hover:text-fg_h hover:border-fg4 cursor-pointer'
            : 'border-bg3 text-fg4 opacity-40 cursor-not-allowed',
        ].join(' ')}
      >
        −
      </button>

      <span className="px-1 font-mono text-xs text-fg3 tabular-nums">
        {unlockedCount}/{totalAlpha}
      </span>

      <button
        type="button"
        title="Unlock next key in priority order"
        onClick={onUnlockNext}
        disabled={!canUnlockMore}
        className={[
          'w-5 h-5 flex items-center justify-center border font-mono text-xs leading-none focus-visible:outline-none focus-visible:border-yellow-400',
          canUnlockMore
            ? 'border-bg4 text-fg2 hover:text-fg_h hover:border-fg4 cursor-pointer'
            : 'border-bg3 text-fg4 opacity-40 cursor-not-allowed',
        ].join(' ')}
      >
        +
      </button>
    </span>
  );
}
