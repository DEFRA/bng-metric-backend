import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const referenceDir = join(dirname(fileURLToPath(import.meta.url)), 'reference')

function loadReferenceConstants() {
  const names = readdirSync(referenceDir)
    .filter((name) => name.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b))

  /** @type {Record<string, unknown>} */
  const out = {}
  for (const file of names) {
    const key = file
      .replace(/\.json$/u, '')
      .replaceAll('-', '_')
      .toUpperCase()
    const raw = readFileSync(join(referenceDir, file), 'utf8')
    out[key] = JSON.parse(raw)
  }
  return out
}

const _reference = loadReferenceConstants()

export const CONDITION_SCORES = _reference.CONDITION_SCORES
export const DIFFICULTY_MULTIPLIER = _reference.DIFFICULTY_MULTIPLIER
export const DISTINCTIVENESS_CATEGORIES = _reference.DISTINCTIVENESS_CATEGORIES
export const DISTINCTIVENESS_SCORES = _reference.DISTINCTIVENESS_SCORES
export const HABITAT_DIFFICULTY = _reference.HABITAT_DIFFICULTY
export const TIME_TO_TARGET_CREATION = _reference.TIME_TO_TARGET_CREATION
export const TIME_TO_TARGET_ENHANCEMENT = _reference.TIME_TO_TARGET_ENHANCEMENT
export const TIME_TO_TARGET_MULTIPLIER = _reference.TIME_TO_TARGET_MULTIPLIER
