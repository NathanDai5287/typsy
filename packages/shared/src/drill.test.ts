import { describe, it, expect } from 'vitest';
import { generateDrillSequence } from './drill.js';
import { indexNgramStats } from './ngramStats.js';

const allowed = new Set(['a', 'e', 'n', 't']);

describe('generateDrillSequence', () => {
  it('returns a non-empty string composed of allowed chars (plus space)', () => {
    const seq = generateDrillSequence({
      allowed,
      userIndex: indexNgramStats([]),
      length: 30,
    });
    expect(seq.length).toBeGreaterThan(0);
    const allowedWithSpace = new Set([...allowed, ' ']);
    for (const c of seq) {
      expect(allowedWithSpace.has(c)).toBe(true);
    }
  });

  it('does not start or end with whitespace', () => {
    const seq = generateDrillSequence({
      allowed,
      userIndex: indexNgramStats([]),
      length: 30,
    });
    expect(seq.trim()).toEqual(seq);
  });
});
