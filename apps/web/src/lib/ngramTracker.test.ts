import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NgramTracker } from './ngramTracker.ts';

// Mock the API so we don't make real network calls
vi.mock('./api.ts', () => ({
  postNgramBatch: vi.fn().mockResolvedValue(undefined),
}));

describe('NgramTracker', () => {
  let tracker: NgramTracker;

  beforeEach(() => {
    tracker = new NgramTracker(1, 1);
  });

  // ─── char1 ────────────────────────────────────────────────────────────────

  it('records char1 hit when typed char matches expected', () => {
    tracker.recordChar('t', 't', 100);
    const pending = tracker.getPendingForTest();
    expect(pending.get('char1:t')?.hits).toBe(1);
    expect(pending.get('char1:t')?.misses).toBe(0);
  });

  it('records char1 miss against the expected char', () => {
    tracker.recordChar('x', 't', 100);
    const pending = tracker.getPendingForTest();
    expect(pending.get('char1:t')?.misses).toBe(1);
    expect(pending.has('char1:x')).toBe(false);
  });

  // ─── char2 ────────────────────────────────────────────────────────────────

  it('generates char2 bigrams after 2 chars', () => {
    tracker.recordChar('t', 't', 100);
    tracker.recordChar('h', 'h', 80);
    const pending = tracker.getPendingForTest();
    expect(pending.has('char2:th')).toBe(true);
    expect(pending.get('char2:th')?.hits).toBe(1);
  });

  it('records char2 miss on the expected bigram, not the typed bigram', () => {
    tracker.recordChar('t', 't', 100);
    tracker.recordChar('x', 'h', 80);
    const pending = tracker.getPendingForTest();
    expect(pending.get('char2:th')?.misses).toBe(1);
    expect(pending.has('char2:tx')).toBe(false);
  });

  // ─── char3 ────────────────────────────────────────────────────────────────

  it('generates char3 trigrams after 3 chars', () => {
    tracker.recordChar('t', 't', 100);
    tracker.recordChar('h', 'h', 80);
    tracker.recordChar('e', 'e', 90);
    const pending = tracker.getPendingForTest();
    expect(pending.has('char3:the')).toBe(true);
  });

  it('generates correct bigrams for "the"', () => {
    ['t', 'h', 'e'].forEach((c) => tracker.recordChar(c, c, 80));
    const pending = tracker.getPendingForTest();
    expect(pending.has('char2:th')).toBe(true);
    expect(pending.has('char2:he')).toBe(true);
    expect(pending.has('char3:the')).toBe(true);
  });

  // ─── word tracking ────────────────────────────────────────────────────────

  it('finalizes word1 when space is typed', () => {
    'the'.split('').forEach((c) => tracker.recordChar(c, c, 80));
    tracker.recordChar(' ', ' ', 80);
    const pending = tracker.getPendingForTest();
    expect(pending.has('word1:the')).toBe(true);
    expect(pending.get('word1:the')?.hits).toBe(1);
    expect(pending.get('word1:the')?.misses).toBe(0);
  });

  it('counts word1 as missed if any character in the word was mistyped (even if corrected)', () => {
    tracker.recordChar('t', 't', 80);
    tracker.recordChar('x', 'h', 80); // mistake on expected 'h'
    tracker.recordChar('h', 'h', 80); // corrected
    tracker.recordChar('e', 'e', 80);
    tracker.recordChar(' ', ' ', 80);

    const pending = tracker.getPendingForTest();
    expect(pending.has('word1:the')).toBe(true);
    expect(pending.get('word1:the')?.hits).toBe(0);
    expect(pending.get('word1:the')?.misses).toBe(1);
  });

  it('generates word2 after two words', () => {
    'the'.split('').forEach((c) => tracker.recordChar(c, c, 80));
    tracker.recordChar(' ', ' ', 80);
    'quick'.split('').forEach((c) => tracker.recordChar(c, c, 80));
    tracker.recordChar(' ', ' ', 80);
    const pending = tracker.getPendingForTest();
    expect(pending.has('word1:quick')).toBe(true);
    expect(pending.has('word2:the quick')).toBe(true);
  });

  it('finalizeWord captures last word without trailing space', () => {
    'fox'.split('').forEach((c) => tracker.recordChar(c, c, 80));
    tracker.finalizeWord();
    const pending = tracker.getPendingForTest();
    expect(pending.has('word1:fox')).toBe(true);
    expect(pending.get('word1:fox')?.hits).toBe(1);
    expect(pending.get('word1:fox')?.misses).toBe(0);
  });

  it('finalizeWord counts the last word as missed if any character was mistyped', () => {
    tracker.recordChar('f', 'f', 80);
    tracker.recordChar('o', 'o', 80);
    tracker.recordChar('x', 'x', 80);
    tracker.recordChar('!', 'x', 80);
    tracker.finalizeWord();

    const pending = tracker.getPendingForTest();
    expect(pending.has('word1:fox')).toBe(true);
    expect(pending.get('word1:fox')?.hits).toBe(0);
    expect(pending.get('word1:fox')?.misses).toBe(1);
  });

  // ─── time tracking ────────────────────────────────────────────────────────

  it('accumulates hitTimeMs on hits', () => {
    tracker.recordChar('t', 't', 120);
    tracker.recordChar('h', 'h', 80);
    const pending = tracker.getPendingForTest();
    expect(pending.get('char1:t')?.hitTimeMs).toBe(120);
    expect(pending.get('char1:h')?.hitTimeMs).toBe(80);
    expect(pending.get('char2:th')?.hitTimeMs).toBe(80);
  });

  it('does NOT accumulate hitTimeMs on misses', () => {
    tracker.recordChar('t', 't', 100);
    tracker.recordChar('x', 'h', 800); // miss with a long pause — discarded
    const pending = tracker.getPendingForTest();
    expect(pending.get('char1:h')?.misses).toBe(1);
    expect(pending.get('char1:h')?.hitTimeMs).toBe(0);
    expect(pending.get('char2:th')?.misses).toBe(1);
    expect(pending.get('char2:th')?.hitTimeMs).toBe(0);
  });

  // ─── flush ────────────────────────────────────────────────────────────────

  it('clears deltas after flush', async () => {
    tracker.recordChar('a', 'a', 100);
    expect(tracker.getPendingForTest().size).toBeGreaterThan(0);
    await tracker.flush();
    expect(tracker.getPendingForTest().size).toBe(0);
  });

  it('flush is a no-op when deltas are empty', async () => {
    await expect(tracker.flush()).resolves.toBeUndefined();
  });

  // ─── phantom doubled bigram (the bug this rewrite fixes) ──────────────────

  it('does NOT record phantom doubled bigrams on miss recovery', () => {
    // Target "apple": user mistypes 'a', then types 'a' correctly. The OLD
    // behavior recorded "aa" as a slow hit (with huge time-delta from
    // recovery). The NEW behavior records nothing for the corrective hit and
    // never produces an "aa" bigram.
    tracker.recordChar('q', 'a', 100, 'apple'); // miss
    tracker.recordChar('a', 'a', 800, 'apple'); // corrective hit (huge delay)
    tracker.recordChar('p', 'p', 90, 'apple');
    tracker.recordChar('p', 'p', 90, 'apple');

    const pending = tracker.getPendingForTest();
    expect(pending.has('char2:aa')).toBe(false);
    expect(pending.has('char3: aa')).toBe(false);
    expect(pending.get('char2:pp')?.hits).toBe(1);
  });

  it('does NOT record phantom doubled bigrams when miss is mid-word', () => {
    // Target "apple": correctly type 'a', mistype the first 'p', recover.
    // OLD behavior added "pp" hit on the corrective 'p'. NEW: only the real
    // "pp" bigram (between the two p's of "apple") gets recorded, as a hit.
    tracker.recordChar('a', 'a', 100, 'apple');
    tracker.recordChar('q', 'p', 100, 'apple'); // miss
    tracker.recordChar('p', 'p', 800, 'apple'); // corrective
    tracker.recordChar('p', 'p', 90, 'apple');  // real second 'p'

    const pending = tracker.getPendingForTest();
    expect(pending.get('char2:ap')?.misses).toBe(1);
    expect(pending.get('char2:ap')?.hits).toBe(0);
    expect(pending.get('char2:pp')?.hits).toBe(1);
    expect(pending.get('char2:pp')?.misses).toBe(0);
  });

  // ─── per-position miss cap ───────────────────────────────────────────────

  it('counts at most one miss per position even if user fumbles repeatedly', () => {
    // Target "cram", user mistypes 'r' four times then corrects.
    tracker.recordChar('c', 'c', 100, 'cram');
    tracker.recordChar('x', 'r', 100, 'cram'); // miss 1
    tracker.recordChar('q', 'r', 50, 'cram');  // miss 2
    tracker.recordChar('z', 'r', 50, 'cram');  // miss 3
    tracker.recordChar('y', 'r', 50, 'cram');  // miss 4
    tracker.recordChar('r', 'r', 50, 'cram');  // corrective hit
    tracker.recordChar('a', 'a', 90, 'cram');
    tracker.recordChar('m', 'm', 90, 'cram');

    const pending = tracker.getPendingForTest();
    expect(pending.get('char1:r')?.misses).toBe(1);
    expect(pending.get('char1:r')?.hits).toBe(0);
    expect(pending.get('char2:cr')?.misses).toBe(1);
    expect(pending.get('char2:cr')?.hits).toBe(0);
  });

  // ─── first char of word excluded from bigram blame ───────────────────────

  it('does NOT track bigrams for the first char of a word', () => {
    // Mistype the first char of "cram" — no bigram should be blamed.
    tracker.recordChar('x', 'c', 100, 'cram'); // miss
    tracker.recordChar('c', 'c', 500, 'cram');
    tracker.recordChar('r', 'r', 90, 'cram');

    const pending = tracker.getPendingForTest();
    expect(pending.get('char1:c')?.misses).toBe(1);
    // No bigram involving 'c' as the second char should have been recorded
    // for this miss (there's no preceding letter inside "cram").
    expect(pending.has('char2:cr')).toBe(true); // 'cr' is recorded on the next clean attempt
    expect(pending.get('char2:cr')?.hits).toBe(1);
    expect(pending.get('char2:cr')?.misses).toBe(0);
    // No space-letter bigram either.
    for (const k of pending.keys()) {
      if (k.startsWith('char2:') || k.startsWith('char3:')) {
        const ng = k.slice(k.indexOf(':') + 1);
        expect(/\s/.test(ng)).toBe(false);
      }
    }
  });

  it('does NOT cross word boundaries when forming bigrams', () => {
    // After a word ends the ring resets, so the first char of the next word
    // forms no bigram with the previous word's last letter.
    'an'.split('').forEach((c) => tracker.recordChar(c, c, 90));
    tracker.recordChar(' ', ' ', 90);
    'apple'.split('').forEach((c) => tracker.recordChar(c, c, 90));

    const pending = tracker.getPendingForTest();
    expect(pending.has('char2:n ')).toBe(false);
    expect(pending.has('char2: a')).toBe(false);
    expect(pending.has('char2:ap')).toBe(true);
  });

  // ─── per-bigram missed-word context ──────────────────────────────────────

  it('records bigram-word-miss with target and typed-prefix', () => {
    tracker.recordChar('c', 'c', 100, 'cram');
    tracker.recordChar('x', 'r', 100, 'cram'); // miss → record ('cr','cram','cx')

    const misses = tracker.getPendingBigramWordMissesForTest();
    expect(misses.get('cr\tcram\tcx')).toBe(1);
  });

  it('uses the FIRST wrong char as the typed-word substitution, even when fumbled multiple times', () => {
    tracker.recordChar('c', 'c', 100, 'cram');
    tracker.recordChar('x', 'r', 100, 'cram'); // miss 1 (first wrong)
    tracker.recordChar('q', 'r', 50, 'cram');  // miss 2 — must NOT re-record
    tracker.recordChar('r', 'r', 50, 'cram');  // corrective

    const misses = tracker.getPendingBigramWordMissesForTest();
    expect(misses.get('cr\tcram\tcx')).toBe(1);
    expect(misses.has('cr\tcram\tcq')).toBe(false);
  });

  it('records different bigram-word-miss rows for different misses in the same word', () => {
    // Target "apple": miss on 'p' (1st p) gets one row; miss on 'l' gets another.
    tracker.recordChar('a', 'a', 100, 'apple');
    tracker.recordChar('q', 'p', 100, 'apple');
    tracker.recordChar('p', 'p', 50, 'apple');
    tracker.recordChar('p', 'p', 90, 'apple');
    tracker.recordChar('z', 'l', 100, 'apple');
    tracker.recordChar('l', 'l', 50, 'apple');
    tracker.recordChar('e', 'e', 90, 'apple');

    const misses = tracker.getPendingBigramWordMissesForTest();
    expect(misses.get('ap\tapple\taq')).toBe(1);
    expect(misses.get('pl\tapple\tappz')).toBe(1);
  });

  it('does NOT record bigram-word-miss for a miss on the first char of a word', () => {
    tracker.recordChar('x', 'c', 100, 'cram');
    const misses = tracker.getPendingBigramWordMissesForTest();
    expect(misses.size).toBe(0);
  });
});
