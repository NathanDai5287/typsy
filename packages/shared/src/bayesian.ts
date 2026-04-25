import { BAYESIAN_ALPHA, BAYESIAN_BETA } from './constants.js';

/**
 * Bayesian-smoothed error rate.
 *
 *     error_rate = (misses + α) / (hits + misses + α + β)
 *
 * Defaults α=1, β=9 act as a Beta(1,9) prior — equivalent to ~10% expected
 * error rate before any data. Prevents tiny sample sizes (e.g. one trigram
 * seen twice and missed once) from producing nonsense rates like 0.5.
 *
 * @param hits   - Number of correct attempts.
 * @param misses - Number of incorrect attempts.
 * @param alpha  - Prior pseudo-misses (default BAYESIAN_ALPHA).
 * @param beta   - Prior pseudo-hits (default BAYESIAN_BETA).
 */
export function smoothedErrorRate(
  hits: number,
  misses: number,
  alpha: number = BAYESIAN_ALPHA,
  beta: number = BAYESIAN_BETA,
): number {
  return (misses + alpha) / (hits + misses + alpha + beta);
}

/** Smoothed accuracy (1 − smoothed error rate). */
export function smoothedAccuracy(
  hits: number,
  misses: number,
  alpha: number = BAYESIAN_ALPHA,
  beta: number = BAYESIAN_BETA,
): number {
  return 1 - smoothedErrorRate(hits, misses, alpha, beta);
}
