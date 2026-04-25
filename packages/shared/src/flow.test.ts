import { describe, it, expect } from 'vitest';
import { generateFlowLine } from './flow.js';
import { indexNgramStats } from './ngramStats.js';

describe('generateFlowLine', () => {
  it('emits the requested number of words', () => {
    const allowed = new Set(['a', 'e', 'n', 't', 'o', 'h', 'i', 's', 'r', 'l']);
    const line = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 10,
    });
    const words = line.split(' ');
    expect(words).toHaveLength(10);
  });

  it('only emits words composed of allowed chars', () => {
    const allowed = new Set(['a', 'e', 't', 'n']);
    const line = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 5,
    });
    const words = line.split(' ');
    for (const word of words) {
      for (const c of word) {
        expect(allowed.has(c)).toBe(true);
      }
    }
  });

  it('returns empty string when no words match the allowed set', () => {
    const allowed = new Set<string>(); // nothing allowed
    const line = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 5,
    });
    expect(line).toEqual('');
  });

  it('is deterministic with a seeded RNG', () => {
    const allowed = new Set(['a', 'e', 'n', 't', 'o', 'h']);
    const seedRng = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const a = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 8,
      rng: seedRng(123),
    });
    const b = generateFlowLine({
      allowed,
      userIndex: indexNgramStats([]),
      numWords: 8,
      rng: seedRng(123),
    });
    expect(a).toEqual(b);
  });
});
