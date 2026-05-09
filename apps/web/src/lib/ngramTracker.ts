import { WRITE_FLUSH_INTERVAL_MS } from '@typsy/shared';
import type {
  BigramWordMissDelta,
  BigramWordTimeDelta,
  NgramBatchDelta,
} from '@typsy/shared';
import { postNgramBatch } from './api.ts';

type DeltaEntry = { hits: number; misses: number; hitTimeMs: number };
type BigramWordTimeEntry = { hits: number; hitTimeMs: number };

/**
 * Tracks per-keystroke ngram stats and per-bigram missed-word context.
 *
 * Position-attempt model: each cursor position counts as exactly ONE attempt.
 * The first keypress at a position is recorded (hit or miss); any subsequent
 * keypresses at the same position (more misses, or the eventual corrective
 * hit) are ignored. This avoids two pre-existing bugs:
 *
 *   1. Phantom doubled bigrams ("aa", "pp", "kk") that were previously
 *      generated on the corrective keystroke after a miss.
 *   2. Linearly-inflated miss counts when the user fumbles a position
 *      multiple times before getting it right.
 *
 * The internal `hitRing` only contains successfully-typed letters within the
 * CURRENT word — it resets at every space, which means bigrams/trigrams are
 * never tracked across word boundaries (no " a" or "X " bigrams ever land in
 * the DB) and the first letter of every word is excluded from bigram blame.
 */
export class NgramTracker {
  /** Last 0–2 successfully-typed expected chars within the current word. */
  private hitRing: string[] = [];
  private currentWord = '';
  private currentTargetWord = '';
  private currentWordHadError = false;
  /** True after the first miss at the current cursor position; reset when the position advances. */
  private currentPosHadMiss = false;
  private prevWord = '';
  private deltas = new Map<string, DeltaEntry>();
  /** Buffer for per-bigram missed-word rows. Key: `${bigram}\t${target}\t${typed}`. */
  private bigramWordMisses = new Map<string, number>();
  /** Buffer for per-(bigram, word) hit-time rows. Key: `${bigram}\t${target}`. */
  private bigramWordTimes = new Map<string, BigramWordTimeEntry>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly userId: number;
  private readonly layoutId: number;

  constructor(userId: number, layoutId: number) {
    this.userId = userId;
    this.layoutId = layoutId;
  }

  /**
   * Record a single keypress.
   * @param typedChar    - What the user actually typed.
   * @param expectedChar - What they were supposed to type.
   * @param timeSinceLastMs - Milliseconds since the previous keypress (0 on first).
   * @param targetWord   - Optional full target word containing this position. Used
   *                       for per-bigram missed-word context. When omitted, no
   *                       bigram_word_misses rows are recorded.
   */
  recordChar(
    typedChar: string,
    expectedChar: string,
    timeSinceLastMs: number,
    targetWord?: string,
  ): void {
    const hit = typedChar === expectedChar;
    const isSpace = expectedChar === ' ';
    const firstAttempt = !this.currentPosHadMiss;

    // Stash the target word on the first call at this position (so a later
    // bigram-word-miss has it even though the caller passes it on every call).
    if (firstAttempt && !isSpace && targetWord) {
      this.currentTargetWord = targetWord;
    }

    // Only the FIRST attempt at a position contributes to char1/char2/char3
    // counters and timing. Subsequent attempts (more misses or the corrective
    // hit) are silently consumed for state-tracking only.
    if (firstAttempt) {
      this.addDelta(`char1:${expectedChar}`, hit, timeSinceLastMs);

      // Bigrams + trigrams: only when we're inside a word (not the space char,
      // and the ring contains at least one preceding hit char). The ring is
      // empty at the start of every word, so the first char of a word is
      // automatically excluded from bigram blame.
      if (!isSpace && this.hitRing.length >= 1) {
        const bigram = this.hitRing[this.hitRing.length - 1] + expectedChar;
        this.addDelta(`char2:${bigram}`, hit, timeSinceLastMs);

        const tw = this.currentTargetWord;
        if (!hit) {
          if (tw) {
            const typedWord = this.currentWord + typedChar;
            this.addBigramWordMiss(bigram, tw, typedWord);
          }
        } else if (tw) {
          // Per-(bigram, word) hit-time: drives the dashboard's "slow in"
          // subsection by direct measurement (not reconstruction). We only
          // accumulate on first-attempt clean hits, mirroring char2.
          this.addBigramWordTime(bigram, tw, timeSinceLastMs);
        }
      }
      if (!isSpace && this.hitRing.length >= 2) {
        const trigram =
          this.hitRing[this.hitRing.length - 2] +
          this.hitRing[this.hitRing.length - 1] +
          expectedChar;
        this.addDelta(`char3:${trigram}`, hit, timeSinceLastMs);
      }
    }

    // ─── Word + position state ───────────────────────────────────────────
    if (isSpace) {
      if (hit) {
        if (this.currentWord) {
          const wordHit = !this.currentWordHadError;
          // Word-level deltas carry hits/misses only; no timing. Word
          // slowness is reconstructed from char-level data.
          this.addDelta(`word1:${this.currentWord}`, wordHit, 0);
          if (this.prevWord) {
            this.addDelta(`word2:${this.prevWord} ${this.currentWord}`, wordHit, 0);
          }
          this.prevWord = this.currentWord;
          this.currentWord = '';
          this.currentWordHadError = false;
        }
        this.currentTargetWord = '';
        this.hitRing = [];
        this.currentPosHadMiss = false;
      } else {
        this.currentWordHadError = true;
        this.currentPosHadMiss = true;
      }
      return;
    }

    if (hit) {
      this.currentWord += expectedChar;
      this.hitRing = [...this.hitRing.slice(-1), expectedChar];
      this.currentPosHadMiss = false;
    } else {
      this.currentWordHadError = true;
      this.currentPosHadMiss = true;
    }
  }

