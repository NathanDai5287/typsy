import { WORD_COUNTS } from './wordListData.js';
import { backoffErrorRate, weaknessScore, type NgramIndex } from './ngramStats.js';

/**
 * Char bigram → (next char → weight). Weights are word-frequency-weighted bigram
 * counts from the source corpus.
 */
export type CharTransitions = Map<string, Map<string, number>>;

let _baseTransitions: CharTransitions | null = null;

/**
 * Lazy-built base char-transition matrix from the bundled word list.
 *
 * We treat each word as `<word>` with implicit space boundaries, then count
 * weighted bigrams `(prev → next)` where weight = word frequency.
 *
 * Build is O(N) over the 10k word list; cached after first call.
 */
export function getBaseTransitions(): CharTransitions {
  if (_baseTransitions) return _baseTransitions;
  const trans: CharTransitions = new Map();

  for (const [word, count] of WORD_COUNTS) {
    const padded = ' ' + word + ' ';
    for (let i = 0; i < padded.length - 1; i++) {
      const a = padded[i];
      const b = padded[i + 1];
      let row = trans.get(a);
      if (!row) {
        row = new Map();
        trans.set(a, row);
      }
      row.set(b, (row.get(b) ?? 0) + count);
    }
  }
  _baseTransitions = trans;
  return trans;
}

export interface MaskedTransitions {
  transitions: CharTransitions;
  /** Total weight per source char — useful for picking a start state. */
  rowTotals: Map<string, number>;
}

/**
 * Mask the base matrix to a subset of allowed characters and re-bias each
 * transition by the user's weakness score for the resulting bigram.
 *
 *   adjusted(a→b) = base(a→b) × (1 + bias × error_rate(ab) × base_freq(ab))
 *
 * `bias` controls how much we lean into weak ngrams (higher = more practice
 * on pain points). Spec §6.5: weakness_score = error_rate × frequency.
 *
 * @param allowed   - Set of allowed lowercase chars (plus optional ' ').
 * @param userIndex - Per-user ngram stats index (for weakness bias).
 * @param bias      - Multiplier on the weakness term (default 5).
 */
export function buildMaskedTransitions(
  allowed: ReadonlySet<string>,
  userIndex: NgramIndex,
  bias = 5,
): MaskedTransitions {
  const base = getBaseTransitions();
  const baseTotal = sumAllWeights(base);
  const out: CharTransitions = new Map();
  const rowTotals = new Map<string, number>();

  for (const [a, row] of base) {
    if (!allowed.has(a)) continue;
    const newRow = new Map<string, number>();
    let rowTotal = 0;
    for (const [b, w] of row) {
      if (!allowed.has(b)) continue;
      const bigramFreq = w / baseTotal;
      const errorRate = backoffErrorRate(userIndex, a + b, 'char2');
      const weakness = weaknessScore(errorRate, bigramFreq);
      const weight = w * (1 + bias * weakness);
      newRow.set(b, weight);
      rowTotal += weight;
    }
    if (rowTotal > 0) {
      out.set(a, newRow);
      rowTotals.set(a, rowTotal);
    }
  }

  return { transitions: out, rowTotals };
}

function sumAllWeights(t: CharTransitions): number {
  let total = 0;
  for (const row of t.values()) for (const w of row.values()) total += w;
  return total;
}

/** Pick the next char from a row using weighted random sampling. */
function sampleFromRow(row: Map<string, number>, rng: () => number): string {
  let total = 0;
  for (const w of row.values()) total += w;
  let r = rng() * total;
  for (const [c, w] of row) {
    r -= w;
    if (r <= 0) return c;
  }
  // Floating point safety fallback: return last
  let last = '';
  for (const c of row.keys()) last = c;
  return last;
}

/**
 * Generate a Markov-random sequence using the masked transitions. The
 * sequence is whitespace-bounded — leading/trailing spaces are trimmed
 * and runs of spaces collapsed.
 *
 * @param masked  - Output of buildMaskedTransitions().
 * @param length  - Approximate length in characters (default 50).
 * @param rng     - Random source (default Math.random).
 */
export function generateMarkovSequence(
  masked: MaskedTransitions,
  length = 50,
  rng: () => number = Math.random,
): string {
  const { transitions, rowTotals } = masked;
  if (transitions.size === 0) return '';

  const startState = pickStartState(rowTotals, rng);
  const out: string[] = [startState];
  let prev = startState;

  while (out.join('').replace(/\s+/g, ' ').trim().length < length) {
    const row = transitions.get(prev);
    if (!row || row.size === 0) {
      // Dead end — restart from a weighted fresh state.
      prev = pickStartState(rowTotals, rng);
      out.push(' ', prev);
      continue;
    }
    const next = sampleFromRow(row, rng);
    out.push(next);
    prev = next;
  }

  return out.join('').replace(/\s+/g, ' ').trim();
}

function pickStartState(rowTotals: Map<string, number>, rng: () => number): string {
  // Prefer a space (whole-word starts) but fall back if absent.
  if (rowTotals.has(' ')) return ' ';
  const entries = Array.from(rowTotals);
  if (entries.length === 0) return '';
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [c, w] of entries) {
    r -= w;
    if (r <= 0) return c;
  }
  return entries[entries.length - 1][0];
}

/**
 * Top-K weakest bigrams in the user's stats (smoothed-error × user-attempt-weighted).
 * Restricted to bigrams whose chars are all in `allowed`.
 */
export function topWeakBigrams(
  userIndex: NgramIndex,
  allowed: ReadonlySet<string>,
  topK = 3,
): string[] {
  const base = getBaseTransitions();
  const baseTotal = sumAllWeights(base);
  const scored: { bigram: string; score: number }[] = [];

  for (const [a, row] of base) {
    if (!allowed.has(a)) continue;
    for (const [b, w] of row) {
      if (!allowed.has(b)) continue;
      const bigramFreq = w / baseTotal;
      const errorRate = backoffErrorRate(userIndex, a + b, 'char2');
      scored.push({ bigram: a + b, score: weaknessScore(errorRate, bigramFreq) });
    }
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, topK).map((s) => s.bigram);
}
