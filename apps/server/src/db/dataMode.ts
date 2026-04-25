/**
 * Dev-only data-mode switch.
 *
 * The server treats one user_id as "real" (everything actually typed) and
 * another as "synthetic" (whatever `seed:dev` produces). Which one each
 * request reads/writes is decided by the TYPSY_DATA_MODE env var, set
 * at server startup.
 *
 *   TYPSY_DATA_MODE unset | 'real'      → REAL_USER_ID (1)
 *   TYPSY_DATA_MODE === 'synthetic'     → SYNTHETIC_USER_ID (2)
 *
 * This is intentionally invisible to the UI — there is no toggle, no chip,
 * no settings entry. To switch, stop the dev server and start it with the
 * other mode (see `pnpm dev` vs `pnpm dev:synth`). The two users' rows
 * never mix because every per-user table (user_layout_progress, sessions,
 * ngram_stats) is already keyed by user_id.
 */
export type DataMode = 'real' | 'synthetic';

export const REAL_USER_ID = 1;
export const SYNTHETIC_USER_ID = 2;

export function getCurrentDataMode(): DataMode {
  return process.env.TYPSY_DATA_MODE === 'synthetic' ? 'synthetic' : 'real';
}

export function getCurrentUserId(): number {
  return getCurrentDataMode() === 'synthetic' ? SYNTHETIC_USER_ID : REAL_USER_ID;
}
