#!/usr/bin/env node

import { calculateRetainedWatercoursePostIntervention } from '../src/watercourse-post-intervention.js'
import {
  exitWithUsage,
  parsePositiveNumber,
  resolveArgvMode,
  runCli
} from './post-intervention-cli-shared.js'
import { parseWatercourseRetainedPositionalArgs } from './post-intervention-watercourse-cli-shared.js'

const SCRIPT =
  'bng-metric-engine/scripts/calc-retained-watercourse-post-intervention.js'
const USAGE = [
  'Usage:',
  `  node ${SCRIPT} <lengthKm> <watercourseType> <condition> [watercourseEncroachment] [riparianEncroachment]`,
  '',
  'Example:',
  `  node ${SCRIPT} 1 "Priority habitat" Good Minor "Minor/No Encroachment"`,
  '',
  'Watercourse type may be quoted or unquoted (words between length and condition are joined):',
  `  node ${SCRIPT} 1 Priority habitat Good`,
  '',
  'Use "-" to omit optional encroachment values (defaults to multiplier 1):',
  `  node ${SCRIPT} 1 Priority habitat Good Minor -`,
  '',
  'Run built-in example with no arguments:',
  `  node ${SCRIPT} --example`
]

const mode = resolveArgvMode(SCRIPT, USAGE)

if (mode === 'example') {
  runCli(() =>
    calculateRetainedWatercoursePostIntervention(
      1,
      'Priority habitat',
      'Good',
      'Minor',
      'Minor/No Encroachment'
    )
  )
} else {
  const parsed = parseWatercourseRetainedPositionalArgs(process.argv.slice(2))
  if (!parsed) {
    exitWithUsage(SCRIPT, USAGE)
  }
  const lengthKm = parsePositiveNumber('lengthKm', parsed.lengthRaw)
  runCli(() =>
    calculateRetainedWatercoursePostIntervention(
      lengthKm,
      parsed.watercourseType,
      parsed.condition,
      parsed.watercourseEncroachment,
      parsed.riparianEncroachment
    )
  )
}