  /** Flush any remaining word at session end (last word before sentence ends). */
  finalizeWord(): void {
    if (this.currentWord) {
      const wordHit = !this.currentWordHadError;
      this.addDelta(`word1:${this.currentWord}`, wordHit, 0);
      if (this.prevWord) {
        this.addDelta(`word2:${this.prevWord} ${this.currentWord}`, wordHit, 0);
      }
      this.prevWord = this.currentWord;
      this.currentWord = '';
      this.currentTargetWord = '';
      this.currentWordHadError = false;
      this.hitRing = [];
      this.currentPosHadMiss = false;
    }
  }

  /** Begin periodic 30-second flush. Call once when session starts. */
  start(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, WRITE_FLUSH_INTERVAL_MS);
  }

  /** Flush remaining deltas and stop the interval. Call on session end / unmount. */
  async stop(): Promise<void> {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /** POST current deltas to the server and clear the local map. */
  async flush(): Promise<void> {
    if (
      this.deltas.size === 0 &&
      this.bigramWordMisses.size === 0 &&
      this.bigramWordTimes.size === 0
    ) {
      return;
    }

    const deltas: NgramBatchDelta[] = [];
    for (const [key, entry] of this.deltas) {
      const colonIdx = key.indexOf(':');
      const ngram_type = key.slice(0, colonIdx) as NgramBatchDelta['ngram_type'];
      const ngram = key.slice(colonIdx + 1);
      deltas.push({
        ngram,
        ngram_type,
        hits_delta: entry.hits,
        misses_delta: entry.misses,
        hit_time_delta_ms: entry.hitTimeMs,
      });
    }

    const bigramWordMisses: BigramWordMissDelta[] = [];
    for (const [key, miss_delta] of this.bigramWordMisses) {
      const [bigram, target_word, typed_word] = key.split('\t');
      if (bigram === undefined || target_word === undefined || typed_word === undefined) continue;
      bigramWordMisses.push({ bigram, target_word, typed_word, miss_delta });
    }

    const bigramWordTimes: BigramWordTimeDelta[] = [];
    for (const [key, entry] of this.bigramWordTimes) {
      const [bigram, target_word] = key.split('\t');
      if (bigram === undefined || target_word === undefined) continue;
      bigramWordTimes.push({
        bigram,
        target_word,
        hits_delta: entry.hits,
        hit_time_delta_ms: entry.hitTimeMs,
      });
    }

    this.deltas.clear();
    this.bigramWordMisses.clear();
    this.bigramWordTimes.clear();

    try {
      await postNgramBatch({
        layout_id: this.layoutId,
        deltas,
        bigram_word_misses: bigramWordMisses.length > 0 ? bigramWordMisses : undefined,
        bigram_word_times: bigramWordTimes.length > 0 ? bigramWordTimes : undefined,
      });
    } catch (err) {
      console.error('NgramTracker: flush failed', err);
      // Don't re-queue — acceptable data loss for MVP (30s window).
    }
  }

  /** Expose deltas for testing (returns a copy). */
  getPendingForTest(): Map<string, DeltaEntry> {
    return new Map(this.deltas);
  }

  /** Expose bigram-word-miss buffer for testing. */
  getPendingBigramWordMissesForTest(): Map<string, number> {
    return new Map(this.bigramWordMisses);
  }

  /** Expose bigram-word-time buffer for testing. */
  getPendingBigramWordTimesForTest(): Map<string, BigramWordTimeEntry> {
    return new Map(this.bigramWordTimes);
  }

  /**
   * Accumulate one attempt for `key`. `timeMs` is added to `hitTimeMs` only
   * when `hit === true`; miss times are discarded so the per-key WPM math
   * isn't skewed by hesitation before errors. Pass `timeMs = 0` for
   * word-level deltas — word slowness is reconstructed from char-level
   * data.
   */
  private addDelta(key: string, hit: boolean, timeMs: number): void {
    const existing = this.deltas.get(key) ?? { hits: 0, misses: 0, hitTimeMs: 0 };
    this.deltas.set(key, {
      hits: existing.hits + (hit ? 1 : 0),
      misses: existing.misses + (hit ? 0 : 1),
      hitTimeMs: existing.hitTimeMs + (hit ? timeMs : 0),
    });
  }

  private addBigramWordTime(bigram: string, target_word: string, timeMs: number): void {
    const key = `${bigram}\t${target_word}`;
    const existing = this.bigramWordTimes.get(key) ?? { hits: 0, hitTimeMs: 0 };
    this.bigramWordTimes.set(key, {
      hits: existing.hits + 1,
      hitTimeMs: existing.hitTimeMs + timeMs,
    });
  }

  private addBigramWordMiss(bigram: string, target_word: string, typed_word: string): void {
    const key = `${bigram}\t${target_word}\t${typed_word}`;
    this.bigramWordMisses.set(key, (this.bigramWordMisses.get(key) ?? 0) + 1);
  }
}
