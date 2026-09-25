/** Neither band derived, and no verdict to give. A fresh object each call. */
export function noTradingRuleVerdict() {
  return { medium: null, low: null, overall: null }
}
