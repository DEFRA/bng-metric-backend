// Where the metric comparison's recorded discrepancies live: the differences
// between the service and the metric already known about, so a run fails on a
// change rather than on every one of them. Regenerate the record with
// `npm run compare:metric -- --update-known` and review the diff.

import { readFileSync } from 'node:fs'
import path from 'node:path'

export const KNOWN_DISCREPANCIES_PATH = path.join(
  import.meta.dirname,
  'known-discrepancies.json'
)

/**
 * @returns {Record<string, { outcome: string, discrepancies?: object }>}
 */
export function readKnownDiscrepancies() {
  return JSON.parse(readFileSync(KNOWN_DISCREPANCIES_PATH, 'utf8'))
}
