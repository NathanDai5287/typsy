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
    tracker.recordChar('x', 't', 100); // typed x, expected t
    const pending = tracker.getPendingForTest();
    // Miss recorded on expected 't', NOT on typed 'x'
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
    tracker.recordChar('t', 't', 100); // correct
    tracker.recordChar('x', 'h', 80); // wrong — expected 'h', typed 'x'
    const pending = tracker.getPendingForTest();
    // Miss should be on 'th' (expected bigram), not 'tx'
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
  });

  // ─── time tracking ────────────────────────────────────────────────────────

  it('accumulates totalTimeMs', () => {
    tracker.recordChar('t', 't', 120);
    tracker.recordChar('h', 'h', 80);
    const pending = tracker.getPendingForTest();
    // char1:t gets 120ms, char1:h gets 80ms
    expect(pending.get('char1:t')?.totalTimeMs).toBe(120);
    expect(pending.get('char1:h')?.totalTimeMs).toBe(80);
    // char2:th gets 80ms (time of the second keypress)
    expect(pending.get('char2:th')?.totalTimeMs).toBe(80);
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
});
