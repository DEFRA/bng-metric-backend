/**
 * Maximum significant figures for numeric results.
 * Matches Excel's 15 significant-figure precision limit, preventing
 * floating-point artefacts from propagating into spreadsheet exports.
 */
export const MAX_SIG_FIGS = 15

/**
 * Round a finite number to at most {@link MAX_SIG_FIGS} significant figures.
 * Returns the value unchanged when it is 0 or not finite.
 *
 * @param {number} value
 * @returns {number}
 * @example
 * roundToSigFigs(18.816000000000003) // 18.816
 * roundToSigFigs(0.30000000000000004) // 0.3
 */
export function roundToSigFigs(value) {
  if (!Number.isFinite(value) || value === 0) {
    return value
  }
  return Number.parseFloat(value.toPrecision(MAX_SIG_FIGS))
}
