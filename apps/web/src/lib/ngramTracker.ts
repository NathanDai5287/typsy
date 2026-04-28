import { WRITE_FLUSH_INTERVAL_MS } from '@typsy/shared';
import type { NgramBatchDelta } from '@typsy/shared';
import { postNgramBatch } from './api.ts';

type DeltaEntry = { hits: number; misses: number; totalTimeMs: number };

export class NgramTracker {
  private charRing: string[] = [];
  private currentWord = '';
  private currentWordHadError = false;
  private prevWord = '';
  private deltas = new Map<string, DeltaEntry>();
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
   */
  recordChar(typedChar: string, expectedChar: string, timeSinceLastMs: number): void {
    const hit = typedChar === expectedChar;

    // Always push the EXPECTED char into the ring (tracks intended sequence).
    this.charRing = [...this.charRing.slice(-2), expectedChar];

    // char1
    this.addDelta(`char1:${expectedChar}`, hit, timeSinceLastMs);

    // char2 (need at least 2 chars)
    if (this.charRing.length >= 2) {
      const bigram = this.charRing.slice(-2).join('');
      this.addDelta(`char2:${bigram}`, hit, timeSinceLastMs);
    }

    // char3 (need exactly 3 chars)
    if (this.charRing.length === 3) {
      const trigram = this.charRing.join('');
      this.addDelta(`char3:${trigram}`, hit, timeSinceLastMs);
    }

    // Word-level tracking
    if (expectedChar === ' ') {
      if (this.currentWord) {
        const wordHit = hit && !this.currentWordHadError;
        this.addDelta(`word1:${this.currentWord}`, wordHit, timeSinceLastMs);
        if (this.prevWord) {
          this.addDelta(`word2:${this.prevWord} ${this.currentWord}`, wordHit, timeSinceLastMs);
        }
        this.prevWord = this.currentWord;
        this.currentWord = '';
        this.currentWordHadError = false;
      }
    } else {
      if (!hit) {
        this.currentWordHadError = true;
        return;
      }
      this.currentWord += expectedChar;
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
      this.currentWordHadError = false;
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
    if (this.deltas.size === 0) return;

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
        time_delta_ms: entry.totalTimeMs,
      });
    }

    this.deltas.clear();

    try {
      await postNgramBatch({ layout_id: this.layoutId, deltas });
    } catch (err) {
      console.error('NgramTracker: flush failed', err);
      // Don't re-queue — acceptable data loss for MVP (30s window).
    }
  }

  /** Expose deltas for testing (returns a copy). */
  getPendingForTest(): Map<string, DeltaEntry> {
    return new Map(this.deltas);
  }

  private addDelta(key: string, hit: boolean, timeMs: number): void {
    const existing = this.deltas.get(key) ?? { hits: 0, misses: 0, totalTimeMs: 0 };
    this.deltas.set(key, {
      hits: existing.hits + (hit ? 1 : 0),
      misses: existing.misses + (hit ? 0 : 1),
      totalTimeMs: existing.totalTimeMs + timeMs,
    });
  }
}
