/**
 * Thrown when a habitat or condition string does not resolve in statutory reference data.
 * Callers may catch this to try alternate labels (e.g. broad-prefixed habitat keys).
 */
export class BaselineLookupError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message)
    this.name = 'BaselineLookupError'
  }
}
